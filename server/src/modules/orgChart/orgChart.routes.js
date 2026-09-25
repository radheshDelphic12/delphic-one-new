const express = require('express');
const { authenticate, authorizeGroupSuperadmin, requireOrgMembership } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./orgChart.service');
const { orgChartQuerySchema, groupOrgChartQuerySchema } = require('./orgChart.validation');

const router = express.Router();
router.use(authenticate);

// Any active org member can view their own org's chart — a directory, not
// admin-only data, same posture as GET /orgs/locations.
router.get(
  '/',
  requireOrgMembership,
  asyncHandler(async (req, res) => {
    const query = orgChartQuerySchema.parse(req.query);
    const result = await service.getOrgChart(req.user.org_id, query);
    return ok(res, result);
  })
);

router.get(
  '/group',
  authorizeGroupSuperadmin,
  asyncHandler(async (req, res) => {
    const query = groupOrgChartQuerySchema.parse(req.query);
    if (query.org_group_id && !req.user.org_group_ids.includes(query.org_group_id)) {
      return fail(res, 403, 'Holding company is outside your authorized scope');
    }
    const rows = await service.getGroupOrgChart(query, req.user.org_group_ids);
    return ok(res, rows);
  })
);

module.exports = router;
