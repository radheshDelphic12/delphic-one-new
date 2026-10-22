// Attendance Dashboard: attendance only (no project hours), per person per month, with the reporting office,
// work type and where the person worked that day (office / home), plus the month's leave balance.
//
// Office: the latest employee_office_assignments row on or before the day, else the membership's current location.
// Work type: remote or onsite (a "hybrid" membership counts as onsite). Place: a work_place_days row for the day,
// else the default for the work type (onsite -> office, remote -> home, an attendance row marked wfh -> home).

const prisma = require('../../config/db');
const dashboard = require('../timesheets/dashboard.service');
const leave = require('../leave/leave.service');
const { todayIst } = require('../../lib/istDate');

const ymd = (date) => date.toISOString().slice(0, 10);
const monthBounds = (year, month) => ({ from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 0)) });
const dateOnly = (s) => new Date(`${s}T00:00:00.000Z`);

// How far ahead office / home can be applied for.
const MAX_MONTHS_AHEAD = 3;
const lastApplyDay = () => { const t = todayIst(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + MAX_MONTHS_AHEAD, t.getUTCDate())); };

const workTypeOf = (membership) => (membership.work_mode === 'remote' ? 'remote' : 'onsite');

// Where someone stands today: 'exited' (status terminated, or the last working day has passed), 'notice_period' (serving
// notice, last working day not yet passed) or 'active' (everyone else who still works here).
function employmentState(m, today) {
  if (m.employment_status === 'terminated') return 'exited';
  if (m.left_at && m.left_at < today) return 'exited';
  if (m.employment_status === 'notice_period') return m.notice_end_date && m.notice_end_date < today ? 'exited' : 'notice_period';
  return 'active';
}

// status: 'current' (default: everyone still working, incl. serving notice), 'active', 'notice_period', 'exited', 'all'.
const matchesStatus = (state, status) => (status === 'all' ? true : status === 'current' ? state !== 'exited' : state === status);

// Employees (IT and non-IT) the caller may open. Contractors and vendor resources have no attendance.
async function people(orgId, user, { year, month, status = 'current' }) {
  const { from, to } = monthBounds(year, month);
  const today = todayIst();
  const visible = await dashboard.visibleMembers(orgId, user, { includeExited: true });
  const ids = visible.filter((m) => m.worker_type !== 'contractor' && !m.vendor_account_id).map((m) => m.id);
  const [allMembers, records] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { id: { in: ids } },
      select: { id: true, work_mode: true, employment_status: true, left_at: true, notice_end_date: true, location: { select: { id: true, name: true } }, person: { select: { name: true, department: { select: { name: true } } } } },
      orderBy: { person: { name: 'asc' } },
    }),
    prisma.attendanceRecord.groupBy({ by: ['org_membership_id', 'status'], where: { org_id: orgId, org_membership_id: { in: ids }, date: { gte: from, lte: to } }, _count: { _all: true } }),
  ]);
  const counts = new Map();
  for (const r of records) {
    const c = counts.get(r.org_membership_id) || {};
    c[r.status] = r._count._all;
    counts.set(r.org_membership_id, c);
  }
  const members = allMembers.filter((m) => matchesStatus(employmentState(m, today), status));
  return {
    year,
    month,
    status,
    people: members.map((m) => ({
      org_membership_id: m.id,
      name: m.person?.name || 'Unknown',
      status: employmentState(m, today),
      last_working_day: m.left_at || m.notice_end_date ? ymd(m.left_at || m.notice_end_date) : null,
      department: m.person?.department?.name || null,
      reporting_office: m.location?.name || null,
      work_type: workTypeOf(m),
      counts: counts.get(m.id) || {},
    })),
  };
}

