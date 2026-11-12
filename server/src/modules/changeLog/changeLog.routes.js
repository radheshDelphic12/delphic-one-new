const express = require('express');
const { z } = require('zod');
const { authenticate, authorize, authorizeGroupSuperadmin, requireOrgMembership } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./changeLog.service');
const admin = require('../admin/admin.service');
const softDeleteErrors = require('../../lib/softDeleteErrors');

const router = express.Router();
router.use(authenticate);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const groupQuery = z.object({
  org_id: z.string().uuid().optional(),
  entity_type: z.string().max(60).optional(),
  actor_id: z.string().uuid().optional(),
  action: z.string().max(30).optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const entityQuery = z.object({ entity_type: z.string().max(60), entity_id: z.string().max(80), limit: z.coerce.number().int().min(1).max(300).optional() });
const restoreBody = z.object({ entity_type: z.string().max(60), entity_id: z.string().uuid(), reason: z.string().trim().min(3).max(500) });

// Group Dashboard > Logs (group super admin): the whole group's change log, the deleted records, and restoring one.
router.get('/', authorizeGroupSuperadmin, asyncHandler(async (req, res) => {
  const result = await service.listGroup(req.user.org_group_ids, groupQuery.parse(req.query));
  return ok(res, result.rows, { pagination: result.pagination, facets: result.facets });
}));
router.get('/deleted', authorizeGroupSuperadmin, asyncHandler(async (req, res) => ok(res, await service.listDeleted(req.user.org_group_ids))));
router.post('/restore', authorizeGroupSuperadmin, asyncHandler(async (req, res) => {
  const body = restoreBody.parse(req.body);
  const deleted = await service.listDeleted(req.user.org_group_ids);
  if (!deleted.some((d) => d.entity_type === body.entity_type && d.entity_id === body.entity_id)) return fail(res, 404, 'That deleted record is not in your group');
  const result = await admin.restore(body.entity_type, body.entity_id, body.reason, req.user);
  if (result.error) return fail(res, ...(softDeleteErrors[result.error] || [result.error === 'not_found' ? 404 : 409, result.error === 'invalid_entity_type' ? 'Invalid entity type' : 'Could not restore']));
  return ok(res, result.result);
}));

// A record's history inside the caller's own company (Finance > Projects shows it for a project).
router.get('/entity', requireOrgMembership, authorize('admin'), asyncHandler(async (req, res) => ok(res, await service.listEntity(req.user.org_id, entityQuery.parse(req.query)))));

module.exports = router;
