const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const service = require('./leadForm.service');

// The public lead form (no login): /api/v1/public/lead-forms/:token
const router = express.Router();
if (env.nodeEnv !== 'test') router.post('/lead-forms/:token', rateLimit({ windowMs: 60 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false }));
router.get('/lead-forms/:token', asyncHandler(async (req, res) => {
  const form = await service.publicForm(String(req.params.token).slice(0, 64));
  return form ? ok(res, form) : fail(res, 404, 'This form is not available');
}));
router.post('/lead-forms/:token', asyncHandler(async (req, res) => {
  const r = await service.submit(String(req.params.token).slice(0, 64), service.submitSchema.parse(req.body || {}));
  return r.error ? fail(res, 404, 'This form is not available') : created(res, { received: true });
}));

module.exports = router;
