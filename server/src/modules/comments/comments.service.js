const prisma = require('../../config/db');
const { assertCanAccessEntity } = require('../../lib/entityAccess');

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    body: row.body,
    created_at: row.created_at,
    user: row.user ? { id: row.user.id, name: row.user.name, role: row.user.role } : undefined,
  };
}

async function list({ entity_type, entity_id }, user) {
  const access = await assertCanAccessEntity(user, entity_type, entity_id);
  if (access.error) return { error: access.error };

  const rows = await prisma.comment.findMany({
    where: { entity_type, entity_id },
    orderBy: { created_at: 'asc' },
    include: { user: { select: { id: true, name: true, role: true } } },
  });
  return { comments: rows.map(serialize) };
}

async function create(data, user) {
  const access = await assertCanAccessEntity(user, data.entity_type, data.entity_id, { forWrite: true });
  if (access.error) return { error: access.error };

  const row = await prisma.comment.create({
    data: { ...data, user_id: user.id },
    include: { user: { select: { id: true, name: true, role: true } } },
  });
  return { comment: serialize(row) };
}

module.exports = { list, create };
