const express = require('express');
const { z } = require('zod');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./interviewFeedback.service');

// Interview feedback (Delphic Global): the page where an interviewer, HR or an admin gives the feedback of a round. Open to every signed-in
// person (basic.interview_feedback); the service shows each one only their own rounds (HR and admins: all). Saving goes through PATCH /interview-rounds/:id.
const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace);

const result = (res, r) => (r.error ? fail(res, r.error === 'forbidden' ? 403 : 404, r.error === 'forbidden' ? 'You are not assigned to this interview' : 'Not found') : ok(res, r));

router.get('/mine', asyncHandler(async (req, res) => ok(res, await service.mine(req.user))));
router.get('/all', asyncHandler(async (req, res) => result(res, await service.all(req.user, { pending: req.query.pending === '1' }))));
router.get('/submission/:id', asyncHandler(async (req, res) => result(res, await service.forSubmission(req.user, z.string().uuid().parse(req.params.id)))));

module.exports = router;
