const express = require('express');
const { z } = require('zod');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./employeeFeedback.service');

// Employee Feedback: Delphic Global (the master workspace) for now. Everyone signed in may give feedback and follow their own; only the board
// (people an admin names) reads it - the service decides that, not the route table.

const ERRORS = {
  forbidden: [403, 'Only the board can do that'],
  not_found: [404, 'Not found'],
  bad_people: [422, 'Pick people who are in this company'],
};
const failFor = (res, code) => fail(res, ...(ERRORS[code] || [400, code]));
const result = (res, r, status = 200) => (r.error ? failFor(res, r.error) : status === 201 ? created(res, r) : ok(res, r));

const submitBody = z.object({
  category: z.enum(service.CATEGORY_IDS),
  subject: z.string().trim().min(3, 'Give it a short title').max(150),
  message: z.string().trim().min(10, 'Write a little more so the board can understand').max(5000),
  anonymous: z.boolean().optional().default(false),
});
const listQuery = z.object({ status: z.enum(service.STATUS_IDS).optional(), category: z.enum(service.CATEGORY_IDS).optional() });
const patchBody = z.object({
  status: z.enum(service.STATUS_IDS).optional(),
  board_note: z.string().trim().max(3000).nullish(),
}).refine((b) => b.status !== undefined || b.board_note !== undefined, 'Nothing to change');
const boardBody = z.object({ membership_ids: z.array(z.string().uuid()).max(50) });

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace);

router.get('/meta', asyncHandler(async (req, res) => ok(res, await service.meta(req.user))));
router.post('/', asyncHandler(async (req, res) => result(res, await service.submit(req.user, submitBody.parse(req.body)), 201)));
router.get('/mine', asyncHandler(async (req, res) => ok(res, await service.mine(req.user))));

router.get('/board', asyncHandler(async (req, res) => result(res, await service.getBoard(req.user))));
router.put('/board', asyncHandler(async (req, res) => result(res, await service.setBoard(req.user, boardBody.parse(req.body).membership_ids))));

router.get('/', asyncHandler(async (req, res) => result(res, await service.list(req.user, listQuery.parse(req.query)))));
router.patch('/:id', asyncHandler(async (req, res) => result(res, await service.update(req.user, req.params.id, patchBody.parse(req.body)))));

module.exports = router;
