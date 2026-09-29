const express = require('express');
const { z } = require('zod');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./financeCategories.service');

// Reading the lists is open to every member (the expense claim form picks
// from them); adding, renaming, deactivating and deleting is admin only.
const router = express.Router();
router.use(authenticate, requireOrgMembership);

const kind = z.enum(['group_charge', 'expense']);
const listSchema = z.object({ kind, include_inactive: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).optional() });
const createSchema = z.object({ kind, name: z.string().trim().min(1).max(100) });
const updateSchema = z
  .object({ name: z.string().trim().min(1).max(100).optional(), is_active: z.boolean().optional() })
  .refine((v) => v.name !== undefined || v.is_active !== undefined, { message: 'Provide a name or is_active' });

const ERRORS = { not_found: [404, 'Category not found'], name_taken: [409, 'A category with that name already exists'] };
const failFor = (res, error) => fail(res, ...(ERRORS[error] || [500, 'Unexpected error']));

router.get('/', asyncHandler(async (req, res) => ok(res, await service.list(req.user.org_id, listSchema.parse(req.query)))));

router.post(
  '/',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.create(req.user.org_id, req.user.id, createSchema.parse(req.body));
    return result.error ? failFor(res, result.error) : created(res, result.category);
  })
);

router.patch(
  '/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.update(req.user.org_id, req.user.id, req.params.id, updateSchema.parse(req.body));
    return result.error ? failFor(res, result.error) : ok(res, result.category);
  })
);

router.delete(
  '/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.remove(req.user.org_id, req.user.id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.deactivated ? { deactivated: true, category: result.category } : { deleted: true });
  })
);

module.exports = router;
