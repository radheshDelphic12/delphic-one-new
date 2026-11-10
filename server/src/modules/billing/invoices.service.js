// Invoices — ONE builder for every way an invoice is made (Live Analytics →
// Billing & Sales / Vendors, and the older POST /billing/invoices), so a
// project's invoice can't come out with another project's name or currency.
//
// Client invoice (one per project and month, ClientInvoice):
//   the project's Billing & Sales month — its LOCKED version when billing is
//   locked, else computed live — from the project's contract:
//     monthly: rate × contract working days / working days (the agreement
//              dates cut a partial month), never scaled by timesheet hours;
//     hourly:  approved billable hours × rate;
//     overtime only where the project bills it.
//   Fixed-bid project (service category "project"): the billing rate is the TOTAL
//   contract value. Any number of invoices may be raised, each for an amount the
//   user enters, as long as the project's invoices never add up to more than the
//   contract value. The month's invoices are its Billing & Sales amount, and
//   locking that month (the existing lock) is what makes them financially effective.
//   Currency is the project's billing-rate currency; the project and client
//   shown are the project's own (project_name, linked client), never the
//   account row's `name` (often the client it was created from).
// Vendor invoice (per vendor and month, one ProjectVendorInvoice row per
//   project and currency): the vendor's contractors on each project from the
//   vendor-payment engine (locked vendor record when locked), with the
//   calculation kept in `details`.
// Invoice numbers are the company's own: editable, unique per org; a
// suggestion (INV-2026-001 / VINV-2026-001) is offered, never forced.

const { Prisma } = require('@prisma/client');
const prisma = require('../../config/db');
const billingEngine = require('../calculations/engines/billing.engine');
const vendorEngine = require('../calculations/engines/vendorPayment.engine');
const exchangeRates = require('./exchangeRates.service');
const invoicePayments = require('./invoicePayments.service');
const paymentsService = require('../payments/payments.service');
const chargesService = require('./charges.service');
const vendorCharges = require('./vendorCharges.service');
const { findVendorAccount } = require('../../lib/workerType');
const { round2, ymd } = require('../calculations/period');
const financialLock = require('../calculations/financialLock');
const fixedBid = require('./fixedBid.service');

// Lazy: calculations.service loads the engines, which load billing.service.
const calculations = () => require('../calculations/calculations.service');

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

// Next free "<prefix>-<year>-NNN" among the given invoice numbers.
function nextNumber(prefix, year, numbers) {
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const max = numbers.reduce((m, n) => {
    const hit = re.exec(n || '');
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `${prefix}-${year}-${String(max + 1).padStart(3, '0')}`;
}

async function suggestClientNumber(orgId, year) {
  const rows = await prisma.clientInvoice.findMany({ where: { org_id: orgId, invoice_number: { startsWith: `INV-${year}-` } }, select: { invoice_number: true } });
  return nextNumber('INV', year, rows.map((r) => r.invoice_number));
}

async function suggestVendorNumber(orgId, year) {
  const rows = await prisma.projectVendorInvoice.findMany({ where: { org_id: orgId, invoice_number: { startsWith: `VINV-${year}-` } }, select: { invoice_number: true }, distinct: ['invoice_number'] });
  return nextNumber('VINV', year, rows.map((r) => r.invoice_number));
}

// --- Client invoices -------------------------------------------------------

// Re-expresses a month's calculation in another currency through the org's
// INR rates (finance exchange rates): factor = INR/source / INR/target.
// The project's own figures are kept in details.conversion. A currency with no
// rate set can't be converted - the caller is told which one.
async function convertToCurrency(orgId, details, lines, target) {
  if (!target || target === details.currency) return { details, lines };
  const fx = await exchangeRates.inrRates(orgId);
  const missing = [details.currency, target].find((c) => !fx.has(c));
  if (missing) return { error: 'exchange_rate_missing', currency: missing };
  const factor = fx.get(details.currency) / fx.get(target);
  const conv = (n) => (n === null || n === undefined ? n : round2(n * factor));
  const converted = {
    ...details,
    currency: target,
    rate: conv(details.rate),
    base_amount: conv(details.base_amount),
    overtime_amount: conv(details.overtime_amount),
    adjustment_amount: conv(details.adjustment_amount),
    adjustments: (details.adjustments || []).map((a) => ({ ...a, amount: conv(a.amount) })),
    amount: conv(details.amount),
    conversion: { from_currency: details.currency, from_rate: details.rate, from_amount: details.amount, exchange_rate: Math.round(factor * 1e6) / 1e6, inr_per_unit: { [details.currency]: fx.get(details.currency), [target]: fx.get(target) } },
  };
  const convertedLines = lines.map((l) => ({ ...l, base_amount: conv(l.base_amount), overtime_amount: conv(l.overtime_amount), revenue: conv(l.revenue) }));
  return { details: converted, lines: convertedLines };
}

// The project month an invoice is built from, with how its amount was worked out.
// `currency` (optional) invoices in a currency other than the project's rate currency.
async function clientInvoiceSource(orgId, accountId, period, currency, { amount, replacing = 0 } = {}) {
  const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: 'client' }, select: billingEngine.PROJECT_SELECT });
  if (!account) return { error: 'account_not_found' };
  // Nothing is invoiced outside the agreement dates.
  const monthStart = new Date(Date.UTC(period.period_year, period.period_month - 1, 1));
  const monthEnd = new Date(Date.UTC(period.period_year, period.period_month, 0));
  if (account.agreement_start_date && account.agreement_start_date > monthEnd) return { error: 'before_agreement_start', agreement_start: ymd(account.agreement_start_date) };
  if (account.agreement_end_date && account.agreement_end_date < monthStart) return { error: 'after_agreement_end', agreement_end: ymd(account.agreement_end_date) };
  if (fixedBid.isFixedBid(account)) return fixedBidSource(orgId, account, period, { amount, replacing, currency });
  const calc = await calculations().findCalc(orgId, 'billing', accountId, period);
  const frozen = calc && calculations().FROZEN_STATUSES.includes(calc.status);
  if (frozen && calc.status === 'change_detected') return { error: 'change_detected' };
  const version = frozen ? await calculations().latestVersion(calc) : null;
  const raw = version ? version.snapshot : await billingEngine.computeProjectMonth(orgId, account, period);
  if (!raw.supported) return { error: 'not_supported', note: raw.note };
  if (!raw.billing_type) return { error: 'no_billing_rate' };
  const view = billingEngine.viewOf(raw, { include_overtime: raw.overtime.enabled });
  const baseLines = view.resources.map((r) => ({
    org_membership_id: r.org_membership_id,
    resource: r.name,
    hours: r.regular_hours,
    overtime_hours: r.overtime_hours,
    base_amount: r.base_amount,
    overtime_amount: r.overtime_amount,
    revenue: r.amount,
  }));
  const converted = await convertToCurrency(orgId, billingEngine.invoiceDetails(raw), baseLines, currency);
  if (converted.error) return converted;
  const { lines } = converted;
  // The contract's charges (GST, TDS, ...) go on top of the final approved amount (subtotal);
  // fixed ones are in the contract currency, so they follow the conversion factor.
  const contractCharges = await prisma.contractCharge.findMany({ where: { org_id: orgId, account_id: accountId }, orderBy: { created_at: 'asc' } });
  const worked = chargesService.applyCharges(converted.details.amount, contractCharges, converted.details.conversion ? converted.details.conversion.exchange_rate : 1);
  const details = { ...converted.details, subtotal: converted.details.amount, charges: worked.lines, total_amount: worked.total };
  return {
    account,
    // Identity as the project is NOW (its own name and linked client).
    project: billingEngine.describeProject(account),
    details,
    lines,
    version,
    source: version ? 'locked' : 'live',
  };
}

