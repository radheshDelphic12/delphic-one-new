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
const currentMonth = () => new Date().toISOString().slice(0, 7);

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
async function companyMonths(org, from, to, state) {
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

  const companies = [];
  for (const org of orgs) {
    if (isSoon(org)) {
      // Not built yet: listed so it is visible, but it has no figures and is left out of every total.
      companies.push({
        org: { id: org.id, name: org.name, slug: org.slug, logo_url: org.logo_url, currency: org.default_currency, kind: 'coming_soon', coming_soon: true },
        coming_soon: true, has_data: false, months: [], series: [],
        totals: { revenue: 0, expenses: 0, profit: 0, margin_pct: null }, assets: 0, valuation: null, people: { employees: 0, contractors: 0 },
      });
      continue;
    }
    // The period just before the selected one (same length), for the change shown on the group cards.
    const span = idx(to) - idx(from) + 1;
    const [months, prevMonths] = await Promise.all([
      companyMonths(org, from, to, q.state),
      companyMonths(org, at(idx(from) - span), at(idx(from) - 1), q.state),
    ]);
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
    formula: { profit: 240, asset_value: 3 },
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

module.exports = { drilldown, overviewQuerySchema, assetBodySchema, overview, listAssetValues, companyInGroup, setAssetValue, activity, bucketOf, DEFAULT_THRESHOLDS };
