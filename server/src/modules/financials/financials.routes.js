const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./financials.service');

// Company financials tracking + planning. Master-workspace only — part of
// the strategic/recruitment layer other group companies don't use; every
// source table stays org-scoped regardless.
const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace, authorize('admin'));

router.get(
  '/monthly',
  asyncHandler(async (req, res) => {
    const { months } = service.monthsQuerySchema.parse(req.query);
    return ok(res, await service.monthlyActuals(req.user.org_id, months));
  })
);

// Financials page: Revenue, Profit and Valuation month on month.
router.get(
  '/trends',
  asyncHandler(async (req, res) => ok(res, await service.trends(req.user.org_id, service.trendsQuerySchema.parse(req.query))))
);

// The asset value recorded for a month (feeds Valuation).
router.put(
  '/asset-values',
  asyncHandler(async (req, res) => ok(res, await service.upsertAssetValue(req.user.org_id, req.user.id, service.assetValueSchema.parse(req.body))))
);

router.get(
  '/projection',
  asyncHandler(async (req, res) => {
    const result = await service.orgProjection(req.user.org_id, service.projectionQuerySchema.parse(req.query));
    return result.error ? fail(res, 404, 'Organization not found') : ok(res, result.projection);
  })
);

router.get(
  '/plan',
  asyncHandler(async (req, res) => ok(res, await service.planVsActual(req.user.org_id, service.planQuerySchema.parse(req.query))))
);

router.put(
  '/plan',
  asyncHandler(async (req, res) => {
    const line = service.planLineSchema.parse(req.body);
    return ok(res, await service.upsertPlanLine(req.user.org_id, req.user.id, line));
  })
);

router.delete(
  '/plan/:id',
  asyncHandler(async (req, res) => {
    const result = await service.deletePlanLine(req.user.org_id, req.params.id);
    return result.error ? fail(res, 404, 'Plan line not found') : ok(res, { deleted: true });
  })
);

module.exports = router;
