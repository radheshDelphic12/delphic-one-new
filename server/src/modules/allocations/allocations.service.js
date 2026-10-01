// People → Capacity & Allocation. Effective-dated Resource → Team → Project
// allocations and the reports built on them.
//
// Source of truth:
//   Team + lead ............ Team (lead_membership_id) — HR Settings → Teams
//   Team membership ........ TeamMembershipPeriod (OrgMembership.team_id is
//                            only a pointer to today's open period)
//   Project allocation ..... ProjectMemberAssignment spans (start/end dates)
//
// A change is never an overwrite: moving someone ends the old span the day
// before the effective date and opens a new one on it, so any past date still
// resolves to what applied then. Changes reaching into a month whose finance
// is locked are flagged on that calculation (review → recalculate), never
// applied to the locked figures.

const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');
const { detectFinanceChange } = require('../../lib/financeChanges');
const A = require('../../lib/allocations');

const DEFAULT_ENDING_WINDOW = 30;
// Flag "from the beginning" spans (null start) against every locked month.
const EPOCH = new Date('2000-01-01T00:00:00.000Z');

const SPAN_INCLUDE = {
  account: { select: { id: true, name: true, project_name: true, project_code: true, client_name: true, client_account: { select: { id: true, name: true } } } },
  org_membership: {
    select: { id: true, employee_code: true, worker_type: true, vendor_account: { select: { id: true, name: true } }, person: { select: { id: true, name: true } } },
  },
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const ymdOrNull = (d) => (d ? A.ymd(A.toDate(d)) : null);
const projectLabel = (account) => account?.project_name || account?.name || null;

function spanStatus(span, today = todayIst()) {
  if (span.start_date && A.toDate(span.start_date) > today) return 'upcoming';
  if (span.end_date && A.toDate(span.end_date) < today) return 'ended';
  return 'active';
}

function serializeSpan(span, today = todayIst()) {
  return {
    ...span,
    allocation_percent: span.allocation_percent !== null && span.allocation_percent !== undefined ? Number(span.allocation_percent) : null,
    cost_rate_per_hr: span.cost_rate_per_hr !== null && span.cost_rate_per_hr !== undefined ? Number(span.cost_rate_per_hr) : null,
    start_date: ymdOrNull(span.start_date),
    end_date: ymdOrNull(span.end_date),
    status: spanStatus(span, today),
  };
}

// Finance: a span change touches every month in [from, to] (to null = open).
async function flagAllocationChange(orgId, span, { from, to, userId, description, old_value = null, new_value = null }) {
  return detectFinanceChange(orgId, {
    source_type: 'allocation',
    source_id: span.id,
    from_date: from || EPOCH,
    to_date: to || null,
    org_membership_id: span.org_membership_id,
    account_id: span.account_id,
    changed_by: userId,
    description: description.slice(0, 500),
    old_value,
    new_value,
  });
}

function spanValues(span) {
  return {
    allocation_percent: span.allocation_percent !== null && span.allocation_percent !== undefined ? Number(span.allocation_percent) : null,
    cost_rate_per_hr: span.cost_rate_per_hr !== null && span.cost_rate_per_hr !== undefined ? Number(span.cost_rate_per_hr) : null,
    start_date: ymdOrNull(span.start_date),
    end_date: ymdOrNull(span.end_date),
  };
}

function clashes(spans, candidate, ignoreId = null) {
  return spans.some((s) => s.id !== ignoreId && A.overlaps(s, candidate.start_date, candidate.end_date) && A.overlaps(candidate, s.start_date, s.end_date));
}

async function loadRefs(orgId, accountId, membershipId) {
  const [account, membership] = await Promise.all([
    prisma.account.findFirst({ where: { id: accountId, org_id: orgId }, select: { id: true, name: true, project_name: true } }),
    prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId }, select: { id: true, worker_type: true, person: { select: { name: true } } } }),
  ]);
  if (!account) return { error: 'account_not_found' };
  if (!membership) return { error: 'membership_not_found' };
  return { account, membership };
}

/**
 * Allocate a person to a project (Finance → Projects → Project team).
 *  - No span in force → a new span [start_date, end_date] (null = open).
 *  - A span in force + `effective_date` → the change applies from that date:
 *    the current span ends the day before, a new one starts on it (history kept).
 *  - A span in force, no `effective_date` → a correction of that span in place.
 */
