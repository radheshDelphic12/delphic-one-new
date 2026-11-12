// Pure accounting rules of Zklyrera Spirits. No database, no clock (callers pass `today`), so the dashboard, the
// monthly report, the projections, the group dashboard and the tests all use the same definitions.
//
// Perspective: the company places capital into investments and recovers it. Per investment:
//   amount            original capital placed (counted only while the investment is `active`; planned / cancelled are not)
//   principal_returned recovered original capital (NEVER income)
//   earnings          profit / interest received on top of the principal (income)
//   outstanding       amount - principal_returned (never below 0)
// Recognised income   = investment earnings + income entries (paid or unpaid, not cancelled)
// Recognised expenses = expense entries (operating + other) + salary entries (paid or unpaid, not cancelled), each counted once
// Net result          = recognised income - recognised expenses (capital placed and principal recovered are excluded)
// Cash in             = principal returned + earnings + PAID income;  cash out = capital placed + PAID expenses + PAID salaries
// Transfers are neither income nor expense nor cash for the company result.
const { round2, num, dayOf, monthOf, idx, at, monthsBetween } = require('../foundation/campaign.calc');

const LINES = ['new_investment', 'principal_recovery', 'investment_earnings', 'other_income', 'operating_expense', 'salary', 'other_expense'];
const LINE_LABEL = {
  new_investment: 'New investment', principal_recovery: 'Principal recovery', investment_earnings: 'Investment earnings', other_income: 'Other income',
  operating_expense: 'Operating expenses', salary: 'Salaries', other_expense: 'Other expenses',
};
const INCOME_LINES = ['investment_earnings', 'other_income'];
const EXPENSE_LINES = ['operating_expense', 'salary', 'other_expense'];

const sum = (rows, pick) => round2(rows.reduce((a, r) => a + num(pick(r)), 0));
const live = (r) => !r.deleted_at;
const receivedReturn = (r) => live(r) && r.status !== 'reversed';

/** One investment with its returns: totals and the derived status (planned | active | partially_returned | completed | overdue | cancelled). */
function investmentView(inv, returns = [], today = dayOf(new Date())) {
  const rows = returns.filter(receivedReturn);
  const amount = round2(num(inv.amount));
  const principal = sum(rows, (r) => r.principal);
  const earnings = sum(rows, (r) => r.earnings);
  const counted = inv.status === 'active';
  const outstanding = counted ? Math.max(0, round2(amount - principal)) : inv.status === 'planned' ? 0 : 0;
  let status = inv.status;
  if (counted) status = principal <= 0 ? 'active' : principal >= amount ? 'completed' : 'partially_returned';
  const expectedAmount = inv.expected_return_amount === null || inv.expected_return_amount === undefined ? null : round2(num(inv.expected_return_amount));
  const expectedDate = dayOf(inv.expected_return_date);
  const received = round2(principal + earnings);
  const expectedOutstanding = expectedAmount === null ? null : Math.max(0, round2(expectedAmount - received));
  const open = counted && status !== 'completed';
  const overdue = Boolean(open && expectedDate && expectedDate < today && ((expectedOutstanding ?? outstanding) > 0));
  return {
    amount, counted, status: overdue ? 'overdue' : status, base_status: status, overdue,
    principal_returned: principal, earnings, received, outstanding_principal: outstanding,
    expected_return_amount: expectedAmount, expected_return_date: expectedDate,
    expected_outstanding: expectedOutstanding, return_variance: expectedAmount === null ? null : round2(received - expectedAmount),
    return_pct: amount > 0 && counted ? Math.round((earnings / amount) * 1000) / 10 : null,
  };
}

const inRange = (date, from, to) => {
  const d = dayOf(date);
  return (!from || d >= from) && (!to || d <= to);
};
const notCancelled = (e) => live(e) && e.payment_status !== 'cancelled';
const paid = (e) => live(e) && e.payment_status === 'paid';

