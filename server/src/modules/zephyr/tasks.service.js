const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const rent = require('./rent.service');

const TYPES = ['visit_property', 'collect_rent', 'inspect', 'coordinate_vendor', 'collect_documents', 'verify_work', 'follow_up_tenant', 'follow_up_client', 'collect_payment', 'update_property', 'other'];
const PRIORITIES = ['low', 'normal', 'high'];
const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const dateOrNull = z.preprocess((v) => (v === '' || v === undefined ? null : v), dateStr.nullable());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const moneyOrNull = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e13).nullable().optional());

const taskFields = {
  person_id: uuidOrNull,
  property_id: uuidOrNull,
  unit_id: uuidOrNull,
  project_id: uuidOrNull,
  rent_due_id: uuidOrNull,
  task_type: z.enum(TYPES),
  title: z.string().trim().min(1).max(200),
  description: text(2000),
  due_date: dateOrNull.optional(),
  priority: z.enum(PRIORITIES),
  amount: moneyOrNull,
  notes: text(2000),
};
const createTaskSchema = z.object({ ...taskFields, task_type: taskFields.task_type.default('other'), priority: taskFields.priority.default('normal') });
const updateTaskSchema = z.object(taskFields).partial();
const statusSchema = z.object({ status: z.enum(STATUSES), notes: text(2000) });
const completeSchema = z.object({
  completed_on: dateStr.optional(),
  notes: text(2000),
  payment: z.object({ amount: z.coerce.number().positive().max(1e13), paid_on: dateStr, method: z.enum(rent.PAYMENT_METHODS), reference: text(120) }).optional(),
});
const reopenSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const listQuerySchema = z.object({
  status: z.enum([...STATUSES, 'open', 'overdue']).optional(),
  person_id: z.string().uuid().optional(),
  property_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  task_type: z.enum(TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  q: z.string().trim().max(100).optional(),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const isOpen = (t) => t.status === 'pending' || t.status === 'in_progress';
const snapshot = (t) => ({ code: t.code, title: t.title, status: t.status, person_id: t.person_id, due_date: dayOf(t.due_date), amount: num(t.amount) });

async function nextCode(tx, orgId) {
  await tx.zxSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  const s = await tx.zxSetting.update({ where: { org_id: orgId }, data: { task_seq: { increment: 1 } } });
  return `${s.task_prefix}-${String(s.task_seq).padStart(4, '0')}`;
}

async function decorate(orgId, tasks) {
  const ids = (key) => [...new Set(tasks.map((t) => t[key]).filter(Boolean))];
  const [people, props, units, projects] = await Promise.all([
    prisma.zxPerson.findMany({ where: { id: { in: ids('person_id') }, org_id: orgId }, select: { id: true, name: true, kind: true } }),
    prisma.zxProperty.findMany({ where: { id: { in: ids('property_id') }, org_id: orgId }, select: { id: true, code: true, name: true } }),
    prisma.zxPropertyUnit.findMany({ where: { id: { in: ids('unit_id') }, org_id: orgId }, select: { id: true, name: true } }),
    prisma.zxProject.findMany({ where: { id: { in: ids('project_id') }, org_id: orgId }, select: { id: true, code: true, name: true } }),
  ]);
  const by = (rows) => new Map(rows.map((r) => [r.id, r]));
  const pm = by(people);
  const prm = by(props);
  const um = by(units);
  const pjm = by(projects);
  const today = todayStr();
  return tasks.map((t) => ({
    ...t,
    amount: num(t.amount),
    due_date: dayOf(t.due_date),
    completed_on: dayOf(t.completed_on),
    overdue: isOpen(t) && t.due_date && dayOf(t.due_date) < today,
    person: pm.get(t.person_id) || null,
    property: prm.get(t.property_id) || null,
    unit: um.get(t.unit_id) || null,
    project: pjm.get(t.project_id) || null,
  }));
}

// A person without Zephyr-wide task access sees only the tasks assigned to them.
function scopeWhere(ctx) {
  return ctx.all ? {} : { person_id: ctx.personId || '00000000-0000-0000-0000-000000000000' };
}

async function list(orgId, ctx, query) {
  const today = toDate(todayStr());
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...scopeWhere(ctx),
    ...(query.status === 'open' ? { status: { in: ['pending', 'in_progress'] } } : query.status === 'overdue' ? { status: { in: ['pending', 'in_progress'] }, due_date: { lt: today } } : query.status ? { status: query.status } : {}),
    ...(query.person_id && ctx.all ? { person_id: query.person_id } : {}),
    ...(query.property_id ? { property_id: query.property_id } : {}),
    ...(query.project_id ? { project_id: query.project_id } : {}),
    ...(query.task_type ? { task_type: query.task_type } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.q ? { OR: ['title', 'code', 'description'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) } : {}),
  };
  const rows = await prisma.zxTask.findMany({ where, orderBy: [{ status: 'asc' }, { due_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'desc' }], take: 300 });
  return decorate(orgId, rows);
}

async function summary(orgId, ctx) {
  const rows = await prisma.zxTask.findMany({ where: { org_id: orgId, deleted_at: null, ...scopeWhere(ctx) }, select: { status: true, due_date: true, completed_on: true, amount: true } });
  const today = todayStr();
  const month = today.slice(0, 7);
  return {
    pending: rows.filter((r) => r.status === 'pending').length,
    in_progress: rows.filter((r) => r.status === 'in_progress').length,
    overdue: rows.filter((r) => isOpen(r) && r.due_date && dayOf(r.due_date) < today).length,
    completed_this_month: rows.filter((r) => r.status === 'completed' && dayOf(r.completed_on)?.startsWith(month)).length,
    open_amount: rows.filter(isOpen).reduce((a, r) => a + (num(r.amount) || 0), 0),
  };
}

async function get(orgId, ctx, id) {
  const t = await prisma.zxTask.findFirst({ where: { id, org_id: orgId, deleted_at: null, ...scopeWhere(ctx) } });
  if (!t) return { error: 'not_found' };
  const [decorated] = await decorate(orgId, [t]);
  return { task: decorated };
}

async function checkRefs(orgId, input) {
  if (input.person_id && !(await prisma.zxPerson.findFirst({ where: { id: input.person_id, org_id: orgId, deleted_at: null, active: true }, select: { id: true } }))) return 'person_invalid';
  if (input.project_id && !(await prisma.zxProject.findFirst({ where: { id: input.project_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return 'ref_not_found';
  if (input.property_id && !(await prisma.zxProperty.findFirst({ where: { id: input.property_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return 'ref_not_found';
  if (input.unit_id) {
    if (!input.property_id) return 'unit_needs_property';
    if (!(await prisma.zxPropertyUnit.findFirst({ where: { id: input.unit_id, property_id: input.property_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return 'ref_mismatch';
  }
  if (input.rent_due_id) {
    const due = await prisma.zxRentDue.findFirst({ where: { id: input.rent_due_id, org_id: orgId } });
    if (!due) return 'ref_not_found';
    if (input.property_id && due.property_id !== input.property_id) return 'ref_mismatch';
    if (input.unit_id && due.unit_id !== input.unit_id) return 'ref_mismatch';
  }
  return null;
}

async function create(orgId, actorId, input) {
  const bad = await checkRefs(orgId, input);
  if (bad) return { error: bad };
  const { due_date, ...rest } = input;
  const task = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    // a rent task pre-fills the property, unit and amount from the due it points at
    let extra = {};
    if (rest.rent_due_id) {
      const due = await tx.zxRentDue.findUnique({ where: { id: rest.rent_due_id } });
      extra = { property_id: rest.property_id || due.property_id, unit_id: rest.unit_id || due.unit_id, ...(rest.amount === undefined || rest.amount === null ? { amount: Number(due.amount) - Number(due.paid_amount) } : {}) };
    }
    return tx.zxTask.create({ data: { org_id: orgId, created_by: actorId, code, ...rest, ...extra, due_date: toDate(due_date) } });
  });
  await writeAudit(null, { orgId, actorId, entity: 'task', entityId: task.id, action: 'create', after: snapshot(task) });
  return get(orgId, { all: true }, task.id);
}

async function update(orgId, actorId, id, input) {
  const before = await prisma.zxTask.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (!isOpen(before)) return { error: 'task_closed' };
  const bad = await checkRefs(orgId, { ...before, ...input, property_id: input.property_id !== undefined ? input.property_id : before.property_id, unit_id: input.unit_id !== undefined ? input.unit_id : before.unit_id });
  if (bad) return { error: bad };
  const { due_date, ...rest } = input;
  await prisma.zxTask.update({ where: { id }, data: { ...rest, ...(due_date !== undefined ? { due_date: toDate(due_date) } : {}) } });
  const after = await prisma.zxTask.findUnique({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'task', entityId: id, action: 'update', before: snapshot(before), after: snapshot(after) });
  return get(orgId, { all: true }, id);
}

// The assignee (or an admin / manager) moves a task along.
async function setStatus(orgId, actorId, ctx, id, input) {
  const before = await prisma.zxTask.findFirst({ where: { id, org_id: orgId, deleted_at: null, ...scopeWhere(ctx) } });
  if (!before) return { error: 'not_found' };
  if (!isOpen(before)) return { error: 'task_closed' };
  if (input.status === 'completed') return { error: 'use_complete' };
  if (!ctx.all && input.status === 'cancelled') return { error: 'forbidden_status' };
  await prisma.zxTask.update({ where: { id }, data: { status: input.status, ...(input.notes !== undefined ? { notes: input.notes } : {}) } });
  await writeAudit(null, { orgId, actorId, entity: 'task', entityId: id, action: 'status', before: { status: before.status }, after: { status: input.status } });
  return get(orgId, ctx, id);
}

async function complete(orgId, actorId, ctx, id, input) {
  const before = await prisma.zxTask.findFirst({ where: { id, org_id: orgId, deleted_at: null, ...scopeWhere(ctx) } });
  if (!before) return { error: 'not_found' };
  if (!isOpen(before)) return { error: 'task_closed' };
  const completedOn = input.completed_on || todayStr();
  if (completedOn > todayStr()) return { error: 'future_date' };
  if (input.payment) {
    // collecting money against a rent due books the payment through the rent module, credited to the assignee
    if (!before.rent_due_id) return { error: 'no_rent_due' };
    const result = await rent.recordPayment(orgId, actorId, before.rent_due_id, { ...input.payment, collected_by_person_id: before.person_id || null, notes: `Task ${before.code}` });
    if (result.error) return { error: result.error, balance: result.balance };
  }
  await prisma.zxTask.update({ where: { id }, data: { status: 'completed', completed_on: toDate(completedOn), ...(input.notes !== undefined ? { notes: input.notes } : {}) } });
  await writeAudit(null, { orgId, actorId, entity: 'task', entityId: id, action: 'complete', before: { status: before.status }, after: { status: 'completed', completed_on: completedOn, collected: input.payment?.amount || null } });
  return get(orgId, ctx, id);
}

// Admin: put a finished or cancelled task back to work, with a reason on the audit trail.
async function reopen(orgId, actorId, id, input) {
  const before = await prisma.zxTask.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (isOpen(before)) return { error: 'not_closed' };
  await prisma.zxTask.update({ where: { id }, data: { status: 'pending', completed_on: null } });
  await writeAudit(null, { orgId, actorId, entity: 'task', entityId: id, action: 'reopen', before: { status: before.status }, after: { status: 'pending' }, reason: input.reason });
  return get(orgId, { all: true }, id);
}

async function remove(orgId, actorId, id) {
  const before = await prisma.zxTask.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.zxTask.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'task', entityId: id, action: 'delete', before: snapshot(before) });
  return { ok: true };
}

module.exports = { TYPES, PRIORITIES, STATUSES, createTaskSchema, updateTaskSchema, statusSchema, completeSchema, reopenSchema, listQuerySchema, list, summary, get, create, update, setStatus, complete, reopen, remove };
