const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const lock = require('./lock');
const calc = require('./valterra.calc');

const { round2, dayOf } = calc;
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.coerce.number().min(0).max(1e12);
const optMoney = z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().min(0).max(1e12).nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), dateStr.nullable().optional());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const STORED = ['planned', 'active', 'cancelled'];
const DERIVED = ['planned', 'active', 'partially_returned', 'completed', 'overdue', 'cancelled'];
const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

const investmentFields = {
  name: z.string().trim().min(1).max(200),
  category_id: uuidOrNull,
  site_id: uuidOrNull,
  investor: text(200),
  investment_date: dateStr,
  amount: money.refine((v) => v > 0, 'The amount must be more than zero'),
  expected_return_amount: optMoney,
  expected_return_date: optDate,
  expected_return_rate: optMoney,
  status: z.enum(STORED).optional(),
  reference: text(120),
  notes: text(2000),
};
const createSchema = z.object(investmentFields);
const updateSchema = z.object(investmentFields).partial().extend({ reason: z.string().trim().max(500).optional() });
const returnSchema = z.object({
  return_date: dateStr,
  principal: money.default(0),
  earnings: money.default(0),
  payment_method: text(60),
  reference: text(120),
  notes: text(1000),
}).refine((v) => v.principal + v.earnings > 0, { message: 'Enter the principal returned, the earnings, or both', path: ['principal'] });
const returnUpdateSchema = z.object({
  return_date: dateStr, principal: money, earnings: money, payment_method: text(60), reference: text(120), notes: text(1000),
  status: z.enum(['received', 'reversed']), reason: z.string().trim().max(500),
}).partial();
const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category_id: z.string().uuid().optional(),
  site_id: z.union([z.string().uuid(), z.literal('none')]).optional(),
  mining_type_id: z.string().uuid().optional(),
  material_id: z.string().uuid().optional(),
  status: z.enum(DERIVED).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

const snap = (i) => ({ site_id: i.site_id, code: i.code, name: i.name, amount: Number(i.amount), status: i.status, investment_date: dayOf(i.investment_date), expected_return_amount: i.expected_return_amount === null ? null : Number(i.expected_return_amount), expected_return_date: dayOf(i.expected_return_date) });
const returnSnap = (r) => ({ date: dayOf(r.return_date), principal: Number(r.principal), earnings: Number(r.earnings), status: r.status });

const returnOut = (r) => ({ id: r.id, investment_id: r.investment_id, return_date: dayOf(r.return_date), principal: Number(r.principal), earnings: Number(r.earnings), total: round2(Number(r.principal) + Number(r.earnings)), status: r.status, payment_method: r.payment_method, reference: r.reference, notes: r.notes, created_at: r.created_at });

function out(inv, today) {
  const returns = inv.returns || [];
  const v = calc.investmentView(inv, returns, today);
  return {
    id: inv.id, code: inv.code, name: inv.name, site_id: inv.site_id, site: inv.site ? { id: inv.site.id, code: inv.site.code, name: inv.site.name } : null, category_id: inv.category_id, category: inv.category ? { id: inv.category.id, name: inv.category.name } : null,
    investor: inv.investor, investment_date: dayOf(inv.investment_date), amount: v.amount, expected_return_rate: inv.expected_return_rate === null ? null : Number(inv.expected_return_rate),
    stored_status: inv.status, reference: inv.reference, notes: inv.notes, created_at: inv.created_at, updated_at: inv.updated_at,
    ...v, status: v.status,
    returns: returns.filter((r) => !r.deleted_at).sort((a, b) => dayOf(b.return_date).localeCompare(dayOf(a.return_date))).map(returnOut),
  };
}

const include = { category: { select: { id: true, name: true } }, site: { select: { id: true, code: true, name: true } }, returns: { where: { deleted_at: null } } };

