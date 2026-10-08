const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const people = require('./people.service');
const parties = require('./parties.service');
const calc = require('./deal.calc');
const { SERVICE_KEYS, SERVICE_TYPES } = require('./serviceTypes');

const STATUSES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'];
const DONE = ['completed', 'cancelled'];
const ACTIVE = STATUSES.filter((s) => !DONE.includes(s));

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateOnly = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const money = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e13).nullable().optional());
const reasonField = z.string().trim().max(500).optional();
// Free-form deal facts: every deal differs, so nothing here is mandatory.
const detailsSchema = z.array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(500) })).max(40).nullable().optional();

const dealFields = {
  name: z.string().trim().min(1).max(200),
  service_type: z.enum(SERVICE_KEYS),
  party_id: uuidOrNull,
  vendor_id: uuidOrNull,
  start_date: dateOnly.optional(),
  expected_end: dateOnly.optional(),
  actual_end: dateOnly.optional(),
  deal_amount: money,
  location: text(200),
  assignee_id: uuidOrNull,
  contractor_id: uuidOrNull,
  description: text(20000),
  notes: text(4000),
  details: detailsSchema,
};
const createDealSchema = z.object({ ...dealFields, status: z.enum(ACTIVE).default('planned') });
const updateDealSchema = z.object({ ...dealFields, reason: reasonField }).partial();
const statusSchema = z.object({ status: z.enum(STATUSES), reason: text(500), actual_end: dateOnly.optional() });
const convertSchema = z.object({ name: z.string().trim().min(1).max(200).optional(), start_date: dateOnly.optional() });
const listQuerySchema = z.object({
  status: z.enum([...STATUSES, 'open', 'done', 'all']).optional(),
  service_type: z.enum(SERVICE_KEYS).optional(),
  party_id: z.string().uuid().optional(),
  vendor_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
  location: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  flag: z.enum(['delayed', 'loss_making']).optional(),
  q: z.string().trim().max(100).optional(),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayOf = calc.dayOf;
const today = () => dayOf(new Date());
const num = (v) => (v === null || v === undefined ? null : Number(v));
const dealSnap = (d) => ({ code: d.code, name: d.name, status: d.status, service_type: d.service_type, party_id: d.party_id, vendor_id: d.vendor_id, deal_amount: num(d.deal_amount), start_date: dayOf(d.start_date), expected_end: dayOf(d.expected_end), actual_end: dayOf(d.actual_end) });

async function nextCode(tx, orgId) {
  await tx.axSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  const s = await tx.axSetting.update({ where: { org_id: orgId }, data: { deal_seq: { increment: 1 } } });
  return `${s.deal_prefix}-${String(s.deal_seq).padStart(4, '0')}`;
}

const dateProblem = (start, end) => (start && end && end < start ? 'The completion date cannot be before the start date' : null);

async function checkRefs(orgId, input, before) {
  if (input.party_id && input.party_id !== before?.party_id && !(await parties.partyOk(orgId, input.party_id, 'client'))) return { error: 'party_not_found' };
  if (input.vendor_id && input.vendor_id !== before?.vendor_id && !(await parties.partyOk(orgId, input.vendor_id, 'vendor'))) return { error: 'vendor_not_found' };
  if (input.assignee_id && input.assignee_id !== before?.assignee_id && !(await people.personOk(orgId, input.assignee_id, 'employee'))) return { error: 'invalid', message: 'The assigned employee must be an active employee on the roster' };
  if (input.contractor_id && input.contractor_id !== before?.contractor_id && !(await people.personOk(orgId, input.contractor_id, 'contractor'))) return { error: 'invalid', message: 'The assigned contractor must be an active contractor on the roster' };
  return null;
}

// Live ledger rows for a set of deals, grouped by deal id.
async function loadEntries(orgId, dealIds) {
  const rows = await prisma.axLedgerEntry.findMany({ where: { org_id: orgId, deal_id: { in: dealIds }, deleted_at: null } });
  const m = new Map();
  for (const r of rows) (m.get(r.deal_id) || m.set(r.deal_id, []).get(r.deal_id)).push(r);
  return m;
}

async function decorate(orgId, deals) {
  if (!deals.length) return [];
  const { people: pm, parties: am } = await people.nameMap(orgId, deals.flatMap((d) => [d.assignee_id, d.contractor_id]), deals.flatMap((d) => [d.party_id, d.vendor_id]));
  const entries = await loadEntries(orgId, deals.map((d) => d.id));
  return deals.map((d) => ({
    ...d,
    deal_amount: num(d.deal_amount),
    service_label: SERVICE_TYPES.find((t) => t.key === d.service_type)?.label || d.service_type,
    party: am.get(d.party_id) || null,
    vendor: am.get(d.vendor_id) || null,
    assignee: pm.get(d.assignee_id) || null,
    contractor: pm.get(d.contractor_id) || null,
    summary: calc.summarize(d, entries.get(d.id) || []),
  }));
}

// Shared where-builder: the list, the dashboard counts and the reports all filter deals the same way.
function whereOf(orgId, query, scope = {}) {
  const start = {};
  if (query.from) start.gte = toDate(query.from);
  if (query.to) start.lte = toDate(query.to);
  return {
    org_id: orgId,
    deleted_at: null,
    ...(query.status === 'open' ? { status: { in: ACTIVE } } : {}),
    ...(query.status === 'done' ? { status: { in: DONE } } : {}),
    ...(query.status && !['open', 'done', 'all'].includes(query.status) ? { status: query.status } : {}),
    ...(query.service_type ? { service_type: query.service_type } : {}),
    ...(query.party_id ? { party_id: query.party_id } : {}),
    ...(query.vendor_id ? { vendor_id: query.vendor_id } : {}),
    ...(query.assignee_id ? { OR: [{ assignee_id: query.assignee_id }, { contractor_id: query.assignee_id }] } : {}),
    ...(Object.keys(start).length ? { start_date: start } : {}),
    AND: [
      ...(scope.personId ? [{ OR: [{ assignee_id: scope.personId }, { contractor_id: scope.personId }] }] : []),
      ...(query.location ? [{ location: { contains: query.location, mode: 'insensitive' } }] : []),
      ...(query.q ? [{ OR: ['name', 'code', 'location'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) }] : []),
    ],
  };
}

async function list(orgId, query, scope = {}) {
  let rows = await decorate(orgId, await prisma.axDeal.findMany({ where: whereOf(orgId, query, scope), orderBy: [{ updated_at: 'desc' }], take: 500 }));
  if (query.flag === 'delayed') rows = rows.filter((d) => d.summary.delayed);
  if (query.flag === 'loss_making') rows = rows.filter((d) => d.summary.profit < 0);
  return rows;
}

async function get(orgId, id) {
  const deal = await prisma.axDeal.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!deal) return { error: 'not_found' };
  const [entries, investments, lead, taskCount] = await Promise.all([
    prisma.axLedgerEntry.findMany({ where: { org_id: orgId, deal_id: id, deleted_at: null }, include: { category: { select: { name: true } } }, orderBy: { entry_date: 'asc' } }),
    prisma.axInvestment.findMany({ where: { org_id: orgId, deal_id: id, deleted_at: null }, select: { id: true, code: true, name: true, type: true, amount: true, current_value: true, status: true } }),
    deal.lead_id ? prisma.axLead.findFirst({ where: { id: deal.lead_id, org_id: orgId }, select: { id: true, code: true, name: true, stage: true } }) : null,
    prisma.axTask.count({ where: { org_id: orgId, deal_id: id, deleted_at: null, status: { in: ['pending', 'in_progress'] } } }),
  ]);
  const [decorated] = await decorate(orgId, [deal]);
  return {
    deal: {
      ...decorated,
      lead,
      open_tasks: taskCount,
      investments: investments.map((i) => ({ ...i, amount: Number(i.amount), current_value: Number(i.current_value) })),
      entries: entries.map((e) => ({ ...e, amount: Number(e.amount), tax: Number(e.tax), category_name: e.category?.name || null })),
    },
  };
}

async function create(orgId, actorId, input) {
  const problem = dateProblem(input.start_date, input.expected_end) || dateProblem(input.start_date, input.actual_end);
  if (problem) return { error: 'invalid', message: problem };
  const refs = await checkRefs(orgId, input, null);
  if (refs) return refs;
  const { start_date, expected_end, actual_end, details, ...rest } = input;
  const deal = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    return tx.axDeal.create({ data: { org_id: orgId, created_by: actorId, code, ...rest, details: details || undefined, start_date: toDate(start_date), expected_end: toDate(expected_end), actual_end: toDate(actual_end) } });
  });
  await writeAudit(null, { orgId, actorId, entity: 'deal', entityId: deal.id, action: 'create', after: dealSnap(deal) });
  return get(orgId, deal.id);
}

