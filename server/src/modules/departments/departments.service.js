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

module.exports = { list, create, update };
