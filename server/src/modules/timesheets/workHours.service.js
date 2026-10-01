// Work hours — the ONE place that turns timesheet entries into payroll hours.
//
//   Attendance (check-in / check-out) = presence only. Never read here.
//   Timesheet entries                 = the hours worked (hours + overtime_hours).
//   Manager approval                  = which of those hours count.
//   Overtime approval                 = whether hours beyond the day's
//                                       expected hours are paid (TimesheetDayOvertime).
//
// A day's expected hours come from the employee's ONE company calendar
// (office location → calendars.service.resolveCalendar with no project) and
// their daily shift: shift hours on a company working day, 0 on a weekend or
// company holiday (a weekend the company calendar marks as a working day
// counts as working). Project/client calendars never change the expected
// hours — they only add client_working / client_holiday flags, and hours
// worked on a company day off become overtime (approve as OT, or as comp off).
//
// Per day:  normal = min(logged, expected); overtime = logged − normal.
// Actual payroll uses APPROVED hours only; pending hours are the projection.

const prisma = require('../../config/db');
const calendarsService = require('../calendars/calendars.service');
const { todayIst } = require('../../lib/istDate');
const { leaveHoursForDay } = require('../leave/leaveHours');

const DEFAULT_SHIFT_HOURS = 9;
// Days after the week's lock (the following Sunday) a still-pending entry
// waits for its manager before it's flagged for Admin Review.
const ADMIN_REVIEW_GRACE_DAYS = Number(process.env.TIMESHEET_ADMIN_REVIEW_GRACE_DAYS || 3);

const DAY_MS = 86400000;
const ymd = (date) => date.toISOString().slice(0, 10);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const utcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Hours of an assigned Shift (overnight shifts wrap); the default without one.
function shiftHours(shift) {
  if (!shift) return DEFAULT_SHIFT_HOURS;
  let minutes = shift.end_minutes - shift.start_minutes;
  if (minutes <= 0) minutes += 24 * 60;
  return round2(minutes / 60);
}

// Sunday → Saturday week containing `date`.
function weekBounds(date) {
  const day = utcDay(date);
  const start = new Date(day.getTime() - day.getUTCDay() * DAY_MS);
  return { start, end: new Date(start.getTime() + 6 * DAY_MS) };
}

// Pending entries of a week that has been locked for ADMIN_REVIEW_GRACE_DAYS
// with no manager decision go to Admin Review.
function needsAdminReview(date, today = todayIst()) {
  const { end } = weekBounds(date);
  const reviewFrom = new Date(end.getTime() + (1 + ADMIN_REVIEW_GRACE_DAYS) * DAY_MS);
  return today >= reviewFrom;
}

// The company calendar's rows over [from, to]: holidays and working-day exceptions.
async function companyCalendarDays(orgId, orgMembershipId, from, to) {
  const calendar = await calendarsService.resolveCalendar(orgId, orgMembershipId, null);
  const rows = calendar
    ? await prisma.calendarHoliday.findMany({ where: { calendar_id: calendar.id, date: { gte: from, lte: to } }, select: { date: true, label: true, is_working_day: true } })
    : [];
  return {
    calendar: calendar ? { id: calendar.id, name: calendar.name } : null,
    holidays: new Map(rows.filter((r) => !r.is_working_day).map((r) => [ymd(r.date), r.label])),
    working: new Map(rows.filter((r) => r.is_working_day).map((r) => [ymd(r.date), r.label])),
  };
}

// Pure: a date's type under the company calendar and its expected hours.
function dayInfo(date, { holidays, working }, shift) {
  const key = ymd(date);
  if (working.has(key)) return { day_type: 'working', label: working.get(key), expected: shift };
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return { day_type: 'weekend', label: dow === 0 ? 'Sunday' : 'Saturday', expected: 0 };
  if (holidays.has(key)) return { day_type: 'company_holiday', label: holidays.get(key), expected: 0 };
  return { day_type: 'working', label: null, expected: shift };
}

// Pure: split one day's hours. `approved` / `pending` are logged hours
// (hours + overtime_hours) by entry status; `ot` is the day's overtime row.
function splitDay({ expected, approved, pending, ot }) {
  const normal_approved = Math.min(approved, expected);
  const ot_approved_candidate = Math.max(0, approved - expected);
  const normal_projected = Math.min(approved + pending, expected);
  const ot_projected_candidate = Math.max(0, approved + pending - expected);
  const otHours = ot ? Number(ot.hours) : 0;
  const status = ot?.status || (ot_projected_candidate > 0 ? 'pending' : null);
  return {
    normal_approved: round2(normal_approved),
    normal_projected: round2(normal_projected),
    ot_hours: round2(ot_projected_candidate),
    ot_status: status,
    // Paid OT: only an approved decision, never more than the approved excess.
    ot_payable: status === 'approved' ? round2(Math.min(otHours, ot_approved_candidate)) : 0,
    ot_projected: status === 'approved' || status === 'pending' ? round2(ot_projected_candidate) : 0,
    comp_off: status === 'comp_off',
  };
}

