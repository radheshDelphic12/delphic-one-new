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

module.exports = router;
