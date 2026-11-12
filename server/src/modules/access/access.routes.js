const express = require('express');
const { z } = require('zod');
const { authenticate, requireOrgMembership, authorizeGroupSuperadmin } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./access.service');
const migration = require('./migration.service');

// Settings > Permissions. Reading your own access and the catalogue is for everyone signed in; changing anyone's access is for the
// Super Admin (any company) and the company Admin (their own company) only. The moving of a company to this model is Super Admin only.
const router = express.Router();
router.use(authenticate, requireOrgMembership);

async function manager(req, res, next) {
  try {
    const level = await service.actorLevel(req.user.id, req.user.role);
    if (level === 'employee') return fail(res, 403, 'Only the Super Admin or the company Admin can change permissions');
    req.actorLevel = level;
    return next();
  } catch (err) {
    return next(err);
  }
}

const ERRORS = {
  forbidden: [403, 'Only the Super Admin or the company Admin can change permissions'],
  not_migrated: [409, 'This company has not moved to permissions yet. Review and apply the migration first.'],
  membership_not_found: [404, 'Person not found in this company'],
  contractor: [422, 'Contractors use the contractor portal and have no permissions'],
  target_is_admin: [422, 'The Super Admin and the company Admin always have full access and cannot be edited here'],
  set_not_found: [404, 'Permission set not found'],
  already_applied: [409, 'This company already uses permissions'],
  backup_required: [409, 'Take a backup first (it must be less than a day old)'],
  plan_changed: [409, 'Access changed since you previewed it. Reload the preview and review it again.'],
  admin_required: [422, 'Choose the one Admin account for this company'],
  unknown_set: [422, 'One of the chosen permission sets does not exist'],
  not_applied: [409, 'This company is not on permissions yet'],
  no_backup: [404, 'No backup to restore from'],
  window_closed: [409, 'The 30-day restore window has closed'],
  window_open: [409, 'The 30-day window is still open'],
};
const respond = (res, result, status = 200) => (result.error ? fail(res, ...(ERRORS[result.error] || [422, result.error])) : ok(res, result, {}, status));

const grantValue = z.union([z.boolean(), z.string().max(10)]); // a scope the key does not accept is dropped by the service
const personBody = z.object({
  set_id: z.string().uuid().nullable().optional(),
  grants: z.record(grantValue).optional(),
  removed: z.array(z.string().max(80)).max(200).optional(),
});
const applyBody = z.object({
  plan_hash: z.string().length(64),
  admin_membership_id: z.string().uuid(),
  assignments: z.array(z.object({ org_membership_id: z.string().uuid(), set_name: z.string().trim().min(1).max(60).nullable() })).max(2000).default([]),
});

router.get('/catalog', asyncHandler(async (req, res) => ok(res, service.catalog())));
router.get('/me', asyncHandler(async (req, res) => ok(res, service.me(req.user))));

router.get('/people', manager, asyncHandler(async (req, res) => ok(res, await service.people(req.user.org_id))));
router.get('/people/:id', manager, asyncHandler(async (req, res) => respond(res, await service.person(req.user.org_id, req.params.id))));
router.post('/people/:id/preview', manager, asyncHandler(async (req, res) => respond(res, await service.savePerson(req.user.org_id, req.user, req.params.id, personBody.parse(req.body), { dryRun: true }))));
router.put('/people/:id', manager, asyncHandler(async (req, res) => respond(res, await service.savePerson(req.user.org_id, req.user, req.params.id, personBody.parse(req.body)))));

// Moving a company to the permission model: Super Admin only.
router.get('/migration/status', authorizeGroupSuperadmin, asyncHandler(async (req, res) => ok(res, await migration.status(req.user.org_group_ids))));
router.get('/migration/preview', authorizeGroupSuperadmin, asyncHandler(async (req, res) => ok(res, await migration.preview(req.user.org_id))));
router.post('/migration/backup', authorizeGroupSuperadmin, asyncHandler(async (req, res) => ok(res, await migration.backup(req.user.org_id, req.user.id, typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : null), {}, 201)));
router.post('/migration/apply', authorizeGroupSuperadmin, asyncHandler(async (req, res) => respond(res, await migration.apply(req.user.org_id, req.user.id, applyBody.parse(req.body)))));
router.post('/migration/restore', authorizeGroupSuperadmin, asyncHandler(async (req, res) => respond(res, await migration.restore(req.user.org_id))));
router.get('/migration/cleanup', authorizeGroupSuperadmin, asyncHandler(async (req, res) => ok(res, await migration.cleanupStatus(req.user.org_id))));
router.post('/migration/cleanup', authorizeGroupSuperadmin, asyncHandler(async (req, res) => respond(res, await migration.cleanup(req.user.org_id))));

module.exports = router;
