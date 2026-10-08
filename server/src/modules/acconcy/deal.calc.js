// Pure deal arithmetic: every financial figure the UI shows is computed here, server-side.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const sum = (rows, f) => rows.reduce((a, r) => a + num(f(r)), 0);

const DAY = 86400000;
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

// Duration in days between start and the actual (else expected) completion; null if either is missing.
function durationDays(start, expectedEnd, actualEnd) {
  const end = actualEnd || expectedEnd;
  if (!start || !end) return null;
  return Math.round((new Date(dayOf(end)) - new Date(dayOf(start))) / DAY);
}

const DONE = ['completed', 'cancelled'];
function isDelayed(deal, today = dayOf(new Date())) {
  if (!deal.expected_end || DONE.includes(deal.status)) return false;
  return dayOf(deal.expected_end) < today;
}

const pct = (x, base) => (base > 0 ? Math.round((x / base) * 1000) / 10 : null);

// Profit = revenue - expenses, from the live ledger rows linked to the deal. Never typed in.
function summarize(deal, entries = []) {
  const revenue = round2(sum(entries.filter((e) => e.type === 'revenue'), (e) => e.amount));
  const expense = round2(sum(entries.filter((e) => e.type === 'expense'), (e) => e.amount));
  const profit = round2(revenue - expense);
  return {
    revenue,
    expense,
    profit,
    margin_pct: pct(profit, revenue),
    deal_amount: deal.deal_amount == null ? null : round2(deal.deal_amount),
    duration_days: durationDays(deal.start_date, deal.expected_end, deal.actual_end),
    delayed: isDelayed(deal),
  };
}

module.exports = { round2, round3, num, sum, pct, dayOf, durationDays, isDelayed, summarize, DONE };
