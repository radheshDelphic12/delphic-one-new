const express = require('express');
const { authenticate, authorize, authorizeGroupSuperadmin, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./orgs.service');
const { WORKER_ERRORS } = require('../../lib/workerType');
const { approverScope } = require('../../lib/claimApprovers');
const prisma = require('../../config/db');
const { adminPower } = require('../../lib/access/guard');
const { restrictMembership } = require('../../lib/access/fields');
const accessService = require('../access/access.service');
const {
  createOrgSchema,
  createLocationSchema,
  updateLocationSchema,
  membershipListQuerySchema,
  personalDetailsSchema,
  updateMembershipSchema,
  joiningDateSchema,
  updateValuationSchema,
  updateOrgSettingsSchema,
} = require('./orgs.validation');

const router = express.Router();

const JOINED_AFTER_EXIT = 'The joining date cannot be after the last working day';

// Admins, and members of the HR department (same rule as HR claim approval).
async function canEditJoiningDate(user) {
  if (adminPower(user, 'people.update')) return true;
  return (await approverScope(user)).hr;
}
router.use(authenticate);

router.get(
  '/me/memberships',
  asyncHandler(async (req, res) => {
    const rows = await service.listMyMemberships(req.user.id);
    return ok(res, rows);
  })
);

// --- Bank + emergency contact: the employee's own (portal), or anyone's for an admin. ---

// Bank, identity numbers and emergency contact: the employee, or someone holding the People permission (the Admin always).
const canSeePersonal = (req, membershipId, key = 'people.view') => adminPower(req.user, key) || membershipId === req.user.org_membership_id;

// Nobody but the Super Admin edits or removes the Super Admin's membership.
async function superAdminTargetBlocked(req) {
  const m = await prisma.orgMembership.findFirst({ where: { id: req.params.id, org_id: req.user.org_id }, select: { person: { select: { is_group_superadmin: true } } } });
  if (!m?.person?.is_group_superadmin) return false;
  return (await accessService.actorLevel(req.user.id, req.user.role)) !== 'super_admin';
}

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
    if (!canSeePersonal(req, req.params.id, 'people.update')) return fail(res, 403, 'Only an admin or the employee can change these details');
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
    return ok(res, rows.map((r) => restrictMembership(req.user, r)));
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

// Birthdays and work anniversaries in the next N days (default 14): People highlights and the dashboard's Announcements card.
router.get(
  '/announcements',
  requireOrgMembership,
  asyncHandler(async (req, res) => {
    const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
    return ok(res, await require('./announcements.service').upcoming(req.user.org_id, { days }));
  })
);

// Employees currently on the bench (not allocated to any project today), with the days left: the dashboard section.
router.get(
  '/bench',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await require('../bench/bench.service').onBench(req.user.org_id)))
);

router.get(
  '/memberships/:id',
  requireOrgMembership,
  asyncHandler(async (req, res) => {
    const row = await service.getMembership(req.user.org_id, req.params.id);
    if (!row) return fail(res, 404, 'Org membership not found');
    return ok(res, { ...restrictMembership(req.user, row), can_edit_joining_date: await canEditJoiningDate(req.user) });
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
  '/locations/overview',
  requireOrgMembership,
  asyncHandler(async (req, res) => ok(res, await service.officesOverview(req.user.org_id, { work_mode: req.query.work_mode, status: req.query.status, user_type: req.query.user_type, department_id: req.query.department_id })))
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

// Edit a location; is_default: true makes it THE default (the flag moves).
router.patch(
  '/locations/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = updateLocationSchema.parse(req.body);
    const result = await service.updateLocation(req.user.org_id, req.params.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Location not found');
    if (result.error === 'name_taken') return fail(res, 409, 'Location name already in use');
    return ok(res, result.location);
  })
);

router.delete(
  '/locations/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.deleteLocation(req.user.org_id, req.params.id);
    if (result.error === 'not_found') return fail(res, 404, 'Location not found');
    if (result.error === 'in_use') {
      const uses = [[result.employees, 'employee'], [result.calendars, 'calendar'], [result.claims, 'expense claim']].filter(([n]) => n).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`);
      return fail(res, 409, `This location is still used by ${uses.join(', ')} — move them to another location first`);
    }
    return ok(res, { deleted: true });
  })
);

// Soft delete of an employee (restorable from Group Dashboard > Logs). A person with locked attendance months or a processed
// payroll cannot be deleted: reopen those first. Terminating someone (the normal way to let a person go) is a status, not this.
router.delete(
  '/memberships/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 3) return fail(res, 422, 'Give a reason of at least 3 characters');
    if (req.params.id === req.user.org_membership_id) return fail(res, 422, 'You cannot delete your own membership');
    if (await superAdminTargetBlocked(req)) return fail(res, 403, 'Only the Super Admin can change the Super Admin');
    const result = await require('../admin/admin.service').softDeleteRecord('employee', req.params.id, reason.slice(0, 500), req.user, { orgId: req.user.org_id });
    if (result.error === 'not_found') return fail(res, 404, 'Org membership not found');
    if (result.error === 'already_deleted') return fail(res, 409, 'Already deleted');
    if (result.error) return fail(res, ...(require('../../lib/softDeleteErrors')[result.error] || [400, 'Cannot delete']));
    return ok(res, { deleted: true, dependency: result.result.dependency });
  })
);

router.patch(
  '/memberships/:id',
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = updateMembershipSchema.parse(req.body);
    if (await superAdminTargetBlocked(req)) return fail(res, 403, 'Only the Super Admin can change the Super Admin');
    const result = await service.updateMembership(req.user.org_id, req.params.id, body, req.user.id);
    if (result.error === 'not_found') return fail(res, 404, 'Org membership not found');
    if (result.error === 'future_team_change') return fail(res, 422, 'A team change can be effective today or earlier, not in the future');
    if (result.error === 'manager_not_found') return fail(res, 404, 'Manager membership not found in this org');
    if (result.error === 'team_not_found') return fail(res, 404, 'Team not found in this org');
    if (WORKER_ERRORS[result.error]) return fail(res, ...WORKER_ERRORS[result.error]);
    if (result.error === 'self_manager') return fail(res, 422, 'A membership cannot be its own manager');
    if (result.error === 'lwd_before_notice') return fail(res, 422, 'The last working day cannot be before the notice date');
    if (result.error === 'employee_code_taken') return fail(res, 409, 'Another employee in this company already has that employee code');
    if (result.error === 'joined_after_exit') return fail(res, 422, JOINED_AFTER_EXIT);
    if (result.error === 'bench_end_before_start') return fail(res, 422, 'The bench end date cannot be before the start date');
    if (result.error === 'bench_end_without_start') return fail(res, 422, 'Set the bench start date first');
    return ok(res, { ...result.membership, can_edit_joining_date: true });
  })
);

// Date of joining: admins (also via the full edit above) and anyone in the HR
// department — HR may change this field only.
router.patch(
  '/memberships/:id/joining-date',
  requireOrgMembership,
  asyncHandler(async (req, res) => {
    if (!(await canEditJoiningDate(req.user))) return fail(res, 403, 'Only admins and HR can change the joining date');
    const body = joiningDateSchema.parse(req.body);
    const result = await service.updateMembership(req.user.org_id, req.params.id, { joined_at: body.joined_at }, req.user.id);
    if (result.error === 'not_found') return fail(res, 404, 'Org membership not found');
    if (result.error === 'joined_after_exit') return fail(res, 422, JOINED_AFTER_EXIT);
    return ok(res, { ...result.membership, can_edit_joining_date: true });
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