async function list(orgId, rawQuery = {}) {
  const f = listQuerySchema.parse(rawQuery);
  const where = {
    org_id: orgId, deleted_at: null,
    ...(f.category_id ? { category_id: f.category_id } : {}),
    ...core.siteWhere(f),
    ...(f.from || f.to ? { investment_date: { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lte: toDate(f.to) } : {}) } } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { code: { contains: f.q, mode: 'insensitive' } }, { investor: { contains: f.q, mode: 'insensitive' } }] } : {}),
  };
  const rows = await prisma.vtInvestment.findMany({ where, include, orderBy: [{ investment_date: 'desc' }, { created_at: 'desc' }] });
  const today = dayOf(new Date());
  let items = rows.map((r) => out(r, today));
  if (f.status) items = items.filter((i) => i.status === f.status);
  const totals = {
    count: items.length,
    invested: round2(items.filter((i) => i.counted).reduce((a, i) => a + i.amount, 0)),
    principal_returned: round2(items.reduce((a, i) => a + i.principal_returned, 0)),
    earnings: round2(items.reduce((a, i) => a + i.earnings, 0)),
    outstanding_principal: round2(items.reduce((a, i) => a + i.outstanding_principal, 0)),
    overdue: items.filter((i) => i.overdue).length,
  };
  const data = items.slice((f.page - 1) * f.limit, f.page * f.limit);
  return { data, totals, pagination: { page: f.page, limit: f.limit, total: items.length, pages: Math.max(1, Math.ceil(items.length / f.limit)) } };
}

async function getOne(orgId, id) {
  const row = await prisma.vtInvestment.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include });
  if (!row) return { error: 'not_found' };
  return { investment: out(row, dayOf(new Date())) };
}

async function categoryOk(orgId, id) {
  if (!id) return true;
  return Boolean(await prisma.vtCategory.findFirst({ where: { id, org_id: orgId, scope: 'investment', deleted_at: null }, select: { id: true } }));
}

async function nextCode(orgId) {
  await core.ensureSettings(orgId);
  const s = await prisma.vtSetting.update({ where: { org_id: orgId }, data: { investment_seq: { increment: 1 } } });
  return `${s.investment_prefix}-${String(s.investment_seq).padStart(4, '0')}`;
}

async function create(orgId, actorId, ctx, input) {
  if (!(await categoryOk(orgId, input.category_id))) return { error: 'category_not_found' };
  const siteBad = await core.siteCheck(orgId, input.site_id, { creating: true });
  if (siteBad) return { error: siteBad };
  if (input.expected_return_date && input.expected_return_date < input.investment_date) return { error: 'expected_before_investment' };
  const locked = (input.status || 'active') === 'active' ? await lock.guard(orgId, [input.investment_date], ctx) : null;
  if (locked) return locked;
  const code = await nextCode(orgId);
  const row = await prisma.vtInvestment.create({
    data: { org_id: orgId, code, ...input, investment_date: toDate(input.investment_date), expected_return_date: toDate(input.expected_return_date), status: input.status || 'active', created_by: actorId, updated_by: actorId },
    include,
  });
  await lock.touch(orgId, [input.investment_date]);
  await writeAudit(null, { orgId, actorId, entity: 'investment', entityId: row.id, action: 'create', after: snap(row) });
  return { investment: out(row, dayOf(new Date())) };
}

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.vtInvestment.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include });
  if (!before) return { error: 'not_found' };
  const { reason, ...rest } = input;
  if (rest.category_id !== undefined && !(await categoryOk(orgId, rest.category_id))) return { error: 'category_not_found' };
  if (rest.site_id !== undefined) {
    const siteBad = await core.siteCheck(orgId, rest.site_id, { creating: rest.site_id !== before.site_id });
    if (siteBad) return { error: siteBad };
  }
  const merged = { ...before, ...rest };
  const invDate = rest.investment_date || dayOf(before.investment_date);
  const expDate = rest.expected_return_date === undefined ? dayOf(before.expected_return_date) : rest.expected_return_date;
  if (expDate && expDate < invDate) return { error: 'expected_before_investment' };
  const returned = round2(before.returns.filter((r) => r.status !== 'reversed').reduce((a, r) => a + Number(r.principal), 0));
  if (rest.amount !== undefined && rest.amount < returned) return { error: 'amount_below_returned', detail: { principal_returned: returned } };
  if (rest.status === 'cancelled' && before.status !== 'cancelled' && before.returns.some((r) => r.status !== 'reversed')) return { error: 'has_returns' };
  const moneyChanged = rest.amount !== undefined || rest.site_id !== undefined || rest.investment_date !== undefined || (rest.status !== undefined && rest.status !== before.status);
  const locked = moneyChanged ? await lock.guard(orgId, [dayOf(before.investment_date), invDate], ctx) : null;
  if (locked) return locked;
  const data = { ...rest, updated_by: actorId, ...(rest.investment_date ? { investment_date: toDate(rest.investment_date) } : {}), ...(rest.expected_return_date !== undefined ? { expected_return_date: toDate(rest.expected_return_date) } : {}) };
  void merged;
  const row = await prisma.vtInvestment.update({ where: { id }, data, include });
  await lock.touch(orgId, [dayOf(before.investment_date), invDate]);
  await writeAudit(null, { orgId, actorId, entity: 'investment', entityId: id, action: 'update', before: snap(before), after: snap(row), reason });
  return { investment: out(row, dayOf(new Date())) };
}

