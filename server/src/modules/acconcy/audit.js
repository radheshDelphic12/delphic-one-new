const prisma = require('../../config/db');

// Acconcy's own audit trail (not the Delphic audit_logs).
async function writeAudit(db, { orgId, actorId, entity, entityId, action, before, after, reason }) {
  return (db || prisma).axAudit.create({
    data: {
      org_id: orgId,
      actor_id: actorId || null,
      entity,
      entity_id: entityId || null,
      action,
      before: before ?? undefined,
      after: after ?? undefined,
      reason: reason || null,
    },
  });
}

module.exports = { writeAudit };
