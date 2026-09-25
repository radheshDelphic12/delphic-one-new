const { z } = require('zod');
const { requiredDate, optionalDate } = require('../../lib/zodDate');

const CURRENCY = z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']);

const createRateSchema = z.object({
  account_id: z.string().uuid(),
  requirement_id: z.string().uuid().optional(),
  rate_type: z.enum(['hourly', 'monthly']),
  rate: z.coerce.number().positive(),
  currency: CURRENCY.default('INR'),
  effective_from: requiredDate,
});

const listRatesQuerySchema = z.object({
  account_id: z.string().uuid().optional(),
  requirement_id: z.string().uuid().optional(),
});

// Always a range (a single day is date_from === date_to) — capped at 31 days
// so one call can't silently churn through months of history.
const computeDailyRevenueSchema = z
  .object({
    date_from: requiredDate,
    date_to: requiredDate,
  })
  .refine((v) => v.date_to >= v.date_from, { message: 'date_to must be on or after date_from', path: ['date_to'] })
  .refine((v) => (v.date_to - v.date_from) / 86400000 <= 30, { message: 'range cannot exceed 31 days', path: ['date_to'] });

const listDailyRevenueQuerySchema = z.object({
  account_id: z.string().uuid().optional(),
  requirement_id: z.string().uuid().optional(),
  from: optionalDate,
  to: optionalDate,
});

const createInvoiceSchema = z.object({
  client_account_id: z.string().uuid(),
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
});

const listInvoicesQuerySchema = z.object({
  client_account_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'sent', 'paid']).optional(),
});

const transitionInvoiceSchema = z.object({
  status: z.enum(['sent', 'paid']),
});

const createGroupChargeSchema = z.object({
  org_id: z.string().uuid(),
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
  kind: z.string().min(1).max(200),
  amount: z.coerce.number().positive(),
  currency: CURRENCY.default('INR'),
});

// Finance → Group Charges "Add Group Expense": an admin records a group
// expense against their OWN company, so the org comes from the session.
const createOwnGroupChargeSchema = createGroupChargeSchema.omit({ org_id: true });

const listMyGroupChargesQuerySchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12).optional(),
  period_year: z.coerce.number().int().min(2000).max(2100).optional(),
});

const listAllGroupChargesQuerySchema = z.object({
  org_id: z.string().uuid().optional(),
});

// Module C — per-project developer cost rate. Upsert semantics: posting again
// for the same (account, org_membership) updates the rate rather than erroring.
// cost_rate_per_hr is optional: an assignment is first an Employee <-> Project
// ALLOCATION (which also gates the IT timesheet's project dropdown); a pay
// rate is an extra layer. resource_type is schema-ready for contractors /
// vendor resources, but only company employees are offered for now.
const costAssignmentSchema = z.object({
  account_id: z.string().uuid(),
  org_membership_id: z.string().uuid(),
  cost_rate_per_hr: z.coerce.number().positive().optional(),
  resource_type: z.enum(['company_employee']).default('company_employee'),
});

const listCostAssignmentsQuerySchema = z.object({
  account_id: z.string().uuid(),
});

const accountBudgetQuerySchema = z.object({
  account_id: z.string().uuid(),
});

// Finance → Projects: edit a project's profile and/or its billing terms. Only
// Manage Services and Projects are offered as a category (no Recruitment yet).
// `billing` adds a new rate version — see billing.service.updateProjectProfile.
const updateProjectProfileSchema = z
  .object({
    project_name: z.string().trim().min(1).max(200).optional(),
    // A Lead account of this org (validated in the service); null unlinks.
    client_account_id: z.string().uuid().nullable().optional(),
    service_category: z.enum(['managed_services', 'project']).optional(),
    agreement_start_date: optionalDate.nullable(),
    benchmark_hours: z.coerce.number().int().min(1).max(744).optional(),
    billing: z
      .object({
        rate_type: z.enum(['hourly', 'monthly']),
        rate: z.coerce.number().positive(),
        currency: CURRENCY.default('INR'),
        effective_from: optionalDate,
      })
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

module.exports = {
  createRateSchema,
  listRatesQuerySchema,
  computeDailyRevenueSchema,
  listDailyRevenueQuerySchema,
  createInvoiceSchema,
  listInvoicesQuerySchema,
  transitionInvoiceSchema,
  createGroupChargeSchema,
  createOwnGroupChargeSchema,
  listMyGroupChargesQuerySchema,
  listAllGroupChargesQuerySchema,
  costAssignmentSchema,
  listCostAssignmentsQuerySchema,
  accountBudgetQuerySchema,
  updateProjectProfileSchema,
};