/**
 * Every figure for [from, to] from the raw rows. `investments` carry their `returns`; `entries` are zk_entries.
 * `payroll` false hides the salary figures (privacy): they are returned as null and left out of the totals shown.
 */
function summarize({ investments = [], entries = [], from, to, payroll = true } = {}) {
  const live_inv = investments.filter((i) => live(i) && i.status === 'active');
  const added = live_inv.filter((i) => inRange(i.investment_date, from, to));
  const rets = investments.filter(live).flatMap((i) => (i.returns || []).filter((r) => receivedReturn(r) && i.status !== 'cancelled' && inRange(r.return_date, from, to)));
  const inc = entries.filter((e) => e.kind === 'income' && notCancelled(e) && inRange(e.entry_date, from, to));
  const exp = entries.filter((e) => e.kind === 'expense' && notCancelled(e) && inRange(e.entry_date, from, to));
  const sal = entries.filter((e) => e.kind === 'salary' && notCancelled(e) && inRange(e.entry_date, from, to));
  const operating = exp.filter((e) => e.expense_class !== 'other');
  const other = exp.filter((e) => e.expense_class === 'other');

  const investmentAdded = sum(added, (i) => i.amount);
  const principal = sum(rets, (r) => r.principal);
  const earnings = sum(rets, (r) => r.earnings);
  const otherIncome = sum(inc, (e) => e.amount);
  const operatingExpenses = sum(operating, (e) => e.amount);
  const otherExpenses = sum(other, (e) => e.amount);
  const salaries = sum(sal, (e) => e.amount);
  const salariesPaid = sum(sal.filter(paid), (e) => e.amount);
  const income = round2(earnings + otherIncome);
  const expenses = round2(operatingExpenses + otherExpenses + salaries);
  const paidExpenses = sum(exp.filter(paid), (e) => e.amount);
  const paidIncome = sum(inc.filter(paid), (e) => e.amount);
  const cashIn = round2(principal + earnings + paidIncome);
  const cashOut = round2(investmentAdded + paidExpenses + salariesPaid);

  const out = {
    from: from || null, to: to || null,
    investment_added: investmentAdded, investment_count: added.length,
    principal_returned: principal, investment_earnings: earnings, other_income: otherIncome,
    income, operating_expenses: operatingExpenses, other_expenses: otherExpenses, salaries, salaries_paid: salariesPaid,
    expenses, expenses_ex_salary: round2(operatingExpenses + otherExpenses),
    paid_expenses: paidExpenses, paid_income: paidIncome,
    cash_in: cashIn, cash_out: cashOut, net_cash: round2(cashIn - cashOut),
    cash_outflow_parts: { capital_invested: investmentAdded, expenses_paid: paidExpenses, salaries_paid: salariesPaid },
    net_result: round2(income - expenses),
  };
  if (!payroll) {
    out.salaries = null; out.salaries_paid = null; out.expenses = out.expenses_ex_salary; out.net_result = round2(income - out.expenses_ex_salary);
    out.cash_out = round2(investmentAdded + paidExpenses); out.net_cash = round2(cashIn - out.cash_out); out.cash_outflow_parts.salaries_paid = null; out.payroll_hidden = true;
  }
  return out;
}

