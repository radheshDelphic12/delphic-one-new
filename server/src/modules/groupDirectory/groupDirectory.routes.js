const express = require('express');
const { z } = require('zod');
const { authenticate, authorizeGroupSuperadmin } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./groupDirectory.service');

// Group Dashboard > Directory (group superadmin): /api/v1/group-directory
const router = express.Router();
router.use(authenticate, authorizeGroupSuperadmin);
const uuid = z.string().uuid();
const problem = (res, r) => {
  if (r.error === 'duplicate') return fail(res, 409, `This person is already in the directory as ${r.name}`);
  const map = { not_found: [404, 'Not found'], company_not_in_group: [422, 'Choose companies of this group'] };
  const [s, m] = map[r.error] || [400, 'Bad request'];
  return fail(res, s, m);
};

router.get('/', asyncHandler(async (req, res) => ok(res, await service.list(req.user.org_group_ids, service.listSchema.parse(req.query)))));
router.get('/pipeline', asyncHandler(async (req, res) => ok(res, await service.pipeline(req.user.org_group_ids, { view: req.query.view === 'skipped' ? 'skipped' : 'open' }))));
router.post('/pipeline/add', asyncHandler(async (req, res) => {
  const r = await service.addFromPipeline(req.user.org_group_ids, req.user.id, service.addFromPipelineSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.contact);
}));
router.post('/pipeline/unskip', asyncHandler(async (req, res) => ok(res, await service.unskip(req.user.org_group_ids, service.skipSchema.parse(req.body || {})))));
router.post('/pipeline/skip', asyncHandler(async (req, res) => ok(res, await service.skip(req.user.org_group_ids, req.user.id, service.skipSchema.parse(req.body || {})))));
router.post('/', asyncHandler(async (req, res) => {
  const r = await service.create(req.user.org_group_ids, req.user.id, service.contactSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.contact);
}));
router.patch('/:id', asyncHandler(async (req, res) => {
  const r = await service.update(req.user.org_group_ids, uuid.parse(req.params.id), service.contactUpdateSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.contact);
}));
router.delete('/:id', asyncHandler(async (req, res) => {
  const r = await service.remove(req.user.org_group_ids, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r);
}));
router.post('/:id/followups', asyncHandler(async (req, res) => {
  const r = await service.addFollowup(req.user.org_group_ids, req.user.id, uuid.parse(req.params.id), service.followupSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.contact);
}));

module.exports = router;