// Fixed bid: one invoice for `amount` (default: everything still uninvoiced) against the
// contract value. `replacing` is the amount of an invoice being edited (it frees its own share).
async function fixedBidSource(orgId, account, period, { amount, replacing = 0, currency }) {
  if (await fixedBid.monthLocked(orgId, account.id, period)) return { error: 'billing_locked' };
  const summary = await fixedBid.summaryFor(orgId, account.id);
  if (!summary || !(summary.total > 0)) return { error: 'no_billing_rate' };
  if (currency && currency !== summary.currency) return { error: 'fixed_bid_currency', currency: summary.currency };
  const available = round2(summary.remaining_to_invoice + replacing);
  const asked = amount !== undefined && amount !== null;
  const value = asked ? round2(Number(amount)) : Math.max(available, 0);
  if (asked && !(value > 0)) return { error: 'nothing_to_invoice' };
  if (value > available) return { error: 'fixed_bid_exceeds_balance', remaining: available, total: summary.total, currency: summary.currency };
  const contractCharges = await prisma.contractCharge.findMany({ where: { org_id: orgId, account_id: account.id }, orderBy: { created_at: 'asc' } });
  const worked = chargesService.applyCharges(value, contractCharges, 1);
  const details = {
    billing_type: 'one_time',
    rate: summary.total,
    currency: summary.currency,
    base_amount: value,
    overtime_amount: 0,
    adjustment_amount: 0,
    adjustments: [],
    amount: value,
    fixed_bid: { total: summary.total, invoiced_before: round2(summary.invoiced - replacing), remaining_after: round2(available - value) },
    subtotal: value,
    charges: worked.lines,
    total_amount: worked.total,
  };
  return {
    account,
    project: billingEngine.describeProject(account),
    details,
    lines: [{ resource: 'Fixed-bid project invoice', hours: 0, overtime_hours: 0, base_amount: value, overtime_amount: 0, revenue: value }],
    version: null,
    source: 'live',
    fixed_bid: true,
    summary,
  };
}

// The customer on a project invoice is the project's client account (else the account itself); a vendor invoice's is the vendor account.
async function customerAccount(orgId, projectAccountId) {
  const project = await prisma.account.findFirst({ where: { id: projectAccountId, org_id: orgId }, select: { id: true, client_account_id: true } });
  if (!project) return null;
  return prisma.account.findFirst({ where: { id: project.client_account_id || project.id, org_id: orgId }, select: { id: true, name: true, gst_or_tax_id: true, billing_address: true, location: true } });
}

function billToDefaults(account) {
  return { name: account?.name || '', gstin: account?.gst_or_tax_id || '', address: account?.billing_address || account?.location || '', account_id: account?.id || null };
}

