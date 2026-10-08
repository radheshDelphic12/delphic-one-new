const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const prisma = require('../../config/db');
const { userNames } = require('../../lib/vertical');
const { writeAudit } = require('./audit');
const { SERVICE_KEYS, SERVICE_TYPES } = require('./serviceTypes');
const people = require('./people.service');
const parties = require('./parties.service');

// Pipeline: new -> in_discussion -> qualification -> proposal -> negotiation -> won. A lead can be parked
// (on_hold) or end as closed / dropped. Won / closed / dropped are locked until an admin reopens them
// (an admin may also edit a finished lead in place).
const OPEN_STAGES = ['new', 'in_discussion', 'qualification', 'proposal', 'negotiation', 'on_hold'];
const DONE_STAGES = ['won', 'closed', 'dropped'];
const STAGES = ['new', 'in_discussion', 'qualification', 'proposal', 'negotiation', 'won', 'dropped', 'on_hold', 'closed'];
const KINDS = ['call', 'visit', 'meeting', 'note'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateOnly = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const money = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e13).nullable().optional());
// Free-form deal facts: every deal differs, so nothing here is mandatory.
const detailsSchema = z.array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(500) })).max(40).nullable().optional();

const leadFields = {
  name: z.string().trim().min(1).max(200),
  service_type: z.enum(SERVICE_KEYS),
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
  company_name: text(200),
  expected_amount: money,
  expected_revenue: money,
  expected_profit: money,
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
  service_type: z.enum(SERVICE_KEYS).optional(),
  party_id: z.string().uuid().optional(),
  contractor_id: z.string().uuid().optional(),
  source: z.string().trim().max(120).optional(),
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
const snapshot = (l) => ({ code: l.code, name: l.name, stage: l.stage, service_type: l.service_type, expected_amount: num(l.expected_amount), expected_revenue: num(l.expected_revenue), expected_profit: num(l.expected_profit), party_id: l.party_id, assignee_id: l.assignee_id })

async function nextCode(tx, orgId) {
  await tx.axSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  const s = await tx.axSetting.update({ where: { org_id: orgId }, data: { lead_seq: { increment: 1 } } });
  return `${s.lead_prefix}-${String(s.lead_seq).padStart(4, '0')}`;
}

function dateProblem(start, end) {
  return start && end && end < start ? 'Expected completion cannot be before the start date' : null;
}

async function checkRefs(orgId, input, before) {
  if (input.party_id && input.party_id !== before?.party_id && !(await parties.partyOk(orgId, input.party_id, 'client'))) return { error: 'party_not_found' };
  if (input.owner_id && input.owner_id !== before?.owner_id && !(await people.ownerOk(orgId, input.owner_id))) return { error: 'owner_invalid' };
  if (input.assignee_id && input.assignee_id !== before?.assignee_id && !(await people.personOk(orgId, input.assignee_id, 'employee'))) return { error: 'invalid', message: 'The assigned employee must be an active employee on the roster' };
  if (input.contractor_id && input.contractor_id !== before?.contractor_id && !(await people.personOk(orgId, input.contractor_id, 'contractor'))) return { error: 'invalid', message: 'The assigned contractor must be an active contractor on the roster' };
  return null;
}

async function decorate(orgId, leads) {
  const names = await userNames(leads.map((l) => l.owner_id));
  const { people: pm, parties: am } = await people.nameMap(orgId, leads.flatMap((l) => [l.assignee_id, l.contractor_id]), leads.flatMap((l) => [l.party_id]));
  const next = leads.length
    ? await prisma.axLeadActivity.groupBy({ by: ['lead_id'], where: { org_id: orgId, lead_id: { in: leads.map((l) => l.id) }, follow_up_done: false, follow_up_date: { not: null } }, _min: { follow_up_date: true } })
    : [];
  const nextMap = new Map(next.map((n) => [n.lead_id, n._min.follow_up_date]));
  return leads.map((l) => ({
    ...l,
    expected_amount: num(l.expected_amount),
    expected_revenue: num(l.expected_revenue),
    expected_profit: num(l.expected_profit),
    service_label: SERVICE_TYPES.find((t) => t.key === l.service_type)?.label || l.service_type,
    owner: names.get(l.owner_id) || null,
    party: am.get(l.party_id) || null,
    assignee: pm.get(l.assignee_id) || null,
    contractor: pm.get(l.contractor_id) || null,
    next_follow_up: isDone(l) ? null : nextMap.get(l.id) || null,
  }));
}

// One where-builder for the list AND the pipeline summary, so counts always agree with the rows behind them.
// scope = { personId } restricts to leads assigned to that person (employee / contractor views).
function whereOf(orgId, query, scope = {}) {
  const created = {};
  if (query.from) created.gte = toDate(query.from);
  if (query.to) created.lte = new Date(`${query.to}T23:59:59.999Z`);
  return {
    org_id: orgId,
    deleted_at: null,
    ...(query.stage === 'open' ? { stage: { in: OPEN_STAGES } } : {}),
    ...(query.stage === 'closed' ? { stage: { in: DONE_STAGES } } : {}),
    ...(query.stage && !['open', 'closed'].includes(query.stage) ? { stage: query.stage } : {}),
    ...(query.service_type ? { service_type: query.service_type } : {}),
    ...(query.party_id ? { party_id: query.party_id } : {}),
    ...(query.owner_id ? { owner_id: query.owner_id } : {}),
    ...(query.contractor_id ? { contractor_id: query.contractor_id } : {}),
    ...(query.source ? { source: { equals: query.source, mode: 'insensitive' } } : {}),
    ...(Object.keys(created).length ? { created_at: created } : {}),
    AND: [
      ...(query.assignee_id ? [{ OR: [{ assignee_id: query.assignee_id }, { contractor_id: query.assignee_id }] }] : []),
      ...(scope.personId ? [{ OR: [{ assignee_id: scope.personId }, { contractor_id: scope.personId }] }] : []),
      ...(query.location ? [{ location: { contains: query.location, mode: 'insensitive' } }] : []),
      ...(query.q ? [{ OR: ['name', 'code', 'contact_name', 'company_name', 'location', 'source'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) }] : []),
    ],
  };
}

async function list(orgId, query, scope = {}) {
  return decorate(orgId, await prisma.axLead.findMany({ where: whereOf(orgId, query, scope), orderBy: [{ updated_at: 'desc' }], take: query.limit }));
}

// Pipeline counts, plus the service x stage matrix. Takes the same filters as the list (stage included, so a
// stage filter narrows the matrix to that stage).
async function summary(orgId, query = {}, scope = {}) {
  const rows = await prisma.axLead.findMany({ where: whereOf(orgId, query, scope), select: { stage: true, service_type: true, expected_amount: true } });
  const emptyStages = () => Object.fromEntries(STAGES.map((s) => [s, 0]));
  const byStage = Object.fromEntries(STAGES.map((s) => [s, { count: 0, value: 0 }]));
  const matrix = Object.fromEntries(SERVICE_TYPES.map((t) => [t.key, { label: t.label, total: 0, by_stage: emptyStages() }]));
  for (const r of rows) {
    const value = num(r.expected_amount) || 0;
    byStage[r.stage].count += 1;
    byStage[r.stage].value += value;
    matrix[r.service_type].total += 1;
    matrix[r.service_type].by_stage[r.stage] += 1;
  }
  const open = OPEN_STAGES.reduce((a, st) => ({ count: a.count + byStage[st].count, value: a.value + byStage[st].value }), { count: 0, value: 0 });
  const decided = byStage.won.count + byStage.dropped.count;
  // Conversion: won leads that have become a deal, as a share of won leads.
  const due = await prisma.axLeadActivity.count({ where: { org_id: orgId, follow_up_done: false, follow_up_date: { lte: toDate(todayStr()) }, lead: { ...whereOf(orgId, { ...query, stage: undefined }, scope), stage: { in: OPEN_STAGES } } } });
  return { total: rows.length, open_count: open.count, open_value: open.value, won_value: byStage.won.value, win_rate: decided ? Math.round((byStage.won.count / decided) * 100) : null, follow_ups_due: due, by_stage: byStage, by_service_type: matrix };
}

async function followUps(orgId, days = 7) {
  const until = new Date(Date.now() + days * 86400000);
  const rows = await prisma.axLeadActivity.findMany({
    where: { org_id: orgId, follow_up_done: false, follow_up_date: { lte: until }, lead: { stage: { in: OPEN_STAGES }, deleted_at: null } },
    orderBy: { follow_up_date: 'asc' },
    take: 100,
    include: { lead: { select: { id: true, name: true, code: true, stage: true } } },
  });
  const today = todayStr();
  return rows.map((r) => ({ id: r.id, kind: r.kind, summary: r.summary, follow_up_date: r.follow_up_date, overdue: dayOf(r.follow_up_date) < today, lead: r.lead }));
}

async function get(orgId, id) {
  const lead = await prisma.axLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!lead) return { error: 'not_found' };
  const [decorated] = await decorate(orgId, [lead]);
  const deal = lead.deal_id ? await prisma.axDeal.findFirst({ where: { id: lead.deal_id, org_id: orgId }, select: { id: true, code: true, name: true, status: true } }) : null;
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
    return tx.axLead.create({
      data: { org_id: orgId, created_by: actorId, code, ...rest, owner_id: input.owner_id || actorId, expected_start: toDate(expected_start), expected_end: toDate(expected_end), details: details || undefined },
    });
  });
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: lead.id, action: 'create', after: snapshot(lead) });
  return get(orgId, lead.id);
}

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.axLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (isDone(before) && !ctx.isAdmin) return { error: 'lead_closed' };
  const problem = dateProblem(input.expected_start !== undefined ? input.expected_start : dayOf(before.expected_start), input.expected_end !== undefined ? input.expected_end : dayOf(before.expected_end));
  if (problem) return { error: 'invalid', message: problem };
  const refs = await checkRefs(orgId, input, before);
  if (refs) return refs;
  const { expected_start, expected_end, details, ...rest } = input;
  await prisma.axLead.update({
    where: { id },
    data: {
      ...rest,
     
      ...(expected_start !== undefined ? { expected_start: toDate(expected_start) } : {}),
      ...(expected_end !== undefined ? { expected_end: toDate(expected_end) } : {}),
      ...(details !== undefined ? { details: details === null ? Prisma.DbNull : details } : {}),
    },
  });
  const after = await prisma.axLead.findUnique({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'update', before: snapshot(before), after: snapshot(after), reason: ctx.reason });
  return get(orgId, id);
}

