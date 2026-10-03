// Automated attendance (no check-in / check-out).
//
// Two operations mark applicable employees "present":
//  * the daily process (jobs/autoAttendance.js) - at each employee's working-hour start time it
//    marks THAT day present if the day is a working day with no leave / holiday; it never touches
//    a future date;
//  * an admin backfill for a previous month - the same rules for every working day of that
//    month, audited (who, when, month, employees, records created, reason).
//
// "Applicable" = active full-time employees of the IT DEPARTMENT only. Non-IT staff, contractors and
// vendors are never marked by either operation. Existing attendance records are never overwritten, and
// approved leave days, weekends and company holidays are skipped. Attendance stays separate from
// project timesheets.

const prisma = require('../../config/db');
const logger = require('../../config/logger');
const { todayIst } = require('../../lib/istDate');
const workHours = require('../timesheets/workHours.service');
const { detectFinanceChange } = require('../../lib/financeChanges');

const DEFAULT_START_MINUTES = 9 * 60;
const DAY_MS = 86400000;
const ymd = (date) => date.toISOString().slice(0, 10);

const MEMBER_SELECT = {
  id: true,
  joined_at: true,
  left_at: true,
  org: { select: { timezone: true } },
  shift: { select: { start_minutes: true } },
  person: { select: { name: true } },
};

// The IT department, however it is capitalised.
const IT_DEPARTMENT = { person: { department: { name: { equals: 'IT', mode: 'insensitive' } } } };

async function applicableMembers(orgId, { membershipIds = null } = {}) {
  return prisma.orgMembership.findMany({
    where: {
      org_id: orgId,
      employment_status: { in: ['active', 'notice_period'] },
      worker_type: 'full_time_employee',
      ...IT_DEPARTMENT,
      ...(membershipIds ? { id: { in: membershipIds } } : {}),
      OR: [{ pay_basis: 'attendance' }, { person: { department: { name: { equals: 'IT', mode: 'insensitive' } } } }],
    },
    select: MEMBER_SELECT,
    orderBy: { joined_at: 'asc' },
  });
}

function minutesOfDay(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  return Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
}

// Has the employee's working-hour start time passed (in the org's timezone) at `now`?
function startTimePassed(member, now) {
  const start = member.shift?.start_minutes ?? DEFAULT_START_MINUTES;
  return minutesOfDay(now, member.org?.timezone || 'Asia/Kolkata') >= start;
}

// Why a member is not marked on `date` (null = mark present).
async function skipReason(orgId, member, date) {
  if (member.joined_at && date < member.joined_at) return 'before_joining';
  if (member.left_at && date > member.left_at) return 'left';
  const calendar = await workHours.companyCalendarDays(orgId, member.id, date, date);
  const day = workHours.dayInfo(date, calendar, 1);
  if (day.day_type === 'weekend') return 'weekend';
  if (day.day_type === 'company_holiday') return 'holiday';
  // Approved leave: a full day belongs to leave management; a single half-day leave means the other half is
  // worked, so the day is marked as a half day (the leave itself pays the other half). Two half-days = a full day off.
  const leaves = await prisma.leaveRequest.findMany({ where: { org_id: orgId, org_membership_id: member.id, status: 'approved', from_date: { lte: date }, to_date: { gte: date } }, select: { is_half_day: true } });
  if (leaves.some((l) => !l.is_half_day) || leaves.length >= 2) return 'leave';
  if (await prisma.attendanceRecord.count({ where: { org_id: orgId, org_membership_id: member.id, date } })) return 'already_marked';
  return leaves.length === 1 ? 'half_day_leave' : null;
}

async function markPresent(orgId, member, date, { actorUserId = null, reason }) {
  if (date > todayIst()) return { skipped: 'future_date' };
  const skipped = await skipReason(orgId, member, date);
  if (skipped && skipped !== 'half_day_leave') return { skipped };
  const status = skipped === 'half_day_leave' ? 'half_day' : 'present';
  const record = await prisma.attendanceRecord.create({
    data: {
      org_id: orgId,
      org_membership_id: member.id,
      date,
      status,
      source: 'manual',
      regularized_by: actorUserId,
      regularized_reason: reason,
    },
  });
  // A locked month is flagged for recalculation, never rewritten.
  await detectFinanceChange(orgId, {
    source_type: 'attendance',
    source_id: record.id,
    date,
    org_membership_id: member.id,
    changed_by: actorUserId,
    description: `Attendance marked ${status.replace('_', ' ')} (${reason})`.slice(0, 500),
    old_value: { status: 'no_record' },
    new_value: { status },
  });
  return { record };
}

/**
 * The daily process for one org: today (IST) only, for people whose start time has passed.
 * Idempotent - safe to run every few minutes.
 */
async function runDaily(orgId, now = new Date()) {
  const date = todayIst();
  const members = await applicableMembers(orgId);
  let created = 0;
  for (const member of members) {
    if (!startTimePassed(member, now)) continue;
    const result = await markPresent(orgId, member, date, { reason: 'auto_daily' });
    if (result.record) created += 1;
  }
  return { date: ymd(date), considered: members.length, created };
}

