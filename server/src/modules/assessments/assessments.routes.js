const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const env = require('../../config/env');
const { authenticate, authorize } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const service = require('./assessments.service');
const analytics = require('./assessmentAnalytics.service');

const ERRORS = {
  not_found: [404, 'Not found'],
  invalid_questions: [400, 'One or more questions do not exist'],
  too_many_per_candidate: [400, 'Questions per candidate cannot be more than the questions in the test'],
  empty_test: [400, 'Add questions to the test before sending it'],
  already_submitted: [410, 'This test has already been submitted'],
  expired: [410, 'This link has expired. Ask the recruiter for a new one'],
  superseded: [410, 'This link was replaced by a newer one. Ask the recruiter for the latest link'],
  already_completed: [409, 'This candidate already has a scored test for this round. An admin can delete the result to allow a retake'],
  in_progress: [409, 'The candidate is in the middle of this test. Wait for it to be submitted, or ask an admin to delete the attempt'],
  not_submitted: [409, 'The candidate has not submitted this test yet, so there are no answers to review'],
  not_extendable: [409, 'Only an unfinished, current link can be extended'],
};
const mapError = (res, error) => fail(res, ...(ERRORS[error] || [400, 'Bad request']));

const optionSchema = z.object({ text: z.string().trim().min(1), marks: z.number().min(0).max(100) });
const questionSchema = z.object({
  category: z.enum(service.CATEGORIES),
  text: z.string().trim().min(1),
  options: z.array(optionSchema).min(2).max(8).refine((o) => o.some((x) => x.marks > 0), 'At least one option must carry marks'),
  is_active: z.boolean().optional(),
});
const testSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  pass_percentage: z.number().int().min(1).max(100).default(60),
  duration_minutes: z.number().int().min(1).max(600).nullable().optional(),
  questions_per_candidate: z.number().int().min(1).max(200).nullable().optional(),
  is_active: z.boolean().optional(),
  question_ids: z.array(z.string().uuid()).default([]),
});

// ---- team side (login) ----
const router = express.Router();
router.use(authenticate, requireMasterWorkspace);

router.get('/questions', asyncHandler(async (req, res) => ok(res, await service.listQuestions({
  category: service.CATEGORIES.includes(req.query.category) ? req.query.category : undefined,
  includeInactive: req.query.include_inactive === 'true',
}))));
router.post('/questions', authorize('admin', 'recruiter', 'sales'), asyncHandler(async (req, res) => created(res, await service.createQuestion(questionSchema.parse(req.body), req.user.id))));
router.patch('/questions/:id', authorize('admin', 'recruiter', 'sales'), asyncHandler(async (req, res) => {
  const r = await service.updateQuestion(req.params.id, questionSchema.partial().parse(req.body));
  return r.error ? mapError(res, r.error) : ok(res, r.question);
}));

router.get('/tests', asyncHandler(async (req, res) => ok(res, await service.listTests(req.query.include_inactive === 'true'))));
router.get('/tests/:id', asyncHandler(async (req, res) => {
  const t = await service.getTest(req.params.id);
  return t ? ok(res, t) : mapError(res, 'not_found');
}));
router.post('/tests', authorize('admin', 'recruiter', 'sales'), asyncHandler(async (req, res) => {
  const r = await service.createTest(testSchema.parse(req.body), req.user.id);
  return r.error ? mapError(res, r.error) : created(res, r.test);
}));
router.patch('/tests/:id', authorize('admin', 'recruiter', 'sales'), asyncHandler(async (req, res) => {
  const r = await service.updateTest(req.params.id, testSchema.partial().parse(req.body));
  return r.error ? mapError(res, r.error) : ok(res, r.test);
}));

