const prisma = require('../../config/db');
const { detectFinanceChange } = require('../../lib/financeChanges');

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function periodBounds(period_month, period_year) {
  const period_start = new Date(Date.UTC(period_year, period_month - 1, 1));
  const period_end = new Date(Date.UTC(period_year, period_month, 0)); // last day of the month
  return { period_start, period_end, days_in_month: period_end.getUTCDate() };
}

async function createSalaryStructure(orgId, createdByUserId, { org_membership_id, effective_from, ctc, components }) {
  const membership = await prisma.orgMembership.findFirst({ where: { id: org_membership_id, org_id: orgId } });
  if (!membership) return { error: 'membership_not_found' };

  const structure = await prisma.salaryStructure.create({
    data: { org_id: orgId, org_membership_id, effective_from, ctc, components, created_by: createdByUserId },
  });
  // A new structure never rewrites a finalized month — it flags any locked
  // month from its effective date on for review.
  await detectFinanceChange(orgId, {
    source_type: 'salary_structure',
    source_id: structure.id,
    from_date: effective_from,
    org_membership_id,
    changed_by: createdByUserId,
    description: `New salary structure from ${effective_from.toISOString().slice(0, 10)} (CTC ${Number(ctc)})`,
    new_value: { ctc: Number(ctc), effective_from },
  });
  return { structure };
}

// Edit a structure in place (base salary, allowances, deductions — all
// components, with deductions as negative lines — plus CTC and effective date).
// The same invariant as on create must still hold for the RESULT: components
// sum to ctc. Payroll reads the structure at processing time, so a draft run
// picks the change up; already-processed payslips are frozen and stay as they
// were. The employee cannot be changed — that would be a different structure.
async function updateSalaryStructure(orgId, actorUserId, structureId, patch) {
  const existing = await prisma.salaryStructure.findFirst({ where: { id: structureId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };

  const ctc = patch.ctc !== undefined ? patch.ctc : Number(existing.ctc);
  const components = patch.components !== undefined ? patch.components : existing.components;
  const total = Object.values(components).reduce((sum, n) => sum + Number(n), 0);
  if (Math.abs(total - ctc) >= 0.01) return { error: 'components_mismatch', total, ctc };

  const structure = await prisma.salaryStructure.update({
    where: { id: structureId },
    data: {
      ctc,
      components,
      ...(patch.effective_from !== undefined ? { effective_from: patch.effective_from } : {}),
      updated_at: new Date(),
      updated_by: actorUserId,
    },
    include: { org_membership: { select: { id: true, person: { select: { id: true, name: true } } } } },
  });
  const from = existing.effective_from < structure.effective_from ? existing.effective_from : structure.effective_from;
  await detectFinanceChange(orgId, {
    source_type: 'salary_structure',
    source_id: structureId,
    from_date: from,
    org_membership_id: existing.org_membership_id,
    changed_by: actorUserId,
    description: `Salary structure edited (CTC ${Number(existing.ctc)} → ${Number(structure.ctc)})`,
    old_value: { ctc: Number(existing.ctc), effective_from: existing.effective_from },
    new_value: { ctc: Number(structure.ctc), effective_from: structure.effective_from },
  });
  return { structure };
}

// Payroll filters — Employee, Department, Team — combinable. Department
// matches the membership's department or (legacy) the person's own.
function payrollMemberWhere({ org_membership_id, department_id, team_id } = {}) {
  const { membershipFilterWhere } = require('../calculations/engines/salary.engine');
  const where = membershipFilterWhere({ org_membership_id, department_id, team_id });
  return Object.keys(where).length ? { org_membership: where } : {};
}

const PAYROLL_MEMBER_INCLUDE = { org_membership: { select: { id: true, employee_code: true, department: { select: { id: true, name: true } }, team: { select: { id: true, name: true } }, person: { select: { id: true, name: true, department: { select: { id: true, name: true } } } } } } };

async function listSalaryStructures(orgId, filters = {}) {
  return prisma.salaryStructure.findMany({
    where: { org_id: orgId, ...payrollMemberWhere(filters) },
    orderBy: [{ org_membership_id: 'asc' }, { effective_from: 'desc' }],
    include: PAYROLL_MEMBER_INCLUDE,
  });
}

async function listMySalaryStructures(orgId, orgMembershipId) {
  return prisma.salaryStructure.findMany({
    where: { org_id: orgId, org_membership_id: orgMembershipId },
    orderBy: { effective_from: 'desc' },
  });
}

async function createRun(orgId, { period_month, period_year }) {
  const existing = await prisma.payrollRun.findUnique({
    where: { org_id_period_month_period_year: { org_id: orgId, period_month, period_year } },
  });
  if (existing) return { error: 'run_exists', run: existing };

  const run = await prisma.payrollRun.create({ data: { org_id: orgId, period_month, period_year } });
  return { run };
}

async function listRuns(orgId, { status }) {
  return prisma.payrollRun.findMany({
    where: { org_id: orgId, ...(status ? { status } : {}) },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }],
  });
}

