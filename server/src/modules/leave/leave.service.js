const prisma = require('../../config/db');
const { detectFinanceChange } = require('../../lib/financeChanges');
const { pickCalendarId } = require('../calendars/calendars.service');
const workHours = require('../timesheets/workHours.service');

const DEFAULT_LEAVE_TYPES = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Casual Leave', paid: true, annual_quota: 12, overflow_to_unpaid: true },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Sick Leave', paid: true, annual_quota: 12, overflow_to_unpaid: true },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Earned Leave', paid: true, annual_quota: 18, overflow_to_unpaid: true },
  { id: '00000000-0000-4000-8000-000000000004', name: 'Unpaid Leave', paid: false, annual_quota: 0 },
  // Comp Off is part of the balance: its entitlement is the admin-set figure plus one day for every
  // overtime day approved as comp off (credit), so it can be taken without touching other balances.
  { id: '00000000-0000-4000-8000-000000000005', name: 'Comp Off', paid: true, annual_quota: 0, overflow_to_unpaid: true },
];

const isCompOff = (leaveType) => String(leaveType.name).trim().toLowerCase() === 'comp off';

// Comp-off days earned in a year: one per overtime day the manager / admin approved as comp off.
async function compOffCredits(orgId, membershipIds, year) {
  if (!membershipIds.length) return new Map();
  const range = yearRange(year);
  const rows = await prisma.timesheetDayOvertime.groupBy({
    by: ['org_membership_id'],
    where: { org_id: orgId, org_membership_id: { in: membershipIds }, status: 'comp_off', date: { gte: range.gte, lte: range.lte } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.org_membership_id, r._count._all]));
}

async function ensureDefaultTypes(orgId) {
  const existing = await prisma.leaveType.findMany({ where: { org_id: orgId }, select: { name: true } });
  const existingNames = new Set(existing.map((type) => type.name));
  const missing = DEFAULT_LEAVE_TYPES.filter((type) => !existingNames.has(type.name));
  if (missing.length === 0) return;

  for (const type of missing) {
    await prisma.leaveType.create({ data: { ...type, org_id: orgId } }).catch(() => undefined);
  }
}

async function listTypes(orgId) {
  await ensureDefaultTypes(orgId);
  return prisma.leaveType.findMany({ where: { org_id: orgId }, orderBy: { name: 'asc' } });
}

// ---------------------------------------------------------------------------
// Live balances. Nothing here is a stored counter: what an employee has used is
// always recomputed from their APPROVED leave requests, from 1 January of the
// year up to today. Approved leave dated after today is shown as "upcoming" and
// still comes off the balance; pending requests are shown separately. Cancelling
// or revoking an approved leave therefore gives the days back with no extra step.
// Days are counted the way requestedDays() and payroll count them: WORKING
// days only, on the employee's own company calendar — weekends and calendar
// holidays inside a leave cost nothing (Fri → Mon is 2 days, not 4), a
// weekend the calendar marks as working counts — and a half day is 0.5.
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

const KNOWN_CODES = { 'casual leave': 'CL', 'earned leave': 'EL', 'sick leave': 'SL', 'unpaid leave': 'UL', 'comp off': 'CO' };

// CL / EL / SL / UL for the standard types; initials for any custom type.
function leaveCode(name) {
  const known = KNOWN_CODES[String(name).trim().toLowerCase()];
  if (known) return known;
  const initials = String(name).trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase();
  return initials.slice(0, 3) || 'LV';
}

// Today's date in IST as a UTC-midnight Date (leave dates are @db.Date).
function todayIst(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

const ymd = (d) => d.toISOString().slice(0, 10);

// Calendar days in [from, to], inclusive — the fallback when no working-day
// calendar is supplied (pure unit tests).
function calendarDays(from, to) {
  return to < from ? 0 : Math.round((to - from) / DAY_MS) + 1;
}

// Working days in [from, to] under one calendar's rows: a date the calendar
// marks as a working day counts; otherwise Mon–Fri that isn't a holiday.
function countWorkingDays(from, to, { holidays = new Set(), working = new Set() } = {}) {
  let n = 0;
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const d = new Date(t);
    const key = ymd(d);
    const dow = d.getUTCDay();
    if (working.has(key) || (dow !== 0 && dow !== 6 && !holidays.has(key))) n += 1;
  }
  return n;
}

