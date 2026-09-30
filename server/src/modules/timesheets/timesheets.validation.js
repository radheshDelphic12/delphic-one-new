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
  // Extra hours beyond the regular ones, claimed as overtime (project time only).
  overtime_hours: z.coerce.number().min(0).max(24).default(0),
  billable: z.boolean().default(true),
  notes: z.string().max(1000).optional(),
});

// Patch semantics — only while the entry is still 'submitted' and the day
// isn't locked (see timesheets.service.updateEntry). A locked day's change
// must go through a regularization ticket instead.
const updateEntrySchema = z.object({
  hours: z.coerce.number().positive().max(24).optional(),
  overtime_hours: z.coerce.number().min(0).max(24).optional(),
  billable: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

// Admin correction of any entry — any status, even on a locked day. The reason
// is required: it's recorded on the finance change it may raise.
const adminUpdateEntrySchema = z
  .object({
    hours: z.coerce.number().positive().max(24).optional(),
    overtime_hours: z.coerce.number().min(0).max(24).optional(),
    account_id: z.string().uuid().nullable().optional(),
    billable: z.boolean().optional(),
    notes: z.string().max(4000).nullable().optional(),
    // Admin may also approve / reject / re-open an entry at any stage.
    status: z.enum(['submitted', 'approved', 'rejected']).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => ['hours', 'overtime_hours', 'account_id', 'billable', 'notes', 'status'].some((k) => v[k] !== undefined), { message: 'Change at least one field' });

// Admin: add an entry for any employee on any date (a locked week included).
const adminCreateEntrySchema = z.object({
  org_membership_id: z.string().uuid(),
  date: requiredDate,
  account_id: z.string().uuid().nullable().optional(),
  hours: z.coerce.number().positive().max(24),
  overtime_hours: z.coerce.number().min(0).max(24).default(0),
  billable: z.boolean().optional(),
  notes: z.string().max(4000).nullable().optional(),
  status: z.enum(['submitted', 'approved']).default('approved'),
  reason: z.string().trim().min(3).max(500),
});

// Admin CSV upload of past entries: one row per employee / date / project.
const cell = (max) => z.preprocess((v) => (v === null || v === undefined ? '' : String(v)), z.string().trim().max(max)).default('');
const importEntriesSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  dry_run: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        employee: cell(200),
        date: cell(20),
        project: cell(300),
        hours: cell(10),
        overtime_hours: cell(10),
        billable: cell(10),
        notes: cell(4000),
      })
    )
    .min(1)
    .max(5000),
});

// Approval inbox, many at once: approve (default) or reject the given ids.
// A rejection needs one reason, applied to every item.
const bulkApproveSchema = z
  .object({
    status: z.enum(['approved', 'rejected']).default('approved'),
    reason: z.string().trim().max(500).optional(),
    entries: z.array(z.string().uuid()).max(1000).default([]),
    overtime: z.array(z.string().uuid()).max(1000).default([]),
    regularizations: z.array(z.string().uuid()).max(1000).default([]),
  })
  .refine((v) => v.entries.length + v.overtime.length + v.regularizations.length > 0, { message: 'Nothing selected' })
  .refine((v) => v.status !== 'rejected' || Boolean(v.reason), { message: 'A reason is required when rejecting', path: ['reason'] });

// A day's overtime: paid (approved), not paid (rejected), or comp off.
const decideOvertimeSchema = z
  .object({
    status: z.enum(['approved', 'rejected', 'comp_off']),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== 'rejected' || Boolean(v.reason), { message: 'A reason is required when rejecting', path: ['reason'] });

// Sunday -> Saturday week containing `date` (default today); managers/admins
// may pass someone else's org_membership_id.
const weekQuerySchema = z.object({
  date: optionalDate,
  org_membership_id: z.string().uuid().optional(),
});

// Day-by-day hours over a range (max ~2 months).
const hoursQuerySchema = z.object({
  from: requiredDate,
  to: requiredDate,
  org_membership_id: z.string().uuid().optional(),
}).refine((v) => v.to >= v.from && (v.to - v.from) / 86400000 <= 62, { message: 'Pick a range of up to 62 days', path: ['to'] });

const adminDeleteEntrySchema = z.object({ reason: z.string().trim().min(3).max(500) });

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
  // Everyone NOT in this department (and those with none) — the Non-IT view.
  exclude_department_id: z.string().uuid().optional(),
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
  exclude_department_id: z.string().uuid().optional(),
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
  adminUpdateEntrySchema,
  adminDeleteEntrySchema,
  adminCreateEntrySchema,
  importEntriesSchema,
  bulkApproveSchema,
  decideOvertimeSchema,
  weekQuerySchema,
  hoursQuerySchema,
  listQuerySchema,
  monthQuerySchema,
  overviewQuerySchema,
  createTicketSchema,
  decideTicketSchema,
  createRegularizationRequestSchema,
};
