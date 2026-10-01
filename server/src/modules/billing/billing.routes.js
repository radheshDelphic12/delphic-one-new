const express = require('express');
const { authenticate, authorize, authorizeGroupSuperadmin, authorizeSuperadmin, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./billing.service');
const pnlService = require('./projectPnl.service');
const invoices = require('./invoices.service');
const adjustments = require('./adjustments.service');
const charges = require('./charges.service');
const exchangeRates = require('./exchangeRates.service');
const allocationsService = require('../allocations/allocations.service');
const { failFor: allocationsFailFor } = require('../allocations/allocations.routes');
const { WORKER_ERRORS } = require('../../lib/workerType');
const {
  exchangeRatesSchema,
  createRateSchema,
  listRatesQuerySchema,
  computeDailyRevenueSchema,
  listDailyRevenueQuerySchema,
  contractChargeSchema,
  updateContractChargeSchema,
  billingAdjustmentSchema,
  listBillingAdjustmentsQuerySchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  previewInvoiceQuerySchema,
  listInvoicesQuerySchema,
  vendorInvoicePeriodSchema,
  generateVendorInvoiceSchema,
  listVendorInvoicesQuerySchema,
  transitionInvoiceSchema,
  createGroupChargeSchema,
  createOwnGroupChargeSchema,
  updateGroupChargeSchema,
  listMyGroupChargesQuerySchema,
  listAllGroupChargesQuerySchema,
  costAssignmentSchema,
  listCostAssignmentsQuerySchema,
  accountBudgetQuerySchema,
  updateProjectProfileSchema,
  periodQuerySchema,
  pnlListQuerySchema,
  vendorInvoiceSchema,
  updateVendorInvoiceSchema,
} = require('./billing.validation');

const router = express.Router();
router.use(authenticate);

const ERRORS = {
  account_not_found: [404, 'Account not found'],
  requirement_not_found: [404, 'Requirement not found for that account'],
  not_found: [404, 'Not found'],
  invoice_exists: [409, 'An invoice already exists for that client and period'],
  no_revenue_computed: [422, 'No daily revenue computed for that account/period yet — run compute first'],
  invoice_sent: [409, 'The invoice for this project and month has already been sent — it can no longer be changed'],
  exchange_rate_missing: [422, 'No exchange rate is set for that currency - add it under Finance exchange rates'],
  percent_too_large: [422, 'A percentage cannot be above 100'],
  reason_required: [422, 'Give a reason to change an invoice that has already been sent or paid'],
  invoice_number_taken: [409, 'Another invoice already uses that invoice number'],
  nothing_to_invoice: [422, 'Nothing to invoice for that month — the amount is zero'],
  no_billing_rate: [422, 'This project has no billing rate for that month'],
  not_supported: [422, 'Invoicing is not enabled for this project type yet (fixed price / recruitment)'],
  change_detected: [409, 'The locked month has a detected change — recalculate or dismiss it first'],
  invalid_transition: [409, 'Invalid status transition'],
  org_not_found: [404, 'Org not found'],
  membership_not_found: [404, 'Employee not found in this org'],
  category_not_found: [404, 'Group charge category not found (or deactivated)'],
  location_not_found: [404, 'Office location not found'],
  charge_raised_by_group: [403, 'This charge was raised by the group — only a group superadmin can edit it'],
  client_not_lead: [422, 'Client must be one of this company\'s client accounts'],
  end_before_start: [422, 'The agreement end date cannot be before its start date'],
  catalogue_account_read_only: [409, 'This is a client account from the Accounts catalogue, so Finance can’t edit it. Add a project for this client (People → Calendars → Add Project) and set its billing there.'],
  vendor_not_found: WORKER_ERRORS.vendor_not_found,
};

function failFor(res, error, result) {
  if (error === 'before_agreement_start') {
    return fail(res, 422, `That period ends before the client agreement starts (${result?.agreement_start}) — nothing is billed before the Agreement Start Date`);
  }
  if (error === 'after_agreement_end') {
    return fail(res, 422, `That period starts after the client agreement ended (${result?.agreement_end}) — nothing is billed after the Agreement End Date`);
  }
  const mapped = ERRORS[error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

// Finance → Projects: monthly P&L (client billing - internal salary allocation
// - vendor contractor cost) and per-project vendor invoices. See
// projectPnl.service for the rules.
const adminInOrg = [requireOrgMembership, authorize('admin')];

router.get(
  '/vendors',
  ...adminInOrg,
  asyncHandler(async (req, res) => ok(res, await pnlService.listVendors(req.user.org_id)))
);

router.get(
  '/projects-pnl',
  ...adminInOrg,
  asyncHandler(async (req, res) => ok(res, await pnlService.listProjectsPnl(req.user.org_id, pnlListQuerySchema.parse(req.query))))
);

// INR value of each foreign currency, used to convert the P&L and project totals.
router.get(
  '/exchange-rates',
  ...adminInOrg,
  asyncHandler(async (req, res) => ok(res, await exchangeRates.listRates(req.user.org_id)))
);

router.put(
  '/exchange-rates',
  ...adminInOrg,
  asyncHandler(async (req, res) => ok(res, await exchangeRates.setRates(req.user.org_id, exchangeRatesSchema.parse(req.body).rates)))
);

router.get(
  '/projects/:id/pnl',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const result = await pnlService.computeProjectPnl(req.user.org_id, req.params.id, periodQuerySchema.parse(req.query));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.pnl);
  })
);

