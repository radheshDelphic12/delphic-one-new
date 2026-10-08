const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const lock = require('./lock');
const calc = require('./deal.calc');
const inv = require('./investment.calc');
const { SERVICE_KEYS } = require('./serviceTypes');

const TYPES = ['gold', 'silver', 'venture', 'other'];
const STATUSES = ['active', 'partly_realised', 'realised'];
const GAIN_CATEGORY = 'Realised investment gain';
const LOSS_CATEGORY = 'Realised investment loss';

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const reqDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const optNum = (max) => z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(max).nullable().optional());
const reasonField = z.string().trim().max(500).optional();

const investmentFields = {
  name: z.string().trim().min(1).max(200),
  type: z.enum(TYPES),
  deal_id: uuidOrNull,
  service_type: z.preprocess((v) => (v === '' ? null : v), z.enum(SERVICE_KEYS).nullable().optional()),
  investment_date: reqDate,
  amount: z.coerce.number().positive().max(1e13),
  current_value: z.coerce.number().min(0).max(1e13),
  quantity: optNum(1e12),
  purchase_price: optNum(1e13),
  current_price: optNum(1e13),
  unit: text(40),
  purity: text(60),
  storage_location: text(200),
  startup_name: text(200),
  equity_pct: optNum(100),
  description: text(20000),
  notes: text(4000),
  reason: reasonField,
};
const createInvestmentSchema = z.object({ ...investmentFields, current_value: investmentFields.current_value.optional() });
const updateInvestmentSchema = z.object(investmentFields).partial();
const realiseSchema = z.object({
  realised_date: reqDate,
  amount_received: z.coerce.number().min(0).max(1e13),
  cost_released: optNum(1e13),
  full: z.boolean().default(false),
  remaining_value: optNum(1e13),
  notes: text(1000),
  reason: reasonField,
});
const listQuerySchema = z.object({
  type: z.enum(TYPES).optional(),
  service_type: z.enum(SERVICE_KEYS).optional(),
  deal_id: z.string().uuid().optional(),
  status: z.enum(STATUSES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(100).optional(),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayOf = calc.dayOf;
const today = () => dayOf(new Date());
const n = (v) => (v == null ? null : Number(v));
const snap = (i) => ({ code: i.code, name: i.name, type: i.type, date: dayOf(i.investment_date), amount: n(i.amount), current_value: n(i.current_value), status: i.status, deal_id: i.deal_id });
const defaultService = (type) => (type === 'gold' || type === 'silver' ? 'gold_silver' : type === 'venture' ? 'venture_capital' : null);

async function nextCode(tx, orgId) {
  await tx.axSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  const s = await tx.axSetting.update({ where: { org_id: orgId }, data: { investment_seq: { increment: 1 } } });
  return `${s.investment_prefix}-${String(s.investment_seq).padStart(4, '0')}`;
}

function whereOf(orgId, q) {
  const range = {};
  if (q.from) range.gte = toDate(q.from);
  if (q.to) range.lte = toDate(q.to);
  return {
    org_id: orgId,
    deleted_at: null,
    ...(q.type ? { type: q.type } : {}),
    ...(q.service_type ? { service_type: q.service_type } : {}),
    ...(q.deal_id ? { deal_id: q.deal_id } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(Object.keys(range).length ? { investment_date: range } : {}),
    ...(q.q ? { OR: ['name', 'code', 'startup_name', 'description'].map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })) } : {}),
  };
}

function decorate(rows) {
  return rows.map((r) => {
    const h = inv.holding(r, r.realisations || []);
    return {
      ...r,
      amount: n(r.amount),
      current_value: n(r.current_value),
      quantity: n(r.quantity),
      purchase_price: n(r.purchase_price),
      current_price: n(r.current_price),
      equity_pct: n(r.equity_pct),
      realisations: (r.realisations || []).map((x) => ({ ...x, amount_received: n(x.amount_received), cost_released: n(x.cost_released) })),
      performance: { ...h, metal_profit: inv.metalProfit(r) },
    };
  });
}

async function list(orgId, query) {
  const rows = await prisma.axInvestment.findMany({
    where: whereOf(orgId, query),
    include: { realisations: { where: { deleted_at: null }, orderBy: { realised_date: 'asc' } }, deal: { select: { id: true, code: true, name: true } } },
    orderBy: [{ investment_date: 'desc' }, { created_at: 'desc' }],
    take: 500,
  });
  const data = decorate(rows);
  const byType = {};
  for (const t of TYPES) byType[t] = inv.totals(data.filter((r) => r.type === t).map((r) => ({ ...r, ...r.performance })));
  return { data, totals: inv.totals(data.map((r) => ({ ...r, ...r.performance }))), by_type: byType };
}

async function get(orgId, id) {
  const row = await prisma.axInvestment.findFirst({
    where: { id, org_id: orgId, deleted_at: null },
    include: { realisations: { where: { deleted_at: null }, orderBy: { realised_date: 'asc' } }, deal: { select: { id: true, code: true, name: true } } },
  });
  return row ? { investment: decorate([row])[0] } : { error: 'not_found' };
}

async function checkDeal(orgId, dealId) {
  if (dealId && !(await prisma.axDeal.findFirst({ where: { id: dealId, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'deal_not_found' };
  return null;
}

async function create(orgId, actorId, ctx, input) {
  const bad = await checkDeal(orgId, input.deal_id);
  if (bad) return bad;
  const blocked = await lock.guard(orgId, [input.investment_date], ctx);
  if (blocked) return blocked;
  const { reason, investment_date, ...rest } = input;
  const row = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    return tx.axInvestment.create({
      data: { org_id: orgId, created_by: actorId, code, ...rest, current_value: input.current_value ?? input.amount, service_type: input.service_type || defaultService(input.type), investment_date: toDate(investment_date) },
    });
  });
  await lock.touch(orgId, [investment_date]);
  await writeAudit(null, { orgId, actorId, entity: 'investment', entityId: row.id, action: 'create', after: snap(row), reason });
  return get(orgId, row.id);
}

const FINANCIAL = ['amount', 'investment_date', 'quantity', 'purchase_price'];

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.axInvestment.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const bad = await checkDeal(orgId, input.deal_id);
  if (bad) return bad;
  const { reason, investment_date, ...rest } = input;
  const dates = [];
  if (FINANCIAL.some((f) => input[f] !== undefined)) dates.push(dayOf(before.investment_date), investment_date || dayOf(before.investment_date));
  // A change of current value is recorded now, so it is locked only when the current month is closed.
  if (input.current_value !== undefined || input.current_price !== undefined) dates.push(today());
  const blocked = await lock.guard(orgId, dates, ctx);
  if (blocked) return blocked;
  await prisma.axInvestment.update({ where: { id }, data: { ...rest, ...(investment_date ? { investment_date: toDate(investment_date) } : {}) } });
  await lock.touch(orgId, dates);
  const after = await prisma.axInvestment.findUnique({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'investment', entityId: id, action: 'update', before: snap(before), after: snap(after), reason });
  return get(orgId, id);
}

async function remove(orgId, actorId, ctx, id) {
  const before = await prisma.axInvestment.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include: { realisations: { where: { deleted_at: null } } } });
  if (!before) return { error: 'not_found' };
  const dates = [dayOf(before.investment_date), ...before.realisations.map((r) => dayOf(r.realised_date))];
  const blocked = await lock.guard(orgId, dates, ctx);
  if (blocked) return blocked;
  await prisma.$transaction([
    prisma.axInvestment.update({ where: { id }, data: { deleted_at: new Date() } }),
    prisma.axInvestmentRealisation.updateMany({ where: { investment_id: id, deleted_at: null }, data: { deleted_at: new Date() } }),
    prisma.axLedgerEntry.updateMany({ where: { org_id: orgId, source_type: 'investment_realisation', source_id: { in: before.realisations.map((r) => r.id) }, deleted_at: null }, data: { deleted_at: new Date() } }),
  ]);
  await lock.touch(orgId, dates);
  await writeAudit(null, { orgId, actorId, entity: 'investment', entityId: id, action: 'delete', before: snap(before), reason: ctx.reason });
  return { ok: true };
}

