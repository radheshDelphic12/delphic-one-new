const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const prisma = require('../../config/db');
const { userNames } = require('../../lib/vertical');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const people = require('./people.service');
const parties = require('./parties.service');
const { round2 } = require('./deal.calc');

// Pipeline: new -> in_discussion -> negotiation -> sourcing -> proposal_order -> won. A lead can be parked
// (on_hold) or end as closed / dropped. Won / closed / dropped are locked until an admin reopens them
// (an admin may also edit a finished lead in place).
const OPEN_STAGES = ['new', 'in_discussion', 'negotiation', 'sourcing', 'proposal_order', 'on_hold'];
const DONE_STAGES = ['won', 'closed', 'dropped'];
const STAGES = ['new', 'in_discussion', 'negotiation', 'sourcing', 'proposal_order', 'won', 'dropped', 'on_hold', 'closed'];
const KINDS = ['call', 'visit', 'meeting', 'note'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateOnly = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const money = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e13).nullable().optional());
const qty = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e12).nullable().optional());
// Free-form deal facts: every deal differs, so nothing here is mandatory.
const detailsSchema = z.array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(500) })).max(40).nullable().optional();

const leadFields = {
  name: z.string().trim().min(1).max(200),
  trading_type: z.string().trim().min(1).max(40),
  party_id: uuidOrNull,
  vendor_id: uuidOrNull,
  contact_name: text(200),
  phone: text(40),
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().email().max(200).nullable().optional()),
  location: text(200),
  source: text(120),
  owner_id: uuidOrNull,
  assignee_id: uuidOrNull,
  contractor_id: uuidOrNull,
  product: text(200),
  material_type: text(200),
  quantity: qty,
  unit: text(40),
  expected_purchase_amount: money,
  expected_sale_amount: money,
  expected_margin: money,
  expected_start: dateOnly.optional(),
  expected_end: dateOnly.optional(),
  description: text(20000),
  notes: text(4000),
  details: detailsSchema,
};
const createLeadSchema = z.object({ ...leadFields, stage: z.enum(OPEN_STAGES).default('new') });
const updateLeadSchema = z.object(leadFields).partial();
const stageSchema = z.object({ stage: z.enum(STAGES), lost_reason: text(500), reason: text(500) });
const reopenSchema = z.object({ stage: z.enum(OPEN_STAGES).default('negotiation'), reason: z.string().trim().min(1).max(500) });
const activitySchema = z.object({ kind: z.enum(KINDS).default('note'), summary: z.string().trim().min(1).max(1000), follow_up_date: dateOnly.optional() });
const activityUpdateSchema = z.object({ kind: z.enum(KINDS), summary: z.string().trim().min(1).max(1000), follow_up_date: dateOnly.nullable(), follow_up_done: z.boolean() }).partial();
const listQuerySchema = z.object({
  stage: z.enum([...STAGES, 'open', 'closed']).optional(),
  trading_type: z.string().trim().max(40).optional(),
  party_id: z.string().uuid().optional(),
  vendor_id: z.string().uuid().optional(),
  owner_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
  location: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const isDone = (lead) => DONE_STAGES.includes(lead.stage);
const snapshot = (l) => ({ code: l.code, name: l.name, stage: l.stage, trading_type: l.trading_type, quantity: num(l.quantity), expected_sale_amount: num(l.expected_sale_amount), expected_purchase_amount: num(l.expected_purchase_amount), party_id: l.party_id, vendor_id: l.vendor_id, assignee_id: l.assignee_id });

async function nextCode(tx, orgId) {
  await tx.gxSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  const s = await tx.gxSetting.update({ where: { org_id: orgId }, data: { lead_seq: { increment: 1 } } });
  return `${s.lead_prefix}-${String(s.lead_seq).padStart(4, '0')}`;
}

function dateProblem(start, end) {
  return start && end && end < start ? 'Expected completion cannot be before the start date' : null;
}

// Expected margin = expected sale - expected purchase unless stated explicitly.
function margin(input, before) {
  if (input.expected_margin !== undefined && input.expected_margin !== null) return input.expected_margin;
  const sale = input.expected_sale_amount !== undefined ? input.expected_sale_amount : num(before?.expected_sale_amount);
  const purchase = input.expected_purchase_amount !== undefined ? input.expected_purchase_amount : num(before?.expected_purchase_amount);
  if (input.expected_margin === null) return null;
  return sale != null && purchase != null ? round2(sale - purchase) : undefined;
}

async function checkRefs(orgId, input, before) {
  if (input.trading_type && input.trading_type !== before?.trading_type && !(await core.typeKeys(orgId)).includes(input.trading_type)) return { error: 'invalid', message: 'Unknown trading type' };
  if (input.party_id && input.party_id !== before?.party_id && !(await parties.partyOk(orgId, input.party_id, 'client'))) return { error: 'party_not_found' };
  if (input.vendor_id && input.vendor_id !== before?.vendor_id && !(await parties.partyOk(orgId, input.vendor_id, 'vendor'))) return { error: 'vendor_not_found' };
  if (input.owner_id && input.owner_id !== before?.owner_id && !(await people.ownerOk(orgId, input.owner_id))) return { error: 'owner_invalid' };
  if (input.assignee_id && input.assignee_id !== before?.assignee_id && !(await people.personOk(orgId, input.assignee_id, 'employee'))) return { error: 'invalid', message: 'The assigned employee must be an active employee on the roster' };
  if (input.contractor_id && input.contractor_id !== before?.contractor_id && !(await people.personOk(orgId, input.contractor_id, 'contractor'))) return { error: 'invalid', message: 'The assigned contractor must be an active contractor on the roster' };
  return null;
}

async function decorate(orgId, leads) {
  const names = await userNames(leads.map((l) => l.owner_id));
  const { people: pm, parties: am } = await people.nameMap(orgId, leads.flatMap((l) => [l.assignee_id, l.contractor_id]), leads.flatMap((l) => [l.party_id, l.vendor_id]));
  const next = leads.length
    ? await prisma.gxLeadActivity.groupBy({ by: ['lead_id'], where: { org_id: orgId, lead_id: { in: leads.map((l) => l.id) }, follow_up_done: false, follow_up_date: { not: null } }, _min: { follow_up_date: true } })
    : [];
  const nextMap = new Map(next.map((n) => [n.lead_id, n._min.follow_up_date]));
  return leads.map((l) => ({
    ...l,
    quantity: num(l.quantity),
    expected_purchase_amount: num(l.expected_purchase_amount),
    expected_sale_amount: num(l.expected_sale_amount),
    expected_margin: num(l.expected_margin),
    owner: names.get(l.owner_id) || null,
    party: am.get(l.party_id) || null,
    vendor: am.get(l.vendor_id) || null,
    assignee: pm.get(l.assignee_id) || null,
    contractor: pm.get(l.contractor_id) || null,
    next_follow_up: isDone(l) ? null : nextMap.get(l.id) || null,
  }));
}

// scope = { personId } restricts to leads assigned to that person (employee / contractor views).
async function list(orgId, query, scope = {}) {
  const created = {};
  if (query.from) created.gte = toDate(query.from);
  if (query.to) created.lte = new Date(`${query.to}T23:59:59.999Z`);
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(query.stage === 'open' ? { stage: { in: OPEN_STAGES } } : {}),
    ...(query.stage === 'closed' ? { stage: { in: DONE_STAGES } } : {}),
    ...(query.stage && !['open', 'closed'].includes(query.stage) ? { stage: query.stage } : {}),
    ...(query.trading_type ? { trading_type: query.trading_type } : {}),
    ...(query.party_id ? { party_id: query.party_id } : {}),
    ...(query.vendor_id ? { vendor_id: query.vendor_id } : {}),
    ...(query.owner_id ? { owner_id: query.owner_id } : {}),
    ...(query.assignee_id ? { assignee_id: query.assignee_id } : {}),
    ...(scope.personId ? { OR: [{ assignee_id: scope.personId }, { contractor_id: scope.personId }] } : {}),
    ...(Object.keys(created).length ? { created_at: created } : {}),
    AND: [
      ...(query.location ? [{ location: { contains: query.location, mode: 'insensitive' } }] : []),
      ...(query.q ? [{ OR: ['name', 'code', 'contact_name', 'location', 'source', 'product'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) }] : []),
    ],
  };
  return decorate(orgId, await prisma.gxLead.findMany({ where, orderBy: [{ updated_at: 'desc' }], take: query.limit }));
}

// Pipeline counts, plus the trading type x stage matrix.
async function summary(orgId) {
  const rows = await prisma.gxLead.findMany({ where: { org_id: orgId, deleted_at: null }, select: { stage: true, trading_type: true, expected_sale_amount: true } });
  const types = await core.listTypes(orgId);
  const byStage = Object.fromEntries(STAGES.map((s) => [s, { count: 0, value: 0 }]));
  const matrix = Object.fromEntries(types.map((t) => [t.key, { label: t.label, total: 0, by_stage: Object.fromEntries(STAGES.map((s) => [s, 0])) }]));
  for (const r of rows) {
    const value = num(r.expected_sale_amount) || 0;
    byStage[r.stage].count += 1;
    byStage[r.stage].value += value;
    if (!matrix[r.trading_type]) matrix[r.trading_type] = { label: r.trading_type, total: 0, by_stage: Object.fromEntries(STAGES.map((s) => [s, 0])) };
    matrix[r.trading_type].total += 1;
    matrix[r.trading_type].by_stage[r.stage] += 1;
  }
  const open = OPEN_STAGES.reduce((a, s) => ({ count: a.count + byStage[s].count, value: a.value + byStage[s].value }), { count: 0, value: 0 });
  const decided = byStage.won.count + byStage.dropped.count;
  const due = await prisma.gxLeadActivity.count({ where: { org_id: orgId, follow_up_done: false, follow_up_date: { lte: toDate(todayStr()) }, lead: { stage: { in: OPEN_STAGES }, deleted_at: null } } });
  return { total: rows.length, open_count: open.count, open_value: open.value, won_value: byStage.won.value, win_rate: decided ? Math.round((byStage.won.count / decided) * 100) : null, follow_ups_due: due, by_stage: byStage, by_trading_type: matrix };
}

async function followUps(orgId, days = 7) {
  const until = new Date(Date.now() + days * 86400000);
  const rows = await prisma.gxLeadActivity.findMany({
    where: { org_id: orgId, follow_up_done: false, follow_up_date: { lte: until }, lead: { stage: { in: OPEN_STAGES }, deleted_at: null } },
    orderBy: { follow_up_date: 'asc' },
    take: 100,
    include: { lead: { select: { id: true, name: true, code: true, stage: true } } },
  });
  const today = todayStr();
  return rows.map((r) => ({ id: r.id, kind: r.kind, summary: r.summary, follow_up_date: r.follow_up_date, overdue: dayOf(r.follow_up_date) < today, lead: r.lead }));
}

async function get(orgId, id) {
  const lead = await prisma.gxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!lead) return { error: 'not_found' };
  const [decorated] = await decorate(orgId, [lead]);
  const deal = lead.deal_id ? await prisma.gxDeal.findFirst({ where: { id: lead.deal_id, org_id: orgId }, select: { id: true, code: true, name: true, status: true } }) : null;
  return { lead: { ...decorated, deal } };
}