// One day-counter per employee: their company calendar (the same pick as
// payroll and timesheets — calendars.service.pickCalendarId with no project)
// with its holidays and working-day exceptions over [from, to].
async function leaveDayCounters(orgId, membershipIds, from, to) {
  const ids = [...new Set(membershipIds)];
  if (!ids.length) return new Map();
  const [memberships, assignments, calendars, rows] = await Promise.all([
    prisma.orgMembership.findMany({ where: { id: { in: ids }, org_id: orgId }, select: { id: true, location_id: true, department_id: true } }),
    prisma.employeeCalendar.findMany({ where: { org_membership_id: { in: ids } }, select: { org_membership_id: true, account_id: true, calendar_id: true } }),
    prisma.calendar.findMany({ where: { org_id: orgId }, select: { id: true, location_id: true, department_id: true, is_default: true } }),
    prisma.calendarHoliday.findMany({ where: { calendar: { org_id: orgId }, date: { gte: from, lte: to } }, select: { calendar_id: true, date: true, is_working_day: true } }),
  ]);
  const byCalendar = new Map();
  for (const r of rows) {
    if (!byCalendar.has(r.calendar_id)) byCalendar.set(r.calendar_id, { holidays: new Set(), working: new Set() });
    byCalendar.get(r.calendar_id)[r.is_working_day ? 'working' : 'holidays'].add(ymd(r.date));
  }
  const counters = new Map();
  for (const m of memberships) {
    const calendarId = pickCalendarId({
      assignments: assignments.filter((a) => a.org_membership_id === m.id),
      membershipLocationId: m.location_id,
      membershipDepartmentId: m.department_id,
      calendars,
    });
    const cal = byCalendar.get(calendarId) || {};
    counters.set(m.id, (a, b) => countWorkingDays(a, b, cal));
  }
  return counters;
}

async function leaveDayCounter(orgId, orgMembershipId, from, to) {
  return (await leaveDayCounters(orgId, [orgMembershipId], from, to)).get(orgMembershipId) || ((a, b) => countWorkingDays(a, b));
}

function overlapDays(from, to, lo, hi, countDays = calendarDays) {
  const start = from > lo ? from : lo;
  const end = to < hi ? to : hi;
  return end < start ? 0 : countDays(start, end);
}

// used / upcoming / pending days of one leave type's requests within `year`, as
// of `today`. `countDays(from, to)` is what a range costs (the employee's
// working days; calendar days when omitted). Pure — the unit tests drive it.
function summariseUsage(requests, { year, today, countDays = calendarDays }) {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const asOf = today > yearEnd ? yearEnd : today; // a past year is complete; a future year has nothing taken yet
  let used = 0;
  let upcoming = 0;
  let pending = 0;
  for (const r of requests) {
    if (r.status !== 'approved' && r.status !== 'pending') continue;
    if (r.to_date < yearStart || r.from_date > yearEnd) continue;
    const inYear = overlapDays(r.from_date, r.to_date, yearStart, yearEnd, countDays);
    const days = r.is_half_day ? 0.5 : inYear;
    if (r.status === 'pending') {
      pending += days;
    } else if (r.is_half_day) {
      if (r.from_date <= asOf) used += days;
      else upcoming += days;
    } else {
      const taken = overlapDays(r.from_date, r.to_date, yearStart, asOf, countDays);
      used += taken;
      upcoming += inYear - taken;
    }
  }
  return { used, upcoming, pending };
}

// The employee's entitlement for a type/year: the admin-set figure if there is
// one, else the legacy accrued value, else the type's annual quota. null = no cap.
function entitlementFor(leaveType, balance, credit = 0) {
  let base;
  if (balance && balance.allocated !== null && balance.allocated !== undefined) base = Number(balance.allocated);
  else if (balance && Number(balance.accrued) > 0) base = Number(balance.accrued);
  else base = leaveType.annual_quota === null || leaveType.annual_quota === undefined ? null : Number(leaveType.annual_quota);
  return base === null ? null : base + credit;
}

function balanceRow(leaveType, balance, usage, { year, today, credit = 0 }) {
  const entitlement = entitlementFor(leaveType, balance, credit);
  // Unpaid leave, a type excluded from the balance, and any type with no quota are uncapped - there is no balance to run out of.
  const unlimited = !leaveType.paid || leaveType.counts_in_balance === false || entitlement === null;
  const allocated = unlimited ? 0 : entitlement;
  return {
    leave_type_id: leaveType.id,
    leave_type_name: leaveType.name,
    code: leaveCode(leaveType.name),
    paid: leaveType.paid,
    counts_in_balance: leaveType.counts_in_balance !== false,
    overflow_to_unpaid: Boolean(leaveType.overflow_to_unpaid),
    comp_off_credit: credit || 0,
    year,
    as_of: today.getUTCFullYear() === year ? today.toISOString().slice(0, 10) : null,
    allocated,
    used: usage.used,
    upcoming: usage.upcoming,
    pending: usage.pending,
    remaining: unlimited ? null : Math.max(allocated - usage.used - usage.upcoming, 0),
    unlimited,
    // The admin has set this figure for this employee (as opposed to the type default).
    customised: Boolean(balance && balance.allocated !== null && balance.allocated !== undefined),
  };
}

function yearRange(year) {
  return { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) };
}

