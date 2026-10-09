const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const campaigns = require('./campaigns.service');
const calc = require('./campaign.calc');
const { isClosed } = require('./periods');

const { round2, dayOf, monthOf, idx, at, monthsBetween } = calc;
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());
const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const monthEnd = (m) => dayOf(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)));

const filterSchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  category_id: z.string().uuid().optional(),
  status: z.string().optional(),
  state: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  q: z.string().trim().max(100).optional(),
  manager_id: z.string().uuid().optional(),
});
const trendSchema = z.object({ from: monthStr.optional(), to: monthStr.optional(), state: z.enum(['locked', 'unlocked', 'all']).optional() });
const closeSchema = z.object({ note: z.string().trim().max(500).optional() });
const reopenSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const reportSchema = filterSchema.extend({ report: z.string().default('campaign_budget') });

// Indian financial year quarters (April - March), the convention the group dashboard uses.
function fyQuarter(month) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5));
  const fy = m >= 4 ? y : y - 1;
  const q = Math.floor(((m + 8) % 12) / 3) + 1;
  return `FY${fy}-${String(fy + 1).slice(2)} Q${q}`;
}

/** Campaigns that match the filters, with every figure computed. Money is all-time; `period` is what moved inside from..to. */
async function base(orgId, f) {
  const settings = await core.ensureSettings(orgId);
  const q = { ...f };
  // The date filter picks campaigns whose planned window overlaps it; period money is read separately below.
  const rows = await prisma.fxCampaign.findMany({ where: campaigns.whereOf(orgId, { ...q, from: undefined, to: undefined }) });
  const items = await campaigns.decorate(orgId, rows, { settings });
  const inRange = (e) => (!f.from || dayOf(e.entry_date) >= f.from) && (!f.to || dayOf(e.entry_date) <= f.to);
  return items.map((c) => ({ ...c, period: calc.summarize(c, c._entries.filter(inRange)) }));
}

const sumOf = (items, pick) => round2(items.reduce((a, c) => a + (pick(c) || 0), 0));

function kpis(items) {
  const count = (s) => items.filter((c) => c.status === s).length;
  return {
    campaigns: { total: items.length, draft: count('draft'), planned: count('planned'), active: count('active'), on_hold: count('on_hold'), completed: count('completed'), cancelled: count('cancelled') },
    allocated_budget: sumOf(items, (c) => c.metrics.allocated_budget),
    planned_investment: sumOf(items, (c) => c.metrics.planned_investment),
    actual_expenditure: sumOf(items, (c) => c.metrics.actual_expenditure),
    actual_investment: sumOf(items, (c) => c.metrics.actual_investment),
    commitments: sumOf(items, (c) => c.metrics.commitments),
    funds_received: sumOf(items, (c) => c.metrics.funds_received),
    funds_pledged: sumOf(items, (c) => c.metrics.funds_pledged),
    remaining_allocated: sumOf(items, (c) => c.metrics.remaining_allocated),
    uncommitted: sumOf(items, (c) => c.metrics.uncommitted),
    planned_remaining: sumOf(items, (c) => c.metrics.planned_remaining),
    overspend: sumOf(items, (c) => c.metrics.overspend),
    projected_final_expenditure: sumOf(items, (c) => c.forecast.projected_final_expenditure),
    projected_overrun: sumOf(items, (c) => c.forecast.projected_overrun),
    period: {
      actual_expenditure: sumOf(items, (c) => c.period.actual_expenditure),
      actual_investment: sumOf(items, (c) => c.period.actual_investment),
      funds_received: sumOf(items, (c) => c.period.funds_received),
    },
  };
}

