// Pure deal arithmetic: every financial figure the UI shows is computed here, server-side.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const sum = (rows, f) => rows.reduce((a, r) => a + num(f(r)), 0);

// amount = qty x rate unless an explicit amount is given (admin/manager may override).
function lineAmount({ quantity, rate, amount }) {
  if (amount !== undefined && amount !== null && amount !== '') return round2(amount);
  if (quantity != null && rate != null) return round2(num(quantity) * num(rate));
  return null;
}

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

function paymentState(total, paid) {
  if (total <= 0) return 'unpaid';
  if (paid <= 0) return 'unpaid';
  return paid + 0.005 >= total ? 'paid' : 'partial';
}

// Quantity position of a deal. Partial sourcing / supply is simply several purchases / sales.
function quantities(deal, purchases, sales) {
  const ordered = deal.ordered_quantity == null ? null : num(deal.ordered_quantity);
  const sourced = round3(sum(purchases, (p) => p.quantity));
  const supplied = round3(sum(sales, (s) => s.quantity));
  return {
    ordered,
    sourced,
    supplied,
    remaining_to_source: ordered == null ? null : round3(ordered - sourced),
    remaining_to_supply: ordered == null ? null : round3(ordered - supplied),
  };
}

// Full financial summary. purchases / sales / expenses / payments are the live (non-deleted) rows.
function summarize(deal, { purchases = [], sales = [], expenses = [], payments = [] }) {
  const purchase_cost = round2(sum(purchases, (p) => p.amount));
  const sales_revenue = round2(sum(sales, (s) => s.amount));
  const deal_expenses = round2(sum(expenses, (e) => e.amount));
  const gross_profit = round2(sales_revenue - purchase_cost);
  const net_profit = round2(gross_profit - deal_expenses);
  const paid_to_vendor = round2(sum(payments.filter((p) => p.side === 'vendor'), (p) => p.amount));
  const received_from_client = round2(sum(payments.filter((p) => p.side === 'client'), (p) => p.amount));
  const pct = (x) => (sales_revenue > 0 ? Math.round((x / sales_revenue) * 1000) / 10 : null);
  return {
    purchase_cost,
    sales_revenue,
    gross_profit,
    deal_expenses,
    net_profit,
    gross_margin_pct: pct(gross_profit),
    net_margin_pct: pct(net_profit),
    paid_to_vendor,
    vendor_outstanding: round2(purchase_cost - paid_to_vendor),
    received_from_client,
    client_outstanding: round2(sales_revenue - received_from_client),
    quantities: quantities(deal, purchases, sales),
    duration_days: durationDays(deal.start_date, deal.expected_end, deal.actual_end),
    delayed: isDelayed(deal),
  };
}

module.exports = { round2, round3, num, sum, dayOf, lineAmount, durationDays, isDelayed, paymentState, quantities, summarize, DONE };
