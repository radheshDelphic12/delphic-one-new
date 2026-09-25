const { z } = require('zod');

const CURRENCY = z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']);

const createClaimSchema = z.object({
  location_id: z.string().uuid(),
  category: z.string().min(1).max(200),
  amount: z.coerce.number().positive(),
  currency: CURRENCY.default('INR'),
});

// Edit a pending claim — any subset of the submitted fields, at least one.
const updateClaimSchema = createClaimSchema
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

const decideClaimSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().max(500).optional(),
});

const listMyClaimsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'reimbursed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const listClaimsQuerySchema = listMyClaimsQuerySchema.extend({
  org_membership_id: z.string().uuid().optional(),
});

const createVendorPaymentSchema = z.object({
  vendor_name: z.string().min(1).max(200),
  vendor_type: z.enum(['contractor', 'external_resource', 'third_party']),
  amount: z.coerce.number().positive(),
  currency: CURRENCY.default('INR'),
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
});

const decideVendorPaymentSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().max(500).optional(),
});

const listVendorPaymentsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'paid', 'rejected']).optional(),
  vendor_type: z.enum(['contractor', 'external_resource', 'third_party']).optional(),
  period_month: z.coerce.number().int().min(1).max(12).optional(),
  period_year: z.coerce.number().int().min(2000).max(2100).optional(),
});

module.exports = {
  createClaimSchema,
  updateClaimSchema,
  decideClaimSchema,
  listMyClaimsQuerySchema,
  listClaimsQuerySchema,
  createVendorPaymentSchema,
  decideVendorPaymentSchema,
  listVendorPaymentsQuerySchema,
};