async function membershipShift(orgMembershipId) {
  const m = await prisma.orgMembership.findUnique({ where: { id: orgMembershipId }, select: { shift: { select: { start_minutes: true, end_minutes: true } } } });
  return shiftHours(m?.shift);
}

/**
 * Keeps the day's TimesheetDayOvertime row in step with its entries: hours =
 * logged (non-rejected) hours beyond expected. A changed amount goes back to
 * pending; no overtime left removes the row.
 */
async function syncDayOvertime(orgId, orgMembershipId, date) {
  // Attendance-paid people log CLIENT hours on projects (8h + 8h is normal), so those hours never
  // create overtime; their OT is ticket based.
  const basis = await prisma.orgMembership.findUnique({ where: { id: orgMembershipId }, select: { pay_basis: true } });
  if (basis?.pay_basis === 'attendance') return null;
  const day = utcDay(date);
  const [shift, cal, entries, existing] = await Promise.all([
    membershipShift(orgMembershipId),
    companyCalendarDays(orgId, orgMembershipId, day, day),
    prisma.timesheetEntry.findMany({ where: { org_membership_id: orgMembershipId, date: day, status: { not: 'rejected' } }, select: { hours: true, overtime_hours: true } }),
    prisma.timesheetDayOvertime.findUnique({ where: { org_membership_id_date: { org_membership_id: orgMembershipId, date: day } } }),
  ]);
  const { expected } = dayInfo(day, cal, shift);
  const logged = entries.reduce((s, e) => s + Number(e.hours) + Number(e.overtime_hours || 0), 0);
  const hours = round1(Math.max(0, logged - expected));
  if (hours <= 0) {
    if (existing) await prisma.timesheetDayOvertime.delete({ where: { id: existing.id } });
    return null;
  }
  if (!existing) {
    return prisma.timesheetDayOvertime.create({ data: { org_id: orgId, org_membership_id: orgMembershipId, date: day, hours } });
  }
  if (Number(existing.hours) === hours) return existing;
  return prisma.timesheetDayOvertime.update({
    where: { id: existing.id },
    data: { hours, status: 'pending', decided_by: null, decided_at: null, decision_reason: null },
  });
}

/**
 * Day overtime from logged hours for many employees at once — the same rule
 * as splitDay / syncDayOvertime: per employee, per date, logged
 * (non-rejected) hours + overtime_hours beyond the day's expected hours on
 * their company calendar (shift hours on a working day, 0 on a weekend or
 * company holiday). Hours past a 9h shift are overtime even when nobody typed
 * them into the OT field. Returns Map(membershipId → Map(ymd → { logged, expected, ot })).
 */
async function loggedOvertime(orgId, membershipIds, from, to) {
  const ids = [...new Set(membershipIds)];
  const out = new Map();
  if (!ids.length) return out;
  const start = utcDay(from);
  const end = utcDay(to);
  const [memberships, assignments, calendars, rows, entries] = await Promise.all([
    prisma.orgMembership.findMany({ where: { id: { in: ids }, org_id: orgId }, select: { id: true, location_id: true, department_id: true, shift: { select: { start_minutes: true, end_minutes: true } } } }),
    prisma.employeeCalendar.findMany({ where: { org_membership_id: { in: ids } }, select: { org_membership_id: true, account_id: true, calendar_id: true } }),
    prisma.calendar.findMany({ where: { org_id: orgId }, select: { id: true, location_id: true, department_id: true, is_default: true } }),
    prisma.calendarHoliday.findMany({ where: { calendar: { org_id: orgId }, date: { gte: start, lte: end } }, select: { calendar_id: true, date: true, label: true, is_working_day: true } }),
    prisma.timesheetEntry.findMany({ where: { org_id: orgId, org_membership_id: { in: ids }, date: { gte: start, lte: end }, status: { not: 'rejected' } }, select: { org_membership_id: true, date: true, hours: true, overtime_hours: true } }),
  ]);
  const calById = new Map();
  for (const r of rows) {
    if (!calById.has(r.calendar_id)) calById.set(r.calendar_id, { holidays: new Map(), working: new Map() });
    calById.get(r.calendar_id)[r.is_working_day ? 'working' : 'holidays'].set(ymd(r.date), r.label);
  }
  const empty = { holidays: new Map(), working: new Map() };
  const memberById = new Map(memberships.map((m) => [m.id, m]));
  const calFor = new Map();
  for (const m of memberships) {
    const calendarId = calendarsService.pickCalendarId({
      assignments: assignments.filter((a) => a.org_membership_id === m.id),
      membershipLocationId: m.location_id,
      membershipDepartmentId: m.department_id,
      calendars,
    });
    calFor.set(m.id, calById.get(calendarId) || empty);
  }
  for (const e of entries) {
    const member = memberById.get(e.org_membership_id);
    if (!member) continue;
    if (!out.has(member.id)) out.set(member.id, new Map());
    const days = out.get(member.id);
    const key = ymd(e.date);
    if (!days.has(key)) days.set(key, { logged: 0, expected: dayInfo(utcDay(e.date), calFor.get(member.id), shiftHours(member.shift)).expected, ot: 0 });
    const day = days.get(key);
    day.logged = round2(day.logged + Number(e.hours) + Number(e.overtime_hours || 0));
    day.ot = round2(Math.max(0, day.logged - day.expected));
  }
  return out;
}

