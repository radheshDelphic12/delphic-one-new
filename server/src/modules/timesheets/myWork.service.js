const { z } = require('zod');
const prisma = require('../../config/db');

// Dashboard > My projects: for the signed-in person, the projects they are allocated to in a week / month / quarter / year, and the hours
// they logged on each, split into parts (a week by day, a month by week, a quarter or a year by month). Their own data only.

const querySchema = z.object({
  period: z.enum(['week', 'month', 'quarter', 'year']).default('week'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const D = (s) => new Date(`${s}T00:00:00Z`);
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The period around a day, and its parts. */
function periodOf(period, anchor) {
  const y = anchor.getUTCFullYear(); const m = anchor.getUTCMonth();
  if (period === 'week') {
    const from = addDays(anchor, -((anchor.getUTCDay() + 6) % 7)); // Monday
    const to = addDays(from, 6);
    const parts = Array.from({ length: 7 }, (_, i) => { const d = addDays(from, i); return { key: ymd(d), label: `${WD[d.getUTCDay()]} ${d.getUTCDate()}`, from: d, to: d }; });
    return { from, to, parts, label: `Week of ${from.getUTCDate()} ${MON[from.getUTCMonth()]} ${from.getUTCFullYear()}` };
  }
  if (period === 'month') {
    const from = new Date(Date.UTC(y, m, 1)); const to = new Date(Date.UTC(y, m + 1, 0));
    const parts = [];
    for (let s = from; s <= to;) {
      const e = new Date(Math.min(addDays(s, 6 - ((s.getUTCDay() + 6) % 7)).getTime(), to.getTime())); // to the Sunday, or the month end
      parts.push({ key: ymd(s), label: s.getTime() === e.getTime() ? `${s.getUTCDate()} ${MON[m]}` : `${s.getUTCDate()}-${e.getUTCDate()} ${MON[m]}`, from: s, to: e });
      s = addDays(e, 1);
    }
    return { from, to, parts, label: `${MON[m]} ${y}` };
  }
  const months = period === 'quarter' ? [Math.floor(m / 3) * 3, Math.floor(m / 3) * 3 + 1, Math.floor(m / 3) * 3 + 2] : Array.from({ length: 12 }, (_, i) => i);
  const parts = months.map((mm) => ({ key: `${y}-${String(mm + 1).padStart(2, '0')}`, label: `${MON[mm]} ${y}`, from: new Date(Date.UTC(y, mm, 1)), to: new Date(Date.UTC(y, mm + 1, 0)) }));
  return { from: parts[0].from, to: parts[parts.length - 1].to, parts, label: period === 'quarter' ? `Q${Math.floor(m / 3) + 1} ${y}` : String(y) };
}

async function myWork(user, { period, date }) {
  const membershipId = user.org_membership_id;
  if (!membershipId) return { error: 'membership_required' };
  const p = periodOf(period, date ? D(date) : D(ymd(new Date())));
  const [assignments, entries] = await Promise.all([
    prisma.projectMemberAssignment.findMany({
      where: { org_membership_id: membershipId, OR: [{ start_date: null }, { start_date: { lte: p.to } }], AND: [{ OR: [{ end_date: null }, { end_date: { gte: p.from } }] }] },
      select: { account_id: true, start_date: true, end_date: true, allocation_percent: true, billable_hours_per_day: true, account: { select: { id: true, name: true, project_name: true, client_name: true } } },
    }),
    prisma.timesheetEntry.findMany({
      where: { org_membership_id: membershipId, date: { gte: p.from, lte: p.to }, status: { not: 'rejected' } },
      select: { account_id: true, date: true, hours: true, overtime_hours: true, status: true, account: { select: { id: true, name: true, project_name: true, client_name: true } } },
    }),
  ]);
  const projects = new Map();
  const ensure = (acc) => {
    if (!projects.has(acc.id)) projects.set(acc.id, { id: acc.id, name: acc.project_name || acc.name, client: acc.client_name || null, allocated: false, allocation: null, hours: 0, approved_hours: 0, by_part: {} });
    return projects.get(acc.id);
  };
  for (const a of assignments) {
    const row = ensure(a.account);
    row.allocated = true;
    row.allocation = { from: a.start_date ? ymd(a.start_date) : null, to: a.end_date ? ymd(a.end_date) : null, percent: a.allocation_percent == null ? null : Number(a.allocation_percent) };
  }
  const partOf = (d) => p.parts.find((x) => d >= x.from && d <= x.to);
  for (const e of entries) {
    if (!e.account) continue;
    const row = ensure(e.account);
    const h = Number(e.hours) + Number(e.overtime_hours || 0);
    row.hours += h;
    if (e.status === 'approved') row.approved_hours += h;
    const part = partOf(e.date);
    if (part) row.by_part[part.key] = round2((row.by_part[part.key] || 0) + h);
  }
  const rows = [...projects.values()].map((r) => ({ ...r, hours: round2(r.hours), approved_hours: round2(r.approved_hours) }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
  const totals = Object.fromEntries(p.parts.map((x) => [x.key, round2(rows.reduce((s, r) => s + (r.by_part[x.key] || 0), 0))]));
  return {
    period, label: p.label, from: ymd(p.from), to: ymd(p.to),
    previous: ymd(addDays(p.from, -1)), next: ymd(addDays(p.to, 1)),
    parts: p.parts.map((x) => ({ key: x.key, label: x.label })),
    projects: rows, totals, total_hours: round2(rows.reduce((s, r) => s + r.hours, 0)),
  };
}

module.exports = { querySchema, myWork, periodOf };
