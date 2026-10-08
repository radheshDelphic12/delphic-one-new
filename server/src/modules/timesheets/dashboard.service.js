// Timesheet Dashboard: pick a month, see every timesheet you may view, open one as a calendar.
//
// Each day carries what the day-detail panel needs: project-wise logged hours and entries, leave,
// attendance status, overtime (timesheet OT row + OT tickets), approval state, lock state and the
// notes. Attendance is shown for information only - it is never mixed into project effort.

const prisma = require('../../config/db');
const workHours = require('./workHours.service');

const ymd = (date) => date.toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const monthBounds = (year, month) => ({ from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 0)) });

// People whose timesheet the caller may open: an admin everyone, a manager their direct reports, anyone themselves.
async function visibleMembers(orgId, user) {
  const own = user.org_membership_id;
  const where = { org_id: orgId, employment_status: { not: 'terminated' } };
  if (user.role !== 'admin') where.OR = [{ id: own }, { manager_id: own }];
  return prisma.orgMembership.findMany({
    where,
    select: { id: true, manager_id: true, worker_type: true, vendor_account_id: true, person: { select: { name: true, department: { select: { name: true } } } } },
    orderBy: { person: { name: 'asc' } },
  });
}

// Contractors and vendor resources have no employee attendance or leave - only project timesheet.
const hasEmployeeAttendance = (m) => m.worker_type !== 'contractor' && !m.vendor_account_id;

// All timesheets of the month: one row per person with hour totals, approval and lock state.
async function monthList(orgId, user, { year, month }) {
  const { from, to } = monthBounds(year, month);
  const members = await visibleMembers(orgId, user);
  const ids = members.map((m) => m.id);
  const [entries, locks, monthLocks] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, org_membership_id: { in: ids }, date: { gte: from, lte: to } },
      select: { org_membership_id: true, hours: true, overtime_hours: true, status: true },
    }),
    prisma.timesheetLock.findMany({ where: { org_id: orgId, date: { gte: from, lte: to } }, select: { date: true } }),
    // The admin's per-employee month lock (the lock the Attendance Locks tab sets).
    prisma.timesheetMonthLock.findMany({ where: { org_id: orgId, period_year: year, period_month: month }, select: { org_membership_id: true } }),
  ]);
  const monthLocked = new Set(monthLocks.map((l) => l.org_membership_id));
  const totals = new Map();
  for (const e of entries) {
    const t = totals.get(e.org_membership_id) || { logged: 0, approved: 0, pending: 0, rejected: 0, entries: 0 };
    const hours = Number(e.hours) + Number(e.overtime_hours || 0);
    t.entries += 1;
    if (e.status === 'rejected') t.rejected += hours;
    else {
      t.logged += hours;
      if (e.status === 'approved') t.approved += hours;
      else t.pending += hours;
    }
    totals.set(e.org_membership_id, t);
  }
  const daysInMonth = to.getUTCDate();
  return {
    year,
    month,
    days_locked: locks.length,
    days_in_month: daysInMonth,
    people: members.map((m) => {
      const t = totals.get(m.id) || { logged: 0, approved: 0, pending: 0, rejected: 0, entries: 0 };
      const status = !t.entries ? 'no_entries' : t.pending > 0 ? 'pending' : t.rejected > 0 && !t.logged ? 'rejected' : 'approved';
      return {
        org_membership_id: m.id,
        name: m.person?.name || 'Unknown',
        department: m.person?.department?.name || null,
        logged_hours: round2(t.logged),
        approved_hours: round2(t.approved),
        pending_hours: round2(t.pending),
        rejected_hours: round2(t.rejected),
        status,
        month_locked: monthLocked.has(m.id) || locks.length >= daysInMonth,
        has_attendance: hasEmployeeAttendance(m),
      };
    }),
  };
}

// One person's month as a calendar: the day summaries plus attendance status and OT tickets per day.
async function monthCalendar(orgId, orgMembershipId, { year, month }) {
  const { from, to } = monthBounds(year, month);
  const member = await prisma.orgMembership.findUnique({ where: { id: orgMembershipId }, select: { worker_type: true, vendor_account_id: true } });
  const withAttendance = member ? hasEmployeeAttendance(member) : true;
  const [summary, attendance, tickets] = await Promise.all([
    workHours.daySummaries(orgId, orgMembershipId, from, to),
    withAttendance
      ? prisma.attendanceRecord.findMany({ where: { org_id: orgId, org_membership_id: orgMembershipId, date: { gte: from, lte: to } }, select: { date: true, status: true, regularized_reason: true } })
      : [],
    prisma.overtimeTicket.findMany({
      where: { org_id: orgId, org_membership_id: orgMembershipId, date: { gte: from, lte: to } },
      select: { id: true, date: true, hours: true, status: true, reason: true, account: { select: { name: true, project_name: true } } },
    }),
  ]);
  const attByDay = new Map(attendance.map((a) => [ymd(a.date), a]));
  const ticketsByDay = new Map();
  for (const t of tickets) {
    const key = ymd(t.date);
    if (!ticketsByDay.has(key)) ticketsByDay.set(key, []);
    ticketsByDay.get(key).push({ id: t.id, hours: Number(t.hours), status: t.status, reason: t.reason, project: t.account ? t.account.project_name || t.account.name : null });
  }
  const days = summary.days.map((d) => {
    const projects = new Map();
    for (const e of d.entries) {
      if (e.status === 'rejected') continue;
      const name = e.project || 'No project';
      projects.set(name, round2((projects.get(name) || 0) + e.hours));
    }
    // Attendance and leave are two separate sources. The recorded attendance status is shown as it was
    // recorded (Present stays Present); the leave TYPE (Sick / Casual / Paid Leave ...) only ever comes from
    // an approved leave request, never from the word "leave" on an attendance row.
    const att = attByDay.get(d.date) || null;
    const leaveRows = withAttendance ? d.leaves : [];
    const leaveName = leaveRows[0]?.name || null;
    const fullDayLeave = leaveRows.some((l) => !l.is_half_day);
    return {
      ...d,
      leave: withAttendance ? d.leave : null,
      leaves: leaveRows,
      pending_leaves: withAttendance ? d.pending_leaves : [],
      attendance_applicable: withAttendance,
      attendance_status: att?.status || null,
      attendance_label: att ? (att.status === 'leave' ? leaveName || 'Leave (no leave request)' : null) : null,
      attendance_conflict: Boolean(att && ['present', 'wfh'].includes(att.status) && fullDayLeave),
      attendance_note: att?.regularized_reason || null,
      ot_tickets: ticketsByDay.get(d.date) || [],
      project_hours: [...projects.entries()].map(([project, hours]) => ({ project, hours })),
      notes: d.entries.filter((e) => e.notes).map((e) => ({ project: e.project, notes: e.notes })),
    };
  });
  return { year, month, ...summary, attendance_applicable: withAttendance, days };
}

module.exports = { monthList, monthCalendar, visibleMembers };
