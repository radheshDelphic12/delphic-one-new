const { z } = require('zod');
const prisma = require('../../config/db');
const { num, round2 } = require('../../lib/vertical');
const financialsService = require('../financials/financials.service');
const gulatiFinance = require('../gulati/finance.service');
const acconcyFinance = require('../acconcy/finance.service');
const zephyrMoney = require('../zephyr/money.service');
const records = require('../calculations/records.service');

// Group Dashboard data layer. It owns no money logic: every company's monthly figures come from that
// company's own finance service (the same functions its Financials page calls), so a number on the group
// dashboard is always the number the company admin sees. This file only normalises, buckets and compares.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthSchema = z.string().regex(MONTH);
const idx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1;
const at = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
// The current month in the app's own timezone (not UTC), so it turns over at local midnight like the client's does.
const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());

// Alert thresholds are configurable per request; these are only the defaults.
const DEFAULT_THRESHOLDS = { revenue_drop_pct: 20, profit_drop_pct: 20, expense_rise_pct: 30, valuation_drop_pct: 0 };

const overviewQuerySchema = z
  .object({
    from: monthSchema.optional(),
    to: monthSchema.optional(),
    state: z.enum(['locked', 'unlocked', 'all']).default('all'),
    // Revenue/profit are monthly books and valuation uses a monthly asset value, so month is the finest grain.
    granularity: z.enum(['month', 'quarter', 'year']).default('month'),
    org_ids: z.string().optional(),
    revenue_drop_pct: z.coerce.number().min(0).max(100).optional(),
    profit_drop_pct: z.coerce.number().min(0).max(100).optional(),
    expense_rise_pct: z.coerce.number().min(0).max(1000).optional(),
    valuation_drop_pct: z.coerce.number().min(0).max(100).optional(),
  })
  .refine((q) => !q.from || !q.to || idx(q.to) >= idx(q.from), { message: 'The end month cannot be before the start month' })
  .refine((q) => !q.from || !q.to || idx(q.to) - idx(q.from) < 60, { message: 'Pick at most 60 months' });

// The one place the group valuation factors live: valuation = profit x 240 + asset value x 3.
const FORMULA = { profit: 240, asset_value: 3 };

const assetBodySchema = z.object({ month: monthSchema, asset_value: z.coerce.number().min(0).max(1e13), notes: z.string().trim().max(500).optional() });

const isSoon = (org) => Boolean(org.enabled_modules?.includes('coming_soon'));
const kindOf = (org) => (org.enabled_modules?.includes('gulati') ? 'gulati' : org.enabled_modules?.includes('zephyr') ? 'zephyr' : org.enabled_modules?.includes('acconcy') ? 'acconcy' : 'delphic');

// Indian financial year (April - March), the convention the Zephyr presets already use.
function bucketOf(month, granularity) {
  if (granularity === 'month') return { key: month, label: month };
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5));
  const fy = m >= 4 ? y : y - 1;
  const fyLabel = `FY${fy}-${String(fy + 1).slice(2)}`;
  if (granularity === 'year') return { key: String(fy), label: fyLabel };
  const q = Math.floor(((m + 8) % 12) / 3) + 1;
  return { key: `${fy}-${q}`, label: `${fyLabel} Q${q}` };
}

async function groupOrgs(orgGroupIds, orgIds) {
  const ids = orgIds ? orgIds.split(',').map((s) => s.trim()).filter(Boolean) : null;
  return prisma.org.findMany({
    where: { org_group_id: { in: orgGroupIds }, status: 'active', ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, name: true, slug: true, logo_url: true, default_currency: true, enabled_modules: true },
    orderBy: { name: 'asc' },
  });
}

