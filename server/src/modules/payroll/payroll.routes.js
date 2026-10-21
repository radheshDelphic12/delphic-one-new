const express = require('express');
const { canMethod } = require('../../lib/permissions');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./payroll.service');
const adjustmentsService = require('./salaryAdjustments.service');
const paymentsService = require('./salaryPayments.service');
const fnfService = require('./fnf.service');
const incrementService = require('./incrementReminders.service');
const previousDues = require('./previousDues.service');
const { z } = require('zod');
const {
  createSalaryStructureSchema,
  updateSalaryStructureSchema,
  listSalaryStructuresQuerySchema,
  payrollFiltersSchema,
  attendanceSalaryQuerySchema,
  setPayBasisSchema,
  createRunSchema,
  refreshRunSchema,
  listRunsQuerySchema,
  listPayslipsQuerySchema,
  salaryAdjustmentSchema,
  updateSalaryAdjustmentSchema,
  listSalaryAdjustmentsQuerySchema,
  deleteSalaryAdjustmentSchema,
  salaryPaymentsQuerySchema,
  salaryPaymentSchema,
} = require('./payroll.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

const ERRORS = {
  ...require('../cashPosition/cash.hooks').HOOK_ERRORS,
  membership_not_found: [404, 'Org membership not found'],
  not_found: [404, 'Not found'],
  already_processed: [409, 'That payroll run has already been processed'],
  not_processed: [409, 'Process the payroll run first - only a processed run can be updated'],
  bad_range: [422, 'Choose a valid month range (at most 24 months)'],
  future_paid_on: [422, 'The payment date cannot be in the future'],
  paid_on_required: [422, 'Enter the date the salary was paid'],
  nobody_selected: [422, 'Pick at least one person, or the IT department'],
};

function failFor(res, error) {
  const mapped = ERRORS[error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

router.post(
  '/salary-structures',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const body = createSalaryStructureSchema.parse(req.body);
    const result = await service.createSalaryStructure(req.user.org_id, req.user.id, body);
    if (result.error) return failFor(res, result.error);
    return created(res, result.structure);
  })
);

router.patch(
  '/salary-structures/:id',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const body = updateSalaryStructureSchema.parse(req.body);
    const result = await service.updateSalaryStructure(req.user.org_id, req.user.id, req.params.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Salary structure not found');
    if (result.error === 'components_mismatch') {
      return fail(res, 422, `Components total ${result.total} but CTC is ${result.ctc} — they must match exactly`);
    }
    return ok(res, result.structure);
  })
);

router.delete(
  '/salary-structures/:id',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.deleteSalaryStructure(req.user.org_id, req.user.id, req.params.id);
    if (result.error === 'not_found') return fail(res, 404, 'Salary structure not found');
    return ok(res, result);
  })
);

router.get(
  '/salary-structures',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const query = listSalaryStructuresQuerySchema.parse(req.query);
    const rows = await service.listSalaryStructures(req.user.org_id, query);
    return ok(res, rows);
  })
);

router.get(
  '/salary-structures/me',
  asyncHandler(async (req, res) => {
    const rows = await service.listMySalaryStructures(req.user.org_id, req.user.org_membership_id);
    return ok(res, rows);
  })
);

router.get(
  '/attendance-salary',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => ok(res, await service.attendanceSalary(req.user.org_id, attendanceSalaryQuerySchema.parse(req.query))))
);

// What each person would be paid under each basis (timesheet vs attendance) for a month - check before switching.
router.get(
  '/pay-basis',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => ok(res, await service.payBasisComparison(req.user.org_id, attendanceSalaryQuerySchema.parse(req.query))))
);

router.post(
  '/pay-basis',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const body = setPayBasisSchema.parse(req.body);
    // Salary is calculated from attendance for everyone; the timesheet option is switched off.
    if (body.pay_basis === 'timesheet') return fail(res, 422, 'Salary is calculated from attendance only - the timesheet option is switched off');
    const result = await service.setPayBasis(req.user.org_id, req.user.id, body);
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);

router.post(
  '/runs',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const body = createRunSchema.parse(req.body);
    const result = await service.createRun(req.user.org_id, body);
    if (result.error === 'run_exists') return fail(res, 409, 'A payroll run already exists for that period');
    return created(res, result.run);
  })
);

router.get(
  '/runs',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const query = listRunsQuerySchema.parse(req.query);
    const rows = await service.listRuns(req.user.org_id, query);
    return ok(res, rows);
  })
);

router.post(
  '/runs/:id/process',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.processRun(req.user.org_id, req.params.id, req.user.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, { run: result.run, payslips_generated: result.payslips_generated, skipped: result.skipped });
  })
);

// Bring a processed run up to date after salary changed: payslips whose figures moved are updated in place
// (each change kept as a revision with the reason), new eligible employees get a payslip.
router.post(
  '/runs/:id/refresh',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.refreshRun(req.user.org_id, req.params.id, req.user, refreshRunSchema.parse(req.body || {}));
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);

