// Gulati Foundation - the ONLY place campaign money is calculated. Nothing here touches the database; the services
// feed it campaigns, entries and plan rows, and the client only displays what comes back.
//
// Definitions (kept deliberately separate, never added together):
//   allocated_budget      the amount formally assigned to the campaign (a budget, not money spent, not revenue)
//   planned_investment    the part of it the foundation intends to put into the programme
//   actual_expenditure    paid expense entries (status 'paid'), programme + operational
//   actual_investment     the paid expense entries classed 'programme' - a SUBSET of actual_expenditure, so one
//                         payment is never counted twice
//   commitments           approved expense entries not paid yet (outstanding commitments)
//   funds_received        funding entries that have been received (pledged funding is shown apart)
//   remaining_allocated   allocated - actual_expenditure                  (never shown below 0; the excess is overspend)
//   uncommitted           allocated - actual_expenditure - commitments    (never below 0; the excess is over_committed)
//   planned_remaining     planned_investment - actual_investment          (never below 0; the excess is investment_overrun)
// Pending, rejected, cancelled and reversed entries never count as spending; transfers are neither income nor expense.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const monthOf = (v) => (v ? dayOf(v).slice(0, 7) : null);
const idx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const at = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const monthsBetween = (from, to) => {
  const out = [];
  if (!from || !to || idx(to) < idx(from)) return out;
  for (let i = idx(from); i <= idx(to); i += 1) out.push(at(i));
  return out;
};
const DAY = 86400000;
const OPEN_STATUSES = ['planned', 'active', 'on_hold'];
const FINAL_STATUSES = ['completed', 'cancelled'];

// ---- entry classification ----
const isPaidExpense = (e) => e.kind === 'expense' && e.status === 'paid';
const isCommitment = (e) => e.kind === 'expense' && e.status === 'approved';
const isReceived = (e) => e.kind === 'funding' && e.status === 'received';
const isPledged = (e) => e.kind === 'funding' && e.status === 'pledged';
const isProgramme = (e) => e.expense_class !== 'operational';
const sum = (rows) => round2(rows.reduce((a, e) => a + num(e.amount), 0));

/** Money totals of one campaign (or of any set of entries) - see the definitions at the top of the file. */
function summarize(campaign, entries = []) {
  const allocated = round2(num(campaign.allocated_budget));
  const planned = round2(num(campaign.planned_investment));
  const paid = entries.filter(isPaidExpense);
  const actual_expenditure = sum(paid);
  const actual_investment = sum(paid.filter(isProgramme));
  const commitments = sum(entries.filter(isCommitment));
  const funds_received = sum(entries.filter(isReceived));
  const funds_pledged = sum(entries.filter(isPledged));
  const remainingRaw = round2(allocated - actual_expenditure);
  const uncommittedRaw = round2(allocated - actual_expenditure - commitments);
  const plannedRemainingRaw = round2(planned - actual_investment);
  return {
    allocated_budget: allocated,
    planned_investment: planned,
    actual_expenditure,
    actual_investment,
    actual_operational: round2(actual_expenditure - actual_investment),
    commitments,
    funds_received,
    funds_pledged,
    net_funds: round2(funds_received - actual_expenditure),
    remaining_allocated: Math.max(0, remainingRaw),
    overspend: Math.max(0, -remainingRaw),
    uncommitted: Math.max(0, uncommittedRaw),
    // only the part of the excess that is caused by commitments (spending already over budget is reported as overspend)
    over_committed: Math.max(0, round2(Math.max(0, -uncommittedRaw) - Math.max(0, -remainingRaw))),
    planned_remaining: Math.max(0, plannedRemainingRaw),
    investment_overrun: Math.max(0, -plannedRemainingRaw),
    utilization_pct: allocated > 0 ? round2((actual_expenditure / allocated) * 100) : null,
    over_budget: actual_expenditure > allocated,
  };
}

// ---- timeline ----
function timeline(campaign, today = dayOf(new Date())) {
  const start = dayOf(campaign.planned_start);
  const end = dayOf(campaign.planned_end);
  const duration_days = start && end && end >= start ? Math.round((new Date(end) - new Date(start)) / DAY) + 1 : null;
  const duration_months = start && end && end >= start ? monthsBetween(monthOf(start), monthOf(end)).length : null;
  let schedule_elapsed_pct = null;
  if (duration_days) {
    const elapsed = Math.round((new Date(today) - new Date(start)) / DAY) + 1;
    schedule_elapsed_pct = Math.min(100, Math.max(0, Math.round((elapsed / duration_days) * 1000) / 10));
  }
  const delayed = Boolean(end && !FINAL_STATUSES.includes(campaign.status) && end < today);
  const days_to_end = end ? Math.round((new Date(end) - new Date(today)) / DAY) : null;
  return { planned_start: start, planned_end: end, actual_start: dayOf(campaign.actual_start), actual_end: dayOf(campaign.actual_end), duration_days, duration_months, schedule_elapsed_pct, delayed, days_to_end };
}

