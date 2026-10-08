const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./assets.service');
const { createSchema, updateSchema, listQuerySchema } = require('./assets.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership, authorize('admin'));

const LINK_ERRORS = {
  employee_not_found: 'Employee not found in this organisation',
  vendor_not_found: 'Vendor account not found',
  vendor_required: 'Pick the vendor this asset belongs to',
  client_not_found: 'Client account not found',
};

router.get(
  '/',
  asyncHandler(async (req, res) => ok(res, await service.list(req.user.org_id, listQuerySchema.parse(req.query))))
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const result = await service.create(req.user.org_id, body);
    if (result.error) return fail(res, 422, LINK_ERRORS[result.error]);
    return created(res, result.asset);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const result = await service.update(req.user.org_id, req.params.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Asset not found');
    if (result.error) return fail(res, 422, LINK_ERRORS[result.error]);
    return ok(res, result.asset);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await service.remove(req.user.org_id, req.params.id);
    if (result.error === 'not_found') return fail(res, 404, 'Asset not found');
    return ok(res, { deleted: true });
  })
);

module.exports = router;