async function assign(orgId, userId, { account_id, org_membership_id, cost_rate_per_hr, allocation_percent, start_date, end_date, effective_date }) {
  const refs = await loadRefs(orgId, account_id, org_membership_id);
  if (refs.error) return refs;
  const resource_type = refs.membership.worker_type === 'contractor' ? 'contractor' : 'company_employee';
  const who = `${refs.membership.person.name} on ${projectLabel(refs.account)}`;

  const spans = await prisma.projectMemberAssignment.findMany({ where: { org_id: orgId, account_id, org_membership_id }, orderBy: { start_date: 'asc' } });
  const pivot = effective_date || todayIst();
  const current = spans.filter((s) => A.activeOn(s, pivot)).pop() || spans.filter((s) => !s.end_date).pop() || null;

  if (current && effective_date) {
    // Effective-dated change: end the current span, open a new one.
    const values = {
      allocation_percent: allocation_percent !== undefined ? allocation_percent : current.allocation_percent,
      cost_rate_per_hr: cost_rate_per_hr !== undefined ? cost_rate_per_hr : current.cost_rate_per_hr,
    };
    const newEnd = end_date !== undefined ? end_date : current.end_date;
    if (newEnd && A.toDate(newEnd) < A.toDate(effective_date)) return { error: 'end_before_start' };
    const cut = A.endBefore(current, effective_date);
    const assignment = await prisma.$transaction(async (tx) => {
      if (cut === 'delete') await tx.projectMemberAssignment.delete({ where: { id: current.id } });
      else await tx.projectMemberAssignment.update({ where: { id: current.id }, data: { end_date: cut } });
      return tx.projectMemberAssignment.create({
        data: { org_id: orgId, account_id, org_membership_id, resource_type, ...values, start_date: effective_date, end_date: newEnd || null, created_by: userId },
        include: SPAN_INCLUDE,
      });
    });
    await flagAllocationChange(orgId, assignment, {
      from: effective_date,
      to: current.end_date && newEnd ? new Date(Math.max(A.toDate(current.end_date), A.toDate(newEnd))) : null,
      userId,
      description: `Allocation changed from ${A.ymd(A.toDate(effective_date))}: ${who}`,
      old_value: spanValues(current),
      new_value: spanValues(assignment),
    });
    return { assignment: serializeSpan(assignment) };
  }

  if (current) {
    // Correction of the span in force.
    const data = { resource_type };
    if (cost_rate_per_hr !== undefined) data.cost_rate_per_hr = cost_rate_per_hr;
    if (allocation_percent !== undefined) data.allocation_percent = allocation_percent;
    if (start_date !== undefined) data.start_date = start_date;
    if (end_date !== undefined) data.end_date = end_date;
    const next = { ...current, ...data };
    if (next.start_date && next.end_date && A.toDate(next.end_date) < A.toDate(next.start_date)) return { error: 'end_before_start' };
    if (clashes(spans, next, current.id)) return { error: 'overlapping_allocation' };
    const assignment = await prisma.projectMemberAssignment.update({ where: { id: current.id }, data, include: SPAN_INCLUDE });
    const starts = [current.start_date, next.start_date];
    const ends = [current.end_date, next.end_date];
    await flagAllocationChange(orgId, assignment, {
      from: starts.some((d) => !d) ? null : new Date(Math.min(...starts.map((d) => A.toDate(d)))),
      to: ends.some((d) => !d) ? null : new Date(Math.max(...ends.map((d) => A.toDate(d)))),
      userId,
      description: `Allocation corrected: ${who}`,
      old_value: spanValues(current),
      new_value: spanValues(assignment),
    });
    return { assignment: serializeSpan(assignment) };
  }

  const candidate = { start_date: start_date ?? effective_date ?? null, end_date: end_date ?? null };
  if (candidate.start_date && candidate.end_date && A.toDate(candidate.end_date) < A.toDate(candidate.start_date)) return { error: 'end_before_start' };
  if (clashes(spans, candidate)) return { error: 'overlapping_allocation' };
  const assignment = await prisma.projectMemberAssignment.create({
    data: { org_id: orgId, account_id, org_membership_id, resource_type, cost_rate_per_hr, allocation_percent, ...candidate, created_by: userId },
    include: SPAN_INCLUDE,
  });
  await flagAllocationChange(orgId, assignment, {
    from: candidate.start_date,
    to: candidate.end_date,
    userId,
    description: `Allocated: ${who}${candidate.start_date ? ` from ${A.ymd(A.toDate(candidate.start_date))}` : ''}`,
    new_value: spanValues(assignment),
  });
  return { assignment: serializeSpan(assignment) };
}