async function listMyBalances(orgId, orgMembershipId, year, today = todayIst()) {
  await ensureDefaultTypes(orgId);
  const range = yearRange(year);
  const [leaveTypes, balances, requests, credits] = await Promise.all([
    prisma.leaveType.findMany({ where: { org_id: orgId, is_applicable: true }, orderBy: { name: 'asc' } }),
    prisma.leaveBalance.findMany({ where: { org_membership_id: orgMembershipId, year } }),
    prisma.leaveRequest.findMany({
      where: {
        org_id: orgId,
        org_membership_id: orgMembershipId,
        status: { in: ['approved', 'pending'] },
        from_date: { lte: range.lte },
        to_date: { gte: range.gte },
      },
    }),
    compOffCredits(orgId, [orgMembershipId], year),
  ]);
  const balanceByType = new Map(balances.map((b) => [b.leave_type_id, b]));
  const countDays = await leaveDayCounter(orgId, orgMembershipId, range.gte, range.lte);
  return leaveTypes.map((leaveType) =>
    balanceRow(leaveType, balanceByType.get(leaveType.id), summariseUsage(requests.filter((r) => r.leave_type_id === leaveType.id), { year, today, countDays }), { year, today, credit: isCompOff(leaveType) ? credits.get(orgMembershipId) || 0 : 0 })
  );
}

// Every active employee's counters for the admin dashboard and the leave
// balances screen — one pass over the org's requests, no per-employee queries.
async function balancesOverview(orgId, { year, department_id, search }, today = todayIst()) {
  await ensureDefaultTypes(orgId);
  const range = yearRange(year);
  const [leaveTypes, memberships, balances, requests] = await Promise.all([
    prisma.leaveType.findMany({ where: { org_id: orgId, is_applicable: true }, orderBy: { name: 'asc' } }),
    prisma.orgMembership.findMany({
      where: {
        org_id: orgId,
        left_at: null,
        ...(department_id ? { department_id } : {}),
        ...(search ? { person: { name: { contains: search, mode: 'insensitive' } } } : {}),
      },
      select: { id: true, person: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } },
      orderBy: { person: { name: 'asc' } },
      take: 500,
    }),
    prisma.leaveBalance.findMany({ where: { year, org_membership: { org_id: orgId } } }),
    prisma.leaveRequest.findMany({
      where: { org_id: orgId, status: { in: ['approved', 'pending'] }, from_date: { lte: range.lte }, to_date: { gte: range.gte } },
    }),
  ]);

  const keyOf = (membershipId, typeId) => `${membershipId}|${typeId}`;
  const balanceByKey = new Map(balances.map((b) => [keyOf(b.org_membership_id, b.leave_type_id), b]));
  const requestsByKey = new Map();
  for (const r of requests) {
    const key = keyOf(r.org_membership_id, r.leave_type_id);
    requestsByKey.set(key, [...(requestsByKey.get(key) || []), r]);
  }

  const counters = await leaveDayCounters(orgId, memberships.map((m) => m.id), range.gte, range.lte);
  const credits = await compOffCredits(orgId, memberships.map((m) => m.id), year);
  const employees = memberships.map((m) => ({
    org_membership_id: m.id,
    name: m.person?.name || 'Unknown',
    department: m.department?.name || null,
    balances: leaveTypes.map((leaveType) => {
      const key = keyOf(m.id, leaveType.id);
      return balanceRow(leaveType, balanceByKey.get(key), summariseUsage(requestsByKey.get(key) || [], { year, today, countDays: counters.get(m.id) }), { year, today, credit: isCompOff(leaveType) ? credits.get(m.id) || 0 : 0 });
    }),
  }));

  return {
    year,
    as_of: today.toISOString().slice(0, 10),
    types: leaveTypes.map((t) => ({ id: t.id, name: t.name, code: leaveCode(t.name), paid: t.paid, annual_quota: t.annual_quota, counts_in_balance: t.counts_in_balance, overflow_to_unpaid: t.overflow_to_unpaid })),
    employees,
  };
}

// Admin sets (or clears, with null) one employee's entitlement for a type/year.
async function setEntitlement(orgId, { org_membership_id, leave_type_id, year, allocated }, today = todayIst()) {
  const [membership, leaveType] = await Promise.all([
    prisma.orgMembership.findFirst({ where: { id: org_membership_id, org_id: orgId }, select: { id: true } }),
    prisma.leaveType.findFirst({ where: { id: leave_type_id, org_id: orgId } }),
  ]);
  if (!membership) return { error: 'membership_not_found' };
  if (!leaveType) return { error: 'leave_type_not_found' };

  await prisma.leaveBalance.upsert({
    where: { org_membership_id_leave_type_id_year: { org_membership_id, leave_type_id, year } },
    create: { org_membership_id, leave_type_id, year, allocated },
    update: { allocated },
  });
  const rows = await listMyBalances(orgId, org_membership_id, year, today);
  return { balance: rows.find((r) => r.leave_type_id === leave_type_id) };
}

async function createType(orgId, { name, paid, annual_quota, is_applicable, counts_in_balance, overflow_to_unpaid }) {
  const existing = await prisma.leaveType.findUnique({ where: { org_id_name: { org_id: orgId, name } } });
  if (existing) return { error: 'name_taken' };
  const leaveType = await prisma.leaveType.create({
    data: {
      org_id: orgId, name, paid, annual_quota,
      ...(is_applicable === undefined ? {} : { is_applicable }),
      ...(counts_in_balance === undefined ? {} : { counts_in_balance }),
      ...(overflow_to_unpaid === undefined ? {} : { overflow_to_unpaid }),
    },
  });
  return { leaveType };
}

