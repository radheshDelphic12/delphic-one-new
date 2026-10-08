const { z } = require('zod');
const prisma = require('../../config/db');
const { num, round2, monthKey } = require('../../lib/vertical');
const contractsService = require('../contracts/contracts.service');

const DEFAULT_MULTIPLE = { revenue_multiple: 3, ebitda_multiple: 8 };

const planLineSchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
  line_kind: z.enum(['revenue', 'expense', 'salary', 'other']),
  category: z.string().trim().max(120).default(''),
  planned_amount: z.coerce.number().min(0),
  notes: z.string().trim().max(500).optional().nullable(),
});
const planQuerySchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
});
const periodIdxOf = (year, month) => year * 12 + (month - 1);
const monthsQuerySchema = z.object({ months: z.coerce.number().int().min(1).max(36).default(12) });
// A start and an end month (inclusive, at most 36 months apart); without them, the last `months` months.
const trendsQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(36).default(12),
    from_year: z.coerce.number().int().min(2000).max(2100).optional(),
    from_month: z.coerce.number().int().min(1).max(12).optional(),
    to_year: z.coerce.number().int().min(2000).max(2100).optional(),
    to_month: z.coerce.number().int().min(1).max(12).optional(),
    // The same three views as the Financials tab: finalized only, live not-yet-locked, or both.
    state: z.enum(['locked', 'unlocked', 'all']).default('locked'),
  })
  .refine((q) => [q.from_year, q.from_month, q.to_year, q.to_month].every((v) => v === undefined) || [q.from_year, q.from_month, q.to_year, q.to_month].every((v) => v !== undefined), { message: 'Give the start and end month together' })
  .refine((q) => q.from_year === undefined || periodIdxOf(q.to_year, q.to_month) >= periodIdxOf(q.from_year, q.from_month), { message: 'The end month cannot be before the start month' })
  .refine((q) => q.from_year === undefined || periodIdxOf(q.to_year, q.to_month) - periodIdxOf(q.from_year, q.from_month) < 36, { message: 'Pick at most 36 months' });
const assetValueSchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
  asset_value: z.coerce.number().min(0).max(1e13),
  notes: z.string().trim().max(500).optional().nullable(),
});
const projectionQuerySchema = z.object({
  months: z.coerce.number().int().min(3).max(24).default(12),
  horizon: z.coerce.number().int().min(1).max(12).default(6),
});

// Last `count` calendar months ending with the current one, oldest first.
function monthWindow(count, now = new Date()) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, key: monthKey(d), start: d, end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) });
  }
  return out;
}

// Salary cost for one month: processed payroll wins; otherwise accrue each
// active member's latest structure (ctc is a monthly figure - see profitability).
async function salaryForMonth(orgId, win) {
  const run = await prisma.payrollRun.findFirst({ where: { org_id: orgId, period_month: win.month, period_year: win.year, status: 'processed' } });
  if (run) {
    const agg = await prisma.payslip.aggregate({ where: { payroll_run_id: run.id, org_id: orgId }, _sum: { gross: true } });
    return { amount: round2(num(agg._sum.gross) || 0), basis: 'payroll' };
  }
  const memberships = await prisma.orgMembership.findMany({
    where: { org_id: orgId, joined_at: { lt: win.end }, OR: [{ left_at: null }, { left_at: { gte: win.start } }] },
    select: { id: true },
  });
  if (memberships.length === 0) return { amount: 0, basis: 'none' };
  const structures = await prisma.salaryStructure.findMany({
    where: { org_id: orgId, org_membership_id: { in: memberships.map((m) => m.id) }, effective_from: { lt: win.end } },
    orderBy: { effective_from: 'desc' },
    select: { org_membership_id: true, ctc: true },
  });
  const latest = new Map();
  for (const s of structures) if (!latest.has(s.org_membership_id)) latest.set(s.org_membership_id, Number(s.ctc));
  const total = Array.from(latest.values()).reduce((a, b) => a + b, 0);
  return { amount: round2(total), basis: latest.size ? 'salary_structures' : 'none' };
}

