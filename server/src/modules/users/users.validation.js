const { z } = require('zod');

const roleEnum = z.enum(['bda', 'sales', 'recruiter', 'admin', 'employee']);
const optionalUuid = z.string().uuid().nullable().optional();

const listQuerySchema = z.object({
  role: roleEnum.optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  search: z.string().optional(),
  department_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Lightweight team directory — every authenticated user may read it, so filter
// bars and owner / brought-by / POC pickers show the whole roster regardless of
// the viewer's role. No pagination, no clamp; inactive users are included.
const directoryQuerySchema = z.object({
  role: roleEnum.optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: roleEnum,
  phone: z.string().nullable().optional(),
  department_id: optionalUuid,
  // People → user type. Contractor needs a vendor account and a monthly vendor rate.
  worker_type: z.enum(['full_time_employee', 'contractor']).optional(),
  vendor_account_id: z.string().uuid().nullable().optional(),
  vendor_rate: z.coerce.number().nonnegative().max(1e12).nullable().optional(),
  vendor_rate_currency: z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']).nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: roleEnum.optional(),
  phone: z.string().nullable().optional(),
  active: z.boolean().optional(),
  department_id: optionalUuid,
  // Superadmin-only fields (enforced in the service against the acting user).
  password: z.string().min(8).optional(),
  is_superadmin: z.boolean().optional(),
});

module.exports = { listQuerySchema, directoryQuerySchema, createSchema, updateSchema };
