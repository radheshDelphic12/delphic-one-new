const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');
const leaveService = require('../leave/leave.service');
const { detectFinanceChange } = require('../../lib/financeChanges');

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
  await detectFinanceChange(orgId, {
    source_type: 'attendance',
    source_id: record.id,
    date,
    org_membership_id: orgMembershipId,
    changed_by: await personIdOf(orgMembershipId),
    description: 'Checked in',
    old_value: { status: existing?.status || 'no_record' },
    new_value: { status: 'present', check_in_at },
  });
  return { record };
}

async function personIdOf(orgMembershipId) {
  const m = await prisma.orgMembership.findUnique({ where: { id: orgMembershipId }, select: { person_id: true } });
  return m?.person_id || null;
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
  // A regularised day in an already-finalized month never rewrites the locked
  // salary / revenue / financials — it is flagged for review instead.
  await detectFinanceChange(orgId, {
    source_type: 'attendance',
    source_id: recordId,
    date: existing.date,
    org_membership_id: existing.org_membership_id,
    changed_by: adminUserId,
    description: `Attendance regularised: ${existing.status} → ${status}${reason ? ` (${reason})` : ''}`.slice(0, 500),
    old_value: { status: existing.status, check_in_at: existing.check_in_at, check_out_at: existing.check_out_at },
    new_value: { status: record.status, check_in_at: record.check_in_at, check_out_at: record.check_out_at },
  });
  return { record };
}