/** Ends an allocation on `end_date` (its last day; default today). History stays. */
async function endAllocation(orgId, userId, id, { end_date } = {}) {
  const span = await prisma.projectMemberAssignment.findFirst({ where: { id, org_id: orgId }, include: SPAN_INCLUDE });
  if (!span) return { error: 'not_found' };
  const end = end_date || todayIst();
  if (span.start_date && A.toDate(end) < A.toDate(span.start_date)) return { error: 'end_before_start' };
  const spans = await prisma.projectMemberAssignment.findMany({ where: { org_id: orgId, account_id: span.account_id, org_membership_id: span.org_membership_id } });
  if (clashes(spans, { start_date: span.start_date, end_date: end }, span.id)) return { error: 'overlapping_allocation' };
  const updated = await prisma.projectMemberAssignment.update({ where: { id }, data: { end_date: end }, include: SPAN_INCLUDE });
  // Shortened: the days after the new end changed. Extended: the added days did.
  const oldEnd = span.end_date ? A.toDate(span.end_date) : null;
  const newEnd = A.toDate(end);
  const shortened = !oldEnd || newEnd < oldEnd;
  await flagAllocationChange(orgId, updated, {
    from: shortened ? A.addDays(newEnd, 1) : A.addDays(oldEnd, 1),
    to: shortened ? oldEnd : newEnd,
    userId,
    description: `Allocation ended ${A.ymd(newEnd)}: ${span.org_membership.person.name} on ${projectLabel(span.account)}`,
    old_value: spanValues(span),
    new_value: spanValues(updated),
  });
  return { assignment: serializeSpan(updated) };
}

/** Removes an allocation entered by mistake (it never applied). Flags its whole span. */
async function deleteAllocation(orgId, userId, id) {
  const span = await prisma.projectMemberAssignment.findFirst({ where: { id, org_id: orgId }, include: SPAN_INCLUDE });
  if (!span) return { error: 'not_found' };
  await prisma.projectMemberAssignment.delete({ where: { id } });
  await flagAllocationChange(orgId, span, {
    from: span.start_date,
    to: span.end_date,
    userId,
    description: `Allocation deleted (entered by mistake): ${span.org_membership.person.name} on ${projectLabel(span.account)}`,
    old_value: spanValues(span),
  });
  return { deleted: true };
}

async function listForProject(orgId, accountId, { include_ended = true } = {}) {
  const today = todayIst();
  const rows = await prisma.projectMemberAssignment.findMany({
    where: { org_id: orgId, account_id: accountId, ...(include_ended ? {} : { OR: [{ end_date: null }, { end_date: { gte: today } }] }) },
    orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
    include: SPAN_INCLUDE,
  });
  const order = { active: 0, upcoming: 1, ended: 2 };
  return rows.map((r) => serializeSpan(r, today)).sort((a, b) => order[a.status] - order[b.status]);
}

/**
 * Team change effective `effective_date` (default today, never in the future —
 * OrgMembership.team_id must always be today's team). The open period ends
 * the day before; a new one starts on the date. Earlier periods are untouched.
 */