// What the invoice prints for the other party. With `save` the account itself is updated (GST number + billing address), audited.
async function resolveBillTo(orgId, user, accountId, billTo, save) {
  if (!billTo) return undefined;
  const clean = { gstin: (billTo.gstin || '').trim().toUpperCase() || null, address: (billTo.address || '').trim() || null };
  if (save && accountId && (clean.gstin || clean.address)) {
    const before = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId }, select: { gst_or_tax_id: true, billing_address: true } });
    if (before) {
      const data = {};
      if (clean.gstin && clean.gstin !== before.gst_or_tax_id) data.gst_or_tax_id = clean.gstin;
      if (clean.address && clean.address !== before.billing_address) data.billing_address = clean.address;
      if (Object.keys(data).length) {
        await prisma.account.update({ where: { id: accountId }, data });
        await prisma.auditLog.create({ data: { org_id: orgId, actor_id: user.id, action: 'account_billing_details_update', entity_type: 'account', entity_id: accountId, reason: 'Billing details updated from an invoice', snapshot: { before, after: data } } });
      }
    }
  }
  return clean;
}

// A single invoice that bills several contracts of one customer: it is stored on the first contract's row with every contract's
// calculation under line_items.items, so older readers still see one invoice with one total.
async function consolidatedCovering(orgId, accountId, period) {
  const rows = await prisma.clientInvoice.findMany({ where: { org_id: orgId, deleted_at: null, ...period }, select: { id: true, client_account_id: true, invoice_number: true, line_items: true } });
  return rows.find((r) => r.line_items && r.line_items.consolidated && (r.client_account_id === accountId || (r.line_items.items || []).some((i) => i.account_id === accountId))) || null;
}

async function generateConsolidatedInvoice(orgId, user, { account_ids, period_month, period_year, invoice_number, invoice_date, notes, currency, bill_to, save_to_account }) {
  const ids = [...new Set(account_ids || [])];
  if (ids.length < 2) return { error: 'consolidated_min' };
  const period = { period_month, period_year };
  const frozen = await financialLock.assertOpen(orgId, period_month, period_year);
  if (frozen) return frozen;
  const customers = await Promise.all(ids.map((id) => customerAccount(orgId, id)));
  if (customers.some((c) => !c)) return { error: 'account_not_found' };
  if (new Set(customers.map((c) => c.id)).size > 1) return { error: 'consolidated_customer' };
  const customer = customers[0];
  for (const id of ids) {
    const covering = await consolidatedCovering(orgId, id, period);
    const own = await prisma.clientInvoice.findFirst({ where: { org_id: orgId, deleted_at: null, client_account_id: id, ...period }, select: { invoice_number: true } });
    const hit = covering || own;
    if (hit) return { error: 'consolidated_already_invoiced', number: hit.invoice_number };
  }
  const sources = [];
  for (const id of ids) {
    const src = await clientInvoiceSource(orgId, id, period, currency);
    if (src.error) return src;
    if (src.fixed_bid) return { error: 'consolidated_fixed_bid' };
    if (!(src.details.amount > 0)) return { error: 'nothing_to_invoice' };
    sources.push({ id, src });
  }
  const currencies = new Set(sources.map((x) => x.src.details.currency));
  if (currencies.size > 1) return { error: 'consolidated_currency' };
  const cur = [...currencies][0];
  const items = sources.map(({ id, src }) => ({ account_id: id, project: src.project, details: src.details, lines: src.lines, source: src.source, calculation_version: src.version?.version || null }));
  const total = round2(items.reduce((a, i) => a + Number(i.details.total_amount ?? i.details.amount), 0));
  const number = (invoice_number || '').trim() || (await suggestClientNumber(orgId, period_year));
  const clash = await prisma.clientInvoice.findFirst({ where: { org_id: orgId, invoice_number: number }, select: { id: true } });
  if (clash) return { error: 'invoice_number_taken' };
  const printedBillTo = await resolveBillTo(orgId, user, customer.id, bill_to, save_to_account);
  const details = { billing_type: 'consolidated', currency: cur, amount: total, subtotal: total, total_amount: total, charges: [], contracts: items.length };
  const invoice = await prisma.clientInvoice.create({
    data: {
      org_id: orgId,
      client_account_id: ids[0],
      ...period,
      amount: total,
      currency: cur,
      invoice_number: number,
      invoice_date: new Date(invoice_date || todayYmd()),
      notes: notes || null,
      line_items: {
        consolidated: true,
        project: { name: `${items.length} contracts - ${customer.name}`, code: null, client_name: customer.name },
        details,
        source: 'live',
        items,
        lines: [],
        ...(printedBillTo ? { bill_to: printedBillTo } : {}),
      },
      created_by: user.id,
    },
  });
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: user.id, action: 'client_invoice_generate', entity_type: 'client_invoice', entity_id: invoice.id, reason: `Combined invoice ${number} for ${customer.name}: ${items.map((i) => i.project.name).join(', ')} ${period_month}/${period_year}`, snapshot: { amount: total, currency: cur, account_ids: ids } },
  });
  return { invoice: serializeClientInvoice({ ...invoice, client_account: sources[0].src.account }) };
}

