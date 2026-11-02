const express = require('express');
const { z } = require('zod');
const { authenticate, authorizeGroupSuperadmin } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./groupCompanies.service');

const router = express.Router();
router.use(authenticate, authorizeGroupSuperadmin);

const uuid = z.string().uuid();
const text = (max) => z.string().trim().max(max);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const status = z.enum(['operational', 'planning', 'future']);

const createSchema = z.object({
  org_group_id: uuid.optional(),
  name: text(150).min(1),
  short_code: text(12).optional(),
  sector: text(100).optional(),
  tagline: text(300).optional(),
  foundation_date: ymd.optional(),
  status: status.default('planning'),
  notes: text(2000).optional(),
});
const updateSchema = z
  .object({
    name: text(150).min(1).optional(),
    short_code: text(12).nullable().optional(),
    sector: text(100).nullable().optional(),
    tagline: text(300).nullable().optional(),
    foundation_date: ymd.nullable().optional(),
    status: status.optional(),
    notes: text(2000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Change at least one field' });
const stakesSchema = z.object({
  stakes: z
    .array(z.object({
      holder_kind: z.enum(['group', 'company', 'external']),
      holder_company_id: uuid.optional(),
      holder_name: text(150).optional(),
      pct: z.coerce.number().gt(0).max(100),
      notes: text(300).optional(),
    }))
    .max(30),
});

const MESSAGES = {
  group_required: [400, 'Choose which holding group this business belongs to'],
  exists_as_workspace: [409, 'That company already exists as a workspace of the group'],
  name_taken: [409, 'A business with that name is already in the register'],
  name_linked: [409, 'This company is a workspace; rename it in its Settings'],
  not_found: [404, 'Not found'],
  linked_company: [409, 'This company has a workspace, so it stays in the register. Only planned or off-platform businesses can be removed'],
  bad_holder: [400, 'Each holder must be the group, a business of the register, or a named outsider'],
  duplicate_holder: [400, 'The same holder is listed twice'],
  self_holder: [400, 'A business cannot hold itself'],
  holder_name_needed: [400, 'Give the outside holder a name'],
  holder_not_found: [400, 'A holder is not a business of this group'],
  ownership_loop: [400, 'That would make two businesses own each other (directly or through others)'],
};
const problem = (res, result) => {
  if (result.error === 'over_100') return fail(res, 400, `The holders add up to ${result.total}%, which is more than 100%`);
  const [status_, message] = MESSAGES[result.error] || [400, 'Bad request'];
  return fail(res, status_, message);
};

router.get('/', asyncHandler(async (req, res) => ok(res, await service.list(req.user.org_group_ids))));

router.post('/', asyncHandler(async (req, res) => {
  const result = await service.create(req.user.org_group_ids, req.user.id, createSchema.parse(req.body));
  return result.error ? problem(res, result) : created(res, result.company);
}));

router.post('/stakes/group-default', asyncHandler(async (req, res) => ok(res, await service.setGroupDefault(req.user.org_group_ids))));

router.patch('/:id', asyncHandler(async (req, res) => {
  const result = await service.update(req.user.org_group_ids, uuid.parse(req.params.id), updateSchema.parse(req.body));
  return result.error ? problem(res, result) : ok(res, result.company);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await service.remove(req.user.org_group_ids, uuid.parse(req.params.id));
  return result.error ? problem(res, result) : ok(res, result);
}));

router.put('/:id/stakes', asyncHandler(async (req, res) => {
  const result = await service.setStakes(req.user.org_group_ids, uuid.parse(req.params.id), stakesSchema.parse(req.body).stakes);
  return result.error ? problem(res, result) : ok(res, result);
}));

module.exports = router;
