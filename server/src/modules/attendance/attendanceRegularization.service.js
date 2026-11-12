// Attendance regularization requests: an employee asks to correct one day, an admin approves or rejects.
// Approving writes the day through attendance.recordManualDay (the same rules and audit as an admin's manual entry),
// so a leave day, a date before joining, a future date etc. are refused there. A month an admin has locked for the
// employee cannot be changed by a request: it has to be reopened first.
const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');
const attendance = require('./attendance.service');

const MEMBER_SELECT = { id: true, person: { select: { id: true, name: true } } };
const INCLUDE = { org_membership: { select: MEMBER_SELECT } };

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const serialize = (row, current = null) => ({
  id: row.id,
  org_membership_id: row.org_membership_id,
  employee: row.org_membership?.person?.name || null,
  date: ymd(row.date),
  requested_status: row.requested_status,
  check_in_time: row.check_in_time,
  check_out_time: row.check_out_time,
  reason: row.reason,
  status: row.status,
  decided_at: row.decided_at,
  decision_reason: row.decision_reason,
  created_at: row.created_at,
  // what the day looks like now, so the reviewer sees what would change
  current: current ? { status: current.status, check_in_at: current.check_in_at, check_out_at: current.check_out_at } : null,
});

async function monthLocked(orgId, orgMembershipId, date) {
  const lock = await prisma.timesheetMonthLock.findFirst({
    where: { org_id: orgId, org_membership_id: orgMembershipId, period_year: date.getUTCFullYear(), period_month: date.getUTCMonth() + 1 },
    select: { id: true },
  });
  return Boolean(lock);
}

async function create(orgId, user, body) {
  const membershipId = user.org_membership_id;
  const member = await prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId }, select: { id: true, joined_at: true, worker_type: true, vendor_account_id: true } });
  if (!member) return { error: 'membership_not_found' };
  if (member.worker_type === 'contractor' || member.vendor_account_id) return { error: 'no_attendance' };
  if (body.date > todayIst()) return { error: 'future_date' };
  if (member.joined_at && body.date < member.joined_at) return { error: 'before_joining' };
  if (body.check_out_time && !body.check_in_time) return { error: 'checkout_without_checkin' };
  if (await monthLocked(orgId, membershipId, body.date)) return { error: 'month_locked' };
  const pending = await prisma.attendanceRegularizationRequest.findFirst({ where: { org_membership_id: membershipId, date: body.date, status: 'pending' }, select: { id: true } });
  if (pending) return { error: 'duplicate_pending' };
  const row = await prisma.attendanceRegularizationRequest.create({
    data: {
      org_id: orgId,
      org_membership_id: membershipId,
      date: body.date,
      requested_status: body.status,
      check_in_time: body.check_in_time || null,
      check_out_time: body.check_out_time || null,
      reason: body.reason,
      requested_by: user.id,
    },
    include: INCLUDE,
  });
  return { request: serialize(row) };
}

async function listMine(orgId, orgMembershipId) {
  const rows = await prisma.attendanceRegularizationRequest.findMany({
    where: { org_id: orgId, org_membership_id: orgMembershipId },
    orderBy: { created_at: 'desc' },
    include: INCLUDE,
    take: 100,
  });
  return rows.map((r) => serialize(r));
}

/** Everyone's requests for the admin review screen (newest first), each with the day's current record. */
async function listAll(orgId, { status } = {}) {
  const rows = await prisma.attendanceRegularizationRequest.findMany({
    where: { org_id: orgId, ...(status ? { status } : {}) },
    orderBy: { created_at: 'desc' },
    include: INCLUDE,
    take: 500,
  });
  const records = rows.length
    ? await prisma.attendanceRecord.findMany({ where: { org_id: orgId, OR: rows.map((r) => ({ org_membership_id: r.org_membership_id, date: r.date })) } })
    : [];
  const byKey = new Map(records.map((r) => [`${r.org_membership_id}|${ymd(r.date)}`, r]));
  return rows.map((r) => serialize(r, byKey.get(`${r.org_membership_id}|${ymd(r.date)}`)));
}

async function pendingCount(orgId) {
  return prisma.attendanceRegularizationRequest.count({ where: { org_id: orgId, status: 'pending' } });
}

async function decide(orgId, requestId, admin, { status, decision_reason }) {
  const row = await prisma.attendanceRegularizationRequest.findFirst({ where: { id: requestId, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  if (row.status !== 'pending') return { error: 'already_decided' };
  if (status === 'approved') {
    if (await monthLocked(orgId, row.org_membership_id, row.date)) return { error: 'month_locked' };
    const written = await attendance.recordManualDay(orgId, admin.id, {
      org_membership_id: row.org_membership_id,
      date: row.date,
      status: row.requested_status,
      check_in_time: row.check_in_time,
      check_out_time: row.check_out_time,
      reason: `Regularization request: ${row.reason}`.slice(0, 500),
    });
    if (written.error) return { error: written.error }; // stays pending: the reviewer sees why it could not be applied
  }
  const updated = await prisma.attendanceRegularizationRequest.update({
    where: { id: requestId },
    data: { status, decided_by: admin.id, decided_at: new Date(), decision_reason: decision_reason || null },
    include: INCLUDE,
  });
  return { request: serialize(updated) };
}

module.exports = { create, listMine, listAll, pendingCount, decide };
