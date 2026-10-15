const { D, ZERO, money } = require('../cashPosition/cash.calc');

// Invoice maths for the invoices a legal entity issues. Decimal only; tax is worked out per line, added up, then rounded
// once on the invoice (the way GST returns add up), and split CGST + SGST inside a state or IGST between states.

const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];
const TYPES = ['gst', 'non_gst', 'usd_export'];
const roundHalfUp = (d) => D(d).toDecimalPlaces(2, 4); // 4 = ROUND_HALF_UP

/** Indian financial year of a date: April to March, e.g. 2026-04-15 -> "2026-27". */
function financialYear(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** "DG/2026-27/0007". The prefix is the entity's own, so every entity has its own series. */
const invoiceNumber = (prefix, series, seq) => `${prefix}/${series}/${String(seq).padStart(4, '0')}`;

/**
 * lines: [{ description, hsn_sac, qty, rate, gst_rate }]
 * Returns { lines (with amount), subtotal, cgst, sgst, igst, total } as 2-decimal strings.
 * intraState: true -> CGST + SGST, false -> IGST (ignored unless type is "gst").
 */
function computeTotals({ type, lines, intraState }) {
  const priced = lines.map((l) => ({ ...l, amount: roundHalfUp(D(l.qty).times(D(l.rate))) }));
  const subtotal = priced.reduce((acc, l) => acc.plus(l.amount), ZERO);
  let tax = ZERO;
  if (type === 'gst') tax = priced.reduce((acc, l) => acc.plus(l.amount.times(D(l.gst_rate || 0)).dividedBy(100)), ZERO);
  tax = roundHalfUp(tax);
  let cgst = ZERO;
  let sgst = ZERO;
  let igst = ZERO;
  if (type === 'gst') {
    if (intraState) { cgst = roundHalfUp(tax.dividedBy(2)); sgst = tax.minus(cgst); } else igst = tax;
  }
  return {
    lines: priced.map((l) => ({ ...l, amount: money(l.amount), gst_rate: type === 'gst' ? Number(l.gst_rate || 0) : 0 })),
    subtotal: money(subtotal), cgst: money(cgst), sgst: money(sgst), igst: money(igst), total: money(subtotal.plus(cgst).plus(sgst).plus(igst)),
  };
}

/** paid / balance and a plain status from the invoice and its live payments. */
function paymentState(invoice, payments, today = new Date().toISOString().slice(0, 10)) {
  const paid = payments.reduce((acc, p) => acc.plus(D(p.amount)), ZERO);
  const balance = D(invoice.total).minus(paid);
  let status = 'unpaid';
  if (invoice.status === 'cancelled') status = 'cancelled';
  else if (balance.lte(0)) status = 'paid';
  else if (paid.gt(0)) status = 'partially_paid';
  else if (invoice.due_date && new Date(invoice.due_date).toISOString().slice(0, 10) < today) status = 'overdue';
  return { paid: money(paid), balance: money(balance), payment_status: status };
}

module.exports = { GST_RATES, TYPES, financialYear, invoiceNumber, computeTotals, paymentState, roundHalfUp };