router.get(
  '/projects/:id/vendor-invoices',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const period = periodQuerySchema.partial().parse(req.query);
    return ok(res, await pnlService.listVendorInvoices(req.user.org_id, req.params.id, period));
  })
);

router.post(
  '/projects/:id/vendor-invoices',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const result = await pnlService.createVendorInvoice(req.user.org_id, req.user.id, req.params.id, vendorInvoiceSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return created(res, result.invoice);
  })
);

// Live Analytics → Vendors: generated vendor invoices (one per vendor and
// month, a row per project and currency).
router.get(
  '/vendor-invoices',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await invoices.listVendorInvoices(req.user.org_id, listVendorInvoicesQuerySchema.parse(req.query))))
);

router.get(
  '/vendor-invoices/preview',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { vendor_account_id, ...period } = vendorInvoicePeriodSchema.parse(req.query);
    const result = await invoices.previewVendorInvoice(req.user.org_id, vendor_account_id, period);
    if (result.error) return failFor(res, result.error, result);
    return ok(res, result.preview);
  })
);

router.post(
  '/vendor-invoices/generate',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = generateVendorInvoiceSchema.parse(req.body);
    const result = await invoices.generateVendorInvoice(req.user.org_id, req.user, body);
    if (result.error) return failFor(res, result.error, result);
    return created(res, result.invoices);
  })
);

router.patch(
  '/vendor-invoices/:id',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const result = await pnlService.updateVendorInvoice(req.user.org_id, req.params.id, updateVendorInvoiceSchema.parse(req.body), req.user.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.invoice);
  })
);

router.delete(
  '/vendor-invoices/:id',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const result = await pnlService.removeVendorInvoice(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, { deleted: true });
  })
);

// Finance → Projects (project profile: name, client, blank requirement, billing
// type, agreement start date). Registered first so '/projects' is not shadowed.
router.get(
  '/projects',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await service.listProjectProfiles(req.user.org_id)))
);

router.get(
  '/projects/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.getProjectProfile(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.profile);
  })
);

router.patch(
  '/projects/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = updateProjectProfileSchema.parse(req.body);
    const result = await service.updateProjectProfile(req.user.org_id, req.user.id, req.params.id, body);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.profile);
  })
);

router.post(
  '/rates',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createRateSchema.parse(req.body);
    const result = await service.createRate(req.user.org_id, req.user.id, body);
    if (result.error) return failFor(res, result.error);
    return created(res, result.billingRate);
  })
);

router.get(
  '/rates',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listRatesQuerySchema.parse(req.query);
    const rows = await service.listRates(req.user.org_id, query);
    return ok(res, rows);
  })
);

router.post(
  '/daily-revenue/compute',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { date_from, date_to } = computeDailyRevenueSchema.parse(req.body);
    const result = await service.computeRevenueRange(req.user.org_id, date_from, date_to);
    return ok(res, result);
  })
);

router.get(
  '/daily-revenue',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listDailyRevenueQuerySchema.parse(req.query);
    const rows = await service.listDailyRevenue(req.user.org_id, query);
    return ok(res, rows);
  })
);

// Contract charges - GST, TDS or any other line a contract's client invoices carry (percent or fixed,
// added or deducted, on the final approved amount). Added / edited / deleted one by one, audited.
router.get(
  '/projects/:id/charges',
  ...adminInOrg,
  asyncHandler(async (req, res) => ok(res, await charges.listCharges(req.user.org_id, req.params.id)))
);

router.post(
  '/projects/:id/charges',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const result = await charges.createCharge(req.user.org_id, req.user, req.params.id, contractChargeSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return created(res, result.charge);
  })
);

router.patch(
  '/charges/:id',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const result = await charges.updateCharge(req.user.org_id, req.user, req.params.id, updateContractChargeSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.charge);
  })
);

router.delete(
  '/charges/:id',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const result = await charges.removeCharge(req.user.org_id, req.user, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, { deleted: true });
  })
);

// Billing adjustments — an admin's + / - tweak to a project's month (reason required, audited).
router.get(
  '/adjustments',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const { account_id, ...period } = listBillingAdjustmentsQuerySchema.parse(req.query);
    return ok(res, await adjustments.listAdjustments(req.user.org_id, account_id, period));
  })
);

router.post(
  '/adjustments',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const { account_id, ...rest } = billingAdjustmentSchema.parse(req.body);
    const result = await adjustments.createAdjustment(req.user.org_id, req.user, account_id, rest);
    if (result.error) return failFor(res, result.error);
    return created(res, result.adjustment);
  })
);