// Month rows summed over many campaigns; every month of the window is present, so a chart never has gaps.
function monthlyTotals(items, from, to, settings, now) {
  const by = new Map();
  const put = (m, k, v) => { const r = by.get(m) || { month: m, planned_investment: 0, actual_investment: 0, actual_expenditure: 0, funding_received: 0, projected: 0 }; r[k] += v; by.set(m, r); };
  for (const c of items) {
    for (const r of calc.monthlySeries(c, c._entries, c._plan)) {
      put(r.month, 'planned_investment', r.planned_investment);
      put(r.month, 'actual_investment', r.actual_investment);
      put(r.month, 'actual_expenditure', r.actual_expenditure);
      put(r.month, 'funding_received', r.funding_received);
    }
    for (const m of calc.forecast(c, c._entries, c._plan, settings, now).monthly || []) put(m.month, 'projected', m.projected);
  }
  const keys = [...by.keys()].sort();
  if (!keys.length && !(from && to)) return [];
  const first = from || keys[0];
  const last = to || keys[keys.length - 1];
  return monthsBetween(first, last).map((m) => {
    const r = by.get(m) || { month: m, planned_investment: 0, actual_investment: 0, actual_expenditure: 0, funding_received: 0, projected: 0 };
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'month' ? v : round2(v)]));
  });
}

function attention(items) {
  const pick = (type) => items.flatMap((c) => c.flags.filter((f) => f.type === type).map((f) => ({ campaign_id: c.id, code: c.code, name: c.name, status: c.status, amount: f.amount, message: f.message })));
  return {
    over_budget: pick('over_budget'),
    projected_overrun: pick('projected_overrun'),
    ending_with_funds: pick('ending_with_funds'),
    behind_plan: pick('behind_plan'),
    delayed: pick('delayed'),
    completed_unspent: pick('completed_unspent'),
    no_budget: pick('no_budget'),
  };
}

async function dashboard(orgId, rawFilter = {}) {
  const f = filterSchema.parse(rawFilter);
  const settings = await core.ensureSettings(orgId);
  const now = new Date();
  const items = await base(orgId, f);
  const fromM = f.from ? f.from.slice(0, 7) : at(idx(currentMonth()) - 11);
  const toM = f.to ? f.to.slice(0, 7) : at(idx(currentMonth()) + 5);
  const byCategory = new Map();
  const byLocation = new Map();
  for (const c of items) {
    const ck = c.category?.name || 'Uncategorised';
    const cr = byCategory.get(ck) || { name: ck, campaigns: 0, allocated_budget: 0, actual_expenditure: 0 };
    cr.campaigns += 1; cr.allocated_budget += c.metrics.allocated_budget; cr.actual_expenditure += c.metrics.actual_expenditure; byCategory.set(ck, cr);
    const lk = [c.city, c.state].filter(Boolean).join(', ') || 'Not set';
    const lr = byLocation.get(lk) || { name: lk, campaigns: 0, allocated_budget: 0, actual_expenditure: 0 };
    lr.campaigns += 1; lr.allocated_budget += c.metrics.allocated_budget; lr.actual_expenditure += c.metrics.actual_expenditure; byLocation.set(lk, lr);
  }
  const rank = (c) => c.flags.filter((x) => x.severity !== 'info').length * 1e12 + c.metrics.actual_expenditure;
  return {
    currency: settings.currency,
    filters: f,
    kpis: kpis(items),
    monthly: monthlyTotals(items, fromM, toM, settings, now),
    attention: attention(items),
    by_category: [...byCategory.values()].map((r) => ({ ...r, allocated_budget: round2(r.allocated_budget), actual_expenditure: round2(r.actual_expenditure) })),
    by_location: [...byLocation.values()].map((r) => ({ ...r, allocated_budget: round2(r.allocated_budget), actual_expenditure: round2(r.actual_expenditure) })),
    campaigns: [...items].sort((a, b) => rank(b) - rank(a)).slice(0, 10).map(campaigns.strip).map(({ period, ...rest }) => rest),
  };
}

