// Client / project timesheet - the per project views.
//
// There is NO daily or project-level hour cap: people log the hours they actually
// worked on a project they are allocated to (or whose allocated people are on their
// team). What this file adds is visibility - who on a project has logged what - for
// tracking and transparency only; it never limits anyone's hours.
// A user sees a project's team timesheet only when allocated to that project
// (admins see every project).

const prisma = require('../../config/db');

const COUNTED = ['submitted', 'approved'];
const DEFAULT_HOURS_PER_DAY = 8;
const ymd = (date) => date.toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;

function activeOn(date) {
  return { AND: [{ OR: [{ start_date: null }, { start_date: { lte: date } }] }, { OR: [{ end_date: null }, { end_date: { gte: date } }] }] };
}

// One row per allocated person on the day (several spans: the largest figure).
async function allocatedOn(orgId, accountId, date) {
  const rows = await prisma.projectMemberAssignment.findMany({
    where: { org_id: orgId, account_id: accountId, ...activeOn(date) },
    select: { org_membership_id: true, billable_hours_per_day: true, org_membership: { select: { worker_type: true, person: { select: { name: true, department: { select: { name: true } } } } } } },
  });
  const byPerson = new Map();
  for (const r of rows) {
    const hours = r.billable_hours_per_day !== null && r.billable_hours_per_day !== undefined ? Number(r.billable_hours_per_day) : DEFAULT_HOURS_PER_DAY;
    const cur = byPerson.get(r.org_membership_id);
    if (!cur || hours > cur.billable_hours_per_day) byPerson.set(r.org_membership_id, { org_membership_id: r.org_membership_id, name: r.org_membership?.person?.name || 'Unknown', billable_hours_per_day: hours, worker_type: r.org_membership?.worker_type, department_name: r.org_membership?.person?.department?.name });
  }
  return [...byPerson.values()];
}

// IT staff and contractors are the client timesheet. A project with a billing rate is a client project.
function onClientTimesheet(person) {
  return person?.worker_type === 'contractor' || person?.department_name?.toLowerCase() === 'it' || person?.person?.department?.name?.toLowerCase() === 'it';
}

async function isClientBilled(orgId, accountId) {
  const rate = await prisma.billingRate.findFirst({ where: { org_id: orgId, account_id: accountId }, select: { id: true } });
  return Boolean(rate);
}

// What the team has logged on one project day (informational, never a limit).
// On a client project, non-IT hours are left out.
async function projectDay(orgId, accountId, date, { orgMembershipId = null } = {}) {
  const billed = await isClientBilled(orgId, accountId);
  const [resources, entries] = await Promise.all([
    allocatedOn(orgId, accountId, date),
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, account_id: accountId, date, status: { in: COUNTED } },
      select: { org_membership_id: true, hours: true, org_membership: { select: { worker_type: true, person: { select: { name: true, department: { select: { name: true } } } } } } },
    }),
  ]);
  const visibleResources = billed ? resources.filter((r) => onClientTimesheet(r)) : resources;
  const people = new Map(visibleResources.map((r) => [r.org_membership_id, { org_membership_id: r.org_membership_id, name: r.name, logged: 0 }]));
  let logged = 0;
  let mine = 0;
  for (const e of entries) {
    if (billed && !onClientTimesheet(e.org_membership)) continue;
    const hours = Number(e.hours);
    logged += hours;
    if (e.org_membership_id === orgMembershipId) mine += hours;
    if (!people.has(e.org_membership_id)) people.set(e.org_membership_id, { org_membership_id: e.org_membership_id, name: e.org_membership?.person?.name || 'Unknown', logged: 0 });
    people.get(e.org_membership_id).logged = round2(people.get(e.org_membership_id).logged + hours);
  }
  return { account_id: accountId, date: ymd(date), logged: round2(logged), mine: round2(mine), people: [...people.values()] };
}

// Whether the person is (or was, in the month) allocated to the project.
async function isAssignedToProject(orgId, orgMembershipId, accountId, from, to) {
  const count = await prisma.projectMemberAssignment.count({
    where: {
      org_id: orgId,
      account_id: accountId,
      org_membership_id: orgMembershipId,
      AND: [{ OR: [{ start_date: null }, { start_date: { lte: to } }] }, { OR: [{ end_date: null }, { end_date: { gte: from } }] }],
    },
  });
  return count > 0;
}