async function changeTeam(orgId, userId, orgMembershipId, teamId, effective_date, tx = prisma) {
  const today = todayIst();
  const eff = effective_date ? A.toDate(effective_date) : today;
  if (eff > today) return { error: 'future_team_change' };
  const membership = await tx.orgMembership.findFirst({ where: { id: orgMembershipId, org_id: orgId }, select: { id: true, team_id: true } });
  if (!membership) return { error: 'membership_not_found' };
  if (teamId) {
    const team = await tx.team.findFirst({ where: { id: teamId, org_id: orgId }, select: { id: true } });
    if (!team) return { error: 'team_not_found' };
  }
  const periods = await tx.teamMembershipPeriod.findMany({ where: { org_membership_id: orgMembershipId }, orderBy: { start_date: 'asc' } });
  // A member put on a team before history was kept: record that as an open period first.
  if (!periods.length && membership.team_id) {
    periods.push(await tx.teamMembershipPeriod.create({ data: { org_id: orgId, org_membership_id: orgMembershipId, team_id: membership.team_id, created_by: userId } }));
  }
  const inForce = periods.filter((p) => !p.end_date || A.toDate(p.end_date) >= eff);
  if (inForce.length === 1 && inForce[0].team_id === teamId && A.activeOn(inForce[0], eff)) return { unchanged: true };
  for (const p of inForce) {
    const cut = A.endBefore(p, eff);
    if (cut === 'delete') await tx.teamMembershipPeriod.delete({ where: { id: p.id } });
    else await tx.teamMembershipPeriod.update({ where: { id: p.id }, data: { end_date: cut } });
  }
  if (teamId) await tx.teamMembershipPeriod.create({ data: { org_id: orgId, org_membership_id: orgMembershipId, team_id: teamId, start_date: eff, created_by: userId } });
  await tx.orgMembership.update({ where: { id: orgMembershipId }, data: { team_id: teamId || null } });
  return { changed: true, effective_date: A.ymd(eff) };
}

/**
 * Move a resource from one allocation to another (and/or another team) on
 * `effective_date`: the old spans end the day before, the new one starts on it.
 * from_account_id omitted = every allocation in force on that date ends.
 */
async function moveResource(orgId, userId, { org_membership_id, from_account_id, to_account_id, effective_date, allocation_percent, cost_rate_per_hr, to_team_id }) {
  const eff = A.toDate(effective_date);
  const membership = await prisma.orgMembership.findFirst({ where: { id: org_membership_id, org_id: orgId }, select: { id: true, worker_type: true, person: { select: { name: true } } } });
  if (!membership) return { error: 'membership_not_found' };
  if (to_account_id) {
    const refs = await loadRefs(orgId, to_account_id, org_membership_id);
    if (refs.error) return refs;
  }
  const spans = await prisma.projectMemberAssignment.findMany({ where: { org_id: orgId, org_membership_id }, include: SPAN_INCLUDE });
  const ending = spans.filter((s) => A.activeOn(s, eff) && (!from_account_id || s.account_id === from_account_id) && s.account_id !== to_account_id);
  if (from_account_id && !ending.length) return { error: 'no_allocation_to_move' };
  if (!ending.length && !to_account_id && to_team_id === undefined) return { error: 'nothing_to_move' };

  const ended = [];
  for (const s of ending) {
    const cut = A.endBefore(s, eff);
    if (cut === 'delete') await prisma.projectMemberAssignment.delete({ where: { id: s.id } });
    else await prisma.projectMemberAssignment.update({ where: { id: s.id }, data: { end_date: cut } });
    ended.push(s);
    await flagAllocationChange(orgId, s, {
      from: eff,
      to: s.end_date,
      userId,
      description: `Moved off ${projectLabel(s.account)} from ${A.ymd(eff)}: ${membership.person.name}`,
      old_value: spanValues(s),
      new_value: { ...spanValues(s), end_date: cut === 'delete' ? null : A.ymd(cut) },
    });
  }

  let started = null;
  if (to_account_id) {
    const result = await assign(orgId, userId, {
      account_id: to_account_id,
      org_membership_id,
      allocation_percent: allocation_percent ?? null,
      cost_rate_per_hr: cost_rate_per_hr ?? null,
      effective_date: eff,
    });
    if (result.error) return result;
    started = result.assignment;
  }

  let team = null;
  if (to_team_id !== undefined) {
    team = await changeTeam(orgId, userId, org_membership_id, to_team_id, eff);
    if (team.error) return team;
  }
  return {
    effective_date: A.ymd(eff),
    ended: ended.map((s) => ({ id: s.id, project: projectLabel(s.account) })),
    started,
    team,
  };
}

// --- Capacity settings -------------------------------------------------------

async function getSettings(orgId) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { projects_per_resource: true } });
  return { projects_per_resource: Number(org?.projects_per_resource ?? 1.5) };
}

async function updateSettings(orgId, { projects_per_resource }) {
  const org = await prisma.org.update({ where: { id: orgId }, data: { projects_per_resource }, select: { projects_per_resource: true } });
  return { projects_per_resource: Number(org.projects_per_resource) };
}

