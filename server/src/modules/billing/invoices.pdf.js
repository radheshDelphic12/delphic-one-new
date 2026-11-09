const prisma = require('../../config/db');
const { taxInvoicePdf, dateText } = require('../../lib/taxInvoicePdf');
const { stateName } = require('../../lib/gstStates');
const { D } = require('../cashPosition/cash.calc');

// Client invoices (what a company bills its clients) and vendor invoices (what a vendor bills the company) printed in the same
// tax-invoice layout as the GST / USD invoices. A client invoice whose contract carries a GST charge prints as a full GST TAX INVOICE
// (the Tally layout): an HSN / SAC column, the GST rate, the tax split IGST or CGST + SGST by place of supply, a tax summary, the tax
// in words and a Round Off line, once for the recipient and once for the transporter. Everything else prints without tax columns.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const money = (n, currency) => `${currency} ${Number(n || 0).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num2 = (n) => D(n).toDecimalPlaces(2, 4).toFixed(2);
const periodText = (d, m, y) => (d?.period_from ? `${dateText(d.period_from)} to ${dateText(d.period_to)}` : `${MONTHS[m - 1]} ${y}`);
const DEFAULT_SAC = '998519'; // manpower services
/** "01 July 2024" from 2024-07-01 */
const longDate = (ymd) => { const [y, m, d] = String(ymd).slice(0, 10).split('-'); return `${d} ${MONTHS[Number(m) - 1]} ${y}`; };
/** "01 July 2024 - 31 July 2024": the dates the invoice covers, else the whole month. */
const longPeriod = (d, m, y) => {
  if (d?.period_from) return `${longDate(d.period_from)} - ${longDate(d.period_to || d.period_from)}`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `01 ${MONTHS[m - 1]} ${y} - ${String(last).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
};
/** "100,000.00": a price in the plain grouping the printed invoice uses on its description line. */
const plainPrice = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GST_LABEL = /gst/i;
const SPLIT_LABEL = /^\s*(igst|cgst|sgst)\b/i;

/** The company's own legal entity (the one tied to this workspace) with the bank details printed on its invoices. */
async function companyParty(orgId, currency) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
  const entity = await prisma.legalEntity.findFirst({ where: { workspace_id: orgId, active: true }, include: { bank_accounts: { where: { active: true }, orderBy: { created_at: 'asc' } } } });
  const bank = entity?.bank_accounts.find((b) => b.currency === currency && b.payment_instructions) || entity?.bank_accounts.find((b) => b.payment_instructions);
  const party = {
    name: entity?.name || org?.name || '',
    address: entity?.address || null,
    gstin: entity?.gstin || null,
    pan: entity?.pan || null,
    state_code: entity?.state_code || null,
    state_name: stateName(entity?.state_code),
    signature_image: entity?.signature_image || null,
    signatory_name: entity?.signatory_name || null,
  };
  return { party, bankLines: String(bank?.payment_instructions || '').split('\n').map((t) => t.trim()).filter(Boolean) };
}

/** A client or vendor account as the other party: name, GSTIN / tax id and the address we hold. */
function accountParty(account, billTo) {
  const place = [account?.location_city, account?.location_country].filter(Boolean).join(', ');
  const gst = billTo?.gstin || account?.gst_or_tax_id || null;
  const code = gst && /^\d{2}/.test(gst) ? gst.slice(0, 2) : null;
  return { name: account?.name || '', address: billTo?.address || account?.billing_address || account?.location || place || null, gstin: gst, state_code: code, state_name: stateName(code) };
}

const common = (party, bankLines) => ({
  showHsn: false,
  showTax: false,
  tax_summary: null,
  bank: { holder: party.name, lines: bankLines },
  jurisdiction: party.state_name ? `SUBJECT TO ${party.state_name.toUpperCase()} JURISDICTION` : null,
});

// ---- client invoice ----
function clientLines(inv, opts = {}) {
  const d = inv.details || {};
  const cur = inv.currency;
  const period = periodText(d, inv.period_month, inv.period_year);
  const project = inv.project || {};
  const title = `${project.name || 'Project'}${project.code ? ` (${project.code})` : ''}${project.client_name ? ` - ${project.client_name}` : ''}`;
  // The project's face resource (free text set on the project); older invoices stored no snapshot, so fall back to the project as it is now.
  const face = String(project.face_resource ?? inv.client_account?.face_resource ?? '').trim();
  const head = face ? [title, `Resource: ${face}`] : [title];
  // A combined invoice prints each contract exactly as its own invoice would (same rows, days, rate); the tax / TDS rows are totalled below the items.
  if (inv.line_items?.consolidated) {
    return (inv.line_items.items || []).flatMap((it) => clientLines({
      currency: cur,
      period_month: inv.period_month,
      period_year: inv.period_year,
      details: it.details || {},
      project: it.project || {},
      amount: (it.details || {}).amount,
      line_items: { lines: it.lines || [] },
    }, opts).map((row) => ({ ...row, key: `${it.account_id}:${row.key}` })));
  }
  const resources = inv.line_items?.lines || [];
  const overtime = d.overtime_billed && D(d.overtime_amount || 0).gt(0)
    ? [{ key: 'overtime', description: 'Overtime', details: [`${d.overtime_hours}h at ${d.overtime_multiplier}x`], qty: String(d.overtime_hours || 1), unit: d.overtime_hours ? 'hrs' : '', rate: d.overtime_hours ? num2(D(d.overtime_amount).dividedBy(d.overtime_hours)) : num2(d.overtime_amount), amount: num2(d.overtime_amount) }]
    : [];
  // A GST invoice prints: who / what it is for, the dates in brackets and the monthly price - no project / client line, no working-days maths.
  if (opts.tax) {
    const what = face || title;
    const dates = `(${longPeriod(d, inv.period_month, inv.period_year)})`;
    if (d.billing_type === 'hourly' && resources.length) {
      return resources.map((l) => ({
        key: `res:${l.resource}`,
        description: 'Manpower Services',
        details: [`${l.resource}${face ? `, ${face}` : ''}`, dates, `Rate ${plainPrice(d.rate)} / hour`, ...(l.overtime_hours ? [`Includes ${l.overtime_hours} overtime hrs`] : [])],
        qty: String(l.hours || 0), unit: 'hrs', rate: Number(l.hours) ? num2(D(l.revenue).dividedBy(l.hours)) : num2(l.revenue), amount: num2(l.revenue),
      }));
    }
    if (d.billing_type === 'monthly' && d.contract_working_days) {
      const base = d.base_amount ?? inv.amount;
      const days = d.billing_basis === 'approved_hours' && Number(d.payable_days) > 0 ? Number(d.payable_days) : d.contract_working_days;
      return [{ key: 'main', description: 'Manpower Services', details: [what, dates, `Price Per Month ${plainPrice(d.rate)}`], qty: String(days), unit: 'days', rate: num2(D(base).dividedBy(days)), amount: num2(base) }, ...overtime];
    }
    const kind = d.billing_type === 'one_time' ? 'Fixed-bid project services' : 'Services';
    const base = d.base_amount ?? inv.amount;
    return [{ key: 'main', description: kind, details: [what, dates], qty: '1', unit: '', rate: num2(base), amount: num2(base) }, ...overtime];
  }
  const converted = d.conversion ? [`Converted from ${money(d.conversion.from_amount, d.conversion.from_currency)} @ ${d.conversion.exchange_rate}`] : [];
  if (d.billing_type === 'hourly' && resources.length) {
    return resources.map((l) => ({
      key: `res:${l.resource}`,
      description: l.resource,
      details: [...head, period, `Rate ${money(d.rate, cur)} / hour`, ...(l.overtime_hours ? [`Includes ${l.overtime_hours} overtime hrs`] : []), ...converted],
      qty: String(l.hours || 0), unit: 'hrs', rate: Number(l.hours) ? num2(D(l.revenue).dividedBy(l.hours)) : num2(l.revenue), amount: num2(l.revenue),
    }));
  }
  if (d.billing_type === 'monthly' && d.contract_working_days) {
    const base = d.base_amount ?? inv.amount;
    // On "approved hours" billing only the days that were logged and approved are billed, so those are the days printed
    const days = d.billing_basis === 'approved_hours' && Number(d.payable_days) > 0 ? Number(d.payable_days) : d.contract_working_days;
    const calc = `Base: ${money(d.rate, cur)} x ${days} / ${d.working_days} working days`;
    return [{ key: 'main', description: 'Manpower Services', details: [...head, `(${period})`, `Price Per Month ${money(d.rate, cur)}`, calc, ...converted], qty: String(days), unit: 'days', rate: num2(D(base).dividedBy(days)), amount: num2(base) }, ...overtime];
  }
  const kind = d.billing_type === 'one_time' ? 'Fixed-bid project services' : 'Services';
  const base = d.base_amount ?? inv.amount;
  const note = d.billing_type === 'one_time' && d.fixed_bid ? [`Contract value ${money(d.rate, cur)}; invoiced before ${money(d.fixed_bid.invoiced_before, cur)}`] : [];
  return [{ key: 'main', description: kind, details: [...head, `(${period})`, ...note, ...converted], qty: '1', unit: '', rate: num2(base), amount: num2(base) }, ...overtime];
}

/**
 * The GST split of a client invoice's contract charges, or null when the invoice carries no GST (then it prints as a plain invoice).
 * A single "GST 18%" charge is split IGST or CGST + SGST by place of supply (the seller's state against the buyer's GSTIN state); charges
 * already named IGST / CGST / SGST are printed as they are.
 */
function gstSplit(sourceCharges, taxable, sellerState, buyerState) {
  const gstCharges = sourceCharges.filter((c) => GST_LABEL.test(c.label) && c.effect !== 'deduct' && D(c.amount).gt(0));
  if (!gstCharges.length || !D(taxable).gt(0)) return null;
  const total = gstCharges.reduce((a, c) => a.plus(D(c.amount)), D(0));
  if (gstCharges.every((c) => SPLIT_LABEL.test(c.label))) {
    const parts = gstCharges.map((c) => ({ label: SPLIT_LABEL.exec(c.label)[1].toUpperCase(), amount: D(c.amount).toFixed(2) }));
    const rate = D(total).dividedBy(taxable).times(100).dividedBy(parts.length === 2 ? 2 : 1).toDecimalPlaces(2, 4).toNumber();
    return { charges: gstCharges, parts, total, rate, gst_rate: rate * (parts.length === 2 ? 2 : 1) };
  }
  const gstRate = gstCharges.every((c) => c.mode === 'percent') ? gstCharges.reduce((a, c) => a + Number(c.value), 0) : D(total).dividedBy(taxable).times(100).toDecimalPlaces(2, 4).toNumber();
  const intra = Boolean(sellerState && buyerState && sellerState === buyerState);
  if (intra) {
    const half = D(total).dividedBy(2).toDecimalPlaces(2, 4);
    return { charges: gstCharges, parts: [{ label: 'CGST', amount: half.toFixed(2) }, { label: 'SGST', amount: D(total).minus(half).toFixed(2) }], total, rate: gstRate / 2, gst_rate: gstRate };
  }
  return { charges: gstCharges, parts: [{ label: 'IGST', amount: D(total).toFixed(2) }], total, rate: gstRate, gst_rate: gstRate };
}

async function clientInvoiceModel(orgId, inv) {
  const cur = inv.currency;
  const { party, bankLines } = await companyParty(orgId, cur);
  const account = inv.client_account?.client_account_id
    ? await prisma.account.findUnique({ where: { id: inv.client_account?.client_account_id } })
    : await prisma.account.findUnique({ where: { id: inv.client_account_id } });
  const buyer = accountParty(account, inv.line_items?.bill_to);
  // charges the contract adds (or deducts) are rows under the items, so the total is the amount the client pays
  const sourceCharges = inv.line_items?.consolidated ? (inv.line_items.items || []).flatMap((it) => it.details?.charges || []) : (inv.details?.charges || []);
  // the invoice is a GST tax invoice when its contract carries a GST charge
  const probe = clientLines(inv, { tax: true });
  const taxable = probe.reduce((a, l) => a.plus(D(l.amount)), D(0));
  const split = cur === 'INR' ? gstSplit(sourceCharges, taxable, party.state_code, buyer.state_code) : null;
  // the text an admin added under an entry (Edit invoice > Description for each entry); printed below that entry's details
  const notes = inv.line_items?.line_notes || {};
  const hsn = String(inv.project?.hsn_sac || inv.client_account?.hsn_sac || account?.hsn_sac || DEFAULT_SAC);
  const lines = (split ? probe : clientLines(inv)).map((l) => {
    const noted = notes[l.key] ? { ...l, note: String(notes[l.key]) } : l;
    return split ? { ...noted, hsn, gst_rate: split.gst_rate } : noted;
  });
  const chargeRows = new Map();
  for (const c of sourceCharges) {
    if (split && split.charges.includes(c)) continue; // the GST is printed as its own IGST / CGST / SGST rows
    const label = c.mode === 'percent' ? `${c.label} @ ${c.value}%` : c.label;
    chargeRows.set(label, (chargeRows.get(label) || D(0)).plus(D(c.amount)));
  }
  const charges = [...chargeRows].map(([label, amount]) => ({ label, amount: num2(amount) }));
  const subtotal = lines.reduce((a, l) => a.plus(D(l.amount)), D(0));
  const total = D(inv.total_amount ?? inv.amount);
  // if the rows above and the charges do not add up to the invoice amount (a manual override), say so instead of hiding the gap
  const gstTotal = split ? split.total : D(0);
  const gap = total.minus(subtotal).minus(gstTotal).minus(charges.reduce((a, c) => a.plus(D(c.amount)), D(0)));
  if (gap.abs().gt(0.005)) charges.push({ label: 'Adjustment', amount: gap.toFixed(2) });
  if (!split) {
    return {
      ...common(party, bankLines),
      title: 'Invoice',
      currency: cur,
      seller: party,
      buyer,
      meta: { number: inv.invoice_number, date: dateText(inv.invoice_date) },
      lines,
      taxes: charges,
      subtotal: subtotal.toFixed(2),
      total: total.toFixed(2),
      notes: inv.notes,
      remarks: inv.status ? `Status: ${inv.status}${inv.payment_status === 'partly_paid' ? ` (paid ${money(inv.paid_amount, cur)}, pending ${money(inv.pending_amount, cur)})` : ''}` : null,
      cancelled: false,
    };
  }
  // GST tax invoice: the total is rounded to the rupee, the difference printed as "Less : Round Off"
  const exact = subtotal.plus(gstTotal).plus(charges.reduce((a, c) => a.plus(D(c.amount)), D(0)));
  const printed = exact.toDecimalPlaces(0, 4);
  const placeOfSupply = buyer.state_name || null;
  return {
    ...common(party, bankLines),
    showHsn: true,
    showTax: true,
    title: 'Tax Invoice',
    currency: cur,
    seller: party,
    buyer,
    place_of_supply: placeOfSupply,
    meta: { number: inv.invoice_number, date: dateText(inv.invoice_date) },
    lines,
    taxes: [...split.parts, ...charges],
    round_off: printed.minus(exact).toFixed(2),
    subtotal: subtotal.toFixed(2),
    total: printed.toFixed(2),
    tax_summary: [{ rate: split.rate, taxable: subtotal.toFixed(2), parts: split.parts }],
    remarks: null,
    notes: inv.notes,
    cancelled: false,
  };
}

async function clientInvoicePdf(orgId, inv) {
  return taxInvoicePdf(await clientInvoiceModel(orgId, inv));
}

/** Several client invoices in one PDF, in the order given. */
async function clientInvoicesPdf(orgId, invs) {
  const models = [];
  for (const inv of invs) models.push(await clientInvoiceModel(orgId, inv));
  return taxInvoicePdf(models);
}

// ---- vendor invoice ----
function contractorLine(c, project, currency, period, inr) {
  const parts = [`${money(c.monthly_vendor_rate, currency)}/month x ${c.allocation_percent}% allocation`];
  if (c.payout_basis === 'approved_hours' && c.payable_days !== null && c.payable_days !== undefined) parts.push(`x ${c.payable_days} approved days (of ${c.contract_working_days ?? c.working_days}) / ${c.working_days} working days`);
  else if (c.contract_working_days !== null && c.contract_working_days !== undefined) parts.push(`x ${c.contract_working_days} / ${c.working_days} working days`);
  if (c.overtime_amount) parts.push(`+ overtime ${c.overtime_hours}h ${money(c.overtime_amount, currency)}`);
  const title = `${project?.name || 'Project'}${project?.code ? ` (${project.code})` : ''}${project?.client_name ? ` - ${project.client_name}` : ''}`;
  const extra = [...(c.approved_hours !== undefined && c.approved_hours !== null ? [`Approved hours: ${c.approved_hours}`] : []), ...(inr ? [inr] : [])];
  const face = String(project?.face_resource || '').trim();
  return { description: c.contractor, details: [title, ...(face ? [`Resource: ${face}`] : []), `(${period})`, parts.join(' '), ...extra], qty: '1', unit: '', rate: num2(c.amount), amount: num2(c.amount) };
}

/** One invoice per currency for a vendor's month (the rows are one per project and currency). */
async function vendorInvoiceModels(orgId, rows) {
  const first = rows[0];
  const vendor = await prisma.account.findUnique({ where: { id: first.vendor_account_id } });
  const currencies = [...new Set(rows.map((r) => r.currency))];
  const models = [];
  for (const cur of currencies) {
    const mine = rows.filter((r) => r.currency === cur);
    const { party: buyer } = await companyParty(orgId, cur);
    const period = `${MONTHS[first.period_month - 1]} ${first.period_year}`;
    const lines = mine.flatMap((r) => [
      ...((r.details?.contractors || []).length
        ? r.details.contractors.map((c, i, all) => contractorLine(c, r.project, cur, period, i === all.length - 1 && cur !== 'INR' && r.details.amount_inr !== null && r.details.amount_inr !== undefined ? `Project total approx. ${money(r.details.amount_inr, 'INR')} @ INR ${r.details.exchange_rate}` : null))
        : [{ description: r.project?.name || 'Services', details: [`(${period})`], qty: '1', unit: '', rate: num2(r.amount), amount: num2(r.amount) }]),
      // Vendor + / - adjustments tied to this project (Live Analytics > Vendors), each as its own line.
      ...(r.details?.adjustments || []).map((a) => ({ description: `Adjustment - ${a.reason}`, details: [r.project?.name || 'Project'], qty: '1', unit: '', rate: num2(a.amount), amount: num2(a.amount) })),
    ]);
    const subtotal = mine.reduce((a, r) => a.plus(D(r.amount)), D(0));
    // TDS withheld and the finance adjustment are tracked per row; they print only when set, and the total is the net payable
    const tds = mine.reduce((a, r) => a.plus(D(r.tds_amount || 0)), D(0));
    const adjustment = mine.reduce((a, r) => a.plus(D(r.adjustment_amount || 0)), D(0));
    const adjustmentNote = mine.map((r) => r.adjustment_note).find(Boolean);
    const total = subtotal.minus(tds).plus(adjustment);
    const seller = accountParty(vendor, first.details?.bill_to);
    models.push({
      ...common(seller, []),
      title: 'Invoice',
      currency: cur,
      seller,
      buyer,
      meta: { number: first.invoice_number, date: dateText(first.invoice_date) },
      lines,
      taxes: [{ label: 'TDS', amount: tds.negated().toFixed(2) }, { label: adjustmentNote ? `Adjustment (${adjustmentNote})` : 'Adjustment', amount: adjustment.toFixed(2) }],
      subtotal: subtotal.toFixed(2),
      total: total.toFixed(2),
      notes: first.notes,
      cancelled: false,
      jurisdiction: null,
    });
  }
  return models;
}

async function vendorInvoicePdf(orgId, rows) {
  return taxInvoicePdf(await vendorInvoiceModels(orgId, rows));
}

/** Several vendor invoices (each a list of rows sharing one vendor, month and number) in one PDF. */
async function vendorInvoicesPdf(orgId, rowGroups) {
  const models = [];
  for (const rows of rowGroups) models.push(...(await vendorInvoiceModels(orgId, rows)));
  return taxInvoicePdf(models);
}

/** The entries an invoice prints, with the key each one's description is saved under: [{ key, title }]. */
const invoiceRows = (inv) => clientLines(inv).map((l) => ({ key: l.key, title: [l.description, (l.details || [])[0]].filter(Boolean).join(' - ') }));

module.exports = { invoiceRows, clientInvoicePdf, clientInvoicesPdf, vendorInvoicePdf, vendorInvoicesPdf, clientInvoiceModel, vendorInvoiceModels };
