const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const requireModule = require('../../middleware/requireModule');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./leads.service');

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireModule('leads'), authorize('admin', 'sales', 'bda'));

const ERRORS = {
  not_found: [404, 'Lead not found'],
  lead_closed: [409, 'A won or lost lead can no longer be changed'],
  invalid_transition: [422, 'That stage change is not allowed'],
  not_self_project: [422, 'Only a self-project lead can be converted to a project'],
};

function failFor(res, result) {
  if (result.error === 'invalid') {
    return fail(res, 422, 'Validation failed', result.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const mapped = ERRORS[result.error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

router.get('/summary', asyncHandler(async (req, res) => ok(res, await service.summary(req.user.org_id))));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await service.list(req.user.org_id, service.listQuerySchema.parse(req.query));
    return ok(res, result.data, { pagination: result.pagination });
  })
);
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await service.create(req.user.org_id, req.user.id, service.createLeadSchema.parse(req.body));
    return created(res, result.lead);
  })
);
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await service.get(req.user.org_id, req.params.id);
    return result.error ? failFor(res, result) : ok(res, result.lead);
  })
);
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await service.update(req.user.org_id, req.params.id, service.updateLeadSchema.parse(req.body));
    return result.error ? failFor(res, result) : ok(res, result.lead);
  })
);
router.post(
  '/:id/stage',
  asyncHandler(async (req, res) => {
    const result = await service.changeStage(req.user.org_id, req.params.id, service.stageSchema.parse(req.body));
    return result.error ? failFor(res, result) : ok(res, result.lead);
  })
);
// Converting creates records in the projects / contracts modules: admin only.
router.post(
  '/:id/convert',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.convert(req.user.org_id, req.user.id, req.params.id, service.convertSchema.parse(req.body));
    return result.error ? failFor(res, result) : created(res, result);
  })
);

module.exports = router;
