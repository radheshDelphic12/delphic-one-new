const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./teams.service');
const { createSchema, updateSchema } = require('./teams.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

function failFor(res, result) {
  if (result.error === 'not_found') return fail(res, 404, 'Team not found');
  if (result.error === 'name_taken') return fail(res, 409, 'Team name already in use');
  if (result.error === 'department_not_found') return fail(res, 404, 'Department not found');
  if (result.error === 'lead_not_found') return fail(res, 404, 'Team lead not found in this organization');
  if (result.error === 'manager_not_found') return fail(res, 404, 'Reports-to manager not found in this organization');
  if (result.error === 'in_use') return fail(res, 409, `This team still has ${result.count} member(s) — move them to another team first`);
  return null;
}

router.get(
  '/',
  asyncHandler(async (req, res) => ok(res, await service.list(req.user.org_id)))
);

router.post(
  '/',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.create(req.user.org_id, createSchema.parse(req.body));
    return failFor(res, result) || created(res, result.team);
  })
);

router.patch(
  '/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.update(req.user.org_id, req.params.id, updateSchema.parse(req.body));
    return failFor(res, result) || ok(res, result.team);
  })
);

router.delete(
  '/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.remove(req.user.org_id, req.params.id);
    return failFor(res, result) || ok(res, { deleted: true });
  })
);

module.exports = router;
