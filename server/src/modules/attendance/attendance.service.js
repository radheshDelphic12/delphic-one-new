const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');
const leaveService = require('../leave/leave.service');

function minutesOfDayInZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  return Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
}

// Minutes past the shift start, but only once the arrival is beyond the
// shift's grace period — inside grace it's 0 (on time). Null with no shift,
// same as overtime: there's no "expected start" to be late against. Shift
// times are minutes-from-midnight in the ORG's timezone, so the check-in
// instant is converted there first; the difference is wrapped to ±12h so an
// overnight shift's early-evening arrival isn't read as "late by 20 hours".
function computeLateMinutes(shift, checkInAt, timeZone) {
  if (!shift) return null;
  const raw = minutesOfDayInZone(checkInAt, timeZone) - shift.start_minutes;
  const diff = ((((raw + 720) % 1440) + 1440) % 1440) - 720;
  return diff > shift.grace_minutes ? diff : 0;
}

async function checkIn(orgId, orgMembershipId) {
  const date = todayIst();
  const leave = await leaveService.leaveDayFor(orgId, orgMembershipId, date);
  if (leave) return { error: 'leave_day', leave };
  const existing = await prisma.attendanceRecord.findFirst({
    where: { org_id: orgId, org_membership_id: orgMembershipId, date },
  });
  if (existing?.check_in_at) return { error: 'already_checked_in', record: existing };

  const membership = await prisma.orgMembership.findUnique({
    where: { id: orgMembershipId },
    select: { shift: true, org: { select: { timezone: true } } },
  });
  const check_in_at = new Date();
  const late_minutes = computeLateMinutes(membership?.shift, check_in_at, membership?.org?.timezone || 'Asia/Kolkata');

  const record = existing
    ? await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: { check_in_at, late_minutes, status: 'present', source: 'web' },
      })
    : await prisma.attendanceRecord.create({
        data: { org_id: orgId, org_membership_id: orgMembershipId, date, check_in_at, late_minutes, status: 'present', source: 'web' },
      });
  return { record };
}

// A shift's expected duration in minutes, handling an overnight shift
// (end_minutes < start_minutes, e.g. a 22:00-06:00 shift).
function shiftDurationMinutes(shift) {
  const raw = shift.end_minutes - shift.start_minutes;
  return raw >= 0 ? raw : raw + 24 * 60;
}

// Overtime = minutes worked beyond (shift duration + grace period). Null
// when no Shift is assigned — there's no "standard shift duration" to be
// over, per the client brief's overtime requirement.
function computeOvertimeMinutes(shift, checkInAt, checkOutAt) {
  if (!shift) return null;
  const workedMinutes = Math.round((checkOutAt - checkInAt) / 60000);
  const allowed = shiftDurationMinutes(shift) + shift.grace_minutes;
  return Math.max(0, workedMinutes - allowed);
}

async function checkOut(orgId, orgMembershipId) {
  const date = todayIst();
  const leave = await leaveService.leaveDayFor(orgId, orgMembershipId, date);
  if (leave) return { error: 'leave_day', leave };
  const existing = await prisma.attendanceRecord.findFirst({
    where: { org_id: orgId, org_membership_id: orgMembershipId, date },
  });
  if (!existing || !existing.check_in_at) return { error: 'not_checked_in' };
  if (existing.check_out_at) return { error: 'already_checked_out', record: existing };

  const membership = await prisma.orgMembership.findUnique({
    where: { id: orgMembershipId },
    select: { shift: true },
  });
  const check_out_at = new Date();
  const overtime_minutes = computeOvertimeMinutes(membership?.shift, existing.check_in_at, check_out_at);

  const record = await prisma.attendanceRecord.update({
    where: { id: existing.id },
    data: { check_out_at, overtime_minutes },
  });
  return { record };
}

function dateRangeWhere({ from, to }) {
  if (!from && !to) return undefined;
  return { gte: from || undefined, lte: to || undefined };
}

async function listMine(orgId, orgMembershipId, { from, to, page, limit }) {
  const date = dateRangeWhere({ from, to });
  const where = { org_id: orgId, org_membership_id: orgMembershipId, ...(date ? { date } : {}) };
  const [data, total] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.attendanceRecord.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

// Admin/team view — every membership in the org, or one via org_membership_id.
async function listTeam(orgId, { from, to, org_membership_id, page, limit }) {
  const date = dateRangeWhere({ from, to });
  const where = {
    org_id: orgId,
    ...(org_membership_id ? { org_membership_id } : {}),
    ...(date ? { date } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where,
      orderBy: [{ date: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: { org_membership: { select: { id: true, person: { select: { id: true, name: true } } } } },
    }),
    prisma.attendanceRecord.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

// Admin regularization — correct a record after the fact (forgot to check
// out, marked WFH, etc.). Always requires a reason, audited on the row itself
// (no separate history table yet — Phase 2 keeps this lean).
async function regularize(orgId, recordId, adminUserId, { status, check_in_at, check_out_at, reason }) {
  const existing = await prisma.attendanceRecord.findFirst({ where: { id: recordId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };

  const record = await prisma.attendanceRecord.update({
    where: { id: recordId },
    data: {
      status,
      ...(check_in_at ? { check_in_at: new Date(check_in_at) } : {}),
      ...(check_out_at ? { check_out_at: new Date(check_out_at) } : {}),
      regularized_by: adminUserId,
      regularized_reason: reason,
    },
  });
  return { record };
}

// Client brief: configurable shift timings + grace period per employee.
async function listShifts(orgId) {
  return prisma.shift.findMany({ where: { org_id: orgId }, orderBy: { name: 'asc' } });
}

async function createShift(orgId, { name, start_minutes, end_minutes, grace_minutes }) {
  const existing = await prisma.shift.findUnique({ where: { org_id_name: { org_id: orgId, name } } });
  if (existing) return { error: 'name_taken' };
  const shift = await prisma.shift.create({ data: { org_id: orgId, name, start_minutes, end_minutes, grace_minutes } });
  return { shift };
}

module.exports = { checkIn, checkOut, listMine, listTeam, regularize, listShifts, createShift, computeLateMinutes };
