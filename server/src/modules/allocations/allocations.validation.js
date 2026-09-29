const { z } = require('zod');
const { requiredDate, optionalDate } = require('../../lib/zodDate');

const uuid = z.string().uuid().optional();

const settingsSchema = z.object({
  projects_per_resource: z.coerce.number().min(0.1).max(20),
});

const capacityQuerySchema = z.object({
  date: optionalDate,
  team_id: uuid,
  window_days: z.coerce.number().int().min(1).max(365).default(30),
});

const endingSoonQuerySchema = z.object({
  from: optionalDate,
  to: optionalDate,
  team_id: uuid,
  client_account_id: uuid,
});

const resourcesQuerySchema = z.object({
  team_id: uuid,
  org_membership_id: uuid,
  account_id: uuid,
  client_account_id: uuid,
  from: optionalDate,
  to: optionalDate,
  status: z.enum(['all', 'active', 'upcoming', 'ended']).default('all'),
});

const movementsQuerySchema = z.object({
  from: optionalDate,
  to: optionalDate,
  team_id: uuid,
  org_membership_id: uuid,
});

// Move a resource on a date: allocations in force end the day before, the
// new project (and/or team) starts on it.
const moveSchema = z
  .object({
    org_membership_id: z.string().uuid(),
    effective_date: requiredDate,
    from_account_id: uuid,
    to_account_id: uuid,
    to_team_id: z.string().uuid().nullable().optional(),
    allocation_percent: z.coerce.number().min(0).max(100).nullable().optional(),
    cost_rate_per_hr: z.coerce.number().positive().nullable().optional(),
  })
  .refine((v) => v.from_account_id || v.to_account_id || v.to_team_id !== undefined, { message: 'Pick what to move from or to', path: ['to_account_id'] });

const teamChangeSchema = z.object({
  org_membership_id: z.string().uuid(),
  team_id: z.string().uuid().nullable(),
  effective_date: optionalDate,
});

const endAllocationSchema = z.object({ end_date: optionalDate });

module.exports = { settingsSchema, capacityQuerySchema, endingSoonQuerySchema, resourcesQuerySchema, movementsQuerySchema, moveSchema, teamChangeSchema, endAllocationSchema };
