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
const chargesService = require('./charges.service');
const { findVendorAccount } = require('../../lib/workerType');
const { round2, ymd } = require('../calculations/period');

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
async function clientInvoiceSource(orgId, accountId, period, currency) {
  const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: 'client' }, select: billingEngine.PROJECT_SELECT });
  if (!account) return { error: 'account_not_found' };
  // Nothing is invoiced outside the agreement dates.
  const monthStart = new Date(Date.UTC(period.period_year, period.period_month - 1, 1));
  const monthEnd = new Date(Date.UTC(period.period_year, period.period_month, 0));
  if (account.agreement_start_date && account.agreement_start_date > monthEnd) return { error: 'before_agreement_start', agreement_start: ymd(account.agreement_start_date) };
  if (account.agreement_end_date && account.agreement_end_date < monthStart) return { error: 'after_agreement_end', agreement_end: ymd(account.agreement_end_date) };
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

async function previewClientInvoice(orgId, accountId, period, currency) {
  const src = await clientInvoiceSource(orgId, accountId, period, currency);
  if (src.error) return src;
  const [existing, suggested] = await Promise.all([
    prisma.clientInvoice.findUnique({ where: { client_account_id_period_month_period_year: { client_account_id: accountId, ...period } }, select: { id: true, invoice_number: true, status: true, invoice_date: true } }),
    suggestClientNumber(orgId, period.period_year),
  ]);
  return {
    preview: {
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
      existing: existing ? { ...existing, invoice_date: existing.invoice_date ? ymd(existing.invoice_date) : null } : null,
      suggested_number: existing?.invoice_number || suggested,
    },
  };
}

// Creates the project's invoice for the month, or refreshes it while it is
// still a draft. Sent / paid invoices are never rewritten.
async function generateClientInvoice(orgId, user, { account_id, period_month, period_year, invoice_number, invoice_date, notes, currency }) {
  const period = { period_month, period_year };
  const src = await clientInvoiceSource(orgId, account_id, period, currency);
  if (src.error) return src;
  if (!(src.details.amount > 0)) return { error: 'nothing_to_invoice' };
  const existing = await prisma.clientInvoice.findUnique({ where: { client_account_id_period_month_period_year: { client_account_id: account_id, ...period } } });
  if (existing && existing.status !== 'draft') return { error: 'invoice_sent' };
  const number = (invoice_number || '').trim() || existing?.invoice_number || (await suggestClientNumber(orgId, period_year));
  const clash = await prisma.clientInvoice.findFirst({ where: { org_id: orgId, invoice_number: number, ...(existing ? { NOT: { id: existing.id } } : {}) }, select: { id: true } });
  if (clash) return { error: 'invoice_number_taken' };
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

const CLIENT_INVOICE_ACCOUNT = { select: { id: true, name: true, project_name: true, project_code: true, client_name: true, client_account_id: true, service_category: true, client_account: { select: { id: true, name: true } } } };

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
  };
}

// Admin edit of a client invoice. Number, date and notes update in place; a
// different currency re-expresses the amount from the project's month (drafts
// only); `amount` overrides the calculated figure and is recorded in
// line_items.manual_override. A sent / paid invoice can still be corrected, but
// only with a `reason`, and every edit is audited with before / after.
async function updateClientInvoice(orgId, user, invoiceId, { invoice_number, invoice_date, notes, currency, amount, reason }) {
  const invoice = await prisma.clientInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!invoice) return { error: 'not_found' };
  const draft = invoice.status === 'draft';
  const why = (reason || '').trim();
  if (!draft && !why) return { error: 'reason_required' };
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
  const why = (reason || '').trim();
  if (invoice.status !== 'draft' && !why) return { error: 'reason_required' };
  await prisma.clientInvoice.delete({ where: { id: invoice.id } });
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
  const rows = await prisma.clientInvoice.findMany({
    where: { org_id: orgId, ...(client_account_id ? { client_account_id } : {}), ...(status ? { status } : {}), ...(period_month ? { period_month } : {}), ...(period_year ? { period_year } : {}) },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }, { created_at: 'desc' }],
    include: { client_account: CLIENT_INVOICE_ACCOUNT },
  });
  return rows.map(serializeClientInvoice);
}

async function getClientInvoice(orgId, invoiceId) {
  const row = await prisma.clientInvoice.findFirst({ where: { id: invoiceId, org_id: orgId }, include: { client_account: CLIENT_INVOICE_ACCOUNT } });
  return row ? { invoice: serializeClientInvoice(row) } : { error: 'not_found' };
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
  const existing = await prisma.projectVendorInvoice.findFirst({ where: { org_id: orgId, vendor_account_id: vendorAccountId, ...period, details: { not: Prisma.DbNull } }, select: { invoice_number: true, invoice_date: true } });
  return {
    preview: {
      vendor: src.vendor,
      ...period,
      projects: src.projects,
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
async function generateVendorInvoice(orgId, user, { vendor_account_id, period_month, period_year, invoice_number, invoice_date, notes }) {
  const period = { period_month, period_year };
  const src = await vendorInvoiceSource(orgId, vendor_account_id, period);
  if (src.error) return src;
  const billable = src.projects.filter((p) => p.amount > 0);
  if (!billable.length) return { error: 'nothing_to_invoice' };
  const previous = await prisma.projectVendorInvoice.findMany({ where: { org_id: orgId, vendor_account_id, ...period, details: { not: Prisma.DbNull } }, select: { id: true, invoice_number: true } });
  const number = (invoice_number || '').trim() || previous[0]?.invoice_number || (await suggestVendorNumber(orgId, period_year));
  const date = new Date(invoice_date || todayYmd());
  const rows = await prisma.$transaction(async (tx) => {
    if (previous.length) await tx.projectVendorInvoice.deleteMany({ where: { id: { in: previous.map((p) => p.id) } } });
    const created = [];
    for (const p of billable) {
      created.push(await tx.projectVendorInvoice.create({
        data: {
          org_id: orgId,
          account_id: p.project.id,
          vendor_account_id,
          ...period,
          invoice_number: number,
          invoice_date: date,
          amount: p.amount,
          currency: p.currency,
          notes: notes || null,
          details: { project: p.project, contractors: p.contractors, exchange_rate: p.exchange_rate, amount_inr: p.amount_inr, source: src.source, locked_version: src.locked_version },
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
  return rows.map(serializeVendorInvoice);
}

module.exports = {
  previewClientInvoice,
  generateClientInvoice,
  updateClientInvoice,
  deleteClientInvoice,
  listClientInvoices,
  getClientInvoice,
  serializeClientInvoice,
  previewVendorInvoice,
  generateVendorInvoice,
  listVendorInvoices,
};
