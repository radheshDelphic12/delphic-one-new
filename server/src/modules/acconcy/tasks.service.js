const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const people = require('./people.service');
const parties = require('./parties.service');
const { dayOf } = require('./deal.calc');

const STATUSES = ['pending', 'in_progress', 'done', 'cancelled'];
const OPEN = ['pending', 'in_progress'];
const PRIORITIES = ['low', 'medium', 'high'];
// Task types from the Acconcy brief; free text is also accepted (admin-editable by just typing a new one).
const TYPES = ['client_meeting', 'financial_analysis', 'investment_research', 'due_diligence', 'valuation_analysis', 'transaction_documentation', 'client_follow_up', 'vendor_coordination', 'investment_monitoring', 'other'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateOnly = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());

const taskFields = {
  title: z.string().trim().min(1).max(200),
  task_type: z.string().trim().min(1).max(60),
  deal_id: uuidOrNull,
  lead_id: uuidOrNull,
  party_id: uuidOrNull,
  assignee_id: uuidOrNull,
  contractor_id: uuidOrNull,
  due_date: dateOnly.optional(),
  priority: z.enum(PRIORITIES),
  status: z.enum(STATUSES),
  completed_on: dateOnly.optional(),
  description: text(4000),
  notes: text(2000),
};
const createTaskSchema = z.object({ ...taskFields, task_type: taskFields.task_type.default('other'), priority: taskFields.priority.default('medium'), status: taskFields.status.default('pending') });
const updateTaskSchema = z.object(taskFields).partial();
const listQuerySchema = z.object({
  status: z.enum([...STATUSES, 'open', 'overdue']).optional(),
  deal_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
  contractor_id: z.string().uuid().optional(),
  priority: z.enum(PRIORITIES).optional(),
  q: z.string().trim().max(100).optional(),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const snap = (t) => ({ code: t.code, title: t.title, status: t.status, due_date: dayOf(t.due_date), assignee_id: t.assignee_id, contractor_id: t.contractor_id, deal_id: t.deal_id });

async function nextCode(tx, orgId) {
  await tx.axSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  const s = await tx.axSetting.update({ where: { org_id: orgId }, data: { task_seq: { increment: 1 } } });
  return `${s.task_prefix}-${String(s.task_seq).padStart(4, '0')}`;
}

async function checkRefs(orgId, input) {
  if (input.deal_id && !(await prisma.axDeal.findFirst({ where: { id: input.deal_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'deal_not_found' };
  if (input.lead_id && !(await prisma.axLead.findFirst({ where: { id: input.lead_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'invalid', message: 'Lead not found' };
  if (input.party_id && !(await parties.partyOk(orgId, input.party_id))) return { error: 'party_not_found' };
  if (input.assignee_id && !(await people.personOk(orgId, input.assignee_id, 'employee'))) return { error: 'invalid', message: 'The assignee must be an active employee on the roster' };
  if (input.contractor_id && !(await people.personOk(orgId, input.contractor_id, 'contractor'))) return { error: 'invalid', message: 'The contractor must be an active contractor on the roster' };
  return null;
}

async function decorate(orgId, tasks) {
  const { people: pm, parties: am } = await people.nameMap(orgId, tasks.flatMap((t) => [t.assignee_id, t.contractor_id]), tasks.map((t) => t.party_id));
  const dealIds = [...new Set(tasks.map((t) => t.deal_id).filter(Boolean))];
  const deals = dealIds.length ? await prisma.axDeal.findMany({ where: { id: { in: dealIds }, org_id: orgId }, select: { id: true, code: true, name: true } }) : [];
  const dm = new Map(deals.map((d) => [d.id, d]));
  const t0 = dayOf(new Date());
  return tasks.map((t) => ({
    ...t,
    deal: dm.get(t.deal_id) || null,
    party: am.get(t.party_id) || null,
    assignee: pm.get(t.assignee_id) || null,
    contractor: pm.get(t.contractor_id) || null,
    overdue: OPEN.includes(t.status) && t.due_date && dayOf(t.due_date) < t0,
  }));
}

// scope = { personId } restricts to tasks assigned to that person.
async function list(orgId, query, scope = {}) {
  const t0 = toDate(dayOf(new Date()));
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(query.status === 'open' ? { status: { in: OPEN } } : {}),
    ...(query.status === 'overdue' ? { status: { in: OPEN }, due_date: { lt: t0 } } : {}),
    ...(query.status && !['open', 'overdue'].includes(query.status) ? { status: query.status } : {}),
    ...(query.deal_id ? { deal_id: query.deal_id } : {}),
    ...(query.assignee_id ? { assignee_id: query.assignee_id } : {}),
    ...(query.contractor_id ? { contractor_id: query.contractor_id } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(scope.personId ? { OR: [{ assignee_id: scope.personId }, { contractor_id: scope.personId }] } : {}),
    ...(query.q ? { AND: [{ OR: ['title', 'code', 'description'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) }] } : {}),
  };
  return decorate(orgId, await prisma.axTask.findMany({ where, orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'desc' }], take: 500 }));
}

async function get(orgId, id, scope = {}) {
  const task = await prisma.axTask.findFirst({
    where: { id, org_id: orgId, deleted_at: null, ...(scope.personId ? { OR: [{ assignee_id: scope.personId }, { contractor_id: scope.personId }] } : {}) },
  });
  if (!task) return { error: 'not_found' };
  return { task: (await decorate(orgId, [task]))[0] };
}

async function create(orgId, actorId, input) {
  const bad = await checkRefs(orgId, input);
  if (bad) return bad;
  const { due_date, completed_on, ...rest } = input;
  const task = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    return tx.axTask.create({ data: { org_id: orgId, created_by: actorId, code, ...rest, due_date: toDate(due_date), completed_on: rest.status === 'done' ? toDate(completed_on || dayOf(new Date())) : null } });
  });
  await writeAudit(null, { orgId, actorId, entity: 'task', entityId: task.id, action: 'create', after: snap(task) });
  return get(orgId, task.id);
}

// A person may only move the status of a task assigned to them (scope); full edits need tasksAll.
async function update(orgId, actorId, id, input, scope = {}) {
  const before = await prisma.axTask.findFirst({
    where: { id, org_id: orgId, deleted_at: null, ...(scope.personId ? { OR: [{ assignee_id: scope.personId }, { contractor_id: scope.personId }] } : {}) },
  });
  if (!before) return { error: 'not_found' };
  if (scope.personId && Object.keys(input).some((k) => !['status', 'notes', 'completed_on'].includes(k))) return { error: 'own_status_only' };
  const bad = await checkRefs(orgId, { ...input, assignee_id: input.assignee_id !== before.assignee_id ? input.assignee_id : undefined, contractor_id: input.contractor_id !== before.contractor_id ? input.contractor_id : undefined });
  if (bad) return bad;
  const { due_date, completed_on, ...rest } = input;
  const data = { ...rest, ...(due_date !== undefined ? { due_date: toDate(due_date) } : {}) };
  if (input.status === 'done' && before.status !== 'done') data.completed_on = toDate(completed_on || dayOf(new Date()));
  else if (input.status && input.status !== 'done') data.completed_on = null;
  else if (completed_on !== undefined) data.completed_on = toDate(completed_on);
  const task = await prisma.axTask.update({ where: { id }, data });
  await writeAudit(null, { orgId, actorId, entity: 'task', entityId: id, action: 'update', before: snap(before), after: snap(task) });
  return get(orgId, id);
}

async function remove(orgId, actorId, id) {
  const before = await prisma.axTask.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.axTask.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'task', entityId: id, action: 'delete', before: snap(before) });
  return { ok: true };
}

module.exports = { TYPES, STATUSES, createTaskSchema, updateTaskSchema, listQuerySchema, list, get, create, update, remove };
