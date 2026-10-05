const prisma = require('../../config/db');

// One place that turns ledger entries and pay slips into figures, so the Overview (Z6) and
// Financials (Z7) never disagree.
//   revenue  = actual revenue entries (amount, tax excluded)
//   expense  = actual expense entries (amount, tax excluded)
//   salaries = approved + paid pay slips (net), by the slip's month
//   profit   = revenue - expense - salaries            margin = profit / revenue
//   valuation = settings method: manual value | revenue multiple x trailing-12-month revenue
//               | profit multiple x trailing-12-month profit

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const dayOf = (v) => new Date(v).toISOString().slice(0, 10);
const monthOf = (v) => dayOf(v).slice(0, 7);
const toDate = (s) => new Date(`${s}T00:00:00.000Z`);

function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
function monthsBetween(from, to) {
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}
const monthStart = (month) => `${month}-01`;
const monthEnd = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

// Presets use the Indian financial year (April - March) for "fy".
function resolveRange(preset = 'month', from, to) {
  const today = new Date().toISOString().slice(0, 10);
  const cm = currentMonth();
  const [y, m] = cm.split('-').map(Number);
  switch (preset) {
    case 'last_month': {
      const lm = addMonths(cm, -1);
      return { preset, from: monthStart(lm), to: monthEnd(lm) };
    }
    case 'quarter': {
      const qStart = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}`;
      return { preset, from: monthStart(qStart), to: today };
    }
    case 'fy': {
      const startYear = m >= 4 ? y : y - 1;
      return { preset, from: `${startYear}-04-01`, to: today };
    }
    case 't12':
      return { preset, from: monthStart(addMonths(cm, -11)), to: today };
    case 'custom':
      return { preset, from, to };
    default:
      return { preset: 'month', from: monthStart(cm), to: today };
  }
}

async function actualEntries(orgId, from, to, extra = {}) {
  return prisma.zxLedgerEntry.findMany({
    where: { org_id: orgId, deleted_at: null, status: 'actual', entry_date: { gte: toDate(from), lte: toDate(to) }, ...extra },
    select: { entry_date: true, type: true, amount: true, tax: true, project_id: true, party_id: true, category_id: true },
  });
}

// Approved + paid slips whose month falls in [from, to].
async function slips(orgId, from, to) {
  return prisma.zxSalaryRecord.findMany({
    where: { org_id: orgId, status: { in: ['approved', 'paid'] }, month: { gte: from.slice(0, 7), lte: to.slice(0, 7) } },
    select: { month: true, net: true, project_split: true, person_id: true },
  });
}

async function summary(orgId, from, to, { includeSalaries = true } = {}) {
  const [entries, slipRows] = await Promise.all([actualEntries(orgId, from, to), includeSalaries ? slips(orgId, from, to) : []]);
  let revenue = 0;
  let expense = 0;
  let taxIn = 0;
  let taxOut = 0;
  for (const e of entries) {
    if (e.type === 'revenue') {
      revenue += num(e.amount);
      taxIn += num(e.tax);
    } else {
      expense += num(e.amount);
      taxOut += num(e.tax);
    }
  }
  const salaries = slipRows.reduce((a, s) => a + num(s.net), 0);
  const profit = revenue - expense - salaries;
  return {
    from,
    to,
    revenue: round2(revenue),
    expense: round2(expense),
    salaries: includeSalaries ? round2(salaries) : null,
    profit: round2(profit),
    margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
    tax_collected: round2(taxIn),
    tax_paid: round2(taxOut),
    salaries_included: includeSalaries,
  };
}

// One row per month in [fromMonth, toMonth], zero-filled.
async function monthly(orgId, fromMonth, toMonth, { includeSalaries = true } = {}) {
  const [entries, slipRows] = await Promise.all([
    actualEntries(orgId, monthStart(fromMonth), monthEnd(toMonth)),
    includeSalaries ? slips(orgId, monthStart(fromMonth), monthEnd(toMonth)) : [],
  ]);
  const rows = new Map(monthsBetween(fromMonth, toMonth).map((m) => [m, { month: m, revenue: 0, expense: 0, salaries: 0 }]));
  for (const e of entries) {
    const row = rows.get(monthOf(e.entry_date));
    if (row) row[e.type === 'revenue' ? 'revenue' : 'expense'] += num(e.amount);
  }
  for (const s of slipRows) {
    const row = rows.get(s.month);
    if (row) row.salaries += num(s.net);
  }
  return [...rows.values()].map((r) => ({
    month: r.month,
    revenue: round2(r.revenue),
    expense: round2(r.expense),
    salaries: includeSalaries ? round2(r.salaries) : null,
    profit: round2(r.revenue - r.expense - (includeSalaries ? r.salaries : 0)),
  }));
}

// Profit per project; money with no project, and slips with no split, land in an "Unallocated" row (project_id null).
async function byProject(orgId, from, to, { includeSalaries = true } = {}) {
  const [entries, slipRows, projects] = await Promise.all([
    actualEntries(orgId, from, to),
    includeSalaries ? slips(orgId, from, to) : [],
    prisma.zxProject.findMany({ where: { org_id: orgId, deleted_at: null }, select: { id: true, code: true, name: true, kind: true } }),
  ]);
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { project_id: id, revenue: 0, expense: 0, salaries: 0 });
    return rows.get(id);
  };
  for (const e of entries) row(e.project_id || null)[e.type === 'revenue' ? 'revenue' : 'expense'] += num(e.amount);
  for (const s of slipRows) {
    const split = Array.isArray(s.project_split) ? s.project_split : [];
    if (split.length === 0) row(null).salaries += num(s.net);
    else for (const part of split) row(part.project_id).salaries += num(part.amount);
  }
  const meta = new Map(projects.map((p) => [p.id, p]));
  return [...rows.values()]
    .map((r) => ({
      project_id: r.project_id,
      code: meta.get(r.project_id)?.code || null,
      name: r.project_id ? meta.get(r.project_id)?.name || 'Deleted project' : 'Unallocated',
      kind: meta.get(r.project_id)?.kind || null,
      revenue: round2(r.revenue),
      expense: round2(r.expense),
      salaries: includeSalaries ? round2(r.salaries) : null,
      profit: round2(r.revenue - r.expense - (includeSalaries ? r.salaries : 0)),
    }))
    .sort((a, b) => b.profit - a.profit);
}

// Month-by-month figures for one project (salaries come from the slips' project split).
async function byProjectMonthly(orgId, fromMonth, toMonth, projectId) {
  const [entries, slipRows] = await Promise.all([
    actualEntries(orgId, monthStart(fromMonth), monthEnd(toMonth), { project_id: projectId }),
    slips(orgId, monthStart(fromMonth), monthEnd(toMonth)),
  ]);
  const rows = new Map(monthsBetween(fromMonth, toMonth).map((m) => [m, { month: m, revenue: 0, expense: 0, salaries: 0 }]));
  for (const e of entries) {
    const row = rows.get(monthOf(e.entry_date));
    if (row) row[e.type === 'revenue' ? 'revenue' : 'expense'] += num(e.amount);
  }
  for (const s of slipRows) {
    const row = rows.get(s.month);
    const split = Array.isArray(s.project_split) ? s.project_split : [];
    if (row) row.salaries += split.filter((p) => p.project_id === projectId).reduce((a, p) => a + num(p.amount), 0);
  }
  return [...rows.values()].map((r) => ({ month: r.month, revenue: round2(r.revenue), expense: round2(r.expense), salaries: round2(r.salaries), profit: round2(r.revenue - r.expense - r.salaries) }));
}
async function valuation(orgId) {
  const settings = await prisma.zxSetting.findUnique({ where: { org_id: orgId } });
  const method = settings?.valuation_method || 'revenue_multiple';
  const multiple = num(settings?.valuation_multiple ?? 3);
  const cm = currentMonth();
  const base = { method, multiple, as_of: new Date().toISOString().slice(0, 10) };
  if (method === 'manual') return { ...base, basis: 'manual', basis_amount: null, value: settings?.valuation_manual == null ? null : num(settings.valuation_manual) };
  const t12 = await summary(orgId, monthStart(addMonths(cm, -11)), monthEnd(cm));
  const basisAmount = method === 'profit_multiple' ? t12.profit : t12.revenue;
  return { ...base, basis: method === 'profit_multiple' ? 'trailing 12-month profit' : 'trailing 12-month revenue', basis_amount: basisAmount, value: round2(Math.max(basisAmount, 0) * multiple) };
}

module.exports = {
  round2, num, dayOf, monthOf, toDate, addMonths, monthsBetween, monthStart, monthEnd, currentMonth, resolveRange,
  actualEntries, slips, summary, monthly, byProject, byProjectMonthly, valuation,
};
