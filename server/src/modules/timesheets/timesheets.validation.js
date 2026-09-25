const { z } = require('zod');
const { requiredDate, optionalDate } = require('../../lib/zodDate');

// `account_id` is optional: a non-IT employee logs just Date/Hours/Notes with no
// project (stored as non-billable general time). IT staff must send a project,
// and only one assigned to them — enforced in timesheets.service.createEntry.
// There is deliberately no `module_name` any more (unknown keys are stripped).
const createEntrySchema = z.object({
  date: requiredDate,
  account_id: z.string().uuid().optional(),
  requirement_id: z.string().uuid().optional(),
  hours: z.coerce.number().positive().max(24),
  billable: z.boolean().default(true),
  notes: z.string().max(1000).optional(),
});

// Patch semantics — only while the entry is still 'submitted' and the day
// isn't locked (see timesheets.service.updateEntry). A locked day's change
// must go through a regularization ticket instead.
const updateEntrySchema = z.object({
  hours: z.coerce.number().positive().max(24).optional(),
  billable: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

// A rejection must always tell the employee why.
const decideEntrySchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== 'rejected' || Boolean(v.reason), { message: 'A reason is required when rejecting', path: ['reason'] });

const lockDaySchema = z.object({
  date: requiredDate,
});

const listQuerySchema = z.object({
  from: optionalDate,
  to: optionalDate,
  org_membership_id: z.string().uuid().optional(),
  account_id: z.string().uuid().optional(),
  status: z.enum(['submitted', 'approved', 'rejected']).optional(),
  department_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(31),
});

const monthQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  org_membership_id: z.string().uuid().optional(),
});

// Admin monitoring hub — defaults to the current month when omitted (see
// timesheets.service.teamOverview).
const overviewQuerySchema = z.object({
  department_id: z.string().uuid().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// Only these three fields may be requested/applied via a regularization
// ticket — never trusted as an arbitrary write (schema.prisma comment).
const requestedChangeSchema = z
  .object({
    hours: z.coerce.number().positive().max(24).optional(),
    billable: z.boolean().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'requested_change must set at least one field' });

const createTicketSchema = z.object({
  requested_change: requestedChangeSchema,
  reason: z.string().min(1).max(500),
});

const decideTicketSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    decision_reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== 'rejected' || Boolean(v.decision_reason), { message: 'A reason is required when rejecting', path: ['decision_reason'] });

// "I missed the weekly lock" — asks for a specific correction on a locked day.
const createRegularizationRequestSchema = z.object({
  date: requiredDate,
  account_id: z.string().uuid().optional(),
  hours: z.coerce.number().positive().max(24),
  reason: z.string().trim().min(1).max(500),
});

module.exports = {
  createEntrySchema,
  updateEntrySchema,
  decideEntrySchema,
  lockDaySchema,
  listQuerySchema,
  monthQuerySchema,
  overviewQuerySchema,
  createTicketSchema,
  decideTicketSchema,
  createRegularizationRequestSchema,
};