async function previewClientInvoice(orgId, accountId, period, currency, amount) {
  const src = await clientInvoiceSource(orgId, accountId, period, currency, { amount });
  if (src.error) return src;
  const [existing, suggested, customer] = await Promise.all([
    prisma.clientInvoice.findFirst({ where: { client_account_id: accountId, org_id: orgId, ...period }, orderBy: { created_at: 'desc' }, select: { id: true, invoice_number: true, status: true, invoice_date: true, line_items: true } }),
    suggestClientNumber(orgId, period.period_year),
    customerAccount(orgId, accountId),
  ]);
  const saved = existing?.line_items && !Array.isArray(existing.line_items) ? existing.line_items.bill_to : null;
  return {
    preview: {
      bill_to: { ...billToDefaults(customer), ...(saved ? { gstin: saved.gstin || '', address: saved.address || '' } : {}) },
      project: src.project,
      ...period,
      details: src.details,
      lines: src.lines,
      amount: src.details.amount,
      total_amount: src.details.total_amount,
      charges: src.details.charges,
      currency: src.details.currency,
      source: src.source,
      calculation_version: src.version?.version || null,
      fixed_bid: src.fixed_bid ? src.summary : null,
      // A fixed-bid project always gets a NEW invoice; a monthly one refreshes its draft.
      existing: existing && !src.fixed_bid ? { id: existing.id, invoice_number: existing.invoice_number, status: existing.status, invoice_date: existing.invoice_date ? ymd(existing.invoice_date) : null } : null,
      suggested_number: (!src.fixed_bid && existing?.invoice_number) || suggested,
    },
  };
}

// Creates the project's invoice for the month, or refreshes it while it is
// still a draft. Sent / paid invoices are never rewritten.
async function generateClientInvoice(orgId, user, { account_id, period_month, period_year, invoice_number, invoice_date, notes, currency, amount, bill_to, save_to_account }) {
  const period = { period_month, period_year };
  const frozen = await financialLock.assertOpen(orgId, period_month, period_year);
  if (frozen) return frozen;
  const src = await clientInvoiceSource(orgId, account_id, period, currency, { amount });
  if (src.error) return src;
  if (!(src.details.amount > 0)) return { error: src.fixed_bid ? 'fixed_bid_exhausted' : 'nothing_to_invoice' };
  // Fixed bid: every call is a new invoice (the cap above keeps the total within the contract).
  const covering = await consolidatedCovering(orgId, account_id, period);
  if (covering) return { error: 'in_consolidated', number: covering.invoice_number };
  const existing = src.fixed_bid ? null : await prisma.clientInvoice.findFirst({ where: { org_id: orgId, client_account_id: account_id, ...period } });
  if (existing && existing.status !== 'draft') return { error: 'invoice_sent' };
  const number = (invoice_number || '').trim() || existing?.invoice_number || (await suggestClientNumber(orgId, period_year));
  const clash = await prisma.clientInvoice.findFirst({ where: { org_id: orgId, invoice_number: number, ...(existing ? { NOT: { id: existing.id } } : {}) }, select: { id: true } });
  if (clash) return { error: 'invoice_number_taken' };
  const customer = await customerAccount(orgId, account_id);
  const printedBillTo = (await resolveBillTo(orgId, user, customer?.id, bill_to, save_to_account))
    || (existing?.line_items && !Array.isArray(existing.line_items) ? existing.line_items.bill_to : undefined);
  const data = {
    amount: src.details.amount,
    currency: src.details.currency,
    invoice_number: number,
    invoice_date: new Date(invoice_date || existing?.invoice_date || todayYmd()),
    notes: notes === undefined ? existing?.notes ?? null : notes || null,
    line_items: {
      project: src.project,
      details: src.details,
      source: src.source,
      ...(printedBillTo ? { bill_to: printedBillTo } : {}),
      // the descriptions an admin added under the entries survive a refresh of the draft
      ...(existing?.line_items?.line_notes ? { line_notes: existing.line_items.line_notes } : {}),
      // Kept for invoices read by older screens.
      billing_type: src.details.billing_type,
      rate: src.details.rate,
      working_days: src.details.working_days,
      overtime_enabled: src.details.overtime_billed,
      calculation_version: src.version?.version || null,
      lines: src.lines,
    },
    calculation_version_id: src.version?.id || null,
  };
  const invoice = existing
    ? await prisma.clientInvoice.update({ where: { id: existing.id }, data })
    : await prisma.clientInvoice.create({ data: { ...data, org_id: orgId, client_account_id: account_id, ...period, created_by: user.id } });
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: user.id, action: existing ? 'client_invoice_refresh' : 'client_invoice_generate', entity_type: 'client_invoice', entity_id: invoice.id, reason: `Invoice ${number} for ${src.project.name} ${period_month}/${period_year}`, snapshot: { amount: src.details.amount, currency: src.details.currency, source: src.source } },
  });
  // From a locked month: the calculation's own history records it too.
  if (src.version) {
    await prisma.auditLog.create({
      data: { org_id: orgId, actor_id: user.id, action: 'calculation_invoice', entity_type: 'financial_calculation', entity_id: src.version.calculation_id, reason: `Invoice ${number} ${existing ? 'refreshed' : 'generated'} from version ${src.version.version}`, snapshot: { kind: 'billing', scope_key: account_id, ...period, invoice_id: invoice.id, amount: src.details.amount } },
    });
  }
  return { invoice: serializeClientInvoice({ ...invoice, client_account: src.account }) };
}