// One employee's paid/unpaid day breakdown for the period. Documented
// assumptions (see schema.prisma's Payslip comment):
// - 5-day work week — Sat/Sun always paid, non-working. No weekly-off
//   calendar exists yet to configure this per org.
// - The month's WORKING days come from the employee's own calendar (Mon–Fri
//   less that calendar's holidays), so a 19-, 20-, 21- or 22-day month each
//   gives its own per-day rate: per_day_pay = ctc / working_days. Nothing is
//   divided by a fixed 30 or by the calendar-day count any more.
// - A working day counts as paid when attendance is present/wfh (full) or
//   half_day (half), or an approved LeaveRequest with a paid LeaveType covers
//   it. Weekends and the calendar's holidays are paid non-working days — they
//   are already inside the monthly ctc, so they neither add nor deduct.
// - Everything else on a working day (absent, unpaid leave, or simply no
//   attendance record and no leave) is an unpaid day — loss of pay.
// - `asOf` (optional) is the live "salary incurred so far" mode used by Live
//   Analytics: working days after it are `upcoming_days`, never loss of pay,
//   and `earned_to_date` is what the days up to it have earned. A full-month
//   run passes no asOf, so earned_to_date = net.
// - Overtime is tracked (`overtime_minutes`) but not paid — no overtime pay
//   policy exists yet (Phase 3's own deferred item).
function computeBreakdown({ period_start, period_end, days_in_month, ctc, attendanceByDate, leaveRanges, holidaySet, asOf = null }) {
  let weekend_days = 0;
  let holiday_days = 0;
  let present_days = 0;
  let half_days = 0;
  let paid_leave_days = 0;
  let unpaid_leave_days = 0;
  let unpaid_days = 0;
  let upcoming_days = 0;
  let overtime_minutes = 0;

  for (let d = 1; d <= days_in_month; d += 1) {
    const day = new Date(Date.UTC(period_start.getUTCFullYear(), period_start.getUTCMonth(), d));
    const dow = day.getUTCDay();
    const key = ymd(day);

    if (dow === 0 || dow === 6) {
      weekend_days += 1;
      continue;
    }
    if (holidaySet.has(key)) {
      holiday_days += 1;
      continue;
    }
    if (asOf && day > asOf) {
      upcoming_days += 1;
      continue;
    }

    const attendance = attendanceByDate.get(key);
    if (attendance) {
      overtime_minutes += attendance.overtime_minutes || 0;
      if (attendance.status === 'present' || attendance.status === 'wfh') {
        present_days += 1;
        continue;
      }
      if (attendance.status === 'half_day') {
        half_days += 1;
        continue;
      }
    }

    const leaveHit = leaveRanges.find((r) => day >= r.from_date && day <= r.to_date);
    if (leaveHit) {
      if (leaveHit.paid) paid_leave_days += 1;
      else unpaid_leave_days += 1;
      continue;
    }

    unpaid_days += 1;
  }

  const working_days = days_in_month - weekend_days - holiday_days;
  // half_day counts as a working day but only half-paid, so it's half a
  // day's deduction — not a full loss like unpaid_days/unpaid_leave_days.
  const lop_days = unpaid_leave_days + unpaid_days + half_days * 0.5;
  const paid_days = working_days - upcoming_days - lop_days;
  const per_day_pay = working_days > 0 ? Number(ctc) / working_days : 0;
  const deductions = Math.round(per_day_pay * lop_days * 100) / 100;
  const gross = Number(ctc);
  const net = Math.round((gross - deductions) * 100) / 100;
  const earned_to_date = Math.round(per_day_pay * paid_days * 100) / 100;

  return {
    breakdown: {
      period_start: ymd(period_start),
      period_end: ymd(period_end),
      days_in_month,
      working_days,
      weekend_days,
      holiday_days,
      present_days,
      half_days,
      paid_leave_days,
      unpaid_leave_days,
      unpaid_days,
      upcoming_days,
      lop_days,
      paid_days,
      overtime_minutes,
      per_day_pay: Math.round(per_day_pay * 100) / 100,
      earned_to_date,
      as_of: asOf ? ymd(asOf) : null,
    },
    gross,
    deductions,
    net,
  };
}