// Month-start and month-end leave balance (remaining days per type) and what was taken / applied in the month.
async function leaveSummary(orgId, orgMembershipId, year, month) {
  const { from, to } = monthBounds(year, month);
  const dayBefore = new Date(from.getTime() - 86400000);
  // The balance is a calendar-year figure: month start and end are read from the same year as the month.
  // one after the other: the first call creates the org's default leave types
  const opening = await leave.listMyBalances(orgId, orgMembershipId, year, dayBefore.getUTCFullYear() === year ? dayBefore : from);
  const closing = await leave.listMyBalances(orgId, orgMembershipId, year, to);
  const openingByType = new Map(opening.map((r) => [r.leave_type_id, r]));
  const remainingAt = (row) => (row.unlimited ? null : Math.max(row.allocated - row.used, 0));
  return closing.map((row) => {
    const open = openingByType.get(row.leave_type_id) || row;
    const isFirstDay = dayBefore.getUTCFullYear() !== year;
    return {
      leave_type_id: row.leave_type_id,
      leave_type_name: row.leave_type_name,
      unlimited: row.unlimited,
      allocated: row.allocated,
      opening: isFirstDay ? (row.unlimited ? null : row.allocated) : remainingAt(open),
      closing: remainingAt(row),
      taken: Math.max(row.used - (isFirstDay ? 0 : open.used), 0),
      pending: row.pending,
    };
  });
}

// Reporting office of one person on every day of the month.
function officeResolver(assignments, fallback) {
  const sorted = [...assignments].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  return (day) => {
    let hit = null;
    for (const a of sorted) {
      if (ymd(a.effective_from) <= day) hit = a;
      else break;
    }
    return hit ? { id: hit.location.id, name: hit.location.name } : fallback;
  };
}

async function calendar(orgId, orgMembershipId, { year, month }) {
  const { from, to } = monthBounds(year, month);
  const member = await prisma.orgMembership.findFirst({
    where: { id: orgMembershipId, org_id: orgId },
    select: { id: true, work_mode: true, worker_type: true, vendor_account_id: true, location: { select: { id: true, name: true } }, person: { select: { name: true, department: { select: { name: true } } } } },
  });
  if (!member) return { error: 'member_not_found' };
  if (member.worker_type === 'contractor' || member.vendor_account_id) return { error: 'no_attendance' };

  const [timesheetCal, assignments, places, balances] = await Promise.all([
    // reuses the existing day builder for attendance status, holidays, leave and pending leave; hours are dropped below
    dashboard.monthCalendar(orgId, orgMembershipId, { year, month }),
    prisma.employeeOfficeAssignment.findMany({ where: { org_id: orgId, org_membership_id: orgMembershipId, effective_from: { lte: to } }, select: { effective_from: true, location: { select: { id: true, name: true } } } }),
    prisma.workPlaceDay.findMany({ where: { org_id: orgId, org_membership_id: orgMembershipId, date: { gte: from, lte: to } } }),
    leaveSummary(orgId, orgMembershipId, year, month),
  ]);
  const officeOn = officeResolver(assignments, member.location ? { id: member.location.id, name: member.location.name } : null);
  const placeByDay = new Map(places.map((p) => [ymd(p.date), p]));
  const workType = workTypeOf(member);

  const days = timesheetCal.days.map((d) => {
    const row = placeByDay.get(d.date) || null;
    const defaultPlace = workType === 'remote' || d.attendance_status === 'wfh' ? 'home' : 'office';
    // only an approved request changes the place; a pending or rejected one keeps the default and is shown beside it
    const place = row && row.status === 'approved' ? row.work_place : defaultPlace;
    return {
      date: d.date,
      weekday: d.weekday,
      day_type: d.day_type,
      day_label: d.day_label || null,
      attendance_status: d.attendance_status,
      attendance_label: d.attendance_label,
      attendance_conflict: d.attendance_conflict,
      attendance_note: d.attendance_note,
      leaves: d.leaves,
      pending_leaves: d.pending_leaves,
      reporting_office: officeOn(d.date),
      work_type: workType,
      work_place: place,
      // a stored row is a request; the default needs no decision and counts as approved
      place_status: row ? row.status : 'approved',
      place_is_default: !row || row.status !== 'approved',
      requested_place: row && row.status !== 'approved' ? row.work_place : null,
      place_reason: row?.reason || null,
      place_decision_reason: row?.decision_reason || null,
    };
  });

  return {
    year,
    month,
    member: { org_membership_id: member.id, name: member.person?.name || 'Unknown', department: member.person?.department?.name || null, work_type: workType, reporting_office: member.location?.name || null },
    days,
    leave_balances: balances,
  };
}