const CLIENT_INVOICE_ACCOUNT = { select: { id: true, name: true, project_name: true, project_code: true, face_resource: true, hsn_sac: true, client_name: true, client_account_id: true, service_category: true, client_account: { select: { id: true, name: true } } } };

// The project shown on an invoice: the one stored when it was generated, else
// (older invoices) the project as it is now — never the account's bare name.
function serializeClientInvoice(row) {
  const items = row.line_items && !Array.isArray(row.line_items) ? row.line_items : null;
  const project = items?.project?.name ? items.project : row.client_account ? billingEngine.describeProject(row.client_account) : null;
  return {
    ...row,
    amount: Number(row.amount),
    invoice_date: row.invoice_date ? ymd(row.invoice_date) : null,
    project,
    details: items?.details || null,
    // What the client pays: the final approved amount plus / minus the contract's charges.
    total_amount: items?.details?.total_amount !== undefined ? items.details.total_amount : Number(row.amount),
    // the entries printed on the invoice, so a description can be added under each
    print_rows: items && project ? require('./invoices.pdf').invoiceRows({ ...row, project, details: items.details || {}, line_items: items }) : [],
    line_notes: items?.line_notes || {},
  };
}

// Admin edit of a client invoice. Number, date and notes update in place; a
// different currency re-expresses the amount from the project's month (drafts
// only); `amount` overrides the calculated figure and is recorded in
// line_items.manual_override. A sent / paid invoice can still be corrected, but
// only with a `reason`, and every edit is audited with before / after.
async function updateClientInvoice(orgId, user, invoiceId, { invoice_number, invoice_date, notes, currency, amount, reason, bill_to, save_to_account, line_notes }) {
  const invoice = await prisma.clientInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!invoice) return { error: 'not_found' };
  const frozen = await financialLock.assertOpen(orgId, invoice.period_month, invoice.period_year);
  if (frozen) return frozen;
  const draft = invoice.status === 'draft';
  const why = (reason || '').trim();
  if (!draft && !why) return { error: 'reason_required' };
  // Fixed bid: a locked month's invoices are final, and an edit may not push the project past its contract value.
  const account = await prisma.account.findFirst({ where: { id: invoice.client_account_id }, select: { service_category: true } });
  if (fixedBid.isFixedBid(account)) {
    if (await fixedBid.monthLocked(orgId, invoice.client_account_id, { period_month: invoice.period_month, period_year: invoice.period_year })) return { error: 'billing_locked' };
    if (currency && currency !== invoice.currency) return { error: 'fixed_bid_currency', currency: invoice.currency };
    if (amount !== undefined) {
      const over = await fixedBid.checkWithinBalance(orgId, invoice.client_account_id, amount, Number(invoice.amount));
      if (over) return over;
    }
  }
  if (invoice.line_items?.consolidated && currency && currency !== invoice.currency) return { error: 'consolidated_currency_edit' };
  if (currency && currency !== invoice.currency) {
    if (!draft) return { error: 'invoice_sent' };
    const regenerated = await generateClientInvoice(orgId, user, {
      account_id: invoice.client_account_id,
      period_month: invoice.period_month,
      period_year: invoice.period_year,
      invoice_number: invoice_number || invoice.invoice_number,
      invoice_date: invoice_date || (invoice.invoice_date ? ymd(invoice.invoice_date) : undefined),
      notes,
      currency,
      bill_to,
      save_to_account,
    });
    if (regenerated.error || amount === undefined) return regenerated;
    return updateClientInvoice(orgId, user, invoiceId, { amount, reason: why });
  }
  const number = (invoice_number || '').trim();
  if (number && number !== invoice.invoice_number) {
    const clash = await prisma.clientInvoice.findFirst({ where: { org_id: orgId, invoice_number: number, NOT: { id: invoice.id } }, select: { id: true } });
    if (clash) return { error: 'invoice_number_taken' };
  }
  const data = {
    ...(number ? { invoice_number: number } : {}),
    ...(invoice_date ? { invoice_date: new Date(invoice_date) } : {}),
    ...(notes !== undefined ? { notes: notes || null } : {}),
  };
  const items = invoice.line_items && !Array.isArray(invoice.line_items) ? invoice.line_items : {};
  if (amount !== undefined && Number(amount) !== Number(invoice.amount)) {
    const original = items.manual_override?.original_amount ?? Number(invoice.amount);
    data.amount = amount;
    data.line_items = {
      ...items,
      details: chargesService.recomputeDetails(items.details || {}, amount),
      manual_override: { original_amount: original, amount, reason: why || null, by: user.id, at: new Date().toISOString() },
    };
  }
  if (bill_to) {
    const customer = await customerAccount(orgId, invoice.client_account_id);
    const printed = await resolveBillTo(orgId, user, customer?.id, bill_to, save_to_account);
    data.line_items = { ...(data.line_items || items), bill_to: printed };
  }
  if (line_notes !== undefined) {
    // the descriptions printed under each entry; an empty one removes it
    const cleaned = Object.fromEntries(Object.entries(line_notes).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v));
    data.line_items = { ...(data.line_items || items), line_notes: cleaned };
  }
  const updated = await prisma.clientInvoice.update({ where: { id: invoice.id }, data, include: { client_account: CLIENT_INVOICE_ACCOUNT } });
  await prisma.auditLog.create({
    data: {
      org_id: orgId,
      actor_id: user.id,
      action: 'client_invoice_edit',
      entity_type: 'client_invoice',
      entity_id: invoice.id,
      reason: why || `Invoice ${updated.invoice_number} edited`,
      snapshot: {
        status: invoice.status,
        before: { invoice_number: invoice.invoice_number, invoice_date: invoice.invoice_date, notes: invoice.notes, amount: Number(invoice.amount) },
        after: { invoice_number: updated.invoice_number, invoice_date: updated.invoice_date, notes: updated.notes, amount: Number(updated.amount) },
      },
    },
  });
  return { invoice: serializeClientInvoice(updated) };
}

