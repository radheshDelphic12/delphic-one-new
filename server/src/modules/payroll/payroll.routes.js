const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./payroll.service');
const {
  createSalaryStructureSchema,
  updateSalaryStructureSchema,
  listSalaryStructuresQuerySchema,
  payrollFiltersSchema,
  attendanceSalaryQuerySchema,
  createRunSchema,
  listRunsQuerySchema,
  listPayslipsQuerySchema,
} = require('./payroll.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

const ERRORS = {
  membership_not_found: [404, 'Org membership not found'],
  not_found: [404, 'Not found'],
  already_processed: [409, 'That payroll run has already been processed'],
};

function failFor(res, error) {
  const mapped = ERRORS[error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

router.post(
  '/salary-structures',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createSalaryStructureSchema.parse(req.body);
    const result = await service.createSalaryStructure(req.user.org_id, req.user.id, body);
    if (result.error) return failFor(res, result.error);
    return created(res, result.structure);
  })
);

router.patch(
  '/salary-structures/:id',
  authorize('admin'),
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
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.deleteSalaryStructure(req.user.org_id, req.user.id, req.params.id);
    if (result.error === 'not_found') return fail(res, 404, 'Salary structure not found');
    return ok(res, result);
  })
);

router.get(
  '/salary-structures',
  authorize('admin'),
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
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await service.attendanceSalary(req.user.org_id, attendanceSalaryQuerySchema.parse(req.query))))
);

router.post(
  '/runs',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createRunSchema.parse(req.body);
    const result = await service.createRun(req.user.org_id, body);
    if (result.error === 'run_exists') return fail(res, 409, 'A payroll run already exists for that period');
    return created(res, result.run);
  })
);

router.get(
  '/runs',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listRunsQuerySchema.parse(req.query);
    const rows = await service.listRuns(req.user.org_id, query);
    return ok(res, rows);
  })
);

router.post(
  '/runs/:id/process',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.processRun(req.user.org_id, req.params.id, req.user.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, { run: result.run, payslips_generated: result.payslips_generated, skipped: result.skipped });
  })
);

router.get(
  '/runs/:id/payslips',
  authorize('admin'),
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

module.exports = router;