// Admin: this person reports to `location_id` from `effective_from` onward (earlier days keep the earlier office).
async function setOffice(orgId, actorUserId, { org_membership_id, location_id, effective_from }) {
  const [member, location] = await Promise.all([
    prisma.orgMembership.findFirst({ where: { id: org_membership_id, org_id: orgId }, select: { id: true } }),
    prisma.location.findFirst({ where: { id: location_id, org_id: orgId }, select: { id: true } }),
  ]);
  if (!member) return { error: 'member_not_found' };
  if (!location) return { error: 'location_not_found' };
  const when = dateOnly(effective_from);
  const row = await prisma.employeeOfficeAssignment.upsert({
    where: { org_membership_id_effective_from: { org_membership_id, effective_from: when } },
    create: { org_id: orgId, org_membership_id, location_id, effective_from: when, created_by: actorUserId },
    update: { location_id, created_by: actorUserId },
  });
  // The membership's "current" office follows the latest assignment that has started.
  const latest = await prisma.employeeOfficeAssignment.findFirst({ where: { org_membership_id, effective_from: { lte: new Date() } }, orderBy: { effective_from: 'desc' } });
  if (latest) await prisma.orgMembership.update({ where: { id: org_membership_id }, data: { location_id: latest.location_id } });
  return { row };
}

async function officeHistory(orgId, orgMembershipId) {
  return prisma.employeeOfficeAssignment.findMany({
    where: { org_id: orgId, org_membership_id: orgMembershipId },
    orderBy: { effective_from: 'desc' },
    select: { id: true, effective_from: true, location: { select: { id: true, name: true } } },
  });
}

// Apply for office / home on a day. The person themselves, or an admin on their behalf (an admin's own
// choice is approved straight away; someone else's needs their manager or an admin).
async function requestPlace(orgId, user, { org_membership_id, date, to_date, work_place, reason }) {
  const target = org_membership_id || user.org_membership_id;
  const member = await prisma.orgMembership.findFirst({ where: { id: target, org_id: orgId }, select: { id: true, work_mode: true, manager_id: true, worker_type: true, vendor_account_id: true } });
  if (!member) return { error: 'member_not_found' };
  if (member.worker_type === 'contractor' || member.vendor_account_id) return { error: 'no_attendance' };
  const isAdmin = user.role === 'admin';
  if (target !== user.org_membership_id && !isAdmin) return { error: 'forbidden' };
  const defaultPlace = workTypeOf(member) === 'remote' ? 'home' : 'office';
  const when = dateOnly(date);
  const last = to_date ? dateOnly(to_date) : when;
  if (last < when) return { error: 'end_before_start' };
  if (last > lastApplyDay()) return { error: 'too_far' };
  // One day, or every working day in the range (weekends and holidays are skipped).
  let days = [when];
  if (to_date && to_date !== date) {
    days = [];
    for (let y = when.getUTCFullYear(), m = when.getUTCMonth() + 1; y < last.getUTCFullYear() || (y === last.getUTCFullYear() && m <= last.getUTCMonth() + 1); m === 12 ? (y += 1, m = 1) : (m += 1)) {
      const cal = await dashboard.monthCalendar(orgId, target, { year: y, month: m });
      for (const d of cal.days) if (d.day_type === 'working' && dateOnly(d.date) >= when && dateOnly(d.date) <= last) days.push(dateOnly(d.date));
    }
    if (!days.length) return { error: 'no_working_days' };
  }
  if (work_place === defaultPlace) {
    // back to the default: nothing to decide, drop any earlier request
    await prisma.workPlaceDay.deleteMany({ where: { org_membership_id: target, date: { in: days } } });
    return { row: null, count: days.length, reverted_to_default: true };
  }
  if (workTypeOf(member) === 'remote') return { error: 'remote_is_home' };
  const approved = isAdmin;
  const data = {
    work_place,
    reason: reason || null,
    status: approved ? 'approved' : 'pending',
    requested_by: user.id,
    decided_by: approved ? user.id : null,
    decided_at: approved ? new Date() : null,
    decision_reason: null,
  };
  const rows = [];
  for (const day of days) {
    rows.push(await prisma.workPlaceDay.upsert({
      where: { org_membership_id_date: { org_membership_id: target, date: day } },
      create: { org_id: orgId, org_membership_id: target, date: day, ...data },
      update: data,
    }));
  }
  return { row: rows[0], count: rows.length };
}

