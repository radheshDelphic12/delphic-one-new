const { z } = require('zod');

const contactSchema = z.object({
  name: z.string(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  designation: z.string().optional(),
  role_label: z.string().optional(),
});

const baseFields = {
  industry: z.string().optional(),
  company_size: z.enum(['startup', 'small', 'mid', 'enterprise']).optional(),
  website: z.string().optional(),
  location_city: z.string().optional(),
  location_country: z.string().optional(),
  gst_or_tax_id: z.string().optional(),

  location: z.string().optional(),
  linkedin_url: z.string().optional(),

  poc_name: z.string().optional(),
  poc_email: z.string().email().optional().or(z.literal('')),
  poc_phone: z.string().optional(),
  poc_designation: z.string().optional(),

  additional_contacts: z.array(contactSchema).optional(),

  source: z.string().optional(),

  vendor_specializations: z.array(z.string()).optional(),
  vendor_rate_range: z.object({ min: z.number(), max: z.number(), currency: z.string() }).optional(),
  vendor_payment_terms: z.string().optional(),
  vendor_agreement_url: z.string().optional(),

  client_billing_currency: z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']).optional(),
  client_payment_terms: z.string().optional(),
  client_agreement_url: z.string().optional(),

  // Project costing (Module C) — currency follows client_billing_currency above.
  budget_amount: z.coerce.number().nonnegative().nullable().optional(),
};

const createSchema = z.object({
  type: z.enum(['client', 'vendor']).optional(),
  name: z.string().min(1),
  ...baseFields,
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  owner_id: z.string().uuid().optional(),
  // "Brought by" — normally immutable; honoured for admin/BDA/superadmin (enforced in the service).
  origin_owner_id: z.string().uuid().optional(),
  type: z.enum(['client', 'vendor']).optional(),
  ...baseFields,
});

// Superadmin-only free-form stage move: any target stage (incl. lead / backward),
// reason required, may also flip the lock.
const stageOverrideSchema = z.object({
  to_stage: z.enum(['lead', 'meeting_scheduled', 'active', 'rescheduled', 'dropped']),
  reason: z.string().min(1),
  is_locked: z.boolean().optional(),
  meeting_mode: z.enum(['online', 'offline']).optional(),
  meeting_date: z.string().datetime().optional(),
  meeting_location: z.string().optional(),
  meeting_notes: z.string().optional(),
  meeting_attendee_ids: z.array(z.string().uuid()).optional(),
});

const stageSchema = z.object({
  to_stage: z.enum(['meeting_scheduled', 'active', 'rescheduled', 'dropped']),
  reason: z.string().optional(),
  meeting_mode: z.enum(['online', 'offline']).optional(),
  meeting_date: z.string().datetime().optional(),
  meeting_location: z.string().optional(),
  meeting_notes: z.string().optional(),
  meeting_attendee_ids: z.array(z.string().uuid()).optional(),
});

// Edit an account's meeting details (mode/date/location/notes/attendees) without
// a stage transition — so a scheduled meeting stays editable after the fact
// (reschedule details, fix attendees) instead of only being settable once while
// moving into `meeting_scheduled`.
const meetingSchema = z.object({
  meeting_mode: z.enum(['online', 'offline']),
  meeting_date: z.string().datetime(),
  meeting_location: z.string().optional(),
  meeting_notes: z.string().optional(),
  meeting_attendee_ids: z.array(z.string().uuid()).optional(),
});

const classifySchema = z.object({
  type: z.enum(['client', 'vendor']),
});

const listQuerySchema = z.object({
  type: z.enum(['client', 'vendor', 'unclassified']).optional(),
  // Lead pipeline: pair with type=client to also surface not-yet-classified leads
  // (type IS NULL), which is where every account still in the `lead` stage sits.
  include_unclassified: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  // Single stage, or a CSV of stages (e.g. `meeting_scheduled,rescheduled`).
  stage: z
    .string()
    .optional()
    .refine(
      (v) =>
        !v ||
        v
          .split(',')
          .every((s) => ['lead', 'meeting_scheduled', 'active', 'rescheduled', 'dropped'].includes(s.trim())),
      { message: 'stage must be one or more of lead, meeting_scheduled, active, rescheduled, dropped' }
    ),
  owner_id: z.string().uuid().optional(),
  origin_owner_id: z.string().uuid().optional(),
  // "stuck" = a lead/meeting/rescheduled account with no update for STUCK_THRESHOLD_DAYS
  // (mirrors the dashboard "Stuck leads" tile so its click-through is exact).
  stuck: z.enum(['stuck', 'not_stuck']).optional(),
  industry: z.string().optional(),
  /** Exact vendor specialization tag (matches `vendor_specializations` array element). */
  specialization: z.string().min(1).max(120).optional(),
  search: z.string().optional(),
  created_from: z.string().optional(),
  created_to: z.string().optional(),
  sort_by: z.enum(['name', 'created_at', 'updated_at']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = {
  createSchema,
  updateSchema,
  stageSchema,
  stageOverrideSchema,
  meetingSchema,
  classifySchema,
  listQuerySchema,
};
