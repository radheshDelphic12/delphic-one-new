// Client and vendor payments side by side, for one month.
//
// A contractor (a resource that belongs to a vendor) is billed to a client on a project, and the vendor bills the company for that same resource.
// Employees are not here: their pay runs through payroll. For every contractor line of the month this shows, next to each other:
//   client side: the project's client invoice (number, amount, received / part / not received, due date, overdue)
//   vendor side: the vendor's invoice for that project (number, payable, paid / unpaid, due date, overdue)
// so "did the client pay us, and did we pay the vendor" is one look. The due dates are the ones set on the invoices (Invoicing, Vendor Invoices).

const { z } = require('zod');
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
});

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

const matchStatus = (status, r) => {
  if (!status || status === 'all') return true;
  if (status === 'client_pending') return r.client.state !== 'paid';
  if (status === 'vendor_pending') return r.vendor_invoice.state !== 'paid';
  if (status === 'client_paid_vendor_pending') return r.client.state === 'paid' && r.vendor_invoice.state !== 'paid';
  if (status === 'overdue') return Boolean(r.client.overdue || r.vendor_invoice.overdue);
  return true;
};

/** Counts of the distinct client invoices and vendor invoices behind a set of rows. */
function summarize(rows) {
  const clients = new Map();
  const vendors = new Map();
  for (const r of rows) {
    clients.set(r.client.id || `none:${r.project.id}`, r.client);
    vendors.set(r.vendor_invoice.id || `none:${r.project.id}:${r.vendor.id}`, r.vendor_invoice);
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
    client_paid_vendor_pending: rows.filter((r) => r.client.state === 'paid' && r.vendor_invoice.state !== 'paid').length,
    // the other one: we paid the vendor but the client has not paid us
    vendor_paid_client_pending: rows.filter((r) => r.vendor_invoice.state === 'paid' && r.client.state !== 'paid').length,
  };
}

async function paymentTracker(orgId, query) {
  const { period_month, period_year, client_name, vendor_account_id, status } = query;
  const period = { period_month, period_year };
  const [vendorLive, clientInvoices, vendorInvoices] = await Promise.all([
    live().vendorPaymentsLive(orgId, { ...period, vendor_account_id }),
    invoices.listClientInvoices(orgId, period),
    invoices.listVendorInvoices(orgId, { ...period, ...(vendor_account_id ? { vendor_account_id } : {}) }),
  ]);

  const clientInvoiceOf = (projectId) => clientInvoices.find((i) => i.client_account_id === projectId)
    || clientInvoices.find((i) => i.line_items?.consolidated && (i.line_items.items || []).some((x) => x.account_id === projectId))
    || null;
  const vendorInvoiceOf = (projectId, vendorId) => vendorInvoices.find((i) => i.account_id === projectId && i.vendor_account_id === vendorId) || null;

  const all = (vendorLive.lines || [])
    .filter((l) => l.vendor?.id && l.project?.id)
    .map((l) => ({
      key: `${l.org_membership_id}|${l.project.id}`,
      client_name: l.project.client_name || null,
      project: { id: l.project.id, name: l.project.name, code: l.project.code || null },
      resource: l.contractor,
      vendor: { id: l.vendor.id, name: l.vendor.name },
      approved_hours: n(l.approved_hours),
      vendor_amount: n(l.amount),
      currency: l.currency,
      client: clientSide(clientInvoiceOf(l.project.id)),
      vendor_invoice: vendorSide(vendorInvoiceOf(l.project.id, l.vendor.id)),
    }))
    // a contractor with nothing to bill that month (no approved hours, no invoice on either side) is not a payment to track
    .filter((r) => r.vendor_amount > 0 || r.client.state !== 'no_invoice' || r.vendor_invoice.state !== 'no_invoice')
    .sort((a, b) => String(a.client_name).localeCompare(String(b.client_name)) || String(a.project.name).localeCompare(String(b.project.name)) || String(a.resource).localeCompare(String(b.resource)));

  // the filter lists are built from the whole month, so choosing a client does not empty the vendor list
  const clients = [...new Set(all.map((r) => r.client_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const vendorMap = new Map(all.map((r) => [r.vendor.id, r.vendor.name]));
  const vendors = [...vendorMap].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  const scoped = all.filter((r) => (!client_name || r.client_name === client_name) && (!vendor_account_id || r.vendor.id === vendor_account_id));
  const rows = scoped.filter((r) => matchStatus(status, r));
  return { ...period, rows, summary: summarize(scoped), clients, vendors };
}

module.exports = { querySchema, paymentTracker, STATUS };
