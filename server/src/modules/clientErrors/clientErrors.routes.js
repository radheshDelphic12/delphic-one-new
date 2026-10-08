const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../../middleware/auth');
const { ok } = require('../../utils/response');
const logger = require('../../config/logger');

// A render crash in the browser (client ErrorBoundary) reported here so it
// lands in the server logs as `client_error` with its stack — otherwise it
// only ever exists in one person's browser console.
const schema = z.object({
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  component_stack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  user_agent: z.string().max(500).optional(),
});

const router = express.Router();

router.post('/', authenticate, (req, res) => {
  const body = schema.parse(req.body);
  logger.error('client_error', { ...body, user_id: req.user.id, org_id: req.user.org_id || null });
  return ok(res, { logged: true });
});

module.exports = router;
