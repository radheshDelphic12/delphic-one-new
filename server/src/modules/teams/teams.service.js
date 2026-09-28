const prisma = require('../../config/db');

const SELECT = {
  id: true,
  name: true,
  department_id: true,
  department: { select: { id: true, name: true } },
  lead_membership_id: true,
  lead: { select: { id: true, person: { select: { id: true, name: true } } } },
  created_at: true,
  updated_at: true,
  _count: { select: { members: true } },
};

function serialize({ _count, ...team }) {
  return { ...team, member_count: _count.members };
}

// HR Settings → Teams (org-scoped, same shape as designations). A team's
// department and lead must both belong to the same org.
async function checkRefs(orgId, { department_id, lead_membership_id }) {
  if (department_id) {
    const department = await prisma.department.findFirst({ where: { id: department_id, org_id: orgId } });
    if (!department) return 'department_not_found';
  }
  if (lead_membership_id) {
    const lead = await prisma.orgMembership.findFirst({ where: { id: lead_membership_id, org_id: orgId } });
    if (!lead) return 'lead_not_found';
  }
  return null;
}

async function list(orgId) {
  const rows = await prisma.team.findMany({ where: { org_id: orgId }, select: SELECT, orderBy: { name: 'asc' } });
  return rows.map(serialize);
}

async function create(orgId, body) {
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
    },
    select: SELECT,
  });
  return { team: serialize(team) };
}

async function update(orgId, id, patch) {
  const existing = await prisma.team.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (patch.name) {
    const clash = await prisma.team.findFirst({ where: { org_id: orgId, name: patch.name, NOT: { id } } });
    if (clash) return { error: 'name_taken' };
  }
  const refError = await checkRefs(orgId, patch);
  if (refError) return { error: refError };
  const team = await prisma.team.update({ where: { id }, data: patch, select: SELECT });
  return { team: serialize(team) };
}

// Refuses while anyone is still on the team — same posture as deleting a
// calendar that is still mapped — so a delete never silently un-teams people.
async function remove(orgId, id) {
  const existing = await prisma.team.findFirst({ where: { id, org_id: orgId }, select: { _count: { select: { members: true } } } });
  if (!existing) return { error: 'not_found' };
  if (existing._count.members > 0) return { error: 'in_use', count: existing._count.members };
  await prisma.team.delete({ where: { id } });
  return { deleted: true };
}

module.exports = { list, create, update, remove };
