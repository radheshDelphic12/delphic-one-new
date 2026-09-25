const express = require('express');
const { authenticate, authorizeGroupSuperadmin } = require('../../middleware/auth');
const { ok } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const profitabilityService = require('../profitability/profitability.service');
const superDashboardService = require('./superDashboard.service');
const { computeSchema, rollupQuerySchema, financialsRollupQuerySchema } = require('./superDashboard.validation');
const financialsService = require('../financials/financials.service');

// HLD §7: a single cross-org read API, org_id-agnostic by design, gated to
// authorizeGroupSuperadmin only — deliberately never requireOrgMembership
// (this isn't a self-org action), mirroring the orgs module's `GET /orgs`.
// Reads exclusively from DailyEmployeeProfitability via
// profitability.service.rollup, never live OLTP tables directly.
const router = express.Router();
router.use(authenticate, authorizeGroupSuperadmin);

router.post(
  '/compute',
  asyncHandler(async (req, res) => {
    const { date_from, date_to } = computeSchema.parse(req.body);
    const result = await profitabilityService.computeAllOrgsForDateRange(date_from, date_to, req.user.org_group_ids);
    return ok(res, result);
  })
);

router.get(
  '/rollup',
  asyncHandler(async (req, res) => {
    const { from, to, group_by, org_id } = rollupQuerySchema.parse(req.query);
    // Per-company drill-in reuses the exact same rollup — org_id just stops
    // being fixed to "mine" (HLD §7). Omitted, it's a group-wide total.
    const rows = await profitabilityService.rollup({
      orgId: org_id,
      orgGroupIds: req.user.org_group_ids,
      from,
      to,
      groupBy: group_by,
    });
    return ok(res, rows);
  })
);

router.get(
  '/subsidiaries',
  asyncHandler(async (req, res) => {
    const rows = await superDashboardService.listSubsidiaries(req.user.org_group_ids);
    return ok(res, rows);
  })
);

router.get(
  '/financials-rollup',
  asyncHandler(async (req, res) => {
    const { from, to, group_by, org_id } = financialsRollupQuerySchema.parse(req.query);
    const rows = await superDashboardService.financialsRollup({
      orgId: org_id,
      orgGroupIds: req.user.org_group_ids,
      from,
      to,
      groupBy: group_by,
    });
    return ok(res, rows);
  })
);

// Live projections + dynamic valuation for every active company in the group.
router.get(
  '/projections',
  asyncHandler(async (req, res) => {
    const opts = financialsService.projectionQuerySchema.parse(req.query);
    return ok(res, await financialsService.groupProjection(req.user.org_group_ids, opts));
  })
);

module.exports = router;
