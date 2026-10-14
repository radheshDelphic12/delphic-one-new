const express = require('express');
const { authenticate, authorizeGroupSuperadmin } = require('../../middleware/auth');
const { ok } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const profitabilityService = require('../profitability/profitability.service');
const superDashboardService = require('./superDashboard.service');
const { computeSchema, rollupQuerySchema, financialsRollupQuerySchema } = require('./superDashboard.validation');
const financialsService = require('../financials/financials.service');
const groupFinance = require('./groupFinance.service');
const groupTasks = require('./groupTasks.service');
const groupTravel = require('./groupTravel.service');
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
  '/group/projection',
  asyncHandler(async (req, res) => ok(res, await groupFinance.projection(req.user.org_group_ids, req.query)))
);

// --- Group task management: one-time and recurring tasks across the companies, and the weekly company-day table ---
const TASK_ERRORS = {
  not_found: [404, 'Task not found'],
  company_not_found: [422, 'That company is not in this group'],
  due_date_required: [422, 'A one-time task needs a due date'],
  frequency_required: [422, 'A recurring task needs a frequency'],
  start_date_required: [422, 'A recurring task needs a start date'],
  weekdays_required: [422, 'Pick at least one weekday for a weekly task'],
  bad_dates: [422, 'The end date must be on or after the start date'],
  bad_date: [422, 'Use YYYY-MM-DD'],
  not_an_occurrence: [422, 'That task does not fall due on that date'],
};
const taskResult = (res, r, key, status = 200) => {
  if (r.error) { const m = TASK_ERRORS[r.error] || [400, 'Bad request']; return fail(res, m[0], m[1]); }
  return key ? ok(res, r[key], {}, status) : ok(res, r, {}, status);
};
// --- Group travel: trips by anyone in the group, one total budget, linked to Delphic Global meetings ---
const TRAVEL_ERRORS = {
  not_found: [404, 'Trip not found'],
  company_not_found: [422, 'That company is not in this group'],
  bad_dates: [422, 'The end date must be on or after the start date'],
  bad_date: [422, 'Enter a valid date and time'],
  bad_meeting: [422, 'Not a valid calendar meeting'],
  meeting_not_found: [404, 'That meeting no longer exists'],
  client_not_found: [422, 'Pick an active Delphic Global client'],
};
const travelResult = (res, r, key, status = 200) => {
  if (r.error) { const m = TRAVEL_ERRORS[r.error] || [400, 'Bad request']; return fail(res, m[0], m[1]); }
  return key ? ok(res, r[key], {}, status) : ok(res, r, {}, status);
};
router.get('/group/travel', asyncHandler(async (req, res) => ok(res, await groupTravel.list(req.user.org_group_ids, req.query))));
router.get('/group/travel/options',asyncHandler(async (req, res) => ok(res, await groupTravel.options(req.user.org_group_ids))));
router.get('/group/travel/:id', asyncHandler(async (req, res) => {
  const trip = await groupTravel.one(req.user.org_group_ids, req.params.id);
  return trip ? ok(res, trip) : fail(res, 404, 'Trip not found');
}));
router.post('/group/travel', asyncHandler(async (req, res) => travelResult(res, await groupTravel.create(req.user.org_group_ids, req.user.id, req.body), 'trip', 201)));
router.patch('/group/travel/:id', asyncHandler(async (req, res) => travelResult(res, await groupTravel.update(req.user.org_group_ids, req.user.id, req.params.id, req.body), 'trip')));
router.delete('/group/travel/:id', asyncHandler(async (req, res) => travelResult(res, await groupTravel.remove(req.user.org_group_ids, req.user.id, req.params.id))));
router.post('/group/travel/:id/meetings', asyncHandler(async (req, res) => travelResult(res, await groupTravel.linkMeeting(req.user.org_group_ids, req.user.id, req.params.id, req.body?.meeting_key), 'trip', 201)));
router.post('/group/travel/:id/meetings/new', asyncHandler(async (req, res) => travelResult(res, await groupTravel.createMeeting(req.user.org_group_ids, req.user.id, req.params.id, req.body), 'trip', 201)));
router.delete('/group/travel/:id/meetings/:key', asyncHandler(async (req, res) => travelResult(res, await groupTravel.unlinkMeeting(req.user.org_group_ids, req.user.id, req.params.id, req.params.key), 'trip')));

router.get('/group/tasks', asyncHandler(async (req, res) => ok(res, await groupTasks.listMonth(req.user.org_group_ids, req.query))));
router.get('/group/tasks/upcoming', asyncHandler(async (req, res) => ok(res, await groupTasks.upcoming(req.user.org_group_ids, req.query))));
router.post('/group/tasks', asyncHandler(async (req, res) => taskResult(res, await groupTasks.create(req.user.org_group_ids, req.user.id, req.body), 'task', 201)));
router.patch('/group/tasks/:id', asyncHandler(async (req, res) => taskResult(res, await groupTasks.update(req.user.org_group_ids, req.user.id, req.params.id, req.body), 'task')));
router.delete('/group/tasks/:id', asyncHandler(async (req, res) => taskResult(res, await groupTasks.remove(req.user.org_group_ids, req.user.id, req.params.id))));
router.put('/group/tasks/:id/occurrences/:date', asyncHandler(async (req, res) => taskResult(res, await groupTasks.setDone(req.user.org_group_ids, req.user.id, req.params.id, req.params.date, req.body))));
router.get('/group/weekly-plan', asyncHandler(async (req, res) => ok(res, await groupTasks.weeklyPlan(req.user.org_group_ids, req.query))));
router.put('/group/weekly-plan', asyncHandler(async (req, res) => { const r = await groupTasks.setWeeklyPlan(req.user.org_group_ids, req.user.id, req.body); return r.error ? taskResult(res, r) : ok(res, r); }));

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
    if (result.error === 'managed_in_company') return fail(res, 422, "This company's asset value is calculated inside its own workspace (Acconcy: assets and investments; Gulati Foundation: the fund balance); change it there");
    if (result.error === 'future_month') return fail(res, 422, 'An asset value can only be recorded for the current or an earlier month');
    return ok(res, result);
  })
);

module.exports = router;