async function categoryId(tx, orgId, kind, name) {
  await core.ensureCategories(orgId);
  const found = await tx.axCategory.findFirst({ where: { org_id: orgId, kind, name } });
  if (found) return found.deleted_at ? (await tx.axCategory.update({ where: { id: found.id }, data: { deleted_at: null, active: true } })).id : found.id;
  return (await tx.axCategory.create({ data: { org_id: orgId, kind, name, sort_order: 99 } })).id;
}

// Realisation = cash actually received. Only the GAIN (received - cost released) is posted to the ledger, as revenue
// (or an expense when it is a loss). Unrealised appreciation never is.
async function realise(orgId, actorId, ctx, id, input) {
  const row = await prisma.axInvestment.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include: { realisations: { where: { deleted_at: null } } } });
  if (!row) return { error: 'not_found' };
  if (row.status === 'realised') return { error: 'already_realised' };
  const blocked = await lock.guard(orgId, [input.realised_date], ctx);
  if (blocked) return blocked;
  if (input.realised_date < dayOf(row.investment_date)) return { error: 'invalid', message: 'The realisation date cannot be before the investment date' };
  const held = inv.holding(row, row.realisations);
  const cost = input.full ? held.remaining_cost : input.cost_released ?? held.remaining_cost;
  if (cost > held.remaining_cost + 0.005) return { error: 'invalid', message: 'The cost released is more than the cost still held' };
  const gain = calc.round2(input.amount_received - cost);
  const fullyOut = input.full || held.remaining_cost - cost <= 0.005;
  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.axInvestmentRealisation.create({ data: { org_id: orgId, investment_id: id, realised_date: toDate(input.realised_date), amount_received: input.amount_received, cost_released: cost, notes: input.notes ?? null, created_by: actorId } });
    if (gain !== 0) {
      const entry = await tx.axLedgerEntry.create({
        data: {
          org_id: orgId,
          entry_date: toDate(input.realised_date),
          type: gain > 0 ? 'revenue' : 'expense',
          category_id: await categoryId(tx, orgId, gain > 0 ? 'revenue' : 'expense', gain > 0 ? GAIN_CATEGORY : LOSS_CATEGORY),
          deal_id: row.deal_id,
          amount: Math.abs(gain),
          description: `Realised ${gain > 0 ? 'gain' : 'loss'} on ${row.code || row.name}`,
          source_type: 'investment_realisation',
          source_id: r.id,
          created_by: actorId,
        },
      });
      await tx.axInvestmentRealisation.update({ where: { id: r.id }, data: { ledger_entry_id: entry.id } });
    }
    await tx.axInvestment.update({
      where: { id },
      data: fullyOut ? { status: 'realised', current_value: 0 } : { status: 'partly_realised', ...(input.remaining_value != null ? { current_value: input.remaining_value } : {}) },
    });
    return r;
  });
  await lock.touch(orgId, [input.realised_date]);
  await writeAudit(null, { orgId, actorId, entity: 'investment', entityId: id, action: 'realise', after: { realisation: created.id, amount_received: input.amount_received, cost_released: cost, gain }, reason: input.reason });
  return get(orgId, id);
}

