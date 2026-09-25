const prisma = require('../../config/db');

const DEFAULT_LEAVE_TYPES = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Casual Leave', paid: true, annual_quota: 12 },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Sick Leave', paid: true, annual_quota: 12 },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Earned Leave', paid: true, annual_quota: 18 },
  { id: '00000000-0000-4000-8000-000000000004', name: 'Unpaid Leave', paid: false, annual_quota: 0 },
];

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
// Days are counted the way requestedDays() and payroll count them: calendar
// days, inclusive, a half day being 0.5.
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

const KNOWN_CODES = { 'casual leave': 'CL', 'earned leave': 'EL', 'sick leave': 'SL', 'unpaid leave': 'UL' };

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

function overlapDays(from, to, lo, hi) {
  const start = Math.max(from.getTime(), lo.getTime());
  const end = Math.min(to.getTime(), hi.getTime());
  return end < start ? 0 : Math.round((end - start) / DAY_MS) + 1;
}

// used / upcoming / pending days of one leave type's requests within `year`, as
// of `today`. Pure — the unit tests drive it directly.
function summariseUsage(requests, { year, today }) {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const asOf = today > yearEnd ? yearEnd : today; // a past year is complete; a future year has nothing taken yet
  let used = 0;
  let upcoming = 0;
  let pending = 0;
  for (const r of requests) {
    if (r.status !== 'approved' && r.status !== 'pending') continue;
    const inYear = overlapDays(r.from_date, r.to_date, yearStart, yearEnd);
    if (inYear === 0) continue;
    const days = r.is_half_day ? 0.5 : inYear;
    if (r.status === 'pending') {
      pending += days;
    } else if (r.is_half_day) {
      if (r.from_date <= asOf) used += days;
      else upcoming += days;
    } else {
      const taken = overlapDays(r.from_date, r.to_date, yearStart, asOf);
      used += taken;
      upcoming += inYear - taken;
    }
  }
  return { used, upcoming, pending };
}

// The employee's entitlement for a type/year: the admin-set figure if there is
// one, else the legacy accrued value, else the type's annual quota. null = no cap.
function entitlementFor(leaveType, balance) {
  if (balance && balance.allocated !== null && balance.allocated !== undefined) return Number(balance.allocated);
  if (balance && Number(balance.accrued) > 0) return Number(balance.accrued);
  return leaveType.annual_quota === null || leaveType.annual_quota === undefined ? null : Number(leaveType.annual_quota);
}

