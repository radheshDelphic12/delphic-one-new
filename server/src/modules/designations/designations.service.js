const prisma = require('../../config/db');

const SELECT = { id: true, name: true, department_id: true, created_at: true, updated_at: true };

// Client brief's HR directory (org-scoped, unlike Department which predates
// multi-tenancy and stays global-unique for now — see schema.prisma comment).
async function list(orgId) {
  return prisma.designation.findMany({ where: { org_id: orgId }, select: SELECT, orderBy: { name: 'asc' } });
}

async function create(orgId, { name, department_id }) {
  const existing = await prisma.designation.findUnique({ where: { org_id_name: { org_id: orgId, name } } });
  if (existing) return { error: 'name_taken' };
  const designation = await prisma.designation.create({ data: { org_id: orgId, name, department_id }, select: SELECT });
  return { designation };
}

async function update(orgId, id, { name, department_id }) {
  const existing = await prisma.designation.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (name) {
    const clash = await prisma.designation.findFirst({ where: { org_id: orgId, name, NOT: { id } } });
    if (clash) return { error: 'name_taken' };
  }
  const designation = await prisma.designation.update({
    where: { id },
    data: { ...(name ? { name } : {}), ...(department_id !== undefined ? { department_id } : {}) },
    select: SELECT,
  });
  return { designation };
}

/** Delete a designation nobody holds any more (people who left lose the link); refused with the count while people hold it. */
async function remove(orgId, id) {
  const existing = await prisma.designation.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  const people = await prisma.orgMembership.count({ where: { org_id: orgId, designation_id: id, employment_status: { not: 'terminated' } } });
  if (people > 0) return { error: 'in_use', people };
  await prisma.orgMembership.updateMany({ where: { org_id: orgId, designation_id: id }, data: { designation_id: null } });
  await prisma.designation.delete({ where: { id } });
  return { removed: true };
}

module.exports = { list, create, update, remove };
