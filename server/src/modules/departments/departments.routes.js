const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./departments.service');
const { createSchema, updateSchema } = require('./departments.validation');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  requireOrgMembership,
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const rows = await service.list(req.user.org_id);
    return ok(res, rows);
  })
);

router.post(
  '/',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const result = await service.create(req.user.org_id, body);
    if (result.error === 'name_taken') return fail(res, 409, 'Department name already in use');
    return created(res, result.department);
  })
);

router.patch(
  '/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const result = await service.update(req.user.org_id, req.params.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Department not found');
    if (result.error === 'name_taken') return fail(res, 409, 'Department name already in use');
    return ok(res, result.department);
  })
);

router.delete(
  '/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.remove(req.user.org_id, req.params.id);
    if (result.error === 'not_found') return fail(res, 404, 'Department not found');
    if (result.error === 'in_use') return fail(res, 409, `This department is still used by ${[result.people && `${result.people} people`, result.designations && `${result.designations} designations`, result.teams && `${result.teams} teams`, result.calendars && `${result.calendars} calendars`].filter(Boolean).join(', ')}. Move them first.`);
    return ok(res, result);
  })
);

module.exports = router;
