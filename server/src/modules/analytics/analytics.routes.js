const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./analytics.service');

// Real-time analytics for the operating company. Admin-only: this is the
// money view (salaries, margins, vendor payables). Master-workspace only —
// part of the recruitment/strategic layer other group companies don't use.
const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace, authorize('admin'));

const orgId = (req) => req.user.org_id;

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