// One company's months in a common shape, whichever finance service owns its books.
async function computeCompanyMonths(org, from, to, state) {
  const kind = kindOf(org);
  if (kind === 'gulati' || kind === 'zephyr') {
    const svc = kind === 'gulati' ? gulatiFinance : zephyrMoney;
    const t = await svc.valuationTrend(org.id, { from, to, state });
    if (t.error) return [];
    return t.months.map((m) => ({
      month: m.month, revenue: m.revenue, profit: m.profit, expenses: round2(m.revenue - m.profit),
      asset_value: m.asset_value, asset_value_carried: m.asset_value_carried, profit_x: m.profit_x, asset_value_x: m.asset_value_x,
      valuation: m.valuation, closed: Boolean(m.closed),
    }));
  }
  if (kind === 'acconcy') {
    // Acconcy computes every month live from its own ledger, salaries, assets and investments (no per-month lock view).
    const at = await acconcyFinance.valuationTrend(org.id, { from, to });
    if (at.error) return [];
    return at.months.map((m) => ({
      month: m.month, revenue: m.revenue, profit: m.profit, expenses: round2(m.revenue - m.profit),
      asset_value: m.asset_value, asset_value_carried: false, profit_x: m.profit_component, asset_value_x: m.asset_component,
      valuation: m.total, closed: Boolean(m.closed),
    }));
  }
  const t = await financialsService.trends(org.id, { months: 12, state, from_year: Number(from.slice(0, 4)), from_month: Number(from.slice(5)), to_year: Number(to.slice(0, 4)), to_month: Number(to.slice(5)) });
  return t.months.map((m) => ({
    month: m.month, revenue: m.revenue, profit: m.profit, expenses: round2(m.revenue - m.profit),
    asset_value: m.asset_value, asset_value_carried: m.asset_value_carried, profit_x: m.delphic_profit_x, asset_value_x: m.asset_value_x,
    valuation: m.valuation, closed: null,
  }));
}

// The Delphic engine prices every project for every month, which is ~300 queries a month: cheap on a local database,
// far too slow over a remote one. So each company-month is cached on its own (key: company, month, figures view) and
// served stale-while-revalidate - always instant once warm, refreshed in the background after FRESH_MS. Any window
// (this quarter, a custom range, the previous period) is assembled from cached months, so changing a filter only
// computes months that have never been seen. Concurrent callers share one computation. Off in tests so assertions
// always see fresh data.
const FRESH_MS = 120_000;
const MAX_ENTRIES = 2000;
const monthsCache = new Map(); // key -> { value, at, promise }

function cachedMonth(org, month, state) {
  const key = `${org.id}|${month}|${state || ''}`;
  const entry = monthsCache.get(key);
  const refresh = () => {
    const promise = computeCompanyMonths(org, month, month, state).then(
      (rows) => {
        const value = rows[0] || null;
        monthsCache.set(key, { value, at: Date.now(), promise: null });
        if (monthsCache.size > MAX_ENTRIES) monthsCache.delete(monthsCache.keys().next().value);
        return value;
      },
      (err) => {
        const cur = monthsCache.get(key);
        if (cur && cur.value !== undefined && cur.at) cur.promise = null;
        else monthsCache.delete(key);
        throw err;
      },
    );
    const cur = monthsCache.get(key);
    if (cur) cur.promise = promise;
    else monthsCache.set(key, { value: undefined, at: 0, promise });
    return promise;
  };
  if (entry && entry.at && Date.now() - entry.at < FRESH_MS) return Promise.resolve(entry.value);
  if (entry?.promise) return entry.at ? Promise.resolve(entry.value) : entry.promise;
  if (entry?.at) {
    refresh().catch(() => {});
    return Promise.resolve(entry.value);
  }
  return refresh();
}

async function companyMonths(org, from, to, state) {
  if (process.env.NODE_ENV === 'test') return computeCompanyMonths(org, from, to, state);
  const keys = [];
  for (let i = idx(from); i <= idx(to); i += 1) keys.push(at(i));
  const rows = await Promise.all(keys.map((m) => cachedMonth(org, m, state)));
  return rows.filter(Boolean);
}

function invalidateCompany(orgId) {
  for (const key of [...monthsCache.keys()]) if (key.startsWith(`${orgId}|`)) monthsCache.delete(key);
}

