const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const env = require('../../config/env');
const { authenticate, authorize } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const service = require('./assessments.service');

const ERRORS = {
  not_found: [404, 'Not found'],
  invalid_questions: [400, 'One or more questions do not exist'],
  empty_test: [400, 'Add questions to the test before sending it'],
  already_submitted: [410, 'This test has already been submitted'],
  expired: [410, 'This link has expired. Ask the recruiter for a new one'],
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
  return ok(res, await service.listAttempts({ submissionId }));
}));
router.post('/attempts', authorize('admin', 'recruiter', 'sales'), asyncHandler(async (req, res) => {
  const body = z.object({ test_id: z.string().uuid(), submission_id: z.string().uuid() }).parse(req.body);
  const r = await service.invite({ testId: body.test_id, submissionId: body.submission_id }, req.user);
  return r.error ? mapError(res, r.error) : created(res, { ...r.attempt, link: r.link });
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