// Client/project calendar flags for the projects worked on a day.
async function clientFlagsFor(orgId, accountIds, from, to) {
  if (!accountIds.length) return new Map();
  const mappings = await prisma.projectCalendar.findMany({ where: { org_id: orgId, account_id: { in: accountIds } }, select: { account_id: true, calendar_id: true } });
  if (!mappings.length) return new Map();
  const rows = await prisma.calendarHoliday.findMany({
    where: { calendar_id: { in: [...new Set(mappings.map((m) => m.calendar_id))] }, date: { gte: from, lte: to } },
    select: { calendar_id: true, date: true, label: true, is_working_day: true },
  });
  const byCalendar = new Map();
  for (const r of rows) {
    if (!byCalendar.has(r.calendar_id)) byCalendar.set(r.calendar_id, []);
    byCalendar.get(r.calendar_id).push(r);
  }
  const out = new Map(); // account_id → Map(date → { type, label })
  for (const m of mappings) {
    const days = new Map();
    for (const r of byCalendar.get(m.calendar_id) || []) days.set(ymd(r.date), { type: r.is_working_day ? 'client_working' : 'client_holiday', label: r.label });
    out.set(m.account_id, days);
  }
  return out;
}

const projectName = (a) => (a ? a.project_name || a.name : null);

/**
 * Day-by-day hours for one employee over [from, to] — what the weekly
 * timesheet view and the monthly totals show, computed here only.
 */
