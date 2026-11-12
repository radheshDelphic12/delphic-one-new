const express = require('express');
const { z } = require('zod');
const { authenticate, authorizeGroupSuperadmin } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./groupOffices.service');

const router = express.Router();
router.use(authenticate, authorizeGroupSuperadmin);

const uuid = z.string().uuid();
const filterSchema = z.object({
  status: z.enum(['working', 'active', 'on_leave', 'pending_onboarding', 'notice_period', 'terminated', 'all']).optional(),
  work_mode: z.enum(['remote', 'onsite', 'hybrid', 'not_set']).optional(),
  user_type: z.enum(['full_time_employee', 'contractor']).optional(),
});
const peopleSchema = filterSchema.extend({
  org_id: uuid.optional(),
  location_id: z.union([uuid, z.literal('none')]).optional(),
  office_name: z.string().trim().min(1).max(100).optional(),
});
const createSchema = z.object({
  org_id: uuid,
  name: z.string().trim().min(1).max(100),
  city: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  address: z.string().trim().max(500).optional(),
  is_default: z.boolean().default(false),
});
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    city: z.string().trim().max(100).nullable().optional(),
    country: z.string().trim().max(100).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    is_default: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Change at least one field' });

function problem(res, error, result) {
  if (error === 'forbidden') return fail(res, 403, 'That company is outside your group');
  if (error === 'not_found') return fail(res, 404, 'Location not found');
  if (error === 'name_taken') return fail(res, 409, 'This company already has a location with that name');
  if (error === 'in_use') {
    const uses = [[result.employees, 'employee'], [result.calendars, 'calendar'], [result.claims, 'expense claim']].filter(([n]) => n).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`);
    return fail(res, 409, `This location is still used by ${uses.join(', ')} - move them to another location first`);
  }
  return fail(res, 400, 'Bad request');
}

router.get('/', asyncHandler(async (req, res) => ok(res, await service.overview(req.user.org_group_ids, filterSchema.parse(req.query)))));

router.get('/people', asyncHandler(async (req, res) => {
  const result = await service.people(req.user.org_group_ids, peopleSchema.parse(req.query));
  return result.error ? problem(res, result.error) : ok(res, result);
}));

router.post('/locations', asyncHandler(async (req, res) => {
  const result = await service.addLocation(req.user.org_group_ids, createSchema.parse(req.body));
  return result.error ? problem(res, result.error, result) : created(res, result.location);
}));

router.patch('/memberships/:membershipId/location', asyncHandler(async (req, res) => {
  const { location_id } = z.object({ location_id: uuid }).parse(req.body);
  const result = await service.assignOffice(req.user.org_group_ids, uuid.parse(req.params.membershipId), location_id);
  if (result.error === 'membership_not_found') return fail(res, 404, 'Employee not found in your group');
  if (result.error === 'location_mismatch') return fail(res, 400, 'Choose an office that belongs to the employee\'s company');
  return ok(res, result);
}));

router.patch('/:orgId/locations/:id',asyncHandler(async (req, res) => {
  const result = await service.editLocation(req.user.org_group_ids, uuid.parse(req.params.orgId), uuid.parse(req.params.id), updateSchema.parse(req.body));
  return result.error ? problem(res, result.error, result) : ok(res, result.location);
}));

router.delete('/:orgId/locations/:id', asyncHandler(async (req, res) => {
  const result = await service.removeLocation(req.user.org_group_ids, uuid.parse(req.params.orgId), uuid.parse(req.params.id));
  return result.error ? problem(res, result.error, result) : ok(res, { deleted: true });
}));

module.exports = router;