// --- Reports ----------------------------------------------------------------

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  project_name: true,
  project_code: true,
  type: true,
  stage: true,
  service_category: true,
  client_name: true,
  client_account_id: true,
  client_account: { select: { id: true, name: true } },
  agreement_start_date: true,
  agreement_end_date: true,
  contract_status: true,
};

function describeProject(a) {
  return {
    id: a.id,
    code: a.project_code || null,
    name: projectLabel(a),
    client_account_id: a.client_account_id || null,
    client_name: a.client_account?.name || a.client_name || null,
    service_category: a.service_category || null,
    agreement_start_date: ymdOrNull(a.agreement_start_date),
    agreement_end_date: ymdOrNull(a.agreement_end_date),
  };
}

// A client contract that is running on `date` (the thing capacity counts).
function contractRunning(a, date) {
  const d = A.toDate(date);
  return a.type === 'client' && a.stage === 'active' && a.contract_status !== 'completed'
    && (!a.agreement_start_date || A.toDate(a.agreement_start_date) <= d)
    && (!a.agreement_end_date || A.toDate(a.agreement_end_date) >= d);
}

function employedOn(m, date) {
  const d = A.toDate(date);
  return (!m.joined_at || A.toDate(m.joined_at) <= d) && (!m.left_at || A.toDate(m.left_at) >= d) && !(m.employment_status === 'terminated' && !m.left_at);
}

async function loadPeopleAndTeams(orgId) {
  const [teams, periods, memberships] = await Promise.all([
    prisma.team.findMany({
      where: { org_id: orgId },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, projects_per_resource: true, lead_membership_id: true, lead: { select: { id: true, person: { select: { name: true } } } } },
    }),
    prisma.teamMembershipPeriod.findMany({ where: { org_id: orgId }, select: { org_membership_id: true, team_id: true, start_date: true, end_date: true } }),
    prisma.orgMembership.findMany({
      where: { org_id: orgId },
      select: { id: true, team_id: true, employee_code: true, joined_at: true, left_at: true, employment_status: true, worker_type: true, person: { select: { name: true } } },
    }),
  ]);
  const periodsBy = A.byMembership(periods);
  // Anyone on a team with no recorded period yet counts as on it all along.
  for (const m of memberships) if (m.team_id && !periodsBy.has(m.id)) periodsBy.set(m.id, [{ org_membership_id: m.id, team_id: m.team_id, start_date: null, end_date: null }]);
  const teamOf = (membershipId, date) => A.teamOn(periodsBy.get(membershipId) || [], date);
  return { teams, teamsById: new Map(teams.map((t) => [t.id, t])), memberships, membershipsById: new Map(memberships.map((m) => [m.id, m])), periodsBy, teamOf };
}

function capacityStatus(members, total, current) {
  if (!members) return current ? 'over_capacity' : 'no_members';
  if (current > total) return 'over_capacity';
  if (current === total) return 'at_capacity';
  if (total > 0 && current / total >= 0.8) return 'near_capacity';
  return 'available';
}

/**
 * Team Capacity on `date` (default today): active members × capacity per
 * resource vs. the distinct running projects the team's members are
 * allocated to that day (several members on one project count once).
 * Available = max(0, capacity − allocation); Can allocate = available +
 * projects ending within `window_days` (their people free up).
 */
