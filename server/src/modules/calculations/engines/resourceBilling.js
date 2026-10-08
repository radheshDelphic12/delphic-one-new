// Per-resource billing inside a project month.
//
// A project bills with its own rate (BillingRate). A resource can ALSO have a rate of its own
// (ResourceBillingRate), so in one month Developer A can be billed monthly and Developer B hourly
// on the same project. A resource without its own rate is billed by the project's rate as before.
//
//   hourly:  approved project hours x the resource's hourly rate (no attendance, no cap); overtime
//            hours (approved OT) x rate x the project's overtime multiplier, where OT is billable.
//   monthly: the resource's monthly rate / the project's working days, per working day inside the
//            contract, x the fraction its CLIENT BILLING STATUS earns that day (see DEFAULT_RULES):
//            present, present + OT, paid leave (PL), non-paid leave (NPL), comp off, full day (the
//            billable day's hours), first half (FH), second half (SH), half day. OT is added
//            separately (approved OT hours x rate / benchmark hours x multiplier).
//
// Client billing leave rules are their own configuration (Account.billing_leave_rules) and never read
// or change the employee's salary leave rules.

const prisma = require('../../../config/db');
const { ymd } = require('../period');

// Fraction of a working day's rate billed per status. Overridable per project.
const DEFAULT_RULES = {
  present: 1,
  full_day: 1,
  half_day: 0.5,
  pl: 1,
  npl: 0,
  comp_off: 1,
  first_half: 0.5,
  second_half: 0.5,
  absent: 0,
};

const STATUS_LABELS = {
  present: 'Present',
  present_ot: 'Present + OT',
  full_day: 'Full day',
  half_day: 'Half day',
  pl: 'Paid leave (PL)',
  npl: 'Non-paid leave (NPL)',
  comp_off: 'Comp off',
  first_half: 'First half (FH)',
  second_half: 'Second half (SH)',
  absent: 'Absent',
};

function rulesFor(account) {
  const custom = account?.billing_leave_rules && typeof account.billing_leave_rules === 'object' ? account.billing_leave_rules : {};
  const rules = { ...DEFAULT_RULES };
  for (const [key, value] of Object.entries(custom)) {
    if (key in DEFAULT_RULES && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1) rules[key] = Number(value);
  }
  return rules;
}

// The rate in force for a resource on a date (several rows on one date: the last added).
function resourceRateOn(rates, membershipId, date) {
  return rates
    .filter((r) => r.org_membership_id === membershipId && r.effective_from <= date)
    .sort((a, b) => b.effective_from - a.effective_from || b.created_at - a.created_at)[0] || null;
}

// Everything needed to bill the project's own-rate resources: their rates, attendance and approved leave.
async function load(orgId, accountId, start, end) {
  const rates = await prisma.resourceBillingRate.findMany({
    where: { org_id: orgId, account_id: accountId },
    select: { id: true, org_membership_id: true, rate_type: true, rate: true, currency: true, effective_from: true, created_at: true },
  });
  const ids = [...new Set(rates.map((r) => r.org_membership_id))];
  if (!ids.length) return { rates, attendance: new Map(), leaves: [], names: new Map() };
  const [attendance, leaves, members] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { org_id: orgId, org_membership_id: { in: ids }, date: { gte: start, lte: end } }, select: { org_membership_id: true, date: true, status: true } }),
    prisma.leaveRequest.findMany({
      where: { org_id: orgId, org_membership_id: { in: ids }, status: 'approved', from_date: { lte: end }, to_date: { gte: start } },
      select: { org_membership_id: true, from_date: true, to_date: true, is_half_day: true, half_day_session: true, leave_type: { select: { name: true, paid: true } } },
    }),
    prisma.orgMembership.findMany({ where: { id: { in: ids } }, select: { id: true, worker_type: true, person: { select: { name: true } } } }),
  ]);
  return {
    rates,
    attendance: new Map(attendance.map((a) => [`${a.org_membership_id}|${ymd(a.date)}`, a.status])),
    leaves,
    names: new Map(members.map((m) => [m.id, { name: m.person?.name || 'Unknown', worker_type: m.worker_type }])),
  };
}

// The client billing status of a resource on a working day (monthly billing).
function statusFor({ membershipId, date, data, approvedHours, overtimeHours, dayHours }) {
  const key = ymd(date);
  const onLeave = data.leaves.filter((l) => l.org_membership_id === membershipId && l.from_date <= date && l.to_date >= date);
  const full = onLeave.find((l) => !l.is_half_day);
  if (full) {
    if (String(full.leave_type.name).trim().toLowerCase() === 'comp off') return 'comp_off';
    return full.leave_type.paid ? 'pl' : 'npl';
  }
  const half = onLeave.find((l) => l.is_half_day);
  if (half) return half.half_day_session === 'SECOND_HALF' ? 'second_half' : 'first_half';
  const attendance = data.attendance.get(`${membershipId}|${key}`);
  if (attendance === 'half_day') return 'half_day';
  if (attendance === 'absent') return 'absent';
  const present = attendance === 'present' || attendance === 'wfh' || approvedHours > 0;
  if (!present) return 'absent';
  if (overtimeHours > 0) return 'present_ot';
  return approvedHours >= dayHours ? 'full_day' : 'present';
}

const fractionOf = (rules, status) => (status === 'present_ot' ? rules.present : rules[status] ?? 0);

module.exports = { DEFAULT_RULES, STATUS_LABELS, rulesFor, resourceRateOn, load, statusFor, fractionOf };
