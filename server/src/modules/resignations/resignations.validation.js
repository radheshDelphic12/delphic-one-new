const { z } = require('zod');
const { optionalDate, requiredDate } = require('../../lib/zodDate');

const REASON_CATEGORIES = ['better_opportunity', 'higher_studies', 'personal', 'health', 'relocation', 'compensation', 'work_environment', 'other'];

const submitSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
  reason_category: z.enum(REASON_CATEGORIES).optional(),
  // optional: the employee may leave it empty and let HR fix the last working day
  proposed_lwd: optionalDate,
});

// The manager's retention call. An outcome can only be recorded once the meeting is marked done.
const managerReviewSchema = z.object({
  meeting_done: z.boolean(),
  meeting_date: optionalDate,
  manager_notes: z.string().trim().max(2000).optional(),
  manager_outcome: z.enum(['retained', 'not_retained']).nullable().optional(),
});

const approveSchema = z.object({
  approved_lwd: requiredDate,
  remarks: z.string().trim().max(500).optional(),
  // HR going ahead without the manager's retention update (only when the company requires it)
  skip_manager_step: z.boolean().optional(),
});

const rejectSchema = z.object({ remarks: z.string().trim().min(3).max(500) });

const listQuerySchema = z.object({ status: z.enum(['submitted', 'manager_approved', 'approved', 'rejected', 'withdrawn', 'retained']).optional() });

const settingsSchema = z.object({
  resignation_enabled: z.boolean().optional(),
  resignation_notice_days: z.number().int().min(0).max(365).optional(),
  resignation_manager_required: z.boolean().optional(),
});

module.exports = { REASON_CATEGORIES, submitSchema, managerReviewSchema, approveSchema, rejectSchema, listQuerySchema, settingsSchema };