async function teamCapacity(orgId, { date, team_id, team_ids, window_days = DEFAULT_ENDING_WINDOW } = {}) {
  const onlyTeams = new Set([...(team_ids || []), ...(team_id ? [team_id] : [])]);
  const day = A.toDate(date) || todayIst();
  const windowEnd = A.addDays(day, window_days);
  const [{ projects_per_resource: orgDefault }, ctx, spans] = await Promise.all([
    getSettings(orgId),
    loadPeopleAndTeams(orgId),
    prisma.projectMemberAssignment.findMany({
      where: { org_id: orgId, AND: [{ OR: [{ start_date: null }, { start_date: { lte: day } }] }, { OR: [{ end_date: null }, { end_date: { gte: day } }] }] },
      select: { org_membership_id: true, account_id: true, allocation_percent: true, account: { select: ACCOUNT_SELECT } },
    }),
  ]);

  const rows = new Map();
  const rowFor = (team) => {
    const key = team?.id || 'none';
    if (!rows.has(key)) {
      rows.set(key, {
        team: team ? { id: team.id, name: team.name } : null,
        lead: team?.lead ? { id: team.lead.id, name: team.lead.person.name } : null,
        capacity_per_resource: team?.projects_per_resource !== null && team?.projects_per_resource !== undefined ? Number(team.projects_per_resource) : orgDefault,
        uses_org_default: !(team?.projects_per_resource !== null && team?.projects_per_resource !== undefined),
        members: [],
        projects: new Map(),
      });
    }
    return rows.get(key);
  };
  for (const t of ctx.teams) rowFor(t);
  for (const m of ctx.memberships) {
    if (!employedOn(m, day)) continue;
    const teamId = ctx.teamOf(m.id, day);
    if (!teamId) continue;
    rowFor(ctx.teamsById.get(teamId)).members.push({ id: m.id, name: m.person.name });
  }
  for (const s of spans) {
    const m = ctx.membershipsById.get(s.org_membership_id);
    if (!m || !employedOn(m, day) || !contractRunning(s.account, day)) continue;
    const teamId = ctx.teamOf(m.id, day);
    const row = rowFor(teamId ? ctx.teamsById.get(teamId) : null);
    if (!row.projects.has(s.account_id)) {
      const end = s.account.agreement_end_date ? A.toDate(s.account.agreement_end_date) : null;
      row.projects.set(s.account_id, {
        ...describeProject(s.account),
        ending_soon: Boolean(end && end >= day && end <= windowEnd),
        days_remaining: end ? Math.round((end - day) / A.DAY) : null,
        resources: [],
      });
    }
    row.projects.get(s.account_id).resources.push({ id: m.id, name: m.person.name, allocation_percent: s.allocation_percent !== null ? Number(s.allocation_percent) : null });
  }

  const out = [...rows.values()]
    .filter((r) => !onlyTeams.size || onlyTeams.has(r.team?.id))
    .filter((r) => r.team || r.projects.size) // "No team" row only when it has allocations
    .map((r) => {
      const projects = [...r.projects.values()].sort((a, b) => (a.agreement_end_date || '9999').localeCompare(b.agreement_end_date || '9999'));
      const members = r.team ? r.members.length : 0;
      const total = round2(members * r.capacity_per_resource);
      const current = projects.length;
      // Projects are whole units: a fractional remainder (0.5, 2.5) counts as one more project, so capability is a whole number.
      const available = Math.ceil(round2(Math.max(0, total - current)));
      const endingSoon = projects.filter((p) => p.ending_soon).length;
      return {
        team: r.team,
        lead: r.lead,
        members,
        member_list: r.members.sort((a, b) => a.name.localeCompare(b.name)),
        capacity_per_resource: r.capacity_per_resource,
        uses_org_default: r.uses_org_default,
        total_capacity: total,
        current_allocation: current,
        available_capability: available,
        over_capacity_by: round2(Math.max(0, current - total)),
        projects_ending_soon: endingSoon,
        can_allocate: round2(available + endingSoon),
        status: r.team ? capacityStatus(members, total, current) : 'unassigned',
        projects,
      };
    });
  const sum = (key) => round2(out.filter((r) => r.team).reduce((s, r) => s + r[key], 0));
  return {
    date: A.ymd(day),
    window_days,
    projects_per_resource: orgDefault,
    teams: out,
    totals: {
      members: sum('members'),
      total_capacity: sum('total_capacity'),
      current_allocation: sum('current_allocation'),
      available_capability: sum('available_capability'),
      projects_ending_soon: sum('projects_ending_soon'),
      can_allocate: sum('can_allocate'),
    },
  };
}

