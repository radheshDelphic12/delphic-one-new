const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const prisma = require('../../config/db');
const { userNames } = require('../../lib/vertical');
const { writeAudit } = require('./audit');
const { SERVICE_KEYS } = require('./serviceTypes');

// Pipeline: new -> in_discussion -> negotiation -> won. A lead can be parked (on_hold) or end as
// closed (no deal, no reason needed) or dropped (needs a reason). Won / closed / dropped are locked
// until an admin reopens them.
const OPEN_STAGES = ['new', 'in_discussion', 'negotiation', 'on_hold'];
const DONE_STAGES = ['won', 'closed', 'dropped'];
const STAGES = ['new', 'in_discussion', 'negotiation', 'won', 'closed', 'dropped', 'on_hold'];
const KINDS = ['call', 'visit', 'meeting', 'note'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateOnly = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const money = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e13).nullable().optional());
// Free-form deal facts: every deal differs, so nothing here is mandatory.
const detailsSchema = z
  .array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(500) }))
  .max(40)
  .nullable()
  .optional();

const leadFields = {
  name: z.string().trim().min(1).max(200),
  service_type: z.enum(SERVICE_KEYS),
  company: text(200),
  party_id: uuidOrNull,
  contact_name: text(200),
  phone: text(40),
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().email().max(200).nullable().optional()),
  address: text(500),
  city: text(120),
  state: text(120),
  location: text(200),
  source: text(120),
  owner_id: uuidOrNull,
  assignee_id: uuidOrNull,
  contractor_id: uuidOrNull,
  estimated_value: money,
  expected_profit: money,
  expected_start: dateOnly.optional(),
  expected_end: dateOnly.optional(),
  property_ref: text(200),
  description: text(4000),
  notes: text(2000),
  details: detailsSchema,
};
const createLeadSchema = z.object({ ...leadFields, stage: z.enum(OPEN_STAGES).default('new') });
const updateLeadSchema = z.object(leadFields).partial();
const stageSchema = z.object({ stage: z.enum(STAGES), lost_reason: text(500), reason: text(500) });
const reopenSchema = z.object({ stage: z.enum(OPEN_STAGES).default('negotiation'), reason: z.string().trim().min(1).max(500) });
const activitySchema = z.object({ kind: z.enum(KINDS).default('note'), summary: z.string().trim().min(1).max(1000), follow_up_date: dateOnly.optional() });
const listQuerySchema = z.object({
  stage: z.enum([...STAGES, 'open', 'closed']).optional(),
  service_type: z.enum(SERVICE_KEYS).optional(),
  owner_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
  contractor_id: z.string().uuid().optional(),
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
const isClosed = (lead) => DONE_STAGES.includes(lead.stage);
const snapshot = (l) => ({ code: l.code, name: l.name, stage: l.stage, service_type: l.service_type, estimated_value: num(l.estimated_value), owner_id: l.owner_id, assignee_id: l.assignee_id, contractor_id: l.contractor_id });

async function partyOk(orgId, partyId) {
  if (!partyId) return true;
  return Boolean(await prisma.zxParty.findFirst({ where: { id: partyId, org_id: orgId, deleted_at: null }, select: { id: true } }));
}

// The assigned employee / contractor are Zephyr roster people of the matching kind.
async function personOk(orgId, personId, kind) {
  if (!personId) return true;
  return Boolean(await prisma.zxPerson.findFirst({ where: { id: personId, org_id: orgId, kind, active: true, deleted_at: null }, select: { id: true } }));
}

// Owners are the people who can run leads: org admins and Zephyr managers with a login.
async function ownerCandidates(orgId) {
  const [admins, managers] = await Promise.all([
    prisma.orgMembership.findMany({ where: { org_id: orgId, role: 'admin' }, select: { person_id: true } }),
    prisma.zxPerson.findMany({ where: { org_id: orgId, access_role: 'manager', active: true, deleted_at: null, user_id: { not: null } }, select: { user_id: true } }),
  ]);
  return new Set([...admins.map((a) => a.person_id), ...managers.map((m) => m.user_id)]);
}

async function listOwners(orgId) {
  const ids = [...(await ownerCandidates(orgId))];
  const names = await userNames(ids);
  return ids.map((id) => names.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

async function ownerOk(orgId, ownerId) {
  return !ownerId || (await ownerCandidates(orgId)).has(ownerId);
}

function dateProblem(start, end) {
  return start && end && end < start ? 'Expected end date cannot be before the start date' : null;
}

async function nextCode(tx, orgId) {
  await tx.zxSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  const s = await tx.zxSetting.update({ where: { org_id: orgId }, data: { lead_seq: { increment: 1 } } });
  return `${s.lead_prefix}-${String(s.lead_seq).padStart(4, '0')}`;
}

async function decorate(orgId, leads) {
  const names = await userNames(leads.map((l) => l.owner_id));
  const partyIds = [...new Set(leads.map((l) => l.party_id).filter(Boolean))];
  const personIds = [...new Set(leads.flatMap((l) => [l.assignee_id, l.contractor_id]).filter(Boolean))];
  const [parties, people] = await Promise.all([
    partyIds.length ? prisma.zxParty.findMany({ where: { id: { in: partyIds }, org_id: orgId }, select: { id: true, name: true } }) : [],
    personIds.length ? prisma.zxPerson.findMany({ where: { id: { in: personIds }, org_id: orgId }, select: { id: true, name: true } }) : [],
  ]);
  const partyMap = new Map(parties.map((p) => [p.id, p]));
  const personMap = new Map(people.map((p) => [p.id, p]));
  const next = leads.length
    ? await prisma.zxLeadActivity.groupBy({
        by: ['lead_id'],
        where: { org_id: orgId, lead_id: { in: leads.map((l) => l.id) }, follow_up_done: false, follow_up_date: { not: null } },
        _min: { follow_up_date: true },
      })
    : [];
  const nextMap = new Map(next.map((n) => [n.lead_id, n._min.follow_up_date]));
  return leads.map((l) => {
    const value = num(l.estimated_value);
    const profit = num(l.expected_profit);
    return {
      ...l,
      estimated_value: value,
      expected_profit: profit,
      expected_margin_pct: value && profit !== null ? Math.round((profit / value) * 1000) / 10 : null,
      owner: names.get(l.owner_id) || null,
      party: partyMap.get(l.party_id) || null,
      assignee: personMap.get(l.assignee_id) || null,
      contractor: personMap.get(l.contractor_id) || null,
      next_follow_up: isClosed(l) ? null : nextMap.get(l.id) || null,
    };
  });
}

async function list(orgId, query) {
  const created = {};
  if (query.from) created.gte = toDate(query.from);
  if (query.to) created.lte = new Date(`${query.to}T23:59:59.999Z`);
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(query.stage === 'open' ? { stage: { in: OPEN_STAGES } } : {}),
    ...(query.stage === 'closed' ? { stage: { in: DONE_STAGES } } : {}),
    ...(query.stage && !['open', 'closed'].includes(query.stage) ? { stage: query.stage } : {}),
    ...(query.service_type ? { service_type: query.service_type } : {}),
    ...(query.owner_id ? { owner_id: query.owner_id } : {}),
    ...(query.assignee_id ? { assignee_id: query.assignee_id } : {}),
    ...(query.contractor_id ? { contractor_id: query.contractor_id } : {}),
    ...(query.location ? { OR: ['location', 'city', 'address'].map((f) => ({ [f]: { contains: query.location, mode: 'insensitive' } })) } : {}),
    ...(Object.keys(created).length ? { created_at: created } : {}),
    ...(query.q ? { AND: [{ OR: ['name', 'code', 'company', 'contact_name', 'location', 'source'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) }] } : {}),
  };
  const rows = await prisma.zxLead.findMany({ where, orderBy: [{ updated_at: 'desc' }], take: query.limit });
  return decorate(orgId, rows);
}

async function summary(orgId) {
  const rows = await prisma.zxLead.findMany({ where: { org_id: orgId, deleted_at: null }, select: { stage: true, service_type: true, estimated_value: true } });
  const blank = () => ({ count: 0, value: 0 });
  const byStage = Object.fromEntries(STAGES.map((s) => [s, blank()]));
  const byService = Object.fromEntries(SERVICE_KEYS.map((k) => [k, { ...blank(), open: 0, won: 0, by_stage: Object.fromEntries(STAGES.map((s) => [s, 0])) }]));
  for (const r of rows) {
    const value = num(r.estimated_value) || 0;
    byStage[r.stage].count += 1;
    byStage[r.stage].value += value;
    const svc = byService[r.service_type];
    if (svc) {
      svc.count += 1;
      svc.value += value;
      svc.by_stage[r.stage] += 1;
      if (OPEN_STAGES.includes(r.stage)) svc.open += 1;
      if (r.stage === 'won') svc.won += 1;
    }
  }
  const open = OPEN_STAGES.reduce((a, s) => ({ count: a.count + byStage[s].count, value: a.value + byStage[s].value }), { count: 0, value: 0 });
  const decided = byStage.won.count + byStage.dropped.count;
  const due = await prisma.zxLeadActivity.count({
    where: { org_id: orgId, follow_up_done: false, follow_up_date: { lte: toDate(todayStr()) }, lead: { stage: { in: OPEN_STAGES }, deleted_at: null } },
  });
  return {
    total: rows.length,
    open_count: open.count,
    open_value: open.value,
    won_value: byStage.won.value,
    win_rate: decided ? Math.round((byStage.won.count / decided) * 100) : null,
    follow_ups_due: due,
    by_stage: byStage,
    by_service: byService,
  };
}

async function followUps(orgId, days = 7) {
  const until = new Date(Date.now() + days * 86400000);
  const rows = await prisma.zxLeadActivity.findMany({
    where: { org_id: orgId, follow_up_done: false, follow_up_date: { lte: until }, lead: { stage: { in: OPEN_STAGES }, deleted_at: null } },
    orderBy: { follow_up_date: 'asc' },
    take: 100,
    include: { lead: { select: { id: true, name: true, code: true, stage: true, owner_id: true } } },
  });
  const today = todayStr();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    summary: r.summary,
    follow_up_date: r.follow_up_date,
    overdue: r.follow_up_date.toISOString().slice(0, 10) < today,
    lead: r.lead,
  }));
}

