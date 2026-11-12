const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/db');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./delphicone.service');
const followups = require('../billing/invoiceFollowups.service');
const provisioning = require('../platform/provisioning.service');

// The Delphic One workspace (module key `delphic_one`). Roles come from the org membership: admin does everything, sales / bda work customers and
// leads and read the invoices; everyone else has no access here.
const ALL = ['dashboard', 'customers', 'customersEdit', 'leads', 'leadsEdit', 'invoices', 'invoicesEdit', 'delete'];
const CAPS = {
  admin: ALL,
  sales: ['dashboard', 'customers', 'customersEdit', 'leads', 'leadsEdit', 'invoices'],
  bda: ['dashboard', 'customers', 'customersEdit', 'leads', 'leadsEdit', 'invoices'],
};

async function access(req, res, next) {
  try {
    const org = await prisma.org.findUnique({ where: { id: req.user.org_id }, select: { enabled_modules: true } });
    if (!org?.enabled_modules?.includes('delphic_one')) return fail(res, 403, 'This is not the Delphic One workspace');
    const caps = CAPS[req.user.role] || [];
    if (!caps.length) return fail(res, 403, 'No Delphic One access for this account');
    req.dox = { role: req.user.role, caps };
    return next();
  } catch (err) {
    return next(err);
  }
}
const need = (...caps) => (req, res, next) => (caps.some((c) => req.dox?.caps.includes(c)) ? next() : fail(res, 403, 'Insufficient Delphic One role'));

const router = express.Router();
router.use(authenticate, requireOrgMembership, access);

const ERRORS = {
  not_found: [404, 'Not found'],
  customer_not_found: [404, 'That customer was not found'],
  has_invoices: [409, 'This customer has invoices: mark them churned instead of deleting'],
  already_won: [409, 'A won lead cannot be moved back'],
  use_convert: [422, 'Use "Convert to customer" to win a lead'],
  already_converted: [409, 'This lead is already a customer'],
  duplicate_number: [409, 'An invoice with this number already exists'],
  cancelled: [409, 'A cancelled invoice cannot be changed'],
  has_payments: [409, 'This invoice has payments: it cannot be cancelled'],
  not_open: [409, 'Payments can be recorded only on a sent invoice'],
  nothing_to_change: [422, 'Nothing to change'],
};
const problem = (res, r) => {
  if (r.error === 'over_balance') return fail(res, 422, `That is more than the invoice still owes (${r.balance})`);
  const [status, message] = ERRORS[r.error] || [400, 'Bad request'];
  return fail(res, status, message);
};
const uuid = z.string().uuid();

router.get('/me', asyncHandler(async (req, res) => ok(res, { role: req.dox.role, caps: req.dox.caps, provisioning: req.dox.role === 'admin' && (await provisioning.enabled()), meta: { customer_status: service.CUSTOMER_STATUS, lead_stages: service.LEAD_STAGES, lead_sources: service.LEAD_SOURCES, pay_modes: service.PAY_MODES } })));
router.get('/summary', need('dashboard'), asyncHandler(async (req, res) => ok(res, await service.summary(req.user.org_id))));

// customers
router.get('/customers', need('customers'), asyncHandler(async (req, res) => ok(res, await service.listCustomers(req.user.org_id, z.object({ status: z.enum(service.CUSTOMER_STATUS).optional(), q: z.string().max(100).optional() }).parse(req.query)))));
router.post('/customers', need('customersEdit'), asyncHandler(async (req, res) => created(res, (await service.createCustomer(req.user.org_id, req.user, service.customerSchema.parse(req.body || {}))).customer)));
router.patch('/customers/:id', need('customersEdit'), asyncHandler(async (req, res) => {
  const r = await service.updateCustomer(req.user.org_id, uuid.parse(req.params.id), service.customerUpdateSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.customer);
}));
// Create the customer's own workspace (a new trial group with one clean company, 15 days, 2 users). Off unless SAAS_CUSTOMER_PROVISIONING=true; Delphic One admins only.
router.post('/customers/:id/provision', need('delete'), asyncHandler(async (req, res) => {
  const r = await provisioning.provision({ doxCustomerId: uuid.parse(req.params.id), doxOrgId: req.user.org_id, actorId: req.user.id });
  if (r.error) {
    const [status, message] = {
      disabled: [404, 'Customer workspaces are not switched on yet'],
      customer_not_found: [404, 'That customer was not found'],
      no_email: [422, 'Add the customer contact email first: it becomes the first admin login'],
      already_provisioned: [409, 'This customer already has a workspace'],
      email_in_use: [409, 'That email already has a login; use another contact email for the trial admin'],
    }[r.error] || [400, 'Bad request'];
    return fail(res, status, message);
  }
  return created(res, r);
}));
router.delete('/customers/:id', need('delete'), asyncHandler(async (req, res) => {
  const r = await service.removeCustomer(req.user.org_id, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r);
}));

