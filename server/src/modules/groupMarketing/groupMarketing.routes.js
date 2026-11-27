const express = require('express');
const { z } = require('zod');
const { authenticate, authorizeGroupSuperadmin } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./groupMarketing.service');

// Group Dashboard > Marketing (group superadmin): /api/v1/group-marketing
const router = express.Router();
router.use(authenticate, authorizeGroupSuperadmin);
const uuid = z.string().uuid();
const problem = (res, r) => {
  const map = { not_found: [404, 'Not found'], company_not_in_group: [422, 'Choose companies of this group'], bad_dates: [422, 'The end date is before the start date'] };
  const [s, m] = map[r.error] || [400, 'Bad request'];
  return fail(res, s, m);
};

router.get('/', asyncHandler(async (req, res) => ok(res, await service.list(req.user.org_group_ids, service.listSchema.parse(req.query)))));
router.post('/', asyncHandler(async (req, res) => {
  const r = await service.create(req.user.org_group_ids, req.user.id, service.campaignSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.campaign);
}));
router.patch('/:id', asyncHandler(async (req, res) => {
  const r = await service.update(req.user.org_group_ids, uuid.parse(req.params.id), service.campaignUpdateSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.campaign);
}));
router.delete('/:id', asyncHandler(async (req, res) => {
  const r = await service.remove(req.user.org_group_ids, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r);
}));
router.post('/:id/spends', asyncHandler(async (req, res) => {
  const r = await service.addSpend(req.user.org_group_ids, req.user.id, uuid.parse(req.params.id), service.spendSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.campaign);
}));
router.delete('/:id/spends/:sid', asyncHandler(async (req, res) => {
  const r = await service.removeSpend(req.user.org_group_ids, uuid.parse(req.params.id), uuid.parse(req.params.sid));
  return r.error ? problem(res, r) : ok(res, r.campaign);
}));

module.exports = router;
