const prisma = require('../../config/db');
const { taxInvoicePdf, dateText } = require('../../lib/taxInvoicePdf');
const { stateName } = require('../../lib/gstStates');
const { D } = require('../cashPosition/cash.calc');

// Client invoices (what a company bills its clients) and vendor invoices (what a vendor bills the company) printed in the same
// tax-invoice layout as the GST / USD invoices. The billing engine does not work out GST, so these show the amounts as they are
// calculated: no HSN / GST columns and no tax summary.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const money = (n, currency) => `${currency} ${Number(n || 0).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num2 = (n) => D(n).toDecimalPlaces(2, 4).toFixed(2);
const periodText = (d, m, y) => (d?.period_from ? `${dateText(d.period_from)} to ${dateText(d.period_to)}` : `${MONTHS[m - 1]} ${y}`);

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
  };
  return { party, bankLines: String(bank?.payment_instructions || '').split('\n').map((t) => t.trim()).filter(Boolean) };
}

/** A client or vendor account as the other party: name, GSTIN / tax id and the address we hold. */
function accountParty(account) {
  const place = [account?.location_city, account?.location_country].filter(Boolean).join(', ');
  const gst = account?.gst_or_tax_id || null;
  const code = gst && /^\d{2}/.test(gst) ? gst.slice(0, 2) : null;
  return { name: account?.name || '', address: account?.location || place || null, gstin: gst, state_code: code, state_name: stateName(code) };
}

const common = (party, bankLines) => ({
  showHsn: false,
  showTax: false,
  tax_summary: null,
  bank: { holder: party.name, lines: bankLines },
  jurisdiction: party.state_name ? `SUBJECT TO ${party.state_name.toUpperCase()} JURISDICTION` : null,
});

// ---- client invoice ----
function clientLines(inv) {
  const d = inv.details || {};
  const cur = inv.currency;
  const period = periodText(d, inv.period_month, inv.period_year);
  const project = inv.project || {};
  const title = `${project.name || 'Project'}${project.code ? ` (${project.code})` : ''}${project.client_name ? ` - ${project.client_name}` : ''}`;
  const resources = inv.line_items?.lines || [];
  const converted = d.conversion ? [`Converted from ${money(d.conversion.from_amount, d.conversion.from_currency)} @ ${d.conversion.exchange_rate}`] : [];
  const overtime = d.overtime_billed && D(d.overtime_amount || 0).gt(0)
    ? [{ description: 'Overtime', details: [`${d.overtime_hours}h at ${d.overtime_multiplier}x`], qty: String(d.overtime_hours || 1), unit: d.overtime_hours ? 'hrs' : '', rate: d.overtime_hours ? num2(D(d.overtime_amount).dividedBy(d.overtime_hours)) : num2(d.overtime_amount), amount: num2(d.overtime_amount) }]
    : [];
  if (d.billing_type === 'hourly' && resources.length) {
    return resources.map((l) => ({
      description: l.resource,
      details: [title, period, `Rate ${money(d.rate, cur)} / hour`, ...(l.overtime_hours ? [`Includes ${l.overtime_hours} overtime hrs`] : []), ...converted],
      qty: String(l.hours || 0), unit: 'hrs', rate: Number(l.hours) ? num2(D(l.revenue).dividedBy(l.hours)) : num2(l.revenue), amount: num2(l.revenue),
    }));
  }
  if (d.billing_type === 'monthly' && d.contract_working_days) {
    const base = d.base_amount ?? inv.amount;
    const calc = `Base: ${money(d.rate, cur)} x ${d.contract_working_days} / ${d.working_days} working days${d.calendar ? ` (${d.calendar})` : ''}`;
    return [{ description: 'Manpower Services', details: [title, `(${period})`, `Price Per Month ${money(d.rate, cur)}`, calc, ...converted], qty: String(d.contract_working_days), unit: 'days', rate: num2(D(base).dividedBy(d.contract_working_days)), amount: num2(base) }, ...overtime];
  }
  const kind = d.billing_type === 'one_time' ? 'Fixed-bid project services' : 'Services';
  const base = d.base_amount ?? inv.amount;
  const note = d.billing_type === 'one_time' && d.fixed_bid ? [`Contract value ${money(d.rate, cur)}; invoiced before ${money(d.fixed_bid.invoiced_before, cur)}`] : [];
  return [{ description: kind, details: [title, `(${period})`, ...note, ...converted], qty: '1', unit: '', rate: num2(base), amount: num2(base) }, ...overtime];
}

