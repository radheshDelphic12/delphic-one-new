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

// The company's own invoice number (editable): letters, digits, - _ / . and spaces.
const INVOICE_NUMBER = z.string().trim().max(50).regex(/^[A-Za-z0-9][A-Za-z0-9\-_/. ]*$/, 'Use letters, digits, - _ / and .').optional().or(z.literal('').transform(() => undefined));
const invoiceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().or(z.literal('').transform(() => undefined));

const INVOICE_CURRENCY = z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']).optional().or(z.literal('').transform(() => undefined));

const createInvoiceSchema = z.object({
  client_account_id: z.string().uuid(),
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
  invoice_number: INVOICE_NUMBER,
  invoice_date: invoiceDate,
  notes: z.string().trim().max(1000).nullable().optional(),
  currency: INVOICE_CURRENCY,
});

const updateInvoiceSchema = z.object({
  invoice_number: INVOICE_NUMBER,
  invoice_date: invoiceDate,
  notes: z.string().trim().max(1000).nullable().optional(),
  currency: INVOICE_CURRENCY,
});

const previewInvoiceQuerySchema = z.object({
  account_id: z.string().uuid(),
  currency: INVOICE_CURRENCY,
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
});

const listInvoicesQuerySchema = z.object({
  client_account_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'sent', 'paid']).optional(),
  period_month: z.coerce.number().int().min(1).max(12).optional(),
  period_year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// Live Analytics → Vendors: a vendor's generated invoice for a month.
const vendorInvoicePeriodSchema = z.object({
  vendor_account_id: z.string().uuid(),
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
});
const generateVendorInvoiceSchema = vendorInvoicePeriodSchema.extend({
  invoice_number: INVOICE_NUMBER,
  invoice_date: invoiceDate,
  notes: z.string().trim().max(1000).nullable().optional(),
});
const listVendorInvoicesQuerySchema = z.object({
  vendor_account_id: z.string().uuid().optional(),
  period_month: z.coerce.number().int().min(1).max(12).optional(),
  period_year: z.coerce.number().int().min(2000).max(2100).optional(),
});

const transitionInvoiceSchema = z.object({
  status: z.enum(['sent', 'paid']),
});

// A group charge belongs to a month (period_*) and, when known, the day it
// was paid (payment_date) — the period defaults to that day's month. Category
// is either an admin-managed Group Charge category (category_id) or, for
// older callers, free text (kind).
const groupChargeFields = {
  org_id: z.string().uuid(),
  period_month: z.coerce.number().int().min(1).max(12).optional(),
  period_year: z.coerce.number().int().min(2000).max(2100).optional(),
  payment_date: optionalDate,
  kind: z.string().trim().min(1).max(200).optional(),
  category_id: z.string().uuid().optional(),
  location_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
  amount: z.coerce.number().positive(),
  currency: CURRENCY.default('INR'),
};

function withGroupChargeRules(schema) {
  return schema
    .refine((v) => v.kind || v.category_id, { message: 'Pick a category', path: ['category_id'] })
    .refine((v) => v.payment_date || (v.period_month && v.period_year), { message: 'Give the payment date or the month', path: ['payment_date'] })
    .transform((v) => ({
      ...v,
      period_month: v.period_month || v.payment_date.getUTCMonth() + 1,
      period_year: v.period_year || v.payment_date.getUTCFullYear(),
    }));
}

const createGroupChargeSchema = withGroupChargeRules(z.object(groupChargeFields));

// Finance → Group Charges "Add Group Expense": an admin records a group
// expense against their OWN company, so the org comes from the session.
const ownFields = Object.fromEntries(Object.entries(groupChargeFields).filter(([key]) => key !== 'org_id'));
const createOwnGroupChargeSchema = withGroupChargeRules(z.object(ownFields));