async function pendingPlaces(orgId, user) {
  const where = { org_id: orgId, status: 'pending' };
  if (user.role !== 'admin') where.org_membership = { manager_id: user.org_membership_id };
  const rows = await prisma.workPlaceDay.findMany({
    where,
    orderBy: { date: 'asc' },
    select: { id: true, date: true, work_place: true, reason: true, org_membership: { select: { id: true, person: { select: { name: true } } } } },
  });
  return rows.map((r) => ({ id: r.id, date: ymd(r.date), work_place: r.work_place, reason: r.reason, org_membership_id: r.org_membership.id, name: r.org_membership.person?.name || 'Unknown' }));
}

async function decidePlace(orgId, user, id, { approve, reason }) {
  const row = await prisma.workPlaceDay.findFirst({ where: { id, org_id: orgId }, select: { id: true, status: true, org_membership: { select: { manager_id: true } } } });
  if (!row) return { error: 'not_found' };
  if (user.role !== 'admin' && row.org_membership.manager_id !== user.org_membership_id) return { error: 'forbidden' };
  if (row.status !== 'pending') return { error: 'already_decided' };
  const updated = await prisma.workPlaceDay.update({
    where: { id },
    data: { status: approve ? 'approved' : 'rejected', decided_by: user.id, decided_at: new Date(), decision_reason: reason || null },
  });
  return { row: updated };
}

// ---- Monthly register: every employee x every day, in one response -------------------------------------------------------

// Short leave code from the leave type's name: Casual -> CL, Sick -> SL, Earned / Paid -> EL, Comp off -> CO, else initials.
function leaveCode(name) {
  const n = String(name || '').toLowerCase();
  if (/comp/.test(n)) return 'CO';
  if (/casual/.test(n)) return 'CL';
  if (/sick|medical/.test(n)) return 'SL';
  if (/earned|privilege|paid|annual/.test(n)) return 'EL';
  if (/maternity/.test(n)) return 'ML';
  if (/paternity/.test(n)) return 'PL';
  if (/unpaid|loss of pay|lop/.test(n)) return 'LWP';
  const initials = String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('').slice(0, 3);
  return initials || 'L';
}

// One day's register code. Future days stay blank except what is already known (holiday, weekly off, approved leave).
// P = present (in the office), WFH = worked from home, HD = half day, A = absent (a working day with nothing recorded, past days only).
function registerCode(d, { today, inEmployment, workType, homeByDay }) {
  if (!inEmployment) return { code: '', kind: 'none' };
  const future = d.date > today;
  const leaves = d.leaves || [];
  const fullLeave = leaves.find((l) => !l.is_half_day);
  if (d.day_type === 'company_holiday') return { code: 'H', kind: 'holiday', label: d.day_label };
  if (d.day_type === 'weekend') return { code: 'WO', kind: 'weekly_off', label: d.day_label };
  if (fullLeave) return { code: leaveCode(fullLeave.name), kind: 'leave', label: fullLeave.name, days: 1 };
  const half = leaves.find((l) => l.is_half_day);
  const status = d.attendance_status;
  if (half) {
    const worked = status === 'present' || status === 'wfh' || status === 'half_day';
    return { code: `${leaveCode(half.name)}½`, kind: 'leave', label: `${half.name} (half day)`, days: 0.5, worked: worked ? 0.5 : 0 };
  }
  if (status === 'present') return { code: homeByDay.has(d.date) || workType === 'remote' ? 'WFH' : 'P', kind: 'present', days: 1 };
  if (status === 'wfh') return { code: 'WFH', kind: 'present', days: 1 };
  if (status === 'half_day') return { code: 'HD', kind: 'half_day', days: 0.5 };
  if (status === 'leave') return { code: 'L', kind: 'leave', label: d.attendance_label || 'Leave', days: 1 };
  if (status === 'holiday') return { code: 'H', kind: 'holiday' };
  if (status === 'absent') return { code: 'A', kind: 'absent' };
  if (future || d.date === today) return { code: '', kind: 'none' };
  return { code: 'A', kind: 'absent', label: 'Nothing recorded' };
}