// The project's team timesheet for a month: assigned members, who has logged, per-member totals,
// the date-wise log and the project total. Rejected entries are left out.
async function projectTeamTimesheet(orgId, accountId, from, to) {
  const billed = await isClientBilled(orgId, accountId);
  const [assigned, entries] = await Promise.all([
    prisma.projectMemberAssignment.findMany({
      where: { org_id: orgId, account_id: accountId, AND: [{ OR: [{ start_date: null }, { start_date: { lte: to } }] }, { OR: [{ end_date: null }, { end_date: { gte: from } }] }] },
      select: { org_membership_id: true, org_membership: { select: { worker_type: true, person: { select: { name: true, department: { select: { name: true } } } } } } },
    }),
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, account_id: accountId, date: { gte: from, lte: to }, status: { not: 'rejected' } },
      select: { org_membership_id: true, date: true, hours: true, status: true, org_membership: { select: { worker_type: true, person: { select: { name: true, department: { select: { name: true } } } } } } },
      orderBy: { date: 'asc' },
    }),
  ]);
  const show = (membership) => !billed || onClientTimesheet(membership);
  const members = new Map();
  const touch = (id, name, assignedFlag) => {
    if (!members.has(id)) members.set(id, { org_membership_id: id, name: name || 'Unknown', assigned: false, total_hours: 0, approved_hours: 0, days: {} });
    if (assignedFlag) members.get(id).assigned = true;
    return members.get(id);
  };
  for (const a of assigned) {
    if (!show(a.org_membership)) continue;
    touch(a.org_membership_id, a.org_membership?.person?.name, true);
  }
  const byDate = new Map();
  let total = 0;
  for (const e of entries) {
    if (!show(e.org_membership)) continue;
    const hours = Number(e.hours);
    const m = touch(e.org_membership_id, e.org_membership?.person?.name, false);
    const day = ymd(e.date);
    m.total_hours = round2(m.total_hours + hours);
    if (e.status === 'approved') m.approved_hours = round2(m.approved_hours + hours);
    m.days[day] = round2((m.days[day] || 0) + hours);
    byDate.set(day, round2((byDate.get(day) || 0) + hours));
    total += hours;
  }
  const list = [...members.values()].map((m) => ({ ...m, has_logged: m.total_hours > 0 })).sort((a, b) => b.total_hours - a.total_hours || a.name.localeCompare(b.name));
  return {
    account_id: accountId,
    from: ymd(from),
    to: ymd(to),
    members: list,
    dates: [...byDate.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([date, hours]) => ({ date, hours })),
    total_hours: round2(total),
  };
}

// Teams the person belongs to on the day (periods, plus the current team as a fallback).
async function teamsOf(orgMembershipId, date) {
  const [periods, membership] = await Promise.all([
    prisma.teamMembershipPeriod.findMany({ where: { org_membership_id: orgMembershipId, ...activeOn(date) }, select: { team_id: true } }),
    prisma.orgMembership.findUnique({ where: { id: orgMembershipId }, select: { team_id: true } }),
  ]);
  return [...new Set([...periods.map((p) => p.team_id), membership?.team_id].filter(Boolean))];
}

// The allocated person, or a team mate of someone allocated to the project that day.
async function canLogOnProject(orgId, orgMembershipId, accountId, date) {
  const allocated = await allocatedOn(orgId, accountId, date);
  if (allocated.some((r) => r.org_membership_id === orgMembershipId)) return true;
  if (!allocated.length) return false;
  const teams = await teamsOf(orgMembershipId, date);
  if (!teams.length) return false;
  const ids = allocated.map((r) => r.org_membership_id);
  const mates = await prisma.teamMembershipPeriod.count({ where: { team_id: { in: teams }, org_membership_id: { in: ids }, ...activeOn(date) } });
  if (mates) return true;
  return (await prisma.orgMembership.count({ where: { id: { in: ids }, team_id: { in: teams } } })) > 0;
}

// Projects whose allocated people include one of my team mates (not already mine).
async function teamProjects(orgId, orgMembershipId, today, since, exclude = new Set()) {
  const teams = await teamsOf(orgMembershipId, today);
  if (!teams.length) return [];
  const [periods, members] = await Promise.all([
    prisma.teamMembershipPeriod.findMany({ where: { team_id: { in: teams }, ...activeOn(today) }, select: { org_membership_id: true } }),
    prisma.orgMembership.findMany({ where: { org_id: orgId, team_id: { in: teams } }, select: { id: true } }),
  ]);
  const mateIds = [...new Set([...periods.map((p) => p.org_membership_id), ...members.map((m) => m.id)])].filter((id) => id !== orgMembershipId);
  if (!mateIds.length) return [];
  const rows = await prisma.projectMemberAssignment.findMany({
    where: { org_id: orgId, org_membership_id: { in: mateIds }, OR: [{ end_date: null }, { end_date: { gte: since } }] },
    include: { account: { select: { id: true, name: true, project_name: true } } },
  });
  const seen = new Map();
  for (const r of rows) {
    if (exclude.has(r.account.id) || seen.has(r.account.id)) continue;
    seen.set(r.account.id, { id: r.account.id, name: r.account.project_name || r.account.name, allocated_from: null, allocated_to: null, via_team: true });
  }
  return [...seen.values()];
}

module.exports = { projectDay, isAssignedToProject, projectTeamTimesheet, canLogOnProject, teamProjects, DEFAULT_HOURS_PER_DAY };