async function actualsForMonth(orgId, win) {
  const range = { gte: win.start, lt: win.end };
  const [billing, tradeSales, tradePurchases, projectRows, claims, vendors, recurring, salary] = await Promise.all([
    prisma.dailyProjectRevenue.aggregate({ where: { org_id: orgId, date: range }, _sum: { revenue: true } }),
    prisma.tradeTransaction.aggregate({ where: { org_id: orgId, txn_type: 'sale', status: 'completed', txn_date: range }, _sum: { amount: true } }),
    prisma.tradeTransaction.aggregate({ where: { org_id: orgId, txn_type: 'purchase', status: 'completed', txn_date: range }, _sum: { amount: true } }),
    prisma.projectFinanceEntry.groupBy({ by: ['entry_type'], where: { org_id: orgId, entry_date: range }, _sum: { amount: true } }),
    prisma.expenseClaim.aggregate({ where: { org_id: orgId, status: { in: ['approved', 'reimbursed'] }, created_at: range }, _sum: { amount: true } }),
    prisma.vendorPayment.aggregate({ where: { org_id: orgId, status: { in: ['approved', 'paid'] }, period_month: win.month, period_year: win.year }, _sum: { amount: true } }),
    contractsService.recurringRevenueForMonth(orgId, win.year, win.month),
    salaryForMonth(orgId, win),
  ]);

  const project = { revenue: 0, expense: 0, salary: 0, other: 0 };
  for (const g of projectRows) project[g.entry_type] = num(g._sum.amount) || 0;

  const revenueParts = {
    billing: num(billing._sum.revenue) || 0,
    trading: num(tradeSales._sum.amount) || 0,
    projects: project.revenue,
    recurring_contracts: recurring,
  };
  const expenseParts = {
    expense_claims: num(claims._sum.amount) || 0,
    vendor_payments: num(vendors._sum.amount) || 0,
    goods_purchased: num(tradePurchases._sum.amount) || 0,
    project_costs: project.expense,
  };
  const revenue = round2(Object.values(revenueParts).reduce((a, b) => a + b, 0));
  const expenses = round2(Object.values(expenseParts).reduce((a, b) => a + b, 0));
  const salaryTotal = round2(salary.amount + project.salary);
  const other = round2(project.other);
  const profit = round2(revenue - expenses - salaryTotal - other);

  return {
    month: win.key,
    revenue,
    expenses,
    salary: salaryTotal,
    other,
    profit,
    revenue_breakdown: Object.fromEntries(Object.entries(revenueParts).map(([k, v]) => [k, round2(v)])),
    expense_breakdown: Object.fromEntries(Object.entries(expenseParts).map(([k, v]) => [k, round2(v)])),
    salary_basis: salary.basis,
  };
}

async function monthlyActuals(orgId, months = 12, now = new Date()) {
  const wins = monthWindow(months, now);
  const rows = [];
  for (const win of wins) rows.push(await actualsForMonth(orgId, win));
  return rows;
}

// --- Plans (budget) vs actuals ---

async function upsertPlanLine(orgId, userId, line) {
  const where = {
    org_id_period_year_period_month_line_kind_category: {
      org_id: orgId,
      period_year: line.period_year,
      period_month: line.period_month,
      line_kind: line.line_kind,
      category: line.category,
    },
  };
  const row = await prisma.financialPlan.upsert({
    where,
    create: { ...line, org_id: orgId, created_by: userId },
    update: { planned_amount: line.planned_amount, notes: line.notes ?? null },
  });
  return { ...row, planned_amount: num(row.planned_amount) };
}

async function deletePlanLine(orgId, id) {
  const row = await prisma.financialPlan.findFirst({ where: { id, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  await prisma.financialPlan.delete({ where: { id } });
  return { ok: true };
}

async function planVsActual(orgId, { period_month, period_year }) {
  const win = monthWindow(1, new Date(Date.UTC(period_year, period_month - 1, 1)))[0];
  const [plans, actual] = await Promise.all([
    prisma.financialPlan.findMany({ where: { org_id: orgId, period_month, period_year }, orderBy: [{ line_kind: 'asc' }, { category: 'asc' }] }),
    actualsForMonth(orgId, win),
  ]);
  const plannedBy = { revenue: 0, expense: 0, salary: 0, other: 0 };
  for (const p of plans) plannedBy[p.line_kind] += Number(p.planned_amount);

  const lines = ['revenue', 'expense', 'salary', 'other'].map((kind) => {
    const planned = round2(plannedBy[kind]);
    const actualAmount = kind === 'revenue' ? actual.revenue : actual[kind === 'expense' ? 'expenses' : kind];
    const variance = round2(actualAmount - planned);
    return {
      line_kind: kind,
      planned,
      actual: actualAmount,
      variance,
      // Revenue over plan is good; cost over plan is bad.
      variance_percent: planned ? Math.round((variance / planned) * 100) : null,
      on_track: kind === 'revenue' ? actualAmount >= planned : actualAmount <= planned,
    };
  });
  const plannedProfit = round2(plannedBy.revenue - plannedBy.expense - plannedBy.salary - plannedBy.other);
  return {
    period_month,
    period_year,
    lines,
    plan_entries: plans.map((p) => ({ ...p, planned_amount: num(p.planned_amount) })),
    planned_profit: plannedProfit,
    actual_profit: actual.profit,
  };
}

// --- Projection & valuation ---

// Ordinary least squares over (index, value); returns the fitted next values.
function linearForecast(values, horizon) {
  const n = values.length;
  if (n === 0) return Array(horizon).fill(0);
  if (n === 1) return Array(horizon).fill(round2(values[0]));
  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  const denom = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
  const slope = denom === 0 ? 0 : xs.reduce((s, x, i) => s + (x - meanX) * (values[i] - meanY), 0) / denom;
  const intercept = meanY - slope * meanX;
  return Array.from({ length: horizon }, (_, k) => round2(Math.max(0, intercept + slope * (n + k))));
}

function nextMonths(count, horizon, now = new Date()) {
  return Array.from({ length: horizon }, (_, k) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + k, 1))));
}

