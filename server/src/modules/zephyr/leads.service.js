const { z } = require('zod');
const prisma = require('../../config/db');
const { userNames } = require('../../lib/vertical');
const { writeAudit } = require('./audit');

const CATEGORIES = ['self_project', 'client_project', 'other'];
const BASES = ['investor', 'customer_deal', 'project_type'];
const OPEN_STAGES = ['new', 'contacted', 'site_visit', 'proposal', 'negotiation'];
const STAGES = [...OPEN_STAGES, 'won', 'lost'];
const KINDS = ['call', 'visit', 'meeting', 'note'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateOnly = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());

const leadFields = {
  name: z.string().trim().min(1).max(200),
  category: z.enum(CATEGORIES),
  self_project_basis: z.preprocess((v) => (v === '' ? null : v), z.enum(BASES).nullable().optional()),
  basis_value: text(200),
  party_id: uuidOrNull,
  contact_name: text(200),
  phone: text(40),
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().email().max(200).nullable().optional()),
  source: text(120),
  location: text(200),
  estimated_value: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e13).nullable().optional()),
  expected_close: dateOnly.optional(),
  owner_id: uuidOrNull,
  notes: text(2000),
};
const createLeadSchema = z.object({ ...leadFields, category: leadFields.category.default('client_project'), stage: z.enum(OPEN_STAGES).default('new') });
const updateLeadSchema = z.object(leadFields).partial();
const stageSchema = z.object({ stage: z.enum(STAGES), lost_reason: text(500), reason: text(500) });
const reopenSchema = z.object({ stage: z.enum(OPEN_STAGES).default('negotiation'), reason: z.string().trim().min(1).max(500) });
const activitySchema = z.object({ kind: z.enum(KINDS).default('note'), summary: z.string().trim().min(1).max(1000), follow_up_date: dateOnly.optional() });
const listQuerySchema = z.object({
  stage: z.enum([...STAGES, 'open', 'closed']).optional(),
  category: z.enum(CATEGORIES).optional(),
  owner_id: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const isClosed = (lead) => lead.stage === 'won' || lead.stage === 'lost';
const snapshot = (l) => ({ name: l.name, stage: l.stage, category: l.category, estimated_value: num(l.estimated_value), owner_id: l.owner_id });

// A self-project lead must say what it is based on, and give the value for that basis.
function basisProblem(lead) {
  if (lead.category !== 'self_project') return null;
  if (!lead.self_project_basis) return 'A self-project lead needs a basis (investor, customer deal or project type)';
  if (!lead.basis_value) return 'Enter the investor, customer deal or project type for this self-project lead';
  return null;
}

async function partyOk(orgId, partyId) {
  if (!partyId) return true;
  return Boolean(await prisma.zxParty.findFirst({ where: { id: partyId, org_id: orgId, deleted_at: null }, select: { id: true } }));
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

async function decorate(orgId, leads) {
  const names = await userNames(leads.map((l) => l.owner_id));
  const partyIds = [...new Set(leads.map((l) => l.party_id).filter(Boolean))];
  const parties = partyIds.length ? await prisma.zxParty.findMany({ where: { id: { in: partyIds }, org_id: orgId }, select: { id: true, name: true } }) : [];
  const partyMap = new Map(parties.map((p) => [p.id, p]));
  const next = leads.length
    ? await prisma.zxLeadActivity.groupBy({
        by: ['lead_id'],
        where: { org_id: orgId, lead_id: { in: leads.map((l) => l.id) }, follow_up_done: false, follow_up_date: { not: null } },
        _min: { follow_up_date: true },
      })
    : [];
  const nextMap = new Map(next.map((n) => [n.lead_id, n._min.follow_up_date]));
  return leads.map((l) => ({
    ...l,
    estimated_value: num(l.estimated_value),
    owner: names.get(l.owner_id) || null,
    party: partyMap.get(l.party_id) || null,
    next_follow_up: isClosed(l) ? null : nextMap.get(l.id) || null,
  }));
}

async function list(orgId, query) {
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(query.stage === 'open' ? { stage: { in: OPEN_STAGES } } : {}),
    ...(query.stage === 'closed' ? { stage: { in: ['won', 'lost'] } } : {}),
    ...(query.stage && !['open', 'closed'].includes(query.stage) ? { stage: query.stage } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.owner_id ? { owner_id: query.owner_id } : {}),
    ...(query.q ? { OR: ['name', 'contact_name', 'location', 'source'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) } : {}),
  };
  const rows = await prisma.zxLead.findMany({ where, orderBy: [{ updated_at: 'desc' }], take: query.limit });
  return decorate(orgId, rows);
}

async function summary(orgId) {
  const rows = await prisma.zxLead.findMany({ where: { org_id: orgId, deleted_at: null }, select: { stage: true, estimated_value: true } });
  const byStage = Object.fromEntries(STAGES.map((s) => [s, { count: 0, value: 0 }]));
  for (const r of rows) {
    byStage[r.stage].count += 1;
    byStage[r.stage].value += num(r.estimated_value) || 0;
  }
  const open = OPEN_STAGES.reduce((a, s) => ({ count: a.count + byStage[s].count, value: a.value + byStage[s].value }), { count: 0, value: 0 });
  const decided = byStage.won.count + byStage.lost.count;
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
  };
}

async function followUps(orgId, days = 7) {
  const until = new Date(Date.now() + days * 86400000);
  const rows = await prisma.zxLeadActivity.findMany({
    where: { org_id: orgId, follow_up_done: false, follow_up_date: { lte: until }, lead: { stage: { in: OPEN_STAGES }, deleted_at: null } },
    orderBy: { follow_up_date: 'asc' },
    take: 100,
    include: { lead: { select: { id: true, name: true, stage: true, owner_id: true } } },
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

async function create(orgId, actorId, input) {
  const merged = { ...input };
  if (merged.category !== 'self_project') {
    merged.self_project_basis = null;
    merged.basis_value = null;
  }
  const problem = basisProblem(merged);
  if (problem) return { error: 'invalid', message: problem };
  if (!(await partyOk(orgId, merged.party_id))) return { error: 'party_not_found' };
  if (!(await ownerOk(orgId, merged.owner_id))) return { error: 'owner_invalid' };
  const { expected_close, ...rest } = merged;
  const lead = await prisma.zxLead.create({
    data: { org_id: orgId, created_by: actorId, ...rest, owner_id: merged.owner_id || actorId, expected_close: toDate(expected_close) },
  });
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: lead.id, action: 'create', after: snapshot(lead) });
  return get(orgId, lead.id);
}

async function update(orgId, actorId, id, input) {
  const before = await prisma.zxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (isClosed(before)) return { error: 'lead_closed' };
  const merged = { ...before, ...input };
  if (merged.category !== 'self_project') {
    merged.self_project_basis = null;
    merged.basis_value = null;
  } else if (input.self_project_basis && input.basis_value === undefined && input.self_project_basis !== before.self_project_basis) {
    merged.basis_value = null;
  }
  const problem = basisProblem(merged);
  if (problem) return { error: 'invalid', message: problem };
  if (input.party_id && !(await partyOk(orgId, input.party_id))) return { error: 'party_not_found' };
  if (input.owner_id && input.owner_id !== before.owner_id && !(await ownerOk(orgId, input.owner_id))) return { error: 'owner_invalid' };
  const { expected_close, ...rest } = input;
  const data = {
    ...rest,
    ...(merged.category !== 'self_project' ? { self_project_basis: null, basis_value: null } : {}),
    ...(merged.category === 'self_project' && merged.basis_value !== before.basis_value ? { basis_value: merged.basis_value } : {}),
    ...(expected_close !== undefined ? { expected_close: toDate(expected_close) } : {}),
  };
  await prisma.zxLead.update({ where: { id }, data });
  const after = await prisma.zxLead.findUnique({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'update', before: snapshot(before), after: snapshot(after) });
  return get(orgId, id);
}

async function changeStage(orgId, actorId, id, input) {
  const before = await prisma.zxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (isClosed(before)) return { error: 'lead_closed' };
  if (input.stage === before.stage) return { error: 'same_stage' };
  if (input.stage === 'lost' && !input.lost_reason) return { error: 'lost_reason_required' };
  if (input.stage === 'won') {
    const problem = basisProblem(before);
    if (problem) return { error: 'invalid', message: problem };
  }
  const closing = input.stage === 'won' || input.stage === 'lost';
  await prisma.$transaction([
    prisma.zxLead.update({
      where: { id },
      data: { stage: input.stage, lost_reason: input.stage === 'lost' ? input.lost_reason : null, closed_at: closing ? new Date() : null },
    }),
    prisma.zxLeadActivity.create({
      data: {
        org_id: orgId,
        lead_id: id,
        kind: 'note',
        created_by: actorId,
        summary: `Stage: ${before.stage} -> ${input.stage}${input.stage === 'lost' ? ` (${input.lost_reason})` : ''}`,
      },
    }),
    // closing a lead clears its pending follow-ups
    ...(closing ? [prisma.zxLeadActivity.updateMany({ where: { lead_id: id, follow_up_done: false }, data: { follow_up_done: true } })] : []),
  ]);
  await writeAudit(null, { orgId, actorId, entity: 'lead', entityId: id, action: 'stage', before: { stage: before.stage }, after: { stage: input.stage }, reason: input.lost_reason || input.reason });
  return get(orgId, id);
}

// Admin-only: a won / lost lead can be reopened, with a reason on the audit trail.
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
  STAGES, OPEN_STAGES,
  createLeadSchema, updateLeadSchema, stageSchema, reopenSchema, activitySchema, listQuerySchema,
  ownerOk, listOwners, list, summary, followUps, get, create, update, changeStage, reopen, remove, listActivities, addActivity, setFollowUpDone,
};
