const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./profitability.service');
const { computeSchema, listQuerySchema, rollupQuerySchema } = require('./profitability.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

router.post(
  '/compute',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { date_from, date_to } = computeSchema.parse(req.body);
    const result = await service.computeRangeForOrg(req.user.org_id, date_from, date_to);
    return ok(res, result);
  })
);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.omit({ org_membership_id: true }).parse(req.query);
    const result = await service.listMine(req.user.org_membership_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.get(
  '/team',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const result = await service.listTeam(req.user.org_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.get(
  '/rollup',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { from, to, group_by, org_membership_id } = rollupQuerySchema.parse(req.query);
    const rows = await service.rollup({ orgId: req.user.org_id, orgMembershipId: org_membership_id, from, to, groupBy: group_by });
    return ok(res, rows);
  })
);

module.exports = router;