/** Computes the default Group Dashboard window once in the background (called after the server starts). */
async function warmUp() {
  const groups = await prisma.orgGroupMembership.findMany({ distinct: ['org_group_id'], select: { org_group_id: true } });
  if (!groups.length) return;
  const ids = groups.map((g) => g.org_group_id);
  await overview(ids, {}); // last 12 months + the 12 before (previous-period change)
  const now = currentMonth();
  const fyStart = Number(now.slice(5)) >= 4 ? `${now.slice(0, 4)}-04` : `${Number(now.slice(0, 4)) - 1}-04`;
  await overview(ids, { from: fyStart, to: now }); // financial year to date
}

const projectionQuerySchema = z
  .object({
    from: monthSchema.optional(),
    to: monthSchema.optional(),
    horizon: z.coerce.number().int().min(1).max(12).default(6),
    state: z.enum(['locked', 'unlocked', 'all']).default('all'),
    org_ids: z.string().optional(),
  })
  .refine((q) => !q.from || !q.to || idx(q.to) >= idx(q.from), { message: 'The end month cannot be before the start month' })
  .refine((q) => !q.from || !q.to || idx(q.to) - idx(q.from) < 36, { message: 'Pick at most 36 months' });

/**
 * Projection + valuation for every company, from the SAME monthly books the Group Finance tab uses (companyMonths).
 * History = start..end month (what is shown as actuals). The projection runs for `horizon` months from the month after
 * the end month - but never later than the CURRENT month, so a history that ends this month still projects this month
 * (its actuals are only to date) and the months after it. Its basis is a straight-line (least squares) fit of the last
 * six COMPLETE months before the projection starts that have figures, separately for revenue and costs, whatever the
 * history window is (a one-month window projects as well as a year). Projected valuation = projected profit x 240 +
 * the latest asset value x 3.
 */
async function projection(orgGroupIds, query = {}) {
  const q = projectionQuerySchema.parse(query);
  const now = currentMonth();
  const to = q.to || now;
  const from = q.from || at(idx(to) - 11);
  const orgs = await groupOrgs(orgGroupIds, q.org_ids);
  const startIdx = Math.min(idx(to) + 1, idx(now));
  const futureKeys = Array.from({ length: q.horizon }, (_, k) => at(startIdx + k));
  const basisFrom = at(startIdx - 6);
  const basisTo = at(startIdx - 1);

  const companies = await Promise.all(orgs.map(async (org) => {
    const orgOut = { id: org.id, name: org.name, slug: org.slug, logo_url: org.logo_url, currency: org.default_currency, kind: kindOf(org), enabled_modules: org.enabled_modules, coming_soon: isSoon(org) };
    if (isSoon(org)) return { org: orgOut, coming_soon: true, history: [], projected: [], totals: null, confidence: 'low' };
    const [months, basisMonths] = await Promise.all([companyMonths(org, from, to, q.state), companyMonths(org, basisFrom, basisTo, q.state)]);
    const history = months.map((m) => ({ month: m.month, revenue: m.revenue, expenses: m.expenses, profit: m.profit, asset_value: m.asset_value, valuation: m.valuation, closed: m.closed }));
    // Basis: the last six COMPLETE months before the projection starts that carry figures (the month in progress is not a full month).
    const basis = basisMonths.filter((m) => m.month < now && (m.revenue || m.expenses || m.profit));
    const revenue = financialsService.linearForecast(basis.map((m) => m.revenue), q.horizon);
    const cost = financialsService.linearForecast(basis.map((m) => m.expenses), q.horizon);
    const asset = history.length ? history[history.length - 1].asset_value : 0;
    const projected = futureKeys.map((month, i) => {
      const profit = round2(revenue[i] - cost[i]);
      return { month, revenue: revenue[i], expenses: cost[i], profit, asset_value: asset, valuation: round2(profit * FORMULA.profit + asset * FORMULA.asset_value) };
    });
    const sum = (rows, k) => round2(rows.reduce((a, r) => a + r[k], 0));
    const last = history[history.length - 1] || null;
    return {
      org: orgOut,
      coming_soon: false,
      history,
      projected,
      confidence: basis.length >= 6 ? 'high' : basis.length >= 3 ? 'medium' : 'low',
      totals: {
        history_revenue: sum(history, 'revenue'), history_profit: sum(history, 'profit'),
        projected_revenue: sum(projected, 'revenue'), projected_profit: sum(projected, 'profit'),
        current_valuation: last ? last.valuation : null,
        projected_valuation: projected.length ? projected[projected.length - 1].valuation : null,
      },
    };
  }));

  const live = companies.filter((c) => !c.coming_soon);
  const currencies = [...new Set(live.map((c) => c.org.currency))];
  const byMonth = (pick) => {
    const keys = [...new Set(live.flatMap((c) => pick(c).map((r) => r.month)))].sort();
    return keys.map((month) => {
      const rows = live.flatMap((c) => pick(c).filter((r) => r.month === month));
      return { month, revenue: round2(rows.reduce((a, r) => a + r.revenue, 0)), profit: round2(rows.reduce((a, r) => a + r.profit, 0)), valuation: round2(rows.reduce((a, r) => a + r.valuation, 0)) };
    });
  };
  const gh = byMonth((c) => c.history);
  const gp = byMonth((c) => c.projected);
  const tot = (k) => round2(live.reduce((a, c) => a + (c.totals[k] || 0), 0));
  return {
    from, to, horizon: q.horizon, state: q.state, formula: FORMULA, projected_months: futureKeys, basis_from: basisFrom, basis_to: basisTo,
    currency: currencies.length === 1 ? currencies[0] : null, mixed_currency: currencies.length > 1,
    companies,
    group: {
      history: gh, projected: gp,
      totals: { history_revenue: tot('history_revenue'), history_profit: tot('history_profit'), projected_revenue: tot('projected_revenue'), projected_profit: tot('projected_profit'), current_valuation: tot('current_valuation'), projected_valuation: tot('projected_valuation') },
    },
  };
}