async function get(orgId, id) {
  const lead = await prisma.zxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!lead) return { error: 'not_found' };
  const [decorated] = await decorate(orgId, [lead]);
  return { lead: decorated };
}

async function checkRefs(orgId, input, before) {
  if (input.party_id && input.party_id !== before?.party_id && !(await partyOk(orgId, input.party_id))) return { error: 'party_not_found' };
  if (input.owner_id && input.owner_id !== before?.owner_id && !(await ownerOk(orgId, input.owner_id))) return { error: 'owner_invalid' };
  if (input.assignee_id && input.assignee_id !== before?.assignee_id && !(await personOk(orgId, input.assignee_id, 'employee'))) return { error: 'invalid', message: 'The assigned employee must be an active employee on the roster' };
  if (input.contractor_id && input.contractor_id !== before?.contractor_id && !(await personOk(orgId, input.contractor_id, 'contractor'))) return { error: 'invalid', message: 'The assigned contractor must be an active contractor on the roster' };
  return null;
}

async function create(orgId, actorId, input) {
  const problem = dateProblem(input.expected_start, input.expected_end);
  if (problem) return { error: 'invalid', message: problem };
  const refs = await checkRefs(orgId, input, null);
  if (refs) return refs;
  const { expected_start, expected_end, details, ...rest } = input;
  const lead = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    return tx.zxLead.create({
      data: { org_id: orgId, created_by: actorId, code, ...rest, owner_id: input.owner_id || actorId, expected_start: toDate(expected_start), expected_end: toDate(expected_end), details: details || undefined },
    });
  });
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: lead.id, action: 'create', after: snapshot(lead) });
  return get(orgId, lead.id);
}