// Admin delete of a client invoice, any status. A sent / paid invoice needs a
// `reason` (like editing one); the deletion is audited with what was removed.
async function deleteClientInvoice(orgId, user, invoiceId, { reason } = {}) {
  const invoice = await prisma.clientInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!invoice) return { error: 'not_found' };
  const frozen = await financialLock.assertOpen(orgId, invoice.period_month, invoice.period_year);
  if (frozen) return frozen;
  const why = (reason || '').trim();
  if (invoice.status !== 'draft' && !why) return { error: 'reason_required' };
  const account = await prisma.account.findFirst({ where: { id: invoice.client_account_id }, select: { service_category: true } });
  if (fixedBid.isFixedBid(account) && (await fixedBid.monthLocked(orgId, invoice.client_account_id, { period_month: invoice.period_month, period_year: invoice.period_year }))) return { error: 'billing_locked' };
  await prisma.$transaction(async (tx) => {
    await require('../cashPosition/cash.hooks').unlink(tx, user.id, 'invoice', invoice.id);
    // its payments (and their wallet entries) go with it
    await require('../payments/payments.service').undoWithin(tx, { orgId, user, kind: 'client_invoice', referenceId: invoice.id, reason: why || 'Invoice deleted' });
    // Soft delete: restorable from Group Dashboard > Logs. The number is released so a replacement can use it.
    await tx.clientInvoice.update({
      where: { id: invoice.id },
      data: { deleted_at: new Date(), deleted_by: user.id, delete_reason: why || 'Draft invoice deleted', ...(invoice.invoice_number ? { invoice_number: `${invoice.invoice_number}~deleted~${String(invoice.id).slice(0, 8)}` } : {}) },
    });
  });
  await prisma.auditLog.create({
    data: {
      org_id: orgId,
      actor_id: user.id,
      action: 'client_invoice_delete',
      entity_type: 'client_invoice',
      entity_id: invoice.id,
      reason: why || `Draft invoice ${invoice.invoice_number || ''} deleted`,
      snapshot: { status: invoice.status, invoice_number: invoice.invoice_number, amount: Number(invoice.amount), currency: invoice.currency, client_account_id: invoice.client_account_id, period_month: invoice.period_month, period_year: invoice.period_year, line_items: invoice.line_items },
    },
  });
  return { deleted: true };
}

async function listClientInvoices(orgId, { client_account_id, status, period_month, period_year } = {}) {
  // A combined invoice is stored on one contract but covers several: filtering by a contract also finds the combined invoices that include it.
  const own = client_account_id ? { OR: [{ client_account_id }, { line_items: { path: ['consolidated'], equals: true } }] } : {};
  let rows = await prisma.clientInvoice.findMany({
    where: { org_id: orgId, ...own, ...(status ? { status } : {}), ...(period_month ? { period_month } : {}), ...(period_year ? { period_year } : {}) },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }, { created_at: 'desc' }],
    include: { client_account: CLIENT_INVOICE_ACCOUNT },
  });
  if (client_account_id) rows = rows.filter((r) => r.client_account_id === client_account_id || (r.line_items?.consolidated && (r.line_items.items || []).some((i) => i.account_id === client_account_id)));
  const totals = await paymentsService.totals(prisma, orgId, 'client_invoice', rows.map((r) => r.id));
  return rows.map((r) => invoicePayments.withPayments(serializeClientInvoice(r), totals.get(r.id)));
}

async function getClientInvoice(orgId, invoiceId) {
  const row = await prisma.clientInvoice.findFirst({ where: { id: invoiceId, org_id: orgId }, include: { client_account: CLIENT_INVOICE_ACCOUNT } });
  if (!row) return { error: 'not_found' };
  const totals = await paymentsService.totals(prisma, orgId, 'client_invoice', [row.id]);
  return { invoice: invoicePayments.withPayments(serializeClientInvoice(row), totals.get(row.id)) };
}

// --- Vendor invoices -------------------------------------------------------

