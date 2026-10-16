// Project Calendar: every project as a month calendar - hours logged per day, the tasks / notes behind them,
// who was on leave, and the project calendar's holidays. Same visibility as Project Team: an admin sees every
// project, anyone else the projects they are assigned to.

const prisma = require('../../config/db');
const timesheets = require('../timesheets/timesheets.service');
const projectDay = require('../timesheets/projectDay.service');
const calendars = require('../calendars/calendars.service');

const ymd = (date) => date.toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;

const listProjects = (orgId, user, { year, month }) => timesheets.listTeamProjects(orgId, user, { year, month });

async function calendar(orgId, user, accountId, { year, month }) {
  const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId }, select: { id: true, name: true, project_name: true } });
  if (!account) return { error: 'account_not_found' };
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  if (user.role !== 'admin' && !(await projectDay.isAssignedToProject(orgId, user.org_membership_id, accountId, from, to))) return { error: 'project_not_assigned' };

  const mapping = await prisma.projectCalendar.findUnique({ where: { account_id: accountId }, select: { calendar: { select: { id: true, name: true } } } });
  const cal = mapping?.calendar || (await calendars.defaultCalendar(orgId));
  const [entries, holidays, assigned] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, account_id: accountId, date: { gte: from, lte: to }, status: { not: 'rejected' } },
      orderBy: [{ date: 'asc' }, { created_at: 'asc' }],
      select: { id: true, org_membership_id: true, date: true, hours: true, overtime_hours: true, status: true, module_name: true, notes: true, org_membership: { select: { person: { select: { name: true } } } } },
    }),
    cal ? prisma.calendarHoliday.findMany({ where: { calendar_id: cal.id, date: { gte: from, lte: to } }, select: { date: true, label: true, is_working_day: true } }) : [],
    prisma.projectMemberAssignment.findMany({
      where: { org_id: orgId, account_id: accountId, AND: [{ OR: [{ start_date: null }, { start_date: { lte: to } }] }, { OR: [{ end_date: null }, { end_date: { gte: from } }] }] },
      select: { org_membership_id: true, org_membership: { select: { person: { select: { name: true } } } } },
    }),
  ]);
  const memberIds = [...new Set([...assigned.map((a) => a.org_membership_id), ...entries.map((e) => e.org_membership_id)])];
  const names = new Map([...assigned, ...entries].map((r) => [r.org_membership_id, r.org_membership?.person?.name || 'Unknown']));
  const leaves = memberIds.length
    ? await prisma.leaveRequest.findMany({
        where: { org_id: orgId, org_membership_id: { in: memberIds }, status: 'approved', from_date: { lte: to }, to_date: { gte: from } },
        select: { org_membership_id: true, from_date: true, to_date: true, is_half_day: true, leave_type: { select: { name: true } } },
      })
    : [];

  const holidayByDay = new Map(holidays.map((h) => [ymd(h.date), h]));
  const entriesByDay = new Map();
  for (const e of entries) {
    const key = ymd(e.date);
    entriesByDay.set(key, [...(entriesByDay.get(key) || []), e]);
  }
  const days = [];
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) {
    const key = ymd(d);
    const weekday = d.getUTCDay();
    const holiday = holidayByDay.get(key);
    const off = holiday ? !holiday.is_working_day : weekday === 0 || weekday === 6;
    const dayEntries = entriesByDay.get(key) || [];
    const hours = dayEntries.reduce((n, e) => n + Number(e.hours) + Number(e.overtime_hours || 0), 0);
    days.push({
      date: key,
      weekday,
      day_type: holiday && !holiday.is_working_day ? 'holiday' : off ? 'weekend' : 'working',
      day_label: holiday?.label || null,
      hours: round2(hours),
      entries: dayEntries.map((e) => ({ id: e.id, person: e.org_membership?.person?.name || 'Unknown', hours: Number(e.hours), overtime_hours: Number(e.overtime_hours || 0), status: e.status, task: e.module_name, notes: e.notes })),
      on_leave: leaves
        .filter((l) => l.from_date <= d && l.to_date >= d)
        .map((l) => ({ person: names.get(l.org_membership_id) || 'Unknown', leave: l.leave_type?.name || 'Leave', is_half_day: l.is_half_day })),
    });
  }
  return {
    project: { id: account.id, name: account.project_name || account.name, calendar: cal?.name || null },
    year,
    month,
    members: memberIds.map((id) => ({ org_membership_id: id, name: names.get(id) })).sort((a, b) => a.name.localeCompare(b.name)),
    total_hours: round2(days.reduce((n, d) => n + d.hours, 0)),
    days,
  };
}

module.exports = { listProjects, calendar };
