// Admin edit of one person's one day, as the two separate things an admin thinks about:
//   1. Attendance: did they work (present / half day), were they absent, on leave (and which leave type) or on a holiday.
//   2. Where they worked: the office or home. That is the existing work_place_days record, not an attendance status.
// A leave type is a real leave request (approved on the spot, balance and unpaid overflow included), so the leave
// register, balances and salary all see the same thing. The attendance record itself only says present / half day / ...
// Every part keeps its own audit and finance-change flag; a locked month is flagged for review, never rewritten.

const prisma = require('../../config/db');
const attendance = require('./attendance.service');
const leaveService = require('../leave/leave.service');
const attendanceDashboard = require('../attendanceDashboard/attendanceDashboard.service');

const ymd = (d) => d.toISOString().slice(0, 10);

// The leave rows (approved) that touch the day.
async function approvedLeavesOn(orgId, orgMembershipId, date) {
  return prisma.leaveRequest.findMany({
    where: { org_id: orgId, org_membership_id: orgMembershipId, status: 'approved', from_date: { lte: date }, to_date: { gte: date } },
    include: { leave_type: { select: { name: true } } },
  });
}

// Puts a withdrawn leave back as it was (used when the replacement could not be created, so nothing is lost).
async function restoreLeave(request) {
  await prisma.leaveRequest.update({ where: { id: request.id }, data: { status: 'approved', decision_reason: request.decision_reason, decided_at: request.decided_at } });
}

async function withdraw(orgId, actor, request, reason) {
  const done = await leaveService.revoke(orgId, request.id, actor.org_membership_id, { reason }, actor.id);
  return done.error ? { error: done.error } : { request };
}

async function applyLeave(orgId, actor, { org_membership_id, date, leave_type_id, is_half_day, half_day_session, reason }) {
  return leaveService.createRequestForEmployee(
    orgId,
    { org_membership_id: actor.org_membership_id, user_id: actor.id },
    {
      org_membership_id,
      auto_approve: true,
      override_attendance: !is_half_day,
      leave_type_id,
      from_date: date,
      to_date: date,
      is_half_day: Boolean(is_half_day),
      ...(is_half_day ? { half_day_session: half_day_session || 'SECOND_HALF' } : {}),
      reason,
    }
  );
}

// Replaces the day's leave (full or half) with `leave_type_id`, or removes it when null. Returns { changed } or { error }.
async function setLeave(orgId, actor, { org_membership_id, date, leave_type_id, half, half_day_session, reason, confirm_span = false }) {
  const leaves = (await approvedLeavesOn(orgId, org_membership_id, date)).filter((l) => Boolean(l.is_half_day) === Boolean(half));
  const same = leave_type_id ? leaves.find((l) => l.leave_type_id === leave_type_id) : null;
  if (same && leaves.length === 1) return { changed: false };

  // A leave that runs over several days is withdrawn whole only after the admin confirmed it names all its days.
  const wide = leaves.find((l) => ymd(l.from_date) !== ymd(l.to_date));
  if (wide && !confirm_span) return { error: 'leave_spans_days', leave: wide };

  const withdrawn = [];
  for (const leave of leaves) {
    const done = await withdraw(orgId, actor, leave, `Changed from the attendance editor: ${reason}`);
    if (done.error) { for (const w of withdrawn) await restoreLeave(w); return { error: done.error }; }
    withdrawn.push(leave);
  }

  const reapplied = [];
  const undo = async () => {
    for (const r of reapplied) await leaveService.revoke(orgId, r.id, actor.org_membership_id, { reason: 'Undone: the day change failed' }, actor.id);
    for (const w of withdrawn) await restoreLeave(w);
  };
  if (leave_type_id) {
    const created = await applyLeave(orgId, actor, { org_membership_id, date, leave_type_id, is_half_day: half, half_day_session, reason });
    if (created.error) { await undo(); return { error: created.error, detail: created }; }
  }
  // The other days of the withdrawn several-day leave go back on, with the type they had.
  if (wide) {
    const day = (dt, n) => new Date(dt.getTime() + n * 86400000);
    const ranges = [[wide.from_date, day(date, -1)], [day(date, 1), wide.to_date]].filter(([a, b]) => ymd(a) <= ymd(b));
    for (const [from, to] of ranges) {
      const back = await leaveService.createRequestForEmployee(orgId, { org_membership_id: actor.org_membership_id, user_id: actor.id }, {
        org_membership_id, auto_approve: true, override_attendance: true, leave_type_id: wide.leave_type_id, from_date: from, to_date: to, is_half_day: false, reason: `Rest of the leave of ${ymd(wide.from_date)} to ${ymd(wide.to_date)}: ${reason}`,
      });
      if (back.error && back.error !== 'no_working_days') { await undo(); return { error: back.error, detail: back }; }
      if (back.request) reapplied.push(back.request);
    }
  }
  return { changed: withdrawn.length > 0 || Boolean(leave_type_id) };
}

async function setDay(orgId, actor, body) {
  const { org_membership_id, date, status, leave_type_id, half_day_session, work_place, reason, cancel_leave, confirm_span } = body;
  const member = await prisma.orgMembership.findFirst({ where: { id: org_membership_id, org_id: orgId }, select: { id: true } });
  if (!member) return { error: 'membership_not_found' };
  const changes = [];

  if (status === 'leave') {
    if (!leave_type_id) return { error: 'leave_type_required' };
    // Any half-day leave on the day goes first: a whole day of leave replaces it.
    const halves = (await approvedLeavesOn(orgId, org_membership_id, date)).filter((l) => l.is_half_day);
    for (const half of halves) {
      const done = await withdraw(orgId, actor, half, `Replaced by a full day of leave: ${reason}`);
      if (done.error) return { error: done.error };
    }
    const result = await setLeave(orgId, actor, { org_membership_id, date, leave_type_id, half: false, reason, confirm_span });
    if (result.error) return result;
    changes.push(result.changed ? 'leave' : 'leave unchanged');
  } else {
    // Present / half day / absent / holiday: attendance itself. A full-day leave is withdrawn first when the admin asked for that.
    if (cancel_leave) {
      const cancelled = await setLeave(orgId, actor, { org_membership_id, date, leave_type_id: null, half: false, reason, confirm_span });
      if (cancelled.error) return cancelled;
      if (cancelled.changed) changes.push('leave cancelled');
    }
    const marked = await attendance.recordManualDay(orgId, actor.id, { org_membership_id, date, status, reason });
    if (marked.error) return marked;
    changes.push(`attendance ${marked.action}`);

    // Half day: which leave covers the other half (or none).
    if (status === 'half_day' && leave_type_id !== undefined) {
      const result = await setLeave(orgId, actor, { org_membership_id, date, leave_type_id, half: true, half_day_session, reason });
      if (result.error) return result;
      if (result.changed) changes.push('other half');
    }

    // Where they worked: only a day they worked.
    if ((status === 'present' || status === 'half_day') && work_place) {
      const placed = await attendanceDashboard.requestPlace(orgId, actor, { org_membership_id, date: ymd(date), work_place, reason });
      if (placed.error) return { error: `place_${placed.error}` };
      changes.push(`place ${work_place}`);
    }
  }

  await prisma.auditLog.create({
    data: {
      org_id: orgId, actor_id: actor.id, action: 'attendance_day_set', entity_type: 'attendance', entity_id: org_membership_id, reason,
      snapshot: { date: ymd(date), status, leave_type_id: leave_type_id ?? null, work_place: work_place ?? null, changes },
    },
  });
  return { changes };
}

module.exports = { setDay };
