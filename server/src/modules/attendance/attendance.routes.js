const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./attendance.service');
const autoAttendance = require('./autoAttendance.service');
const { listQuerySchema, regularizeSchema, deleteRecordSchema, createShiftSchema, manualEntrySchema, importSchema, templateQuerySchema, backfillMonthSchema } = require('./attendance.validation');

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
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const result = await service.listTeam(req.user.org_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.post(
  '/:id/regularize',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = regularizeSchema.parse(req.body);
    const result = await service.regularize(req.user.org_id, req.params.id, req.user.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Attendance record not found');
    return ok(res, result.record);
  })
);

router.delete(
  '/:id',
  authorize('admin'),
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
  authorize('admin'),
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