async function clientInvoiceModel(orgId, inv) {
  const cur = inv.currency;
  const { party, bankLines } = await companyParty(orgId, cur);
  const account = inv.client_account?.client_account_id
    ? await prisma.account.findUnique({ where: { id: inv.client_account.client_account_id } })
    : await prisma.account.findUnique({ where: { id: inv.client_account_id } });
  const lines = clientLines(inv);
  // charges the contract adds (or deducts) are rows under the items, so the total is the amount the client pays
  const charges = (inv.details?.charges || []).map((c) => ({ label: c.mode === 'percent' ? `${c.label} @ ${c.value}%` : c.label, amount: num2(c.amount) }));
  const subtotal = lines.reduce((a, l) => a.plus(D(l.amount)), D(0));
  const total = D(inv.total_amount ?? inv.amount);
  // if the rows above and the charges do not add up to the invoice amount (a manual override), say so instead of hiding the gap
  const gap = total.minus(subtotal).minus(charges.reduce((a, c) => a.plus(D(c.amount)), D(0)));
  if (gap.abs().gt(0.005)) charges.push({ label: 'Adjustment', amount: gap.toFixed(2) });
  return {
    ...common(party, bankLines),
    title: 'Invoice',
    currency: cur,
    seller: party,
    buyer: accountParty(account),
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

async function clientInvoicePdf(orgId, inv) {
  return taxInvoicePdf(await clientInvoiceModel(orgId, inv));
}

// ---- vendor invoice ----
function contractorLine(c, project, currency, period, inr) {
  const parts = [`${money(c.monthly_vendor_rate, currency)}/month x ${c.allocation_percent}% allocation`];
  if (c.payout_basis === 'approved_hours' && c.payable_days !== null && c.payable_days !== undefined) parts.push(`x ${c.payable_days} approved days (of ${c.contract_working_days ?? c.working_days}) / ${c.working_days} working days`);
  else if (c.contract_working_days !== null && c.contract_working_days !== undefined) parts.push(`x ${c.contract_working_days} / ${c.working_days} working days`);
  if (c.overtime_amount) parts.push(`+ overtime ${c.overtime_hours}h ${money(c.overtime_amount, currency)}`);
  const title = `${project?.name || 'Project'}${project?.code ? ` (${project.code})` : ''}${project?.client_name ? ` - ${project.client_name}` : ''}`;
  const extra = [...(c.approved_hours !== undefined && c.approved_hours !== null ? [`Approved hours: ${c.approved_hours}`] : []), ...(inr ? [inr] : [])];
  return { description: c.contractor, details: [title, `(${period})`, parts.join(' '), ...extra], qty: '1', unit: '', rate: num2(c.amount), amount: num2(c.amount) };
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
    const lines = mine.flatMap((r) => ((r.details?.contractors || []).length
      ? r.details.contractors.map((c, i, all) => contractorLine(c, r.project, cur, period, i === all.length - 1 && cur !== 'INR' && r.details.amount_inr !== null && r.details.amount_inr !== undefined ? `Project total approx. ${money(r.details.amount_inr, 'INR')} @ INR ${r.details.exchange_rate}` : null))
      : [{ description: r.project?.name || 'Services', details: [`(${period})`], qty: '1', unit: '', rate: num2(r.amount), amount: num2(r.amount) }]));
    const subtotal = mine.reduce((a, r) => a.plus(D(r.amount)), D(0));
    // TDS withheld and the finance adjustment are tracked per row; they print only when set, and the total is the net payable
    const tds = mine.reduce((a, r) => a.plus(D(r.tds_amount || 0)), D(0));
    const adjustment = mine.reduce((a, r) => a.plus(D(r.adjustment_amount || 0)), D(0));
    const adjustmentNote = mine.map((r) => r.adjustment_note).find(Boolean);
    const total = subtotal.minus(tds).plus(adjustment);
    const seller = accountParty(vendor);
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

module.exports = { clientInvoicePdf, vendorInvoicePdf, clientInvoiceModel, vendorInvoiceModels };
