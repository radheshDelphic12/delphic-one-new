const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, fail } = require('../../utils/response');
const service = require('./publicJobs.service');

// No login: these are the pages candidates open from a LinkedIn / WhatsApp / website link.
const router = express.Router();
if (env.nodeEnv !== 'test') router.post('/jobs/:slug/apply', rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }));

router.get('/jobs', asyncHandler(async (req, res) => ok(res, await service.list())));
router.get('/jobs/:slug', asyncHandler(async (req, res) => {
  const r = await service.get(req.params.slug);
  return r.error ? fail(res, 404, 'This job is no longer open') : ok(res, r.job);
}));
router.post('/jobs/:slug/apply', asyncHandler(async (req, res) => {
  // the visitor is not a user: their application is logged as coming from the website
  const r = await require('../../lib/orgContext').runAs('Website applicant', () => service.apply(req.params.slug, req.body));
  if (r.error === 'already_applied') return fail(res, 409, 'You have already applied for this job');
  if (r.error) return fail(res, 404, 'This job is no longer open');
  return ok(res, { applied: true }, {}, 201);
}));

module.exports = router;