// ---- plan ----
/** month -> planned investment. Explicit plan rows win; otherwise planned_investment is spread evenly over the duration. */
function planMap(campaign, planRows = []) {
  const map = new Map();
  if (planRows.length) {
    for (const r of planRows) map.set(r.month, round2(num(r.planned_amount)));
    return { map, source: 'plan' };
  }
  const months = monthsBetween(monthOf(campaign.planned_start), monthOf(campaign.planned_end));
  const planned = round2(num(campaign.planned_investment));
  if (!months.length || planned <= 0) return { map, source: 'none' };
  const each = Math.floor((planned / months.length) * 100) / 100;
  months.forEach((m, i) => map.set(m, i === months.length - 1 ? round2(planned - each * (months.length - 1)) : each));
  return { map, source: 'even' };
}

/** Month by month: planned investment, actual investment, actual expenditure, funding received and what is still to invest. */
function monthlySeries(campaign, entries, planRows, { from, to } = {}) {
  const { map } = planMap(campaign, planRows);
  const actual = new Map();
  const bump = (m, k, v) => { const r = actual.get(m) || { investment: 0, expenditure: 0, received: 0 }; r[k] += v; actual.set(m, r); };
  for (const e of entries) {
    const m = monthOf(e.entry_date);
    if (isPaidExpense(e)) { bump(m, 'expenditure', num(e.amount)); if (isProgramme(e)) bump(m, 'investment', num(e.amount)); }
    else if (isReceived(e)) bump(m, 'received', num(e.amount));
  }
  const keys = [...new Set([...map.keys(), ...actual.keys()])].sort();
  if (!keys.length) return [];
  const first = from && from > keys[0] ? from : keys[0];
  const last = to && to < keys[keys.length - 1] ? to : keys[keys.length - 1];
  const planned = round2(num(campaign.planned_investment));
  let cumulative = 0;
  // cumulative actual before the window, so "remaining" is right when the series is cut
  for (const m of keys) if (m < first) cumulative += actual.get(m)?.investment || 0;
  return monthsBetween(first, last).map((month) => {
    const a = actual.get(month) || { investment: 0, expenditure: 0, received: 0 };
    cumulative += a.investment;
    return {
      month,
      planned_investment: map.get(month) || 0,
      actual_investment: round2(a.investment),
      actual_expenditure: round2(a.expenditure),
      funding_received: round2(a.received),
      remaining_planned_investment: Math.max(0, round2(planned - cumulative)),
    };
  });
}

// ---- forecast ----
/**
 * Projected spending to the campaign's end. A projection is a label on the screen only: it never creates an entry.
 *   completed / cancelled   final actuals, no projection
 *   plan                    the remaining planned investment, spread over the remaining months in proportion to the plan
 *   run_rate                the recent monthly average of paid expenditure (needs two complete months of history;
 *                           otherwise it says so and falls back to the plan)
 * projected_final_expenditure = actual expenditure + whatever is still expected (the larger of the remaining planned
 * investment and the approved-but-unpaid commitments).
 */