router.delete(
  '/adjustments/:id',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const result = await adjustments.removeAdjustment(req.user.org_id, req.user, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, { deleted: true });
  })
);

// Client invoices — one builder (invoices.service) for every path: the
// project's contract month (its locked version when billing is locked).
router.post(
  '/invoices',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { client_account_id, ...body } = createInvoiceSchema.parse(req.body);
    const result = await invoices.generateClientInvoice(req.user.org_id, req.user, { account_id: client_account_id, ...body });
    if (result.error) return failFor(res, result.error, result);
    return created(res, result.invoice);
  })
);

router.get(
  '/invoices',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listInvoicesQuerySchema.parse(req.query);
    return ok(res, await invoices.listClientInvoices(req.user.org_id, query));
  })
);

// What an invoice for that project and month would contain (form preview).
router.get(
  '/invoices/preview',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { account_id, currency, ...period } = previewInvoiceQuerySchema.parse(req.query);
    const result = await invoices.previewClientInvoice(req.user.org_id, account_id, period, currency);
    if (result.error) return failFor(res, result.error, result);
    return ok(res, result.preview);
  })
);

router.get(
  '/invoices/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await invoices.getClientInvoice(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.invoice);
  })
);

router.patch(
  '/invoices/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await invoices.updateClientInvoice(req.user.org_id, req.user, req.params.id, updateInvoiceSchema.parse(req.body));
    if (result.error) return failFor(res, result.error, result);
    return ok(res, result.invoice);
  })
);

router.post(
  '/invoices/:id/status',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { status } = transitionInvoiceSchema.parse(req.body);
    const result = await service.transitionInvoice(req.user.org_id, req.params.id, status);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.invoice);
  })
);

router.post(
  '/group-charges',
  authorizeGroupSuperadmin,
  asyncHandler(async (req, res) => {
    const body = createGroupChargeSchema.parse(req.body);
    const result = await service.createGroupCharge(req.user.id, body);
    if (result.error) return failFor(res, result.error);
    return created(res, result.charge);
  })
);

// Finance → Group Charges "Add Group Expense" — admin of the current company,
// charged to that company. Raising against ANOTHER company stays group-superadmin only (above).
router.post(
  '/group-charges/mine',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createOwnGroupChargeSchema.parse(req.body);
    const result = await service.createGroupCharge(req.user.id, { ...body, org_id: req.user.org_id });
    if (result.error) return failFor(res, result.error);
    return created(res, result.charge);
  })
);

// Finance → Group Charges "Edit" — admin of the current company, on that company's charges.
router.patch(
  '/group-charges/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = updateGroupChargeSchema.parse(req.body);
    const result = await service.updateGroupCharge(req.user.org_id, req.user.id, req.params.id, body);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.charge);
  })
);

// Finance → Group Charges "Delete" — superadmin only, on the current company's charges.
router.delete(
  '/group-charges/:id',
  requireOrgMembership,
  authorizeSuperadmin,
  asyncHandler(async (req, res) => {
    const result = await service.deleteGroupCharge(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, { deleted: true });
  })
);

router.get(
  '/group-charges',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listMyGroupChargesQuerySchema.parse(req.query);
    const rows = await service.listMyGroupCharges(req.user.org_id, query);
    return ok(res, rows);
  })
);

router.get(
  '/group-charges/all',
  authorizeGroupSuperadmin,
  asyncHandler(async (req, res) => {
    const query = listAllGroupChargesQuerySchema.parse(req.query);
    const rows = await service.listAllGroupCharges(query);
    return ok(res, rows);
  })
);

// --- Module C: project costing (developer cost rate + live budget summary). ---

// Project team allocations — effective-dated spans (see allocations.service).
// POST creates one, or changes the one in force (from `effective_date` when
// given, else as a correction); DELETE removes one entered by mistake — to
// take someone OFF a project, end it (POST /allocations/:id/end) so history stays.
router.post(
  '/cost-assignments',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = costAssignmentSchema.parse(req.body);
    const result = await allocationsService.assign(req.user.org_id, req.user.id, body);
    if (result.error) return allocationsFailFor(res, result.error);
    return created(res, result.assignment);
  })
);

router.delete(
  '/cost-assignments/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await allocationsService.deleteAllocation(req.user.org_id, req.user.id, req.params.id);
    if (result.error) return allocationsFailFor(res, result.error);
    return ok(res, { deleted: true });
  })
);

router.get(
  '/cost-assignments',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { account_id, include_ended } = listCostAssignmentsQuerySchema.parse(req.query);
    return ok(res, await allocationsService.listForProject(req.user.org_id, account_id, { include_ended }));
  })
);

router.get(
  '/budget-summary',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { account_id } = accountBudgetQuerySchema.parse(req.query);
    const result = await service.getAccountBudgetSummary(req.user.org_id, account_id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);

module.exports = router;