function bucketSeries(months, granularity) {
  const out = new Map();
  for (const m of months) {
    const b = bucketOf(m.month, granularity);
    const row = out.get(b.key) || { key: b.key, label: b.label, revenue: 0, expenses: 0, profit: 0 };
    row.revenue += m.revenue;
    row.expenses += m.expenses;
    row.profit += m.profit;
    // Stock values (assets, valuation) are a point in time: the last month of the bucket.
    row.asset_value = m.asset_value;
    row.profit_x = m.profit_x;
    row.asset_value_x = m.asset_value_x;
    row.valuation = m.valuation;
    row.last_month = m.month;
    out.set(b.key, row);
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key)).map((r) => ({ ...r, revenue: round2(r.revenue), expenses: round2(r.expenses), profit: round2(r.profit), margin_pct: r.revenue ? round2((r.profit / r.revenue) * 100) : null }));
}

const pct = (cur, prev) => (prev === null || prev === undefined || !Number(prev) ? null : round2(((cur - prev) / Math.abs(prev)) * 100));

function alertsFor(company, thresholds, nowMonth) {
  const out = [];
  const s = company.series;
  // Compare the last two COMPLETE periods (skip a still-running current month when there is an earlier one).
  const done = s.filter((r) => r.last_month < nowMonth);
  const [prev, cur] = done.length >= 2 ? [done[done.length - 2], done[done.length - 1]] : [null, null];
  const push = (type, severity, message) => out.push({ org_id: company.org.id, org_name: company.org.name, type, severity, message });
  if (cur && prev) {
    const rev = pct(cur.revenue, prev.revenue);
    const exp = pct(cur.expenses, prev.expenses);
    const prof = pct(cur.profit, prev.profit);
    const val = pct(cur.valuation, prev.valuation);
    if (rev !== null && rev <= -thresholds.revenue_drop_pct && rev < 0) push('revenue_drop', 'warning', `Revenue fell ${Math.abs(rev)}% (${prev.label} to ${cur.label})`);
    if (prof !== null && prof <= -thresholds.profit_drop_pct && prof < 0) push('profit_drop', 'warning', `Profit fell ${Math.abs(prof)}% (${prev.label} to ${cur.label})`);
    if (exp !== null && exp >= thresholds.expense_rise_pct && exp > 0) push('expense_rise', 'warning', `Costs rose ${exp}% (${prev.label} to ${cur.label})`);
    if (val !== null && val < 0 && Math.abs(val) >= thresholds.valuation_drop_pct) push('valuation_drop', 'warning', `Valuation fell ${Math.abs(val)}% (${prev.label} to ${cur.label})`);
  }
  const loss = s.filter((r) => r.profit < 0);
  if (loss.length) push('loss_period', 'critical', `Loss in ${loss.length} period(s), latest ${loss[loss.length - 1].label}`);
  // Months in the past that carry figures but were never locked (only companies that lock months report this).
  const unlocked = company.months.filter((m) => m.closed === false && m.month < nowMonth && (m.revenue || m.profit));
  if (unlocked.length) push('pending_lock', 'info', `${unlocked.length} past month(s) with figures are not locked yet`);
  if (!company.months.some((m) => m.asset_value > 0)) push('no_asset_value', 'info', 'No asset value recorded - valuation uses profit only');
  return out;
}