// Admin / HR: change how a leave type behaves (applicable, counts in balance, spills into unpaid, paid, quota).
async function updateType(orgId, adminUser, typeId, patch) {
  const existing = await prisma.leaveType.findFirst({ where: { id: typeId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (patch.name && patch.name !== existing.name && (await prisma.leaveType.findUnique({ where: { org_id_name: { org_id: orgId, name: patch.name } } }))) return { error: 'name_taken' };
  const { reason: note, ...data } = patch;
  const leaveType = await prisma.leaveType.update({ where: { id: typeId }, data });
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: adminUser.id, action: 'leave_type_edit', entity_type: 'leave_type', entity_id: typeId, reason: note || 'leave type configuration', snapshot: { before: existing, after: leaveType } },
  });
  return { leaveType };
}

// Balance days a request consumes. Same rule the balances use (the
// employee's working days, inclusive; a half-day is 0.5) — kept in one place
// so the check at request time can't disagree with the debit.
function requestedDays({ from_date, to_date, is_half_day }, countDays = calendarDays) {
  return is_half_day ? 0.5 : countDays(from_date, to_date);
}

// Two half-days on the same date in different sessions (AM + PM) are the one
// legitimate way for requests to share a date.
function isCompatibleHalfDayPair(a, b) {
  return a.is_half_day && b.is_half_day && a.from_date.getTime() === b.from_date.getTime() && a.half_day_session !== b.half_day_session;
}

async function findOverlap(orgId, orgMembershipId, candidate) {
  const overlapping = await prisma.leaveRequest.findMany({
    where: {
      org_id: orgId,
      org_membership_id: orgMembershipId,
      status: { in: ['pending', 'approved'] },
      from_date: { lte: candidate.to_date },
      to_date: { gte: candidate.from_date },
    },
  });
  return overlapping.find((existing) => !isCompatibleHalfDayPair(existing, candidate)) || null;
}