async function removeRealisation(orgId, actorId, ctx, id, rid) {
  const r = await prisma.axInvestmentRealisation.findFirst({ where: { id: rid, investment_id: id, org_id: orgId, deleted_at: null }, include: { investment: true } });
  if (!r || r.investment.deleted_at) return { error: 'not_found' };
  const blocked = await lock.guard(orgId, [dayOf(r.realised_date)], ctx);
  if (blocked) return blocked;
  const rest = await prisma.axInvestmentRealisation.findMany({ where: { investment_id: id, deleted_at: null, NOT: { id: rid } } });
  const held = inv.holding({ ...r.investment, status: 'active' }, rest);
  await prisma.$transaction([
    prisma.axInvestmentRealisation.update({ where: { id: rid }, data: { deleted_at: new Date() } }),
    prisma.axLedgerEntry.updateMany({ where: { org_id: orgId, source_type: 'investment_realisation', source_id: rid, deleted_at: null }, data: { deleted_at: new Date() } }),
    prisma.axInvestment.update({ where: { id }, data: { status: rest.length ? 'partly_realised' : 'active', ...(r.investment.status === 'realised' ? { current_value: held.remaining_cost } : {}) } }),
  ]);
  await lock.touch(orgId, [dayOf(r.realised_date)]);
  await writeAudit(null, { orgId, actorId, entity: 'investment', entityId: id, action: 'unrealise', before: { realisation: rid, amount_received: n(r.amount_received) }, reason: ctx.reason });
  return get(orgId, id);
}