async function overview(orgGroupIds, query = {}) {
  const q = overviewQuerySchema.parse(query);
  const now = currentMonth();
  const to = q.to || now;
  const from = q.from || at(idx(to) - 11);
  const thresholds = { ...DEFAULT_THRESHOLDS, ...Object.fromEntries(Object.entries(q).filter(([k, v]) => k in DEFAULT_THRESHOLDS && v !== undefined)) };
  const orgs = await groupOrgs(orgGroupIds, q.org_ids);

  // Headcount for every selected company in one grouped query.
  const heads = await prisma.orgMembership.groupBy({ by: ['org_id', 'worker_type'], where: { org_id: { in: orgs.map((o) => o.id) }, employment_status: { not: 'terminated' }, person: { is_group_superadmin: false } }, _count: { _all: true } });
  const headBy = new Map();
  for (const h of heads) {
    const e = headBy.get(h.org_id) || { employees: 0, contractors: 0 };
    if (h.worker_type === 'contractor') e.contractors += h._count._all;
    else e.employees += h._count._all;
    headBy.set(h.org_id, e);
  }

  // Every live company's two windows are fetched at the same time (each is cached, see companyMonths).
  const span = idx(to) - idx(from) + 1;
  const monthData = await Promise.all(orgs.map((org) => (isSoon(org) ? null : Promise.all([
    companyMonths(org, from, to, q.state),
    companyMonths(org, at(idx(from) - span), at(idx(from) - 1), q.state),
  ]))));

  const companies = [];
  for (const [i, org] of orgs.entries()) {
    if (isSoon(org)) {
      // Not built yet: listed so it is visible, but it has no figures and is left out of every total.
      companies.push({
        org: { id: org.id, name: org.name, slug: org.slug, logo_url: org.logo_url, currency: org.default_currency, kind: 'coming_soon', coming_soon: true },
        coming_soon: true, has_data: false, months: [], series: [],
        totals: { revenue: 0, expenses: 0, profit: 0, margin_pct: null }, assets: 0, valuation: null, people: { employees: 0, contractors: 0 },
      });
      continue;
    }
    // monthData holds the selected period and the one just before it (same length), for the change on the group cards.
    const [months, prevMonths] = monthData[i];
    const series = bucketSeries(months, q.granularity);
    const last = series[series.length - 1] || null;
    const prior = series.length > 1 ? series[series.length - 2] : null;
    const totals = series.reduce((a, r) => ({ revenue: a.revenue + r.revenue, expenses: a.expenses + r.expenses, profit: a.profit + r.profit }), { revenue: 0, expenses: 0, profit: 0 });
    const hasBooks = months.some((m) => m.revenue || m.profit || m.asset_value);
    companies.push({
      org: { id: org.id, name: org.name, slug: org.slug, logo_url: org.logo_url, currency: org.default_currency, kind: kindOf(org) },
      has_data: hasBooks,
      previous_totals: prevMonths.length
        ? { revenue: round2(prevMonths.reduce((a, m) => a + m.revenue, 0)), expenses: round2(prevMonths.reduce((a, m) => a + m.expenses, 0)), profit: round2(prevMonths.reduce((a, m) => a + m.profit, 0)), assets: prevMonths[prevMonths.length - 1].asset_value, valuation: prevMonths[prevMonths.length - 1].valuation }
        : null,
      months,
      series,
      totals: { revenue: round2(totals.revenue), expenses: round2(totals.expenses), profit: round2(totals.profit), margin_pct: totals.revenue ? round2((totals.profit / totals.revenue) * 100) : null },
      assets: last ? last.asset_value : 0,
      valuation: last
        ? {
            current: last.valuation,
            previous: prior ? prior.valuation : null,
            change: prior ? round2(last.valuation - prior.valuation) : null,
            growth_pct: prior ? pct(last.valuation, prior.valuation) : null,
            as_of: last.label,
            profit_component: last.profit_x,
            asset_component: last.asset_value_x,
          }
        : null,
      people: headBy.get(org.id) || { employees: 0, contractors: 0 },
    });
  }

  const live = companies.filter((c) => !c.coming_soon);
  const currencies = [...new Set(live.map((c) => c.org.currency))];
  const sum = (pick) => round2(live.reduce((s, c) => s + pick(c), 0));
  const totals = {
    currency: currencies.length === 1 ? currencies[0] : null,
    mixed_currency: currencies.length > 1,
    revenue: sum((c) => c.totals.revenue),
    expenses: sum((c) => c.totals.expenses),
    profit: sum((c) => c.totals.profit),
    assets: sum((c) => c.assets),
    // Not an official group valuation rule: a plain sum of the company valuations, labelled as such.
    valuation: sum((c) => c.valuation?.current || 0),
    valuation_method: 'sum_of_company_valuations',
    active_companies: live.length,
    coming_soon_companies: companies.length - live.length,
    employees: live.reduce((s, c) => s + c.people.employees, 0),
    contractors: live.reduce((s, c) => s + c.people.contractors, 0),
  };
  // Change against the previous period of the same length (null when there is nothing to compare with).
  const withPrev = live.filter((c) => c.previous_totals);
  const psum = (k) => round2(withPrev.reduce((a, c) => a + (c.previous_totals[k] || 0), 0));
  totals.previous = withPrev.length ? { revenue: psum('revenue'), expenses: psum('expenses'), profit: psum('profit'), assets: psum('assets'), valuation: psum('valuation') } : null;
  totals.change_pct = totals.previous
    ? { revenue: pct(totals.revenue, totals.previous.revenue), expenses: pct(totals.expenses, totals.previous.expenses), profit: pct(totals.profit, totals.previous.profit), assets: pct(totals.assets, totals.previous.assets), valuation: pct(totals.valuation, totals.previous.valuation) }
    : null;
  totals.margin_pct = totals.revenue ? round2((totals.profit / totals.revenue) * 100) : null;

  // Group trend: one row per bucket, one column per company (and the group total), for the comparison graphs.
  const keys = [...new Set(live.flatMap((c) => c.series.map((r) => r.key)))].sort();
  const labelOf = new Map(live.flatMap((c) => c.series.map((r) => [r.key, r.label])));
  const trend = (metric) =>
    keys.map((key) => {
      const row = { key, label: labelOf.get(key) };
      let total = 0;
      for (const c of live) {
        const v = c.series.find((r) => r.key === key)?.[metric];
        row[c.org.id] = v ?? null;
        total += v || 0;
      }
      row.total = round2(total);
      return row;
    });

  const share = (pick) => {
    const all = live.reduce((s, c) => s + Math.max(0, pick(c)), 0);
    return live.map((c) => ({ org_id: c.org.id, org_name: c.org.name, value: pick(c), share_pct: all ? round2((Math.max(0, pick(c)) / all) * 100) : null })).sort((a, b) => b.value - a.value);
  };
  const rank = (pick) => [...live].sort((a, b) => pick(b) - pick(a)).map((c, i) => ({ rank: i + 1, org_id: c.org.id, org_name: c.org.name, value: pick(c) }));

  return {
    filters: { from, to, state: q.state, granularity: q.granularity, org_ids: q.org_ids ? q.org_ids.split(',') : null },
    thresholds,
    formula: FORMULA,
    notes: {
      inter_company: 'Group figures add the companies together. Intra-group charges are not eliminated.',
      valuation: 'Group valuation is the plain sum of each company valuation; each company is also shown on its own.',
      granularity: 'Month is the finest period (books and asset values are monthly). Stock values use the last month of the period.',
    },
    totals,
    companies,
    trends: { revenue: trend('revenue'), expenses: trend('expenses'), profit: trend('profit'), valuation: trend('valuation'), assets: trend('asset_value') },
    contribution: { revenue: share((c) => c.totals.revenue), profit: share((c) => c.totals.profit) },
    rankings: {
      revenue: rank((c) => c.totals.revenue),
      profit: rank((c) => c.totals.profit),
      valuation: rank((c) => c.valuation?.current || 0),
      growth: rank((c) => c.valuation?.growth_pct ?? -Infinity).map((r) => ({ ...r, value: Number.isFinite(r.value) ? r.value : null })),
    },
    alerts: live.flatMap((c) => alertsFor(c, thresholds, now)),
  };
}

