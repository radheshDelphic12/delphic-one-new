const { z } = require('zod');

const educationSchema = z.object({
  degree: z.string().optional(),
  institution: z.string().optional(),
  year: z.number().int().optional(),
});

const baseFields = {
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  date_of_birth: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  current_location: z.string().optional(),
  willing_to_relocate: z.boolean().optional(),
  preferred_locations: z.array(z.string()).optional(),

  current_company: z.string().optional(),
  current_designation: z.string().optional(),
  relevant_experience_years: z.number().optional(),

  secondary_skills: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  domain_experience: z.array(z.string()).optional(),
  education: educationSchema.optional(),

  current_ctc: z.number().optional(),
  current_ctc_currency: z.enum(['INR', 'USD', 'AED', 'SAR']).optional(),
  expected_ctc: z.number().optional(),
  expected_ctc_currency: z.enum(['INR', 'USD', 'AED', 'SAR']).optional(),
  ctc_negotiable: z.boolean().optional(),
  ctc_notes: z.string().optional(),

  notice_period_days: z.number().int().optional(),
  is_serving_notice: z.boolean().optional(),
  last_working_day: z.string().optional(),
  earliest_join_date: z.string().optional(),
  preferred_work_mode: z.enum(['remote', 'onsite', 'hybrid']).optional(),

  linkedin_url: z.string().optional(),
  portfolio_url: z.string().optional(),

  vendor_profile_id: z.string().optional(),
  recruiter_notes: z.string().optional(),
  on_bench: z.boolean().optional(),
};

const createSchema = z
  .object({
    name: z.string().min(1),
    total_experience_years: z.number(),
    primary_skills: z.array(z.string()).min(1),
    source: z.enum(['direct', 'vendor', 'linkedin']),
    vendor_account_id: z.string().uuid().optional(),
    ...baseFields,
  })
  .refine((d) => d.source !== 'vendor' || !!d.vendor_account_id, {
    message: 'vendor_account_id is required when source = vendor',
    path: ['vendor_account_id'],
  });

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  total_experience_years: z.number().optional(),
  primary_skills: z.array(z.string()).min(1).optional(),
  source: z.enum(['direct', 'vendor', 'linkedin']).optional(),
  vendor_account_id: z.string().uuid().optional(),
  is_active: z.boolean().optional(),
  ...baseFields,
});

const listQuerySchema = z.object({
  source: z.enum(['direct', 'vendor', 'linkedin']).optional(),
  vendor_id: z.string().uuid().optional(),
  primary_skills: z.string().optional(),
  experience_min: z.coerce.number().optional(),
  experience_max: z.coerce.number().optional(),
  expected_ctc_min: z.coerce.number().optional(),
  expected_ctc_max: z.coerce.number().optional(),
  notice_period_max: z.coerce.number().optional(),
  is_serving_notice: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  current_location: z.string().optional(),
  willing_to_relocate: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  preferred_work_mode: z.enum(['remote', 'onsite', 'hybrid']).optional(),
  is_active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  on_bench: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  added_by: z.string().uuid().optional(),
  search: z.string().optional(),
  sort_by: z.enum(['created_at', 'total_experience_years', 'expected_ctc']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = { createSchema, updateSchema, listQuerySchema };
