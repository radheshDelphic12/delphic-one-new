const express = require('express');
const { z } = require('zod');
const { can } = require('../../lib/permissions');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./aiClientSuggestions.service');

// Accounts > AI suggestions (Delphic Global): companies that could become clients and the service each could take. Seeing them needs Accounts > View,
// asking the AI and turning one into a lead needs Accounts > Create (the central route table decides; `can` covers companies still on roles).
const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace);

const ERRORS = {
  ai_unavailable: [503, 'The AI is not available right now (its key is not set or it did not answer). Please try again in a few minutes.'],
  not_found: [404, 'Suggestion not found'],
  already_added: [409, 'That suggestion is already a lead account'],
  account_exists: [409, 'A client account with that name already exists'],
};
const failFor = (res, r) => { const [status, message] = ERRORS[r.error] || [400, r.error]; return fail(res, status, message, r.account_id ? { account_id: r.account_id } : undefined); };
const result = (res, r, status = 200) => (r.error ? failFor(res, r) : status === 201 ? created(res, r) : ok(res, r));

const listQuery = z.object({ status: z.enum(['new', 'added', 'dismissed']).optional() });
const generateBody = z.object({ count: z.coerce.number().int().min(1).max(service.MAX_COUNT).optional(), focus: z.string().trim().max(300).optional() });
const uuid = z.string().uuid();

router.get('/', asyncHandler(async (req, res) => ok(res, await service.list(req.user.org_id, listQuery.parse(req.query)))));
router.post('/generate', can('accounts.create', 'bda', 'admin'), asyncHandler(async (req, res) => result(res, await service.generate(req.user.org_id, req.user, generateBody.parse(req.body || {})), 201)));
router.post('/:id/add', can('accounts.create', 'bda', 'admin'), asyncHandler(async (req, res) => result(res, await service.addAsLead(req.user.org_id, req.user, uuid.parse(req.params.id)))));
router.post('/:id/dismiss', can('accounts.create', 'bda', 'admin'), asyncHandler(async (req, res) => result(res, await service.dismiss(req.user.org_id, uuid.parse(req.params.id)))));
router.post('/:id/restore', can('accounts.create', 'bda', 'admin'), asyncHandler(async (req, res) => result(res, await service.restore(req.user.org_id, uuid.parse(req.params.id)))));

module.exports = router;
