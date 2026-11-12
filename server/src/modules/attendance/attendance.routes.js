const express = require('express');
const { can } = require('../../lib/permissions');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./attendance.service');
const regularization = require('./attendanceRegularization.service');
const autoAttendance = require('./autoAttendance.service');
const attendanceDay = require('./attendanceDay.service');
const leaveService = require('../leave/leave.service');
const { listQuerySchema, regularizeSchema, deleteRecordSchema, createShiftSchema, manualEntrySchema, setDaySchema, importSchema, templateQuerySchema, backfillMonthSchema, regularizationRequestSchema, regularizationDecisionSchema, regularizationListQuerySchema } = require('./attendance.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.omit({ org_membership_id: true }).parse(req.query);
    const result = await service.listMine(req.user.org_id, req.user.org_membership_id, query);
    // calendar_days: holidays on the employee's calendar and approved leave in the range.
    return ok(res, result.data, { pagination: result.pagination, calendar_days: result.calendar_days });
  })
);

router.get(
  '/',
  can('attendance.approve', 'admin'),
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const result = await service.listTeam(req.user.org_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

// --- Regularization requests: an employee asks to correct a day, an admin decides. (Before the /:id routes.) ---
const REQUEST_ERRORS = {
  membership_not_found: [404, 'Employee not found'],
  no_attendance: [422, 'Contractors and vendor resources have no attendance'],
  future_date: [422, "You can't regularize a future date"],
  before_joining: [422, 'That date is before the employee joined'],
  checkout_without_checkin: [422, 'Give a check-in time along with the check-out time'],
  month_locked: [409, 'That month is locked for this employee: ask an admin to reopen it first'],
  duplicate_pending: [409, 'There is already a pending request for that date'],
  not_found: [404, 'Request not found'],
  already_decided: [409, 'This request was already decided'],
  leave_day: [422, 'The employee is on approved leave that day: cancel the leave first, or ask for the day to be recorded as leave'],
};
const failRequest = (res, error) => {
  const [code, message] = REQUEST_ERRORS[error] || [500, 'Unexpected error'];
  return fail(res, code, message);
};

router.post(
  '/regularization-requests',
  asyncHandler(async (req, res) => {
    const body = regularizationRequestSchema.parse(req.body);
    const result = await regularization.create(req.user.org_id, req.user, body);
    if (result.error) return failRequest(res, result.error);
    return created(res, result.request);
  })
);

router.get(
  '/regularization-requests/mine',
  asyncHandler(async (req, res) => ok(res, await regularization.listMine(req.user.org_id, req.user.org_membership_id)))
);

router.get(
  '/regularization-requests',
  can('attendance.approve', 'admin'),
  asyncHandler(async (req, res) => {
    const { status } = regularizationListQuerySchema.parse(req.query);
    return ok(res, await regularization.listAll(req.user.org_id, { status }), { pending: await regularization.pendingCount(req.user.org_id) });
  })
);

router.post(
  '/regularization-requests/:id/decision',
  can('attendance.approve', 'admin'),
  asyncHandler(async (req, res) => {
    const body = regularizationDecisionSchema.parse(req.body);
    const result = await regularization.decide(req.user.org_id, req.params.id, req.user, body);
    if (result.error) return failRequest(res, result.error);
    return ok(res, result.request);
  })
);

router.post(
  '/:id/regularize',
  can('attendance.approve', 'admin'),
  asyncHandler(async (req, res) => {
    const body = regularizeSchema.parse(req.body);
    const result = await service.regularize(req.user.org_id, req.params.id, req.user.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Attendance record not found');
    return ok(res, result.record);
  })
);

router.delete(
  '/:id',
  can('attendance.approve', 'admin'),
  asyncHandler(async (req, res) => {
    const body = deleteRecordSchema.parse(req.body || {});
    const result = await service.deleteRecord(req.user.org_id, req.params.id, req.user.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Attendance record not found');
    return ok(res, { deleted: true, flagged: result.flagged });
  })
);

// --- Backfill past attendance (admin): one day, or a whole sheet. ---
const BACKFILL_ERRORS = {
  membership_not_found: [404, 'Employee not found in this company'],
  future_date: [422, "You can't record attendance for a future date"],
  before_joining: [422, 'That date is before the employee joined'],
  leave_day: [422, 'The employee is on approved leave that day — record it as "leave" or cancel the leave first'],
  checkout_without_checkin: [422, 'Give a check-in time along with the check-out time'],
};

router.post(
  '/manual',
  can('attendance.approve', 'admin'),
  asyncHandler(async (req, res) => {
    const body = manualEntrySchema.parse(req.body);
    const result = await service.recordManualDay(req.user.org_id, req.user.id, body);
    if (result.error) {
      const [code, message] = BACKFILL_ERRORS[result.error] || [500, 'Unexpected error'];
      return fail(res, code, message);
    }
    return result.action === 'created' ? created(res, result.record) : ok(res, result.record);
  })
);

const DAY_ERRORS = {
  ...BACKFILL_ERRORS,
  leave_day: [422, 'This day has approved leave. Set it to Leave and pick the leave type to change which leave it is'],
  leave_type_required: [422, 'Pick the leave type'],
  leave_type_not_found: [404, 'Leave type not found'],
  type_not_applicable: [422, 'That leave type is not applicable - pick another type'],
  overlaps_existing: [409, 'The employee already has a pending or approved leave covering this day'],
  no_working_days: [422, 'This day is a weekend or holiday on the employee calendar, so there is no leave to record'],
  membership_left: [422, 'That employee has left the organization'],
  not_revocable: [409, 'The existing leave cannot be changed from here'],
  place_remote_is_home: [422, 'This employee works remotely, so every day is already work from home'],
  place_too_far: [422, 'Office / home can only be set up to three months ahead'],
  place_forbidden: [403, 'Only an admin can set office / home'],
  place_no_attendance: [422, 'Contractors and vendor resources have no attendance'],
};

// One day edited as two things: attendance (present / half day / absent / leave + which leave) and, separately, office / home.
router.post(
  '/day',
  can('attendance.approve', 'admin'),
  asyncHandler(async (req, res) => {
    const body = setDaySchema.parse(req.body);
    const result = await attendanceDay.setDay(req.user.org_id, req.user, body);
    if (result.error === 'leave_spans_days') {
      const from = result.leave.from_date.toISOString().slice(0, 10);
      const to = result.leave.to_date.toISOString().slice(0, 10);
      const message = `This leave runs from ${from} to ${to}. Changing this day withdraws the whole leave and puts the other days back with the same type`;
      return fail(res, 409, message, [{ message, code: 'leave_spans_days', from, to }]);
    }
    if (result.error === 'timesheet_conflict' || result.error === 'half_day_hours_exceeded') return fail(res, 409, leaveService.conflictMessage(result.detail || result));
    if (result.error === 'insufficient_balance') return fail(res, 422, `Not enough leave balance - ${result.detail?.needed} day(s) requested, ${Math.max(result.detail?.remaining ?? 0, 0)} remaining`);
    if (result.error) {
      const [code, message] = DAY_ERRORS[result.error] || [500, 'Unexpected error'];
      return fail(res, code, message);
    }
    return ok(res, result);
  })
);

// Validates every row; applies the sheet only when no row has an error (and dry_run is false).
router.post(
  '/import',
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await service.importAttendance(req.user.org_id, req.user.id, importSchema.parse(req.body))))
);

router.get(
  '/import-template',
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await service.importTemplate(req.user.org_id, templateQuerySchema.parse(req.query))))
);

// Previous-month backfill (admin): marks applicable employees present on each working day of a PAST month.
// Never the current / a future month; existing records, leave, weekends and holidays are skipped; audited.
router.post(
  '/backfill-month',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = backfillMonthSchema.parse(req.body);
    const result = await autoAttendance.backfillMonth(req.user.org_id, req.user.id, body);
    if (result.error === 'month_not_past') return fail(res, 422, 'Pick a previous month - the current or a future month cannot be backfilled');
    return ok(res, result);
  })
);

router.get(
  '/backfill-month/runs',
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await autoAttendance.listBackfillRuns(req.user.org_id)))
);

router.get(
  '/shifts',
  asyncHandler(async (req, res) => {
    const rows = await service.listShifts(req.user.org_id);
    return ok(res, rows);
  })
);

router.post(
  '/shifts',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createShiftSchema.parse(req.body);
    const result = await service.createShift(req.user.org_id, body);
    if (result.error === 'name_taken') return fail(res, 409, 'Shift name already in use');
    return created(res, result.shift);
  })
);

module.exports = router;
