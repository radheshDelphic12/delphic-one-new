const { z } = require('zod');

const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .pipe(z.string().uuid().optional());

const dateRangeSchema = z.object({
  date_from: z.string().min(1),
  date_to: z.string().min(1),
  department_id: optionalUuid,
  recruiter_id: optionalUuid,
  sales_id: optionalUuid,
  bda_id: optionalUuid,
  vendor_id: optionalUuid,
  client_id: optionalUuid,
  // bda-reports only: narrows the "Accounts brought" table to one account type.
  account_type: z.enum(['client', 'vendor', 'unclassified']).optional(),
});

const agingSchema = z.object({
  threshold_days: z.coerce.number().int().min(1).max(365).optional(),
  department_id: optionalUuid,
});

// Coverage-gap reports (clients without requirements, recruiter-vendor gaps) —
// present-state, no date range, no department filter. clients-without-requirements
// filters by Sales POC (account owner, `bda_id`), by "Brought by" (`origin_owner_id`)
// and by account `stage`. `bucket` splits clients (`type = 'client'`,
// `stage = 'active'`) by their current requirement situation:
//   all               - every active-stage client
//   with_requirements - >=1 open/in_progress/on_hold requirement ("Has requirements")
//   no_active         - no open/in_progress/on_hold requirement ("No requirements":
//                       closed/dropped only, or never had one)
//   without_active_requirements / closed_only - kept server-side (export, back-compat).
// recruiter-vendor-gaps lists `type = 'vendor'`, `stage = 'active'` accounts and
// filters by `recruiter_id`, `vendor_id`, `owner_id` (our POC), `origin_owner_id`.
// `vendor_activity` (no value / active = every active-stage vendor):
//   active   - every active-stage vendor
//   inactive - no candidate currently in a live submission (sourced → BGV)
//   has_live - Active − Inactive (at least one live submission)
// `date_from` / `date_to` still accepted (profile sourced date) but the UI no
// longer sends them.
const coverageSchema = z.object({
  bda_id: optionalUuid,
  origin_owner_id: optionalUuid,
  recruiter_id: optionalUuid,
  vendor_id: optionalUuid,
  owner_id: optionalUuid,
  stage: z.enum(['lead', 'meeting_scheduled', 'active', 'rescheduled', 'dropped']).optional(),
  bucket: z
    .enum(['all', 'with_requirements', 'no_active', 'without_active_requirements', 'closed_only'])
    .optional(),
  vendor_activity: z.enum(['active', 'inactive', 'has_live']).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

const closureSchema = dateRangeSchema.extend({
  group_by: z.enum(['month', 'quarter', 'client', 'recruiter']).optional(),
});

// HR report - recruiter-ops throughput, grouped per day. `sourcer_id` narrows
// tables 1-3 (Profile.added_by), `interviewer_id` narrows table 4, `source`
// narrows all four.
const hrSchema = z.object({
  date_from: z.string().min(1),
  date_to: z.string().min(1),
  sourcer_id: optionalUuid,
  interviewer_id: optionalUuid,
  source: z.enum(['direct', 'vendor', 'linkedin']).optional(),
});

// Joinings by month (by sourcer / interviewer L1+L2 / vendor).
const joiningsSchema = z.object({
  date_from: z.string().min(1),
  date_to: z.string().min(1),
});

// Time-to-submit per candidate; filterable by the entity columns.
const timeToSubmitSchema = z.object({
  date_from: z.string().min(1),
  date_to: z.string().min(1),
  client_id: optionalUuid,
  requirement_id: optionalUuid,
  sourcer_id: optionalUuid,
  search: z.string().optional(),
});

const boolFlag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

const explorerSchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  grain: z.enum(['requirement', 'submission']).optional(),
  account_id: optionalUuid,
  bda_id: optionalUuid,
  sales_id: optionalUuid,
  recruiter_id: optionalUuid,
  vendor_id: optionalUuid,
  department_id: optionalUuid,
  search: z.string().optional(),
  requirement_status: z.string().optional(),
  submission_stage: z.string().optional(),
  priority: z.string().optional(),
  stuck_only: boolFlag,
  past_sla_only: boolFlag,
  threshold_days: z.coerce.number().int().min(1).max(365).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

module.exports = {
  dateRangeSchema,
  agingSchema,
  closureSchema,
  explorerSchema,
  coverageSchema,
  hrSchema,
  joiningsSchema,
  timeToSubmitSchema,
};
