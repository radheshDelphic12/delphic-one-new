const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../../config/env');
const { can, hasPermission } = require('../../lib/permissions');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const prisma = require('../../config/db');
const service = require('./locationCheckin.service');
const v = require('./locationCheckin.validation');

// Location check-in: Delphic Global only (the master workspace), full-time employees. Kept apart from attendance and payroll.
// An employee checks in / out and sees their own history; HR and admins read the report; settings and office map points are admin-edited.
fs.mkdirSync(env.uploadDir, { recursive: true });
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, env.uploadDir),
    filename: (req, file, cb) => cb(null, `lci-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: Math.min(env.maxUploadMb, 5) * 1024 * 1024 },
  fileFilter: (req, file, cb) => (file.mimetype.startsWith('image/') && IMAGE_EXT.includes(path.extname(file.originalname).toLowerCase() || '.jpg') ? cb(null, true) : cb(new Error('The selfie must be an image'))),
});

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace);

const ERRORS = {
  not_eligible: [403, 'Location check-in is for full-time employees'],
  already_checked_in: [409, 'You have already checked in today'],
  not_checked_in: [409, 'Check in first'],
  already_checked_out: [409, 'You are not checked in right now'],
  bad_times: [422, 'The check-out must be after the check-in'],
  wrong_day: [422, 'The check-in must stay on the same day'],
  overlap: [409, 'This overlaps another check-in of the same day'],
  selfie_required: [422, 'Take a selfie to check in'],
  location_not_found: [404, 'Office not found'],
  range_too_long: [422, 'Pick a range of up to 93 days'],
  not_found: [404, 'Not found'],
};
const failFor = (res, code) => fail(res, ...(ERRORS[code] || [400, code]));

// ----- Employee -----
router.get('/today', asyncHandler(async (req, res) => ok(res, await service.today(req.user))));

router.post(
  '/check-in',
  upload.single('selfie'),
  asyncHandler(async (req, res) => {
    const point = v.point.parse(v.emptyToUndefined(req.body));
    const result = await service.checkIn(req.user, point, req.file);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.record);
  })
);

router.post(
  '/check-out',
  upload.none(),
  asyncHandler(async (req, res) => {
    const point = v.checkOutPoint.parse(v.emptyToUndefined(req.body));
    const result = await service.checkOut(req.user, point);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.record);
  })
);

router.get(
  '/mine',
  asyncHandler(async (req, res) => ok(res, await service.listMine(req.user, v.rangeQuery.parse(req.query))))
);

// ----- Report (HR / admin) -----
router.get(
  '/report',
  can('location_checkin.view', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.report(req.user.org_id, v.reportQuery.parse(req.query));
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);

// Every employee x every day of a month: who checked in, when, where, and who is missing.
router.get(
  '/register',
  can('location_checkin.view', 'admin'),
  asyncHandler(async (req, res) => ok(res, await service.register(req.user.org_id, req.user, v.registerQuery.parse(req.query))))
);

router.get(
  '/report.csv',
  can('location_checkin.view', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.report(req.user.org_id, v.reportQuery.parse(req.query));
    if (result.error) return failFor(res, result.error);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="location-checkin-report.csv"');
    return res.send(service.toCsv(result.rows));
  })
);

// The selfie: its owner, or someone who reads the report.
router.get(
  '/records/:id/selfie',
  asyncHandler(async (req, res) => {
    const found = await service.selfiePath(req.user.org_id, req.params.id);
    if (found.error) return failFor(res, found.error);
    if (found.org_membership_id !== req.user.org_membership_id) {
      const decided = hasPermission(req.user, 'location_checkin.view');
      const allowed = decided === null ? req.user.role === 'admin' : decided;
      if (!allowed) return failFor(res, 'not_found');
    }
    return res.sendFile(found.file, (err) => {
      if (err && !res.headersSent) failFor(res, 'not_found');
    });
  })
);

// The selfie of one check-in (a day can hold several).
router.get(
  '/sessions/:id/selfie',
  asyncHandler(async (req, res) => {
    const found = await service.sessionSelfiePath(req.user.org_id, req.params.id);
    if (found.error) return failFor(res, found.error);
    if (found.org_membership_id !== req.user.org_membership_id) {
      const decided = hasPermission(req.user, 'location_checkin.view');
      const allowed = decided === null ? req.user.role === 'admin' : decided;
      if (!allowed) return failFor(res, 'not_found');
    }
    return res.sendFile(found.file, (err) => {
      if (err && !res.headersSent) failFor(res, 'not_found');
    });
  })
);

// ----- Correct or remove a record (admin; a reason is required and audited) -----
router.patch(
  '/sessions/:id',
  can('hr_settings.update', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.updateSession(req.user, req.params.id, v.sessionEditSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.record);
  })
);
router.delete(
  '/sessions/:id',
  can('hr_settings.update', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.deleteSession(req.user, req.params.id, v.removeSchema.parse(req.body || {}).reason);
    if (result.error) return failFor(res, result.error);
    return ok(res, { record: result.record, day_removed: result.day_removed });
  })
);
router.delete(
  '/records/:id',
  can('hr_settings.update', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.deleteDay(req.user, req.params.id, v.removeSchema.parse(req.body || {}).reason);
    if (result.error) return failFor(res, result.error);
    return ok(res, { deleted: true });
  })
);

// ----- Settings and office map points (admin) -----
router.get('/settings', asyncHandler(async (req, res) => ok(res, await service.getSettings(req.user.org_id))));
router.put(
  '/settings',
  can('hr_settings.update', 'admin'),
  asyncHandler(async (req, res) => ok(res, await service.updateSettings(req.user.org_id, req.user.id, v.settingsSchema.parse(req.body))))
);

router.get('/shifts', can('location_checkin.view', 'admin'), asyncHandler(async (req, res) => ok(res, await service.listShiftRules(req.user.org_id))));
router.put(
  '/shifts/:shiftId',
  can('hr_settings.update', 'admin'),
  asyncHandler(async (req, res) => {
    const { late_after_minutes } = v.shiftRuleSchema.parse(req.body);
    const result = await service.saveShiftRule(req.user.org_id, req.user.id, req.params.shiftId, late_after_minutes);
    if (result.error) return fail(res, 404, 'Shift not found');
    return ok(res, result.row || { cleared: true });
  })
);

router.get('/offices', can('location_checkin.view', 'admin'), asyncHandler(async (req, res) => ok(res, await service.listGeofences(req.user.org_id))));
router.put(
  '/offices/:locationId',
  can('hr_settings.update', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.saveGeofence(req.user.org_id, req.params.locationId, v.geofenceSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.row);
  })
);
router.delete(
  '/offices/:locationId',
  can('hr_settings.update', 'admin'),
  asyncHandler(async (req, res) => ok(res, await service.removeGeofence(req.user.org_id, req.params.locationId)))
);

// The report's people filter: full-time employees who can use the feature.
router.get(
  '/people',
  can('location_checkin.view', 'admin'),
  asyncHandler(async (req, res) => {
    const settings = await service.getSettings(req.user.org_id);
    const rows = await prisma.orgMembership.findMany({
      where: { org_id: req.user.org_id, ...(settings.full_time_only === false ? {} : { worker_type: 'full_time_employee' }), employment_status: { in: ['active', 'notice_period'] } },
      select: { id: true, employee_code: true, person: { select: { name: true } } },
      orderBy: { person: { name: 'asc' } },
    });
    return ok(res, rows.map((m) => ({ org_membership_id: m.id, employee_code: m.employee_code, name: m.person?.name || '—' })));
  })
);

module.exports = router;