// Finance → Group Charges "Edit": any subset of the fields. A new payment date
// moves the charge to that day's month (see billing.service.updateGroupCharge).
const updateGroupChargeSchema = z
  .object({
    payment_date: optionalDate,
    category_id: z.string().uuid().optional(),
    location_id: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    amount: z.coerce.number().positive().optional(),
    currency: CURRENCY.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

// Filters: a month (period_month + period_year — matches the payment date
// when there is one, else the charge's month), an exact payment date, a
// payment-date range, category and office.
const listMyGroupChargesQuerySchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12).optional(),
  period_year: z.coerce.number().int().min(2000).max(2100).optional(),
  date: optionalDate,
  date_from: optionalDate,
  date_to: optionalDate,
  category_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
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
  // Share of the person's monthly cost charged to this project; null = even
  // split across their projects. resource_type follows the person's worker type.
  allocation_percent: z.coerce.number().min(0).max(100).nullable().optional(),
  // Effective-dated allocation (both inclusive; null = open). `effective_date`
  // applies a change to the allocation in force from that day on (the old
  // values stay for the days before) — see allocations.service.assign.
  start_date: optionalDate.nullable(),
  end_date: optionalDate.nullable(),
  effective_date: optionalDate,
});

// Monthly project P&L / vendor invoices.
const periodQuerySchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
});

// Project P&L list filters: project type (the project's service category;
// 'none' = not set yet) and client.
const pnlListQuerySchema = periodQuerySchema.extend({
  project_type: z.enum(['all', 'managed_services', 'project', 'none']).default('all'),
  client_account_id: z.string().uuid().optional(),
});

const vendorInvoiceSchema = z.object({
  vendor_account_id: z.string().uuid(),
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
  invoice_number: z.string().trim().max(100).nullable().optional(),
  amount: z.coerce.number().positive().max(1e12),
  currency: CURRENCY.default('INR'),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const updateVendorInvoiceSchema = vendorInvoiceSchema
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

const listCostAssignmentsQuerySchema = z.object({
  account_id: z.string().uuid(),
  // Ended allocations are history — listed unless include_ended=false.
  include_ended: z.enum(['true', 'false']).default('true').transform((x) => x === 'true'),
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
    agreement_end_date: optionalDate.nullable(),
    // Manual override; null = follow the agreement dates.
    contract_status: z.enum(['on_hold', 'completed']).nullable().optional(),
    benchmark_hours: z.coerce.number().int().min(1).max(744).optional(),
    // Whether this client pays overtime, and at what multiple of the
    // hourly-equivalent rate. Admin-only (the route is).
    overtime_billable: z.boolean().optional(),
    overtime_multiplier: z.coerce.number().min(1).max(5).optional(),
    // Hourly projects: the client's approximate hours per month (forecast only); null clears it.
    estimated_monthly_hours: z.coerce.number().positive().max(10000).nullable().optional(),
    // Hourly projects: the client's committed minimum hours per month; null clears it.
    minimum_monthly_hours: z.coerce.number().positive().max(10000).nullable().optional(),
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

// Finance → Project P&L: INR value of one unit of each foreign currency; null clears it.
const exchangeRatesSchema = z.object({
  rates: z
    .array(z.object({ currency: z.enum(['USD', 'AED', 'SAR', 'EUR', 'GBP']), rate_to_inr: z.coerce.number().positive().max(100000).nullable() }))
    .min(1),
});

module.exports = {
  exchangeRatesSchema,
  createRateSchema,
  listRatesQuerySchema,
  computeDailyRevenueSchema,
  listDailyRevenueQuerySchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  previewInvoiceQuerySchema,
  listInvoicesQuerySchema,
  vendorInvoicePeriodSchema,
  generateVendorInvoiceSchema,
  listVendorInvoicesQuerySchema,
  transitionInvoiceSchema,
  createGroupChargeSchema,
  createOwnGroupChargeSchema,
  updateGroupChargeSchema,
  listMyGroupChargesQuerySchema,
  listAllGroupChargesQuerySchema,
  costAssignmentSchema,
  listCostAssignmentsQuerySchema,
  accountBudgetQuerySchema,
  updateProjectProfileSchema,
  periodQuerySchema,
  pnlListQuerySchema,
  vendorInvoiceSchema,
  updateVendorInvoiceSchema,
};
