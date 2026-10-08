const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./analytics.service');
const live = require('../calculations/live.service');
const records = require('../calculations/records.service');

// Real-time analytics for the operating company. Admin-only: this is the
// money view (salaries, margins, vendor payables). Master-workspace only —
// part of the recruitment/strategic layer other group companies don't use.
const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace, authorize('admin'));

const orgId = (req) => req.user.org_id;

// --- Live Analytics (attendance / timesheet based; locked months are served
//     from their locked version — see calculations/live.service.js). ---
router.get('/billing', asyncHandler(async (req, res) => ok(res, await live.billingOverview(orgId(req), live.billingQuerySchema.parse(req.query)))));
router.get(
  '/billing/projects/:id',
  asyncHandler(async (req, res) => {
    const result = await live.billingProject(orgId(req), req.params.id, live.billingQuerySchema.parse(req.query));
    return result.error ? fail(res, 404, 'Project not found') : ok(res, result);
  })
);
router.get('/salary-attendance', asyncHandler(async (req, res) => ok(res, await live.salaryLive(orgId(req), live.salaryQuerySchema.parse(req.query)))));
router.get('/resource-revenue', asyncHandler(async (req, res) => ok(res, await live.resourceRevenueLive(orgId(req), live.resourceQuerySchema.parse(req.query)))));
router.get('/vendor-payments', asyncHandler(async (req, res) => ok(res, await live.vendorPaymentsLive(orgId(req), live.vendorQuerySchema.parse(req.query)))));
router.get('/vendor-payments/records', asyncHandler(async (req, res) => ok(res, await live.vendorPaymentRecords(orgId(req), live.monthSchema.partial().parse(req.query)))));
// Expense records of a month (approved claims + group charges), each lockable.
router.get('/expense-records', asyncHandler(async (req, res) => ok(res, await records.expenseRecords(orgId(req), live.monthSchema.parse(req.query)))));
router.get('/financial-month', asyncHandler(async (req, res) => ok(res, await live.financialMonthLive(orgId(req), live.monthSchema.parse(req.query)))));

// --- Previous Live Analytics reports. No longer shown in the UI (replaced by
//     the attendance/timesheet-based reports above) but kept working, not
//     deleted, so nothing that still calls them breaks. ---
router.get('/live-sales', asyncHandler(async (req, res) => ok(res, await service.liveSales(orgId(req), service.liveQuerySchema.parse(req.query)))));
router.get('/revenue-by-client', asyncHandler(async (req, res) => ok(res, await service.revenueByClient(orgId(req), service.rangeSchema.parse(req.query)))));
router.get('/revenue-by-resource', asyncHandler(async (req, res) => ok(res, await service.resourceRevenue(orgId(req), service.rangeSchema.parse(req.query)))));
router.get('/salary', asyncHandler(async (req, res) => ok(res, await service.salaryTrend(orgId(req), service.monthsQuerySchema.parse(req.query)))));
router.get('/expenses', asyncHandler(async (req, res) => ok(res, await service.expenseAnalysis(orgId(req), service.monthsQuerySchema.parse(req.query)))));
router.get('/vendors', asyncHandler(async (req, res) => ok(res, await service.vendorSummary(orgId(req)))));

router.get('/resource-mappings', asyncHandler(async (req, res) => ok(res, await service.listMappings(orgId(req)))));
router.post(
  '/resource-mappings',
  asyncHandler(async (req, res) => {
    const result = await service.createMapping(orgId(req), req.user.id, service.mappingSchema.parse(req.body));
    if (result.error === 'membership_not_found') return fail(res, 404, 'Both resources must be members of this organization');
    if (result.error === 'account_not_found') return fail(res, 404, 'Account not found');
    return created(res, result.mapping);
  })
);
router.delete(
  '/resource-mappings/:id',
  asyncHandler(async (req, res) => {
    const result = await service.deleteMapping(orgId(req), req.params.id);
    return result.error ? fail(res, 404, 'Mapping not found') : ok(res, { deleted: true });
  })
);

module.exports = router;