function forecast(campaign, entries, planRows, settings = {}, now = new Date()) {
  const s = summarize(campaign, entries);
  const today = dayOf(now);
  const current = monthOf(today);
  const method = settings.forecast_method === 'run_rate' ? 'run_rate' : 'plan';
  const base = { method, allocated_budget: s.allocated_budget, planned_investment: s.planned_investment, actual_expenditure: s.actual_expenditure, remaining_months: 0, monthly: [], note: '' };

  if (FINAL_STATUSES.includes(campaign.status)) {
    return { ...base, method: 'final', projected_final_expenditure: s.actual_expenditure, projected_remaining_budget: Math.max(0, round2(s.allocated_budget - s.actual_expenditure)), projected_overrun: s.overspend, projected_underspend: Math.max(0, round2(s.allocated_budget - s.actual_expenditure)), note: campaign.status === 'completed' ? 'Campaign completed: these are the final actuals.' : 'Campaign cancelled: no further spending is expected.' };
  }

  const startM = monthOf(campaign.planned_start) || monthOf(campaign.actual_start);
  const endM = monthOf(campaign.planned_end);
  if (!endM) return { ...base, projected_final_expenditure: null, projected_remaining_budget: null, projected_overrun: 0, projected_underspend: 0, insufficient: true, note: 'No planned end date, so no projection can be made.' };

  // Remaining months: from the later of this month and the start, to the end (a past end projects into this month).
  const fromM = startM && startM > current ? startM : current;
  const toM = endM < fromM ? fromM : endM;
  const remainingMonths = monthsBetween(fromM, toM);
  const { map: plan } = planMap(campaign, planRows);
  const expected = Math.max(s.planned_remaining, s.commitments);
  let monthly = [];
  let used = method;
  let note = '';

  const completeMonths = (() => {
    const seen = new Map();
    for (const e of entries) if (isPaidExpense(e)) { const m = monthOf(e.entry_date); if (m < current) seen.set(m, (seen.get(m) || 0) + num(e.amount)); }
    return seen;
  })();
  const nRate = Math.max(1, Number(settings.run_rate_months) || 3);

  if (method === 'run_rate') {
    const lastMonths = monthsBetween(at(idx(current) - nRate), at(idx(current) - 1)).filter((m) => completeMonths.has(m));
    if (lastMonths.length < 2) {
      used = 'plan';
      note = 'Run-rate needs at least two complete months of spending; using the planned schedule instead.';
    } else {
      const avg = lastMonths.reduce((a, m) => a + completeMonths.get(m), 0) / lastMonths.length;
      const paidThisMonth = round2(entries.filter((e) => isPaidExpense(e) && monthOf(e.entry_date) === current).reduce((a, e) => a + num(e.amount), 0));
      monthly = remainingMonths.map((m) => ({ month: m, projected: round2(m === current ? Math.max(0, avg - paidThisMonth) : avg) }));
      note = `Run-rate: average of ${lastMonths.length} recent complete month(s), ${round2(avg)} a month.`;
    }
  }
  if (used === 'plan') {
    const weights = remainingMonths.map((m) => plan.get(m) || 0);
    const total = weights.reduce((a, w) => a + w, 0);
    let remaining = expected;
    monthly = remainingMonths.map((m, i) => {
      const share = total > 0 ? weights[i] / total : 1 / remainingMonths.length;
      const amount = i === remainingMonths.length - 1 ? remaining : round2(expected * share);
      remaining = round2(remaining - amount);
      return { month: m, projected: Math.max(0, amount) };
    });
    note = note || (campaign.status === 'on_hold' ? 'Campaign is on hold; the plan is shown as if it resumed.' : startM && startM > current ? 'Campaign has not started: planned schedule.' : 'Planned schedule: the remaining planned investment spread over the remaining months.');
  }
  const projected_remaining_spend = round2(monthly.reduce((a, m) => a + m.projected, 0));
  const projected_final_expenditure = round2(s.actual_expenditure + projected_remaining_spend);
  return {
    ...base,
    method: used,
    remaining_months: remainingMonths.length,
    monthly,
    projected_final_expenditure,
    projected_remaining_budget: Math.max(0, round2(s.allocated_budget - projected_final_expenditure)),
    projected_overrun: Math.max(0, round2(projected_final_expenditure - s.allocated_budget)),
    projected_underspend: Math.max(0, round2(s.allocated_budget - projected_final_expenditure)),
    note,
  };
}

// ---- attention flags ----
/** What needs a person's attention on a campaign. Each flag carries its own amount so the screen can say why. */
function flags(campaign, entries, planRows, settings = {}, now = new Date()) {
  const s = summarize(campaign, entries);
  const f = forecast(campaign, entries, planRows, settings, now);
  const t = timeline(campaign, dayOf(now));
  const out = [];
  if (s.overspend > 0) out.push({ type: 'over_budget', severity: 'critical', amount: s.overspend, message: 'Spending is over the allocated budget' });
  else if (s.over_committed > 0) out.push({ type: 'over_committed', severity: 'warning', amount: s.over_committed, message: 'Approved commitments exceed what is left of the budget' });
  if (f.projected_overrun > 0 && s.overspend === 0) out.push({ type: 'projected_overrun', severity: 'warning', amount: f.projected_overrun, message: 'Projected to finish over budget' });
  if (OPEN_STATUSES.includes(campaign.status) && s.allocated_budget === 0) out.push({ type: 'no_budget', severity: 'warning', amount: 0, message: 'No budget has been allocated' });
  if (t.delayed) out.push({ type: 'delayed', severity: 'warning', amount: 0, message: 'Past its planned end date and not completed' });
  const soon = Number(settings.ending_soon_days) || 30;
  if (campaign.status === 'active' && t.days_to_end !== null && t.days_to_end >= 0 && t.days_to_end <= soon && s.allocated_budget > 0 && s.remaining_allocated >= s.allocated_budget * 0.2) {
    out.push({ type: 'ending_with_funds', severity: 'info', amount: s.remaining_allocated, message: `Ends in ${t.days_to_end} day(s) with funds still unspent` });
  }
  if (campaign.status === 'completed' && s.remaining_allocated > 0) out.push({ type: 'completed_unspent', severity: 'info', amount: s.remaining_allocated, message: 'Completed with unspent allocated budget' });
  if (campaign.status === 'active') {
    const { map } = planMap(campaign, planRows);
    const current = monthOf(dayOf(now));
    const dueToDate = round2([...map.entries()].filter(([m]) => m < current).reduce((a, [, v]) => a + v, 0));
    if (dueToDate > 0 && s.actual_investment < dueToDate * 0.8) out.push({ type: 'behind_plan', severity: 'info', amount: round2(dueToDate - s.actual_investment), message: 'Investment is behind the approved plan' });
  }
  return out;
}

module.exports = {
  round2, num, dayOf, monthOf, idx, at, monthsBetween, OPEN_STATUSES, FINAL_STATUSES,
  isPaidExpense, isCommitment, isReceived, isPledged, isProgramme,
  summarize, timeline, planMap, monthlySeries, forecast, flags,
};
