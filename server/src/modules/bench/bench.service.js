const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');

// Bench: a free period between projects. People -> bench start date; the end defaults to start + 30 days. Someone who is
// allocated to a project today is NOT on the bench, whatever the dates say (the dates stay as a record).
const BENCH_DAYS = 30;
const DAY = 86400000;
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : null);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);

/** Called from updateMembership: fills the end date (start + 30 days) and refuses an end before the start. Mutates `data`. */
function normalizeBench(membership, data) {
  if (data.bench_start_date === undefined && data.bench_end_date === undefined) return {};
  if (data.bench_start_date === null) {
    data.bench_end_date = null;
    return {};
  }
  const start = data.bench_start_date !== undefined ? data.bench_start_date : membership.bench_start_date;
  let end = data.bench_end_date !== undefined ? data.bench_end_date : membership.bench_end_date;
  if (start && data.bench_end_date === undefined && (data.bench_start_date !== undefined || !end)) end = addDays(start, BENCH_DAYS);
  if (end && !start) return { error: 'bench_end_without_start' };
  if (start && end && end < start) return { error: 'bench_end_before_start' };
  if (end !== undefined) data.bench_end_date = end;
  return {};
}

/** Ids (of the given memberships) that hold a project allocation covering `today`. */
async function allocatedIds(orgId, ids, today) {
  if (!ids.length) return new Set();
  const rows = await prisma.projectMemberAssignment.findMany({
    where: { org_id: orgId, org_membership_id: { in: ids }, AND: [{ OR: [{ start_date: null }, { start_date: { lte: today } }] }, { OR: [{ end_date: null }, { end_date: { gte: today } }] }] },
    select: { org_membership_id: true },
  });
  return new Set(rows.map((r) => r.org_membership_id));
}

/** Everyone currently on the bench in a company, with the days left. */
async function onBench(orgId, { today = todayIst() } = {}) {
  const people = await prisma.orgMembership.findMany({
    where: { org_id: orgId, employment_status: { in: ['active', 'on_leave'] }, bench_start_date: { lte: today }, OR: [{ bench_end_date: null }, { bench_end_date: { gte: today } }] },
    select: { id: true, person_id: true, employee_code: true, bench_start_date: true, bench_end_date: true, person: { select: { name: true } }, department: { select: { name: true } }, designation: { select: { name: true } } },
    orderBy: { bench_end_date: 'asc' },
  });
  const busy = await allocatedIds(orgId, people.map((p) => p.id), today);
  return people.filter((p) => !busy.has(p.id)).map((p) => ({
    org_membership_id: p.id,
    person_id: p.person_id,
    name: p.person?.name || null,
    employee_code: p.employee_code,
    department: p.department?.name || null,
    designation: p.designation?.name || null,
    bench_start_date: ymd(p.bench_start_date),
    bench_end_date: ymd(p.bench_end_date),
    days_left: p.bench_end_date ? Math.round((p.bench_end_date - today) / DAY) : null,
  }));
}

/** True when the signed-in person is on the bench today or serving notice (the only people who may apply for an internal job). */
async function canApplyInternally(orgId, orgMembershipId, { today = todayIst() } = {}) {
  if (!orgMembershipId) return false;
  const m = await prisma.orgMembership.findFirst({ where: { id: orgMembershipId, org_id: orgId }, select: { id: true, employment_status: true, bench_start_date: true, bench_end_date: true } });
  if (!m) return false;
  if (m.employment_status === 'notice_period') return true;
  if (!['active', 'on_leave'].includes(m.employment_status) || !m.bench_start_date || m.bench_start_date > today || (m.bench_end_date && m.bench_end_date < today)) return false;
  return !(await allocatedIds(orgId, [m.id], today)).has(m.id);
}

const COUNTDOWN_DAYS = [30, 15, 7, 3, 1, 0];

/** Nightly: tell the person and the admins how many bench days are left (30, 15, 7, 3, 1 and the last day). Once a day per person. */
async function notifyCountdowns({ today = todayIst() } = {}) {
  const { notify } = require('../../lib/notifications');
  const orgs = await prisma.org.findMany({ where: { status: 'active' }, select: { id: true } });
  let sent = 0;
  for (const org of orgs) {
    for (const p of await onBench(org.id, { today })) {
      if (p.days_left === null || !COUNTDOWN_DAYS.includes(p.days_left)) continue;
      const already = await prisma.notification.count({ where: { type: 'bench_countdown', user_id: p.person_id, created_at: { gte: today }, metadata: { path: ['org_membership_id'], equals: p.org_membership_id } } });
      if (already) continue;
      await notify(prisma, { type: 'bench_countdown', recipientIds: [p.person_id], context: { employeeName: p.name, daysLeft: p.days_left, endDate: p.bench_end_date, metadata: { org_membership_id: p.org_membership_id } } });
      sent += 1;
    }
  }
  return { sent };
}

module.exports = { BENCH_DAYS, normalizeBench, onBench, canApplyInternally, notifyCountdowns, allocatedIds };
