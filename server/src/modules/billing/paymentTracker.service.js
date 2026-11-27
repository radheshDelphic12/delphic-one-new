// Client and vendor payments side by side, for one month.
//
// A contractor (a resource that belongs to a vendor) is billed to a client on a project, and the vendor bills the company for that same resource.
// Employees are not here: their pay runs through payroll. For every contractor line of the month this shows, next to each other:
//   client side: the project's client invoice (number, amount, received / part / not received, due date, overdue)
//   vendor side: the vendor's invoice for that project (number, payable, paid / unpaid, due date, overdue)
// so "did the client pay us, and did we pay the vendor" is one look. The due dates are the ones set on the invoices (Invoicing, Vendor Invoices).

const { z } = require('zod');
const prisma = require('../../config/db');
const invoices = require('./invoices.service');

// Lazy: live.service loads the calculation engines, which load the billing code.
const live = () => require('../calculations/live.service');

const STATUS = ['all', 'client_pending', 'vendor_pending', 'client_paid_vendor_pending', 'overdue'];
const querySchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
  client_name: z.string().trim().max(200).optional(),
  vendor_account_id: z.string().uuid().optional(),
  status: z.enum(STATUS).optional(),
  // optional end of a range: start month (period_*) to end month (to_*), at most 24 months
  to_month: z.coerce.number().int().min(1).max(12).optional(),
  to_year: z.coerce.number().int().min(2000).max(2100).optional(),
});
const MAX_MONTHS = 24;

const n = (v) => Number(v || 0);

/** The client invoice side of one project: none yet / draft (not sent) / not received / part received / received. */
function clientSide(inv) {
  if (!inv) return { state: 'no_invoice' };
  const state = inv.status === 'draft' ? 'draft' : inv.payment_status === 'paid' ? 'paid' : inv.payment_status === 'partly_paid' ? 'part_paid' : 'unpaid';
  return {
    state,
    id: inv.id,
    invoice_number: inv.invoice_number || null,
    currency: inv.currency,
    total: n(inv.total_amount ?? inv.amount),
    received: n(inv.paid_amount),
    pending: n(inv.pending_amount),
    due_date: inv.due_date || null,
    overdue: Boolean(inv.overdue),
    days_overdue: inv.days_overdue || 0,
    next_followup_date: inv.next_followup_date || null,
    followup_due: Boolean(inv.followup_due),
  };
}

/** The vendor invoice side of one project and vendor: not invoiced yet / unpaid / paid. */
function vendorSide(inv) {
  if (!inv) return { state: 'no_invoice' };
  return {
    state: inv.paid ? 'paid' : 'unpaid',
    id: inv.id,
    invoice_number: inv.invoice_number || null,
    currency: inv.currency,
    payable: n(inv.net_payable),
    sent: Boolean(inv.sent),
    due_date: inv.due_date || null,
    overdue: Boolean(inv.overdue),
    days_overdue: inv.days_overdue || 0,
    next_followup_date: inv.next_followup_date || null,
    followup_due: Boolean(inv.followup_due),
  };
}

/**
 * A resource counts as paid when the vendor's payment for the month is paid, or when it was marked paid on its own here.
 * `vendor_resource` says which, and when.
 */
function withResourcePayment(row, markOf) {
  const mark = markOf.get(row.key);
  const viaVendorPayment = row.vendor_invoice.state === 'paid';
  return {
    ...row,
    vendor_paid: viaVendorPayment || Boolean(mark),
    vendor_resource: {
      paid: viaVendorPayment || Boolean(mark),
      source: viaVendorPayment ? 'vendor_payment' : mark ? 'marked' : null,
      paid_on: mark ? mark.paid_on.toISOString().slice(0, 10) : null,
      amount: mark?.amount == null ? null : n(mark.amount),
      note: mark?.note || null,
    },
  };
}

const matchStatus = (status, r) => {
  if (!status || status === 'all') return true;
  if (status === 'client_pending') return r.client.state !== 'paid';
  if (status === 'vendor_pending') return !r.vendor_paid;
  if (status === 'client_paid_vendor_pending') return r.client.state === 'paid' && !r.vendor_paid;
  if (status === 'overdue') return Boolean(r.client.overdue || r.vendor_invoice.overdue);
  return true;
};

