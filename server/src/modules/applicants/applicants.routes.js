const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, fail } = require('../../utils/response');
const service = require('./applicants.service');

const router = express.Router();
router.use(authenticate, requireMasterWorkspace);

const ERRORS = {
  not_found: [404, 'Applicant not found'],
  requirement_not_found: [404, 'Requirement not found'],
  requirement_not_in_progress: [409, 'Only in-progress requirements take applicants'],
  duplicate_applicant: [409, 'This person (email or phone) has already applied to this requirement'],
  already_assigned: [409, 'Someone has already taken this applicant'],
  not_assigned: [409, 'This applicant is not assigned'],
  not_a_recruiter: [422, 'Applicants can only be given to a recruiter'],
  forbidden: [403, 'You cannot do that'],
};
const result = (res, r, key, status = 200) => {
  if (r.error) {
    const m = ERRORS[r.error] || [400, 'Bad request'];
    return fail(res, m[0], m[1]);
  }
  return key ? ok(res, r[key], {}, status) : ok(res, r, {}, status);
};

router.get('/requirements', authorize('admin', 'sales', 'recruiter'), asyncHandler(async (req, res) => ok(res, await service.inProgressRequirements())));
router.get(
  '/',
  authorize('admin', 'sales', 'recruiter'),
  asyncHandler(async (req, res) => {
    const { rows, pagination, counts } = await service.list(req.user, req.query);
    return ok(res, rows, { pagination, counts });
  })
);
router.post('/', authorize('admin', 'sales', 'recruiter'), asyncHandler(async (req, res) => result(res, await service.addApplicant(req.user, req.body), 'applicant', 201)));
router.post('/:id/assign', authorize('admin', 'recruiter'), asyncHandler(async (req, res) => result(res, await service.assign(req.user, req.params.id, req.body), 'applicant')));
router.post('/:id/release', authorize('admin', 'recruiter'), asyncHandler(async (req, res) => result(res, await service.release(req.user, req.params.id), 'applicant')));
router.delete('/:id', authorize('admin'), asyncHandler(async (req, res) => result(res, await service.remove(req.user, req.params.id))));

module.exports = router;
