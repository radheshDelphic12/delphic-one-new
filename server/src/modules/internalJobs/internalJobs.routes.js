const express = require('express');
const { authenticate } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, fail } = require('../../utils/response');
const service = require('./internalJobs.service');

// Open to every employee of the master workspace (Delphic Global): they see the same jobs the website shows.
const router = express.Router();
router.use(authenticate, requireMasterWorkspace);

const done = (res, r) => {
  if (r.error === 'not_eligible') return fail(res, 403, 'Applying for a job yourself is only for employees on the bench or serving notice');
  if (r.error === 'already_applied') return fail(res, 409, 'This person has already been put forward for this job');
  if (r.error) return fail(res, 404, 'This job is no longer open');
  return ok(res, { done: true, job_code: r.job_code || null }, {}, 201);
};

router.get('/', asyncHandler(async (req, res) => {
  const { rows, pagination, facets } = await service.list(req.user, req.query);
  return ok(res, rows, { pagination, facets });
}));
router.get('/my-referrals', asyncHandler(async (req, res) => ok(res, await service.myReferrals(req.user))));
router.post('/:slug/refer', asyncHandler(async (req, res) => done(res, await service.refer(req.user, req.params.slug, req.body))));
router.post('/:slug/apply', asyncHandler(async (req, res) => done(res, await service.applyMyself(req.user, req.params.slug, req.body))));

module.exports = router;