async function daySummaries(orgId, orgMembershipId, from, to) {
  const start = utcDay(from);
  const end = utcDay(to);
  const [shift, cal, entries, overtime, locks, leaves] = await Promise.all([
    membershipShift(orgMembershipId),
    companyCalendarDays(orgId, orgMembershipId, start, end),
    prisma.timesheetEntry.findMany({
      where: { org_membership_id: orgMembershipId, date: { gte: start, lte: end } },
      orderBy: [{ date: 'asc' }, { created_at: 'asc' }],
      include: { account: { select: { id: true, name: true, project_name: true } } },
    }),
    prisma.timesheetDayOvertime.findMany({ where: { org_membership_id: orgMembershipId, date: { gte: start, lte: end } } }),
    prisma.timesheetLock.findMany({ where: { org_id: orgId, date: { gte: start, lte: end } }, select: { date: true } }),
    prisma.leaveRequest.findMany({
      // Approved leave drives hours; pending is only shown (no effect on hours or pay).
      where: { org_membership_id: orgMembershipId, status: { in: ['approved', 'pending'] }, from_date: { lte: end }, to_date: { gte: start } },
      select: { id: true, status: true, from_date: true, to_date: true, is_half_day: true, half_day_session: true, leave_type: { select: { name: true, paid: true } } },
    }),
  ]);
  const accountIds = [...new Set(entries.map((e) => e.account_id).filter(Boolean))];
  const clientFlags = await clientFlagsFor(orgId, accountIds, start, end);
  const otByDate = new Map(overtime.map((o) => [ymd(o.date), o]));
  const locked = new Set(locks.map((l) => ymd(l.date)));
  const today = todayIst();

  const days = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const date = new Date(t);
    const key = ymd(date);
    const info = dayInfo(date, cal, shift);
    // Leave only means something on a working day; only APPROVED leave carries
    // hours (full day = shift, half = half), pending is shown but never counted.
    const onDay = info.day_type === 'working' ? leaves.filter((l) => date >= l.from_date && date <= l.to_date) : [];
    const approvedLeaves = onDay.filter((l) => l.status === 'approved');
    const pendingLeaves = onDay.filter((l) => l.status === 'pending');
    const leaveHrs = leaveHoursForDay(approvedLeaves.map((l) => ({ is_half_day: l.is_half_day, paid: l.leave_type.paid })), info.expected);
    const leaveRow = (l) => ({
      request_id: l.id,
      name: l.leave_type.name,
      paid: l.leave_type.paid,
      is_half_day: l.is_half_day,
      half_day_session: l.half_day_session,
      status: l.status,
      hours: l.status === 'approved' ? round2(l.is_half_day ? info.expected / 2 : info.expected) : 0,
    });
    const leave = approvedLeaves[0] ? leaveRow(approvedLeaves[0]) : null;
    const dayEntries = entries.filter((e) => ymd(e.date) === key);
    const sumBy = (status) => round2(dayEntries.filter((e) => e.status === status).reduce((s, e) => s + Number(e.hours) + Number(e.overtime_hours || 0), 0));
    const approved = sumBy('approved');
    const pending = sumBy('submitted');
    const rejected = sumBy('rejected');
    const ot = otByDate.get(key) || null;
    const split = splitDay({ expected: info.expected, approved, pending, ot });
    const flags = [];
    for (const e of dayEntries) {
      const flag = clientFlags.get(e.account_id)?.get(key);
      if (flag && !flags.some((f) => f.type === flag.type && f.project === projectName(e.account))) flags.push({ ...flag, project: projectName(e.account) });
    }
    // Worked on a company day off for a client that works that day.
    const clientWorkingOnDayOff = info.day_type !== 'working' && (approved + pending) > 0;
    const logged = round2(approved + pending);
    const statuses = new Set(dayEntries.map((e) => e.status));
    let status = 'empty';
    if (statuses.has('submitted')) status = 'pending';
    else if (statuses.has('approved')) status = 'approved';
    else if (statuses.has('rejected')) status = 'rejected';
    days.push({
      date: key,
      weekday: date.getUTCDay(),
      day_type: info.day_type,
      day_label: info.label,
      leave,
      leaves: approvedLeaves.map(leaveRow),
      pending_leaves: pendingLeaves.map(leaveRow),
      leave_hours: leaveHrs.total,
      paid_leave_hours: leaveHrs.paid,
      unpaid_leave_hours: leaveHrs.unpaid,
      client_flags: flags,
      comp_off_eligible: clientWorkingOnDayOff,
      // What is left to work once approved leave is taken out of the day.
      expected: round2(Math.max(0, info.expected - leaveHrs.total)),
      logged,
      approved,
      pending,
      rejected,
      normal_approved: split.normal_approved,
      deficit: date > today ? 0 : round2(Math.max(0, info.expected - leaveHrs.total - logged)),
      // Paid hours of the day: approved worked hours up to what leave leaves free + approved PAID leave (no double counting).
      paid_hours: round2(leaveHrs.paid + Math.min(approved, info.expected - leaveHrs.total)),
      ot_hours: split.ot_hours,
      ot_status: split.ot_status,
      ot_id: ot?.id || null,
      ot_payable: split.ot_payable,
      status,
      locked: locked.has(key),
      admin_review: status === 'pending' && locked.has(key) && needsAdminReview(date, today),
      entries: dayEntries.map((e) => ({
        id: e.id, account_id: e.account_id, project: projectName(e.account), hours: Number(e.hours), overtime_hours: Number(e.overtime_hours || 0),
        billable: e.billable, notes: e.notes, module_name: e.module_name, status: e.status, decision_reason: e.decision_reason,
      })),
    });
  }
  const total = (key) => round2(days.reduce((s, d) => s + (d[key] || 0), 0));
  return {
    calendar: cal.calendar,
    shift_hours: shift,
    days,
    totals: {
      expected: total('expected'),
      logged: total('logged'),
      approved: total('approved'),
      pending: total('pending'),
      rejected: total('rejected'),
      normal_approved: total('normal_approved'),
      leave_hours: total('leave_hours'),
      paid_leave_hours: total('paid_leave_hours'),
      unpaid_leave_hours: total('unpaid_leave_hours'),
      paid_hours: total('paid_hours'),
      deficit: total('deficit'),
      ot_hours: total('ot_hours'),
      ot_payable: total('ot_payable'),
      comp_off_days: days.filter((d) => d.ot_status === 'comp_off').length,
    },
  };
}

// Sunday → Saturday week around `date`, with its lock state.
async function weekView(orgId, orgMembershipId, date) {
  const { start, end } = weekBounds(date);
  const summary = await daySummaries(orgId, orgMembershipId, start, end);
  return { week_start: ymd(start), week_end: ymd(end), locked: summary.days.every((d) => d.locked), ...summary };
}

module.exports = {
  DEFAULT_SHIFT_HOURS,
  ADMIN_REVIEW_GRACE_DAYS,
  shiftHours,
  weekBounds,
  needsAdminReview,
  companyCalendarDays,
  membershipShift,
  dayInfo,
  splitDay,
  syncDayOvertime,
  loggedOvertime,
  daySummaries,
  weekView,
};