/** Running projects whose agreement end date falls in [from, to] (default today → +30 days). */
async function endingSoon(orgId, { from, to, team_id, client_account_id } = {}) {
  const today = todayIst();
  const start = A.toDate(from) || today;
  const end = A.toDate(to) || A.addDays(start, DEFAULT_ENDING_WINDOW);
  const [accounts, ctx] = await Promise.all([
    prisma.account.findMany({
      where: { org_id: orgId, type: 'client', stage: 'active', agreement_end_date: { gte: start, lte: end }, ...(client_account_id ? { client_account_id } : {}), OR: [{ contract_status: null }, { contract_status: { not: 'completed' } }] },
      select: { ...ACCOUNT_SELECT, project_cost_rates: { select: { org_membership_id: true, start_date: true, end_date: true } } },
      orderBy: { agreement_end_date: 'asc' },
    }),
    loadPeopleAndTeams(orgId),
  ]);
  const rows = [];
  for (const a of accounts) {
    const endDate = A.toDate(a.agreement_end_date);
    // The people on it as it runs out: allocated at some point in [from, its end].
    const onIt = [...new Set(a.project_cost_rates.filter((s) => A.overlaps(s, start, endDate)).map((s) => s.org_membership_id))];
    const asOf = start > endDate ? endDate : start;
    const people = onIt.map((id) => ctx.membershipsById.get(id)).filter(Boolean);
    const teamIds = [...new Set(people.map((m) => ctx.teamOf(m.id, asOf)).filter(Boolean))];
    if (team_id && !teamIds.includes(team_id)) continue;
    rows.push({
      project: describeProject(a),
      end_date: A.ymd(endDate),
      days_remaining: Math.round((endDate - today) / A.DAY),
      teams: teamIds.map((id) => ({ id, name: ctx.teamsById.get(id)?.name || null })),
      resource_count: people.length,
      resources: people.map((m) => ({ id: m.id, name: m.person.name, team_id: ctx.teamOf(m.id, asOf) })),
    });
  }
  return { from: A.ymd(start), to: A.ymd(end), projects: rows };
}

/**
 * Resource Allocation: every allocation span overlapping [from, to]; with no
 * range, the ones in force today plus upcoming ones. Team = the person's team
 * during the span (at its last day in range, or today).
 */
async function resourceAllocations(orgId, { team_id, org_membership_id, account_id, client_account_id, from, to, status = 'all' } = {}) {
  const today = todayIst();
  const f = A.toDate(from);
  const t = A.toDate(to);
  const [spans, ctx] = await Promise.all([
    prisma.projectMemberAssignment.findMany({
      where: {
        org_id: orgId,
        ...(org_membership_id ? { org_membership_id } : {}),
        ...(account_id ? { account_id } : {}),
        ...(client_account_id ? { account: { client_account_id } } : {}),
        ...(!f && !t ? { OR: [{ end_date: null }, { end_date: { gte: today } }] } : {}),
      },
      include: { account: { select: ACCOUNT_SELECT } },
      orderBy: [{ start_date: 'asc' }, { created_at: 'asc' }],
    }),
    loadPeopleAndTeams(orgId),
  ]);
  const rows = [];
  for (const s of spans) {
    if ((f || t) && !A.overlaps(s, f, t)) continue;
    const m = ctx.membershipsById.get(s.org_membership_id);
    if (!m) continue;
    const st = spanStatus(s, today);
    if (status !== 'all' && st !== status) continue;
    // Team while on this allocation: at the last day that's in range and not in the future.
    let at = s.end_date ? A.toDate(s.end_date) : today;
    if (t && at > t) at = t;
    if (at > today) at = s.start_date && A.toDate(s.start_date) > today ? A.toDate(s.start_date) : today;
    const teamId = ctx.teamOf(m.id, at);
    if (team_id && teamId !== team_id) continue;
    rows.push({
      id: s.id,
      resource: { id: m.id, name: m.person.name, employee_code: m.employee_code, worker_type: m.worker_type },
      team: teamId ? { id: teamId, name: ctx.teamsById.get(teamId)?.name || null } : null,
      project: describeProject(s.account),
      allocation_percent: s.allocation_percent !== null ? Number(s.allocation_percent) : null,
      start_date: ymdOrNull(s.start_date),
      end_date: ymdOrNull(s.end_date),
      status: st,
    });
  }
  rows.sort((a, b) => a.resource.name.localeCompare(b.resource.name) || (a.start_date || '').localeCompare(b.start_date || ''));
  return { rows, resources: new Set(rows.map((r) => r.resource.id)).size };
}

/**
 * Resource Movement History in [from, to] (default last 90 days → +30):
 * team moves and project changes, one row per person per effective date.
 * A project change is an allocation starting the day after another ended.
 */