// A vendor's month: its contractors' lines (locked vendor record when locked,
// else live), grouped per project and currency.
async function vendorInvoiceSource(orgId, vendorAccountId, period) {
  const vendor = await findVendorAccount(orgId, vendorAccountId);
  if (!vendor) return { error: 'vendor_not_found' };
  const locked = await calculations().lockedVersion(orgId, 'vendor_bill', vendorAccountId, period);
  if (locked?.status === 'change_detected') return { error: 'change_detected' };
  const raw = locked ? locked.snapshot : await vendorEngine.computeVendorPayments(orgId, { ...period, vendor_account_id: vendorAccountId });
  const fx = await exchangeRates.inrRates(orgId);
  const groups = new Map();
  for (const l of raw.lines || []) {
    if (l.vendor?.id !== vendorAccountId) continue;
    const key = `${l.project.id}|${l.currency}`;
    if (!groups.has(key)) groups.set(key, { project: l.project, currency: l.currency, amount: 0, contractors: [] });
    const g = groups.get(key);
    g.amount = round2(g.amount + l.amount);
    g.contractors.push({
      org_membership_id: l.org_membership_id,
      contractor: l.contractor,
      billing_type: 'monthly',
      monthly_vendor_rate: l.monthly_vendor_rate,
      allocation_percent: l.allocation_percent,
      working_days: l.working_days,
      contract_working_days: l.contract_working_days ?? null,
      payout_basis: l.payout_basis ?? null,
      payable_days: l.payable_days ?? null,
      approved_hours: l.approved_hours,
      overtime_hours: l.overtime_hours,
      overtime_billable: l.overtime_billable ?? null,
      base_amount: l.base_amount,
      overtime_amount: l.overtime_amount,
      amount: l.amount,
    });
  }
  // The vendor's + / - adjustments (Live Analytics > Vendors) join the project row they are tied to.
  for (const a of (raw.adjustments || []).filter((x) => x.vendor_account_id === vendorAccountId)) {
    const key = `${a.project.id}|${a.currency}`;
    if (!groups.has(key)) continue;
    const g = groups.get(key);
    g.amount = round2(g.amount + a.amount);
    (g.adjustments ||= []).push({ amount: a.amount, reason: a.reason });
  }
  const projects = [...groups.values()].map((g) => ({
    ...g,
    exchange_rate: fx.has(g.currency) ? fx.get(g.currency) : null,
    amount_inr: fx.has(g.currency) ? round2(g.amount * fx.get(g.currency)) : null,
  }));
  return { vendor, projects, source: locked ? 'locked' : 'live', locked_version: locked?.version || null };
}

async function previewVendorInvoice(orgId, vendorAccountId, period) {
  const src = await vendorInvoiceSource(orgId, vendorAccountId, period);
  if (src.error) return src;
  const existing = await prisma.projectVendorInvoice.findFirst({ where: { org_id: orgId, vendor_account_id: vendorAccountId, ...period, details: { not: Prisma.DbNull } }, select: { invoice_number: true, invoice_date: true, details: true } });
  const vendorAccount = await prisma.account.findFirst({ where: { id: vendorAccountId, org_id: orgId }, select: { id: true, name: true, gst_or_tax_id: true, billing_address: true, location: true } });
  const savedBillTo = existing?.details?.bill_to;
  // Amounts typed over the calculation earlier stay as the starting figure when the invoice is updated.
  const earlier = await prisma.projectVendorInvoice.findMany({ where: { org_id: orgId, vendor_account_id: vendorAccountId, ...period, details: { not: Prisma.DbNull } }, select: { account_id: true, currency: true, amount: true, details: true } });
  const overridden = new Map(earlier.filter((r) => r.details?.manual_override).map((r) => [`${r.account_id}|${r.currency}`, Number(r.amount)]));
  const vendorChargeList = await vendorCharges.listCharges(orgId, vendorAccountId);
  const projects = src.projects.map((p) => (overridden.has(`${p.project.id}|${p.currency}`) ? { ...p, calculated_amount: p.amount, amount: overridden.get(`${p.project.id}|${p.currency}`) } : p));
  return {
    preview: {
      bill_to: { ...billToDefaults(vendorAccount), ...(savedBillTo ? { gstin: savedBillTo.gstin || '', address: savedBillTo.address || '' } : {}) },
      vendor: src.vendor,
      ...period,
      projects: projects.map((p) => ({ ...p, charges: vendorCharges.chargeAmounts(p.amount, vendorChargeList) })),
      vendor_charges: vendorChargeList,
      source: src.source,
      locked_version: src.locked_version,
      existing: existing ? { invoice_number: existing.invoice_number, invoice_date: existing.invoice_date ? ymd(existing.invoice_date) : null } : null,
      suggested_number: existing?.invoice_number || (await suggestVendorNumber(orgId, period.period_year)),
    },
  };
}