async function changeStage(orgId, actorId, id, input) {
  const before = await prisma.axLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (isDone(before)) return { error: 'lead_closed' };
  if (input.stage === before.stage) return { error: 'same_stage' };
  if (input.stage === 'dropped' && !input.lost_reason) return { error: 'lost_reason_required' };
  const closing = DONE_STAGES.includes(input.stage);
  await prisma.$transaction([
    prisma.axLead.update({ where: { id }, data: { stage: input.stage, lost_reason: input.stage === 'dropped' ? input.lost_reason : null, closed_at: closing ? new Date() : null } }),
    prisma.axLeadActivity.create({ data: { org_id: orgId, lead_id: id, kind: 'note', created_by: actorId, summary: `Stage: ${before.stage} -> ${input.stage}${input.stage === 'dropped' ? ` (${input.lost_reason})` : ''}` } }),
    ...(closing ? [prisma.axLeadActivity.updateMany({ where: { lead_id: id, follow_up_done: false }, data: { follow_up_done: true } })] : []),
  ]);
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'stage', before: { stage: before.stage }, after: { stage: input.stage }, reason: input.lost_reason || input.reason });
  return get(orgId, id);
}

// Admin-only: a won / closed / dropped lead can be reopened with a reason (the converted deal, if any, stays).
async function reopen(orgId, actorId, id, input) {
  const before = await prisma.axLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (!isDone(before)) return { error: 'not_closed' };
  await prisma.$transaction([
    prisma.axLead.update({ where: { id }, data: { stage: input.stage, lost_reason: null, closed_at: null } }),
    prisma.axLeadActivity.create({ data: { org_id: orgId, lead_id: id, kind: 'note', created_by: actorId, summary: `Reopened (${before.stage} -> ${input.stage}): ${input.reason}` } }),
  ]);
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'reopen', before: { stage: before.stage }, after: { stage: input.stage }, reason: input.reason });
  return get(orgId, id);
}

