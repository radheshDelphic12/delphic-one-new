const prisma = require('../../config/db');
const { pickCalendarId } = require('../calendars/calendars.service');

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
  return { structure };
}

async function listSalaryStructures(orgId, { org_membership_id }) {
  return prisma.salaryStructure.findMany({
    where: { org_id: orgId, ...(org_membership_id ? { org_membership_id } : {}) },
    orderBy: [{ org_membership_id: 'asc' }, { effective_from: 'desc' }],
    include: { org_membership: { select: { id: true, person: { select: { id: true, name: true } } } } },
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
// - A day counts as paid when: it's a weekend, it's a holiday on the org's
//   default Calendar, attendance is present/wfh (full) or half_day (half),
//   or an approved LeaveRequest with a paid LeaveType covers it.
// - Everything else on a working day (absent, unpaid leave, or simply no
//   attendance record and no leave) is an unpaid day — loss of pay.
// - Overtime is tracked (`overtime_minutes`) but not paid — no overtime pay
//   policy exists yet (Phase 3's own deferred item).
function computeBreakdown({ period_start, period_end, days_in_month, ctc, attendanceByDate, leaveRanges, holidaySet }) {
  let weekend_days = 0;
  let holiday_days = 0;
  let present_days = 0;
  let half_days = 0;
  let paid_leave_days = 0;
  let unpaid_leave_days = 0;
  let unpaid_days = 0;
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
  const paid_days = working_days - lop_days;
  const per_day_pay = ctc / days_in_month;
  const deductions = Math.round(per_day_pay * lop_days * 100) / 100;
  const gross = Number(ctc);
  const net = Math.round((gross - deductions) * 100) / 100;

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
      lop_days,
      paid_days,
      overtime_minutes,
      per_day_pay: Math.round(per_day_pay * 100) / 100,
    },
    gross,
    deductions,
    net,
  };
}

async function processRun(orgId, runId, adminUserId) {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, org_id: orgId } });
  if (!run) return { error: 'not_found' };
  if (run.status !== 'draft') return { error: 'already_processed' };

  const { period_start, period_end, days_in_month } = periodBounds(run.period_month, run.period_year);

  const memberships = await prisma.orgMembership.findMany({
    where: {
      org_id: orgId,
      joined_at: { lte: period_end },
      OR: [{ left_at: null }, { left_at: { gte: period_start } }],
    },
  });

  const [attendanceRows, leaveRows, holidayRows, calendars, employeeCalendars] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { org_id: orgId, date: { gte: period_start, lte: period_end } } }),
    prisma.leaveRequest.findMany({
      where: { org_id: orgId, status: 'approved', from_date: { lte: period_end }, to_date: { gte: period_start } },
      include: { leave_type: { select: { paid: true } } },
    }),
    prisma.calendarHoliday.findMany({
      where: { calendar: { org_id: orgId }, date: { gte: period_start, lte: period_end } },
      select: { calendar_id: true, date: true },
    }),
    prisma.calendar.findMany({ where: { org_id: orgId }, select: { id: true, location_id: true, is_default: true } }),
    prisma.employeeCalendar.findMany({
      where: { org_membership: { org_id: orgId } },
      select: { org_membership_id: true, account_id: true, calendar_id: true },
    }),
  ]);

  // Holidays are per-employee, not org-wide: each person's paid-holiday days
  // come from the calendar that governs them (their own mapping, else their
  // office location's calendar, else the org default) — an Ahmedabad and a
  // Gurgaon employee no longer share one holiday list. Project-specific
  // calendars only constrain timesheets; payroll follows the primary one.
  const holidaysByCalendar = new Map();
  for (const h of holidayRows) {
    if (!holidaysByCalendar.has(h.calendar_id)) holidaysByCalendar.set(h.calendar_id, new Set());
    holidaysByCalendar.get(h.calendar_id).add(ymd(h.date));
  }
  const assignmentsByMembership = new Map();
  for (const row of employeeCalendars) {
    if (!assignmentsByMembership.has(row.org_membership_id)) assignmentsByMembership.set(row.org_membership_id, []);
    assignmentsByMembership.get(row.org_membership_id).push(row);
  }
  const noHolidays = new Set();

  const attendanceByMembership = new Map();
  for (const row of attendanceRows) {
    if (!attendanceByMembership.has(row.org_membership_id)) attendanceByMembership.set(row.org_membership_id, new Map());
    attendanceByMembership.get(row.org_membership_id).set(ymd(row.date), row);
  }

  const leaveByMembership = new Map();
  for (const row of leaveRows) {
    if (!leaveByMembership.has(row.org_membership_id)) leaveByMembership.set(row.org_membership_id, []);
    leaveByMembership.get(row.org_membership_id).push({ from_date: row.from_date, to_date: row.to_date, paid: row.leave_type.paid });
  }

  const skipped = [];
  const payslipRows = [];

  for (const membership of memberships) {
    const structure = await prisma.salaryStructure.findFirst({
      where: { org_membership_id: membership.id, effective_from: { lte: period_end } },
      orderBy: { effective_from: 'desc' },
    });
    if (!structure) {
      skipped.push({ org_membership_id: membership.id, reason: 'no_salary_structure' });
      continue;
    }

    const { breakdown, gross, deductions, net } = computeBreakdown({
      period_start,
      period_end,
      days_in_month,
      ctc: structure.ctc,
      attendanceByDate: attendanceByMembership.get(membership.id) || new Map(),
      leaveRanges: leaveByMembership.get(membership.id) || [],
      holidaySet: holidaysByCalendar.get(
        pickCalendarId(
          { assignments: assignmentsByMembership.get(membership.id) || [], membershipLocationId: membership.location_id, calendars },
          null
        )
      ) || noHolidays,
    });

    payslipRows.push({
      org_id: orgId,
      payroll_run_id: run.id,
      org_membership_id: membership.id,
      gross,
      deductions,
      net,
      breakdown,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (payslipRows.length) await tx.payslip.createMany({ data: payslipRows });
    return tx.payrollRun.update({
      where: { id: run.id },
      data: { status: 'processed', run_at: new Date(), processed_by: adminUserId, skipped },
    });
  });

  return { run: updated, payslips_generated: payslipRows.length, skipped };
}

async function listRunPayslips(orgId, runId) {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, org_id: orgId } });
  if (!run) return { error: 'not_found' };

  const data = await prisma.payslip.findMany({
    where: { payroll_run_id: runId, org_id: orgId },
    orderBy: { generated_at: 'asc' },
    include: { org_membership: { select: { id: true, person: { select: { id: true, name: true } } } } },
  });
  return { data };
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
  listMyPayslips,
  getPayslip,
  // exported for tests only
  computeBreakdown,
  periodBounds,
};
