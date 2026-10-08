// Vendor billing tracking and traceability.
//
// A vendor invoice (ProjectVendorInvoice) is tracked as Sent / Unsent, with the TDS withheld and any
// financial adjustment; Paid / Unpaid comes from the vendor payment of the same vendor and month.
// `trace` answers "where does every rupee of this vendor bill come from": vendor, project, the locked
// billing record, the contractors' approved timesheet entries, the invoice and the payment.

const prisma = require('../../config/db');
const { round2, monthBounds } = require('../calculations/period');
const financialLock = require('../calculations/financialLock');

const calculations = () => require('../calculations/calculations.service');

const num = (v) => Number(v || 0);

function payable(invoice) {
  return round2(num(invoice.amount) - num(invoice.tds_amount) + num(invoice.adjustment_amount));
}

async function paymentFor(orgId, invoice) {
  const payments = await prisma.vendorPayment.findMany({
    where: { org_id: orgId, vendor_account_id: invoice.vendor_account_id, period_month: invoice.period_month, period_year: invoice.period_year },
    orderBy: { created_at: 'desc' },
  });
  const paid = payments.filter((p) => p.status === 'paid');
  return {
    payments: payments.map((p) => ({ id: p.id, status: p.status, amount: num(p.amount), currency: p.currency, paid_at: p.paid_at, calculation_version_id: p.calculation_version_id })),
    paid: paid.length > 0,
    paid_amount: round2(paid.reduce((s, p) => s + num(p.amount), 0)),
  };
}

function describe(invoice, payment) {
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number || null,
    invoice_date: invoice.invoice_date ? invoice.invoice_date.toISOString().slice(0, 10) : null,
    amount: num(invoice.amount),
    currency: invoice.currency,
    tds_amount: num(invoice.tds_amount),
    adjustment_amount: num(invoice.adjustment_amount),
    adjustment_note: invoice.adjustment_note || null,
    net_payable: payable(invoice),
    sent: Boolean(invoice.sent_at),
    sent_at: invoice.sent_at || null,
    paid: payment.paid,
    payment_status: payment.paid ? 'paid' : 'unpaid',
  };
}

// Sent / unsent, TDS and adjustment; audited.
async function updateTracking(orgId, user, invoiceId, { sent, tds_amount, adjustment_amount, adjustment_note, reason }) {
  const existing = await prisma.projectVendorInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  const frozen = await financialLock.assertOpen(orgId, existing.period_month, existing.period_year);
  if (frozen) return frozen;
  const data = {};
  if (sent !== undefined) data.sent_at = sent ? existing.sent_at || new Date() : null;
  if (tds_amount !== undefined) data.tds_amount = tds_amount;
  if (adjustment_amount !== undefined) data.adjustment_amount = adjustment_amount;
  if (adjustment_note !== undefined) data.adjustment_note = adjustment_note;
  const updated = await prisma.projectVendorInvoice.update({ where: { id: invoiceId }, data });
  await prisma.auditLog.create({
    data: {
      org_id: orgId, actor_id: user.id, action: 'vendor_invoice_tracking', entity_type: 'project_vendor_invoice', entity_id: invoiceId, reason: reason || 'vendor invoice tracking',
      snapshot: { before: { sent_at: existing.sent_at, tds_amount: num(existing.tds_amount), adjustment_amount: num(existing.adjustment_amount) }, after: { sent_at: updated.sent_at, tds_amount: num(updated.tds_amount), adjustment_amount: num(updated.adjustment_amount) } },
    },
  });
  return { invoice: describe(updated, await paymentFor(orgId, updated)) };
}

// The full trail behind one vendor invoice.
async function trace(orgId, invoiceId) {
  const invoice = await prisma.projectVendorInvoice.findFirst({
    where: { id: invoiceId, org_id: orgId },
    include: { account: { select: { id: true, name: true, project_name: true, project_code: true } }, vendor_account: { select: { id: true, name: true } } },
  });
  if (!invoice) return { error: 'not_found' };
  const period = { period_month: invoice.period_month, period_year: invoice.period_year };
  const { start, end } = monthBounds(invoice.period_month, invoice.period_year);
  const [payment, billing, entries] = await Promise.all([
    paymentFor(orgId, invoice),
    calculations().lockedVersion(orgId, 'vendor_bill', invoice.vendor_account_id, period),
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, account_id: invoice.account_id, date: { gte: start, lte: end }, org_membership: { vendor_account_id: invoice.vendor_account_id } },
      orderBy: [{ date: 'asc' }, { created_at: 'asc' }],
      select: { id: true, date: true, hours: true, overtime_hours: true, status: true, org_membership_id: true, org_membership: { select: { person: { select: { name: true } } } } },
    }),
  ]);
  return {
    vendor: { id: invoice.vendor_account.id, name: invoice.vendor_account.name },
    project: { id: invoice.account.id, name: invoice.account.project_name || invoice.account.name, code: invoice.account.project_code || null },
    period: { month: invoice.period_month, year: invoice.period_year },
    invoice: describe(invoice, payment),
    billing_record: billing
      ? { calculation_version: billing.version, status: billing.status, locked: true, amount: num(billing.amount) }
      : { locked: false, note: 'The vendor bill for this month is not locked yet - the amount comes from the live vendor calculation.' },
    calculation_details: invoice.details || null,
    timesheet_records: entries.map((e) => ({ id: e.id, date: e.date.toISOString().slice(0, 10), resource: e.org_membership?.person?.name || null, hours: num(e.hours), overtime_hours: num(e.overtime_hours), status: e.status })),
    timesheet_hours: {
      approved: round2(entries.filter((e) => e.status === 'approved').reduce((s, e) => s + num(e.hours), 0)),
      pending: round2(entries.filter((e) => e.status === 'submitted').reduce((s, e) => s + num(e.hours), 0)),
    },
    payment,
  };
}

module.exports = { updateTracking, trace, describe, paymentFor };
