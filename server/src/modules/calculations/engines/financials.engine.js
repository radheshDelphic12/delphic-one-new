// Financials — one month's result organised by BUSINESS CATEGORY (not a raw
// transaction list). This is what gets snapshotted into Financials when a
// month is locked; Live Analytics shows the same figures while the month is
// still open.
//
//   Revenue   Managed Services Revenue   Billing & Sales (per project, locked month if locked)
//             Project Revenue (fixed price) — the project's invoices of the month (locked month if locked)
//             Trading sales / Self-project revenue / Recurring contracts (other verticals)
//   Salaries  IT Salaries / Non-IT Salaries — attendance-based salary (locked month if locked)
//   Expenses  Group Charges (by category) / Employee Reimbursements (by category)
//             Vendor Payments (contractor timesheets, locked month if locked)
//             Goods purchased / Project costs (other verticals)
//
// Everything is INR. `resolve(kind, scopeKey, period)` is supplied by
// calculations.service and returns a component's LOCKED snapshot when that
// component is locked (so Financials never silently recomputes a finalized
// component), else a live computation.

const prisma = require('../../../config/db');
const exchangeRates = require('../../billing/exchangeRates.service');
const contractsService = require('../../contracts/contracts.service');
const billingEngine = require('./billing.engine');
const { round2, monthBounds } = require('../period');

function node(key, label, children = [], extra = {}) {
  const amount = round2(children.reduce((s, c) => s + c.amount, 0));
  return { key, label, amount, children, ...extra };
}

function leaf(key, label, amount, extra = {}) {
  return { key, label, amount: round2(amount), children: [], ...extra };
}

function byName(rows, pick, amountOf) {
  const map = new Map();
  for (const r of rows) {
    const name = pick(r) || 'Uncategorised';
    map.set(name, (map.get(name) || 0) + amountOf(r));
  }
  return [...map].sort((a, b) => b[1] - a[1]);
}