async function create(orgId, actorId, input) {
  const problem = dateProblem(input.expected_start, input.expected_end);
  if (problem) return { error: 'invalid', message: problem };
  const refs = await checkRefs(orgId, input, null);
  if (refs) return refs;
  const { expected_start, expected_end, details, ...rest } = input;
  const lead = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    const m = margin(input, null);
    return tx.gxLead.create({
      data: { org_id: orgId, created_by: actorId, code, ...rest, ...(m !== undefined ? { expected_margin: m } : {}), owner_id: input.owner_id || actorId, expected_start: toDate(expected_start), expected_end: toDate(expected_end), details: details || undefined },
    });
  });
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: lead.id, action: 'create', after: snapshot(lead) });
  return get(orgId, lead.id);
}

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.gxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (isDone(before) && !ctx.isAdmin) return { error: 'lead_closed' };
  const problem = dateProblem(input.expected_start !== undefined ? input.expected_start : dayOf(before.expected_start), input.expected_end !== undefined ? input.expected_end : dayOf(before.expected_end));
  if (problem) return { error: 'invalid', message: problem };
  const refs = await checkRefs(orgId, input, before);
  if (refs) return refs;
  const { expected_start, expected_end, details, ...rest } = input;
  const m = margin(input, before);
  await prisma.gxLead.update({
    where: { id },
    data: {
      ...rest,
      ...(m !== undefined ? { expected_margin: m } : {}),
      ...(expected_start !== undefined ? { expected_start: toDate(expected_start) } : {}),
      ...(expected_end !== undefined ? { expected_end: toDate(expected_end) } : {}),
      ...(details !== undefined ? { details: details === null ? Prisma.DbNull : details } : {}),
    },
  });
  const after = await prisma.gxLead.findUnique({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'update', before: snapshot(before), after: snapshot(after), reason: ctx.reason });
  return get(orgId, id);
}