const locked = (deal, ctx) => DONE.includes(deal.status) && !ctx.isAdmin;

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.axDeal.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (locked(before, ctx)) return { error: 'deal_closed' };
  const { reason, ...fields } = input;
  const s = fields.start_date !== undefined ? fields.start_date : dayOf(before.start_date);
  const problem = dateProblem(s, fields.expected_end !== undefined ? fields.expected_end : dayOf(before.expected_end)) || dateProblem(s, fields.actual_end !== undefined ? fields.actual_end : dayOf(before.actual_end));
  if (problem) return { error: 'invalid', message: problem };
  const refs = await checkRefs(orgId, fields, before);
  if (refs) return refs;
  // A deal amount change is a financial change: an admin must say why once the deal is finished (handled by the lock above);
  // for open deals the change is simply audited.
  const { start_date, expected_end, actual_end, details, ...rest } = fields;
  await prisma.axDeal.update({
    where: { id },
    data: {
      ...rest,
      ...(start_date !== undefined ? { start_date: toDate(start_date) } : {}),
      ...(expected_end !== undefined ? { expected_end: toDate(expected_end) } : {}),
      ...(actual_end !== undefined ? { actual_end: toDate(actual_end) } : {}),
      ...(details !== undefined ? { details: details === null ? Prisma.DbNull : details } : {}),
    },
  });
  const after = await prisma.axDeal.findUnique({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'deal', entityId: id, action: 'update', before: dealSnap(before), after: dealSnap(after), reason });
  return get(orgId, id);
}

