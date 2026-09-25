const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const requireModule = require('../../middleware/requireModule');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./contracts.service');

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireModule('contracts'));

const ERRORS = {
  not_found: [404, 'Contract not found'],
  project_not_found: [404, 'Project not found'],
  contract_closed: [409, 'A completed or terminated contract can no longer be edited'],
  invalid_transition: [422, 'That status change is not allowed from the contract current status'],
};

function failFor(res, result) {
  if (result.error === 'invalid') {
    return fail(res, 422, 'Validation failed', result.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const mapped = ERRORS[result.error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

router.get('/summary', authorize('admin', 'sales'), asyncHandler(async (req, res) => ok(res, await service.summary(req.user.org_id))));

router.get(
  '/',
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const result = await service.list(req.user.org_id, service.listQuerySchema.parse(req.query));
    return ok(res, result.data, { pagination: result.pagination });
  })
);
router.get(
  '/:id',
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const result = await service.get(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result);
    return ok(res, result.contract);
  })
);
router.post(
  '/',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.create(req.user.org_id, req.user.id, service.createContractSchema.parse(req.body));
    if (result.error) return failFor(res, result);
    return created(res, result.contract);
  })
);
router.patch(
  '/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.update(req.user.org_id, req.params.id, service.updateContractSchema.parse(req.body));
    if (result.error) return failFor(res, result);
    return ok(res, result.contract);
  })
);
router.post(
  '/:id/status',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.changeStatus(req.user.org_id, req.params.id, service.statusSchema.parse(req.body));
    if (result.error) return failFor(res, result);
    return ok(res, result.contract);
  })
);

module.exports = router;