async function changeStage(orgId, actorId, id, input) {
  const before = await prisma.gxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (isDone(before)) return { error: 'lead_closed' };
  if (input.stage === before.stage) return { error: 'same_stage' };
  if (input.stage === 'dropped' && !input.lost_reason) return { error: 'lost_reason_required' };
  const closing = DONE_STAGES.includes(input.stage);
  await prisma.$transaction([
    prisma.gxLead.update({ where: { id }, data: { stage: input.stage, lost_reason: input.stage === 'dropped' ? input.lost_reason : null, closed_at: closing ? new Date() : null } }),
    prisma.gxLeadActivity.create({ data: { org_id: orgId, lead_id: id, kind: 'note', created_by: actorId, summary: `Stage: ${before.stage} -> ${input.stage}${input.stage === 'dropped' ? ` (${input.lost_reason})` : ''}` } }),
    ...(closing ? [prisma.gxLeadActivity.updateMany({ where: { lead_id: id, follow_up_done: false }, data: { follow_up_done: true } })] : []),
  ]);
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'stage', before: { stage: before.stage }, after: { stage: input.stage }, reason: input.lost_reason || input.reason });
  return get(orgId, id);
}

// Admin-only: a won / closed / dropped lead can be reopened with a reason (the converted deal, if any, stays).
async function reopen(orgId, actorId, id, input) {
  const before = await prisma.gxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (!isDone(before)) return { error: 'not_closed' };
  await prisma.$transaction([
    prisma.gxLead.update({ where: { id }, data: { stage: input.stage, lost_reason: null, closed_at: null } }),
    prisma.gxLeadActivity.create({ data: { org_id: orgId, lead_id: id, kind: 'note', created_by: actorId, summary: `Reopened (${before.stage} -> ${input.stage}): ${input.reason}` } }),
  ]);
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'reopen', before: { stage: before.stage }, after: { stage: input.stage }, reason: input.reason });
  return get(orgId, id);
}

