const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const lock = require('./lock');
const calc = require('./novarex.calc');

const { round2, dayOf } = calc;
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optDate = z.preprocess((v) => (v === '' ? null : v), dateStr.nullable().optional());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

const KINDS = ['income', 'expense', 'salary', 'transfer'];
const PAYMENT = ['paid', 'unpaid', 'cancelled'];

const fields = {
  kind: z.enum(KINDS),
  category_id: uuidOrNull,
  person_id: uuidOrNull,
  investment_id: uuidOrNull,
  outlet_id: uuidOrNull,
  entry_date: dateStr,
  due_date: optDate,
  amount: z.coerce.number().min(0.01, 'The amount must be more than zero').max(1e12),
  payment_status: z.enum(PAYMENT).optional(),
  payment_method: text(60),
  party_name: text(200),
  reference: text(120),
  description: text(1000),
  expense_class: z.enum(['operating', 'other']).nullable().optional(),
};
const createSchema = z.object(fields);
const updateSchema = z.object(fields).omit({ kind: true }).partial().extend({ reason: z.string().trim().max(500).optional() });
const listQuerySchema = z.object({
  kind: z.enum(KINDS).optional(),
  category_id: z.string().uuid().optional(),
  payment_status: z.enum(PAYMENT).optional(),
  person_id: z.string().uuid().optional(),
  investment_id: z.string().uuid().optional(),
  outlet_id: z.union([z.string().uuid(), z.literal('none')]).optional(),
  ownership_type_id: z.string().uuid().optional(),
  format_id: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

const snap = (e) => ({ outlet_id: e.outlet_id, kind: e.kind, amount: Number(e.amount), date: dayOf(e.entry_date), payment_status: e.payment_status, category_id: e.category_id, person_id: e.person_id, reference: e.reference });
const out = (e) => ({
  id: e.id, kind: e.kind, category_id: e.category_id, category: e.category ? { id: e.category.id, name: e.category.name } : null,
  person_id: e.person_id, person: e.person ? { id: e.person.id, name: e.person.name } : null,
  outlet_id: e.outlet_id, outlet: e.outlet ? { id: e.outlet.id, code: e.outlet.code, name: e.outlet.name } : null,
  investment_id: e.investment_id, investment: e.investment ? { id: e.investment.id, code: e.investment.code, name: e.investment.name } : null,
  entry_date: dayOf(e.entry_date), due_date: dayOf(e.due_date), amount: Number(e.amount), payment_status: e.payment_status, payment_method: e.payment_method,
  party_name: e.party_name, reference: e.reference, description: e.description, expense_class: e.expense_class, created_at: e.created_at, updated_at: e.updated_at,
});
const include = { outlet: { select: { id: true, code: true, name: true } }, category: { select: { id: true, name: true } }, person: { select: { id: true, name: true } }, investment: { select: { id: true, code: true, name: true } } };

function whereOf(orgId, f, ctx = {}) {
  return {
    org_id: orgId, deleted_at: null,
    ...(ctx.payroll === false ? { kind: { not: 'salary' } } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.category_id ? { category_id: f.category_id } : {}),
    ...(f.payment_status ? { payment_status: f.payment_status } : {}),
    ...(f.person_id ? { person_id: f.person_id } : {}),
    ...(f.investment_id ? { investment_id: f.investment_id } : {}),
    ...core.outletWhere(f),
    ...(f.from || f.to ? { entry_date: { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lte: toDate(f.to) } : {}) } } : {}),
    ...(f.q ? { OR: [{ party_name: { contains: f.q, mode: 'insensitive' } }, { description: { contains: f.q, mode: 'insensitive' } }, { reference: { contains: f.q, mode: 'insensitive' } }] } : {}),
  };
}

async function list(orgId, rawQuery = {}, ctx = {}) {
  const f = listQuerySchema.parse(rawQuery);
  if (f.kind === 'salary' && ctx.payroll === false) return { data: [], summary: {}, pagination: { page: 1, limit: f.limit, total: 0, pages: 1 } };
  const where = whereOf(orgId, f, ctx);
  const [rows, total, all] = await Promise.all([
    prisma.nxEntry.findMany({ where, include, orderBy: [{ entry_date: 'desc' }, { created_at: 'desc' }], skip: (f.page - 1) * f.limit, take: f.limit }),
    prisma.nxEntry.count({ where }),
    prisma.nxEntry.findMany({ where, select: { kind: true, amount: true, payment_status: true } }),
  ]);
  const by = (k, p) => round2(all.filter((e) => e.kind === k && (!p || e.payment_status === p)).reduce((a, e) => a + Number(e.amount), 0));
  const summary = {
    income: by('income'), expense: by('expense'), salary: ctx.payroll === false ? null : by('salary'), transfer: by('transfer'),
    unpaid_income: by('income', 'unpaid'), unpaid_expense: by('expense', 'unpaid'),
  };
  return { data: rows.map(out), summary, pagination: { page: f.page, limit: f.limit, total, pages: Math.max(1, Math.ceil(total / f.limit)) } };
}

