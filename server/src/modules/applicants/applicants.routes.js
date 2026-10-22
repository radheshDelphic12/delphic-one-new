const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, fail } = require('../../utils/response');
const path = require('path');
const fs = require('fs');
const env = require('../../config/env');
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
  already_rejected: [409, 'This applicant is already rejected'],
  not_rejected: [409, 'This applicant is not rejected'],
  cannot_reject: [409, 'This applicant cannot be rejected from here'],
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

// Where the public careers pages are reachable (the website's address once its rewrite is live), for the "Copy link" button.
router.get('/career-base', authorize('admin', 'sales', 'recruiter'), asyncHandler(async (req, res) => ok(res, { base: env.publicCareersBase || null })));
// Which in-progress jobs are live on the website, as {requirement_id, slug} only, so a recruiter can copy a job's link
// without having the website-management permission (the full postings list stays behind /website/postings).
router.get('/published-links', authorize('admin', 'sales', 'recruiter'), asyncHandler(async (req, res) => {
  const rows = await require('../website/postings.service').list(req.user.org_id, { status: 'published' });
  return ok(res, rows.filter((p) => p.slug).map((p) => ({ requirement_id: p.requirement_id, slug: p.slug })));
}));
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
// The CV a candidate attached on the public apply form. Only recruiters / sales / admins of the master workspace get it.
router.get('/:id/cv', authorize('admin', 'sales', 'recruiter'), asyncHandler(async (req, res) => {
  const cv = await service.cvFileOf(req.params.id);
  const root = path.resolve(env.uploadDir);
  if (!cv || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(cv.filename) || !fs.existsSync(path.join(root, cv.filename))) return fail(res, 404, 'No CV attached');
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.attachment(cv.name.replace(/[^A-Za-z0-9 ._-]/g, '') || cv.filename);
  return res.sendFile(cv.filename, { root, dotfiles: 'deny' });
}));
router.patch('/:id', authorize('admin', 'sales', 'recruiter'), asyncHandler(async (req, res) => result(res, await service.updateApplicant(req.user, req.params.id, req.body), 'applicant')));
router.post('/:id/assign', authorize('admin', 'recruiter'), asyncHandler(async (req, res) => result(res, await service.assign(req.user, req.params.id, req.body), 'applicant')));
router.post('/:id/release', authorize('admin', 'recruiter'), asyncHandler(async (req, res) => result(res, await service.release(req.user, req.params.id), 'applicant')));
router.post('/:id/create-profile', authorize('admin', 'recruiter'), asyncHandler(async (req, res) => result(res, await service.createProfile(req.user, req.params.id), 'applicant')));
router.post('/:id/reject', authorize('admin', 'sales', 'recruiter'), asyncHandler(async (req, res) => result(res, await service.reject(req.user, req.params.id, req.body), 'applicant')));
router.post('/:id/unreject', authorize('admin', 'sales', 'recruiter'), asyncHandler(async (req, res) => result(res, await service.unreject(req.user, req.params.id), 'applicant')));
router.post('/:id/unlink', authorize('admin', 'recruiter'), asyncHandler(async (req, res) => result(res, await service.unlink(req.user, req.params.id), 'applicant')));
router.delete('/:id', authorize('admin', 'sales', 'recruiter'), asyncHandler(async (req, res) => result(res, await service.remove(req.user, req.params.id, typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : undefined))));

module.exports = router;
