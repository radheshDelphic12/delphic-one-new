const { z } = require('zod');
const { optionalDate } = require('../../lib/zodDate');

const baseFields = {
  description: z.string().optional(),
  job_description: z.string().optional(),
  designation: z.string().optional(),
  department: z.string().optional(),

  primary_tech_stack: z.array(z.string()).optional(),
  secondary_tech_stack: z.array(z.string()).optional(),
  domain_experience: z.string().optional(),
  experience_min: z.number().optional(),
  experience_max: z.number().optional(),
  certifications_required: z.array(z.string()).optional(),

  work_mode: z.enum(['remote', 'onsite', 'hybrid']).optional(),
  work_location: z.string().optional(),
  time_zone_preference: z.string().optional(),
  engagement_type: z.enum(['full_time', 'part_time', 'contract']).optional(),
  contract_duration_months: z.number().int().optional(),
  start_date_target: optionalDate,
  notice_period_max_days: z.number().int().optional(),

  budget_min: z.number().optional(),
  budget_max: z.number().optional(),
  budget_currency: z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']).optional(),
  budget_type: z.enum(['monthly', 'hourly', 'annual', 'fixed_project']).optional(),
  billing_notes: z.string().optional(),

  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  sla_days: z.number().int().optional(),
};

const createSchema = z.object({
  account_id: z.string().uuid(),
  title: z.string().min(1),
  req_type: z.enum(['managed_services', 'recruitment', 'project']),
  seats_total: z.number().int().min(1).default(1),
  ...baseFields,
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  req_type: z.enum(['managed_services', 'recruitment', 'project']).optional(),
  sales_owner_id: z.string().uuid().optional(),
  ...baseFields,
});

const statusSchema = z.object({
  to_status: z.enum(['open', 'in_progress', 'on_hold', 'closed', 'dropped']),
  reason: z.string().optional(),
});

// Superadmin-only free-form status move: any target status (incl. backward, or out
// of the terminal `closed` / `dropped` states), reason required, may also flip the
// lock. Bypasses REQUIREMENT_STATUS_TRANSITIONS and the seats-closed gate.
const statusOverrideSchema = z.object({
  to_status: z.enum(['open', 'in_progress', 'on_hold', 'closed', 'dropped']),
  reason: z.string().min(1),
  is_locked: z.boolean().optional(),
});

const assignSchema = z.object({
  user_id: z.string().uuid(),
  role_on_req: z.enum(['sales', 'recruiter', 'vendor_team']),
});

const unassignSchema = z.object({
  assignment_id: z.string().uuid(),
});

const seatCreateSchema = z.object({
  seat_label: z.string().optional(),
});

const seatStageSchema = z.object({
  to_status: z.enum(['open', 'interviewing', 'offer', 'bgv', 'closed', 'dropped']),
  reason: z.string().optional(),
  joined_at: z.string().optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['open', 'in_progress', 'on_hold', 'closed', 'dropped']).optional(),
  req_type: z.enum(['managed_services', 'recruitment', 'project']).optional(),
  account_id: z.string().uuid().optional(),
  sales_owner_id: z.string().uuid().optional(),
  recruiter_id: z.string().uuid().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  work_mode: z.enum(['remote', 'onsite', 'hybrid']).optional(),
  stuck: z.enum(['stuck', 'not_stuck']).optional(),
  // closed_at window (ISO strings) — dashboard "Closed this month" tile drills in with these.
  closed_from: z.string().optional(),
  closed_to: z.string().optional(),
  tech_stack: z.string().optional(),
  search: z.string().optional(),
  sort_by: z.enum(['created_at', 'priority', 'budget_max', 'status']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = {
  createSchema,
  updateSchema,
  statusSchema,
  statusOverrideSchema,
  assignSchema,
  unassignSchema,
  seatCreateSchema,
  seatStageSchema,
  listQuerySchema,
};
