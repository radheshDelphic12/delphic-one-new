const express = require('express');
const { authenticate, authorize, authorizeGroupSuperadmin, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./orgs.service');
const { WORKER_ERRORS } = require('../../lib/workerType');
const {
  createOrgSchema,
  createLocationSchema,
  membershipListQuerySchema,
  personalDetailsSchema,
  updateMembershipSchema,
  updateValuationSchema,
  updateOrgSettingsSchema,
} = require('./orgs.validation');

const router = express.Router();
router.use(authenticate);

router.get(
  '/me/memberships',
  asyncHandler(async (req, res) => {
    const rows = await service.listMyMemberships(req.user.id);
    return ok(res, rows);
  })
);

// --- Bank + emergency contact: the employee's own (portal), or anyone's for an admin. ---

const canSeePersonal = (req, membershipId) => req.user.role === 'admin' || membershipId === req.user.org_membership_id;

router.get(
  '/me/details',
  requireOrgMembership,
  asyncHandler(async (req, res) => ok(res, await service.getPersonalDetails(req.user.org_id, req.user.org_membership_id)))
);

router.put(
  '/me/details',
  requireOrgMembership,
  asyncHandler(async (req, res) => {
    const body = personalDetailsSchema.parse(req.body);
    return ok(res, await service.updatePersonalDetails(req.user.org_id, req.user.org_membership_id, body));
  })
);

router.get(
  '/memberships/:id/details',
  requireOrgMembership,
  asyncHandler(async (req, res) => {
    if (!canSeePersonal(req, req.params.id)) return fail(res, 403, 'Only an admin or the employee can see these details');
    const row = await service.getPersonalDetails(req.user.org_id, req.params.id);
    if (!row) return fail(res, 404, 'Org membership not found');
    return ok(res, row);
  })
);

router.put(
  '/memberships/:id/details',
  requireOrgMembership,
  asyncHandler(async (req, res) => {
    if (!canSeePersonal(req, req.params.id)) return fail(res, 403, 'Only an admin or the employee can change these details');
    const body = personalDetailsSchema.parse(req.body);
    const row = await service.updatePersonalDetails(req.user.org_id, req.params.id, body);
    if (!row) return fail(res, 404, 'Org membership not found');
    return ok(res, row);
  })
);

router.get(
  '/memberships',
  requireOrgMembership,
  asyncHandler(async (req, res) => {
    const query = membershipListQuerySchema.parse(req.query);
    const rows = await service.listMemberships(req.user.org_id, query);
    return ok(res, rows);
  })
);

// Manager, direct reports and team members — the same directory-level info
// the org chart shows, so open to any member of the org.
router.get(
  '/me/reporting',
  requireOrgMembership,
  asyncHandler(async (req, res) => ok(res, await service.getReporting(req.user.org_id, req.user.org_membership_id)))
);

router.get(
  '/memberships/:id/reporting',
  requireOrgMembership,
  asyncHandler(async (req, res) => {
    const row = await service.getReporting(req.user.org_id, req.params.id);
    if (!row) return fail(res, 404, 'Org membership not found');
    return ok(res, row);
  })
);

router.get(
  '/memberships/:id',
  requireOrgMembership,
  asyncHandler(async (req, res) => {
    const row = await service.getMembership(req.user.org_id, req.params.id);
    if (!row) return fail(res, 404, 'Org membership not found');
    return ok(res, row);
  })
);

router.get(
  '/',
  authorizeGroupSuperadmin,
  asyncHandler(async (req, res) => {
    const rows = await service.listOrgs(req.user.org_group_ids);
    return ok(res, rows);
  })
);

router.post(
  '/',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createOrgSchema.parse(req.body);
    const result = await service.createOrganization(req.user.id, req.user.org_id, body);
    if (result.error === 'slug_taken') return fail(res, 409, 'Organization slug already in use');
    if (result.error === 'org_not_found') return fail(res, 404, 'Active organization not found');
    return created(res, result);
  })
);

router.get(
  '/locations',
  requireOrgMembership,
  asyncHandler(async (req, res) => {
    const rows = await service.listLocations(req.user.org_id);
    return ok(res, rows);
  })
);

router.post(
  '/locations',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createLocationSchema.parse(req.body);
    const result = await service.createLocation(req.user.org_id, body);
    if (result.error === 'name_taken') return fail(res, 409, 'Location name already in use');
    return created(res, result.location);
  })
);

router.patch(
  '/memberships/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = updateMembershipSchema.parse(req.body);
    const result = await service.updateMembership(req.user.org_id, req.params.id, body, req.user.id);
    if (result.error === 'not_found') return fail(res, 404, 'Org membership not found');
    if (result.error === 'future_team_change') return fail(res, 422, 'A team change can be effective today or earlier, not in the future');
    if (result.error === 'manager_not_found') return fail(res, 404, 'Manager membership not found in this org');
    if (result.error === 'team_not_found') return fail(res, 404, 'Team not found in this org');
    if (WORKER_ERRORS[result.error]) return fail(res, ...WORKER_ERRORS[result.error]);
    if (result.error === 'self_manager') return fail(res, 422, 'A membership cannot be its own manager');
    if (result.error === 'employee_code_taken') return fail(res, 409, 'Another employee in this company already has that employee code');
    return ok(res, result.membership);
  })
);

router.patch(
  '/:id/valuation',
  authorizeGroupSuperadmin,
  asyncHandler(async (req, res) => {
    const body = updateValuationSchema.parse(req.body);
    const result = await service.updateValuation(req.user.org_group_ids, req.params.id, body.valuation);
    if (result.error === 'not_found') return fail(res, 404, 'Organization not found in your holding group');
    return ok(res, result.org);
  })
);

router.patch(
  '/:id/settings',
  authorizeGroupSuperadmin,
  asyncHandler(async (req, res) => {
    const body = updateOrgSettingsSchema.parse(req.body);
    const result = await service.updateSettings(req.user.org_group_ids, req.params.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Organization not found in your holding group');
    return ok(res, result.org);
  })
);

module.exports = router;
