const express = require('express');
const { z } = require('zod');
const { authenticateExternal, requireExternalScope } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./pm.service');

// The read-only page a client or vendor opens from a project's shared link. Bearer token (an external-access grant scoped to ONE
// project), not a login: it can see that project's non-internal tickets and, if the share allows, comment. Nothing else.
const router = express.Router();
router.use(authenticateExternal, requireExternalScope('project_management'));

router.get('/', asyncHandler(async (req, res) => {
  const r = await service.guestView(req.externalAccess);
  return r.error ? fail(res, 404, 'This project is no longer available') : ok(res, r);
}));

router.post('/tickets/:id/comments', asyncHandler(async (req, res) => {
  const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body || {});
  const r = await service.guestComment(req.externalAccess, req.params.id, body);
  if (r.error === 'comment_not_allowed') return fail(res, 403, 'This link is view-only');
  if (r.error) return fail(res, 404, 'Not found');
  return created(res, r.comment);
}));

module.exports = router;