// Processing freezes the run into payslips. The figures come from the ONE
// attendance-based salary calculation (calculations/engines/salary.engine):
// if the month's salary calculation has been LOCKED (Live Analytics → Salary
// → Lock), its locked version is used as-is, so the payslips match exactly
// what was reviewed and finalized; otherwise the month is computed now.
async function processRun(orgId, runId, adminUserId) {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, org_id: orgId } });
  if (!run) return { error: 'not_found' };
  if (run.status !== 'draft') return { error: 'already_processed' };

  // Lazy: salary.engine itself builds on computeBreakdown from this module.
  const salaryEngine = require('../calculations/engines/salary.engine');
  const calculations = require('../calculations/calculations.service');
  const period = { period_month: run.period_month, period_year: run.period_year };

  const locked = await calculations.lockedVersion(orgId, 'salary', 'org', period);
  const result = locked ? locked.snapshot : await salaryEngine.computeSalary(orgId, period);

  // Contractors are paid through their vendor (Finance → vendor invoices),
  // never through payroll — the engine lists them as skipped.
  const skipped = (result.skipped || []).map(({ org_membership_id, reason }) => ({ org_membership_id, reason }));
  const payslipRows = result.lines.map((line) => ({
    org_id: orgId,
    payroll_run_id: run.id,
    org_membership_id: line.org_membership_id,
    gross: line.gross,
    deductions: line.deductions,
    net: line.net,
    breakdown: { ...line.breakdown, ...(locked ? { calculation_version: locked.version } : {}) },
  }));

  const updated = await prisma.$transaction(async (tx) => {
    if (payslipRows.length) await tx.payslip.createMany({ data: payslipRows });
    return tx.payrollRun.update({
      where: { id: run.id },
      data: { status: 'processed', run_at: new Date(), processed_by: adminUserId, skipped },
    });
  });

  return { run: updated, payslips_generated: payslipRows.length, skipped, from_locked_version: locked ? locked.version : null };
}

async function listRunPayslips(orgId, runId, filters = {}) {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, org_id: orgId } });
  if (!run) return { error: 'not_found' };

  const data = await prisma.payslip.findMany({
    where: { payroll_run_id: runId, org_id: orgId, ...payrollMemberWhere(filters) },
    orderBy: { generated_at: 'asc' },
    include: PAYROLL_MEMBER_INCLUDE,
  });
  return { data };
}

// Payroll → Attendance salary: the month's attendance-based salary per
// employee (the same calculation a run processes), honouring the filters.
// A locked month shows its locked figures.
async function attendanceSalary(orgId, query) {
  const live = require('../calculations/live.service');
  return live.salaryLive(orgId, query);
}

async function listMyPayslips(orgId, orgMembershipId, { page, limit }) {
  const where = { org_id: orgId, org_membership_id: orgMembershipId };
  const [data, total] = await Promise.all([
    prisma.payslip.findMany({
      where,
      orderBy: { generated_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { payroll_run: { select: { id: true, period_month: true, period_year: true } } },
    }),
    prisma.payslip.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

async function getPayslip(orgId, payslipId, { orgMembershipId, isAdmin }) {
  const payslip = await prisma.payslip.findFirst({
    where: { id: payslipId, org_id: orgId },
    include: { payroll_run: { select: { id: true, period_month: true, period_year: true } } },
  });
  if (!payslip) return { error: 'not_found' };
  if (!isAdmin && payslip.org_membership_id !== orgMembershipId) return { error: 'not_found' };
  return { payslip };
}

module.exports = {
  createSalaryStructure,
  updateSalaryStructure,
  listSalaryStructures,
  listMySalaryStructures,
  createRun,
  listRuns,
  processRun,
  listRunPayslips,
  attendanceSalary,
  listMyPayslips,
  getPayslip,
  // exported for tests only
  computeBreakdown,
  periodBounds,
};