async function update(orgId, actorId, id, input) {
  const before = await prisma.zxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (isClosed(before)) return { error: 'lead_closed' };
  const problem = dateProblem(input.expected_start !== undefined ? input.expected_start : dayOf(before.expected_start), input.expected_end !== undefined ? input.expected_end : dayOf(before.expected_end));
  if (problem) return { error: 'invalid', message: problem };
  const refs = await checkRefs(orgId, input, before);
  if (refs) return refs;
  const { expected_start, expected_end, details, ...rest } = input;
  await prisma.zxLead.update({
    where: { id },
    data: {
      ...rest,
      ...(expected_start !== undefined ? { expected_start: toDate(expected_start) } : {}),
      ...(expected_end !== undefined ? { expected_end: toDate(expected_end) } : {}),
      ...(details !== undefined ? { details: details === null ? Prisma.DbNull : details } : {}),
    },
  });
  const after = await prisma.zxLead.findUnique({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'update', before: snapshot(before), after: snapshot(after) });
  return get(orgId, id);
}

async function changeStage(orgId, actorId, id, input) {
  const before = await prisma.zxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (isClosed(before)) return { error: 'lead_closed' };
  if (input.stage === before.stage) return { error: 'same_stage' };
  if (input.stage === 'dropped' && !input.lost_reason) return { error: 'lost_reason_required' };
  if (input.stage === 'won' && !before.service_type) return { error: 'invalid', message: 'Choose the service type before marking the lead won' };
  const closing = DONE_STAGES.includes(input.stage);
  await prisma.$transaction([
    prisma.zxLead.update({
      where: { id },
      data: { stage: input.stage, lost_reason: input.stage === 'dropped' ? input.lost_reason : null, closed_at: closing ? new Date() : null },
    }),
    prisma.zxLeadActivity.create({
      data: {
        org_id: orgId,
        lead_id: id,
        kind: 'note',
        created_by: actorId,
        summary: `Stage: ${before.stage} -> ${input.stage}${input.stage === 'dropped' ? ` (${input.lost_reason})` : ''}`,
      },
    }),
    // closing a lead clears its pending follow-ups
    ...(closing ? [prisma.zxLeadActivity.updateMany({ where: { lead_id: id, follow_up_done: false }, data: { follow_up_done: true } })] : []),
  ]);
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'stage', before: { stage: before.stage }, after: { stage: input.stage }, reason: input.lost_reason || input.reason });
  return get(orgId, id);
}

