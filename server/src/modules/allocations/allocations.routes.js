const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./allocations.service');
const v = require('./allocations.validation');

// People → Capacity & Allocation (admin). Reports read live, effective-dated data.
const router = express.Router();
router.use(authenticate, requireOrgMembership, authorize('admin'));

const ERRORS = {
  not_found: [404, 'Allocation not found'],
  account_not_found: [404, 'Project not found'],
  membership_not_found: [404, 'Employee not found in this company'],
  team_not_found: [404, 'Team not found'],
  end_before_start: [422, 'The end date cannot be before the start date'],
  overlapping_allocation: [409, 'That overlaps another allocation of this person on this project — end or adjust that one first'],
  no_allocation_to_move: [422, 'This person has no allocation on that project on the effective date'],
  nothing_to_move: [422, 'This person has no allocation in force on that date — pick a project or team to move them to'],
  future_team_change: [422, 'A team change can be effective today or earlier, not in the future'],
};

function failFor(res, error) {
  const [code, message] = ERRORS[error] || [500, 'Unexpected error'];
  return fail(res, code, message);
}

router.get('/settings', asyncHandler(async (req, res) => ok(res, await service.getSettings(req.user.org_id))));
router.put('/settings', asyncHandler(async (req, res) => ok(res, await service.updateSettings(req.user.org_id, v.settingsSchema.parse(req.body)))));

router.get('/reports/team-capacity', asyncHandler(async (req, res) => ok(res, await service.teamCapacity(req.user.org_id, v.capacityQuerySchema.parse(req.query)))));
router.get('/reports/ending-soon', asyncHandler(async (req, res) => ok(res, await service.endingSoon(req.user.org_id, v.endingSoonQuerySchema.parse(req.query)))));
router.get('/reports/resources', asyncHandler(async (req, res) => ok(res, await service.resourceAllocations(req.user.org_id, v.resourcesQuerySchema.parse(req.query)))));
router.get('/reports/movements', asyncHandler(async (req, res) => ok(res, await service.movements(req.user.org_id, v.movementsQuerySchema.parse(req.query)))));

router.post(
  '/move',
  asyncHandler(async (req, res) => {
    const result = await service.moveResource(req.user.org_id, req.user.id, v.moveSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);

router.post(
  '/team-change',
  asyncHandler(async (req, res) => {
    const { org_membership_id, team_id, effective_date } = v.teamChangeSchema.parse(req.body);
    const result = await service.changeTeam(req.user.org_id, req.user.id, org_membership_id, team_id, effective_date);
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);

router.post(
  '/:id/end',
  asyncHandler(async (req, res) => {
    const result = await service.endAllocation(req.user.org_id, req.user.id, req.params.id, v.endAllocationSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.assignment);
  })
);

module.exports = router;
module.exports.failFor = failFor;