// ---------------- reports ----------------
const num = (v) => round2(v || 0);
const cols = {
  code: { key: 'code', label: 'Code' }, name: { key: 'name', label: 'Campaign' }, category: { key: 'category', label: 'Category' }, status: { key: 'status', label: 'Status' },
  location: { key: 'location', label: 'Location' }, end: { key: 'end', label: 'Planned end' },
  allocated: { key: 'allocated', label: 'Allocated budget', type: 'money' }, planned: { key: 'planned', label: 'Planned investment', type: 'money' },
  spent: { key: 'spent', label: 'Actual expenditure', type: 'money' }, invested: { key: 'invested', label: 'Actual investment', type: 'money' },
  remaining: { key: 'remaining', label: 'Remaining budget', type: 'money' }, uncommitted: { key: 'uncommitted', label: 'Uncommitted', type: 'money' },
  util: { key: 'util', label: 'Utilisation %', type: 'pct' }, received: { key: 'received', label: 'Funds received', type: 'money' },
  projected: { key: 'projected', label: 'Projected final expenditure', type: 'money' }, overrun: { key: 'overrun', label: 'Projected overrun', type: 'money' },
};
const loc = (c) => [c.area, c.city, c.state].filter(Boolean).join(', ') || '-';
const baseRow = (c) => ({ id: c.id, code: c.code, name: c.name, category: c.category?.name || '-', status: c.status, location: loc(c), end: c.planned_end || '-', allocated: c.metrics.allocated_budget, planned: c.metrics.planned_investment, spent: c.metrics.actual_expenditure, invested: c.metrics.actual_investment, remaining: c.metrics.remaining_allocated, uncommitted: c.metrics.uncommitted, util: c.metrics.utilization_pct, received: c.metrics.funds_received, projected: c.forecast.projected_final_expenditure, overrun: c.forecast.projected_overrun });
const totalsOf = (rows, keys) => Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0))]));

function groupRows(items, keyOf, label) {
  const by = new Map();
  for (const c of items) {
    const k = keyOf(c);
    const r = by.get(k) || { name: k, campaigns: 0, allocated: 0, planned: 0, spent: 0, invested: 0, remaining: 0 };
    r.campaigns += 1; r.allocated += c.metrics.allocated_budget; r.planned += c.metrics.planned_investment; r.spent += c.metrics.actual_expenditure; r.invested += c.metrics.actual_investment; r.remaining += c.metrics.remaining_allocated;
    by.set(k, r);
  }
  return { rows: [...by.values()].map((r) => ({ ...r, allocated: num(r.allocated), planned: num(r.planned), spent: num(r.spent), invested: num(r.invested), remaining: num(r.remaining), util: r.allocated > 0 ? round2((r.spent / r.allocated) * 100) : null })).sort((a, b) => b.allocated - a.allocated), label };
}

const REPORTS = {
  campaign_budget: { title: 'Campaign-wise budget allocation' },
  category_budget: { title: 'Category-wise budget allocation' },
  location_spend: { title: 'Location-wise spending' },
  planned_vs_actual: { title: 'Planned versus actual investment, by month' },
  monthly_expenditure: { title: 'Monthly expenditure' },
  quarterly_expenditure: { title: 'Quarterly expenditure' },
  funding_vs_expenditure: { title: 'Funding received versus expenditure' },
  utilization: { title: 'Budget utilisation' },
  remaining_budget: { title: 'Remaining and uncommitted budget' },
  projected_expenditure: { title: 'Projected expenditure' },
  over_budget: { title: 'Campaigns over budget or projected to exceed it' },
  completed_unspent: { title: 'Completed campaigns with unspent funds' },
  active_by_category_location: { title: 'Active campaigns by category and location' },
};

