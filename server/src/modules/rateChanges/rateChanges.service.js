const prisma = require('../../config/db');

const SUBMISSION_FIELDS = ['proposed_rate', 'vendor_rate', 'final_agreed_rate'];
const REQUIREMENT_FIELDS = ['budget_min', 'budget_max'];
const num = (v) => (v === null || v === undefined ? null : Number(v));

// The rate values a patch really changes (new value differs from the stored one).
function diff(existing, patch, fields) {
  return fields
    .filter((f) => patch[f] !== undefined && num(patch[f]) !== num(existing[f]))
    .map((f) => ({ field: f, old_value: num(existing[f]), new_value: num(patch[f]) }));
}

// A reason is needed only when an already-set rate is being replaced (first-time entry needs none).
const needsReason = (changes) => changes.some((c) => c.old_value !== null);

async function record(client, { entityType, entityId, orgId, userId, currency, reason, changes }) {
  if (!changes.length) return;
  await client.rateChange.createMany({
    data: changes.map((c) => ({ org_id: orgId || null, entity_type: entityType, entity_id: entityId, field: c.field, old_value: c.old_value, new_value: c.new_value, currency: currency || null, reason: reason || null, changed_by: userId || null })),
  });
}

async function list(entityType, entityId) {
  const rows = await prisma.rateChange.findMany({ where: { entity_type: entityType, entity_id: entityId }, orderBy: { changed_at: 'desc' }, take: 200 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.changed_by).filter(Boolean))] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, field: r.field, old_value: num(r.old_value), new_value: num(r.new_value), currency: r.currency, reason: r.reason, changed_by: r.changed_by ? names.get(r.changed_by) || null : null, changed_at: r.changed_at }));
}

module.exports = { SUBMISSION_FIELDS, REQUIREMENT_FIELDS, diff, needsReason, record, list };
