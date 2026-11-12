const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, fail } = require('../../utils/response');
const billing = require('./billing.service');

// Public, signature-checked webhook STUB for SaaS payments (see billing.service.js). No gateway keys exist in this code: the shared secret is the
// environment setting SAAS_WEBHOOK_SECRET, and without it the endpoint answers 404 as if it did not exist.
const router = express.Router();
if (env.nodeEnv !== 'test') router.post('/saas-webhook/:provider', rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));

router.post('/saas-webhook/:provider', asyncHandler(async (req, res) => {
  const provider = String(req.params.provider).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || 'stub';
  const r = await billing.handleWebhook(provider, req.body, req.get('x-signature'));
  if (r.error === 'not_configured') return fail(res, 404, 'Not found');
  if (r.error === 'bad_signature') return fail(res, 401, 'Bad signature');
  if (r.error) return fail(res, 422, 'Bad event');
  return ok(res, { received: true, duplicate: Boolean(r.duplicate) });
}));

module.exports = router;
