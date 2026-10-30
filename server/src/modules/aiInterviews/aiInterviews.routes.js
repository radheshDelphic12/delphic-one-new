const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const env = require('../../config/env');
const { authenticate, authorize } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const service = require('./aiInterviews.service');

const ERRORS = {
  not_found: [404, 'Not found'],
  disabled: [409, 'The AI interview is switched off in Hiring setup'],
  already_completed: [409, 'This candidate already has an AI interview result. An admin can delete it to allow a new one'],
  in_progress: [409, 'The candidate is in the middle of the interview. Wait for it to finish, or ask an admin to delete it'],
  not_finished: [409, 'The candidate has not finished the interview yet'],
  forbidden: [403, 'Only an admin can do this'],
  no_org: [400, 'Choose a company workspace first'],
  weights_zero: [400, 'At least one rubric weight must be above 0'],
  already_submitted: [410, 'This interview is already complete'],
  expired: [410, 'This link has expired. Ask the recruiter for a new one'],
  superseded: [410, 'This link was replaced by a newer one. Ask the recruiter for the latest link'],
  consent_required: [400, 'Please agree to the AI interview notice to start'],
  not_started: [409, 'The interview has not been started'],
  not_waiting: [409, 'There is no question waiting for an answer'],
  empty_answer: [400, 'Please type or say your answer first'],
  busy: [409, 'Your last answer is still being processed. Please wait a moment'],
  bad_recording: [400, 'That recording part could not be accepted'],
  recording_gap: [409, 'A recording part is missing; send them in order'],
  recording_too_big: [413, 'The recording is too large'],
  recording_expired: [410, 'The recording was deleted after its retention period'],
  no_recording: [404, 'There is no recording for this interview'],
  ai_unavailable: [503, 'The interviewer is not available right now. Please try again in a few minutes'],
};
const mapError = (res, error) => fail(res, ...(ERRORS[error] || [400, 'Bad request']));

const settingsSchema = z.object({
  is_enabled: z.boolean().optional(),
  question_count: z.number().int().min(3).max(15).optional(),
  max_followups: z.number().int().min(0).max(10).optional(),
  pass_percentage: z.number().int().min(1).max(100).optional(),
  borderline_margin: z.number().int().min(0).max(50).optional(),
  weight_knowledge: z.number().int().min(0).max(100).optional(),
  weight_communication: z.number().int().min(0).max(100).optional(),
  weight_depth: z.number().int().min(0).max(100).optional(),
  aptitude_enabled: z.boolean().optional(),
  aptitude_question_count: z.number().int().min(2).max(10).optional(),
  weight_aptitude: z.number().int().min(0).max(100).optional(),
  recording_enabled: z.boolean().optional(),
  recording_retention_days: z.number().int().min(1).max(30).optional(),
  extra_instructions: z.string().trim().max(1500).nullable().optional(),
  link_valid_days: z.number().int().min(1).max(60).optional(),
});

// ---- team side (login) ----
const router = express.Router();
router.use(authenticate, requireMasterWorkspace);

router.get('/', asyncHandler(async (req, res) => ok(res, await service.list({ submissionId: z.string().uuid().parse(req.query.submission_id) }))));
router.post('/', authorize('admin', 'recruiter', 'sales'), asyncHandler(async (req, res) => {
  const body = z.object({ submission_id: z.string().uuid() }).parse(req.body);
  const r = await service.invite({ submissionId: body.submission_id }, req.user);
  return r.error ? mapError(res, r.error) : created(res, { ...r.interview, link: r.link, superseded: r.superseded });
}));

router.get('/settings', asyncHandler(async (req, res) => ok(res, await service.getSettings(req.user.org_id))));
router.put('/settings', authorize('admin'), asyncHandler(async (req, res) => {
  const r = await service.updateSettings(req.user.org_id, settingsSchema.parse(req.body), req.user);
  return r.error ? mapError(res, r.error) : ok(res, r.settings);
}));

router.get('/:id/review', asyncHandler(async (req, res) => {
  const r = await service.review(z.string().uuid().parse(req.params.id));
  return r.error ? mapError(res, r.error) : ok(res, r.review);
}));
// The stored recording (audio + video), for the team only; it is deleted automatically after the retention days.
router.get('/:id/recording', asyncHandler(async (req, res) => {
  const r = await service.recordingFor(z.string().uuid().parse(req.params.id));
  if (r.error) return mapError(res, r.error);
  res.setHeader('Content-Type', r.mime);
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.query.download === 'true') res.setHeader('Content-Disposition', `attachment; filename="${r.name}"`);
  return res.sendFile(r.file); // sendFile answers Range requests, so the video can be scrubbed
}));
router.post('/:id/override', authorize('admin', 'recruiter', 'sales'), asyncHandler(async (req, res) => {
  const body = z.object({ outcome: z.enum(service.OUTCOMES), reason: z.string().trim().min(3).max(500) }).parse(req.body);
  const r = await service.override(z.string().uuid().parse(req.params.id), body, req.user);
  return r.error ? mapError(res, r.error) : ok(res, r.interview);
}));
router.delete('/:id', authorize('admin'), asyncHandler(async (req, res) => {
  const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body || {});
  const r = await service.remove(z.string().uuid().parse(req.params.id), body, req.user);
  return r.error ? mapError(res, r.error) : ok(res, r);
}));

// ---- candidate side (no login, the token in the link is the credential) ----
const publicRouter = express.Router();
if (env.nodeEnv !== 'test') publicRouter.use('/ai-interviews', rateLimit({ windowMs: 60 * 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false }));

publicRouter.get('/ai-interviews/:token', asyncHandler(async (req, res) => {
  const r = await service.openForCandidate(req.params.token);
  return r.error ? mapError(res, r.error) : ok(res, r.view);
}));
publicRouter.post('/ai-interviews/:token/start', asyncHandler(async (req, res) => {
  const body = z.object({ consent: z.boolean(), recording_consent: z.boolean().optional() }).parse(req.body);
  const r = await service.startForCandidate(req.params.token, body);
  return r.error ? mapError(res, r.error) : ok(res, r.view);
}));
// One part of the recording, in order (?seq=0,1,2...). Raw bytes; the Content-Type is the recording's type.
publicRouter.post('/ai-interviews/:token/recording', express.raw({ type: () => true, limit: '13mb' }), asyncHandler(async (req, res) => {
  const seq = z.coerce.number().int().min(0).parse(req.query.seq);
  const r = await service.saveRecordingChunk(req.params.token, { seq, buffer: Buffer.isBuffer(req.body) ? req.body : null, mime: req.headers['content-type'] });
  return r.error ? mapError(res, r.error) : ok(res, { saved: true });
}));
publicRouter.post('/ai-interviews/:token/answer', asyncHandler(async (req, res) => {
  const body = z.object({ text: z.string().max(20000) }).parse(req.body);
  const r = await service.answerForCandidate(req.params.token, body.text);
  return r.error ? mapError(res, r.error) : ok(res, { ...r.view, done: Boolean(r.done) });
}));

module.exports = { router, publicRouter };