async function report(orgId, rawQuery = {}) {
  const { report: type, ...rest } = reportSchema.parse(rawQuery);
  if (!REPORTS[type]) return { error: 'unknown_report' };
  const f = filterSchema.parse(rest);
  const settings = await core.ensureSettings(orgId);
  const now = new Date();
  const items = await base(orgId, f);
  const meta = { type, title: REPORTS[type].title, filters: f, reports: Object.entries(REPORTS).map(([key, v]) => ({ key, title: v.title })) };
  const monthWindow = () => {
    const to = f.to ? f.to.slice(0, 7) : currentMonth();
    const from = f.from ? f.from.slice(0, 7) : at(idx(to) - 11);
    return monthlyTotals(items, from, to, settings, now);
  };
  const money = (rows, keys) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keys.includes(k) ? num(v) : v])));

  switch (type) {
    case 'campaign_budget': {
      const rows = items.map(baseRow);
      return { ...meta, columns: [cols.code, cols.name, cols.category, cols.status, cols.location, cols.allocated, cols.planned, cols.spent, cols.remaining], rows, totals: totalsOf(rows, ['allocated', 'planned', 'spent', 'remaining']), chart: { kind: 'bar', x: 'code', series: [{ key: 'allocated', label: 'Allocated' }, { key: 'spent', label: 'Spent' }] } };
    }
    case 'category_budget':
    case 'location_spend': {
      const g = type === 'category_budget' ? groupRows(items, (c) => c.category?.name || 'Uncategorised') : groupRows(items, (c) => [c.city, c.state].filter(Boolean).join(', ') || 'Not set');
      const columns = [{ key: 'name', label: type === 'category_budget' ? 'Category' : 'Location' }, { key: 'campaigns', label: 'Campaigns' }, cols.allocated, cols.planned, cols.spent, cols.invested, cols.remaining, cols.util];
      return { ...meta, columns, rows: g.rows, totals: totalsOf(g.rows, ['allocated', 'planned', 'spent', 'invested', 'remaining']), chart: { kind: 'bar', x: 'name', series: [{ key: 'allocated', label: 'Allocated' }, { key: 'spent', label: 'Spent' }] } };
    }
    case 'planned_vs_actual': {
      const rows = monthWindow().map((r) => ({ month: r.month, planned: r.planned_investment, invested: r.actual_investment, spent: r.actual_expenditure }));
      let cumPlanned = 0; let cumActual = 0;
      const withRem = rows.map((r) => { cumPlanned += r.planned; cumActual += r.invested; return { ...r, remaining: Math.max(0, round2(cumPlanned - cumActual)) }; });
      return { ...meta, columns: [{ key: 'month', label: 'Month' }, { key: 'planned', label: 'Planned investment', type: 'money' }, { key: 'invested', label: 'Actual investment', type: 'money' }, { key: 'spent', label: 'Actual expenditure', type: 'money' }, { key: 'remaining', label: 'Planned still to invest (cumulative)', type: 'money' }], rows: withRem, totals: totalsOf(withRem, ['planned', 'invested', 'spent']), chart: { kind: 'bar', x: 'month', series: [{ key: 'planned', label: 'Planned' }, { key: 'invested', label: 'Actual investment' }] } };
    }
    case 'monthly_expenditure': {
      const rows = monthWindow().map((r) => ({ month: r.month, spent: r.actual_expenditure, invested: r.actual_investment, operational: round2(r.actual_expenditure - r.actual_investment) }));
      return { ...meta, columns: [{ key: 'month', label: 'Month' }, cols.spent, cols.invested, { key: 'operational', label: 'Operational', type: 'money' }], rows, totals: totalsOf(rows, ['spent', 'invested', 'operational']), chart: { kind: 'bar', x: 'month', series: [{ key: 'invested', label: 'Programme investment' }, { key: 'operational', label: 'Operational' }] } };
    }
    case 'quarterly_expenditure': {
      const by = new Map();
      for (const r of monthWindow()) {
        const q = fyQuarter(r.month);
        const row = by.get(q) || { quarter: q, spent: 0, invested: 0, received: 0 };
        row.spent += r.actual_expenditure; row.invested += r.actual_investment; row.received += r.funding_received; by.set(q, row);
      }
      const rows = money([...by.values()], ['spent', 'invested', 'received']);
      return { ...meta, columns: [{ key: 'quarter', label: 'Quarter (April-March year)' }, cols.spent, cols.invested, cols.received], rows, totals: totalsOf(rows, ['spent', 'invested', 'received']), chart: { kind: 'bar', x: 'quarter', series: [{ key: 'spent', label: 'Expenditure' }, { key: 'received', label: 'Funds received' }] } };
    }
    case 'funding_vs_expenditure': {
      const rows = monthWindow().map((r) => ({ month: r.month, received: r.funding_received, spent: r.actual_expenditure, net: round2(r.funding_received - r.actual_expenditure) }));
      return { ...meta, columns: [{ key: 'month', label: 'Month' }, cols.received, cols.spent, { key: 'net', label: 'Net (received - spent)', type: 'money' }], rows, totals: totalsOf(rows, ['received', 'spent', 'net']), chart: { kind: 'line', x: 'month', series: [{ key: 'received', label: 'Funds received' }, { key: 'spent', label: 'Expenditure' }] } };
    }
    case 'utilization': {
      const rows = items.map(baseRow).filter((r) => r.allocated > 0).sort((a, b) => (b.util || 0) - (a.util || 0));
      return { ...meta, columns: [cols.code, cols.name, cols.status, cols.allocated, cols.spent, cols.util], rows, totals: totalsOf(rows, ['allocated', 'spent']), chart: { kind: 'bar', x: 'code', series: [{ key: 'util', label: 'Utilisation %' }] } };
    }
    case 'remaining_budget': {
      const rows = items.map(baseRow);
      return { ...meta, columns: [cols.code, cols.name, cols.status, cols.allocated, cols.spent, cols.remaining, cols.uncommitted], rows, totals: totalsOf(rows, ['allocated', 'spent', 'remaining', 'uncommitted']), chart: { kind: 'bar', x: 'code', series: [{ key: 'remaining', label: 'Remaining' }, { key: 'uncommitted', label: 'Uncommitted' }] } };
    }
    case 'projected_expenditure': {
      const rows = items.filter((c) => c.forecast.projected_final_expenditure !== null).map(baseRow);
      const monthly = monthlyTotals(items, currentMonth(), at(idx(currentMonth()) + 11), settings, now).filter((m) => m.projected > 0);
      return { ...meta, columns: [cols.code, cols.name, cols.status, cols.allocated, cols.spent, cols.projected, cols.overrun], rows, totals: totalsOf(rows, ['allocated', 'spent', 'projected', 'overrun']), chart: { kind: 'bar', x: 'month', series: [{ key: 'projected', label: 'Projected expenditure' }], data: monthly.map((m) => ({ month: m.month, projected: m.projected })) }, note: 'Projections are estimates and are never entered as transactions.' };
    }
    case 'over_budget': {
      const rows = items.map(baseRow).filter((r) => items.find((c) => c.id === r.id).metrics.overspend > 0 || r.overrun > 0).map((r) => { const c = items.find((x) => x.id === r.id); return { ...r, overspend: c.metrics.overspend }; });
      return { ...meta, columns: [cols.code, cols.name, cols.status, cols.allocated, cols.spent, { key: 'overspend', label: 'Overspend', type: 'money' }, cols.projected, cols.overrun], rows, totals: totalsOf(rows, ['allocated', 'spent', 'overspend', 'overrun']), chart: null };
    }
    case 'completed_unspent': {
      const rows = items.filter((c) => c.status === 'completed' && c.metrics.remaining_allocated > 0).map(baseRow);
      return { ...meta, columns: [cols.code, cols.name, cols.category, cols.allocated, cols.spent, cols.remaining], rows, totals: totalsOf(rows, ['allocated', 'spent', 'remaining']), chart: { kind: 'bar', x: 'code', series: [{ key: 'remaining', label: 'Unspent' }] } };
    }
    case 'active_by_category_location': {
      const by = new Map();
      for (const c of items.filter((x) => x.status === 'active')) {
        const k = `${c.category?.name || 'Uncategorised'}|${[c.city, c.state].filter(Boolean).join(', ') || 'Not set'}`;
        const r = by.get(k) || { category: c.category?.name || 'Uncategorised', location: [c.city, c.state].filter(Boolean).join(', ') || 'Not set', campaigns: 0, allocated: 0, spent: 0 };
        r.campaigns += 1; r.allocated += c.metrics.allocated_budget; r.spent += c.metrics.actual_expenditure; by.set(k, r);
      }
      const rows = money([...by.values()], ['allocated', 'spent']);
      return { ...meta, columns: [cols.category, cols.location, { key: 'campaigns', label: 'Active campaigns' }, cols.allocated, cols.spent], rows, totals: totalsOf(rows, ['campaigns', 'allocated', 'spent']), chart: null };
    }
    default:
      return { error: 'unknown_report' };
  }
}

