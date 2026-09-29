// Attendance-based salary — the ONE salary calculation. Payroll runs, Live
// Analytics → Salary and Resource Revenue all read it, so a month's salary
// can't come out differently in two places.
//
// Per employee, for one calendar month:
//   working_days = Mon–Fri of the month less the holidays of the employee's
//                  own calendar (calendars.service.pickCalendarId — their own
//                  mapping → department → office location → org default)
//   per_day      = monthly ctc (SalaryStructure in force at month end) / working_days
//   loss of pay  = absent / unpaid leave / no record on a working day (half day = 0.5)
//   net          = ctc − per_day × loss-of-pay days
// See payroll.service.computeBreakdown for the day-by-day rules. Contractors
// are never on payroll (paid through their vendor — see vendorPayment.engine).

const prisma = require('../../../config/db');
const { computeBreakdown } = require('../../payroll/payroll.service');
const { pickCalendarId } = require('../../calendars/calendars.service');
const { round2, ymd, monthBounds } = require('../period');
const { teamOn } = require('../../../lib/allocations');

// Employee / Department / Team filters, combinable. Department matches the
// org membership's department or (legacy) the person's own. With a `period`
// ({ start, end }) the team filter is historical — anyone ON that team at any
// point in the period (TeamMembershipPeriod) — so a past month's team view
// never follows people who moved teams later; without one it's the current team.
function membershipFilterWhere({ org_membership_id, department_id, team_id } = {}, period = null) {
  const and = [];
  if (org_membership_id) and.push({ id: org_membership_id });
  if (team_id && period) {
    and.push({
      OR: [
        {
          team_periods: {
            some: {
              team_id,
              AND: [{ OR: [{ start_date: null }, { start_date: { lte: period.end } }] }, { OR: [{ end_date: null }, { end_date: { gte: period.start } }] }],
            },
          },
        },
        // No team history recorded for this person yet: their current team.
        { team_id, team_periods: { none: {} } },
      ],
    });
  } else if (team_id) and.push({ team_id });
  if (department_id) and.push({ OR: [{ department_id }, { person: { department_id } }] });
  return and.length ? { AND: and } : {};
}

function isItDepartment(membership) {
  const name = membership.department?.name || membership.person?.department?.name || '';
  return name.toLowerCase() === 'it';
}

const MEMBER_SELECT = {
  id: true,
  employee_code: true,
  worker_type: true,
  location_id: true,
  department_id: true,
  team_id: true,
  joined_at: true,
  left_at: true,
  department: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  // The team as it was during the month (a later move doesn't relabel it).
  team_periods: { select: { team_id: true, start_date: true, end_date: true, team: { select: { name: true } } } },
  person: { select: { id: true, name: true, department: { select: { id: true, name: true } } } },
};

// Everything the month's salary needs, loaded in a handful of queries.
async function loadContext(orgId, { period_month, period_year }, filters = {}) {
  const { start, end } = monthBounds(period_month, period_year);
  const memberships = await prisma.orgMembership.findMany({
    where: {
      org_id: orgId,
      joined_at: { lte: end },
      OR: [{ left_at: null }, { left_at: { gte: start } }],
      ...membershipFilterWhere(filters, { start, end }),
    },
    select: MEMBER_SELECT,
    orderBy: { joined_at: 'asc' },
  });
  const ids = memberships.map((m) => m.id);
  const [structures, attendance, leaves, holidays, calendars, employeeCalendars] = await Promise.all([
    prisma.salaryStructure.findMany({
      where: { org_id: orgId, org_membership_id: { in: ids }, effective_from: { lte: end } },
      orderBy: [{ effective_from: 'desc' }, { created_at: 'desc' }],
      select: { id: true, org_membership_id: true, ctc: true, effective_from: true },
    }),
    prisma.attendanceRecord.findMany({
      where: { org_id: orgId, org_membership_id: { in: ids }, date: { gte: start, lte: end } },
      select: { org_membership_id: true, date: true, status: true, overtime_minutes: true, check_in_at: true, check_out_at: true },
    }),
    prisma.leaveRequest.findMany({
      where: { org_id: orgId, org_membership_id: { in: ids }, status: 'approved', from_date: { lte: end }, to_date: { gte: start } },
      select: { org_membership_id: true, from_date: true, to_date: true, leave_type: { select: { paid: true } } },
    }),
    prisma.calendarHoliday.findMany({ where: { calendar: { org_id: orgId }, date: { gte: start, lte: end } }, select: { calendar_id: true, date: true } }),
    prisma.calendar.findMany({ where: { org_id: orgId }, select: { id: true, name: true, location_id: true, department_id: true, is_default: true } }),
    prisma.employeeCalendar.findMany({ where: { org_membership_id: { in: ids } }, select: { org_membership_id: true, account_id: true, calendar_id: true } }),
  ]);

  const group = (rows, key) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row[key])) map.set(row[key], []);
      map.get(row[key]).push(row);
    }
    return map;
  };
  const holidaysByCalendar = new Map();
  for (const h of holidays) {
    if (!holidaysByCalendar.has(h.calendar_id)) holidaysByCalendar.set(h.calendar_id, new Set());
    holidaysByCalendar.get(h.calendar_id).add(ymd(h.date));
  }
  const latestStructure = new Map();
  for (const s of structures) if (!latestStructure.has(s.org_membership_id)) latestStructure.set(s.org_membership_id, s);

  return {
    period: { period_month, period_year, start, end },
    memberships,
    latestStructure,
    attendanceByMember: group(attendance, 'org_membership_id'),
    leavesByMember: group(leaves, 'org_membership_id'),
    calendarsById: new Map(calendars.map((c) => [c.id, c])),
    calendars,
    assignmentsByMember: group(employeeCalendars, 'org_membership_id'),
    holidaysByCalendar,
  };
}