/** Counts of the distinct client invoices and vendor invoices behind a set of rows. */
function summarize(rows) {
  const clients = new Map();
  const vendors = new Map();
  for (const r of rows) {
    clients.set(r.client.id || `none:${r.period}:${r.project.id}`, r.client);
    vendors.set(r.vendor_invoice.id || `none:${r.period}:${r.project.id}:${r.vendor.id}`, r.vendor_invoice);
  }
  const count = (map, pick) => [...map.values()].filter(pick).length;
  return {
    resources: rows.length,
    client_invoices: {
      total: clients.size,
      received: count(clients, (c) => c.state === 'paid'),
      part_received: count(clients, (c) => c.state === 'part_paid'),
      not_received: count(clients, (c) => c.state === 'unpaid'),
      draft: count(clients, (c) => c.state === 'draft'),
      not_invoiced: count(clients, (c) => c.state === 'no_invoice'),
      overdue: count(clients, (c) => c.overdue),
    },
    vendor_invoices: {
      total: vendors.size,
      paid: count(vendors, (v) => v.state === 'paid'),
      unpaid: count(vendors, (v) => v.state === 'unpaid'),
      not_invoiced: count(vendors, (v) => v.state === 'no_invoice'),
      overdue: count(vendors, (v) => v.overdue),
    },
    // the one to watch: the client has paid, the vendor is still waiting
    client_paid_vendor_pending: rows.filter((r) => r.client.state === 'paid' && !r.vendor_paid).length,
    // the other one: we paid the vendor but the client has not paid us
    vendor_paid_client_pending: rows.filter((r) => r.vendor_paid && r.client.state !== 'paid').length,
    // each resource on its own: paid through the vendor's payment, or marked paid here
    resources_paid: rows.filter((r) => r.vendor_paid).length,
  };
}