async function remove(orgId, actorId, id) {
  const before = await prisma.gxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.gxLead.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'delete', before: snapshot(before) });
  return { ok: true };
}

async function listActivities(orgId, leadId) {
  if (!(await prisma.gxLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'not_found' };
  const rows = await prisma.gxLeadActivity.findMany({ where: { org_id: orgId, lead_id: leadId }, orderBy: { created_at: 'desc' }, take: 200 });
  const names = await userNames(rows.map((r) => r.created_by));
  return { activities: rows.map((r) => ({ ...r, author: names.get(r.created_by)?.name || null })) };
}

async function addActivity(orgId, actorId, ctx, leadId, input) {
  const lead = await prisma.gxLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null } });
  if (!lead) return { error: 'not_found' };
  if (isDone(lead) && !ctx.isAdmin) return { error: 'lead_closed' };
  if (input.follow_up_date && input.follow_up_date < todayStr()) return { error: 'invalid', message: 'Follow-up date cannot be in the past' };
  const activity = await prisma.gxLeadActivity.create({ data: { org_id: orgId, lead_id: leadId, kind: input.kind, summary: input.summary, follow_up_date: toDate(input.follow_up_date), created_by: actorId } });
  await prisma.gxLead.update({ where: { id: leadId }, data: { updated_at: new Date() } });
  return { activity };
}

async function updateActivity(orgId, ctx, leadId, activityId, input) {
  const lead = await prisma.gxLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null } });
  const activity = lead && (await prisma.gxLeadActivity.findFirst({ where: { id: activityId, lead_id: leadId, org_id: orgId } }));
  if (!activity) return { error: 'not_found' };
  const onlyDone = Object.keys(input).every((k) => k === 'follow_up_done');
  if (!onlyDone && isDone(lead) && !ctx.isAdmin) return { error: 'lead_closed' };
  const data = {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.follow_up_date !== undefined ? { follow_up_date: toDate(input.follow_up_date), ...(input.follow_up_date ? {} : { follow_up_done: false }) } : {}),
    ...(input.follow_up_done !== undefined ? { follow_up_done: Boolean(input.follow_up_done) } : {}),
  };
  if (data.follow_up_done && !(data.follow_up_date ?? activity.follow_up_date)) return { error: 'not_found' };
  return { activity: await prisma.gxLeadActivity.update({ where: { id: activityId }, data }) };
}

async function removeActivity(orgId, ctx, leadId, activityId) {
  const lead = await prisma.gxLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null } });
  const activity = lead && (await prisma.gxLeadActivity.findFirst({ where: { id: activityId, lead_id: leadId, org_id: orgId } }));
  if (!activity) return { error: 'not_found' };
  if (isDone(lead) && !ctx.isAdmin) return { error: 'lead_closed' };
  await prisma.gxLeadActivity.delete({ where: { id: activityId } });
  return { ok: true };
}

module.exports = {
  STAGES, OPEN_STAGES, DONE_STAGES,
  createLeadSchema, updateLeadSchema, stageSchema, reopenSchema, activitySchema, activityUpdateSchema, listQuerySchema,
  list, summary, followUps, get, create, update, changeStage, reopen, remove, listActivities, addActivity, updateActivity, removeActivity,
};
