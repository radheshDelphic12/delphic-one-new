const prisma = require('../../config/db');

// Audit trail of platform changes (SaaS launch plan: "all of it editable, with an audit trail"). Every edit of the catalogue, prices, settings,
// switches and platform admins writes one row here: who, what, before, after.
async function record(actorId, action, entity, entityId, before = null, after = null) {
  try {
    await prisma.saasAudit.create({ data: { actor_id: actorId || null, action, entity, entity_id: entityId == null ? null : String(entityId), before: before ?? undefined, after: after ?? undefined } });
  } catch (err) {
    // an audit failure must never block the change itself, but it must be visible
    require('../../config/logger').error('saas_audit_failed', { err, action, entity });
  }
}

async function list({ entity, limit = 100 } = {}) {
  const rows = await prisma.saasAudit.findMany({ where: entity ? { entity } : {}, orderBy: { created_at: 'desc' }, take: Math.min(limit, 500) });
  const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({ id: r.id, at: r.created_at, action: r.action, entity: r.entity, entity_id: r.entity_id, before: r.before, after: r.after, actor: byId.get(r.actor_id) || null }));
}

module.exports = { record, list };