// Admin delete of a wrong record. Like a regularisation, a record in an
// already-finalized month raises a finance change instead of silently
// rewriting the locked salary / revenue.
async function deleteRecord(orgId, recordId, adminUserId, { reason }) {
  const existing = await prisma.attendanceRecord.findFirst({ where: { id: recordId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  await prisma.attendanceRecord.delete({ where: { id: recordId } });
  const change = await detectFinanceChange(orgId, {
    source_type: 'attendance',
    source_id: recordId,
    date: existing.date,
    org_membership_id: existing.org_membership_id,
    changed_by: adminUserId,
    description: `Attendance deleted by admin (${existing.status}): ${reason}`.slice(0, 500),
    old_value: { status: existing.status, check_in_at: existing.check_in_at, check_out_at: existing.check_out_at },
    new_value: null,
  });
  return { deleted: true, flagged: change?.flagged || 0 };
}

// --- Backfill: admin records attendance for past days (single day or a sheet). ---

const TIMED_STATUSES = new Set(['present', 'half_day', 'wfh']);
const STATUSES = new Set(['present', 'absent', 'half_day', 'leave', 'holiday', 'wfh']);

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

// Offset (ms) of `timeZone` from UTC at `instant`.
function zoneOffsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant of wall-clock `hh:mm` on calendar day `date` (UTC-midnight Date) in `timeZone`. */
function wallTimeToInstant(date, hhmm, timeZone) {
  const [h, m] = hhmm.split(':').map(Number);
  const guess = new Date(date.getTime() + (h * 60 + m) * 60000);
  return new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
}

function sameInstant(a, b) {
  return (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
}

async function loadMembershipForBackfill(orgId, orgMembershipId) {
  return prisma.orgMembership.findFirst({
    where: { id: orgMembershipId, org_id: orgId },
    select: { id: true, joined_at: true, shift: true, org: { select: { timezone: true } } },
  });
}

// Creates or overwrites one day's record. Returns { record, action } where
// action is 'created' | 'updated' | 'unchanged', or { error }. With
// `dryRun` it validates and reports the action without writing.
async function backfillDay(orgId, adminUserId, membership, { date, status, check_in_time, check_out_time, reason }, { dryRun = false } = {}) {
  if (date > todayIst()) return { error: 'future_date' };
  if (membership.joined_at && date < membership.joined_at) return { error: 'before_joining' };
  if (status !== 'leave' && (await leaveService.leaveDayFor(orgId, membership.id, date))) return { error: 'leave_day' };

  const timed = TIMED_STATUSES.has(status);
  if (timed && check_out_time && !check_in_time) return { error: 'checkout_without_checkin' };
  const timeZone = membership.org?.timezone || 'Asia/Kolkata';
  const check_in_at = timed && check_in_time ? wallTimeToInstant(date, check_in_time, timeZone) : null;
  let check_out_at = timed && check_out_time ? wallTimeToInstant(date, check_out_time, timeZone) : null;
  // A check-out earlier than the check-in is an overnight shift ending next day.
  if (check_in_at && check_out_at && check_out_at <= check_in_at) check_out_at = new Date(check_out_at.getTime() + 86400000);

  const data = {
    status,
    check_in_at,
    check_out_at,
    late_minutes: check_in_at ? computeLateMinutes(membership.shift, check_in_at, timeZone) : null,
    overtime_minutes: check_in_at && check_out_at ? computeOvertimeMinutes(membership.shift, check_in_at, check_out_at) : null,
    regularized_by: adminUserId,
    regularized_reason: reason,
  };

  const existing = await prisma.attendanceRecord.findFirst({ where: { org_id: orgId, org_membership_id: membership.id, date } });
  if (existing && existing.status === status && sameInstant(existing.check_in_at, check_in_at) && sameInstant(existing.check_out_at, check_out_at)) {
    return { record: existing, action: 'unchanged' };
  }
  const action = existing ? 'updated' : 'created';
  if (dryRun) return { record: null, action };

  const record = existing
    ? await prisma.attendanceRecord.update({ where: { id: existing.id }, data })
    : await prisma.attendanceRecord.create({ data: { ...data, org_id: orgId, org_membership_id: membership.id, date, source: 'manual' } });
  // Same as a regularisation: a locked month is flagged, never rewritten.
  await detectFinanceChange(orgId, {
    source_type: 'attendance',
    source_id: record.id,
    date,
    org_membership_id: membership.id,
    changed_by: adminUserId,
    description: `Attendance ${existing ? 'corrected' : 'backfilled'}: ${existing?.status || 'no record'} → ${status}${reason ? ` (${reason})` : ''}`.slice(0, 500),
    old_value: existing ? { status: existing.status, check_in_at: existing.check_in_at, check_out_at: existing.check_out_at } : { status: 'no_record' },
    new_value: { status: record.status, check_in_at: record.check_in_at, check_out_at: record.check_out_at },
  });
  return { record, action };
}

async function recordManualDay(orgId, adminUserId, { org_membership_id, ...entry }) {
  const membership = await loadMembershipForBackfill(orgId, org_membership_id);
  if (!membership) return { error: 'membership_not_found' };
  return backfillDay(orgId, adminUserId, membership, entry);
}

const IMPORT_ERRORS = {
  future_date: 'Date is in the future',
  before_joining: 'Date is before the employee joined',
  leave_day: 'Employee is on approved leave that day — use status "leave"',
  checkout_without_checkin: 'Check-out given without a check-in',
};

// Bulk backfill. Employees are matched by employee code or email. Rows with
// a blank status are skipped (so a prefilled template can be uploaded as is).
// Every row is checked first; nothing is written if any row has an error, so a
// sheet is applied all-or-nothing and can simply be fixed and re-uploaded.
async function importAttendance(orgId, adminUserId, { rows, reason, dry_run }) {
  const memberships = await prisma.orgMembership.findMany({
    where: { org_id: orgId },
    select: { id: true, employee_code: true, joined_at: true, shift: true, org: { select: { timezone: true } }, person: { select: { name: true, email: true } } },
  });
  const byKey = new Map();
  for (const m of memberships) {
    if (m.employee_code) byKey.set(m.employee_code.trim().toLowerCase(), m);
    if (m.person?.email) byKey.set(m.person.email.trim().toLowerCase(), m);
  }

  const errors = [];
  const valid = [];
  const seen = new Set();
  let skipped = 0;
  rows.forEach((row, index) => {
    const line = index + 2; // Row 1 of the sheet is the header.
    const status = row.status.toLowerCase().replace(/[\s-]+/g, '_');
    if (!status) { skipped += 1; return; }
    const fail = (message) => errors.push({ row: line, employee: row.employee, date: row.date, message });
    const membership = byKey.get(row.employee.toLowerCase());
    if (!membership) return fail('Employee not found — use their employee code or email');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || Number.isNaN(new Date(`${row.date}T00:00:00.000Z`).getTime())) return fail('Date must be YYYY-MM-DD');
    if (!STATUSES.has(status)) return fail(`Unknown status "${row.status}" — use present, absent, half_day, leave, holiday or wfh`);
    const timeOk = (t) => !t || /^([01]?\d|2[0-3]):[0-5]\d$/.test(t);
    if (!timeOk(row.check_in) || !timeOk(row.check_out)) return fail('Times must be HH:MM (24-hour)');
    const key = `${membership.id}|${row.date}`;
    if (seen.has(key)) return fail('Same employee and date appears more than once');
    seen.add(key);
    valid.push({ line, row, membership, entry: { date: new Date(`${row.date}T00:00:00.000Z`), status, check_in_time: row.check_in || null, check_out_time: row.check_out || null, reason } });
  });

  // Business checks (future, before joining, leave day) — without writing.
  const counts = { created: 0, updated: 0, unchanged: 0 };
  for (const item of valid) {
    const result = await backfillDay(orgId, adminUserId, item.membership, item.entry, { dryRun: true });
    if (result.error) errors.push({ row: item.line, employee: item.row.employee, date: item.row.date, message: IMPORT_ERRORS[result.error] || result.error });
    else counts[result.action] += 1;
  }

  const summary = { total: rows.length, skipped, errors: errors.sort((a, b) => a.row - b.row), ...counts, applied: false };
  if (dry_run || errors.length) return summary;

  for (const item of valid) await backfillDay(orgId, adminUserId, item.membership, item.entry);
  return { ...summary, applied: true };
}

// Prefilled sheet rows for a department and date range: one row per employee
// per day up to today (from their joining date), carrying the status/times
// already recorded — approved leave shows as "leave" — so the admin only fills gaps.
async function importTemplate(orgId, { from, to, department_id }) {
  const today = todayIst();
  const end = to > today ? today : to;
  const memberships = await prisma.orgMembership.findMany({
    where: { org_id: orgId, employment_status: { notIn: ['terminated', 'pending_onboarding'] }, ...(department_id ? { department_id } : {}) },
    select: { id: true, employee_code: true, joined_at: true, org: { select: { timezone: true } }, person: { select: { name: true, email: true } }, department: { select: { name: true } } },
    orderBy: { person: { name: 'asc' } },
  });
  if (!memberships.length || end < from) return [];
  const ids = memberships.map((m) => m.id);
  const [records, leaves] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { org_id: orgId, org_membership_id: { in: ids }, date: { gte: from, lte: end } } }),
    prisma.leaveRequest.findMany({ where: { org_id: orgId, org_membership_id: { in: ids }, status: 'approved', is_half_day: false, from_date: { lte: end }, to_date: { gte: from } }, select: { org_membership_id: true, from_date: true, to_date: true } }),
  ]);
  const recordByKey = new Map(records.map((r) => [`${r.org_membership_id}|${ymd(r.date)}`, r]));
  const hhmm = (instant, timeZone) => (instant ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant) : '');

  const out = [];
  for (const m of memberships) {
    const timeZone = m.org?.timezone || 'Asia/Kolkata';
    for (let d = new Date(from); d <= end; d = new Date(d.getTime() + 86400000)) {
      if (m.joined_at && d < m.joined_at) continue;
      const record = recordByKey.get(`${m.id}|${ymd(d)}`);
      const onLeave = leaves.some((l) => l.org_membership_id === m.id && l.from_date <= d && l.to_date >= d);
      out.push({
        employee: m.employee_code || m.person?.email || '',
        name: m.person?.name || '',
        department: m.department?.name || '',
        date: ymd(d),
        day: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        status: record?.status || (onLeave ? 'leave' : ''),
        check_in: hhmm(record?.check_in_at, timeZone),
        check_out: hhmm(record?.check_out_at, timeZone),
      });
    }
  }
  return out;
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

module.exports = {
  deleteRecord,
  checkIn,
  checkOut,
  listMine,
  listTeam,
  regularize,
  recordManualDay,
  importAttendance,
  importTemplate,
  listShifts,
  createShift,
  computeLateMinutes,
  wallTimeToInstant,
};