async function movements(orgId, { from, to, team_id, org_membership_id } = {}) {
  const today = todayIst();
  const f = A.toDate(from) || A.addDays(today, -90);
  const t = A.toDate(to) || A.addDays(today, 30);
  const inRange = (d) => d && d >= f && d <= t;
  const [periods, spans, ctx] = await Promise.all([
    prisma.teamMembershipPeriod.findMany({ where: { org_id: orgId, ...(org_membership_id ? { org_membership_id } : {}) }, orderBy: { start_date: 'asc' } }),
    prisma.projectMemberAssignment.findMany({ where: { org_id: orgId, ...(org_membership_id ? { org_membership_id } : {}) }, include: { account: { select: ACCOUNT_SELECT } } }),
    loadPeopleAndTeams(orgId),
  ]);
  const events = new Map();
  const eventFor = (membershipId, date) => {
    const key = `${membershipId}|${A.ymd(date)}`;
    if (!events.has(key)) events.set(key, { org_membership_id: membershipId, effective_date: A.ymd(date), from_team_id: undefined, to_team_id: undefined, previous_projects: [], new_projects: [] });
    return events.get(key);
  };

  for (const [membershipId, list] of A.byMembership(periods)) {
    for (const p of list) {
      const s = p.start_date ? A.toDate(p.start_date) : null;
      if (inRange(s)) {
        const prev = list.filter((q) => q !== p && q.end_date && A.toDate(q.end_date) < s).sort((a, b) => A.toDate(b.end_date) - A.toDate(a.end_date))[0];
        const e = eventFor(membershipId, s);
        e.from_team_id = prev?.team_id || null;
        e.to_team_id = p.team_id;
      }
      const after = p.end_date ? A.addDays(A.toDate(p.end_date), 1) : null;
      if (inRange(after) && !list.some((q) => q.start_date && A.ymd(A.toDate(q.start_date)) === A.ymd(after))) {
        const e = eventFor(membershipId, after);
        e.from_team_id = p.team_id;
        e.to_team_id = null;
      }
    }
  }
  for (const s of spans) {
    const start = s.start_date ? A.toDate(s.start_date) : null;
    const after = s.end_date ? A.addDays(A.toDate(s.end_date), 1) : null;
    if (inRange(start)) eventFor(s.org_membership_id, start).new_projects.push(describeProject(s.account));
    if (inRange(after)) eventFor(s.org_membership_id, after).previous_projects.push(describeProject(s.account));
  }

  const rows = [];
  for (const e of events.values()) {
    const m = ctx.membershipsById.get(e.org_membership_id);
    if (!m) continue;
    const date = A.toDate(e.effective_date);
    const teamChanged = e.from_team_id !== undefined;
    // Same project ending and restarting on one date = a change of %/rate, not a move.
    const prevIds = new Set(e.previous_projects.map((p) => p.id));
    const newIds = new Set(e.new_projects.map((p) => p.id));
    const previous = e.previous_projects.filter((p) => !newIds.has(p.id));
    const next = e.new_projects.filter((p) => !prevIds.has(p.id));
    if (!teamChanged && !previous.length && !next.length) continue;
    const fromTeam = teamChanged ? e.from_team_id : ctx.teamOf(m.id, A.addDays(date, -1));
    const toTeam = teamChanged ? e.to_team_id : ctx.teamOf(m.id, date);
    if (team_id && fromTeam !== team_id && toTeam !== team_id) continue;
    const change_type = teamChanged && (previous.length || next.length) ? 'team_and_project'
      : teamChanged ? 'team'
        : previous.length && next.length ? 'project'
          : next.length ? 'joined_project' : 'left_project';
    rows.push({
      resource: { id: m.id, name: m.person.name, employee_code: m.employee_code },
      effective_date: e.effective_date,
      from_team: fromTeam ? { id: fromTeam, name: ctx.teamsById.get(fromTeam)?.name || null } : null,
      to_team: toTeam ? { id: toTeam, name: ctx.teamsById.get(toTeam)?.name || null } : null,
      previous_projects: previous,
      new_projects: next,
      change_type,
    });
  }
  rows.sort((a, b) => b.effective_date.localeCompare(a.effective_date) || a.resource.name.localeCompare(b.resource.name));
  return { from: A.ymd(f), to: A.ymd(t), rows };
}

module.exports = {
  assign,
  endAllocation,
  deleteAllocation,
  listForProject,
  changeTeam,
  moveResource,
  getSettings,
  updateSettings,
  teamCapacity,
  endingSoon,
  resourceAllocations,
  movements,
  serializeSpan,
  SPAN_INCLUDE,
};