// Paid leave can't be booked past what's left: the entitlement minus days
// already taken or booked (approved) minus days already requested (pending) —
// all live, see summariseUsage. Unpaid types and types with no quota are uncapped.
async function remainingPaidDays(orgId, orgMembershipId, leaveType, year, excludeRequestId = null) {
  if (leaveType.counts_in_balance === false) return Infinity;
  const range = yearRange(year);
  const [balance, requests] = await Promise.all([
    prisma.leaveBalance.findUnique({
      where: { org_membership_id_leave_type_id_year: { org_membership_id: orgMembershipId, leave_type_id: leaveType.id, year } },
    }),
    prisma.leaveRequest.findMany({
      where: {
        org_id: orgId,
        org_membership_id: orgMembershipId,
        leave_type_id: leaveType.id,
        status: { in: ['approved', 'pending'] },
        from_date: { lte: range.lte },
        to_date: { gte: range.gte },
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
    }),
  ]);
  const credit = isCompOff(leaveType) ? (await compOffCredits(orgId, [orgMembershipId], year)).get(orgMembershipId) || 0 : 0;
  const entitlement = entitlementFor(leaveType, balance, credit);
  if (entitlement === null) return Infinity;
  const countDays = await leaveDayCounter(orgId, orgMembershipId, range.gte, range.lte);
  const { used, upcoming, pending } = summariseUsage(requests, { year, today: todayIst(), countDays });
  return entitlement - used - upcoming - pending;
}

// Timesheet / leave conflicts, checked when leave is applied for AND again when
// it is approved (a timesheet may have been logged in between). Only working
// days of the employee's company calendar count - the same days leave costs.
//   full day  -> any logged (submitted / approved) hours on the date conflict;
//   half day  -> the date's logged hours must fit what the leave leaves free
//                (the standard day minus half, minus any other approved half).
// Nothing is ever overwritten; the caller gets the date and hours to show.
async function findTimesheetConflict(orgId, orgMembershipId, { from_date, to_date, is_half_day }, { excludeRequestId } = {}) {
  const entries = await prisma.timesheetEntry.findMany({
    where: { org_id: orgId, org_membership_id: orgMembershipId, date: { gte: from_date, lte: to_date }, status: { in: ['submitted', 'approved'] } },
    select: { date: true, hours: true, overtime_hours: true },
  });
  if (!entries.length) return null;
  const [shift, cal] = await Promise.all([
    workHours.membershipShift(orgMembershipId),
    workHours.companyCalendarDays(orgId, orgMembershipId, from_date, to_date),
  ]);
  const byDate = new Map();
  for (const e of entries) {
    const key = ymd(e.date);
    byDate.set(key, (byDate.get(key) || 0) + Number(e.hours) + Number(e.overtime_hours || 0));
  }
  let otherHalves = [];
  if (is_half_day) {
    otherHalves = await prisma.leaveRequest.findMany({
      where: {
        org_id: orgId,
        org_membership_id: orgMembershipId,
        status: 'approved',
        is_half_day: true,
        from_date: { lte: to_date },
        to_date: { gte: from_date },
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
      select: { from_date: true },
    });
  }
  for (const key of [...byDate.keys()].sort()) {
    const logged = Math.round(byDate.get(key) * 100) / 100;
    if (logged <= 0) continue;
    const date = new Date(`${key}T00:00:00.000Z`);
    if (workHours.dayInfo(date, cal, shift).day_type !== 'working') continue;
    if (!is_half_day) return { error: 'timesheet_conflict', date: key, hours: logged };
    const halvesToday = otherHalves.filter((r) => ymd(r.from_date) === key).length;
    const max = Math.max(0, Math.round((shift - (shift / 2) * (1 + halvesToday)) * 100) / 100);
    if (logged > max) return { error: 'half_day_hours_exceeded', date: key, hours: logged, max };
  }
  return null;
}

function conflictMessage(result) {
  if (result.error === 'timesheet_conflict') {
    return `A timesheet with ${result.hours}h already exists on ${result.date}, so a full-day leave can't cover it. Delete or reduce that timesheet first (or use a half-day leave).`;
  }
  return `${result.hours}h are already logged on ${result.date}, but a half-day leave leaves only ${result.max}h for work that day. Reduce the timesheet to ${result.max}h or less first.`;
}

// Hours a day still has free for work after approved HALF-day leave (a second
// half-day, AM + PM, leaves none). null = no half-day leave applies that date.
async function workCapacityFor(orgId, orgMembershipId, date) {
  const halves = await prisma.leaveRequest.findMany({
    where: { org_id: orgId, org_membership_id: orgMembershipId, status: 'approved', is_half_day: true, from_date: { lte: date }, to_date: { gte: date } },
    include: { leave_type: { select: { name: true } } },
  });
  if (!halves.length) return null;
  const [shift, cal] = await Promise.all([workHours.membershipShift(orgMembershipId), workHours.companyCalendarDays(orgId, orgMembershipId, date, date)]);
  if (workHours.dayInfo(date, cal, shift).day_type !== 'working') return null;
  const leaveHours = Math.min(shift, (shift / 2) * halves.length);
  return { capacity: Math.round((shift - leaveHours) * 100) / 100, leave_hours: leaveHours, leave_type: halves[0].leave_type.name };
}

async function createRequest(
  orgId,
  orgMembershipId,
  { leave_type_id, from_date, to_date, is_half_day, half_day_session, reason }
) {
  const leaveType = await prisma.leaveType.findFirst({ where: { id: leave_type_id, org_id: orgId } });
  if (!leaveType) return { error: 'leave_type_not_found' };
  if (leaveType.is_applicable === false) return { error: 'type_not_applicable' };

  const overlap = await findOverlap(orgId, orgMembershipId, { from_date, to_date, is_half_day, half_day_session });
  if (overlap) return { error: 'overlaps_existing' };

  const conflict = await findTimesheetConflict(orgId, orgMembershipId, { from_date, to_date, is_half_day });
  if (conflict) return conflict;

  // Someone who was present on a date can't take a full day's leave for it
  // (a half day is still allowed — they worked the other half).
  if (!is_half_day) {
    const present = await prisma.attendanceRecord.findFirst({
      where: {
        org_id: orgId,
        org_membership_id: orgMembershipId,
        date: { gte: from_date, lte: to_date },
        status: { in: ['present', 'wfh', 'half_day'] },
      },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    if (present) return { error: 'present_on_date', date: ymd(present.date) };
  }

  const countDays = await leaveDayCounter(orgId, orgMembershipId, from_date, to_date);
  const needed = requestedDays({ from_date, to_date, is_half_day }, countDays);
  // A range that is all weekend / holidays costs nothing and isn't a leave.
  if (needed === 0) return { error: 'no_working_days' };

  if (leaveType.paid) {
    const remaining = await remainingPaidDays(orgId, orgMembershipId, leaveType, from_date.getUTCFullYear());
    if (needed > remaining) {
      if (!leaveType.overflow_to_unpaid) return { error: 'insufficient_balance', remaining, needed };
      return createWithOverflow(orgId, orgMembershipId, leaveType, { from_date, to_date, is_half_day, half_day_session, reason }, { remaining: Math.max(remaining, 0), needed, countDays });
    }
  }

  const request = await prisma.leaveRequest.create({
    data: {
      org_id: orgId,
      org_membership_id: orgMembershipId,
      leave_type_id,
      from_date,
      to_date,
      is_half_day,
      half_day_session: is_half_day ? half_day_session : null,
      reason,
    },
    include: { leave_type: true },
  });
  return { request: { ...request, days: needed } };
}

// The balance runs out part-way: the days the balance still covers stay on the requested (paid) type and the rest
// become Unpaid Leave, so salary pays only what the balance covers. Two requests (paid part, unpaid part) are
// created; with nothing left the whole request is Unpaid Leave.
async function createWithOverflow(orgId, orgMembershipId, leaveType, { from_date, to_date, is_half_day, half_day_session, reason }, { remaining, needed, countDays }) {
  await ensureDefaultTypes(orgId);
  const unpaidType = (await prisma.leaveType.findFirst({ where: { org_id: orgId, paid: false, name: 'Unpaid Leave' } })) || (await prisma.leaveType.findFirst({ where: { org_id: orgId, paid: false } }));
  if (!unpaidType) return { error: 'insufficient_balance', remaining, needed };
  const note = (text) => [reason, text].filter(Boolean).join(' - ');
  const make = (type, from, to, extra = {}) => prisma.leaveRequest.create({
    data: { org_id: orgId, org_membership_id: orgMembershipId, leave_type_id: type.id, from_date: from, to_date: to, is_half_day: Boolean(is_half_day), half_day_session: is_half_day ? half_day_session : null, reason: extra.reason ?? reason },
    include: { leave_type: true },
  });
  // Last date still fully covered by the balance (working days counted up to it).
  let lastPaid = null;
  for (let d = new Date(from_date); d <= to_date; d = new Date(d.getTime() + DAY_MS)) {
    if (countDays(from_date, d) <= remaining + 1e-9) lastPaid = new Date(d);
    else break;
  }
  const paidDays = lastPaid ? countDays(from_date, lastPaid) : 0;
  if (!lastPaid || paidDays <= 0 || is_half_day) {
    const whole = await make(unpaidType, from_date, to_date, { reason: note(`${leaveType.name} balance used up`) });
    return { request: { ...whole, days: needed }, overflow: { to_unpaid_days: needed, paid_days: 0 } };
  }
  const nextDay = new Date(lastPaid.getTime() + DAY_MS);
  const paid = await make(leaveType, from_date, lastPaid);
  const unpaid = nextDay <= to_date ? await make(unpaidType, nextDay, to_date, { reason: note(`${leaveType.name} balance used up`) }) : null;
  return {
    request: { ...paid, days: paidDays },
    overflow: unpaid ? { request: { ...unpaid, days: Math.round((needed - paidDays) * 10) / 10 }, to_unpaid_days: Math.round((needed - paidDays) * 10) / 10, paid_days: paidDays } : null,
  };
}

// A pending paid request whose balance ends part-way is split when it is approved: the original keeps the days
// the balance covers, and a new (pending, then approved with it) Unpaid Leave request takes the rest.
async function splitAtApproval(orgId, existing, leaveType, { remaining, needed, countDays }) {
  await ensureDefaultTypes(orgId);
  const unpaidType = (await prisma.leaveType.findFirst({ where: { org_id: orgId, paid: false, name: 'Unpaid Leave' } })) || (await prisma.leaveType.findFirst({ where: { org_id: orgId, paid: false } }));
  if (!unpaidType) return { error: 'insufficient_balance', remaining, needed };
  let lastPaid = null;
  if (!existing.is_half_day) {
    for (let d = new Date(existing.from_date); d <= existing.to_date; d = new Date(d.getTime() + DAY_MS)) {
      if (countDays(existing.from_date, d) <= remaining + 1e-9) lastPaid = new Date(d);
      else break;
    }
  }
  const paidDays = lastPaid ? countDays(existing.from_date, lastPaid) : 0;
  const note = [existing.reason, `${leaveType.name} balance used up`].filter(Boolean).join(' - ');
  if (!lastPaid || paidDays <= 0) {
    return { update: { leave_type_id: unpaidType.id, reason: note }, unpaid: null, unpaidDays: needed };
  }
  const nextDay = new Date(lastPaid.getTime() + DAY_MS);
  const unpaid = nextDay <= existing.to_date
    ? await prisma.leaveRequest.create({
      data: { org_id: orgId, org_membership_id: existing.org_membership_id, leave_type_id: unpaidType.id, from_date: nextDay, to_date: existing.to_date, is_half_day: false, reason: note },
    })
    : null;
  return { update: { to_date: lastPaid }, unpaid, unpaidDays: Math.round((needed - paidDays) * 10) / 10 };
}

// Leave Managers: people (besides admins) who process leave requests for the company. An admin keeps final control.
async function isLeaveManager(orgId, orgMembershipId) {
  if (!orgMembershipId) return false;
  const m = await prisma.orgMembership.findFirst({ where: { id: orgMembershipId, org_id: orgId }, select: { is_leave_manager: true } });
  return Boolean(m?.is_leave_manager);
}

async function listLeaveManagers(orgId) {
  const rows = await prisma.orgMembership.findMany({ where: { org_id: orgId, is_leave_manager: true }, select: { id: true, person: { select: { name: true } } }, orderBy: { person: { name: 'asc' } } });
  return rows.map((r) => ({ org_membership_id: r.id, name: r.person?.name || null }));
}

async function setLeaveManager(orgId, adminUser, orgMembershipId, value) {
  const m = await prisma.orgMembership.findFirst({ where: { id: orgMembershipId, org_id: orgId }, select: { id: true, is_leave_manager: true } });
  if (!m) return { error: 'membership_not_found' };
  await prisma.orgMembership.update({ where: { id: orgMembershipId }, data: { is_leave_manager: value } });
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: adminUser.id, action: 'leave_manager_set', entity_type: 'org_membership', entity_id: orgMembershipId, reason: value ? 'made Leave Manager' : 'removed as Leave Manager', snapshot: { before: m.is_leave_manager, after: value } } });
  return { is_leave_manager: value };
}

// Admin applies leave for an employee, or for themselves (org_membership_id
// omitted). Same rules and the same Pending -> approver flow as a self request;
// an admin IS the approver in this system, so `auto_approve` may approve it in
// the same step - through decide(), so the approval-time checks still run.
async function createRequestForEmployee(orgId, actor, { org_membership_id, auto_approve = false, ...body }) {
  const targetId = org_membership_id || actor.org_membership_id;
  const target = await prisma.orgMembership.findFirst({ where: { id: targetId, org_id: orgId }, select: { id: true, left_at: true } });
  if (!target) return { error: 'membership_not_found' };
  if (target.left_at) return { error: 'membership_left' };

  const result = await createRequest(orgId, targetId, body);
  if (result.error || !auto_approve) return result;

  const decided = await decide(orgId, result.request.id, actor.org_membership_id, { status: 'approved', reason: 'Applied and approved by admin' }, actor.user_id);
  if (decided.error) {
    // Nothing half-applied: the pending request is withdrawn and the reason returned.
    await prisma.leaveRequest.update({ where: { id: result.request.id }, data: { status: 'cancelled', decision_reason: 'Auto-approval failed' } });
    return decided;
  }
  // The unpaid overflow part of a split request is approved with it.
  let overflow = result.overflow || null;
  if (overflow?.request) {
    const overflowDecided = await decide(orgId, overflow.request.id, actor.org_membership_id, { status: 'approved', reason: 'Applied and approved by admin' }, actor.user_id);
    if (overflowDecided.error) await prisma.leaveRequest.update({ where: { id: overflow.request.id }, data: { status: 'cancelled', decision_reason: 'Auto-approval failed' } });
    else overflow = { ...overflow, request: { ...overflow.request, ...overflowDecided.request } };
  }
  return { request: { ...result.request, ...decided.request }, overflow };
}

async function listMine(orgId, orgMembershipId, { status, page, limit }) {
  const where = { org_id: orgId, org_membership_id: orgMembershipId, ...(status ? { status } : {}) };
  const [data, total] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { leave_type: true },
    }),
    prisma.leaveRequest.count({ where }),
  ]);
  return { data: await withDays(orgId, data), pagination: { page, limit, total } };
}