// (Re)generates the vendor's invoice for the month: one row per project and
// currency. Rows generated earlier for the same vendor and month are
// replaced; invoices added by hand are left alone.
async function generateVendorInvoice(orgId, user, { vendor_account_id, period_month, period_year, invoice_number, invoice_date, notes, bill_to, save_to_account, amounts }) {
  const period = { period_month, period_year };
  const frozen = await financialLock.assertOpen(orgId, period_month, period_year);
  if (frozen) return frozen;
  const src = await vendorInvoiceSource(orgId, vendor_account_id, period);
  if (src.error) return src;
  // An amount typed in the invoice drawer replaces the calculated figure of that project row.
  const typed = new Map((amounts || []).map((a) => [`${a.project_id}|${a.currency}`, round2(a.amount)]));
  const fx = await exchangeRates.inrRates(orgId);
  for (const p of src.projects) {
    const amount = typed.get(`${p.project.id}|${p.currency}`);
    if (amount === undefined || amount === p.amount) continue;
    p.calculated_amount = p.amount;
    p.amount = amount;
    p.amount_inr = fx.has(p.currency) ? round2(amount * fx.get(p.currency)) : null;
    p.manual_override = { original_amount: p.calculated_amount, original_currency: p.currency, by: user.id, at: new Date().toISOString() };
  }
  const billable = src.projects.filter((p) => p.amount > 0);
  if (!billable.length) return { error: 'nothing_to_invoice' };
  const previous = await prisma.projectVendorInvoice.findMany({ where: { org_id: orgId, vendor_account_id, ...period, details: { not: Prisma.DbNull } }, select: { id: true, invoice_number: true } });
  const number = (invoice_number || '').trim() || previous[0]?.invoice_number || (await suggestVendorNumber(orgId, period_year));
  const date = new Date(invoice_date || todayYmd());
  const printedBillTo = await resolveBillTo(orgId, user, vendor_account_id, bill_to, save_to_account);
  // The vendor's GST / TDS / other charges are worked out on each project row, like a contract's charges on a client invoice.
  const vendorChargeList = await vendorCharges.listCharges(orgId, vendor_account_id);
  const rows = await prisma.$transaction(async (tx) => {
    if (previous.length) await tx.projectVendorInvoice.deleteMany({ where: { id: { in: previous.map((p) => p.id) } } });
    const created = [];
    for (const p of billable) {
      const figures = vendorCharges.chargeAmounts(p.amount, vendorChargeList);
      created.push(await tx.projectVendorInvoice.create({
        data: {
          org_id: orgId,
          account_id: p.project.id,
          vendor_account_id,
          ...period,
          invoice_number: number,
          invoice_date: date,
          amount: p.amount,
          gst_amount: figures.gst_amount,
          tds_amount: figures.tds_amount,
          other_amount: figures.other_amount,
          currency: p.currency,
          notes: notes || null,
          details: { ...(figures.lines.length ? { charges: figures.lines } : {}), ...(printedBillTo ? { bill_to: printedBillTo } : {}), project: p.project, contractors: p.contractors, ...(p.adjustments?.length ? { adjustments: p.adjustments } : {}), exchange_rate: p.exchange_rate, amount_inr: p.amount_inr, source: src.source, locked_version: src.locked_version, ...(p.manual_override ? { manual_override: p.manual_override } : {}) },
          created_by: user.id,
        },
        include: VENDOR_INVOICE_INCLUDE,
      }));
    }
    await tx.auditLog.create({
      data: { org_id: orgId, actor_id: user.id, action: previous.length ? 'vendor_invoice_refresh' : 'vendor_invoice_generate', entity_type: 'vendor_invoice', entity_id: vendor_account_id, reason: `Vendor invoice ${number} for ${src.vendor.name} ${period_month}/${period_year}`, snapshot: { rows: created.map((r) => r.id), source: src.source } },
    });
    return created;
  });
  return { invoices: rows.map(serializeVendorInvoice) };
}

const VENDOR_INVOICE_INCLUDE = {
  vendor_account: { select: { id: true, name: true } },
  account: CLIENT_INVOICE_ACCOUNT,
};

function serializeVendorInvoice(row) {
  return {
    ...row,
    amount: Number(row.amount),
    gst_amount: Number(row.gst_amount || 0),
    other_amount: Number(row.other_amount || 0),
    tds_amount: Number(row.tds_amount || 0),
    adjustment_amount: Number(row.adjustment_amount || 0),
    net_payable: round2(Number(row.amount) + Number(row.gst_amount || 0) + Number(row.other_amount || 0) - Number(row.tds_amount || 0) + Number(row.adjustment_amount || 0)),
    sent: Boolean(row.sent_at),
    invoice_date: row.invoice_date ? ymd(row.invoice_date) : null,
    project: row.details?.project?.name ? row.details.project : row.account ? billingEngine.describeProject(row.account) : null,
    generated: Boolean(row.details),
  };
}

// Every vendor invoice of the org (optionally one month / vendor), newest first.
async function listVendorInvoices(orgId, { period_month, period_year, vendor_account_id } = {}) {
  const rows = await prisma.projectVendorInvoice.findMany({
    where: { org_id: orgId, ...(period_month ? { period_month } : {}), ...(period_year ? { period_year } : {}), ...(vendor_account_id ? { vendor_account_id } : {}) },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }, { created_at: 'desc' }],
    include: VENDOR_INVOICE_INCLUDE,
  });
  // Paid / unpaid comes from the vendor payment of the same vendor and month.
  const payments = rows.length
    ? await prisma.vendorPayment.findMany({ where: { org_id: orgId, status: 'paid', vendor_account_id: { in: [...new Set(rows.map((r) => r.vendor_account_id))] } }, select: { vendor_account_id: true, period_month: true, period_year: true } })
    : [];
  const paid = new Set(payments.map((p) => `${p.vendor_account_id}|${p.period_year}-${p.period_month}`));
  return rows.map((row) => ({ ...serializeVendorInvoice(row), paid: paid.has(`${row.vendor_account_id}|${row.period_year}-${row.period_month}`) }));
}

module.exports = {
  previewClientInvoice,
  generateClientInvoice,
  generateConsolidatedInvoice,
  updateClientInvoice,
  deleteClientInvoice,
  listClientInvoices,
  getClientInvoice,
  serializeClientInvoice,
  previewVendorInvoice,
  generateVendorInvoice,
  listVendorInvoices,
};