async function remove(orgId, actorId, id) {
  const before = await prisma.axLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.axLead.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'delete', before: snapshot(before) });
  return { ok: true };
}

async function listActivities(orgId, leadId) {
  if (!(await prisma.axLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'not_found' };
  const rows = await prisma.axLeadActivity.findMany({ where: { org_id: orgId, lead_id: leadId }, orderBy: { created_at: 'desc' }, take: 200 });
  const names = await userNames(rows.map((r) => r.created_by));
  return { activities: rows.map((r) => ({ ...r, author: names.get(r.created_by)?.name || null })) };
}

async function addActivity(orgId, actorId, ctx, leadId, input) {
  const lead = await prisma.axLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null } });
  if (!lead) return { error: 'not_found' };
  if (isDone(lead) && !ctx.isAdmin) return { error: 'lead_closed' };
  if (input.follow_up_date && input.follow_up_date < todayStr()) return { error: 'invalid', message: 'Follow-up date cannot be in the past' };
  const activity = await prisma.axLeadActivity.create({ data: { org_id: orgId, lead_id: leadId, kind: input.kind, summary: input.summary, follow_up_date: toDate(input.follow_up_date), created_by: actorId } });
  await prisma.axLead.update({ where: { id: leadId }, data: { updated_at: new Date() } });
  return { activity };
}

async function updateActivity(orgId, ctx, leadId, activityId, input) {
  const lead = await prisma.axLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null } });
  const activity = lead && (await prisma.axLeadActivity.findFirst({ where: { id: activityId, lead_id: leadId, org_id: orgId } }));
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
  return { activity: await prisma.axLeadActivity.update({ where: { id: activityId }, data }) };
}

async function removeActivity(orgId, ctx, leadId, activityId) {
  const lead = await prisma.axLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null } });
  const activity = lead && (await prisma.axLeadActivity.findFirst({ where: { id: activityId, lead_id: leadId, org_id: orgId } }));
  if (!activity) return { error: 'not_found' };
  if (isDone(lead) && !ctx.isAdmin) return { error: 'lead_closed' };
  await prisma.axLeadActivity.delete({ where: { id: activityId } });
  return { ok: true };
}

module.exports = {
  STAGES, OPEN_STAGES, DONE_STAGES,
  createLeadSchema, updateLeadSchema, stageSchema, reopenSchema, activitySchema, activityUpdateSchema, listQuerySchema,
  whereOf, decorate, list, summary, followUps, get, create, update, changeStage, reopen, remove, listActivities, addActivity, updateActivity, removeActivity,
};
