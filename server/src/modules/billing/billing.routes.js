const express = require('express');
const { authenticate, authorize, authorizeGroupSuperadmin, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./billing.service');
const pnlService = require('./projectPnl.service');
const { WORKER_ERRORS } = require('../../lib/workerType');
const {
  createRateSchema,
  listRatesQuerySchema,
  computeDailyRevenueSchema,
  listDailyRevenueQuerySchema,
  createInvoiceSchema,
  listInvoicesQuerySchema,
  transitionInvoiceSchema,
  createGroupChargeSchema,
  createOwnGroupChargeSchema,
  listMyGroupChargesQuerySchema,
  listAllGroupChargesQuerySchema,
  costAssignmentSchema,
  listCostAssignmentsQuerySchema,
  accountBudgetQuerySchema,
  updateProjectProfileSchema,
  periodQuerySchema,
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
  invalid_transition: [409, 'Invalid status transition'],
  org_not_found: [404, 'Org not found'],
  membership_not_found: [404, 'Employee not found in this org'],
  name_taken: [409, 'A project with that name already exists'],
  client_not_lead: [422, 'Client must be one of this company\'s client accounts'],
  vendor_not_found: WORKER_ERRORS.vendor_not_found,
};

function failFor(res, error, result) {
  if (error === 'before_agreement_start') {
    return fail(res, 422, `That period ends before the client agreement starts (${result?.agreement_start}) — nothing is billed before the Agreement Start Date`);
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
  asyncHandler(async (req, res) => ok(res, await pnlService.listProjectsPnl(req.user.org_id, periodQuerySchema.parse(req.query))))
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

router.patch(
  '/vendor-invoices/:id',
  ...adminInOrg,
  asyncHandler(async (req, res) => {
    const result = await pnlService.updateVendorInvoice(req.user.org_id, req.params.id, updateVendorInvoiceSchema.parse(req.body));
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

router.post(
  '/invoices',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createInvoiceSchema.parse(req.body);
    const result = await service.createInvoice(req.user.org_id, req.user.id, body);
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
    const rows = await service.listInvoices(req.user.org_id, query);
    return ok(res, rows);
  })
);

router.get(
  '/invoices/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.getInvoice(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
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

router.post(
  '/cost-assignments',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = costAssignmentSchema.parse(req.body);
    const result = await service.upsertCostAssignment(req.user.org_id, req.user.id, body);
    if (result.error) return failFor(res, result.error);
    return created(res, result.assignment);
  })
);

router.delete(
  '/cost-assignments/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.removeCostAssignment(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, { deleted: true });
  })
);

router.get(
  '/cost-assignments',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { account_id } = listCostAssignmentsQuerySchema.parse(req.query);
    const rows = await service.listCostAssignments(req.user.org_id, account_id);
    return ok(res, rows);
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
