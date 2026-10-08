const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');

// The five built-in Zephyr services. Their KEYS are fixed (business logic depends on them: rent, trading and
// consulting rules); the label, order and active flag are data an admin can change. An admin can also add
// further services of their own (key `custom_<name>`): they work for leads, projects and money, with no special rules.
const SERVICE_DEFAULTS = [
  { key: 'civil_construction', label: 'Civil Construction' },
  { key: 'interior_design', label: 'Interior Design' },
  { key: 'property_management', label: 'Property Management' },
  { key: 'property_trading', label: 'Property Trading' },
  { key: 'real_estate_consulting', label: 'Real Estate Consulting' },
];
const SERVICE_KEYS = SERVICE_DEFAULTS.map((s) => s.key);
const serviceKey = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, 'Unknown service');
const createServiceSchema = z.object({ label: z.string().trim().min(1).max(80) });

const updateServiceSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  sort_order: z.coerce.number().int().min(0).max(100).optional(),
});

async function ensure(orgId) {
  const count = await prisma.zxServiceType.count({ where: { org_id: orgId } });
  if (count >= SERVICE_DEFAULTS.length) return;
  await prisma.zxServiceType.createMany({
    data: SERVICE_DEFAULTS.map((s, i) => ({ org_id: orgId, key: s.key, label: s.label, sort_order: i })),
    skipDuplicates: true,
  });
}

async function list(orgId) {
  await ensure(orgId);
  return prisma.zxServiceType.findMany({ where: { org_id: orgId }, orderBy: [{ sort_order: 'asc' }, { key: 'asc' }] });
}

async function update(orgId, actorId, key, input) {
  await ensure(orgId);
  const before = await prisma.zxServiceType.findUnique({ where: { org_id_key: { org_id: orgId, key } } });
  if (!before) return { error: 'not_found' };
  const after = await prisma.zxServiceType.update({ where: { id: before.id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'service_type', entityId: before.id, action: 'update', before: { label: before.label, active: before.active }, after: { label: after.label, active: after.active } });
  return { service: after };
}

async function create(orgId, actorId, { label }) {
  await ensure(orgId);
  const rows = await prisma.zxServiceType.findMany({ where: { org_id: orgId }, select: { key: true, label: true, sort_order: true } });
  if (rows.some((r) => r.label.toLowerCase() === label.toLowerCase())) return { error: 'duplicate' };
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'service';
  let key = `custom_${slug}`;
  for (let n = 2; rows.some((r) => r.key === key); n += 1) key = `custom_${slug}_${n}`;
  const service = await prisma.zxServiceType.create({ data: { org_id: orgId, key, label, sort_order: Math.max(-1, ...rows.map((r) => r.sort_order)) + 1 } });
  await writeAudit(null, { orgId, actorId, entity: 'service_type', entityId: service.id, action: 'create', after: { key, label } });
  return { service };
}

// Every service key this company can use (built-in and its own).
async function keys(orgId) {
  return (await list(orgId)).map((s) => s.key);
}

// key -> label for the org, for decorating rows.
async function labels(orgId) {
  return new Map((await list(orgId)).map((s) => [s.key, s.label]));
}

module.exports = { SERVICE_DEFAULTS, SERVICE_KEYS, serviceKey, createServiceSchema, updateServiceSchema, list, create, update, keys, labels };
