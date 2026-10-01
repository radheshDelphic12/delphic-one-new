// Client / project timesheet - the per project, per day view.
//
// A project's daily capacity is what its allocated resources can bill that day:
// the sum of their ProjectMemberAssignment.billable_hours_per_day (default 8,
// effective-dated like the allocation itself and separate from the cost
// allocation %, so one developer can be 8h on project A and 8h on project B).
// Everyone filling the timesheet sees how much of that is already logged, so two
// developers can't conflict or over-log. Submitted + approved hours count;
// rejected ones don't. Overtime hours are separate (ticket based) and never use
// the day's capacity. A project with no allocated resource has no cap.
// The person allocated, or anyone on the same team as an allocated resource,
// may log on the project; admin edits bypass the cap.

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
    select: { org_membership_id: true, billable_hours_per_day: true, org_membership: { select: { person: { select: { name: true } } } } },
  });
  const byPerson = new Map();
  for (const r of rows) {
    const hours = r.billable_hours_per_day !== null && r.billable_hours_per_day !== undefined ? Number(r.billable_hours_per_day) : DEFAULT_HOURS_PER_DAY;
    const cur = byPerson.get(r.org_membership_id);
    if (!cur || hours > cur.billable_hours_per_day) byPerson.set(r.org_membership_id, { org_membership_id: r.org_membership_id, name: r.org_membership?.person?.name || 'Unknown', billable_hours_per_day: hours });
  }
  return [...byPerson.values()];
}

// Capacity, what is already logged, and what is left on one project day.
async function projectDay(orgId, accountId, date, { orgMembershipId = null, excludeEntryId = null } = {}) {
  const [resources, entries] = await Promise.all([
    allocatedOn(orgId, accountId, date),
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, account_id: accountId, date, status: { in: COUNTED }, ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}) },
      select: { org_membership_id: true, hours: true, org_membership: { select: { person: { select: { name: true } } } } },
    }),
  ]);
  const capacity = round2(resources.reduce((s, r) => s + r.billable_hours_per_day, 0));
  const people = new Map(resources.map((r) => [r.org_membership_id, { ...r, logged: 0 }]));
  let logged = 0;
  let mine = 0;
  for (const e of entries) {
    const hours = Number(e.hours);
    logged += hours;
    if (e.org_membership_id === orgMembershipId) mine += hours;
    if (!people.has(e.org_membership_id)) people.set(e.org_membership_id, { org_membership_id: e.org_membership_id, name: e.org_membership?.person?.name || 'Unknown', billable_hours_per_day: null, logged: 0 });
    people.get(e.org_membership_id).logged = round2(people.get(e.org_membership_id).logged + hours);
  }
  const capped = capacity > 0;
  return {
    account_id: accountId,
    date: ymd(date),
    capped,
    capacity,
    logged: round2(logged),
    mine: round2(mine),
    remaining: capped ? round2(Math.max(0, capacity - logged)) : null,
    over_by: capped ? round2(Math.max(0, logged - capacity)) : 0,
    people: [...people.values()],
  };
}

// null when `hours` fits; otherwise the project_day_cap error with the numbers.
async function checkCap(orgId, accountId, date, hours, options = {}) {
  const day = await projectDay(orgId, accountId, date, options);
  if (!day.capped) return null;
  if (day.logged + hours > day.capacity + 1e-9) return { error: 'project_day_cap', ...day, adding: hours };
  return null;
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

module.exports = { projectDay, checkCap, canLogOnProject, teamProjects, DEFAULT_HOURS_PER_DAY };
