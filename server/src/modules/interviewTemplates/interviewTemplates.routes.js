const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const service = require('./interviewTemplates.service');
const { createSchema, updateSchema } = require('./interviewTemplates.validation');

const router = express.Router();
router.use(authenticate, requireMasterWorkspace);

const ERRORS = {
  not_found: [404, 'Template not found'],
  invalid_template_round: [400, 'A round does not belong to this template'],
  template_round_in_use: [400, 'A round that candidates already have interviews for cannot be removed'],
};
const mapError = (res, error) => fail(res, ...(ERRORS[error] || [400, 'Bad request']));

router.get('/', asyncHandler(async (req, res) => ok(res, await service.listTemplates(req.query.include_inactive === 'true' && req.user.role === 'admin'))));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await service.getTemplate(req.params.id);
  return row ? ok(res, row) : mapError(res, 'not_found');
}));

router.post('/', authorize('admin'), asyncHandler(async (req, res) => {
  const result = await service.createTemplate(createSchema.parse(req.body));
  return created(res, result.template);
}));

router.patch('/:id', authorize('admin'), asyncHandler(async (req, res) => {
  const result = await service.updateTemplate(req.params.id, updateSchema.parse(req.body));
  return result.error ? mapError(res, result.error) : ok(res, result.template);
}));

module.exports = router;