function computeValuation(org, actuals) {
  const method = org.valuation_method || 'manual';
  const manual = num(org.valuation);
  const multiple = num(org.valuation_multiple) ?? DEFAULT_MULTIPLE[method] ?? null;
  // Use the last 3 COMPLETE months (skip the in-progress current month).
  const complete = actuals.slice(0, -1).slice(-3);
  const base = { method, manual, multiple, computed: null, effective: manual, basis_months: complete.length };
  if (method === 'manual' || complete.length === 0) return base;

  const avg = (key) => complete.reduce((s, m) => s + m[key], 0) / complete.length;
  const annualRevenue = avg('revenue') * 12;
  const annualEbitda = (avg('revenue') - avg('expenses') - avg('salary') - avg('other')) * 12;
  const metric = method === 'revenue_multiple' ? annualRevenue : annualEbitda;
  const computed = round2(Math.max(0, metric) * multiple);
  return {
    ...base,
    computed,
    effective: computed > 0 ? computed : manual,
    annualised_revenue: round2(annualRevenue),
    annualised_ebitda: round2(annualEbitda),
  };
}

async function projectionForOrg(org, { months = 12, horizon = 6 } = {}, now = new Date()) {
  const actuals = await monthlyActuals(org.id, months, now);
  const completed = actuals.slice(0, -1);
  const withData = completed.filter((m) => m.revenue || m.expenses || m.salary || m.other);
  const basis = withData.slice(-6);
  const revenue = linearForecast(basis.map((m) => m.revenue), horizon);
  const cost = linearForecast(basis.map((m) => m.expenses + m.salary + m.other), horizon);
  const keys = nextMonths(months, horizon, now);
  const projected = keys.map((month, i) => ({ month, revenue: revenue[i], cost: cost[i], profit: round2(revenue[i] - cost[i]) }));
  return {
    org: { id: org.id, name: org.name, slug: org.slug, currency: org.default_currency, enabled_modules: org.enabled_modules },
    actuals,
    projected,
    projected_revenue_total: round2(projected.reduce((s, p) => s + p.revenue, 0)),
    projected_profit_total: round2(projected.reduce((s, p) => s + p.profit, 0)),
    confidence: basis.length >= 6 ? 'high' : basis.length >= 3 ? 'medium' : 'low',
    valuation: computeValuation(org, actuals),
  };
}

const ORG_SELECT = { id: true, name: true, slug: true, enabled_modules: true, default_currency: true, valuation: true, valuation_method: true, valuation_multiple: true };

async function groupProjection(orgGroupIds, opts = {}) {
  const orgs = await prisma.org.findMany({ where: { org_group_id: { in: orgGroupIds }, status: 'active' }, select: ORG_SELECT, orderBy: { name: 'asc' } });
  const perOrg = [];
  for (const org of orgs) perOrg.push(await projectionForOrg(org, opts));

  // Group totals are only meaningful in one currency; mixed-currency groups
  // are flagged rather than silently summed across currencies.
  const currencies = Array.from(new Set(perOrg.map((p) => p.org.currency)));
  const sum = (pick) => round2(perOrg.reduce((s, p) => s + pick(p), 0));
  return {
    orgs: perOrg,
    totals: {
      currency: currencies.length === 1 ? currencies[0] : null,
      mixed_currency: currencies.length > 1,
      valuation: sum((p) => p.valuation.effective || 0),
      projected_revenue: sum((p) => p.projected_revenue_total),
      projected_profit: sum((p) => p.projected_profit_total),
      trailing_revenue: sum((p) => p.actuals.reduce((s, m) => s + m.revenue, 0)),
      trailing_profit: sum((p) => p.actuals.reduce((s, m) => s + m.profit, 0)),
    },
  };
}

