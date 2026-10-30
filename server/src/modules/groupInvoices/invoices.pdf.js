const { taxInvoicePdf, dateText } = require('../../lib/taxInvoicePdf');
const { stateName } = require('../../lib/gstStates');
const { D } = require('../cashPosition/cash.calc');
const { roundHalfUp } = require('./invoices.calc');

// The PDF of an invoice a legal entity issued, from the invoice's own snapshot (seller details as they were the day it was issued).
// The layout itself is the shared tax-invoice page in lib/taxInvoicePdf.

const TITLE = { gst: 'Tax Invoice', non_gst: 'Invoice', usd_export: 'Export Invoice' };
/** Tax summary rows, one per GST rate. The rounding the invoice did once on its total lands on the last row, so the table adds up to the invoice. */
function taxSummary(inv) {
  const byRate = new Map();
  for (const l of inv.lines) byRate.set(Number(l.gst_rate || 0), (byRate.get(Number(l.gst_rate || 0)) || D(0)).plus(D(l.amount)));
  const intra = D(inv.cgst).gt(0) || D(inv.sgst).gt(0);
  const labels = intra ? ['CGST', 'SGST'] : ['IGST'];
  const targets = intra ? [D(inv.cgst), D(inv.sgst)] : [D(inv.igst)];
  const rows = [...byRate].map(([rate, taxable]) => ({
    rate: intra ? rate / 2 : rate,
    taxable,
    parts: labels.map((label) => ({ label, amount: roundHalfUp(taxable.times(rate).dividedBy(100).dividedBy(intra ? 2 : 1)) })),
  }));
  labels.forEach((_, i) => {
    const diff = targets[i].minus(rows.reduce((a, r) => a.plus(r.parts[i].amount), D(0)));
    rows[rows.length - 1].parts[i].amount = rows[rows.length - 1].parts[i].amount.plus(diff);
  });
  return rows.map((r) => ({ ...r, taxable: r.taxable.toFixed(2), parts: r.parts.map((p) => ({ label: p.label, amount: p.amount.toFixed(2) })) }));
}

function invoiceModel(inv) {
  const s = inv.seller || {};
  const gst = inv.type === 'gst';
  const buyerState = inv.buyer_state_code || inv.place_of_supply || null;
  return {
    title: TITLE[inv.type] || 'Invoice',
    currency: inv.currency,
    seller: { name: s.name, address: s.address, gstin: s.gstin, pan: s.pan, state_code: s.state_code, state_name: stateName(s.state_code) },
    buyer: { name: inv.buyer_name, address: inv.buyer_address, gstin: inv.buyer_gstin, state_code: buyerState, state_name: stateName(buyerState) },
    place_of_supply: gst && inv.place_of_supply ? stateName(inv.place_of_supply) || inv.place_of_supply : null,
    meta: { number: inv.number, date: dateText(inv.invoice_date), terms: inv.due_date ? `Due ${dateText(inv.due_date)}` : null },
    lines: inv.lines.map((l) => {
      const [first, ...rest] = String(l.description).split('\n').map((t) => t.trim()).filter(Boolean);
      return { description: first || '', details: rest, hsn: l.hsn_sac, gst_rate: gst ? l.gst_rate : null, qty: l.qty, unit: l.unit || '', rate: l.rate, amount: l.amount };
    }),
    showHsn: gst,
    showTax: gst,
    taxes: [{ label: 'CGST', amount: inv.cgst }, { label: 'SGST', amount: inv.sgst }, { label: 'IGST', amount: inv.igst }],
    subtotal: inv.subtotal,
    total: inv.total,
    tax_summary: gst ? taxSummary(inv) : null,
    bank: { holder: s.name, lines: String(inv.payment_instructions || '').split('\n').map((t) => t.trim()).filter(Boolean) },
    remarks: inv.type === 'usd_export' ? inv.lut_note : null,
    notes: inv.notes,
    jurisdiction: stateName(s.state_code) ? `SUBJECT TO ${stateName(s.state_code).toUpperCase()} JURISDICTION` : null,
    cancelled: inv.status === 'cancelled',
  };
}

const invoicePdf = (inv) => taxInvoicePdf(invoiceModel(inv));

module.exports = { invoicePdf, invoiceModel };
