const express = require('express');
const { can } = require('../../lib/permissions');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./contractorCheckin.service');
const v = require('./contractorCheckin.validation');

// Contractor check-in: Delphic Global only (the master workspace). A contractor clocks in and out and sees their own history; HR and
// admins read the report. No location is collected anywhere in this module.
const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace);

const ERRORS = {
  not_eligible: [403, 'Check-in here is for contractors'],
  already_checked_in: [409, 'You are already checked in'],
  not_checked_in: [409, 'Check in first'],
  bad_times: [422, 'The check-out must be after the check-in'],
  wrong_day: [422, 'The check-in must stay on the same day'],
  overlap: [409, 'This overlaps another check-in of the same day'],
  range_too_long: [422, 'Pick a range of up to 93 days'],
  not_found: [404, 'Not found'],
};
const failFor = (res, code) => fail(res, ...(ERRORS[code] || [400, code]));

// ----- Contractor -----
router.get('/today', asyncHandler(async (req, res) => ok(res, await service.today(req.user))));

router.post(
  '/check-in',
  asyncHandler(async (req, res) => {
    const result = await service.checkIn(req.user);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.day);
  })
);

router.post(
  '/check-out',
  asyncHandler(async (req, res) => {
    const result = await service.checkOut(req.user);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.day);
  })
);

router.get('/mine', asyncHandler(async (req, res) => ok(res, await service.listMine(req.user, v.rangeQuery.parse(req.query)))));

// ----- Report (HR / admin) -----
router.get('/people', can('location_checkin.view', 'admin'), asyncHandler(async (req, res) => ok(res, await service.people(req.user.org_id))));

router.get(
  '/report',
  can('location_checkin.view', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.report(req.user.org_id, v.reportQuery.parse(req.query));
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);

router.get(
  '/report.csv',
  can('location_checkin.view', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.report(req.user.org_id, v.reportQuery.parse(req.query));
    if (result.error) return failFor(res, result.error);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contractor-checkin-report.csv"');
    return res.send(service.toCsv(result.rows));
  })
);

// ----- Correct or remove a session (admin; a reason is required and audited) -----
router.patch(
  '/sessions/:id',
  can('hr_settings.update', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.updateSession(req.user, req.params.id, v.sessionEditSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.session);
  })
);
router.delete(
  '/sessions/:id',
  can('hr_settings.update', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.deleteSession(req.user, req.params.id, v.removeSchema.parse(req.body || {}).reason);
    if (result.error) return failFor(res, result.error);
    return ok(res, { deleted: true });
  })
);

module.exports = router;
