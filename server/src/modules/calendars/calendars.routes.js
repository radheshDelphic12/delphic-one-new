const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./calendars.service');
const {
  createCalendarSchema,
  updateCalendarSchema,
  addHolidaySchema,
  updateHolidaySchema,
  assignCalendarSchema,
  createProjectSchema,
  setProjectCalendarSchema,
} = require('./calendars.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await service.list(req.user.org_id);
    return ok(res, rows);
  })
);

// Project <-> Calendar mapping (People → Calendar section). Declared before
// the '/:id' routes so 'projects' is never read as a calendar id.
router.get(
  '/projects',
  asyncHandler(async (req, res) => {
    const rows = await service.listProjects(req.user.org_id);
    return ok(res, rows);
  })
);

// Client-name picker for Add / Edit Project: this org's Lead accounts.
router.get(
  '/projects/client-options',
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await service.listLeadClientOptions(req.user.org_id)))
);

router.post(
  '/projects',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createProjectSchema.parse(req.body);
    const result = await service.createProject(req.user.org_id, req.user.id, body);
    if (result.error === 'client_not_lead') return fail(res, 422, 'Client must be one of this company\'s Lead accounts');
    if (result.error === 'category_not_available') return fail(res, 422, 'Recruitment projects are not available yet — choose Manage Services or Projects');
    if (result.error === 'name_taken') return fail(res, 409, 'A project with that name already exists');
    if (result.error === 'calendar_not_found') return fail(res, 404, 'Calendar not found');
    if (result.error === 'no_calendar_available') return fail(res, 422, 'Create a calendar first — every project must be mapped to one');
    return created(res, result.project);
  })
);

router.put(
  '/projects/:accountId',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { calendar_id } = setProjectCalendarSchema.parse(req.body);
    const result = await service.setProjectCalendar(req.user.org_id, req.params.accountId, calendar_id);
    if (result.error === 'project_not_found') return fail(res, 404, 'Project not found');
    if (result.error === 'calendar_not_found') return fail(res, 404, 'Calendar not found');
    return ok(res, result.project);
  })
);

router.post(
  '/',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createCalendarSchema.parse(req.body);
    const result = await service.create(req.user.org_id, body);
    if (result.error === 'location_not_found') return fail(res, 404, 'Location not found');
    return created(res, result.calendar);
  })
);

router.patch(
  '/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = updateCalendarSchema.parse(req.body);
    const result = await service.update(req.user.org_id, req.params.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Calendar not found');
    if (result.error === 'location_not_found') return fail(res, 404, 'Location not found');
    return ok(res, result.calendar);
  })
);

router.delete(
  '/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.remove(req.user.org_id, req.params.id);
    if (result.error === 'not_found') return fail(res, 404, 'Calendar not found');
    if (result.error === 'in_use') {
      return fail(res, 409, `This calendar is still mapped to ${result.count} employee(s)/project(s) — reassign them to a different calendar first`);
    }
    return ok(res, { deleted: true });
  })
);

router.get(
  '/:id/holidays',
  asyncHandler(async (req, res) => {
    const result = await service.listHolidays(req.user.org_id, req.params.id);
    if (result.error === 'not_found') return fail(res, 404, 'Calendar not found');
    return ok(res, result.holidays);
  })
);

router.get(
  '/:id/holidays/export',
  asyncHandler(async (req, res) => {
    const result = await service.buildHolidaysWorkbook(req.user.org_id, req.params.id);
    if (result.error === 'not_found') return fail(res, 404, 'Calendar not found');
    const safeName = result.calendar.name.replace(/[^\w.-]+/g, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-holidays.xlsx"`);
    await result.workbook.xlsx.write(res);
    return res.end();
  })
);

router.post(
  '/:id/holidays',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = addHolidaySchema.parse(req.body);
    const result = await service.addHoliday(req.user.org_id, req.params.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Calendar not found');
    if (result.error === 'already_exists') return fail(res, 409, 'Holiday already exists on that date');
    return created(res, result.holiday);
  })
);

router.patch(
  '/:id/holidays/:holidayId',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = updateHolidaySchema.parse(req.body);
    const result = await service.updateHoliday(req.user.org_id, req.params.id, req.params.holidayId, body);
    if (result.error === 'not_found') return fail(res, 404, 'Calendar not found');
    if (result.error === 'holiday_not_found') return fail(res, 404, 'Holiday not found');
    if (result.error === 'already_exists') return fail(res, 409, 'Another holiday already exists on that date');
    return ok(res, result.holiday);
  })
);

router.delete(
  '/:id/holidays/:holidayId',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.removeHoliday(req.user.org_id, req.params.id, req.params.holidayId);
    if (result.error === 'not_found') return fail(res, 404, 'Calendar not found');
    if (result.error === 'holiday_not_found') return fail(res, 404, 'Holiday not found');
    return ok(res, { deleted: true });
  })
);

router.post(
  '/:id/assign',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { org_membership_id, account_id } = assignCalendarSchema.parse(req.body);
    const result = await service.assign(req.user.org_id, req.params.id, org_membership_id, account_id || null);
    if (result.error === 'calendar_not_found') return fail(res, 404, 'Calendar not found');
    if (result.error === 'membership_not_found') return fail(res, 404, 'Org membership not found');
    if (result.error === 'account_not_found') return fail(res, 404, 'Account not found');
    return ok(res, result.assignment);
  })
);

router.get(
  '/assignments/:orgMembershipId',
  asyncHandler(async (req, res) => {
    const rows = await service.listAssignments(req.user.org_id, req.params.orgMembershipId);
    return ok(res, rows);
  })
);

module.exports = router;
