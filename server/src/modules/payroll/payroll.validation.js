const { z } = require('zod');
const { requiredDate } = require('../../lib/zodDate');

// `ctc` is MONTHLY gross throughout this module (see schema.prisma comment).
// `components` must sum to `ctc` within a paisa of rounding — caught here,
// not left for the payroll run to silently misreport.
const componentsSchema = z.record(z.string().min(1), z.coerce.number());

const createSalaryStructureSchema = z
  .object({
    org_membership_id: z.string().uuid(),
    effective_from: requiredDate,
    ctc: z.coerce.number().positive(),
    components: componentsSchema,
  })
  .refine(
    (v) => Math.abs(Object.values(v.components).reduce((sum, n) => sum + n, 0) - v.ctc) < 0.01,
    { message: 'components must sum to ctc', path: ['components'] }
  );

// Edit — every field optional, but at least one; the ctc-vs-components sum is
// checked by the service against the merged result (either may arrive alone).
const updateSalaryStructureSchema = z
  .object({
    effective_from: requiredDate.optional(),
    ctc: z.coerce.number().positive().optional(),
    components: componentsSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

// Payroll filters (Employee / Department / Team), combinable.
const payrollFiltersSchema = z.object({
  org_membership_id: z.string().uuid().optional(),
  department_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
});

const listSalaryStructuresQuerySchema = payrollFiltersSchema;

const attendanceSalaryQuerySchema = payrollFiltersSchema.extend({
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
});

// Admin: switch some people (and / or the whole IT department) to a pay basis - reason required.
const setPayBasisSchema = z.object({
  pay_basis: z.enum(['timesheet', 'attendance']),
  org_membership_ids: z.array(z.string().uuid()).max(500).default([]),
  it_department: z.boolean().default(false),
  reason: z.string().trim().min(3).max(500),
});

const createRunSchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
});

const listRunsQuerySchema = z.object({
  status: z.enum(['draft', 'processed']).optional(),
});

const listPayslipsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const ADJUSTMENT_KINDS = ['tds', 'ot_adjustment', 'variable_pay', 'reimbursement', 'addition', 'deduction'];
const salaryAdjustmentSchema = z.object({
  org_membership_id: z.string().uuid(),
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
  kind: z.enum(ADJUSTMENT_KINDS),
  amount: z.coerce.number().positive().max(100000000),
  note: z.string().trim().max(500).optional(),
});
const updateSalaryAdjustmentSchema = z
  .object({ kind: z.enum(ADJUSTMENT_KINDS).optional(), amount: z.coerce.number().positive().max(100000000).optional(), note: z.string().trim().max(500).optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
const listSalaryAdjustmentsQuerySchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12).optional(),
  period_year: z.coerce.number().int().min(2000).max(2100).optional(),
  org_membership_id: z.string().uuid().optional(),
});
const deleteSalaryAdjustmentSchema = z.object({ reason: z.string().trim().min(3).max(500) });

module.exports = {
  salaryAdjustmentSchema,
  updateSalaryAdjustmentSchema,
  listSalaryAdjustmentsQuerySchema,
  deleteSalaryAdjustmentSchema,
  createSalaryStructureSchema,
  updateSalaryStructureSchema,
  listSalaryStructuresQuerySchema,
  payrollFiltersSchema,
  attendanceSalaryQuerySchema,
  setPayBasisSchema,
  createRunSchema,
  listRunsQuerySchema,
  listPayslipsQuerySchema,
};