// ---------------- the foundation's own money (income, expenses, fund balance) ----------------
// Income = funding received; expenses = paid expenses; surplus = income - expenses; the fund balance is the running
// surplus (never below zero as an asset). Allocated budgets, commitments, pledges and transfers are not income or expense.
async function liveMonths(orgId, from, to) {
  const rows = await prisma.fxEntry.findMany({
    where: { org_id: orgId, deleted_at: null, entry_date: { lte: toDate(monthEnd(to)) }, OR: [{ kind: 'expense', status: 'paid' }, { kind: 'funding', status: 'received' }] },
    select: { kind: true, amount: true, entry_date: true },
  });
  const by = new Map();
  for (const r of rows) {
    const m = monthOf(r.entry_date);
    const x = by.get(m) || { income: 0, expenses: 0 };
    if (r.kind === 'funding') x.income += Number(r.amount); else x.expenses += Number(r.amount);
    by.set(m, x);
  }
  const out = [];
  // opening balance = everything earlier than the window
  let balance = 0;
  for (const [m, x] of by) if (m < from) balance += x.income - x.expenses;
  for (const m of monthsBetween(from, to)) {
    const x = by.get(m) || { income: 0, expenses: 0 };
    balance += x.income - x.expenses;
    out.push({ month: m, income: round2(x.income), expenses: round2(x.expenses), surplus: round2(x.income - x.expenses), fund_balance: round2(balance) });
  }
  return out;
}

