/**
 * READ ONLY. Diagnoses "an employee on approved leave still counts as worked". For one month it lists every
 * (employee, day) covered by approved leave on a weekday and says WHICH of these conditions matched:
 *
 *   auto_present      an automatic Present entry is still on the leave day (the 21 Oct leave-approval fix not applied, or the
 *                     day was in a locked month so it was skipped). Matches both the new `source=auto` and the legacy
 *                     `source=manual, reason=auto_daily` form written before migration 20261021100100.
 *   manual_present    a Present / WFH entry a person created or edited sits on the leave day.
 *   project_hours     non-rejected project timesheet hours on the leave day (split by entry status).
 *   billed_resource   the employee has their OWN monthly billing rate on a project and the project's billing rules pay the
 *                     leave status a non-zero fraction (paid leave default = 1).
 *   billed_contract   the employee is allocated to a monthly-contract project billed on the contract (not approved hours),
 *                     so the day earns the project rate whatever happens (informational: fixed-fee contracts may legitimately bill it).
 *   half_day_hours_over_capacity   a single half-day leave day carries more than half the project day (8h) of hours.
 *
 * Weekends are skipped; company holidays are not (a leave on a holiday is not a real leave day and is rare).
 *
 * Usage:  node server/scripts/leave-hours-diagnostic.js [--year 2026 --month 10] [--org <org_id>] [--list]
 *         --list  also prints every matching row, not just the grouped counts.
 */
const DAY = 86400000;
const PROJECT_DAY_HOURS = 8;
const ymd = (d) => d.toISOString().slice(0, 10);
const DEFAULT_RULES = { pl: 1, npl: 0, comp_off: 1, first_half: 0.5, second_half: 0.5 };

