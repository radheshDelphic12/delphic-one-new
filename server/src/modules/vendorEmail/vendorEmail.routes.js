const express = require('express');
const { authenticate } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { can } = require('../../lib/permissions');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./vendorEmail.service');

// Emailing requirements to vendors: the people who manage requirements (Sales, Admin, or a custom role that may edit them).
const router = express.Router();
router.use(authenticate, requireMasterWorkspace, can('requirements.update', 'sales', 'admin'));

const failFor = (res, result) => {
  if (result.error === 'requirement_not_found') return fail(res, 404, 'One of the selected requirements was not found');
  if (result.error === 'no_recipients') return fail(res, 422, 'None of the selected vendors has a contact email', { skipped: result.skipped });
  return fail(res, 422, result.error);
};

router.get('/vendors', asyncHandler(async (req, res) => ok(res, await service.vendors(req.user.org_id, req.query))));
router.get('/log', asyncHandler(async (req, res) => ok(res, await service.log(req.user.org_id))));
router.post('/preview', asyncHandler(async (req, res) => {
  const result = await service.preview(req.user.org_id, req.user, req.body);
  return result.error ? failFor(res, result) : ok(res, result);
}));
router.post('/send', asyncHandler(async (req, res) => {
  const result = await service.send(req.user.org_id, req.user, req.body);
  return result.error ? failFor(res, result) : ok(res, result, {}, 201);
}));

module.exports = router;