// Team on `date` from the membership's team periods; members with no period
// history yet fall back to their current team.
function teamDuring(membership, date) {
  if (!membership.team_periods?.length) return { team_id: membership.team_id || null, team: membership.team?.name || null };
  const teamId = teamOn(membership.team_periods, date);
  const period = membership.team_periods.find((p) => p.team_id === teamId);
  return { team_id: teamId, team: period?.team?.name || null };
}

// One employee's line. `asOf` = live mode (see computeBreakdown).
function salaryLine(ctx, membership, asOf = null) {
  const base = {
    org_membership_id: membership.id,
    name: membership.person.name,
    employee_code: membership.employee_code,
    worker_type: membership.worker_type,
    department_id: membership.department_id || membership.person?.department?.id || null,
    department: membership.department?.name || membership.person?.department?.name || null,
    ...teamDuring(membership, asOf || ctx.period.end),
    is_it: isItDepartment(membership),
  };
  if (membership.worker_type === 'contractor') return { ...base, skipped: 'contractor_paid_by_vendor' };
  const structure = ctx.latestStructure.get(membership.id);
  if (!structure) return { ...base, skipped: 'no_salary_structure' };

  const calendarId = pickCalendarId({
    assignments: ctx.assignmentsByMember.get(membership.id) || [],
    membershipLocationId: membership.location_id,
    membershipDepartmentId: membership.department_id,
    calendars: ctx.calendars,
  }, null);
  const attendanceByDate = new Map((ctx.attendanceByMember.get(membership.id) || []).map((a) => [ymd(a.date), a]));
  const leaveRanges = (ctx.leavesByMember.get(membership.id) || []).map((l) => ({ from_date: l.from_date, to_date: l.to_date, paid: l.leave_type.paid }));
  const { start, end } = ctx.period;
  const { breakdown, gross, deductions, net } = computeBreakdown({
    period_start: start,
    period_end: end,
    days_in_month: end.getUTCDate(),
    ctc: structure.ctc,
    attendanceByDate,
    leaveRanges,
    holidaySet: ctx.holidaysByCalendar.get(calendarId) || new Set(),
    asOf,
  });
  return {
    ...base,
    salary_structure_id: structure.id,
    calendar: calendarId ? ctx.calendarsById.get(calendarId)?.name || null : null,
    ctc: Number(structure.ctc),
    gross,
    deductions,
    net,
    earned_to_date: breakdown.earned_to_date,
    per_day: breakdown.per_day_pay,
    breakdown,
  };
}

// The month's attendance-based salary for every (filtered) employee.
async function computeSalary(orgId, { period_month, period_year, asOf = null, filters = {} }) {
  const ctx = await loadContext(orgId, { period_month, period_year }, filters);
  const lines = [];
  const skipped = [];
  for (const m of ctx.memberships) {
    const line = salaryLine(ctx, m, asOf);
    if (line.skipped) skipped.push({ org_membership_id: m.id, name: line.name, reason: line.skipped });
    else lines.push(line);
  }
  lines.sort((a, b) => a.name.localeCompare(b.name));
  const sum = (list, key) => round2(list.reduce((s, l) => s + Number(l[key] || 0), 0));
  const it = lines.filter((l) => l.is_it);
  const nonIt = lines.filter((l) => !l.is_it);
  return {
    period_month,
    period_year,
    as_of: asOf ? ymd(asOf) : null,
    currency: 'INR',
    lines,
    skipped,
    totals: {
      employees: lines.length,
      ctc: sum(lines, 'ctc'),
      deductions: sum(lines, 'deductions'),
      net: sum(lines, 'net'),
      earned_to_date: sum(lines, 'earned_to_date'),
      it_net: sum(it, 'net'),
      non_it_net: sum(nonIt, 'net'),
      it_earned_to_date: sum(it, 'earned_to_date'),
      non_it_earned_to_date: sum(nonIt, 'earned_to_date'),
    },
  };
}

module.exports = { loadContext, salaryLine, computeSalary, membershipFilterWhere, isItDepartment };