async function diagnose(prisma, { year, month, orgId = null }) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const orgWhere = orgId ? { org_id: orgId } : {};

  const leaves = await prisma.leaveRequest.findMany({
    where: { ...orgWhere, status: 'approved', from_date: { lte: to }, to_date: { gte: from } },
    select: { id: true, org_membership_id: true, from_date: true, to_date: true, is_half_day: true, half_day_session: true, leave_type: { select: { name: true, paid: true } }, org_membership: { select: { person: { select: { name: true } } } } },
  });
  const ids = [...new Set(leaves.map((l) => l.org_membership_id))];
  const [attendance, entries, monthLocks, resourceRates, assignments] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { org_membership_id: { in: ids }, date: { gte: from, lte: to } }, select: { org_membership_id: true, date: true, status: true, source: true, regularized_reason: true, regularized_by: true, check_in_at: true, check_out_at: true } }),
    prisma.timesheetEntry.findMany({ where: { org_membership_id: { in: ids }, date: { gte: from, lte: to }, status: { not: 'rejected' } }, select: { org_membership_id: true, date: true, hours: true, overtime_hours: true, status: true, account_id: true } }),
    prisma.timesheetMonthLock.findMany({ where: { org_membership_id: { in: ids }, period_year: year, period_month: month }, select: { org_membership_id: true } }),
    prisma.resourceBillingRate.findMany({ where: { org_membership_id: { in: ids } }, select: { org_membership_id: true, account_id: true, rate_type: true, effective_from: true } }),
    prisma.projectMemberAssignment.findMany({
      where: { org_membership_id: { in: ids }, AND: [{ OR: [{ end_date: null }, { end_date: { gte: from } }] }, { OR: [{ start_date: null }, { start_date: { lte: to } }] }] },
      select: { org_membership_id: true, account_id: true, start_date: true, end_date: true, account: { select: { name: true, project_name: true, client_billing_basis: true, agreement_start_date: true, agreement_end_date: true, service_category: true, billing_rates: { select: { rate_type: true, requirement_id: true } } } } },
    }),
  ]);
  const rateAccounts = new Map((await prisma.account.findMany({ where: { id: { in: [...new Set(resourceRates.map((r) => r.account_id))] } }, select: { id: true, name: true, project_name: true, billing_leave_rules: true } })).map((a) => [a.id, a]));
  const locked = new Set(monthLocks.map((l) => l.org_membership_id));
  const key = (id, d) => `${id}|${ymd(d)}`;
  const attBy = new Map(attendance.map((a) => [key(a.org_membership_id, a.date), a]));
  const entBy = new Map();
  for (const e of entries) { const k = key(e.org_membership_id, e.date); entBy.set(k, [...(entBy.get(k) || []), e]); }
  const label = (a) => a?.project_name || a?.name || 'project';
  const isAutoPresent = (a) => a && ['present', 'half_day', 'wfh'].includes(a.status)
    && (a.source === 'auto' || (a.source === 'manual' && a.regularized_reason === 'auto_daily' && !a.regularized_by && !a.check_in_at && !a.check_out_at));

  // one (employee, day) -> the leaves covering it
  const days = new Map();
  for (const l of leaves) {
    for (let d = new Date(Math.max(l.from_date, from)); d <= Math.min(l.to_date, to); d = new Date(d.getTime() + DAY)) {
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      const k = key(l.org_membership_id, d);
      if (!days.has(k)) days.set(k, { id: l.org_membership_id, name: l.org_membership?.person?.name || 'Unknown', date: new Date(d), leaves: [] });
      days.get(k).leaves.push(l);
    }
  }

  const groups = {};
  const matched = new Set();
  const hit = (name, k, row) => { (groups[name] ||= []).push(row); matched.add(k); };
  let fullDays = 0;
  let halfDays = 0;

  for (const [k, day] of days) {
    const full = day.leaves.some((l) => !l.is_half_day) || day.leaves.length >= 2;
    const leaveName = day.leaves.map((l) => `${l.leave_type.name}${l.is_half_day ? ' (half)' : ''}`).join(' + ');
    const base = { employee: day.name, date: ymd(day.date), leave: leaveName, month_locked: locked.has(day.id) };
    const att = attBy.get(k);
    const hours = entBy.get(k) || [];
    const total = hours.reduce((s, e) => s + Number(e.hours) + Number(e.overtime_hours || 0), 0);
    if (full) {
      fullDays += 1;
      if (isAutoPresent(att)) hit('auto_present', k, { ...base, attendance: `${att.status} (${att.source})` });
      else if (att && ['present', 'wfh', 'half_day'].includes(att.status)) hit('manual_present', k, { ...base, attendance: `${att.status} (${att.source})` });
      if (total > 0) {
        const byStatus = {};
        for (const e of hours) byStatus[e.status] = (byStatus[e.status] || 0) + Number(e.hours) + Number(e.overtime_hours || 0);
        hit('project_hours', k, { ...base, hours: total, by_status: JSON.stringify(byStatus) });
      }
      const compOff = day.leaves.some((l) => String(l.leave_type.name).trim().toLowerCase() === 'comp off');
      const paid = day.leaves.every((l) => l.leave_type.paid);
      const status = compOff ? 'comp_off' : paid ? 'pl' : 'npl';
      for (const r of resourceRates) {
        if (r.org_membership_id !== day.id || r.rate_type !== 'monthly' || r.effective_from > day.date) continue;
        const rules = { ...DEFAULT_RULES, ...(rateAccounts.get(r.account_id)?.billing_leave_rules || {}) };
        const fraction = Number(rules[status] ?? 0);
        if (fraction > 0) hit('billed_resource', k, { ...base, project: label(rateAccounts.get(r.account_id)), status, billed_fraction: fraction });
      }
      for (const a of assignments) {
        if (a.org_membership_id !== day.id) continue;
        if ((a.start_date && a.start_date > day.date) || (a.end_date && a.end_date < day.date)) continue;
        const acc = a.account;
        if (!acc || acc.service_category === 'project') continue;
        if ((acc.agreement_start_date && acc.agreement_start_date > day.date) || (acc.agreement_end_date && acc.agreement_end_date < day.date)) continue;
        const monthly = acc.billing_rates.some((b) => b.rate_type === 'monthly' && !b.requirement_id);
        if (monthly && acc.client_billing_basis !== 'approved_hours' && !resourceRates.some((r) => r.org_membership_id === day.id && r.account_id === a.account_id)) {
          hit('billed_contract', k, { ...base, project: label(acc) });
        }
      }
    } else {
      halfDays += 1;
      if (total > PROJECT_DAY_HOURS / 2 + 1e-9) hit('half_day_hours_over_capacity', k, { ...base, hours: total, allowed: PROJECT_DAY_HOURS / 2 });
    }
  }
  // "clean" ignores the informational billed_contract group
  const problemKeys = new Set();
  for (const [name, list] of Object.entries(groups)) {
    if (name === 'billed_contract') continue;
    for (const r of list) problemKeys.add(`${r.employee}|${r.date}`);
  }
  return { year, month, leave_requests: leaves.length, leave_days: days.size, full_days: fullDays, half_days: halfDays, groups, clean_days: days.size - problemKeys.size };
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
  const listAll = process.argv.includes('--list');
  const orgId = arg('org', null);
  try {
    const r = await diagnose(prisma, { year: Number(arg('year', 2026)), month: Number(arg('month', 10)), orgId });
    console.log(`Month ${r.year}-${String(r.month).padStart(2, '0')}${orgId ? ` org ${orgId}` : ' (all orgs)'}`);
    console.log(`Approved leave requests overlapping the month: ${r.leave_requests}; weekday leave days: ${r.leave_days} (${r.full_days} full-day, ${r.half_days} half-day)\n`);
    const summary = Object.entries(r.groups).map(([condition, list]) => ({
      condition, days: list.length, employees: new Set(list.map((x) => x.employee)).size, in_locked_month: list.filter((x) => x.month_locked).length,
    }));
    if (summary.length) console.table(summary); else console.log('No leave day matched any condition.');
    console.log(`Leave days with no problem condition (clean): ${r.clean_days}`);
    for (const [condition, list] of Object.entries(r.groups)) {
      console.log(`\n== ${condition} (${list.length}) ==`);
      console.table(listAll ? list : list.slice(0, 25));
      if (!listAll && list.length > 25) console.log(`... ${list.length - 25} more (use --list)`);
    }
    console.log('\nbilled_contract is informational: a fixed monthly fee may legitimately bill every working day.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { diagnose };
