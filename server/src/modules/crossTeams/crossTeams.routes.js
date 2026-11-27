const express = require('express');
const { z } = require('zod');
const { authenticate, authorizeGroupSuperadmin, requireOrgMembership } = require('../../middleware/auth');
const { can } = require('../../lib/permissions');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./crossTeams.service');

const ERRORS = {
  not_found: [404, 'Not found'],
  company_not_in_group: [422, 'Choose companies of this group'],
  person_not_in_companies: [422, 'Every member must work in one of the team\'s companies'],
  team_not_open: [422, 'That team is not open to this company'],
};
const problem = (res, r) => { const [s, m] = ERRORS[r.error] || [400, 'Bad request']; return fail(res, s, m); };
const uuid = z.string().uuid();

// Group Dashboard > Cross-functional teams (group superadmin): /api/v1/group-teams
const group = express.Router();
group.use(authenticate, authorizeGroupSuperadmin);
group.get('/', asyncHandler(async (req, res) => ok(res, await service.list(req.user.org_group_ids))));
group.get('/people', asyncHandler(async (req, res) => {
  const q = z.object({ search: z.string().trim().max(100).optional(), company_ids: z.string().optional() }).parse(req.query);
  return ok(res, await service.people(req.user.org_group_ids, { search: q.search, company_ids: q.company_ids ? q.company_ids.split(',').filter(Boolean) : [] }));
}));
group.post('/', asyncHandler(async (req, res) => {
  const r = await service.create(req.user.org_group_ids, req.user.id, service.teamSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.team);
}));
group.patch('/:id', asyncHandler(async (req, res) => {
  const r = await service.update(req.user.org_group_ids, uuid.parse(req.params.id), service.teamUpdateSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.team);
}));
group.delete('/:id', asyncHandler(async (req, res) => {
  const r = await service.remove(req.user.org_group_ids, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r);
}));
group.put('/:id/members', asyncHandler(async (req, res) => {
  const r = await service.setMembers(req.user.org_group_ids, uuid.parse(req.params.id), service.membersSchema.parse(req.body || {}).members);
  return r.error ? problem(res, r) : ok(res, r.team);
}));

// A company's people screens: /api/v1/cross-teams (the teams open to this company; one employee's teams, set by People > Edit)
const company = express.Router();
company.use(authenticate, requireOrgMembership);
company.get('/', asyncHandler(async (req, res) => ok(res, await service.teamsForCompany(req.user.org_id))));
company.get('/people/:membershipId', asyncHandler(async (req, res) => {
  const r = await service.personTeams(req.user.org_id, uuid.parse(req.params.membershipId));
  return r.error ? problem(res, r) : ok(res, r);
}));
company.put('/people/:membershipId', can('people.update', 'admin'), asyncHandler(async (req, res) => {
  const r = await service.setPersonTeams(req.user.org_id, uuid.parse(req.params.membershipId), service.personTeamsSchema.parse(req.body || {}).team_ids);
  return r.error ? problem(res, r) : ok(res, r);
}));

module.exports = { group, company };
