const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./policies.service');
const { createSchema, updateSchema } = require('./policies.validation');

// People → Policies. Everyone in the org reads the published ones; only an admin writes.
const router = express.Router();
router.use(authenticate, requireOrgMembership);

router.get(
  '/',
  asyncHandler(async (req, res) => ok(res, await service.list(req.user.org_id, { includeDrafts: req.user.role === 'admin' })))
);

router.post(
  '/',
  authorize('admin'),
  asyncHandler(async (req, res) => created(res, await service.create(req.user.org_id, req.user.id, createSchema.parse(req.body))))
);

router.patch(
  '/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.update(req.user.org_id, req.user.id, req.params.id, updateSchema.parse(req.body));
    if (result.error) return fail(res, 404, 'Policy not found');
    return ok(res, result.policy);
  })
);

router.delete(
  '/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    if (!(await service.remove(req.user.org_id, req.params.id))) return fail(res, 404, 'Policy not found');
    return ok(res, { deleted: true });
  })
);

module.exports = router;
