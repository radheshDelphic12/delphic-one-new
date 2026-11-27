const { z } = require('zod');
const prisma = require('../../config/db');
const { decide } = require('../../lib/permissions');
const workHours = require('./workHours.service');
const { visibleMembers } = require('./dashboard.service');

// Time & Attendance > Timesheet gaps: one table for a whole month. A row per person and project they are allocated to, a column per day:
// the hours logged on that project that day, or a gap where it was a working day for them (not a holiday, not a full day of approved
// leave), inside the allocation, up to today, and nothing was logged on that project. Sorted by the most gaps first.

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  project_id: z.string().uuid().optional(),
  only_gaps: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
});

const ymd = (d) => d.toISOString().slice(0, 10);
const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Everyone for admins and holders of Timesheets > View; otherwise the person and their direct reports. */
async function membersFor(orgId, user) {
  const wide = user.role === 'admin' || decide(user, 'timesheets.view') === true;
  if (wide) return visibleMembers(orgId, { ...user, role: 'admin' });
  return visibleMembers(orgId, user);
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

async function missingMatrix(orgId, user, { year, month, project_id, only_gaps }) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const today = ymd(new Date());
  const dates = [];
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) dates.push({ date: ymd(d), weekday: d.getUTCDay() });

  const members = await membersFor(orgId, user);
  const byId = new Map(members.map((m) => [m.id, m]));
  const assignments = await prisma.projectMemberAssignment.findMany({
    where: {
      org_id: orgId, org_membership_id: { in: members.map((m) => m.id) }, ...(project_id ? { account_id: project_id } : {}),
      OR: [{ start_date: null }, { start_date: { lte: to } }],
      AND: [{ OR: [{ end_date: null }, { end_date: { gte: from } }] }],
    },
    select: { org_membership_id: true, account_id: true, start_date: true, end_date: true, account: { select: { id: true, name: true, project_name: true } } },
  });
  if (!assignments.length) return { year, month, dates, rows: [], projects: [], summary: { rows: 0, with_gaps: 0, gap_days: 0 } };

  const memberIds = [...new Set(assignments.map((a) => a.org_membership_id))];
  const [entries, daysByMember] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, org_membership_id: { in: memberIds }, date: { gte: from, lte: to }, status: { not: 'rejected' } },
      select: { org_membership_id: true, account_id: true, date: true, hours: true, overtime_hours: true },
    }),
    // each person's own days: their calendar's holidays and their approved leave decide which days were working days
    inBatches(memberIds, 6, async (id) => [id, await workHours.daySummaries(orgId, id, from, to)]),
  ]);
  const workDay = new Map(daysByMember.map(([id, days]) => [id, new Map((Array.isArray(days) ? days : days?.days || []).map((d) => [d.date, d]))]));
  const logged = new Map(); // member|project|date -> hours
  for (const e of entries) {
    const k = `${e.org_membership_id}|${e.account_id}|${ymd(e.date)}`;
    logged.set(k, (logged.get(k) || 0) + Number(e.hours) + Number(e.overtime_hours || 0));
  }

  const rows = assignments.map((a) => {
    const member = byId.get(a.org_membership_id);
    const start = a.start_date ? ymd(a.start_date) : '0000-00-00';
    const end = a.end_date ? ymd(a.end_date) : '9999-12-31';
    const mine = workDay.get(a.org_membership_id) || new Map();
    const days = {};
    const gaps = [];
    let total = 0;
    for (const { date } of dates) {
      const hours = logged.get(`${a.org_membership_id}|${a.account_id}|${date}`) || 0;
      total += hours;
      const info = mine.get(date);
      const inAllocation = date >= start && date <= end;
      const working = Boolean(info) && info.day_type === 'working' && Number(info.expected) > 0;
      let state = 'off';
      if (!inAllocation) state = 'not_allocated';
      else if (hours > 0) state = 'logged';
      else if (date > today) state = working ? 'future' : 'off';
      else if (info?.leave && Number(info.expected) === 0) state = 'leave';
      else if (working) { state = 'gap'; gaps.push(date); }
      days[date] = { hours: round2(hours), state };
    }
    return {
      key: `${a.org_membership_id}|${a.account_id}`,
      org_membership_id: a.org_membership_id,
      name: member?.person?.name || 'Unknown',
      department: member?.person?.department?.name || null,
      project: { id: a.account_id, name: a.account.project_name || a.account.name },
      days, gap_days: gaps, gap_count: gaps.length, logged_hours: round2(total),
    };
  });
  const shown = (only_gaps ? rows.filter((r) => r.gap_count > 0) : rows)
    .sort((x, y) => y.gap_count - x.gap_count || x.name.localeCompare(y.name) || x.project.name.localeCompare(y.project.name));
  const projects = [...new Map(assignments.map((a) => [a.account_id, { id: a.account_id, name: a.account.project_name || a.account.name }])).values()].sort((x, y) => x.name.localeCompare(y.name));
  return { year, month, dates, rows: shown, projects, summary: { rows: rows.length, with_gaps: rows.filter((r) => r.gap_count > 0).length, gap_days: rows.reduce((s, r) => s + r.gap_count, 0) } };
}

module.exports = { querySchema, missingMatrix };
