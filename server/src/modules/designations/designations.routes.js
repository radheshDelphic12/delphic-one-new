const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./designations.service');
const { createSchema, updateSchema } = require('./designations.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await service.list(req.user.org_id);
    return ok(res, rows);
  })
);

router.post(
  '/',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const result = await service.create(req.user.org_id, body);
    if (result.error === 'name_taken') return fail(res, 409, 'Designation name already in use');
    return created(res, result.designation);
  })
);

router.patch(
  '/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const result = await service.update(req.user.org_id, req.params.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Designation not found');
    if (result.error === 'name_taken') return fail(res, 409, 'Designation name already in use');
    return ok(res, result.designation);
  })
);

module.exports = router;