// ---- assets (minimal master for the valuation) ----
const ASSET_CATEGORIES = ['cash_bank', 'property', 'equipment', 'receivable', 'investment', 'other'];
const assetFields = {
  name: z.string().trim().min(1).max(200),
  category: z.enum(ASSET_CATEGORIES),
  value: z.coerce.number().min(0).max(1e13),
  as_of_date: reqDate,
  status: z.enum(['active', 'disposed']),
  notes: text(2000),
  reason: reasonField,
};
const createAssetSchema = z.object({ ...assetFields, category: assetFields.category.default('other'), status: assetFields.status.default('active') });
const updateAssetSchema = z.object(assetFields).partial();
const assetListSchema = z.object({ category: z.enum(ASSET_CATEGORIES).optional(), status: z.enum(['active', 'disposed']).optional(), q: z.string().trim().max(100).optional() });
const assetSnap = (a) => ({ name: a.name, category: a.category, value: n(a.value), as_of_date: dayOf(a.as_of_date), status: a.status });

async function listAssets(orgId, q = {}) {
  const rows = await prisma.axAsset.findMany({
    where: { org_id: orgId, deleted_at: null, ...(q.category ? { category: q.category } : {}), ...(q.status ? { status: q.status } : {}), ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}) },
    orderBy: [{ as_of_date: 'desc' }, { name: 'asc' }],
  });
  const data = rows.map((a) => ({ ...a, value: n(a.value) }));
  return { data, total_active: calc.round2(calc.sum(data.filter((a) => a.status === 'active'), (a) => a.value)) };
}

async function createAsset(orgId, actorId, ctx, input) {
  const { reason, as_of_date, ...rest } = input;
  const blocked = await lock.guard(orgId, [as_of_date], ctx);
  if (blocked) return blocked;
  const a = await prisma.axAsset.create({ data: { org_id: orgId, created_by: actorId, ...rest, as_of_date: toDate(as_of_date) } });
  await writeAudit(null, { orgId, actorId, entity: 'asset', entityId: a.id, action: 'create', after: assetSnap(a), reason });
  return { asset: { ...a, value: n(a.value) } };
}

async function updateAsset(orgId, actorId, ctx, id, input) {
  const before = await prisma.axAsset.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const { reason, as_of_date, ...rest } = input;
  const blocked = (await lock.guard(orgId, [dayOf(before.as_of_date)], ctx)) || (await lock.guard(orgId, [as_of_date || dayOf(before.as_of_date)], ctx));
  if (blocked) return blocked;
  const a = await prisma.axAsset.update({ where: { id }, data: { ...rest, ...(as_of_date ? { as_of_date: toDate(as_of_date) } : {}) } });
  await writeAudit(null, { orgId, actorId, entity: 'asset', entityId: id, action: 'update', before: assetSnap(before), after: assetSnap(a), reason });
  return { asset: { ...a, value: n(a.value) } };
}

async function removeAsset(orgId, actorId, ctx, id) {
  const before = await prisma.axAsset.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const blocked = await lock.guard(orgId, [dayOf(before.as_of_date)], ctx);
  if (blocked) return blocked;
  await prisma.axAsset.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'asset', entityId: id, action: 'delete', before: assetSnap(before), reason: ctx.reason });
  return { ok: true };
}

module.exports = {
  TYPES, STATUSES, ASSET_CATEGORIES, GAIN_CATEGORY, LOSS_CATEGORY,
  createInvestmentSchema, updateInvestmentSchema, realiseSchema, listQuerySchema, createAssetSchema, updateAssetSchema, assetListSchema,
  whereOf, decorate, list, get, create, update, remove, realise, removeRealisation, listAssets, createAsset, updateAsset, removeAsset,
};