/** Month by month for the Financials page and the group dashboard. state: locked (closed months only) | unlocked | all. */
async function valuationTrend(orgId, q = {}) {
  const to = q.to || currentMonth();
  const from = q.from || at(idx(to) - 11);
  if (from > to || idx(to) - idx(from) > 119) return { error: 'bad_range' };
  const state = q.state || 'all';
  const [live, closes] = await Promise.all([liveMonths(orgId, from, to), prisma.fxPeriodClose.findMany({ where: { org_id: orgId, status: 'closed', month: { gte: from, lte: to } } })]);
  const closed = new Map(closes.map((c) => [c.month, c]));
  const months = live.map((m) => {
    const c = closed.get(m.month);
    const snap = c?.snapshot || {};
    const isClosed = Boolean(c);
    let income = m.income; let expenses = m.expenses; let balance = m.fund_balance;
    if (state === 'locked') { income = isClosed ? Number(snap.income || 0) : 0; expenses = isClosed ? Number(snap.expenses || 0) : 0; balance = isClosed ? Number(snap.fund_balance || 0) : 0; }
    if (state === 'unlocked' && isClosed) { income = 0; expenses = 0; }
    return {
      month: m.month, revenue: income, income, expenses, profit: round2(income - expenses), surplus: round2(income - expenses),
      fund_balance: balance, asset_value: Math.max(0, balance), closed: isClosed,
      // Valuation (profit x 240 + assets x 3) is a business-company measure; it does not apply to a foundation.
      valuation: null,
    };
  });
  return { currency: 'INR', state, from, to, months };
}

// ---------------- month lock ----------------
async function periods(orgId) {
  const stored = await prisma.fxPeriodClose.findMany({ where: { org_id: orgId }, orderBy: { month: 'desc' } });
  const first = await prisma.fxEntry.findFirst({ where: { org_id: orgId, deleted_at: null }, orderBy: { entry_date: 'asc' }, select: { entry_date: true } });
  const now = currentMonth();
  const months = new Set([...stored.map((x) => x.month), now]);
  if (first) for (const m of monthsBetween(monthOf(first.entry_date), now)) months.add(m);
  const byMonth = new Map(stored.map((x) => [x.month, x]));
  const keys = [...months].sort();
  const live = keys.length ? await liveMonths(orgId, keys[0], keys[keys.length - 1]) : [];
  const liveBy = new Map(live.map((m) => [m.month, m]));
  return keys.reverse().map((month) => {
    const row = byMonth.get(month);
    return { month, status: row?.status || 'open', stale: Boolean(row?.stale), closed_at: row?.closed_at || null, reopen_reason: row?.reopen_reason || null, snapshot: row?.snapshot || null, live: liveBy.get(month) || { income: 0, expenses: 0, surplus: 0, fund_balance: 0 } };
  });
}