// First day of the month containing `date`, as a UTC-midnight Date.
const monthStart = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

/**
 * Admin backfill: mark every applicable employee present on each working day of a PREVIOUS month.
 * Never the current or a future month. `dry_run` reports what would happen without writing.
 * Every run (not dry runs) writes one audit row: who, month, employees affected, records created, reason.
 */
async function backfillMonth(orgId, adminUserId, { year, month, reason, org_membership_ids = null, dry_run = false }) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  if (from >= monthStart(todayIst())) return { error: 'month_not_past' };

  const members = await applicableMembers(orgId, { membershipIds: org_membership_ids });
  const skipped = {};
  const perEmployee = [];
  let created = 0;
  for (const member of members) {
    let count = 0;
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + DAY_MS)) {
      if (dry_run) {
        const why = await skipReason(orgId, member, d);
        if (why && why !== 'half_day_leave') skipped[why] = (skipped[why] || 0) + 1;
        else count += 1;
      } else {
        const result = await markPresent(orgId, member, d, { actorUserId: adminUserId, reason: `backfill ${year}-${String(month).padStart(2, '0')}: ${reason}` });
        if (result.record) count += 1;
        else if (result.skipped) skipped[result.skipped] = (skipped[result.skipped] || 0) + 1;
      }
    }
    created += count;
    if (count) perEmployee.push({ id: member.id, name: member.person?.name || null, days: count });
  }
  const summary = { year, month, employees_considered: members.length, employees_affected: perEmployee.length, records: created, skipped, employees: perEmployee };
  if (!dry_run) {
    await prisma.auditLog.create({
      data: {
        org_id: orgId,
        actor_id: adminUserId,
        action: 'attendance_backfill_month',
        entity_type: 'attendance',
        entity_id: orgId,
        reason,
        snapshot: summary,
      },
    });
    logger.info('attendance_backfill_month', { org_id: orgId, actor_id: adminUserId, year, month, records: created });
  }
  return { dry_run, ...summary };
}

/**
 * Clean-up of the earlier bulk Present that ran for everybody: removes the attendance rows that the DAILY
 * process or a BACKFILL created (source 'manual', status present / half_day, reason 'auto_daily' or
 * 'backfill YYYY-MM: ...') for people OUTSIDE the IT department. Nothing else is touched: a row an admin
 * regularised or marked by hand, leave, and IT rows stay. `dry_run` only counts. Audited like the run it undoes.
 */
async function cleanupNonItAttendance(orgId, adminUserId, { reason, dry_run = false }) {
  const rows = await prisma.attendanceRecord.findMany({
    where: {
      org_id: orgId,
      source: 'manual',
      status: { in: ['present', 'half_day'] },
      OR: [{ regularized_reason: 'auto_daily' }, { regularized_reason: { startsWith: 'backfill ' } }],
      NOT: { org_membership: IT_DEPARTMENT },
    },
    select: { id: true, org_membership_id: true, date: true, status: true, org_membership: { select: { person: { select: { name: true } } } } },
  });
  const perEmployee = new Map();
  for (const r of rows) {
    const cur = perEmployee.get(r.org_membership_id) || { id: r.org_membership_id, name: r.org_membership?.person?.name || null, days: 0 };
    cur.days += 1;
    perEmployee.set(r.org_membership_id, cur);
  }
  const summary = { records: rows.length, employees_affected: perEmployee.size, employees: [...perEmployee.values()] };
  if (dry_run || !rows.length) return { dry_run, ...summary };

  for (const r of rows) {
    // A locked month is flagged for recalculation, never silently rewritten.
    await detectFinanceChange(orgId, {
      source_type: 'attendance',
      source_id: r.id,
      date: r.date,
      org_membership_id: r.org_membership_id,
      changed_by: adminUserId,
      description: `Auto/backfill attendance removed for a non-IT employee (${r.status.replace('_', ' ')}): ${reason}`.slice(0, 500),
      old_value: { status: r.status },
      new_value: { status: 'no_record' },
    });
  }
  await prisma.attendanceRecord.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: adminUserId, action: 'attendance_backfill_cleanup', entity_type: 'attendance', entity_id: orgId, reason, snapshot: summary } });
  logger.info('attendance_backfill_cleanup', { org_id: orgId, actor_id: adminUserId, records: rows.length });
  return { dry_run, ...summary };
}

// Past backfill runs (audit trail), newest first.
async function listBackfillRuns(orgId, limit = 20) {
  const rows = await prisma.auditLog.findMany({ where: { org_id: orgId, action: 'attendance_backfill_month' }, orderBy: { created_at: 'desc' }, take: limit });
  return rows.map((r) => ({ id: r.id, actor_id: r.actor_id, created_at: r.created_at, reason: r.reason, ...r.snapshot }));
}

module.exports = { applicableMembers, startTimePassed, runDaily, backfillMonth, cleanupNonItAttendance, listBackfillRuns };