function balanceRow(leaveType, balance, usage, { year, today }) {
  const entitlement = entitlementFor(leaveType, balance);
  // Unpaid leave (and any type with no quota) is uncapped — there is no balance to run out of.
  const unlimited = !leaveType.paid || entitlement === null;
  const allocated = unlimited ? 0 : entitlement;
  return {
    leave_type_id: leaveType.id,
    leave_type_name: leaveType.name,
    code: leaveCode(leaveType.name),
    paid: leaveType.paid,
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
  const [leaveTypes, balances, requests] = await Promise.all([
    prisma.leaveType.findMany({ where: { org_id: orgId }, orderBy: { name: 'asc' } }),
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
  ]);
  const balanceByType = new Map(balances.map((b) => [b.leave_type_id, b]));
  return leaveTypes.map((leaveType) =>
    balanceRow(leaveType, balanceByType.get(leaveType.id), summariseUsage(requests.filter((r) => r.leave_type_id === leaveType.id), { year, today }), { year, today })
  );
}

// Every active employee's counters for the admin dashboard and the leave
// balances screen — one pass over the org's requests, no per-employee queries.
async function balancesOverview(orgId, { year, department_id, search }, today = todayIst()) {
  await ensureDefaultTypes(orgId);
  const range = yearRange(year);
  const [leaveTypes, memberships, balances, requests] = await Promise.all([
    prisma.leaveType.findMany({ where: { org_id: orgId }, orderBy: { name: 'asc' } }),
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

  const employees = memberships.map((m) => ({
    org_membership_id: m.id,
    name: m.person?.name || 'Unknown',
    department: m.department?.name || null,
    balances: leaveTypes.map((leaveType) => {
      const key = keyOf(m.id, leaveType.id);
      return balanceRow(leaveType, balanceByKey.get(key), summariseUsage(requestsByKey.get(key) || [], { year, today }), { year, today });
    }),
  }));

  return {
    year,
    as_of: today.toISOString().slice(0, 10),
    types: leaveTypes.map((t) => ({ id: t.id, name: t.name, code: leaveCode(t.name), paid: t.paid, annual_quota: t.annual_quota })),
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

async function createType(orgId, { name, paid, annual_quota }) {
  const existing = await prisma.leaveType.findUnique({ where: { org_id_name: { org_id: orgId, name } } });
  if (existing) return { error: 'name_taken' };
  const leaveType = await prisma.leaveType.create({ data: { org_id: orgId, name, paid, annual_quota } });
  return { leaveType };
}

// Balance days a request consumes. Same rule the approval step uses when it
// debits the balance (calendar days, inclusive; a half-day is 0.5) — kept in
// one place so the check at request time can't disagree with the debit.
function requestedDays({ from_date, to_date, is_half_day }) {
  return is_half_day ? 0.5 : Math.round((to_date - from_date) / 86400000) + 1;
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
async function remainingPaidDays(orgId, orgMembershipId, leaveType, year) {
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
      },
    }),
  ]);
  const entitlement = entitlementFor(leaveType, balance);
  if (entitlement === null) return Infinity;
  const { used, upcoming, pending } = summariseUsage(requests, { year, today: todayIst() });
  return entitlement - used - upcoming - pending;
}

async function createRequest(
  orgId,
  orgMembershipId,
  { leave_type_id, from_date, to_date, is_half_day, half_day_session, reason }
) {
  const leaveType = await prisma.leaveType.findFirst({ where: { id: leave_type_id, org_id: orgId } });
  if (!leaveType) return { error: 'leave_type_not_found' };

  const overlap = await findOverlap(orgId, orgMembershipId, { from_date, to_date, is_half_day, half_day_session });
  if (overlap) return { error: 'overlaps_existing' };

  if (leaveType.paid) {
    const remaining = await remainingPaidDays(orgId, orgMembershipId, leaveType, from_date.getUTCFullYear());
    const needed = requestedDays({ from_date, to_date, is_half_day });
    if (needed > remaining) return { error: 'insufficient_balance', remaining, needed };
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
  return { request };
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
  return { data, pagination: { page, limit, total } };
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
  return { data, pagination: { page, limit, total } };
}

async function decide(orgId, requestId, approverMembershipId, { status, reason }) {
  const existing = await prisma.leaveRequest.findFirst({ where: { id: requestId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'pending') return { error: 'not_pending' };

  const request = await prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status, approver_id: approverMembershipId, decided_at: new Date(), decision_reason: reason },
  });

  // No balance write: what an employee has used is computed live from their
  // approved requests (see summariseUsage), so approving is only the status change.
  return { request };
}

// Admin authority over a leave that was already granted (or is still pending):
// withdraw it. The days go back to the balance by themselves — it is computed
// from the approved requests — and the leave-day rule stops applying.
async function revoke(orgId, requestId, adminMembershipId, { reason }) {
  const existing = await prisma.leaveRequest.findFirst({ where: { id: requestId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'approved' && existing.status !== 'pending') return { error: 'not_revocable' };
  const request = await prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status: 'cancelled', approver_id: adminMembershipId, decided_at: new Date(), decision_reason: reason || 'Withdrawn by admin' },
  });
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
  return leave ? { leave_type: leave.leave_type.name, from_date: leave.from_date, to_date: leave.to_date } : null;
}

const LEAVE_DAY_MESSAGE = (leave) =>
  `You're on approved ${leave.leave_type} leave on that date — attendance, timesheet and project hours are disabled for leave days`;

module.exports = {
  listTypes,
  listMyBalances,
  balancesOverview,
  setEntitlement,
  createType,
  createRequest,
  listMine,
  listTeam,
  decide,
  revoke,
  cancel,
  leaveDayFor,
  LEAVE_DAY_MESSAGE,
  // exported for tests only
  summariseUsage,
  leaveCode,
  todayIst,
};
