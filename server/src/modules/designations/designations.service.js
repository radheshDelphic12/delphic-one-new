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

module.exports = { list, create, update };
