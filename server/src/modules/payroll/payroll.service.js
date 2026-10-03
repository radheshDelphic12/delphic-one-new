const prisma = require('../../config/db');
const { detectFinanceChange } = require('../../lib/financeChanges');
const { leaveHoursForDay } = require('../leave/leaveHours');

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

// Admin deletes a structure (e.g. created by mistake). Payroll reads
// structures at processing time, so draft runs simply fall back to the
// previous structure; processed payslips keep their frozen figures, and any
// locked month from its effective date on is flagged for review.
async function deleteSalaryStructure(orgId, actorUserId, structureId) {
  const existing = await prisma.salaryStructure.findFirst({ where: { id: structureId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  await prisma.salaryStructure.delete({ where: { id: structureId } });
  const change = await detectFinanceChange(orgId, {
    source_type: 'salary_structure',
    source_id: structureId,
    from_date: existing.effective_from,
    org_membership_id: existing.org_membership_id,
    changed_by: actorUserId,
    description: `Salary structure from ${ymd(existing.effective_from)} deleted (CTC ${Number(existing.ctc)})`,
    old_value: { ctc: Number(existing.ctc), effective_from: existing.effective_from },
    new_value: null,
  });
  return { deleted: true, flagged: change?.flagged || 0 };
}

// Payroll filters — Employee, Department, Team — combinable. Department
// matches the membership's department or (legacy) the person's own.
function payrollMemberWhere({ org_membership_id, department_id, team_id } = {}) {
  const { membershipFilterWhere } = require('../calculations/engines/salary.engine');
  const where = membershipFilterWhere({ org_membership_id, department_id, team_id });
  return Object.keys(where).length ? { org_membership: where } : {};
}

const PAYROLL_MEMBER_INCLUDE = { org_membership: { select: { id: true, employee_code: true, employment_status: true, department: { select: { id: true, name: true } }, team: { select: { id: true, name: true } }, person: { select: { id: true, name: true, department: { select: { id: true, name: true } } } } } } };

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

// One employee's salary for the period. The SOURCE depends on the person's pay basis
// (OrgMembership.pay_basis, set by an admin):
//   timesheet (default) - APPROVED TIMESHEET HOURS, never attendance (rules below);
//   attendance          - the attendance MARKING: every company working day counts the
//                         shift when marked present / wfh, half the shift when half_day,
//                         nothing when absent. Approved leave pays / doesn't pay per its type
//                         (leave and attendance never double count), and a past working day
//                         with no marking and no leave is "unmarked" - unpaid, listed in
//                         `unmarked_days` and blocking the salary lock until an admin marks it.
//                         Project timesheets only feed client billing; overtime is
//                         ticket based (phase 3), so the timesheet never creates OT here.
// The rules below are described for the timesheet basis; both share the deficit logic.
//
// - Expected hours: each company working day (the employee's company calendar:
//   Mon–Fri less its holidays, plus any weekend it marks as a working day) ×
//   the daily shift hours. Weekends / company holidays are paid non-working
//   days — already inside the monthly ctc.
// - hourly_rate = ctc / expected hours of the month.
// - A working day is paid for its approved hours up to the shift (a paid
//   leave day counts as the full shift). Anything short is a deficit, deducted
//   at the hourly rate. Pending and rejected hours are never paid.
// - Hours beyond the day's expected hours (incl. any hours on a weekend /
//   company holiday) are overtime, paid ONLY when the day's overtime is
//   approved (TimesheetDayOvertime), at the hourly rate × OT_MULTIPLIER.
//   comp_off overtime earns time off, not pay.
// - Projection: the same with pending hours / pending OT counted as if
//   approved — `projected_net`; `pending_amount` = projected_net − net.
// - `asOf` (optional) = the live "salary incurred so far" mode used by Live
//   Analytics: working days after it are `upcoming_days`, never a deficit, and
//   `earned_to_date` is what the days up to it have earned.
const OT_MULTIPLIER = 1;

// A day's share of the shift for an attendance marking (anything else pays nothing).
const ATTENDANCE_DAY_SHARE = { present: 1, wfh: 1, half_day: 0.5 };

// 'attendance' only when an admin chose it; everyone else keeps the timesheet basis.
// Salary is paid from attendance for everyone (timesheets no longer feed pay).
function payBasisOf() {
  return 'attendance';
}

function computeBreakdown({ period_start, period_end, days_in_month, ctc, hoursByDate = new Map(), overtimeByDate = new Map(), leaveRanges = [], holidaySet = new Set(), workingSet = new Set(), shiftHours = 9, attendanceByDate = new Map(), asOf = null, payBasis = 'timesheet', ticketsByDate = new Map() }) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const attendanceMode = payBasis === 'attendance';
  let half_days = 0;
  let absent_days = 0;
  let unmarked_days = 0;
  let weekend_days = 0;
  let holiday_days = 0;
  let working_days = 0;
  let upcoming_days = 0;
  let paid_leave_days = 0;
  let unpaid_leave_days = 0;
  let paid_leave_hours = 0;
  let unpaid_leave_hours = 0;
  let present_days = 0;
  let expected_hours = 0;
  let paid_hours = 0; // approved normal hours + paid leave, on past working days
  let paid_hours_to_date = 0;
  let deficit_hours = 0;
  let projected_deficit_hours = 0;
  let approved_hours = 0;
  let pending_hours = 0;
  let ot_approved_hours = 0;
  let ot_pending_hours = 0;
  let ot_rejected_hours = 0;
  let comp_off_days = 0;

  for (let d = 1; d <= days_in_month; d += 1) {
    const day = new Date(Date.UTC(period_start.getUTCFullYear(), period_start.getUTCMonth(), d));
    const key = ymd(day);
    const dow = day.getUTCDay();
    const isWorking = workingSet.has(key) || (dow !== 0 && dow !== 6 && !holidaySet.has(key));
    if (!isWorking) {
      if (dow === 0 || dow === 6) weekend_days += 1;
      else holiday_days += 1;
    } else working_days += 1;
    const expected = isWorking ? shiftHours : 0;
    expected_hours += expected;

    const att = attendanceByDate.get(key);
    if (att && (att.status === 'present' || att.status === 'wfh' || att.status === 'half_day')) present_days += 1;

    let logged = hoursByDate.get(key) || { approved: 0, pending: 0 };
    // Attendance basis: the day's hours are what the marking says, not what was logged on projects.
    if (attendanceMode) logged = { approved: isWorking ? expected * (att ? ATTENDANCE_DAY_SHARE[att.status] || 0 : 0) : 0, pending: 0 };
    approved_hours += logged.approved;
    pending_hours += logged.pending;
    const ot = overtimeByDate.get(key) || null;
    const otApprovedExcess = Math.max(0, logged.approved - expected);
    const otProjectedExcess = Math.max(0, logged.approved + logged.pending - expected);
    const otStatus = ot?.status || (otProjectedExcess > 0 ? 'pending' : null);
    if (otStatus === 'approved') ot_approved_hours += Math.min(Number(ot.hours), otApprovedExcess);
    if (otStatus === 'approved' || otStatus === 'pending') ot_pending_hours += Math.max(0, otProjectedExcess - (otStatus === 'approved' ? Math.min(Number(ot.hours), otApprovedExcess) : 0));
    if (otStatus === 'rejected') ot_rejected_hours += otProjectedExcess;
    if (otStatus === 'comp_off') comp_off_days += 1;
    // Attendance basis: overtime is what the manager approved on tickets (never timesheet hours).
    if (attendanceMode) {
      const t = ticketsByDate.get(key);
      if (t) {
        ot_approved_hours += t.approved;
        ot_pending_hours += t.pending;
        ot_rejected_hours += t.rejected;
      }
    }

    if (!isWorking) continue;
    if (asOf && day > asOf) {
      upcoming_days += 1;
      continue;
    }
    // Approved leave only (callers pass nothing else). A full day = the shift, a
    // half day = half of it; paid leave hours are paid, unpaid never are, and
    // worked hours fill only what the leave leaves free (working + leave <=
    // the day), so leave and timesheet hours are never counted twice.
    const dayLeave = leaveHoursForDay(leaveRanges.filter((r) => day >= r.from_date && day <= r.to_date), expected);
    const workCap = expected - dayLeave.total;
    if (attendanceMode) {
      if (!att && dayLeave.total < expected - 1e-9) unmarked_days += 1;
      else if (att && att.status === 'absent') absent_days += 1;
      else if (att && att.status === 'half_day') half_days += 1;
    }
    const paid = dayLeave.paid + Math.min(logged.approved, workCap);
    const projected = dayLeave.paid + Math.min(logged.approved + logged.pending, workCap);
    if (expected > 0) {
      paid_leave_days += dayLeave.paid / expected;
      unpaid_leave_days += dayLeave.unpaid / expected;
    }
    paid_leave_hours += dayLeave.paid;
    unpaid_leave_hours += dayLeave.unpaid;
    paid_hours += paid;
    paid_hours_to_date += paid;
    deficit_hours += expected - paid;
    projected_deficit_hours += expected - projected;
  }

  const hourly_rate = expected_hours > 0 ? Number(ctc) / expected_hours : 0;
  const per_day_pay = working_days > 0 ? Number(ctc) / working_days : 0;
  const ot_amount = r2(ot_approved_hours * hourly_rate * OT_MULTIPLIER);
  const projected_ot_amount = r2((ot_approved_hours + ot_pending_hours) * hourly_rate * OT_MULTIPLIER);
  const deductions = r2(hourly_rate * deficit_hours);
  const gross = r2(Number(ctc) + ot_amount);
  const net = r2(gross - deductions);
  const projected_net = r2(Number(ctc) + projected_ot_amount - hourly_rate * projected_deficit_hours);
  const earned_to_date = r2(hourly_rate * paid_hours_to_date + ot_amount);
  // Day-based view of the same deficit, for the existing screens.
  const lop_days = shiftHours > 0 ? r2(deficit_hours / shiftHours) : 0;

  return {
    breakdown: {
      source: attendanceMode ? 'attendance' : 'approved_timesheets',
      pay_basis: attendanceMode ? 'attendance' : 'timesheet',
      half_days,
      absent_days,
      unmarked_days,
      period_start: ymd(period_start),
      period_end: ymd(period_end),
      days_in_month,
      working_days,
      weekend_days,
      holiday_days,
      upcoming_days,
      shift_hours: shiftHours,
      expected_hours: r2(expected_hours),
      approved_hours: r2(approved_hours),
      pending_hours: r2(pending_hours),
      paid_hours: r2(paid_hours),
      deficit_hours: r2(deficit_hours),
      paid_leave_days: r2(paid_leave_days),
      unpaid_leave_days: r2(unpaid_leave_days),
      paid_leave_hours: r2(paid_leave_hours),
      unpaid_leave_hours: r2(unpaid_leave_hours),
      // Presence only (check-in / check-out) — shown, never paid from.
      present_days,
      lop_days,
      paid_days: r2(working_days - upcoming_days - lop_days),
      hourly_rate: r2(hourly_rate),
      per_day_pay: r2(per_day_pay),
      ot_approved_hours: r2(ot_approved_hours),
      ot_pending_hours: r2(ot_pending_hours),
      ot_rejected_hours: r2(ot_rejected_hours),
      ot_multiplier: OT_MULTIPLIER,
      ot_amount,
      comp_off_days,
      earned_to_date,
      projected_net,
      pending_amount: r2(projected_net - net),
      as_of: asOf ? ymd(asOf) : null,
    },
    gross,
    deductions,
    net,
  };
}

// Processing freezes the run into payslips. The figures come from the ONE
// timesheet-based salary calculation (calculations/engines/salary.engine):
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
  // Employees locked one by one (Live Analytics → Salary → Lock) are paid
  // exactly their locked figures; the rest of the month is computed now.
  const individual = locked ? new Map() : await calculations.lockedRecords(orgId, 'salary_employee', period);
  const lines = result.lines.map((line) => {
    const own = individual.get(line.org_membership_id);
    const lockedLine = own?.snapshot?.lines?.find((l) => l.org_membership_id === line.org_membership_id);
    return lockedLine ? { ...lockedLine, calculation_version: own.version } : line;
  });

  // Contractors are paid through their vendor (Finance → vendor invoices),
  // never through payroll — the engine lists them as skipped.
  const skipped = (result.skipped || []).map(({ org_membership_id, reason }) => ({ org_membership_id, reason }));
  const payslipRows = lines.map((line) => ({
    org_id: orgId,
    payroll_run_id: run.id,
    org_membership_id: line.org_membership_id,
    gross: line.gross,
    deductions: line.deductions,
    net: line.net,
    breakdown: { ...line.breakdown, ...(locked ? { calculation_version: locked.version } : line.calculation_version ? { calculation_version: line.calculation_version } : {}) },
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

// What each employee would be paid under each basis for a month, side by side, so an admin
// can check the attendance basis (unmarked days, absences) BEFORE switching anyone.
async function payBasisComparison(orgId, query) {
  const salaryEngine = require('../calculations/engines/salary.engine');
  return salaryEngine.comparePayBases(orgId, query);
}

// Admin: set the pay basis of some people (ids) and / or everyone in the IT department.
// Audited with the reason; locked months keep their locked figures, only live / future
// calculations follow the new basis.
async function setPayBasis(orgId, adminUserId, { pay_basis, org_membership_ids = [], it_department = false, reason }) {
  const where = { org_id: orgId, worker_type: { not: 'contractor' }, OR: [] };
  if (org_membership_ids.length) where.OR.push({ id: { in: org_membership_ids } });
  if (it_department) where.OR.push({ person: { department: { name: { equals: 'IT', mode: 'insensitive' } } } }, { department: { name: { equals: 'IT', mode: 'insensitive' } } });
  if (!where.OR.length) return { error: 'nobody_selected' };
  const people = await prisma.orgMembership.findMany({ where, select: { id: true, pay_basis: true, person: { select: { name: true } } } });
  const changing = people.filter((p) => (p.pay_basis === 'attendance' ? 'attendance' : 'timesheet') !== pay_basis);
  if (changing.length) await prisma.orgMembership.updateMany({ where: { id: { in: changing.map((p) => p.id) } }, data: { pay_basis } });
  await prisma.auditLog.create({
    data: {
      org_id: orgId,
      actor_id: adminUserId,
      action: 'pay_basis_set',
      entity_type: 'org_membership',
      entity_id: changing[0]?.id || people[0]?.id || orgId,
      reason,
      snapshot: { pay_basis, changed: changing.map((p) => ({ id: p.id, name: p.person?.name, from: p.pay_basis || 'timesheet' })), considered: people.length },
    },
  });
  return { pay_basis, changed: changing.length, considered: people.length };
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
  deleteSalaryStructure,
  createSalaryStructure,
  updateSalaryStructure,
  listSalaryStructures,
  listMySalaryStructures,
  createRun,
  listRuns,
  processRun,
  listRunPayslips,
  attendanceSalary,
  payBasisOf,
  setPayBasis,
  payBasisComparison,
  listMyPayslips,
  getPayslip,
  // exported for tests only
  computeBreakdown,
  periodBounds,
};
