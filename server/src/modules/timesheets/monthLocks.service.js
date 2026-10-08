// Stage 1 of the financial lock workflow: the timesheet lock.
//
// An admin locks an employee's whole month of timesheets (one or many at once). The previous
// month is expected to be locked by the 5th of the following month; the lock is manual, so
// `status` shows who is still open and whether the deadline has passed. Once locked, regular
// changes are refused (the same rule as a locked day) - an admin reopens it with a reason.
// Every lock / reopen writes one audit row per employee, bulk or not (calculations/lockAudit.service.js).

const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');
const lockAudit = require('../calculations/lockAudit.service');

const LOCK_DUE_DAY = 5;
const ymd = (d) => d.toISOString().slice(0, 10);

// The 5th of the month after (year, month), as a UTC date.
const dueDate = (year, month) => new Date(Date.UTC(year, month, LOCK_DUE_DAY));

const monthOf = (date) => ({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });

async function isMemberMonthLocked(orgMembershipId, date) {
  const { year, month } = monthOf(date);
  const lock = await prisma.timesheetMonthLock.findUnique({
    where: { org_membership_id_period_year_period_month: { org_membership_id: orgMembershipId, period_year: year, period_month: month } },
    select: { id: true },
  });
  return Boolean(lock);
}

// Per employee for a month: entries by status, whether the month is locked, the deadline and whether it has passed.
async function status(orgId, { year, month }) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const [members, entries, locks, dayLocks] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { org_id: orgId, employment_status: { not: 'terminated' } },
      select: { id: true, person: { select: { name: true, department: { select: { name: true } } } } },
      orderBy: { person: { name: 'asc' } },
    }),
    prisma.timesheetEntry.groupBy({ by: ['org_membership_id', 'status'], where: { org_id: orgId, date: { gte: from, lte: to } }, _count: { _all: true }, _sum: { hours: true } }),
    prisma.timesheetMonthLock.findMany({ where: { org_id: orgId, period_year: year, period_month: month } }),
    prisma.timesheetLock.count({ where: { org_id: orgId, date: { gte: from, lte: to } } }),
  ]);
  const due = dueDate(year, month);
  const overdue = todayIst() > due;
  const lockByMember = new Map(locks.map((l) => [l.org_membership_id, l]));
  const byMember = new Map();
  for (const e of entries) {
    const row = byMember.get(e.org_membership_id) || { submitted: 0, approved: 0, rejected: 0, hours: 0 };
    row[e.status] += e._count._all;
    row.hours += Number(e._sum.hours || 0);
    byMember.set(e.org_membership_id, row);
  }
  return {
    year,
    month,
    due_date: ymd(due),
    overdue,
    days_locked: dayLocks,
    people: members.map((m) => {
      const e = byMember.get(m.id) || { submitted: 0, approved: 0, rejected: 0, hours: 0 };
      const lock = lockByMember.get(m.id);
      return {
        org_membership_id: m.id,
        name: m.person?.name || 'Unknown',
        department: m.person?.department?.name || null,
        entries: e.submitted + e.approved + e.rejected,
        pending: e.submitted,
        approved: e.approved,
        rejected: e.rejected,
        hours: Math.round(e.hours * 100) / 100,
        locked: Boolean(lock),
        locked_at: lock?.locked_at || null,
        locked_by: lock?.locked_by || null,
        needs_lock: !lock && overdue,
      };
    }),
  };
}

// Bulk lock: org_membership_ids (or everyone with entries when `all_with_entries`). One audit row per employee.
async function lockMonth(orgId, actor, { year, month, org_membership_ids, all_with_entries = false, reason, force = false }) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  if (from > todayIst()) return { error: 'future_month' };
  let ids = org_membership_ids || [];
  if (all_with_entries) {
    const rows = await prisma.timesheetEntry.findMany({ where: { org_id: orgId, date: { gte: from, lte: to } }, select: { org_membership_id: true }, distinct: ['org_membership_id'] });
    ids = [...new Set([...ids, ...rows.map((r) => r.org_membership_id)])];
  }
  if (!ids.length) return { error: 'nobody_selected' };
  const members = await prisma.orgMembership.findMany({ where: { id: { in: ids }, org_id: orgId }, select: { id: true } });
  const valid = new Set(members.map((m) => m.id));
  const bulkId = lockAudit.newBulkId();
  const results = [];
  for (const id of ids) {
    if (!valid.has(id)) { results.push({ org_membership_id: id, result: 'not_found' }); continue; }
    if (await isMemberMonthLocked(id, from)) { results.push({ org_membership_id: id, result: 'already_locked' }); continue; }
    const pending = await prisma.timesheetEntry.count({ where: { org_membership_id: id, date: { gte: from, lte: to }, status: 'submitted' } });
    // A timesheet is not locked until an admin has approved (or rejected) every entry. An admin can still
    // lock with `force` and a reason (admin control); that is written to the audit row.
    if (pending > 0 && !force) { results.push({ org_membership_id: id, result: 'pending_entries', pending }); continue; }
    await prisma.$transaction(async (tx) => {
      await tx.timesheetMonthLock.create({ data: { org_id: orgId, org_membership_id: id, period_month: month, period_year: year, locked_by: actor.id } });
      await lockAudit.record(tx, orgId, {
        stage: 'timesheet', action: 'lock', actor_id: actor.id, org_membership_id: id, period_month: month, period_year: year,
        previous_status: 'open', new_status: 'locked', change: `Month timesheet locked${pending ? ` by admin override with ${pending} entr${pending === 1 ? 'y' : 'ies'} still pending approval` : ''}`, reason, bulk_id: bulkId,
      });
    });
    results.push({ org_membership_id: id, result: 'locked', pending });
  }
  return { bulk_id: bulkId, year, month, locked: results.filter((r) => r.result === 'locked').length, pending_entries: results.filter((r) => r.result === 'pending_entries').length, results };
}

// Reopen: the month becomes editable again. A reason is required; one audit row per employee.
async function reopenMonth(orgId, actor, { year, month, org_membership_ids, reason }) {
  const bulkId = lockAudit.newBulkId();
  const results = [];
  for (const id of org_membership_ids) {
    const lock = await prisma.timesheetMonthLock.findFirst({ where: { org_id: orgId, org_membership_id: id, period_year: year, period_month: month } });
    if (!lock) { results.push({ org_membership_id: id, result: 'not_locked' }); continue; }
    await prisma.$transaction(async (tx) => {
      await tx.timesheetMonthLock.delete({ where: { id: lock.id } });
      await lockAudit.record(tx, orgId, {
        stage: 'timesheet', action: 'reopen', actor_id: actor.id, org_membership_id: id, period_month: month, period_year: year,
        previous_status: 'locked', new_status: 'open', change: 'Month timesheet reopened', reason, bulk_id: bulkId,
      });
    });
    results.push({ org_membership_id: id, result: 'reopened' });
  }
  return { bulk_id: bulkId, year, month, reopened: results.filter((r) => r.result === 'reopened').length, results };
}

module.exports = { LOCK_DUE_DAY, dueDate, isMemberMonthLocked, status, lockMonth, reopenMonth };