// Each request's cost in the employee's working days (`days`), for the lists.
async function withDays(orgId, requests) {
  if (!requests.length) return requests;
  const from = new Date(Math.min(...requests.map((r) => r.from_date.getTime())));
  const to = new Date(Math.max(...requests.map((r) => r.to_date.getTime())));
  const counters = await leaveDayCounters(orgId, requests.map((r) => r.org_membership_id), from, to);
  return requests.map((r) => ({ ...r, days: requestedDays(r, counters.get(r.org_membership_id) || calendarDays) }));
}

async function listTeam(orgId, { status, org_membership_id, from, to, page, limit }) {
  const where = {
    org_id: orgId,
    ...(status ? { status } : {}),
    ...(org_membership_id ? { org_membership_id } : {}),
    ...(from || to ? { from_date: { gte: from || undefined }, to_date: { lte: to || undefined } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        leave_type: true,
        org_membership: { select: { id: true, person: { select: { id: true, name: true } } } },
      },
    }),
    prisma.leaveRequest.count({ where }),
  ]);
  return { data: await withDays(orgId, data), pagination: { page, limit, total } };
}

async function decide(orgId, requestId, approverMembershipId, { status, reason }, actorUserId = null) {
  const existing = await prisma.leaveRequest.findFirst({ where: { id: requestId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'pending') return { error: 'not_pending' };
  let split = null;

  // Approval is what makes leave real, so it re-checks what apply checked: a
  // timesheet logged since then, and (paid leave) the balance still covering it.
  if (status === 'approved') {
    const conflict = await findTimesheetConflict(orgId, existing.org_membership_id, existing, { excludeRequestId: existing.id });
    if (conflict) return conflict;
    const leaveType = await prisma.leaveType.findFirst({ where: { id: existing.leave_type_id, org_id: orgId } });
    if (leaveType?.paid) {
      const countDays = await leaveDayCounter(orgId, existing.org_membership_id, existing.from_date, existing.to_date);
      const needed = requestedDays(existing, countDays);
      const remaining = await remainingPaidDays(orgId, existing.org_membership_id, leaveType, existing.from_date.getUTCFullYear(), existing.id);
      if (needed > remaining) {
        if (!leaveType.overflow_to_unpaid) return { error: 'insufficient_balance', remaining, needed };
        // The balance runs out before the leave does: what it still covers stays paid, the rest becomes Unpaid Leave.
        split = await splitAtApproval(orgId, existing, leaveType, { remaining: Math.max(remaining, 0), needed, countDays });
        if (split.error) return split;
      }
    }
  }

  const request = await prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status, approver_id: approverMembershipId, decided_at: new Date(), decision_reason: reason, ...(split?.update || {}) },
  });
  if (split?.unpaid) {
    await prisma.leaveRequest.update({ where: { id: split.unpaid.id }, data: { status, approver_id: approverMembershipId, decided_at: new Date(), decision_reason: reason } });
  }

  // No balance write: what an employee has used is computed live from their
  // approved requests (see summariseUsage), so approving is only the status change.
  if (status === 'approved') {
    await detectFinanceChange(orgId, {
      source_type: 'leave',
      source_id: requestId,
      from_date: existing.from_date,
      to_date: existing.to_date,
      org_membership_id: existing.org_membership_id,
      changed_by: actorUserId,
      description: 'Leave approved',
      old_value: { status: existing.status },
      new_value: { status },
    });
  }
  return { request, ...(split?.unpaid ? { overflow: { request: split.unpaid, to_unpaid_days: split.unpaidDays } } : {}) };
}