// Admin-only: a won / closed / dropped lead can be reopened, with a reason on the audit trail.
async function reopen(orgId, actorId, id, input) {
  const before = await prisma.zxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (!isClosed(before)) return { error: 'not_closed' };
  if (before.project_id) return { error: 'has_project' };
  await prisma.$transaction([
    prisma.zxLead.update({ where: { id }, data: { stage: input.stage, lost_reason: null, closed_at: null } }),
    prisma.zxLeadActivity.create({ data: { org_id: orgId, lead_id: id, kind: 'note', created_by: actorId, summary: `Reopened (${before.stage} -> ${input.stage}): ${input.reason}` } }),
  ]);
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'reopen', before: { stage: before.stage }, after: { stage: input.stage }, reason: input.reason });
  return get(orgId, id);
}

async function remove(orgId, actorId, id) {
  const before = await prisma.zxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.zxLead.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'delete', before: snapshot(before) });
  return { ok: true };
}

async function listActivities(orgId, leadId) {
  const lead = await prisma.zxLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null }, select: { id: true } });
  if (!lead) return { error: 'not_found' };
  const rows = await prisma.zxLeadActivity.findMany({ where: { org_id: orgId, lead_id: leadId }, orderBy: { created_at: 'desc' }, take: 200 });
  const names = await userNames(rows.map((r) => r.created_by));
  return { activities: rows.map((r) => ({ ...r, author: names.get(r.created_by)?.name || null })) };
}

async function addActivity(orgId, actorId, leadId, input) {
  const lead = await prisma.zxLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null } });
  if (!lead) return { error: 'not_found' };
  if (isClosed(lead)) return { error: 'lead_closed' };
  if (input.follow_up_date && input.follow_up_date < todayStr()) return { error: 'invalid', message: 'Follow-up date cannot be in the past' };
  const activity = await prisma.zxLeadActivity.create({
    data: { org_id: orgId, lead_id: leadId, kind: input.kind, summary: input.summary, follow_up_date: toDate(input.follow_up_date), created_by: actorId },
  });
  await prisma.zxLead.update({ where: { id: leadId }, data: { updated_at: new Date() } });
  return { activity };
}

async function setFollowUpDone(orgId, leadId, activityId, done) {
  const activity = await prisma.zxLeadActivity.findFirst({ where: { id: activityId, lead_id: leadId, org_id: orgId } });
  if (!activity || !activity.follow_up_date) return { error: 'not_found' };
  return { activity: await prisma.zxLeadActivity.update({ where: { id: activityId }, data: { follow_up_done: Boolean(done) } }) };
}

module.exports = {
  STAGES, OPEN_STAGES, DONE_STAGES,
  createLeadSchema, updateLeadSchema, stageSchema, reopenSchema, activitySchema, listQuerySchema,
  ownerOk, personOk, listOwners, list, summary, followUps, get, create, update, changeStage, reopen, remove, listActivities, addActivity, setFollowUpDone,
};
