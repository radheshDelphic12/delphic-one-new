const { z } = require('zod');
const { optionalDate } = require('../../lib/zodDate');

const CURRENCY = z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']);

// Category: an admin-managed Expense category (category_id) or, for older
// callers, free text (category). expense_date = when the money was spent.
const claimFields = {
  location_id: z.string().uuid(),
  category: z.string().trim().min(1).max(200).optional(),
  category_id: z.string().uuid().optional(),
  expense_date: optionalDate,
  amount: z.coerce.number().positive(),
  currency: CURRENCY.default('INR'),
  // What it was for; required when the category is "Other".
  description: z.string().trim().max(2000).nullable().optional(),
};

const isOther = (v) => !v.category_id && String(v.category || '').trim().toLowerCase() === 'other';

// An admin may file a claim for any employee (org_membership_id).
const createClaimSchema = z
  .object({ ...claimFields, org_membership_id: z.string().uuid().optional() })
  .refine((v) => v.category || v.category_id, { message: 'Pick a category', path: ['category_id'] })
  .refine((v) => !isOther(v) || Boolean(v.description), { message: 'Describe the expense when the category is Other', path: ['description'] });

// Edit a pending claim — any subset of the submitted fields, at least one.
const updateClaimSchema = z
  .object(claimFields)
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

const decideClaimSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().max(500).optional(),
});

// Filters (combinable): month (expense date, else the submission date for
// older claims), category, office — plus employee on the admin list.
const listMyClaimsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'reimbursed']).optional(),
  period_month: z.coerce.number().int().min(1).max(12).optional(),
  period_year: z.coerce.number().int().min(2000).max(2100).optional(),
  category_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
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