// --- Drill-down: where a company's revenue / expenses / profit come from ---

const drillQuerySchema = z.object({ from: monthSchema, to: monthSchema, state: z.enum(['locked', 'unlocked', 'all']).default('all') })
  .refine((q) => idx(q.to) >= idx(q.from) && idx(q.to) - idx(q.from) < 60, { message: 'Pick a valid range of at most 60 months' });
const monthEndDay = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

// Each company reports its own source breakdown through its own service; this only labels and shapes it.
async function drilldown(org, query) {
  const q = drillQuerySchema.parse(query);
  const kind = kindOf(org);
  const sections = [];
  const sec = (key, title, columns, rows) => sections.push({ key, title, columns, rows });
  if (kind === 'zephyr') {
    const rows = await zephyrMoney.byProject(org.id, `${q.from}-01`, monthEndDay(q.to));
    sec('projects', 'Projects', ['Project', 'Revenue', 'Expense', 'Salaries', 'Profit'], rows.map((r) => [r.code ? `${r.code} ${r.name}` : r.name, r.revenue, r.expense, r.salaries, r.profit]));
  } else if (kind === 'gulati') {
    const p = await gulatiFinance.pnl(org.id, { from: `${q.from}-01`, to: monthEndDay(q.to) });
    sec('deals', 'Deals', ['Deal', 'Type', 'Sales', 'Net profit'], p.by_deal.map((d) => [d.code ? `${d.code} ${d.name || ''}`.trim() : 'Company-level', d.trading_type || '', d.sales_revenue, d.net_profit]));
    sec('types', 'Trading types', ['Type', 'Sales', 'Net profit'], p.by_trading_type.map((t) => [t.label, t.sales_revenue, t.net_profit]));
  } else if (kind === 'acconcy') {
    const p = await acconcyFinance.pnl(org.id, { from: `${q.from}-01`, to: monthEndDay(q.to) });
    sec('deals', 'Deals', ['Deal', 'Service', 'Revenue', 'Net profit'], p.by_deal.map((d) => [d.code ? `${d.code} ${d.name || ''}`.trim() : 'Company-level', d.service_type || '', d.revenue, d.net_profit]));
    sec('services', 'Services', ['Service', 'Revenue', 'Net profit'], p.by_service.map((t) => [t.label, t.revenue, t.net_profit]));
  } else {
    const merged = new Map();
    for (let y = Number(q.from.slice(0, 4)); y <= Number(q.to.slice(0, 4)); y += 1) {
      const rec = await records.financialRecords(org.id, { period_year: y, from_month: y === Number(q.from.slice(0, 4)) ? Number(q.from.slice(5)) : 1, to_month: y === Number(q.to.slice(0, 4)) ? Number(q.to.slice(5)) : 12, state: q.state });
      for (const cat of rec.categories) {
        for (const child of cat.children?.length ? cat.children : [cat]) {
          const k = `${cat.label}|${child.label}`;
          const row = merged.get(k) || { category: cat.label, item: child.label, amount: 0 };
          row.amount = round2(row.amount + child.amount);
          merged.set(k, row);
        }
      }
    }
    sec('categories', 'Revenue, salaries and expenses', ['Category', 'Item', 'Amount'], [...merged.values()].map((r) => [r.category, r.item, r.amount]));
  }
  return { org: { id: org.id, name: org.name }, from: q.from, to: q.to, state: q.state, note: kind === 'delphic' ? 'Figures follow the selected Locked / Unlocked / All view.' : 'Source figures are live (not the frozen month snapshot).', sections };
}