// leads
router.get('/leads', need('leads'), asyncHandler(async (req, res) => ok(res, await service.listLeads(req.user.org_id, z.object({ stage: z.enum(service.LEAD_STAGES).optional(), q: z.string().max(100).optional(), followup: z.enum(['due']).optional() }).parse(req.query)))));
router.post('/leads', need('leadsEdit'), asyncHandler(async (req, res) => created(res, (await service.createLead(req.user.org_id, req.user, service.leadSchema.parse(req.body || {}))).lead)));
router.patch('/leads/:id', need('leadsEdit'), asyncHandler(async (req, res) => {
  const r = await service.updateLead(req.user.org_id, req.user, uuid.parse(req.params.id), service.leadUpdateSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.lead);
}));
router.get('/leads/:id/notes', need('leads'), asyncHandler(async (req, res) => {
  const r = await service.listLeadNotes(req.user.org_id, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r.notes);
}));
router.post('/leads/:id/notes', need('leadsEdit'), asyncHandler(async (req, res) => {
  const r = await service.addLeadNote(req.user.org_id, req.user, uuid.parse(req.params.id), service.leadNoteSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r);
}));
router.post('/leads/:id/convert', need('customersEdit', 'leadsEdit'), asyncHandler(async (req, res) => {
  const r = await service.convertLead(req.user.org_id, req.user, uuid.parse(req.params.id), service.convertSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r);
}));
router.delete('/leads/:id', need('delete'), asyncHandler(async (req, res) => {
  const r = await service.removeLead(req.user.org_id, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r);
}));

// invoices, payments and collection follow-ups
router.get('/invoices', need('invoices'), asyncHandler(async (req, res) => ok(res, await service.listInvoices(req.user.org_id, z.object({ customer_id: uuid.optional(), filter: z.enum(['open', 'overdue', 'followup_due', 'no_due_date', 'paid']).optional(), q: z.string().max(100).optional() }).parse(req.query)))));
router.post('/invoices', need('invoicesEdit'), asyncHandler(async (req, res) => {
  const r = await service.createInvoice(req.user.org_id, req.user, service.invoiceSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.invoice);
}));
router.patch('/invoices/:id', need('invoicesEdit'), asyncHandler(async (req, res) => {
  const r = await service.updateInvoice(req.user.org_id, uuid.parse(req.params.id), service.invoiceUpdateSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.invoice);
}));
router.post('/invoices/:id/cancel', need('invoicesEdit'), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body || {});
  const r = await service.cancelInvoice(req.user.org_id, uuid.parse(req.params.id), reason);
  return r.error ? problem(res, r) : ok(res, r.invoice);
}));
router.get('/invoices/:id/payments', need('invoices'), asyncHandler(async (req, res) => {
  const r = await service.listPayments(req.user.org_id, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r.payments);
}));
router.post('/invoices/:id/payments', need('invoicesEdit'), asyncHandler(async (req, res) => {
  const r = await service.addPayment(req.user.org_id, req.user, uuid.parse(req.params.id), service.paymentSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.invoice);
}));
router.delete('/invoices/:id/payments/:paymentId', need('invoicesEdit'), asyncHandler(async (req, res) => {
  const r = await service.removePayment(req.user.org_id, uuid.parse(req.params.id), uuid.parse(req.params.paymentId));
  return r.error ? problem(res, r) : ok(res, r.invoice);
}));
router.patch('/invoices/:id/collection', need('invoicesEdit'), asyncHandler(async (req, res) => {
  const r = await followups.setTerms('dox_invoice', { orgId: req.user.org_id }, uuid.parse(req.params.id), followups.termsSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.terms);
}));
router.get('/invoices/:id/followups', need('invoices'), asyncHandler(async (req, res) => {
  const r = await followups.list('dox_invoice', { orgId: req.user.org_id }, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r);
}));
router.post('/invoices/:id/followups', need('invoicesEdit'), asyncHandler(async (req, res) => {
  const r = await followups.add('dox_invoice', { orgId: req.user.org_id }, req.user, uuid.parse(req.params.id), followups.followupSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.followup);
}));

module.exports = router;