// Admin authority over a leave that was already granted (or is still pending):
// withdraw it. The days go back to the balance by themselves — it is computed
// from the approved requests — and the leave-day rule stops applying.
async function revoke(orgId, requestId, adminMembershipId, { reason }, actorUserId = null) {
  const existing = await prisma.leaveRequest.findFirst({ where: { id: requestId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'approved' && existing.status !== 'pending') return { error: 'not_revocable' };
  const request = await prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status: 'cancelled', approver_id: adminMembershipId, decided_at: new Date(), decision_reason: reason || 'Withdrawn by admin' },
  });
  if (existing.status === 'approved') {
    await detectFinanceChange(orgId, {
      source_type: 'leave',
      source_id: requestId,
      from_date: existing.from_date,
      to_date: existing.to_date,
      org_membership_id: existing.org_membership_id,
      changed_by: actorUserId,
      description: `Approved leave withdrawn${reason ? `: ${reason}` : ''}`.slice(0, 500),
      old_value: { status: 'approved' },
      new_value: { status: 'cancelled' },
    });
  }
  return { request };
}

async function cancel(orgId, orgMembershipId, requestId) {
  const existing = await prisma.leaveRequest.findFirst({ where: { id: requestId, org_id: orgId, org_membership_id: orgMembershipId } });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'pending') return { error: 'not_pending' };

  const request = await prisma.leaveRequest.update({ where: { id: requestId }, data: { status: 'cancelled' } });
  return { request };
}