async function orgProjection(orgId, opts = {}) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: ORG_SELECT });
  if (!org) return { error: 'not_found' };
  return { projection: await projectionForOrg(org, opts) };
}

// --- Financial trends (Financials page charts) ---

// Valuation = (Delphic profit x 240) + (Asset Value x 3), exactly. Delphic profit is this workspace's own
// profit for the month in the selected view (Locked / Unlocked / All), the same figure the Profit chart shows.
const DELPHIC_PROFIT_FACTOR = 240;
const ASSET_VALUE_FACTOR = 3;
const valuationOf = (delphicProfit, assetValue) => round2(delphicProfit * DELPHIC_PROFIT_FACTOR + assetValue * ASSET_VALUE_FACTOR);


// Month on month: Revenue and Profit are the Financials figures (the same
// records the Financials tab shows: locked, unlocked or all); valuation uses that same Delphic profit;
// Asset Value is the admin-recorded
// figure for the month, carried forward from the latest earlier one.
// Every calendar month from (from_year, from_month) to (to_year, to_month), oldest first.
function monthRange(from_year, from_month, to_year, to_month) {
  const out = [];
  for (let i = periodIdxOf(from_year, from_month); i <= periodIdxOf(to_year, to_month); i += 1) {
    const d = new Date(Date.UTC(Math.floor(i / 12), i % 12, 1));
    // start / end bound every per-month query (without them a month would read all dates).
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, key: monthKey(d), start: d, end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) });
  }
  return out;
}

async function trends(orgId, { months = 12, from_year, from_month, to_year, to_month, state = 'locked' } = {}, now = new Date()) {
  const records = require('../calculations/records.service');
  const wins = from_year === undefined ? monthWindow(months, now) : monthRange(from_year, from_month, to_year, to_month);
  const assetRows = await prisma.financialAssetValue.findMany({ where: { org_id: orgId }, orderBy: [{ period_year: 'asc' }, { period_month: 'asc' }] });
  const assetAt = (win) => {
    const exact = assetRows.find((r) => r.period_year === win.year && r.period_month === win.month);
    if (exact) return { value: Number(exact.asset_value), carried: false };
    const earlier = assetRows.filter((r) => periodIdxOf(r.period_year, r.period_month) < periodIdxOf(win.year, win.month)).pop();
    return earlier ? { value: Number(earlier.asset_value), carried: true } : { value: 0, carried: false };
  };

  const monthRow = async (win) => {
    const view = { period_year: win.year, from_month: win.month, to_month: win.month, state };
    const rec = await records.financialRecords(orgId, view, now);
    const delphicProfit = rec.totals.profit;
    const asset = assetAt(win);
    return {
      month: win.key,
      period_month: win.month,
      period_year: win.year,
      revenue: rec.totals.revenue,
      profit: rec.totals.profit,
      delphic_profit: delphicProfit,
      delphic_profit_x: round2(delphicProfit * DELPHIC_PROFIT_FACTOR),
      asset_value_x: round2(asset.value * ASSET_VALUE_FACTOR),
      asset_value: asset.value,
      asset_value_carried: asset.carried,
      valuation: valuationOf(delphicProfit, asset.value),
    };
  };
  const rows = [];
  for (let i = 0; i < wins.length; i += 4) rows.push(...(await Promise.all(wins.slice(i, i + 4).map(monthRow))));
  return {
    currency: 'INR',
    state,
    formula: { delphic_profit: DELPHIC_PROFIT_FACTOR, asset_value: ASSET_VALUE_FACTOR },
    months: rows,
  };
}

async function upsertAssetValue(orgId, userId, { period_month, period_year, asset_value, notes }) {
  const row = await prisma.financialAssetValue.upsert({
    where: { org_id_period_year_period_month: { org_id: orgId, period_year, period_month } },
    create: { org_id: orgId, period_year, period_month, asset_value, notes: notes || null, updated_by: userId },
    update: { asset_value, notes: notes || null, updated_by: userId },
  });
  return { ...row, asset_value: Number(row.asset_value) };
}

module.exports = {
  trendsQuerySchema,
  assetValueSchema,
  valuationOf,
  trends,
  upsertAssetValue,
  planLineSchema,
  planQuerySchema,
  monthsQuerySchema,
  projectionQuerySchema,
  monthlyActuals,
  upsertPlanLine,
  deletePlanLine,
  planVsActual,
  linearForecast,
  computeValuation,
  projectionForOrg,
  groupProjection,
  orgProjection,
};