async function computeFinancialMonth(orgId, { period_month, period_year }, resolve) {
  const { start, end } = monthBounds(period_month, period_year);
  const endExclusive = new Date(end.getTime() + 86400000);
  const fx = await exchangeRates.inrRates(orgId);
  const missingRates = new Set();
  const toInr = (amount, currency) => {
    const cur = currency || 'INR';
    if (!fx.has(cur)) { missingRates.add(cur); return 0; }
    return Number(amount || 0) * fx.get(cur);
  };
  const period = { period_month, period_year };
  const sources = [];

  // --- Revenue: Billing & Sales per project ---
  const projects = await billingEngine.listProjects(orgId, {});
  const managedChildren = [];
  const fixedChildren = [];
  for (const account of projects) {
    const month = await resolve('billing', account.id, period);
    if (!month) continue;
    if (!month.raw.supported) continue;
    const amount = toInr(billingEngine.lockedAmount(month.raw), month.raw.currency);
    if (!amount) continue;
    (month.raw.fixed_bid ? fixedChildren : managedChildren).push(leaf(`project:${account.id}`, `${month.raw.project.code ? `${month.raw.project.code} · ` : ''}${month.raw.project.name}`, amount, { locked: month.locked, version: month.version }));
    sources.push({ kind: 'billing', scope_key: account.id, locked: month.locked, version: month.version || null });
  }

  const [tradeSales, tradePurchases, projectRows, recurring, groupCharges, claims] = await Promise.all([
    prisma.tradeTransaction.aggregate({ where: { org_id: orgId, txn_type: 'sale', status: 'completed', txn_date: { gte: start, lt: endExclusive } }, _sum: { amount: true } }),
    prisma.tradeTransaction.aggregate({ where: { org_id: orgId, txn_type: 'purchase', status: 'completed', txn_date: { gte: start, lt: endExclusive } }, _sum: { amount: true } }),
    prisma.projectFinanceEntry.groupBy({ by: ['entry_type'], where: { org_id: orgId, entry_date: { gte: start, lt: endExclusive } }, _sum: { amount: true } }),
    contractsService.recurringRevenueForMonth(orgId, period_year, period_month),
    prisma.groupBillingCharge.findMany({
      where: {
        org_id: orgId,
        OR: [
          { payment_date: { gte: start, lte: end } },
          { payment_date: null, period_month, period_year },
        ],
      },
      select: { amount: true, currency: true, kind: true, category: { select: { name: true } } },
    }),
    prisma.expenseClaim.findMany({
      where: {
        org_id: orgId,
        status: { in: ['approved', 'reimbursed'] },
        OR: [
          { expense_date: { gte: start, lte: end } },
          { expense_date: null, created_at: { gte: start, lt: endExclusive } },
        ],
      },
      select: { amount: true, currency: true, category: true, category_ref: { select: { name: true } } },
    }),
  ]);
  const selfProject = { revenue: 0, expense: 0 };
  for (const g of projectRows) if (g.entry_type in selfProject) selfProject[g.entry_type] = Number(g._sum.amount || 0);

  const revenueChildren = [
    node('managed_services', 'Managed Services Revenue', managedChildren),
    node('fixed_price', 'Project Revenue (fixed price)', fixedChildren),
  ];
  if (Number(tradeSales._sum.amount || 0)) revenueChildren.push(leaf('trading', 'Trading Sales', Number(tradeSales._sum.amount)));
  if (selfProject.revenue) revenueChildren.push(leaf('self_projects', 'Self-Project Revenue', selfProject.revenue));
  if (recurring) revenueChildren.push(leaf('recurring_contracts', 'Recurring Contracts', recurring));

  // --- Salaries ---
  const salary = await resolve('salary', 'org', period);
  sources.push({ kind: 'salary', scope_key: 'org', locked: salary.locked, version: salary.version || null });
  const salaryLines = salary.raw.lines || [];
  const salariesNode = node('salaries', 'Salaries', [
    leaf('it_salaries', 'IT Salaries', salaryLines.filter((l) => l.is_it).reduce((s, l) => s + l.net, 0), { headcount: salaryLines.filter((l) => l.is_it).length }),
    leaf('non_it_salaries', 'Non-IT Salaries', salaryLines.filter((l) => !l.is_it).reduce((s, l) => s + l.net, 0), { headcount: salaryLines.filter((l) => !l.is_it).length }),
  ], { locked: salary.locked, version: salary.version || null });

  // --- Expenses ---
  const vendor = await resolve('vendor_payment', 'org', period);
  sources.push({ kind: 'vendor_payment', scope_key: 'org', locked: vendor.locked, version: vendor.version || null });
  const expenseChildren = [
    node('group_charges', 'Group Charges', byName(groupCharges, (r) => r.category?.name || r.kind, (r) => toInr(r.amount, r.currency)).map(([name, amount]) => leaf(`group_charge:${name}`, name, amount))),
    node('reimbursements', 'Employee Reimbursements', byName(claims, (r) => r.category_ref?.name || r.category, (r) => toInr(r.amount, r.currency)).map(([name, amount]) => leaf(`expense:${name}`, name, amount))),
    node('vendor_payments', 'Vendor Payments', (vendor.raw.vendors || []).map((v) => leaf(`vendor:${v.vendor?.id || 'none'}`, v.vendor?.name || 'No vendor set', v.amount_inr)), { locked: vendor.locked, version: vendor.version || null }),
  ];
  if (Number(tradePurchases._sum.amount || 0)) expenseChildren.push(leaf('goods_purchased', 'Goods Purchased', Number(tradePurchases._sum.amount)));
  if (selfProject.expense) expenseChildren.push(leaf('project_costs', 'Self-Project Costs', selfProject.expense));

  const revenue = node('revenue', 'Revenue / Sales', revenueChildren);
  const expenses = node('expenses', 'Expenses', expenseChildren);
  const profit = round2(revenue.amount - salariesNode.amount - expenses.amount);
  const blockers = missingRates.size ? [{ code: 'missing_exchange_rate', message: `Set the ${[...missingRates].join(', ')} exchange rate first.` }] : [];
  const unlocked = sources.filter((s) => !s.locked);
  const warnings = unlocked.length
    ? [{ code: 'unlocked_components', count: unlocked.length, message: `${unlocked.length} component(s) are still live (not locked): ${[...new Set(unlocked.map((s) => s.kind))].join(', ')}.` }]
    : [];

  return {
    period_month,
    period_year,
    currency: 'INR',
    categories: [revenue, salariesNode, expenses],
    totals: { revenue: revenue.amount, salaries: salariesNode.amount, expenses: expenses.amount, profit },
    sources,
    missing_rates: [...missingRates],
    readiness: { can_lock: blockers.length === 0, blockers, warnings },
  };
}

module.exports = { computeFinancialMonth };