// The "Leave Day" rule (Approved Leave Day = no attendance, no timesheet, no
// project hours): an APPROVED full-day leave covering `date`. Pending or
// rejected leave never blocks; a half-day leave doesn't either, since the
// employee still works the other half — only whole-day approved leave does.
async function leaveDayFor(orgId, orgMembershipId, date) {
  const leave = await prisma.leaveRequest.findFirst({
    where: {
      org_id: orgId,
      org_membership_id: orgMembershipId,
      status: 'approved',
      is_half_day: false,
      from_date: { lte: date },
      to_date: { gte: date },
    },
    include: { leave_type: { select: { name: true } } },
  });
  if (leave) return { leave_type: leave.leave_type.name, from_date: leave.from_date, to_date: leave.to_date };
  // Two approved half days on one date (AM + PM) leave no time to work either.
  const halves = await prisma.leaveRequest.findMany({
    where: { org_id: orgId, org_membership_id: orgMembershipId, status: 'approved', is_half_day: true, from_date: { lte: date }, to_date: { gte: date } },
    include: { leave_type: { select: { name: true } } },
  });
  return halves.length >= 2 ? { leave_type: halves[0].leave_type.name, from_date: halves[0].from_date, to_date: halves[0].to_date } : null;
}

const LEAVE_DAY_MESSAGE = (leave) =>
  `You're on approved ${leave.leave_type} leave on that date — attendance, timesheet and project hours are disabled for leave days`;

module.exports = {
  isLeaveManager,
  listLeaveManagers,
  setLeaveManager,
  updateType,
  compOffCredits,
  listTypes,
  listMyBalances,
  balancesOverview,
  setEntitlement,
  createType,
  createRequest,
  createRequestForEmployee,
  findTimesheetConflict,
  conflictMessage,
  workCapacityFor,
  listMine,
  listTeam,
  decide,
  revoke,
  cancel,
  leaveDayFor,
  LEAVE_DAY_MESSAGE,
  // exported for tests only
  summariseUsage,
  countWorkingDays,
  leaveCode,
  todayIst,
};