async function closeMonth(orgId, actorId, month, input) {
  if (month > currentMonth()) return { error: 'future_month' };
  const existing = await prisma.fxPeriodClose.findUnique({ where: { org_id_month: { org_id: orgId, month } } });
  if (existing?.status === 'closed') return { error: 'already_closed' };
  const [m] = (await liveMonths(orgId, month, month));
  const snapshot = { income: m.income, expenses: m.expenses, surplus: m.surplus, fund_balance: m.fund_balance, note: input.note || null };
  const row = await prisma.fxPeriodClose.upsert({
    where: { org_id_month: { org_id: orgId, month } },
    update: { status: 'closed', snapshot, closed_by: actorId, closed_at: new Date(), stale: false, stale_at: null },
    create: { org_id: orgId, month, status: 'closed', snapshot, closed_by: actorId, closed_at: new Date() },
  });
  await writeAudit(null, { orgId, actorId, entity: 'period', entityId: row.id, action: 'close', after: { month, surplus: m.surplus } });
  return { period: row };
}

async function reopenMonth(orgId, actorId, month, input) {
  const existing = await prisma.fxPeriodClose.findUnique({ where: { org_id_month: { org_id: orgId, month } } });
  if (!existing || existing.status !== 'closed') return { error: 'not_closed' };
  const row = await prisma.fxPeriodClose.update({ where: { id: existing.id }, data: { status: 'open', reopen_reason: input.reason, reopened_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'period', entityId: row.id, action: 'reopen', before: { month, status: 'closed' }, after: { status: 'open' }, reason: input.reason });
  return { period: row };
}

// ---------------- group dashboard feed ----------------
const quarterly = (monthly) => {
  const by = new Map();
  for (const m of monthly) by.set(fyQuarter(m.month), round2((by.get(fyQuarter(m.month)) || 0) + m.projected));
  return [...by.entries()].map(([label, projected]) => ({ label, projected }));
};

/** Campaign figures for the Super Admin's Group Dashboard: planning metrics kept apart from the P&L (which comes from valuationTrend). */
async function groupSummary(orgId, rawFilter = {}) {
  const f = filterSchema.parse(rawFilter);
  const settings = await core.ensureSettings(orgId);
  const now = new Date();
  const items = await base(orgId, f);
  const k = kpis(items);
  const monthly = monthlyTotals(items, currentMonth(), at(idx(currentMonth()) + 11), settings, now);
  const att = attention(items);
  return {
    campaigns: k.campaigns,
    money: { allocated_budget: k.allocated_budget, planned_investment: k.planned_investment, actual_expenditure: k.actual_expenditure, actual_investment: k.actual_investment, funds_received: k.funds_received, remaining_allocated: k.remaining_allocated, uncommitted: k.uncommitted, commitments: k.commitments, projected_final_expenditure: k.projected_final_expenditure, projected_overrun: k.projected_overrun, overspend: k.overspend },
    period: k.period,
    projected: { monthly: monthly.map((m) => ({ month: m.month, projected: m.projected, planned_investment: m.planned_investment })), quarterly: quarterly(monthly) },
    attention: att,
    attention_count: Object.values(att).reduce((a, rows) => a + rows.length, 0),
    top: items.filter((c) => ['active', 'on_hold', 'planned'].includes(c.status)).sort((a, b) => b.metrics.allocated_budget - a.metrics.allocated_budget).slice(0, 6).map((c) => ({ id: c.id, code: c.code, name: c.name, status: c.status, allocated_budget: c.metrics.allocated_budget, actual_expenditure: c.metrics.actual_expenditure, remaining_allocated: c.metrics.remaining_allocated, planned_end: c.planned_end })),
  };
}

module.exports = { filterSchema, trendSchema, closeSchema, reopenSchema, reportSchema, REPORTS, base, kpis, dashboard, report, valuationTrend, liveMonths, periods, closeMonth, reopenMonth, groupSummary, isClosed };
