const { z } = require('zod');
const { optionalDate } = require('../../lib/zodDate');

const rateType = z.enum(['monthly', 'hourly', 'annual']);
const currency = z.enum(['INR', 'USD', 'AED', 'SAR']);

const createSchema = z.object({
  requirement_seat_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  proposed_rate: z.number().optional(),
  proposed_rate_type: rateType.optional(),
  proposed_rate_currency: currency.optional(),
  vendor_rate: z.number().optional(),
  vendor_rate_type: rateType.optional(),
  vendor_rate_currency: currency.optional(),
  submission_notes: z.string().optional(),
  relevancy_score: z.number().int().min(1).max(10).optional(),
});

const updateSchema = z.object({
  proposed_rate: z.number().optional(),
  proposed_rate_type: rateType.optional(),
  proposed_rate_currency: currency.optional(),
  vendor_rate: z.number().optional(),
  vendor_rate_type: rateType.optional(),
  vendor_rate_currency: currency.optional(),
  final_agreed_rate: z.number().optional(),
  final_agreed_rate_type: rateType.optional(),
  submission_notes: z.string().optional(),
  client_feedback: z.string().optional(),
  relevancy_score: z.number().int().min(1).max(10).optional(),
  offer_date: optionalDate,
  offer_ctc: z.number().optional(),
  offer_ctc_currency: currency.optional(),
  expected_joining_date: optionalDate,
  actual_joining_date: optionalDate,
  bgv_initiated_date: optionalDate,
  bgv_status: z.enum(['pending', 'in_progress', 'cleared', 'failed']).optional(),
  bgv_completed_date: optionalDate,
  bgv_notes: z.string().optional(),
});

const stageSchema = z.object({
  to_stage: z.enum([
    'sourced', 'internal_screening', 'submitted_to_client', 'interview_scheduled',
    'interview_result', 'offer_sent', 'bgv', 'closed', 'backout', 'rejected',
  ]),
  reason: z.string().optional(),
  backout_reason: z.string().optional(),
  rejection_reason: z.string().optional(),
});

// Superadmin-only: force a submission to ANY stage (backward, straight to sourced,
// out of a terminal state), bypassing the transition map, lock, and gates. Reason
// required; audited in stage_history with an [override] prefix.
const stageOverrideSchema = z.object({
  to_stage: z.enum([
    'sourced', 'internal_screening', 'submitted_to_client', 'interview_scheduled',
    'interview_result', 'offer_sent', 'bgv', 'closed', 'backout', 'rejected',
  ]),
  reason: z.string().min(1),
  is_locked: z.boolean().optional(),
});

const listQuerySchema = z.object({
  account_id: z.string().uuid().optional(),
  requirement_id: z.string().uuid().optional(),
  seat_id: z.string().uuid().optional(),
  profile_id: z.string().uuid().optional(),
  // Submissions whose requirement is owned by this sales user (seat -> requirement).
  sales_owner_id: z.string().uuid().optional(),
  stage: z.string().optional(),
  submitted_by: z.string().uuid().optional(),
  // actual_joining_date window (ISO strings) — used by the dashboard "Closures this month" tile.
  joined_from: z.string().optional(),
  joined_to: z.string().optional(),
  search: z.string().optional(),
  sort_by: z.enum(['created_at', 'stage', 'margin']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const interviewRoundCreateSchema = z.object({
  round_type: z.enum(['internal_r1', 'internal_r2', 'client_r1', 'client_r2', 'client_r3', 'hr_cto_ceo']),
  round_name: z.string().optional(),
  scheduled_at: z.string().min(1, 'Interview date & time is required'),
  duration_minutes: z.number().int().optional(),
  interviewer_name: z.string().optional(),
  interviewer_email: z.string().email().optional().or(z.literal('')),
  interviewer_ids: z.array(z.string().uuid()).optional(),
  meeting_link: z.string().optional(),
  // Recruiter can log feedback when creating (e.g. completed internal screen) or add later via PATCH
  result: z.enum(['pending', 'pass', 'fail', 'no_show', 'rescheduled']).optional(),
  feedback: z.string().optional(),
  rating: z.number().int().min(1).max(10).optional(),
  completed_at: z.string().optional(),
});

const interviewRoundUpdateSchema = z.object({
  scheduled_at: z.string().optional(),
  duration_minutes: z.number().int().optional(),
  interviewer_name: z.string().optional(),
  interviewer_email: z.string().email().optional().or(z.literal('')),
  interviewer_ids: z.array(z.string().uuid()).optional(),
  meeting_link: z.string().optional(),
  result: z.enum(['pending', 'pass', 'fail', 'no_show', 'rescheduled']).optional(),
  feedback: z.string().optional(),
  rating: z.number().int().min(1).max(10).optional(),
  completed_at: z.string().optional(),
});

module.exports = {
  createSchema,
  updateSchema,
  stageSchema,
  stageOverrideSchema,
  listQuerySchema,
  interviewRoundCreateSchema,
  interviewRoundUpdateSchema,
};
