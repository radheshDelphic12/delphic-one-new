const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/db');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./roles.service');

// Settings > Roles & permissions: the Super Admin (or the Group Super Admin, in the company they have open) builds roles and
// gives them to people. Everyone signed in may read the catalogue; changing anything is for those two only.
const router = express.Router();
router.use(authenticate, requireOrgMembership);

async function authorizeRoleManager(req, res, next) {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { is_superadmin: true, is_group_superadmin: true, active: true } });
    if (!u || !u.active || !(u.is_superadmin || u.is_group_superadmin) || req.user.role !== 'admin') return fail(res, 403, 'Only a Super Admin can manage roles');
    return next();
  } catch (err) {
    return next(err);
  }
}

const permissions = z.record(z.union([z.boolean(), z.enum(['own', 'team', 'all'])])).default({});
const baseRole = z.enum(service.BASE_ROLES);
const createBody = z.object({ name: z.string().trim().min(2).max(60), description: z.string().trim().max(300).nullable().optional(), base_role: baseRole.optional(), permissions });
const updateBody = z.object({ name: z.string().trim().min(2).max(60).optional(), description: z.string().trim().max(300).nullable().optional(), base_role: baseRole.optional(), permissions: permissions.optional() });
const assignBody = z.object({ org_membership_id: z.string().uuid().optional(), user_id: z.string().uuid().optional(), role_id: z.string().uuid().nullable() }).refine((v) => v.org_membership_id || v.user_id, { message: 'org_membership_id or user_id is required' });
const mappingBody = z.object({ assignments: z.array(z.object({ org_membership_id: z.string().uuid(), role_name: z.string().trim().min(1).max(60) })).min(1).max(50) });

const ERRORS = {
  not_found: [404, 'Role not found'],
  membership_not_found: [404, 'Person not found in this company'],
  name_taken: [409, 'A role with this name already exists'],
  bad_base_role: [422, 'Unknown base role'],
  contractor: [422, 'Contractors use the contractor portal and cannot get a custom role'],
};
const respond = (res, result, key, status = 200) => {
  if (result.error === 'in_use') return fail(res, 409, `This role is given to ${result.members} ${result.members === 1 ? 'person' : 'people'}. Move them to another role first.`);
  if (result.error) return fail(res, ...(ERRORS[result.error] || [422, result.error]));
  return ok(res, key ? result[key] : result, {}, status);
};

router.get('/catalog', asyncHandler(async (req, res) => ok(res, service.catalog())));
router.get('/', authorizeRoleManager, asyncHandler(async (req, res) => ok(res, await service.list(req.user.org_id))));
router.post('/', authorizeRoleManager, asyncHandler(async (req, res) => respond(res, await service.create(req.user.org_id, req.user.id, createBody.parse(req.body)), 'role', 201)));
router.post('/starter', authorizeRoleManager, asyncHandler(async (req, res) => ok(res, await service.installStarterRoles(req.user.org_id, req.user.id))));
router.get('/mapping-preview', authorizeRoleManager, asyncHandler(async (req, res) => ok(res, await service.mappingPreview(req.user.org_id))));
router.post('/mapping-apply', authorizeRoleManager, asyncHandler(async (req, res) => ok(res, await service.applyMapping(req.user.org_id, req.user.id, mappingBody.parse(req.body).assignments))));
router.post('/assign', authorizeRoleManager, asyncHandler(async (req, res) => {
  const b = assignBody.parse(req.body);
  const membershipId = b.org_membership_id || (await prisma.orgMembership.findUnique({ where: { person_id_org_id: { person_id: b.user_id, org_id: req.user.org_id } }, select: { id: true } }))?.id;
  return respond(res, await service.assign(req.user.org_id, membershipId || null, b.role_id));
}));
router.get('/:id/members', authorizeRoleManager, asyncHandler(async (req, res) => ok(res, await service.members(req.user.org_id, req.params.id))));
router.patch('/:id', authorizeRoleManager, asyncHandler(async (req, res) => respond(res, await service.update(req.user.org_id, req.params.id, updateBody.parse(req.body)), 'role')));
router.delete('/:id', authorizeRoleManager, asyncHandler(async (req, res) => respond(res, await service.remove(req.user.org_id, req.params.id))));

module.exports = router;
