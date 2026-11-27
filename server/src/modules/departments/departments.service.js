const prisma = require('../../config/db');

const SELECT = { id: true, name: true, created_at: true, updated_at: true };

async function list(orgId) {
  return prisma.department.findMany({ where: { org_id: orgId }, select: SELECT, orderBy: { name: 'asc' } });
}

async function create(orgId, { name }) {
  const existing = await prisma.department.findFirst({ where: { org_id: orgId, name } });
  if (existing) return { error: 'name_taken' };
  const department = await prisma.department.create({ data: { org_id: orgId, name }, select: SELECT });
  return { department };
}

async function update(orgId, id, { name }) {
  const clash = await prisma.department.findFirst({ where: { org_id: orgId, name, NOT: { id } } });
  if (clash) return { error: 'name_taken' };
  const existing = await prisma.department.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  const department = await prisma.department.update({ where: { id }, data: { name }, select: SELECT });
  return { department };
}

/** Delete a department nobody uses any more; while it is in use the answer says how many people / designations / teams / calendars use it. */
async function remove(orgId, id) {
  const existing = await prisma.department.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  const [people, designations, teams, calendars] = await Promise.all([
    prisma.orgMembership.count({ where: { org_id: orgId, department_id: id, employment_status: { not: 'terminated' } } }),
    prisma.designation.count({ where: { org_id: orgId, department_id: id } }),
    prisma.team.count({ where: { org_id: orgId, department_id: id } }),
    prisma.calendar.count({ where: { org_id: orgId, department_id: id } }),
  ]);
  if (people + designations + teams + calendars > 0) return { error: 'in_use', people, designations, teams, calendars };
  // people who left keep no link to a deleted department
  await prisma.orgMembership.updateMany({ where: { org_id: orgId, department_id: id }, data: { department_id: null } });
  await prisma.department.delete({ where: { id } });
  return { removed: true };
}

module.exports = { list, create, update, remove };
