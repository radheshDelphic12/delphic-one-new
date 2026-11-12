const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const calc = require('./valterra.calc');
const projections = require('./projections.service');

const { round2, num, dayOf, monthOf, idx, at, monthsBetween, monthEnd } = calc;
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date());
const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const addDays = (d, n) => dayOf(new Date(toDate(d).getTime() + n * 86400000));
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

// One filter set drives the KPIs, the charts, the tables and the transaction list.
const filterSchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  site_id: z.union([uuid, z.literal('none')]).optional(),
  mining_type_id: uuid.optional(),
  material_id: uuid.optional(),
  investment_category_id: uuid.optional(),
  income_category_id: uuid.optional(),
  expense_category_id: uuid.optional(),
  investment_id: uuid.optional(),
  investment_status: z.enum(['planned', 'active', 'partially_returned', 'completed', 'overdue', 'cancelled']).optional(),
  payment_status: z.enum(['paid', 'unpaid']).optional(),
  person_id: uuid.optional(),
  q: z.string().trim().max(100).optional(),
});
const trendSchema = z.object({ from: monthStr.optional(), to: monthStr.optional(), state: z.enum(['locked', 'unlocked', 'all']).optional() });
const closeSchema = z.object({ note: z.string().trim().max(500).optional() });
const reopenSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const txQuerySchema = filterSchema.extend({
  type: z.enum(['investment', 'principal_return', 'earnings', 'income', 'expense', 'salary', 'transfer']).optional(),
  min: z.coerce.number().min(0).optional(),
  max: z.coerce.number().min(0).optional(),
  sort: z.enum(['date', 'amount']).default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

const pct = (cur, prev) => (!prev ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10);

function fyStart(date, startMonth = 4) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const fy = m >= startMonth ? y : y - 1;
  return `${fy}-${String(startMonth).padStart(2, '0')}-01`;
}

// ---------------- data + filters ----------------
const SITE_SELECT = { id: true, code: true, name: true };
async function loadData(orgId) {
  const [investments, entries, sites] = await Promise.all([
    prisma.vtInvestment.findMany({ where: { org_id: orgId, deleted_at: null }, include: { category: { select: { id: true, name: true } }, site: { select: SITE_SELECT }, returns: { where: { deleted_at: null } } } }),
    prisma.vtEntry.findMany({ where: { org_id: orgId, deleted_at: null }, include: { category: { select: { id: true, name: true } }, site: { select: SITE_SELECT }, person: { select: { id: true, name: true } }, investment: { select: { id: true, code: true, name: true } } } }),
    prisma.vtSite.findMany({ where: { org_id: orgId }, include: { mining_type: { select: { id: true, name: true } }, material: { select: { id: true, name: true } } }, orderBy: [{ name: 'asc' }] }),
  ]);
  return { investments, entries, sites };
}

/** The site filter as a predicate over a record's site_id: a site, "none" (company level), a mining type and/or a material. */
function siteTest(f, sites = []) {
  const byId = new Map(sites.map((s) => [s.id, s]));
  return (siteId) => {
    if (f.site_id === 'none') { if (siteId) return false; } else if (f.site_id && siteId !== f.site_id) return false;
    if (f.mining_type_id || f.material_id) {
      const s = byId.get(siteId);
      if (!s) return false;
      if (f.mining_type_id && s.mining_type_id !== f.mining_type_id) return false;
      if (f.material_id && s.material_id !== f.material_id) return false;
    }
    return true;
  };
}
const siteFiltered = (f) => Boolean(f.site_id || f.mining_type_id || f.material_id);

async function loadProjections(orgId, where, f, sites) {
  const rows = await prisma.vtProjection.findMany({ where: { org_id: orgId, deleted_at: null, status: { not: 'archived' }, ...where } });
  if (!siteFiltered(f)) return rows;
  const ok = siteTest(f, sites);
  return rows.filter((r) => ok(r.site_id));
}

/** Apply the category / status / person filters (not the dates: the calculations take the dates). */
function scope(data, f, today = todayStr()) {
  let { investments, entries } = data;
  const sites = data.sites || [];
  if (siteFiltered(f)) {
    const ok = siteTest(f, sites);
    investments = investments.filter((i) => ok(i.site_id));
    entries = entries.filter((e) => ok(e.site_id));
  }
  if (f.investment_category_id) investments = investments.filter((i) => i.category_id === f.investment_category_id);
  if (f.investment_id) investments = investments.filter((i) => i.id === f.investment_id);
  if (f.investment_status) investments = investments.filter((i) => calc.investmentView(i, i.returns, today).status === f.investment_status);
  entries = entries.filter((e) => {
    if (f.income_category_id && e.kind === 'income' && e.category_id !== f.income_category_id) return false;
    if (f.expense_category_id && e.kind === 'expense' && e.category_id !== f.expense_category_id) return false;
    if (f.person_id && e.kind === 'salary' && e.person_id !== f.person_id) return false;
    if (f.payment_status && e.payment_status !== f.payment_status) return false;
    if (f.investment_id && e.kind === 'income' && e.investment_id !== f.investment_id) return false;
    return true;
  });
  return { investments, entries, sites };
}

function period(f) {
  const month = currentMonth();
  const from = f.from || (f.to ? `${f.to.slice(0, 7)}-01` : `${month}-01`);
  const to = f.to || (f.from ? monthEnd(f.from.slice(0, 7)) : monthEnd(month));
  return { from, to };
}

const byCategory = (rows, kind, label = 'Uncategorised') => {
  const m = new Map();
  for (const e of rows.filter((r) => r.kind === kind)) {
    const key = e.category?.name || label;
    m.set(key, round2((m.get(key) || 0) + Number(e.amount)));
  }
  return [...m.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
};
const inP = (date, from, to) => dayOf(date) >= from && dayOf(date) <= to;

async function cashBalance(data, settings, to) {
  if (settings.opening_balance === null || settings.opening_balance === undefined) return null;
  const from = settings.opening_date ? dayOf(settings.opening_date) : undefined;
  if (from && to < from) return null;
  const s = calc.summarize({ ...data, from, to });
  return round2(Number(settings.opening_balance) + s.net_cash);
}

// ---------------- dashboard ----------------
async function dashboard(orgId, rawFilter = {}, ctx = {}) {
  const f = filterSchema.parse(rawFilter);
  const payroll = ctx.payroll !== false;
  const settings = await core.ensureSettings(orgId);
  const today = todayStr();
  const { from, to } = period(f);
  const data = scope(await loadData(orgId), f, today);
  const sum = (a, b) => calc.summarize({ ...data, from: a, to: b, payroll });

  const days = daysBetween(from, to) + 1;
  const prevFrom = addDays(from, -days);
  const prevTo = addDays(from, -1);
  const current = sum(from, to);
  const previous = sum(prevFrom, prevTo);
  const m = currentMonth();
  const ytdFrom = fyStart(to, settings.fy_start_month);
  const monthFrom = `${monthOf(to)}-01`;
  const prevMonth = at(idx(monthOf(to)) - 1);
  const keys = ['investment_added', 'principal_returned', 'investment_earnings', 'other_income', 'income', 'expenses', 'net_result', 'cash_in', 'cash_out'];
  const change = Object.fromEntries(keys.map((k) => [k, { current: current[k], previous: previous[k], change: round2(current[k] - previous[k]), pct: pct(current[k], previous[k]) }]));

  const trendTo = monthOf(to);
  const trendFrom = at(idx(trendTo) - 11);
  const trend = calc.monthly({ ...data, payroll }, trendFrom, trendTo).map((x) => ({ ...x }));

  const projRows = await loadProjections(orgId, { month: { gte: monthOf(from), lte: monthOf(to) } }, f, data.sites);
  const comparison = calc.compare(projRows, current);
  const projMonths = await loadProjections(orgId, { month: { gte: trendFrom, lte: trendTo } }, f, data.sites);
  const projectedByMonth = trend.map((t) => {
    const p = calc.projectedTotals(projMonths.filter((r) => r.month === t.month));
    return { month: t.month, projected_income: p.income, projected_expenses: payroll ? p.expenses : round2(p.expenses - p.salary), projected_net: payroll ? p.net : round2(p.income - (p.expenses - p.salary)), actual_income: t.income, actual_expenses: t.expenses, actual_net: t.net_result };
  });

  const inRange = (r, d) => inP(r[d], from, to);
  const periodEntries = data.entries.filter((e) => inRange(e, 'entry_date') && e.payment_status !== 'cancelled' && e.kind !== 'transfer' && (payroll || e.kind !== 'salary'));
  const invRows = data.investments.filter((i) => i.status !== 'cancelled').map((i) => {
    const v = calc.investmentView(i, i.returns, today);
    return { id: i.id, code: i.code, name: i.name, category: i.category?.name || null, investment_date: dayOf(i.investment_date), amount: v.amount, status: v.status, principal_returned: v.principal_returned, earnings: v.earnings, outstanding_principal: v.outstanding_principal, expected_return_amount: v.expected_return_amount, expected_return_date: v.expected_return_date, received: v.received, return_variance: v.return_variance, overdue: v.overdue };
  });
  const position = calc.position({ ...data, to, today, payroll });
  const futureRows = await loadProjections(orgId, { month: { gte: m } }, f, data.sites);
  const fut = calc.projectedTotals(futureRows);
  const projectedFuture = {
    from: m, months: new Set(futureRows.map((r) => r.month)).size,
    returns: round2(fut.principal_recovery + fut.investment_earnings), principal_recovery: fut.principal_recovery, earnings: fut.investment_earnings,
    revenue: fut.other_income, new_investment: fut.new_investment,
  };
  const siteView = siteSection(data, { from, to, today, payroll, f, trendFrom, trendTo });

  return {
    sites: siteView, projected_future: projectedFuture,
    currency: settings.currency, filters: { ...f, from, to }, generated_for: m,
    period: current, previous, change, previous_range: { from: prevFrom, to: prevTo },
    current_month: sum(monthFrom, monthEnd(monthOf(to))), previous_month: sum(`${prevMonth}-01`, monthEnd(prevMonth)),
    year_to_date: sum(ytdFrom, to), cumulative: sum(undefined, to), ytd_from: ytdFrom,
    position, cash_balance: siteFiltered(f) ? null : await cashBalance(scope(await loadData(orgId), {}, today), settings, to), cash_balance_company_only: siteFiltered(f),
    trend, projected_by_month: projectedByMonth, comparison, projected_totals: calc.projectedTotals(projRows),
    expenses_by_category: byCategory(periodEntries, 'expense'), income_by_category: byCategory(periodEntries, 'income'),
    salary_by_person: payroll ? salaryByPerson(periodEntries) : null,
    investments: invRows.sort((a, b) => b.amount - a.amount).slice(0, 12),
    attention: attention(invRows, data.entries, today),
  };
}

/**
 * The site-wise part of the dashboard: one row per mining site (and one for company-level records), the best and weakest sites over the
 * same period, and a month-by-month series per site for the charts. Closed sites stay listed while they have records in view.
 */
function siteSection(data, { from, to, today, payroll, f, trendFrom, trendTo }) {
  const ok = siteTest(f, data.sites);
  const listed = data.sites.filter((s) => ok(s.id));
  const breakdown = calc.siteBreakdown({ investments: data.investments, entries: data.entries, sites: listed, from, to, today, payroll });
  const hasCompany = !siteFiltered(f) || f.site_id === 'none';
  const rows = breakdown.rows.filter((r) => r.site_id || (hasCompany && (r.invested_total || r.income || r.expenses || r.outstanding_principal || r.receivables || r.payables)));
  const shown = rows.filter((r) => r.site_id);
  const months = monthsBetween(trendFrom, trendTo);
  const MAX_LINES = 8;
  const ranked = [...shown].sort((a, b) => (b.invested_total + b.income + b.expenses) - (a.invested_total + a.income + a.expenses));
  const named = ranked.length > MAX_LINES ? ranked.slice(0, MAX_LINES - 1) : ranked;
  const restIds = new Set(ranked.slice(named.length).map((r) => r.site_id));
  // Every record lands in exactly one line, so the lines of a month add up to the company figure for that month.
  const lines = named.map((t) => ({ id: t.site_id, code: t.code, name: t.name, has: (siteId) => siteId === t.site_id }));
  if (restIds.size) lines.push({ id: 'other', code: null, name: `Other sites (${restIds.size})`, has: (siteId) => restIds.has(siteId) });
  if (rows.some((r) => !r.site_id)) lines.push({ id: 'none', code: null, name: 'Company level', has: (siteId) => !siteId });
  const series = (pick) => months.map((mo) => {
    const row = { month: mo };
    for (const t of lines) {
      const g = { investments: data.investments.filter((i) => t.has(i.site_id)), entries: data.entries.filter((e) => t.has(e.site_id)) };
      row[t.id] = round2(pick(calc.summarize({ ...g, from: `${mo}-01`, to: monthEnd(mo), payroll })));
    }
    return row;
  });
  return {
    total: listed.length, active: listed.filter((s) => s.status === 'active').length,
    rows, totals: breakdown.totals, ranking: calc.ranking(rows),
    trend: { keys: lines.map((t) => ({ id: t.id, code: t.code, name: t.name })), investment: series((s) => s.investment_added), revenue: series((s) => s.income), expenses: series((s) => s.expenses), net: series((s) => s.net_result) },
  };
}

function salaryByPerson(rows) {
  const m = new Map();
  for (const e of rows.filter((r) => r.kind === 'salary')) {
    const key = e.person?.name || e.party_name || 'Unassigned';
    const x = m.get(key) || { name: key, paid: 0, unpaid: 0 };
    if (e.payment_status === 'paid') x.paid += Number(e.amount); else x.unpaid += Number(e.amount);
    m.set(key, x);
  }
  return [...m.values()].map((x) => ({ ...x, paid: round2(x.paid), unpaid: round2(x.unpaid), total: round2(x.paid + x.unpaid) })).sort((a, b) => b.total - a.total);
}

function attention(invRows, entries, today) {
  const dueSoon = (e) => e.due_date && e.payment_status === 'unpaid';
  return {
    overdue_investments: invRows.filter((i) => i.overdue).map((i) => ({ id: i.id, code: i.code, name: i.name, expected_return_date: i.expected_return_date, outstanding_principal: i.outstanding_principal })),
    overdue_receivables: entries.filter((e) => dueSoon(e) && e.kind === 'income' && dayOf(e.due_date) < today).map((e) => ({ id: e.id, party: e.party_name, due_date: dayOf(e.due_date), amount: Number(e.amount) })),
    overdue_payables: entries.filter((e) => dueSoon(e) && e.kind === 'expense' && dayOf(e.due_date) < today).map((e) => ({ id: e.id, party: e.party_name, due_date: dayOf(e.due_date), amount: Number(e.amount) })),
  };
}

// ---------------- monthly report ----------------
async function monthlyReport(orgId, rawFilter = {}, ctx = {}) {
  const f = filterSchema.parse(rawFilter);
  const payroll = ctx.payroll !== false;
  const settings = await core.ensureSettings(orgId);
  const today = todayStr();
  const { from, to } = period({ from: f.from || `${at(idx(currentMonth()) - 5)}-01`, to: f.to });
  const full = await loadData(orgId);
  const data = scope(full, f, today);
  const months = monthsBetween(monthOf(from), monthOf(to));
  if (months.length > 120) return { error: 'bad_range' };
  const projRows = await loadProjections(orgId, { month: { gte: months[0], lte: months[months.length - 1] } }, f, data.sites);
  const opening = settings.opening_balance !== null && settings.opening_balance !== undefined;
  const rows = [];
  for (const mo of months) {
    const a = `${mo}-01`;
    const b = monthEnd(mo);
    const s = calc.summarize({ ...data, from: a, to: b, payroll });
    const pos = calc.position({ ...data, to: b, today, payroll });
    const p = calc.projectedTotals(projRows.filter((r) => r.month === mo));
    const projExpenses = payroll ? p.expenses : round2(p.expenses - p.salary);
    const openingBal = opening ? await cashBalance(scope(full, {}, today), settings, addDays(a, -1)) : null;
    const closingBal = opening ? await cashBalance(scope(full, {}, today), settings, b) : null;
    rows.push({
      month: mo, opening_balance: openingBal, new_investments: s.investment_added, principal_returned: s.principal_returned, investment_earnings: s.investment_earnings,
      other_income: s.other_income, total_income: s.income, operating_expenses: s.operating_expenses, salary_expenses: s.salaries, other_expenses: s.other_expenses,
      total_expenses: s.expenses, net_result: s.net_result, receivables: pos.receivables, payables: pos.payables, outstanding_principal: pos.outstanding_principal,
      cash_in: s.cash_in, cash_out: s.cash_out, net_cash: s.net_cash, closing_balance: closingBal,
      projected_income: p.income, projected_expenses: projExpenses, projected_net: round2(p.income - projExpenses),
      income_variance: round2(s.income - p.income), expense_variance: round2(s.expenses - projExpenses),
    });
  }
  const tot = (k) => round2(rows.reduce((a, r) => a + (r[k] || 0), 0));
  const totals = Object.fromEntries(['new_investments', 'principal_returned', 'investment_earnings', 'other_income', 'total_income', 'operating_expenses', 'salary_expenses', 'other_expenses', 'total_expenses', 'net_result', 'cash_in', 'cash_out', 'net_cash', 'projected_income', 'projected_expenses', 'projected_net', 'income_variance', 'expense_variance'].map((k) => [k, tot(k)]));
  return { currency: settings.currency, from, to, payroll_hidden: !payroll, opening_set: opening, rows, totals };
}

// ---------------- unified transaction register ----------------
async function transactions(orgId, rawQuery = {}, ctx = {}) {
  const q = txQuerySchema.parse(rawQuery);
  const payroll = ctx.payroll !== false;
  const today = todayStr();
  const data = await loadData(orgId);
  const rows = [];
  const inRange = (d) => (!q.from || dayOf(d) >= q.from) && (!q.to || dayOf(d) <= q.to);
  const siteOk = siteTest(q, data.sites);
  const siteOf = (r) => (r.site ? { id: r.site.id, code: r.site.code, name: r.site.name } : null);
  const invOk = (i) => siteOk(i.site_id) && (!q.investment_category_id || i.category_id === q.investment_category_id) && (!q.investment_id || i.id === q.investment_id) && (!q.investment_status || calc.investmentView(i, i.returns, today).status === q.investment_status);
  for (const i of data.investments.filter(invOk)) {
    const v = calc.investmentView(i, i.returns, today);
    if (inRange(i.investment_date)) rows.push({ key: `inv-${i.id}`, source: 'investment', id: i.id, type: 'investment', direction: 'out', date: dayOf(i.investment_date), amount: v.amount, category: i.category?.name || null, status: v.status, description: i.name, reference: i.reference, site: siteOf(i), related: { investment_id: i.id, code: i.code, name: i.name } });
    for (const r of i.returns) {
      if (!inRange(r.return_date)) continue;
      const base = { source: 'return', id: r.id, direction: 'in', date: dayOf(r.return_date), category: i.category?.name || null, status: r.status, reference: r.reference, description: `${i.name}${r.notes ? ` - ${r.notes}` : ''}`, site: siteOf(i), related: { investment_id: i.id, code: i.code, name: i.name } };
      if (Number(r.principal) > 0) rows.push({ ...base, key: `ret-p-${r.id}`, type: 'principal_return', amount: Number(r.principal) });
      if (Number(r.earnings) > 0) rows.push({ ...base, key: `ret-e-${r.id}`, type: 'earnings', amount: Number(r.earnings) });
    }
  }
  const skipEntries = q.investment_category_id || q.investment_status;
  if (!skipEntries) {
    for (const e of data.entries) {
      if (!inRange(e.entry_date)) continue;
      if (e.kind === 'salary' && !payroll) continue;
      if (q.income_category_id && e.kind === 'income' && e.category_id !== q.income_category_id) continue;
      if (q.expense_category_id && e.kind === 'expense' && e.category_id !== q.expense_category_id) continue;
      if (q.person_id && e.person_id !== q.person_id) continue;
      if (q.payment_status && e.payment_status !== q.payment_status) continue;
      if (q.investment_id && e.investment_id !== q.investment_id) continue;
      if (!siteOk(e.site_id)) continue;
      rows.push({
        site: siteOf(e),
        key: `ent-${e.id}`, source: 'entry', id: e.id, type: e.kind, direction: e.kind === 'income' ? 'in' : e.kind === 'transfer' ? 'none' : 'out', date: dayOf(e.entry_date), amount: Number(e.amount),
        category: e.category?.name || (e.kind === 'salary' ? 'Salary' : null), status: e.payment_status, description: e.description || e.party_name || (e.person ? e.person.name : null), reference: e.reference,
        party: e.party_name, person: e.person?.name || null, due_date: dayOf(e.due_date), related: e.investment ? { investment_id: e.investment.id, code: e.investment.code, name: e.investment.name } : null,
      });
    }
  }
  let list = rows;
  if (q.type) list = list.filter((r) => r.type === q.type);
  if (q.min !== undefined) list = list.filter((r) => r.amount >= q.min);
  if (q.max !== undefined) list = list.filter((r) => r.amount <= q.max);
  if (q.q) { const s = q.q.toLowerCase(); list = list.filter((r) => [r.description, r.reference, r.party, r.person, r.category, r.related?.name, r.related?.code, r.site?.name, r.site?.code].some((v) => v && String(v).toLowerCase().includes(s))); }
  const dir = q.dir === 'asc' ? 1 : -1;
  list.sort((a, b) => (q.sort === 'amount' ? (a.amount - b.amount) * dir : a.date.localeCompare(b.date) * dir || a.key.localeCompare(b.key)));
  const counted = list.filter((r) => !['reversed', 'cancelled'].includes(r.status));
  const sumOf = (t) => round2(counted.filter((r) => r.type === t).reduce((a, r) => a + r.amount, 0));
  const summary = { count: list.length, investment: sumOf('investment'), principal_return: sumOf('principal_return'), earnings: sumOf('earnings'), income: sumOf('income'), expense: sumOf('expense'), salary: payroll ? sumOf('salary') : null, transfer: sumOf('transfer') };
  return { data: list.slice((q.page - 1) * q.limit, q.page * q.limit), summary, pagination: { page: q.page, limit: q.limit, total: list.length, pages: Math.max(1, Math.ceil(list.length / q.limit)) } };
}


// ---------------- projected vs actual, month by month ----------------
async function projectionCompare(orgId, rawFilter = {}, ctx = {}) {
  const f = filterSchema.parse(rawFilter);
  const payroll = ctx.payroll !== false;
  const { from, to } = period({ from: f.from || `${currentMonth()}-01`, to: f.to });
  const data = scope(await loadData(orgId), f, todayStr());
  const months = monthsBetween(monthOf(from), monthOf(to));
  if (months.length > 60) return { error: 'bad_range' };
  const rows = await loadProjections(orgId, { month: { gte: months[0], lte: months[months.length - 1] } }, f, data.sites);
  const lines = (list) => list.filter((c) => c.actual !== null && (payroll || c.line !== 'salary'));
  const perMonth = months.map((m) => ({ month: m, lines: lines(calc.compare(rows.filter((r) => r.month === m), calc.summarize({ ...data, from: `${m}-01`, to: monthEnd(m), payroll }))) }));
  const total = lines(calc.compare(rows, calc.summarize({ ...data, from: `${months[0]}-01`, to: monthEnd(months[months.length - 1]), payroll })));
  const t = calc.projectedTotals(rows);
  return { from: months[0], to: months[months.length - 1], months: perMonth, total, projected_totals: t };
}

// ---------------- reports (CSV / PDF through the shared exporter) ----------------
const REPORTS = {
  monthly: { title: 'Monthly financial report' },
  investments: { title: 'Investment register' },
  returns: { title: 'Returns received (principal and earnings)' },
  income: { title: 'Income by category' },
  expenses: { title: 'Expenses by category' },
  salaries: { title: 'Salaries by employee' },
  sites: { title: 'Site-wise profit and loss' },
  projection_vs_actual: { title: 'Projected vs actual' },
};

async function report(orgId, rawQuery = {}, ctx = {}) {
  const { report: type = 'monthly', ...rest } = rawQuery;
  if (!REPORTS[type]) return { error: 'unknown_report' };
  const f = filterSchema.parse(rest);
  const payroll = ctx.payroll !== false;
  if (type === 'salaries' && !payroll) return { error: 'payroll_forbidden' };
  const meta = { type, title: REPORTS[type].title, filters: f, reports: Object.entries(REPORTS).filter(([k]) => payroll || k !== 'salaries').map(([key, v]) => ({ key, title: v.title })) };
  const today = todayStr();
  if (type === 'monthly') {
    const r = await monthlyReport(orgId, f, ctx);
    if (r.error) return r;
    return { ...meta, columns: ['Month', 'New investments', 'Principal returned', 'Investment earnings', 'Other income', 'Total income', 'Operating expenses', 'Salaries', 'Other expenses', 'Total expenses', 'Net result', 'Projected income', 'Projected expenses'], rows: r.rows.map((x) => [x.month, x.new_investments, x.principal_returned, x.investment_earnings, x.other_income, x.total_income, x.operating_expenses, x.salary_expenses, x.other_expenses, x.total_expenses, x.net_result, x.projected_income, x.projected_expenses]), totals: r.totals };
  }
  const d = scope(await loadData(orgId), f, today);
  const { from, to } = period(f);
  if (type === 'sites') {
    const { from: a, to: b } = period(f);
    const ok = siteTest(f, d.sites);
    const br = calc.siteBreakdown({ investments: d.investments, entries: d.entries, sites: d.sites.filter((s) => ok(s.id)), from: a, to: b, today, payroll });
    return {
      ...meta,
      columns: ['Site', 'Code', 'Location', 'Mining type', 'Material', 'Status', 'Capital invested (period)', 'Capital invested (to date)', 'Principal recovered', 'Investment earnings', 'Mining revenue / other income', 'Total income', 'Operating expenses', 'Salaries', 'Other expenses', 'Total expenses', 'Net result', 'Outstanding principal', 'Net result / capital %'],
      rows: br.rows.map((r) => [r.name, r.code || '', r.location || '', r.mining_type || '', r.material || '', r.status || '', r.invested_period, r.invested_total, r.principal_returned, r.earnings, r.revenue, r.income, r.operating_expenses, r.salaries ?? '', r.other_expenses, r.expenses, r.net_result, r.outstanding_principal, r.roi_pct ?? '']),
      totals: { net_result: br.totals.net_result, total_income: br.totals.income, total_expenses: br.totals.expenses },
    };
  }
  if (type === 'investments') {
    const rows = d.investments.map((i) => ({ i, v: calc.investmentView(i, i.returns, today) })).filter((x) => !f.from || dayOf(x.i.investment_date) >= f.from).filter((x) => !f.to || dayOf(x.i.investment_date) <= f.to);
    return { ...meta, columns: ['Code', 'Investment', 'Site', 'Category', 'Investor', 'Date', 'Amount', 'Principal returned', 'Earnings', 'Outstanding principal', 'Expected return', 'Expected date', 'Status'], rows: rows.map(({ i, v }) => [i.code, i.name, i.site ? `${i.site.code} ${i.site.name}` : 'Company level', i.category?.name || '', i.investor || '', dayOf(i.investment_date), v.amount, v.principal_returned, v.earnings, v.outstanding_principal, v.expected_return_amount ?? '', v.expected_return_date || '', v.status]) };
  }
  if (type === 'returns') {
    const rows = d.investments.flatMap((i) => i.returns.filter((r) => r.status !== 'reversed' && inP(r.return_date, from, to)).map((r) => [dayOf(r.return_date), i.code, i.name, Number(r.principal), Number(r.earnings), r.reference || '']));
    return { ...meta, columns: ['Date', 'Code', 'Investment', 'Principal returned', 'Earnings', 'Reference'], rows };
  }
  const inPeriod = d.entries.filter((e) => inP(e.entry_date, from, to) && e.payment_status !== 'cancelled');
  if (type === 'income') return { ...meta, columns: ['Category', 'Amount'], rows: [['Investment earnings', calc.summarize({ ...d, from, to }).investment_earnings], ...byCategory(inPeriod, 'income').map((x) => [x.name, x.amount])] };
  if (type === 'expenses') return { ...meta, columns: ['Category', 'Amount'], rows: byCategory(inPeriod, 'expense').map((x) => [x.name, x.amount]) };
  if (type === 'salaries') return { ...meta, columns: ['Employee', 'Paid', 'Unpaid', 'Total'], rows: salaryByPerson(inPeriod).map((x) => [x.name, x.paid, x.unpaid, x.total]) };
  const rows = await loadProjections(orgId, { month: { gte: monthOf(from), lte: monthOf(to) } }, f, d.sites);
  const cmp = calc.compare(rows, calc.summarize({ ...d, from, to, payroll }));
  return { ...meta, columns: ['Line', 'Projected', 'Actual', 'Variance', 'Variance %', 'Remaining'], rows: cmp.filter((c) => c.actual !== null).map((c) => [c.label, c.projected, c.actual, c.variance, c.variance_pct ?? '', c.remaining]) };
}

// ---------------- the company's own books for the group dashboard and the Financials page ----------------
async function liveMonths(orgId, from, to, ctx = {}) {
  const data = await loadData(orgId);
  const today = todayStr();
  return monthsBetween(from, to).map((m) => {
    const s = calc.summarize({ ...data, from: `${m}-01`, to: monthEnd(m), payroll: ctx.payroll !== false });
    const pos = calc.position({ ...data, to: monthEnd(m), today });
    return { month: m, income: s.income, expenses: s.expenses, net_result: s.net_result, investment_added: s.investment_added, principal_returned: s.principal_returned, investment_earnings: s.investment_earnings, outstanding_principal: pos.outstanding_principal };
  });
}

// The group valuation factors (kept equal to FORMULA in superDashboard/groupFinance.service.js).
const VALUATION_FACTORS = { profit: 240, asset_value: 3 };

async function valuationTrend(orgId, q = {}) {
  const to = q.to || currentMonth();
  const from = q.from || at(idx(to) - 11);
  if (from > to || idx(to) - idx(from) > 119) return { error: 'bad_range' };
  const state = q.state || 'all';
  const [liveRows, closes] = await Promise.all([liveMonths(orgId, from, to), prisma.vtPeriodClose.findMany({ where: { org_id: orgId, status: 'closed', month: { gte: from, lte: to } } })]);
  const closed = new Map(closes.map((c) => [c.month, c]));
  const months = liveRows.map((m) => {
    const c = closed.get(m.month);
    const snap = c?.snapshot || {};
    const isClosed = Boolean(c);
    let income = m.income; let expenses = m.expenses; let assets = m.outstanding_principal;
    if (state === 'locked') { income = isClosed ? Number(snap.income || 0) : 0; expenses = isClosed ? Number(snap.expenses || 0) : 0; assets = isClosed ? Number(snap.outstanding_principal || 0) : 0; }
    if (state === 'unlocked' && isClosed) { income = 0; expenses = 0; }
    const profit = round2(income - expenses);
    return {
      month: m.month, revenue: income, income, expenses, profit, net_result: round2(income - expenses),
      asset_value: assets, outstanding_principal: assets, investment_added: m.investment_added, principal_returned: m.principal_returned, investment_earnings: m.investment_earnings,
      closed: isClosed,
      // Same group formula as the other companies: profit x 240 + assets x 3 (assets = principal still invested).
      profit_x: round2(profit * VALUATION_FACTORS.profit), asset_value_x: round2(assets * VALUATION_FACTORS.asset_value),
      valuation: round2(profit * VALUATION_FACTORS.profit + assets * VALUATION_FACTORS.asset_value),
    };
  });
  return { currency: 'INR', state, from, to, months };
}

async function periods(orgId) {
  const stored = await prisma.vtPeriodClose.findMany({ where: { org_id: orgId }, orderBy: { month: 'desc' } });
  const [fe, fi] = await Promise.all([
    prisma.vtEntry.findFirst({ where: { org_id: orgId, deleted_at: null }, orderBy: { entry_date: 'asc' }, select: { entry_date: true } }),
    prisma.vtInvestment.findFirst({ where: { org_id: orgId, deleted_at: null }, orderBy: { investment_date: 'asc' }, select: { investment_date: true } }),
  ]);
  const now = currentMonth();
  const months = new Set([...stored.map((x) => x.month), now]);
  const first = [fe && monthOf(fe.entry_date), fi && monthOf(fi.investment_date)].filter(Boolean).sort()[0];
  if (first) for (const m of monthsBetween(first, now)) months.add(m);
  const byMonth = new Map(stored.map((x) => [x.month, x]));
  const keys = [...months].sort();
  const liveRows = keys.length ? await liveMonths(orgId, keys[0], keys[keys.length - 1]) : [];
  const liveBy = new Map(liveRows.map((m) => [m.month, m]));
  return keys.reverse().map((month) => {
    const row = byMonth.get(month);
    return { month, status: row?.status || 'open', stale: Boolean(row?.stale), closed_at: row?.closed_at || null, reopen_reason: row?.reopen_reason || null, snapshot: row?.snapshot || null, live: liveBy.get(month) || { income: 0, expenses: 0, net_result: 0, outstanding_principal: 0 } };
  });
}

async function closeMonth(orgId, actorId, month, input) {
  if (month > currentMonth()) return { error: 'future_month' };
  const existing = await prisma.vtPeriodClose.findUnique({ where: { org_id_month: { org_id: orgId, month } } });
  if (existing?.status === 'closed') return { error: 'already_closed' };
  const [m] = await liveMonths(orgId, month, month);
  const snapshot = { income: m.income, expenses: m.expenses, net_result: m.net_result, investment_added: m.investment_added, principal_returned: m.principal_returned, investment_earnings: m.investment_earnings, outstanding_principal: m.outstanding_principal, note: input.note || null };
  const row = await prisma.vtPeriodClose.upsert({
    where: { org_id_month: { org_id: orgId, month } },
    update: { status: 'closed', snapshot, closed_by: actorId, closed_at: new Date(), stale: false, stale_at: null },
    create: { org_id: orgId, month, status: 'closed', snapshot, closed_by: actorId, closed_at: new Date() },
  });
  await writeAudit(null, { orgId, actorId, entity: 'period', entityId: row.id, action: 'close', after: { month, net_result: m.net_result } });
  return { period: row };
}

async function reopenMonth(orgId, actorId, month, input) {
  const existing = await prisma.vtPeriodClose.findUnique({ where: { org_id_month: { org_id: orgId, month } } });
  if (!existing || existing.status !== 'closed') return { error: 'not_closed' };
  const row = await prisma.vtPeriodClose.update({ where: { id: existing.id }, data: { status: 'open', reopen_reason: input.reason, reopened_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'period', entityId: row.id, action: 'reopen', before: { month, status: 'closed' }, after: { status: 'open' }, reason: input.reason });
  return { period: row };
}

// ---------------- group dashboard feed ----------------
/** Capital and returns of this company for the Super Admin's Group Dashboard, kept apart from the P&L (valuationTrend). */
async function groupSummary(orgId, rawFilter = {}) {
  const f = filterSchema.parse(rawFilter);
  const today = todayStr();
  const data = scope(await loadData(orgId), f, today);
  const { from, to } = period(f);
  const s = calc.summarize({ ...data, from, to });
  const all = calc.summarize({ ...data, to });
  const pos = calc.position({ ...data, to, today });
  const m = currentMonth();
  const next = at(idx(m) + 11);
  const projRows = await loadProjections(orgId, { month: { gte: m, lte: next } }, f, data.sites);
  const monthly = monthsBetween(m, next).map((mo) => {
    const p = calc.projectedTotals(projRows.filter((r) => r.month === mo));
    return { month: mo, projected_income: p.income, projected_expenses: p.expenses, projected_net: p.net, projected_investment: p.new_investment, projected_principal: p.principal_recovery };
  });
  const invs = data.investments.filter((i) => i.status === 'active').map((i) => ({ i, v: calc.investmentView(i, i.returns, today) }));
  const siteRows = calc.siteBreakdown({ investments: data.investments, entries: data.entries, sites: data.sites, to, today }).rows; // all time up to the end of the period (no start date)
  return {
    sites: {
      total: data.sites.length, active: data.sites.filter((s) => s.status === 'active').length,
      rows: siteRows.filter((r) => r.site_id).sort((a, b) => b.invested_total - a.invested_total).slice(0, 8).map((r) => ({ site_id: r.site_id, code: r.code, name: r.name, mining_type: r.mining_type, material: r.material, status: r.status, invested_total: r.invested_total, principal_returned_total: r.principal_returned_total, income: r.income, expenses: r.expenses, net_result: r.net_result, outstanding_principal: r.outstanding_principal, roi_pct: r.roi_pct })),
      company_level: siteRows.find((r) => !r.site_id) ? { income: siteRows.find((r) => !r.site_id).income, expenses: siteRows.find((r) => !r.site_id).expenses, net_result: siteRows.find((r) => !r.site_id).net_result } : null,
    },
    investments: { total: data.investments.filter((i) => i.status !== 'cancelled').length, active: invs.length, completed: invs.filter((x) => x.v.base_status === 'completed').length, overdue: invs.filter((x) => x.v.overdue).length },
    money: {
      capital_invested_total: all.investment_added, principal_returned_total: all.principal_returned, earnings_total: all.investment_earnings, outstanding_principal: pos.outstanding_principal,
      expected_returns_outstanding: pos.expected_returns_outstanding, receivables: pos.receivables, payables: pos.payables,
    },
    period: { from, to, investment_added: s.investment_added, principal_returned: s.principal_returned, investment_earnings: s.investment_earnings, income: s.income, expenses: s.expenses, net_result: s.net_result, cash_in: s.cash_in, cash_out: s.cash_out },
    projected: { monthly, total_income: round2(monthly.reduce((a, x) => a + x.projected_income, 0)), total_expenses: round2(monthly.reduce((a, x) => a + x.projected_expenses, 0)), total_net: round2(monthly.reduce((a, x) => a + x.projected_net, 0)) },
    attention: { overdue_investments: invs.filter((x) => x.v.overdue).map((x) => ({ id: x.i.id, code: x.i.code, name: x.i.name, expected_return_date: x.v.expected_return_date, outstanding_principal: x.v.outstanding_principal })).slice(0, 6) },
    top: invs.sort((a, b) => b.v.outstanding_principal - a.v.outstanding_principal).slice(0, 6).map((x) => ({ id: x.i.id, code: x.i.code, name: x.i.name, status: x.v.status, amount: x.v.amount, outstanding_principal: x.v.outstanding_principal, earnings: x.v.earnings, expected_return_date: x.v.expected_return_date })),
  };
}

module.exports = { siteTest, loadData, filterSchema, trendSchema, closeSchema, reopenSchema, txQuerySchema, REPORTS, dashboard, monthlyReport, projectionCompare, transactions, report, liveMonths, valuationTrend, periods, closeMonth, reopenMonth, groupSummary, projections, num };