async function changeStatus(orgId, actorId, ctx, id, input) {
  const before = await prisma.axDeal.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (locked(before, ctx)) return { error: 'deal_closed' };
  if (input.status === before.status) return { error: 'same_status' };
  if (input.status === 'cancelled' && !input.reason) return { error: 'reason_required' };
  if (DONE.includes(before.status) && !input.reason) return { error: 'reason_required' };
  const data = { status: input.status, cancel_reason: input.status === 'cancelled' ? input.reason : null };
  if (input.status === 'completed') data.actual_end = toDate(input.actual_end || today());
  else if (DONE.includes(before.status)) data.actual_end = null;
  await prisma.axDeal.update({ where: { id }, data });
  await writeAudit(null, { orgId, actorId, entity: 'deal', entityId: id, action: 'status', before: { status: before.status }, after: { status: input.status }, reason: input.reason });
  return get(orgId, id);
}

async function remove(orgId, actorId, id) {
  const before = await prisma.axDeal.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.axDeal.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'deal', entityId: id, action: 'delete', before: dealSnap(before) });
  return { ok: true };
}

// A won lead becomes a deal. Everything carries forward (lead id, client, service, description, expected amount,
// assignee, contractor, dates, notes) and the lead stays for history.
async function convertLead(orgId, actorId, leadId, input) {
  const lead = await prisma.axLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null } });
  if (!lead) return { error: 'not_found' };
  if (lead.stage !== 'won') return { error: 'lead_not_won' };
  if (lead.deal_id) return { error: 'already_converted' };
  const deal = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    const created = await tx.axDeal.create({
      data: {
        org_id: orgId,
        created_by: actorId,
        code,
        name: input.name || lead.name,
        lead_id: lead.id,
        service_type: lead.service_type,
        party_id: lead.party_id,
        vendor_id: lead.vendor_id,
        status: 'planned',
        start_date: input.start_date !== undefined ? toDate(input.start_date) : lead.expected_start,
        expected_end: lead.expected_end,
        deal_amount: lead.expected_amount,
        location: lead.location,
        assignee_id: lead.assignee_id,
        contractor_id: lead.contractor_id,
        description: lead.description,
        notes: lead.notes,
        details: lead.details ?? undefined,
      },
    });
    await tx.axLead.update({ where: { id: lead.id }, data: { deal_id: created.id } });
    await tx.axLeadActivity.create({ data: { org_id: orgId, lead_id: lead.id, kind: 'note', created_by: actorId, summary: `Converted to deal ${code}` } });
    return created;
  });
  await writeAudit(null, { orgId, actorId, entity: 'deal', entityId: deal.id, action: 'convert', after: { lead_id: lead.id, code: deal.code } });
  return get(orgId, deal.id);
}

module.exports = {
  STATUSES, DONE, ACTIVE, createDealSchema, updateDealSchema, statusSchema, convertSchema, listQuerySchema,
  whereOf, decorate, list, get, create, update, changeStatus, remove, convertLead,
};
