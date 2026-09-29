const prisma = require('../../config/db');
const allocationsService = require('../allocations/allocations.service');

const SELECT = {
  id: true,
  name: true,
  department_id: true,
  department: { select: { id: true, name: true } },
  lead_membership_id: true,
  lead: { select: { id: true, person: { select: { id: true, name: true } } } },
  manager_membership_id: true,
  manager: { select: { id: true, person: { select: { id: true, name: true } } } },
  open_positions: true,
  sort_order: true,
  projects_per_resource: true,
  created_at: true,
  updated_at: true,
  _count: { select: { members: true } },
};

function serialize({ _count, ...team }) {
  return {
    ...team,
    projects_per_resource: team.projects_per_resource !== null && team.projects_per_resource !== undefined ? Number(team.projects_per_resource) : null,
    member_count: _count.members,
  };
}

// One source of truth for "who is on the team": the lead is a member too.
// Setting a lead who isn't on any team puts them on this one (from today);
// a lead already on another team stays there (they may lead across teams).
async function joinLeadToTeam(orgId, teamId, leadMembershipId, actorUserId) {
  if (!leadMembershipId) return;
  const lead = await prisma.orgMembership.findFirst({ where: { id: leadMembershipId, org_id: orgId }, select: { team_id: true } });
  if (lead && !lead.team_id) await allocationsService.changeTeam(orgId, actorUserId, leadMembershipId, teamId, null);
}

// HR Settings → Teams (org-scoped, same shape as designations). A team's
// department and lead must both belong to the same org.
async function checkRefs(orgId, { department_id, lead_membership_id, manager_membership_id }) {
  if (department_id) {
    const department = await prisma.department.findFirst({ where: { id: department_id, org_id: orgId } });
    if (!department) return 'department_not_found';
  }
  if (lead_membership_id) {
    const lead = await prisma.orgMembership.findFirst({ where: { id: lead_membership_id, org_id: orgId } });
    if (!lead) return 'lead_not_found';
  }
  if (manager_membership_id) {
    const manager = await prisma.orgMembership.findFirst({ where: { id: manager_membership_id, org_id: orgId } });
    if (!manager) return 'manager_not_found';
  }
  return null;
}

async function list(orgId) {
  const rows = await prisma.team.findMany({ where: { org_id: orgId }, select: SELECT, orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] });
  return rows.map(serialize);
}

async function create(orgId, body, actorUserId = null) {
  const existing = await prisma.team.findUnique({ where: { org_id_name: { org_id: orgId, name: body.name } } });
  if (existing) return { error: 'name_taken' };
  const refError = await checkRefs(orgId, body);
  if (refError) return { error: refError };
  const team = await prisma.team.create({
    data: {
      org_id: orgId,
      name: body.name,
      department_id: body.department_id || null,
      lead_membership_id: body.lead_membership_id || null,
      manager_membership_id: body.manager_membership_id || null,
      open_positions: body.open_positions ?? 0,
      sort_order: body.sort_order ?? 0,
      projects_per_resource: body.projects_per_resource ?? null,
    },
    select: SELECT,
  });
  await joinLeadToTeam(orgId, team.id, team.lead_membership_id, actorUserId);
  return { team: serialize(await prisma.team.findUnique({ where: { id: team.id }, select: SELECT })) };
}

async function update(orgId, id, patch, actorUserId = null) {
  const existing = await prisma.team.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (patch.name) {
    const clash = await prisma.team.findFirst({ where: { org_id: orgId, name: patch.name, NOT: { id } } });
    if (clash) return { error: 'name_taken' };
  }
  const refError = await checkRefs(orgId, patch);
  if (refError) return { error: refError };
  await prisma.team.update({ where: { id }, data: patch });
  if (patch.lead_membership_id) await joinLeadToTeam(orgId, id, patch.lead_membership_id, actorUserId);
  return { team: serialize(await prisma.team.findUnique({ where: { id }, select: SELECT })) };
}

// Refuses while anyone is still on the team — same posture as deleting a
// calendar that is still mapped — so a delete never silently un-teams people.
async function remove(orgId, id) {
  const existing = await prisma.team.findFirst({ where: { id, org_id: orgId }, select: { _count: { select: { members: true } } } });
  if (!existing) return { error: 'not_found' };
  if (existing._count.members > 0) return { error: 'in_use', count: existing._count.members };
  // Past membership is history (team capacity / movement reports read it).
  if (await prisma.teamMembershipPeriod.count({ where: { team_id: id } })) return { error: 'has_history' };
  await prisma.team.delete({ where: { id } });
  return { deleted: true };
}

module.exports = { list, create, update, remove };