/** Position at a date (all time up to `to`): what is still owed to / by the company and what capital is still out. */
function position({ investments = [], entries = [], to, today = dayOf(new Date()), payroll = true } = {}) {
  const views = investments.filter(live).map((i) => ({ inv: i, v: investmentView(i, (i.returns || []).filter((r) => !to || dayOf(r.return_date) <= to), today) }));
  const active = views.filter((x) => x.v.counted && (!to || dayOf(x.inv.investment_date) <= to));
  const open = entries.filter((e) => live(e) && e.payment_status === 'unpaid' && (!to || dayOf(e.entry_date) <= to));
  const receivables = sum(open.filter((e) => e.kind === 'income'), (e) => e.amount);
  const payExp = sum(open.filter((e) => e.kind === 'expense'), (e) => e.amount);
  const paySal = sum(open.filter((e) => e.kind === 'salary'), (e) => e.amount);
  const stale = (list) => list.filter((e) => e.due_date && dayOf(e.due_date) < today).length;
  return {
    outstanding_principal: round2(active.reduce((a, x) => a + x.v.outstanding_principal, 0)),
    expected_returns_outstanding: round2(active.reduce((a, x) => a + (x.v.expected_outstanding ?? 0), 0)),
    overdue_investments: active.filter((x) => x.v.overdue).length,
    receivables, payables: payroll ? round2(payExp + paySal) : payExp, payables_salary: payroll ? paySal : null,
    overdue_receivables: stale(open.filter((e) => e.kind === 'income')), overdue_payables: stale(open.filter((e) => e.kind !== 'income')),
  };
}

/** One summary per month of [from, to] (YYYY-MM), for the trend charts and the monthly report. */
function monthly(data, from, to) {
  return monthsBetween(from, to).map((m) => ({ month: m, ...summarize({ ...data, from: `${m}-01`, to: monthEnd(m) }) }));
}
const monthEnd = (m) => dayOf(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)));

// ---------------- projections ----------------
/** What a projection line is compared with: the matching actual of the same period summary. */
function actualOfLine(s, line) {
  return ({
    new_investment: s.investment_added, principal_recovery: s.principal_returned, investment_earnings: s.investment_earnings,
    other_income: s.other_income, operating_expense: s.operating_expenses, salary: s.salaries, other_expense: s.other_expenses,
  })[line];
}

/**
 * Projected vs actual per line. variance = actual - projected. For an expense a positive variance (spent more) is
 * unfavourable; for income / returns a negative variance is. Archived projections are ignored; a projection is a plan only.
 */
function compare(projections = [], s) {
  const planned = new Map(LINES.map((l) => [l, 0]));
  for (const p of projections) if (live(p) && p.status !== 'archived') planned.set(p.line, round2(planned.get(p.line) + num(p.amount)));
  return LINES.map((line) => {
    const actual = actualOfLine(s, line);
    const projected = planned.get(line);
    if (actual === null || actual === undefined) return { line, label: LINE_LABEL[line], projected, actual: null, variance: null, variance_pct: null, remaining: null, favourable: null, status: 'hidden' };
    const variance = round2(actual - projected);
    const isExpense = EXPENSE_LINES.includes(line);
    const favourable = projected === 0 && actual === 0 ? null : isExpense ? variance <= 0 : variance >= 0;
    return {
      line, label: LINE_LABEL[line], projected, actual, variance,
      variance_pct: projected !== 0 ? Math.round((variance / projected) * 1000) / 10 : null,
      remaining: Math.max(0, round2(projected - actual)),
      favourable, status: projected === 0 && actual === 0 ? 'none' : projected === 0 ? 'unplanned' : favourable ? 'on_track' : 'off_track',
    };
  });
}

/** Projected totals of a set of projections: income, expenses, net (a plan; separate from every actual). */
function projectedTotals(projections = []) {
  const by = Object.fromEntries(LINES.map((l) => [l, 0]));
  for (const p of projections) if (live(p) && p.status !== 'archived') by[p.line] = round2(by[p.line] + num(p.amount));
  const income = round2(INCOME_LINES.reduce((a, l) => a + by[l], 0));
  const expenses = round2(EXPENSE_LINES.reduce((a, l) => a + by[l], 0));
  return { ...by, income, expenses, net: round2(income - expenses) };
}

module.exports = {
  LINES, LINE_LABEL, INCOME_LINES, EXPENSE_LINES, round2, num, dayOf, monthOf, idx, at, monthsBetween, monthEnd,
  investmentView, summarize, position, monthly, compare, projectedTotals, actualOfLine,
};
