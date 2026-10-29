const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const prisma = require('../../config/db');
const service = require('./attendanceDashboard.service');
const v = require('./attendanceDashboard.validation');
const projectCalendar = require('./projectCalendar.service');
const locationCheckin = require('../locationCheckin/locationCheckin.service');
const { hasPermission } = require('../../lib/permissions');
const { isMasterWorkspace } = require('../../middleware/requireMasterWorkspace');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

const ERRORS = {
  member_not_found: [404, 'Employee not found in this organization'],
  location_not_found: [404, 'Office not found'],
  no_attendance: [422, 'Contractors and vendor resources have no attendance'],
  forbidden: [403, 'You cannot do this for that employee'],
  remote_is_home: [422, 'A remote employee works from home by default'],
  not_found: [404, 'Request not found'],
  account_not_found: [404, 'Project not found'],
  project_not_assigned: [403, 'You are not assigned to this project'],
  already_decided: [409, 'This request was already decided'],
  too_far: [422, 'You can apply for work from home up to 3 months ahead'],
  end_before_start: [422, 'The end date cannot be before the start date'],
  no_working_days: [422, 'There is no working day in that range'],
};
const failFor = (res, code) => fail(res, ...(ERRORS[code] || [400, code]));

// Same visibility as the Timesheet Dashboard: an admin everyone, a manager their direct reports, anyone themselves.
async function canOpen(req, orgMembershipId) {
  const own = req.user.org_membership_id;
  if (!orgMembershipId || orgMembershipId === own || req.user.role === 'admin') return true;
  const member = await prisma.orgMembership.findFirst({ where: { id: orgMembershipId, org_id: req.user.org_id }, select: { manager_id: true } });
  return Boolean(member && member.manager_id === own);
}

// The month register. In the master workspace it also carries where each person checked in (display only; ?checkin=0 leaves it out).
// Check-ins are shown for everyone to people who may read the Workplace Check-in report, and only on their own row to everyone else.
router.get('/register', asyncHandler(async (req, res) => {
  const data = await service.register(req.user.org_id, req.user, v.peopleQuery.parse(req.query));
  if (req.query.checkin !== '0' && (await isMasterWorkspace(req.user.org_id))) {
    const decided = hasPermission(req.user, 'location_checkin.view');
    const everyone = decided === null ? req.user.role === 'admin' : decided;
    await locationCheckin.attachToRegister(req.user.org_id, data, { ownMembershipId: everyone ? null : req.user.org_membership_id });
  }
  return ok(res, data);
}));
router.get('/people', asyncHandler(async (req, res) => ok(res, await service.people(req.user.org_id, req.user, v.peopleQuery.parse(req.query)))));

router.get(
  '/calendar',
  asyncHandler(async (req, res) => {
    const { year, month, org_membership_id } = v.calendarQuery.parse(req.query);
    if (!(await canOpen(req, org_membership_id))) return failFor(res, 'forbidden');
    const result = await service.calendar(req.user.org_id, org_membership_id || req.user.org_membership_id, { year, month });
    if (result.error) return failFor(res, result.error);
    // The client does not know its own membership id, so say whether this calendar is the caller's own.
    result.member.is_self = result.member.org_membership_id === req.user.org_membership_id;
    return ok(res, result);
  })
);

router.get(
  '/offices/:membershipId',
  asyncHandler(async (req, res) => {
    if (!(await canOpen(req, req.params.membershipId))) return failFor(res, 'forbidden');
    return ok(res, await service.officeHistory(req.user.org_id, req.params.membershipId));
  })
);
router.post(
  '/offices',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.setOffice(req.user.org_id, req.user.id, v.setOfficeSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return created(res, result.row);
  })
);

router.post(
  '/place',
  asyncHandler(async (req, res) => {
    const result = await service.requestPlace(req.user.org_id, req.user, v.requestPlaceSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return created(res, result);
  })
);
router.get('/place/pending', asyncHandler(async (req, res) => ok(res, await service.pendingPlaces(req.user.org_id, req.user))));
router.post(
  '/place/:id/decide',
  asyncHandler(async (req, res) => {
    const result = await service.decidePlace(req.user.org_id, req.user, req.params.id, v.decidePlaceSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.row);
  })
);

// Project Calendar: the projects the caller may open, and one project's month as a calendar.
router.get('/projects', asyncHandler(async (req, res) => ok(res, await projectCalendar.listProjects(req.user.org_id, req.user, v.monthQuery.parse(req.query)))));
router.get(
  '/projects/:id/calendar',
  asyncHandler(async (req, res) => {
    const result = await projectCalendar.calendar(req.user.org_id, req.user, req.params.id, v.monthQuery.parse(req.query));
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);

module.exports = router;