router.get('/attempts', asyncHandler(async (req, res) => {
  const submissionId = z.string().uuid().parse(req.query.submission_id);
  return ok(res, await service.listAttempts({ submissionId }, req.user));
}));
router.post('/attempts', authorize('admin', 'recruiter', 'sales'), asyncHandler(async (req, res) => {
  const body = z.object({ test_id: z.string().uuid(), submission_id: z.string().uuid(), override_limit: z.boolean().optional() }).parse(req.body);
  const r = await service.invite({ testId: body.test_id, submissionId: body.submission_id, overrideLimit: body.override_limit }, req.user);
  if (r.error === 'limit_reached') return fail(res, 409, `This submission has used ${r.used} of ${r.limit} allowed tests. An admin can raise the limit, delete an attempt or send one anyway`);
  return r.error ? mapError(res, r.error) : created(res, { ...r.attempt, link: r.link, superseded: r.superseded });
}));
// The answers of a submitted attempt, marked right / wrong (for the team only; never sent to the candidate).
router.get('/attempts/:id/review', asyncHandler(async (req, res) => {
  const r = await service.reviewAttempt(z.string().uuid().parse(req.params.id));
  return r.error ? mapError(res, r.error) : ok(res, r.review);
}));
// Admin only: remove a link or a scored result (the candidate can then be sent a new test), or give a link more time. Audited.
router.delete('/attempts/:id', authorize('admin'), asyncHandler(async (req, res) => {
  const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body || {});
  const r = await service.deleteAttempt(req.params.id, body, req.user);
  return r.error ? mapError(res, r.error) : ok(res, r);
}));
router.post('/attempts/:id/extend', authorize('admin'), asyncHandler(async (req, res) => {
  const body = z.object({ days: z.number().int().min(1).max(60).optional() }).parse(req.body || {});
  const r = await service.extendAttempt(req.params.id, body, req.user);
  return r.error ? mapError(res, r.error) : ok(res, r.attempt);
}));

// Attempt limit per submission (0 = no limit); admin editable.
router.get('/settings', asyncHandler(async (req, res) => ok(res, await service.getSettings(req.user.org_id))));
router.put('/settings', authorize('admin'), asyncHandler(async (req, res) => {
  const body = z.object({ assessment_max_attempts: z.number().int().min(0).max(50).optional(), assessment_email_candidate: z.boolean().optional() }).parse(req.body);
  return ok(res, await service.updateSettings(req.user.org_id, body));
}));

// Tests & interviews analytics (see assessmentAnalytics.service.js for the counting rules).
const analyticsQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  requirement_id: z.string().uuid().optional(),
  recruiter_id: z.string().uuid().optional(),
  account_id: z.string().uuid().optional(),
});
const toFilters = (q) => ({ from: q.from, to: q.to, requirementId: q.requirement_id, recruiterId: q.recruiter_id, accountId: q.account_id });
router.get('/analytics/summary', asyncHandler(async (req, res) => ok(res, await analytics.summary(toFilters(analyticsQuery.parse(req.query))))));
router.get('/analytics/filters', asyncHandler(async (req, res) => ok(res, await analytics.filterOptions())));
router.get('/analytics/records', asyncHandler(async (req, res) => {
  const q = analyticsQuery.extend({
    kind: z.enum(['tests', 'interviews']).default('tests'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }).parse(req.query);
  return ok(res, await analytics.records(q.kind, toFilters(q), { page: q.page, limit: q.limit }));
}));

// ---- candidate side (no login, the token in the link is the credential) ----
const publicRouter = express.Router();
if (env.nodeEnv !== 'test') publicRouter.use('/assessments', rateLimit({ windowMs: 60 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));

publicRouter.get('/assessments/:token', asyncHandler(async (req, res) => {
  const r = await service.openForCandidate(req.params.token);
  return r.error ? mapError(res, r.error) : ok(res, r.test);
}));
publicRouter.post('/assessments/:token/submit', asyncHandler(async (req, res) => {
  const body = z.object({ answers: z.record(z.string(), z.number().int().min(0).max(7)) }).parse(req.body);
  const r = await service.submitForCandidate(req.params.token, body.answers);
  return r.error ? mapError(res, r.error) : ok(res, { submitted: true });
}));

module.exports = { router, publicRouter };
