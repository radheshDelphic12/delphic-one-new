const { z } = require('zod');

const MODULES = ['trading', 'leads', 'contracts', 'projects'];

// Group superadmin: which vertical modules a company uses, and how its
// valuation is derived. `valuation_multiple: null` falls back to the method default.
const updateOrgSettingsSchema = z
  .object({
    enabled_modules: z.array(z.enum(MODULES)).max(MODULES.length),
    valuation_method: z.enum(['manual', 'revenue_multiple', 'ebitda_multiple']),
    valuation_multiple: z.coerce.number().positive().max(1000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one setting' });

const createLocationSchema = z.object({
  name: z.string().min(1).max(100),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  is_default: z.boolean().default(false),
});

const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  logo_url: z.string().url().max(500).nullable().optional(),
  timezone: z.string().min(1).max(80).default('Asia/Kolkata'),
  default_currency: z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']).default('INR'),
});

// Admin sets an employee's directory/reporting fields — all optional, patch
// semantics. `null` clears a field (e.g. removing a manager).
const updateMembershipSchema = z.object({
  location_id: z.string().uuid().nullable().optional(),
  shift_id: z.string().uuid().nullable().optional(),
  manager_id: z.string().uuid().nullable().optional(),
  hr_poc_id: z.string().uuid().nullable().optional(),
  sourcing_poc_id: z.string().uuid().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  designation_id: z.string().uuid().nullable().optional(),
});

const membershipListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  include_terminated: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

// Group superadmin, Group Overview dashboard — a manually-entered figure,
// null clears it back to "not set".
const updateValuationSchema = z.object({
  valuation: z.coerce.number().nonnegative().nullable(),
});

module.exports = {
  MODULES,
  updateOrgSettingsSchema,
  createOrgSchema,
  createLocationSchema,
  updateMembershipSchema,
  membershipListQuerySchema,
  updateValuationSchema,
};