router.get(
  '/runs/:id/payslips',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await service.listRunPayslips(req.user.org_id, req.params.id, payrollFiltersSchema.parse(req.query));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.data);
  })
);

router.get(
  '/payslips/me',
  asyncHandler(async (req, res) => {
    const query = listPayslipsQuerySchema.parse(req.query);
    const result = await service.listMyPayslips(req.user.org_id, req.user.org_membership_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.get(
  '/payslips/:id',
  asyncHandler(async (req, res) => {
    const result = await service.getPayslip(req.user.org_id, req.params.id, {
      orgMembershipId: req.user.org_membership_id,
      isAdmin: req.user.role === 'admin',
    });
    if (result.error) return failFor(res, result.error);
    return ok(res, result.payslip);
  })
);

// Monthly salary adjustments (TDS, OT adjustment, variable pay, reimbursement, other additions / deductions).
// Admin only; each change is audited and flags a locked month for recalculation.
router.get(
  '/adjustments',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => ok(res, await adjustmentsService.list(req.user.org_id, listSalaryAdjustmentsQuerySchema.parse(req.query))))
);
router.post(
  '/adjustments',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await adjustmentsService.create(req.user.org_id, req.user, salaryAdjustmentSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return created(res, result.adjustment);
  })
);
router.patch(
  '/adjustments/:id',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await adjustmentsService.update(req.user.org_id, req.user, req.params.id, updateSalaryAdjustmentSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.adjustment);
  })
);
router.delete(
  '/adjustments/:id',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await adjustmentsService.remove(req.user.org_id, req.user, req.params.id, deleteSalaryAdjustmentSchema.parse(req.body || {}));
    if (result.error) return failFor(res, result.error);
    return ok(res, { deleted: true });
  })
);

// Salary payment status (paid or not, plus the transaction details) for every employee and month. Admin only.
router.get(
  '/salary-payments',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await paymentsService.dashboard(req.user.org_id, salaryPaymentsQuerySchema.parse(req.query));
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);
router.put(
  '/salary-payments',
  canMethod('financials', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await paymentsService.save(req.user.org_id, req.user, salaryPaymentSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.payment);
  })
);

// --- FnF (full and final settlement of exited employees) ---
const fnfPatch = z.object({
  amount: z.coerce.number().min(0).max(1e12).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => (v ? new Date(`${v}T00:00:00.000Z`) : v)),
  fnf_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => (v ? new Date(`${v}T00:00:00.000Z`) : v)),
  status: z.enum(['pending', 'in_progress', 'settled']).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
router.get('/fnf', canMethod('financials', 'admin'), asyncHandler(async (req, res) => ok(res, await fnfService.list(req.user.org_id, { status: typeof req.query.status === 'string' ? req.query.status : undefined }))));
router.patch('/fnf/:membershipId', canMethod('financials', 'admin'), asyncHandler(async (req, res) => {
  const result = await fnfService.upsert(req.user.org_id, req.user.id, req.params.membershipId, fnfPatch.parse(req.body));
  if (result.error === 'not_found') return fail(res, 404, 'Employee not found');
  if (result.error === 'not_exited') return fail(res, 422, 'FnF applies to employees who have exited');
  return ok(res, result.record);
}));

// --- Increment reminders (Super Admin users only) ---
router.get('/increment-reminders', asyncHandler(async (req, res) => {
  const result = await incrementService.list(req.user, { status: ['pending', 'completed', 'ignored', 'all'].includes(req.query.status) ? req.query.status : 'pending' });
  if (result.error) return fail(res, 403, 'Only Super Admin users see increment reminders');
  return ok(res, result.rows);
}));
router.post('/increment-reminders/:id/decision', asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['completed', 'ignored']) }).parse(req.body);
  const result = await incrementService.decide(req.user, req.params.id, status);
  if (result.error === 'forbidden') return fail(res, 403, 'Only Super Admin users can decide increment reminders');
  if (result.error) return fail(res, 404, 'Reminder not found');
  return ok(res, result.reminder);
}));

// --- Previous months' unpaid salary, offered when a month is prepared ---
router.get('/runs/:id/previous-dues', canMethod('financials', 'admin'), asyncHandler(async (req, res) => {
  const result = await previousDues.forRun(req.user.org_id, req.params.id);
  if (result.error) return fail(res, 404, 'Payroll run not found');
  return ok(res, result.dues, { run: result.run });
}));
router.post('/runs/:id/previous-dues/add', canMethod('financials', 'admin'), asyncHandler(async (req, res) => {
  const body = z.object({ org_membership_id: z.string().uuid(), due_month: z.number().int().min(1).max(12), due_year: z.number().int().min(2000).max(2100) }).parse(req.body);
  const result = await previousDues.add(req.user.org_id, req.user, req.params.id, body);
  if (result.error === 'not_found') return fail(res, 404, 'Payroll run not found');
  if (result.error === 'not_due') return fail(res, 409, 'That amount is no longer due (it was added already or the figures changed)');
  if (result.error) return failFor(res, result.error, result);
  return ok(res, result.due, { needs_refresh: result.needs_refresh });
}));

module.exports = router;
