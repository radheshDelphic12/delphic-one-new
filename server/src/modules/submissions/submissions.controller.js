const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const prisma = require('../../config/db');
const service = require('./submissions.service');
const { z } = require('zod');
const { getPlan, sendCandidateFeedbackMessage } = require('../interviewTemplates/interviewTemplates.service');
const {
  createSchema,
  updateSchema,
  stageSchema,
  stageOverrideSchema,
  listQuerySchema,
  interviewRoundCreateSchema,
  interviewRoundSkipSchema,
  interviewRoundUpdateSchema,
} = require('./submissions.validation');

const ERROR_STATUS = {
  not_found: [404, 'Not found'],
  locked: [403, 'Record is locked'],
  seat_not_found: [404, 'Seat not found'],
  seat_locked: [403, 'Seat is locked'],
  profile_inactive: [400, 'Profile is not active'],
  vendor_rate_required: [400, 'vendor_rate is required for vendor-sourced profiles'],
  sales_bench_only: [403, 'Sales can only put forward candidates on the bench'],
  duplicate_submission: [400, 'An active submission already exists for this profile and seat'],
  invalid_transition: [400, 'Invalid stage transition'],
  forbidden_backward: [403, 'Only an admin can move a submission backward'],
  reason_required: [400, 'A reason is required for this move'],
  backout_reason_required: [400, 'backout_reason is required'],
  rejection_reason_required: [400, 'rejection_reason is required'],
  rounds_not_resolved: [400, 'All interview rounds must have a result before advancing to offer'],
  bgv_not_cleared: [400, 'bgv_status must be cleared before closing'],
  forbidden: [403, 'You are not allowed to manage this interview round'],
  forbidden_stage_change: [403, 'You are not allowed to make this stage change'],
  invalid_interviewers: [400, 'One or more interviewers are invalid or inactive'],
  invalid_template_round: [400, 'This round is not part of the candidate\'s interview template'],
  round_already_exists: [400, 'This round is already scheduled for the candidate'],
  previous_round_pending: [400, 'Finish the previous mandatory round (with feedback) before the next one'],
  skip_bench_only: [400, 'Only a bench profile can skip the first round'],
  skip_first_round_only: [400, 'Only the first round of the interview plan can be skipped'],
  feedback_required: [400, 'Feedback is required to finish this round'],
  ratings_required: [400, 'Rate every skill out of 10 to finish this round (at least one skill)'],
  candidate_email_missing: [400, 'This candidate has no email on the profile'],
  mandatory_rounds_pending: [400, 'All mandatory interview rounds must be completed with feedback before the offer'],
};

function mapError(res, error) {
  const [status, message] = ERROR_STATUS[error] || [400, 'Bad request'];
  return fail(res, status, message);
}

const list = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  // Recruiters only see their own submissions (candidate pipeline scope).
  if (req.user.role === 'recruiter') query.submitted_by = req.user.id;
  const { rows, pagination } = await service.list(query);
  return ok(res, rows, { pagination });
});

const getOne = asyncHandler(async (req, res) => {
  const submission = await service.getById(req.params.id);
  if (!submission) return fail(res, 404, 'Not found');
  if (req.user.role === 'recruiter' && submission.submitted_by?.id !== req.user.id) {
    return fail(res, 403, 'You do not own this record');
  }
  return ok(res, submission);
});

const create = asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const result = await service.create(body, req.user);
  if (result.error) return mapError(res, result.error);
  return created(res, result.submission);
});

const update = asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  const submission = await service.update(req.params.id, body);
  return ok(res, submission);
});

const changeStage = asyncHandler(async (req, res) => {
  const body = stageSchema.parse(req.body);
  const result = await service.changeStage(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.submission);
});

const changeStageOverride = asyncHandler(async (req, res) => {
  const body = stageOverrideSchema.parse(req.body);
  const result = await service.changeStageOverride(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.submission);
});

const candidateFeedbackMessage = asyncHandler(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().max(1000).optional() }).parse(req.body || {});
  const result = await sendCandidateFeedbackMessage(req.params.id, { note }, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, result);
});

const interviewPlan = asyncHandler(async (req, res) => {
  const result = await getPlan(prisma, req.params.id);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.plan);
});

const history = asyncHandler(async (req, res) => {
  const submission = await service.getById(req.params.id);
  if (!submission) return fail(res, 404, 'Not found');
  // Same visibility as getOne — a recruiter only sees their own submissions. The
  // client fetches history separately from the ticket now, so a 403 here shows an
  // inline "could not load stage history" notice instead of blanking the page.
  if (req.user.role === 'recruiter' && submission.submitted_by?.id !== req.user.id) {
    return fail(res, 403, 'You do not own this record');
  }
  const rows = await service.getHistory(req.params.id);
  return ok(res, rows);
});

const addRound = asyncHandler(async (req, res) => {
  const body = interviewRoundCreateSchema.parse(req.body);
  const result = await service.addInterviewRound(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return created(res, result.round);
});

const skipRound = asyncHandler(async (req, res) => {
  const body = interviewRoundSkipSchema.parse(req.body);
  const result = await service.skipFirstRound(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return created(res, result.round);
});

const updateRound = asyncHandler(async (req, res) => {
  const body = interviewRoundUpdateSchema.parse(req.body);
  const result = await service.updateInterviewRound(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.round);
});

module.exports = { candidateFeedbackMessage, interviewPlan, list, getOne, create, update, changeStage, changeStageOverride, history, addRound, skipRound, updateRound };