async function checkRefs(orgId, kind, input) {
  if (input.category_id) {
    const scope = kind === 'income' ? 'income' : kind === 'expense' ? 'expense' : null;
    const cat = await prisma.nxCategory.findFirst({ where: { id: input.category_id, org_id: orgId, deleted_at: null, ...(scope ? { scope } : {}) }, select: { id: true } });
    if (!cat || !scope) return 'category_not_found';
  }
  if (input.person_id) {
    if (kind !== 'salary') return 'person_only_salary';
    if (!(await prisma.nxPerson.findFirst({ where: { id: input.person_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return 'person_not_found';
  }
  if (input.investment_id) {
    if (kind !== 'income') return 'investment_only_income';
    if (!(await prisma.nxInvestment.findFirst({ where: { id: input.investment_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return 'investment_not_found';
  }
  if (input.expense_class && kind !== 'expense') return 'class_only_expense';
  if (input.outlet_id && kind === 'transfer') return 'outlet_not_for_transfer';
  return null;
}

const counts = (e) => e.kind !== 'transfer' && e.payment_status !== 'cancelled';

async function create(orgId, actorId, ctx, input) {
  if (input.kind === 'salary' && !ctx.payroll) return { error: 'payroll_forbidden' };
  const bad = await checkRefs(orgId, input.kind, input);
  if (bad) return { error: bad };
  const outletBad = await core.outletCheck(orgId, input.outlet_id, { creating: true });
  if (outletBad) return { error: outletBad };
  const status = input.payment_status || (input.kind === 'transfer' ? 'paid' : 'paid');
  if (status === 'cancelled') return { error: 'bad_status' };
  if (input.due_date && input.due_date < input.entry_date) return { error: 'due_before_entry' };
  const locked = counts({ kind: input.kind, payment_status: status }) ? await lock.guard(orgId, [input.entry_date], ctx) : null;
  if (locked) return locked;
  const row = await prisma.nxEntry.create({
    data: { org_id: orgId, ...input, payment_status: status, entry_date: toDate(input.entry_date), due_date: toDate(input.due_date), expense_class: input.kind === 'expense' ? input.expense_class || 'operating' : null, created_by: actorId, updated_by: actorId },
    include,
  });
  await lock.touch(orgId, [input.entry_date]);
  await writeAudit(null, { orgId, actorId, entity: 'entry', entityId: row.id, action: 'create', after: snap(row) });
  return { entry: out(row) };
}

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.nxEntry.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include });
  if (!before) return { error: 'not_found' };
  if (before.kind === 'salary' && !ctx.payroll) return { error: 'payroll_forbidden' };
  const { reason, ...rest } = input;
  const bad = await checkRefs(orgId, before.kind, { category_id: rest.category_id ?? undefined, person_id: rest.person_id ?? undefined, investment_id: rest.investment_id ?? undefined, expense_class: rest.expense_class ?? undefined });
  if (bad) return { error: bad };
  if (rest.outlet_id !== undefined) {
    if (rest.outlet_id && before.kind === 'transfer') return { error: 'outlet_not_for_transfer' };
    const outletBad = await core.outletCheck(orgId, rest.outlet_id, { creating: rest.outlet_id !== before.outlet_id });
    if (outletBad) return { error: outletBad };
  }
  if (before.payment_status === 'cancelled' && !ctx.isAdmin) return { error: 'entry_final' };
  const entryDate = rest.entry_date || dayOf(before.entry_date);
  const dueDate = rest.due_date === undefined ? dayOf(before.due_date) : rest.due_date;
  if (dueDate && dueDate < entryDate) return { error: 'due_before_entry' };
  const locked = await lock.guard(orgId, [dayOf(before.entry_date), entryDate], ctx);
  if (locked) return locked;
  const data = { ...rest, updated_by: actorId, ...(rest.entry_date ? { entry_date: toDate(rest.entry_date) } : {}), ...(rest.due_date !== undefined ? { due_date: toDate(rest.due_date) } : {}) };
  const row = await prisma.nxEntry.update({ where: { id }, data, include });
  await lock.touch(orgId, [dayOf(before.entry_date), entryDate]);
  await writeAudit(null, { orgId, actorId, entity: 'entry', entityId: id, action: 'update', before: snap(before), after: snap(row), reason });
  return { entry: out(row) };
}

async function remove(orgId, actorId, ctx, id) {
  const before = await prisma.nxEntry.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (before.kind === 'salary' && !ctx.payroll) return { error: 'payroll_forbidden' };
  const locked = await lock.guard(orgId, [dayOf(before.entry_date)], ctx);
  if (locked) return locked;
  await prisma.nxEntry.update({ where: { id }, data: { deleted_at: new Date() } });
  await lock.touch(orgId, [dayOf(before.entry_date)]);
  await writeAudit(null, { orgId, actorId, entity: 'entry', entityId: id, action: 'delete', before: snap(before), reason: ctx.reason });
  return { ok: true };
}

module.exports = { KINDS, createSchema, updateSchema, listQuerySchema, list, create, update, remove, whereOf, include, out };