async function remove(orgId, actorId, ctx, id) {
  const before = await prisma.vtInvestment.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include });
  if (!before) return { error: 'not_found' };
  if (before.returns.length) return { error: 'has_returns' };
  const locked = await lock.guard(orgId, [dayOf(before.investment_date)], ctx);
  if (locked) return locked;
  await prisma.vtInvestment.update({ where: { id }, data: { deleted_at: new Date() } });
  await lock.touch(orgId, [dayOf(before.investment_date)]);
  await writeAudit(null, { orgId, actorId, entity: 'investment', entityId: id, action: 'delete', before: snap(before), reason: ctx.reason });
  return { ok: true };
}

// ---------------- returns ----------------
async function outstandingOf(inv, exceptId) {
  const rows = await prisma.vtReturn.findMany({ where: { investment_id: inv.id, deleted_at: null, status: 'received', ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { principal: true } });
  return Math.max(0, round2(Number(inv.amount) - rows.reduce((a, r) => a + Number(r.principal), 0)));
}

async function addReturn(orgId, actorId, ctx, id, input) {
  const inv = await prisma.vtInvestment.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!inv) return { error: 'not_found' };
  if (inv.status !== 'active') return { error: 'investment_not_active' };
  if (input.return_date < dayOf(inv.investment_date)) return { error: 'return_before_investment' };
  const outstanding = await outstandingOf(inv);
  if (input.principal > outstanding + 0.005) return { error: 'principal_exceeds', detail: { outstanding_principal: outstanding } };
  const locked = await lock.guard(orgId, [input.return_date], ctx);
  if (locked) return locked;
  const row = await prisma.vtReturn.create({ data: { org_id: orgId, investment_id: id, ...input, return_date: toDate(input.return_date), created_by: actorId } });
  await lock.touch(orgId, [input.return_date]);
  await writeAudit(null, { orgId, actorId, entity: 'return', entityId: row.id, action: 'create', after: { investment: inv.code, ...returnSnap(row) } });
  return { return: returnOut(row), ...(await getOne(orgId, id)) };
}

async function updateReturn(orgId, actorId, ctx, id, input) {
  const before = await prisma.vtReturn.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include: { investment: true } });
  if (!before) return { error: 'not_found' };
  const { reason, ...rest } = input;
  const principal = rest.principal ?? Number(before.principal);
  const earnings = rest.earnings ?? Number(before.earnings);
  if (principal + earnings <= 0) return { error: 'empty_return' };
  const newDate = rest.return_date || dayOf(before.return_date);
  if (newDate < dayOf(before.investment.investment_date)) return { error: 'return_before_investment' };
  const status = rest.status || before.status;
  if (status === 'received') {
    const outstanding = await outstandingOf(before.investment, id);
    if (principal > outstanding + 0.005) return { error: 'principal_exceeds', detail: { outstanding_principal: outstanding } };
  }
  const locked = await lock.guard(orgId, [dayOf(before.return_date), newDate], ctx);
  if (locked) return locked;
  const row = await prisma.vtReturn.update({ where: { id }, data: { ...rest, ...(rest.return_date ? { return_date: toDate(rest.return_date) } : {}) } });
  await lock.touch(orgId, [dayOf(before.return_date), newDate]);
  await writeAudit(null, { orgId, actorId, entity: 'return', entityId: id, action: rest.status === 'reversed' ? 'reverse' : 'update', before: returnSnap(before), after: returnSnap(row), reason });
  return { return: returnOut(row), ...(await getOne(orgId, before.investment_id)) };
}

async function removeReturn(orgId, actorId, ctx, id) {
  const before = await prisma.vtReturn.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const locked = await lock.guard(orgId, [dayOf(before.return_date)], ctx);
  if (locked) return locked;
  await prisma.vtReturn.update({ where: { id }, data: { deleted_at: new Date() } });
  await lock.touch(orgId, [dayOf(before.return_date)]);
  await writeAudit(null, { orgId, actorId, entity: 'return', entityId: id, action: 'delete', before: returnSnap(before), reason: ctx.reason });
  return { ok: true };
}

module.exports = { createSchema, updateSchema, returnSchema, returnUpdateSchema, listQuerySchema, list, getOne, create, update, remove, addReturn, updateReturn, removeReturn, include, out };
