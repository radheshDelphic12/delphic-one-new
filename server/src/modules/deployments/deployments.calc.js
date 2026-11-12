// Pure maths of Group Travel > Deployments: months of a deployment, the estimated budget (monthly lines recur), who bears what, and the
// variance against the actual expenses. No database in here.

const FUNDINGS = ['company', 'client', 'shared', 'client_reimbursable'];
const CATEGORIES = ['travel_ticket', 'accommodation', 'food', 'local_conveyance', 'other'];
const DAY = 86400000;

const n = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const dayNumber = (s) => Math.floor(new Date(`${ymd(s)}T00:00:00.000Z`).getTime() / DAY);

/** Calendar days of a deployment, both ends included. */
const daysBetween = (start, end) => Math.max(1, dayNumber(end) - dayNumber(start) + 1);
/** Months a monthly budget line recurs for: 30-day blocks, at least one. */
const monthsOf = (start, end) => Math.max(1, Math.ceil(daysBetween(start, end) / 30));

/** The part of an amount the client bears (or must pay back): client = all, shared = its percentage, reimbursable = all, company = none. */
function clientPart(amount, funding, pct) {
  const a = n(amount);
  if (funding === 'client' || funding === 'client_reimbursable') return round2(a);
  if (funding === 'shared') return round2((a * Math.min(100, Math.max(0, n(pct)))) / 100);
  return 0;
}

/**
 * Estimated budget of a deployment. A monthly line counts for every month of the deployment, a one-time line once.
 * company_borne = what the company finally pays (company-funded + its share of shared lines); client_borne = what the client pays directly
 * (client-funded + its share of shared lines); recoverable = reimbursable lines the company pays first and gets back.
 */
function estimate(lines, months) {
  const out = { months, total: 0, one_time: 0, monthly_per_month: 0, monthly_total: 0, billable: 0, non_billable: 0, company_borne: 0, client_borne: 0, recoverable: 0, by_category: {}, by_funding: {} };
  for (const l of lines) {
    const amount = n(l.amount);
    const total = l.frequency === 'monthly' ? amount * months : amount;
    out.total += total;
    if (l.frequency === 'monthly') { out.monthly_per_month += amount; out.monthly_total += total; } else out.one_time += total;
    if (l.billable) out.billable += total; else out.non_billable += total;
    if (l.funding === 'client') out.client_borne += total;
    else if (l.funding === 'client_reimbursable') out.recoverable += total;
    else if (l.funding === 'shared') {
      const c = clientPart(total, 'shared', l.client_share_pct);
      out.client_borne += c;
      out.company_borne += total - c;
    } else out.company_borne += total;
    out.by_category[l.category] = (out.by_category[l.category] || 0) + total;
    out.by_funding[l.funding] = (out.by_funding[l.funding] || 0) + total;
  }
  for (const k of ['total', 'one_time', 'monthly_per_month', 'monthly_total', 'billable', 'non_billable', 'company_borne', 'client_borne', 'recoverable']) out[k] = round2(out[k]);
  for (const m of [out.by_category, out.by_funding]) for (const k of Object.keys(m)) m[k] = round2(m[k]);
  return out;
}

/** Month keys (YYYY-MM) from the start month to the end month, both included. */
function monthKeys(start, end) {
  const keys = [];
  let y = Number(ymd(start).slice(0, 4));
  let m = Number(ymd(start).slice(5, 7));
  const last = ymd(end).slice(0, 7);
  for (let i = 0; i < 120; i += 1) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    keys.push(key);
    if (key >= last) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return keys;
}

/**
 * Actual spend of the live (not rejected) expenses against the estimate: totals, billable split, funding split, the month by month
 * budget vs actual (the one-time lines fall in the first month), the variance and what the client still owes.
 */
function actuals(expenses, est, start, end) {
  const live = expenses.filter((e) => e.status !== 'rejected');
  const sum = (rows, f) => round2(rows.reduce((a, r) => a + f(r), 0));
  const total = sum(live, (e) => n(e.amount));
  const byFunding = {};
  for (const f of FUNDINGS) byFunding[f] = sum(live.filter((e) => e.funding === f), (e) => n(e.amount));
  const clientBorne = sum(live, (e) => (e.funding === 'client' || e.funding === 'shared' ? n(e.client_amount) : 0));
  const keys = monthKeys(start, end);
  const months = keys.map((key, i) => {
    const budget = round2(est.monthly_per_month + (i === 0 ? est.one_time : 0));
    const actual = sum(live.filter((e) => e.month === key), (e) => n(e.amount));
    return { month: key, budget, actual, variance: round2(budget - actual) };
  });
  // months with spend outside the planned span still show
  for (const key of [...new Set(live.map((e) => e.month))].filter((k) => !keys.includes(k)).sort()) {
    const actual = sum(live.filter((e) => e.month === key), (e) => n(e.amount));
    months.push({ month: key, budget: 0, actual, variance: round2(-actual) });
  }
  const recoverable = expenses.filter((e) => ['verified', 'settled'].includes(e.status));
  const owed = sum(recoverable, (e) => Math.max(0, n(e.client_amount) - n(e.recovered_amount)));
  const recovered = sum(expenses, (e) => n(e.recovered_amount));
  return {
    total,
    billable: sum(live.filter((e) => e.billable), (e) => n(e.amount)),
    non_billable: sum(live.filter((e) => !e.billable), (e) => n(e.amount)),
    by_funding: byFunding,
    client_borne: clientBorne,
    company_borne: round2(total - sum(live, (e) => n(e.client_amount))),
    unverified: sum(live.filter((e) => e.status === 'submitted'), (e) => n(e.amount)),
    verified: sum(live.filter((e) => ['verified', 'settled'].includes(e.status)), (e) => n(e.amount)),
    settled: sum(live.filter((e) => e.status === 'settled'), (e) => n(e.amount)),
    months,
    variance: round2(est.total - total),
    variance_pct: est.total > 0 ? round2(((est.total - total) / est.total) * 100) : null,
    over_budget: est.total > 0 ? total > est.total : total > 0,
    pending_recovery: owed,
    recovered,
  };
}

/** Recovery state of an expense from what the client has paid back so far. */
function recoveryStatus(clientAmount, recovered) {
  if (n(clientAmount) <= 0) return 'none';
  if (n(recovered) >= n(clientAmount) - 0.005) return 'recovered';
  return n(recovered) > 0 ? 'partial' : 'pending';
}

module.exports = { FUNDINGS, CATEGORIES, n, round2, ymd, daysBetween, monthsOf, clientPart, estimate, monthKeys, actuals, recoveryStatus };
