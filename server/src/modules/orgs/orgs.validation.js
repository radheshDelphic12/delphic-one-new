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
  team_id: z.string().uuid().nullable().optional(),
  work_mode: z.enum(['remote', 'onsite', 'hybrid']).nullable().optional(),
  // People → user type. Contractor needs a vendor account and a monthly vendor rate.
  worker_type: z.enum(['full_time_employee', 'contractor']).optional(),
  vendor_account_id: z.string().uuid().nullable().optional(),
  vendor_rate: z.coerce.number().nonnegative().max(1e12).nullable().optional(),
  vendor_rate_currency: z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']).nullable().optional(),
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

// Bank + emergency contact — self-service from the employee portal, or admin.
// Blank clears a field; an absent one is left as it is.
const optionalText = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
const personalDetailsSchema = z
  .object({
    bank_account_holder: optionalText(120),
    bank_name: optionalText(120),
    bank_account_number: optionalText(34).refine((v) => !v || /^[A-Za-z0-9 -]{4,34}$/.test(v), 'Enter a valid account number'),
    bank_ifsc: optionalText(20).transform((v) => (v ? v.toUpperCase() : v)).refine((v) => !v || /^[A-Z0-9]{4,20}$/.test(v), 'Enter a valid IFSC / SWIFT code'),
    bank_branch: optionalText(120),
    emergency_contact_name: optionalText(120),
    emergency_contact_relation: optionalText(60),
    emergency_contact_phone: optionalText(30).refine((v) => !v || /^[+0-9 ()-]{6,30}$/.test(v), 'Enter a valid phone number'),
    emergency_contact_email: optionalText(160).refine((v) => !v || z.string().email().safeParse(v).success, 'Enter a valid email'),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

module.exports = {
  personalDetailsSchema,
  MODULES,
  updateOrgSettingsSchema,
  createOrgSchema,
  createLocationSchema,
  updateMembershipSchema,
  membershipListQuerySchema,
  updateValuationSchema,
};
