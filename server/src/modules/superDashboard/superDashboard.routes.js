const express = require('express');
const { authenticate, authorizeGroupSuperadmin } = require('../../middleware/auth');
const { ok } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const profitabilityService = require('../profitability/profitability.service');
const superDashboardService = require('./superDashboard.service');
const { computeSchema, rollupQuerySchema, financialsRollupQuerySchema } = require('./superDashboard.validation');
const financialsService = require('../financials/financials.service');
const groupFinance = require('./groupFinance.service');
const { fail } = require('../../utils/response');

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

// Group Dashboard: consolidated + per-company revenue, expenses, profit, assets and valuation, with trends,
// contribution, rankings and alerts. Reads each company's own finance service (see groupFinance.service).
router.get(
  '/group/overview',
  asyncHandler(async (req, res) => ok(res, await groupFinance.overview(req.user.org_group_ids, req.query)))
);

router.get(
  '/group/activity',
  asyncHandler(async (req, res) => ok(res, await groupFinance.activity(req.user.org_group_ids, Number(req.query.limit) || 30, Number(req.query.days) || 7)))
);

// Monthly asset value per company (history kept, a revised month is audited with the previous value).
router.get(
  '/companies/:orgId/asset-values',
  asyncHandler(async (req, res) => {
    const org = await groupFinance.companyInGroup(req.user.org_group_ids, req.params.orgId);
    if (!org) return fail(res, 404, 'Company not found');
    return ok(res, await groupFinance.listAssetValues(org));
  })
);

router.get(
  '/companies/:orgId/drilldown',
  asyncHandler(async (req, res) => {
    const org = await groupFinance.companyInGroup(req.user.org_group_ids, req.params.orgId);
    if (!org) return fail(res, 404, 'Company not found');
    return ok(res, await groupFinance.drilldown(org, req.query));
  })
);

router.put(
  '/companies/:orgId/asset-values',
  asyncHandler(async (req, res) => {
    const body = groupFinance.assetBodySchema.parse(req.body);
    const result = await groupFinance.setAssetValue(req.user.org_group_ids, req.user.id, req.params.orgId, body);
    if (result.error === 'not_found') return fail(res, 404, 'Company not found');
    if (result.error === 'managed_in_company') return fail(res, 422, 'Acconcy asset value is calculated from its Assets and Investments; edit them in the Acconcy workspace');
    if (result.error === 'future_month') return fail(res, 422, 'An asset value can only be recorded for the current or an earlier month');
    return ok(res, result);
  })
);

module.exports = router;
