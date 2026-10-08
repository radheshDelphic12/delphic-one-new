const { z } = require('zod');
const { requiredDate, optionalDate } = require('../../lib/zodDate');

const createLeaveTypeSchema = z.object({
  name: z.string().min(1).max(100),
  paid: z.boolean().default(true),
  annual_quota: z.coerce.number().int().min(0).optional(),
  is_applicable: z.boolean().optional(),
  counts_in_balance: z.boolean().optional(),
  overflow_to_unpaid: z.boolean().optional(),
});

// Admin / HR: reconfigure a leave type (all optional, at least one).
const updateLeaveTypeSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    paid: z.boolean().optional(),
    annual_quota: z.coerce.number().int().min(0).nullable().optional(),
    is_applicable: z.boolean().optional(),
    counts_in_balance: z.boolean().optional(),
    overflow_to_unpaid: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => Object.keys(v).filter((k) => k !== 'reason').length > 0, { message: 'Nothing to change' });

const leaveRequestShape = {
  leave_type_id: z.string().uuid(),
  from_date: requiredDate,
  to_date: requiredDate,
  is_half_day: z.boolean().default(false),
  half_day_session: z.enum(['FIRST_HALF', 'SECOND_HALF']).nullable().optional(),
  reason: z.string().max(500).optional(),
};

// Shared cross-field rules for self and admin requests.
const withLeaveRules = (schema) => schema
  .refine((v) => v.from_date <= v.to_date, { message: 'from_date must be on or before to_date', path: ['to_date'] })
  .refine((v) => !v.is_half_day || Boolean(v.half_day_session), {
    message: 'half_day_session is required for a half-day leave request',
    path: ['half_day_session'],
  })
  .refine((v) => !v.is_half_day || v.from_date.getTime() === v.to_date.getTime(), {
    message: 'A half-day leave request must cover exactly one date',
    path: ['to_date'],
  })
  .refine((v) => v.is_half_day || !v.half_day_session, {
    message: 'half_day_session is only valid for a half-day leave request',
    path: ['half_day_session'],
  });

const createLeaveRequestSchema = withLeaveRules(z.object(leaveRequestShape));

// Admin applying leave: same fields + the employee (omit = themselves) and an
// optional auto-approve (admins are the approvers).
const adminLeaveRequestSchema = withLeaveRules(z.object({
  ...leaveRequestShape,
  org_membership_id: z.string().uuid().optional(),
  auto_approve: z.boolean().default(false),
  // Admin-only special case: a full day's leave on a date the employee was marked
  // present. Approved in the same step; the present days become leave, audited.
  override_attendance: z.boolean().default(false),
}))
  .refine((v) => !v.override_attendance || v.auto_approve, {
    message: 'An attendance override is approved immediately - set auto_approve',
    path: ['auto_approve'],
  })
  .refine((v) => !v.override_attendance || (v.reason || '').trim().length >= 3, {
    message: 'Give a reason (at least 3 characters) for overriding attendance',
    path: ['reason'],
  });

const decisionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().max(500).optional(),
});

const listRequestsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  org_membership_id: z.string().uuid().optional(),
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const balanceQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()),
});

const dayStatusQuerySchema = z.object({ date: requiredDate });

const balancesOverviewQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()),
  department_id: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
});

// null clears the override so the employee goes back to the leave type default.
const setEntitlementSchema = z.object({
  leave_type_id: z.string().uuid(),
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()),
  allocated: z.coerce.number().min(0).max(999).nullable(),
});

const revokeSchema = z.object({ reason: z.string().max(500).optional() });

module.exports = {
  createLeaveTypeSchema,
  updateLeaveTypeSchema,
  createLeaveRequestSchema,
  adminLeaveRequestSchema,
  decisionSchema,
  listRequestsQuerySchema,
  balanceQuerySchema,
  dayStatusQuerySchema,
  balancesOverviewQuerySchema,
  setEntitlementSchema,
  revokeSchema,
};