// --- Monthly asset values (the manual input behind each company's valuation) ---

async function listAssetValues(org) {
  const kind = kindOf(org);
  if (kind === 'gulati') return (await prisma.gxAssetValue.findMany({ where: { org_id: org.id }, orderBy: { month: 'desc' } })).map(plainAsset);
  if (kind === 'acconcy') return [];
  if (kind === 'zephyr') return (await prisma.zxAssetValue.findMany({ where: { org_id: org.id }, orderBy: { month: 'desc' } })).map(plainAsset);
  const rows = await prisma.financialAssetValue.findMany({ where: { org_id: org.id }, orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }] });
  return rows.map((r) => ({ id: r.id, month: `${r.period_year}-${String(r.period_month).padStart(2, '0')}`, asset_value: num(r.asset_value), notes: r.notes, updated_at: r.updated_at }));
}
const plainAsset = (r) => ({ id: r.id, month: r.month, asset_value: num(r.asset_value), notes: r.notes, updated_at: r.updated_at });

async function companyInGroup(orgGroupIds, orgId) {
  return prisma.org.findFirst({ where: { id: orgId, org_group_id: { in: orgGroupIds } }, select: { id: true, name: true, enabled_modules: true } });
}

// History is kept: a revised month updates that month's row and is audited with the previous value;
// other months are never touched. Company audit trails (Gx/Zx audit, audit_logs) record who and when.
async function setAssetValue(orgGroupIds, actorId, orgId, input) {
  const org = await companyInGroup(orgGroupIds, orgId);
  if (!org) return { error: 'not_found' };
  if (input.month > currentMonth()) return { error: 'future_month' };
  const kind = kindOf(org);
  invalidateCompany(org.id);
  if (kind === 'acconcy') return { error: 'managed_in_company' };
  const before = (await listAssetValues(org)).find((r) => r.month === input.month) || null;
  let result;
  if (kind === 'gulati') result = await gulatiFinance.setAssetValue(org.id, actorId, input);
  else if (kind === 'zephyr') result = await zephyrMoney.setAssetValue(org.id, actorId, input);
  else {
    const row = await financialsService.upsertAssetValue(org.id, actorId, { period_year: Number(input.month.slice(0, 4)), period_month: Number(input.month.slice(5)), asset_value: input.asset_value, notes: input.notes });
    result = { asset: { id: row.id, month: input.month, asset_value: row.asset_value, notes: row.notes } };
  }
  if (result.error) return result;
  // One group-level trail for all companies, so the activity feed can show it.
  await prisma.auditLog.create({
    data: {
      org_id: org.id, actor_id: actorId, action: before ? 'asset_value_update' : 'asset_value_create', entity_type: 'asset_value', entity_id: result.asset.id,
      reason: `Asset value ${input.month}`, snapshot: { company: org.name, month: input.month, previous: before ? before.asset_value : null, new: input.asset_value },
    },
  });
  invalidateCompany(org.id);
  return { asset: result.asset, previous: before ? before.asset_value : null };
}

// Recent changes across the companies the caller may see.
async function activity(orgGroupIds, limit = 30, days = 7) {
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 90) * 86400000);
  const rows = await prisma.auditLog.findMany({
    where: { org: { org_group_id: { in: orgGroupIds } }, created_at: { gte: since } },
    orderBy: { created_at: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    select: { id: true, action: true, entity_type: true, reason: true, snapshot: true, created_at: true, actor_id: true, org: { select: { id: true, name: true } } },
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actor_id))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, at: r.created_at, actor: name.get(r.actor_id) || null, company: r.org, action: r.action, entity: r.entity_type, detail: r.reason, snapshot: r.snapshot }));
}

module.exports = { warmUp, projection, projectionQuerySchema, drilldown, overviewQuerySchema, assetBodySchema, overview, listAssetValues, companyInGroup, setAssetValue, activity, bucketOf, DEFAULT_THRESHOLDS };