/** The months from the start month to the end month (inclusive); null when the end is before the start or the range is too long. */
function monthsBetween(fromMonth, fromYear, toMonth, toYear) {
  const out = [];
  let m = fromMonth; let y = fromYear;
  while (y < toYear || (y === toYear && m <= toMonth)) {
    out.push({ period_month: m, period_year: y });
    if (out.length > MAX_MONTHS) return null;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out.length ? out : null;
}

async function paymentTracker(orgId, query) {
  const { period_month, period_year, client_name, vendor_account_id, status } = query;
  const months = monthsBetween(period_month, period_year, query.to_month || period_month, query.to_year || period_year);
  if (!months) return { error: 'bad_range' };
  const perMonth = await Promise.all(months.map((p) => monthRows(orgId, p, vendor_account_id)));
  const all = perMonth.flat();

  // the filter lists are built from the whole range, so choosing a client does not empty the vendor list
  const clients = [...new Set(all.map((r) => r.client_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const vendorMap = new Map(all.map((r) => [r.vendor.id, r.vendor.name]));
  const vendors = [...vendorMap].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  const scoped = all.filter((r) => (!client_name || r.client_name === client_name) && (!vendor_account_id || r.vendor.id === vendor_account_id));
  const rows = scoped.filter((r) => matchStatus(status, r));
  const last = months[months.length - 1];
  return { period_month, period_year, to_month: last.period_month, to_year: last.period_year, months: months.length, rows, summary: summarize(scoped), clients, vendors };
}

/** The contractor lines of one month, each with the client side and the vendor side. */
async function monthRows(orgId, period, vendor_account_id) {
  const { period_month, period_year } = period;
  const label = `${period_year}-${String(period_month).padStart(2, '0')}`;
  const [vendorLive, clientInvoices, vendorInvoices, marks] = await Promise.all([
    live().vendorPaymentsLive(orgId, { ...period, vendor_account_id }),
    invoices.listClientInvoices(orgId, period),
    invoices.listVendorInvoices(orgId, { ...period, ...(vendor_account_id ? { vendor_account_id } : {}) }),
    prisma.vendorResourcePayment.findMany({ where: { org_id: orgId, ...period } }),
  ]);
  const markOf = new Map(marks.map((m) => [`${m.org_membership_id}|${m.project_id}`, m]));

  const clientInvoiceOf = (projectId) => clientInvoices.find((i) => i.client_account_id === projectId)
    || clientInvoices.find((i) => i.line_items?.consolidated && (i.line_items.items || []).some((x) => x.account_id === projectId))
    || null;
  const vendorInvoiceOf = (projectId, vendorId) => vendorInvoices.find((i) => i.account_id === projectId && i.vendor_account_id === vendorId) || null;

  const all = (vendorLive.lines || [])
    .filter((l) => l.vendor?.id && l.project?.id)
    .map((l) => withResourcePayment({
      key: `${l.org_membership_id}|${l.project.id}`,
      org_membership_id: l.org_membership_id,
      client_name: l.project.client_name || null,
      project: { id: l.project.id, name: l.project.name, code: l.project.code || null },
      resource: l.contractor,
      vendor: { id: l.vendor.id, name: l.vendor.name },
      approved_hours: n(l.approved_hours),
      vendor_amount: n(l.amount),
      currency: l.currency,
      client: clientSide(clientInvoiceOf(l.project.id)),
      vendor_invoice: vendorSide(vendorInvoiceOf(l.project.id, l.vendor.id)),
    }, markOf))
    // a contractor with nothing to bill that month (no approved hours, no invoice on either side) is not a payment to track
    .filter((r) => r.vendor_amount > 0 || r.client.state !== 'no_invoice' || r.vendor_invoice.state !== 'no_invoice')
    .sort((a, b) => String(a.client_name).localeCompare(String(b.client_name)) || String(a.project.name).localeCompare(String(b.project.name)) || String(a.resource).localeCompare(String(b.resource)))
    // the month of the row; the key stays unique across a range of months
    .map((row) => ({ ...row, key: `${label}|${row.key}`, period: label, period_month, period_year }));
  return all;
}

const markSchema = z.object({
  org_membership_id: z.string().uuid(),
  project_id: z.string().uuid(),
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31').optional(),
  amount: z.coerce.number().min(0).max(1e10).optional(),
  note: z.string().trim().max(300).optional(),
});
const unmarkSchema = markSchema.pick({ org_membership_id: true, project_id: true, period_month: true, period_year: true });

/** The vendor a contractor belongs to, and proof that the person is a contractor of this company. */
async function contractorOf(orgId, membershipId) {
  return prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId, worker_type: 'contractor', vendor_account_id: { not: null } }, select: { id: true, vendor_account_id: true } });
}

/** Mark one resource paid for a month (or change the date / note of an earlier mark). */
async function markResourcePaid(orgId, user, input) {
  const member = await contractorOf(orgId, input.org_membership_id);
  if (!member) return { error: 'not_a_vendor_resource' };
  const project = await prisma.account.findFirst({ where: { id: input.project_id, org_id: orgId }, select: { id: true } });
  if (!project) return { error: 'project_not_found' };
  const key = { org_membership_id: input.org_membership_id, project_id: input.project_id, period_month: input.period_month, period_year: input.period_year };
  const data = { paid_on: new Date(`${input.paid_on || new Date().toISOString().slice(0, 10)}T00:00:00Z`), amount: input.amount ?? null, note: input.note || null, marked_by: user.id };
  const row = await prisma.vendorResourcePayment.upsert({
    where: { org_membership_id_project_id_period_month_period_year: key },
    create: { ...key, ...data, org_id: orgId, vendor_account_id: member.vendor_account_id },
    update: data,
  });
  return { payment: { paid_on: row.paid_on.toISOString().slice(0, 10), amount: row.amount == null ? null : n(row.amount), note: row.note } };
}

async function unmarkResourcePaid(orgId, input) {
  const done = await prisma.vendorResourcePayment.deleteMany({ where: { org_id: orgId, ...input } });
  return done.count ? { ok: true } : { error: 'not_marked' };
}

module.exports = { querySchema, paymentTracker, STATUS, markSchema, unmarkSchema, markResourcePaid, unmarkResourcePaid };