const REGISTER_CONCURRENCY = 6;

// Monthly register of everyone the caller may see (same visibility and status filter as the employee list; no contractors).
// `days` per person carries both the attendance code and the project hours of the day, so one load serves both register views.
async function register(orgId, user, { year, month, status = 'current' }) {
  const { from, to } = monthBounds(year, month);
  const todayDate = todayIst();
  const today = ymd(todayDate);
  const visible = await dashboard.visibleMembers(orgId, user, { includeExited: true });
  const ids = visible.filter((m) => m.worker_type !== 'contractor' && !m.vendor_account_id).map((m) => m.id);
  const [members, homeRows] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { id: { in: ids } },
      select: { id: true, work_mode: true, joined_at: true, employment_status: true, left_at: true, notice_end_date: true, employee_code: true, person: { select: { name: true, department: { select: { name: true } } } } },
      orderBy: { person: { name: 'asc' } },
    }),
    prisma.workPlaceDay.findMany({ where: { org_id: orgId, org_membership_id: { in: ids }, date: { gte: from, lte: to }, status: 'approved', work_place: 'home' }, select: { org_membership_id: true, date: true } }),
  ]);
  const homeBy = new Map();
  for (const r of homeRows) {
    if (!homeBy.has(r.org_membership_id)) homeBy.set(r.org_membership_id, new Set());
    homeBy.get(r.org_membership_id).add(ymd(r.date));
  }
  const shown = members.filter((m) => matchesStatus(employmentState(m, todayDate), status));

  const build = async (m) => {
    const cal = await dashboard.monthCalendar(orgId, m.id, { year, month });
    const start = m.joined_at ? ymd(m.joined_at) : null;
    const lastDay = m.left_at || (['terminated', 'notice_period'].includes(m.employment_status) ? m.notice_end_date : null);
    const end = lastDay ? ymd(lastDay) : null;
    const workType = workTypeOf(m);
    const homeByDay = homeBy.get(m.id) || new Set();
    const totals = { present: 0, wfh: 0, half_day: 0, leave: 0, holidays: 0, weekly_offs: 0, absent: 0, hours: 0 };
    const days = cal.days.map((d) => {
      const inEmployment = (!start || d.date >= start) && (!end || d.date <= end);
      const c = registerCode(d, { today, inEmployment, workType, homeByDay });
      const hours = Math.round((d.project_hours || []).reduce((s, p) => s + p.hours, 0) * 100) / 100;
      if (c.kind === 'present') { totals.present += 1; if (c.code === 'WFH') totals.wfh += 1; }
      else if (c.kind === 'half_day') { totals.present += 0.5; totals.half_day += 1; }
      else if (c.kind === 'leave') { totals.leave += c.days; totals.present += c.worked || 0; }
      else if (c.kind === 'holiday') totals.holidays += 1;
      else if (c.kind === 'weekly_off') totals.weekly_offs += 1;
      else if (c.kind === 'absent') totals.absent += 1;
      totals.hours += hours;
      return { date: d.date, weekday: d.weekday, code: c.code, kind: c.kind, label: c.label || null, hours, projects: d.project_hours || [] };
    });
    totals.hours = Math.round(totals.hours * 100) / 100;
    return {
      org_membership_id: m.id,
      name: m.person?.name || 'Unknown',
      employee_code: m.employee_code || null,
      department: m.person?.department?.name || null,
      status: employmentState(m, todayDate),
      days,
      totals,
    };
  };
  const people = [];
  for (let i = 0; i < shown.length; i += REGISTER_CONCURRENCY) people.push(...(await Promise.all(shown.slice(i, i + REGISTER_CONCURRENCY).map(build))));
  const dayList = [...Array(to.getUTCDate())].map((_, i) => { const dt = new Date(Date.UTC(year, month - 1, i + 1)); return { date: ymd(dt), weekday: dt.getUTCDay() }; });
  return { year, month, status, today, days: dayList, people };
}

module.exports = { people, calendar, register, setOffice, officeHistory, requestPlace, pendingPlaces, decidePlace };
