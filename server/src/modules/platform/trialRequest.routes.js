const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../../config/env');
const orgContext = require('../../lib/orgContext');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, fail } = require('../../utils/response');
const service = require('./trialRequest.service');

// Public, no login: the website's "Request a trial" form posts here (docs/features/SAAS-TRIAL-REQUEST.md). Closed until a platform admin opens it.
const router = express.Router();
if (env.nodeEnv !== 'test') router.post('/trial-request', rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }));

router.post('/trial-request', asyncHandler(async (req, res) => {
  const r = await orgContext.runAs('Website trial request', () => service.receive(req.body));
  if (r.error === 'closed') return fail(res, 404, 'Trial requests are not open right now');
  return ok(res, { received: true }, {}, 201);
}));

module.exports = router;
