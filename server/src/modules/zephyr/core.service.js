const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');

const METHODS = ['manual', 'revenue_multiple', 'profit_multiple'];
const KINDS = ['revenue', 'expense'];

const settingsSchema = z.object({
  valuation_method: z.enum(METHODS).optional(),
  valuation_multiple: z.coerce.number().min(0).max(1000).optional(),
  valuation_manual: z.coerce.number().min(0).nullable().optional(),
  project_prefix: z.string().trim().min(1).max(12).optional(),
  lead_prefix: z.string().trim().min(1).max(12).optional(),
  property_prefix: z.string().trim().min(1).max(12).optional(),
  task_prefix: z.string().trim().min(1).max(12).optional(),
  reason: z.string().trim().max(500).optional(),
});
const categoryCreateSchema = z.object({
  kind: z.enum(KINDS),
  name: z.string().trim().min(1).max(80),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
});
const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
});
const DEFAULT_CATEGORIES = {
  revenue: ['Project billing', 'Property sale', 'Rental income', 'Consulting commission', 'Other income'],
  expense: ['Materials', 'Labour', 'Subcontractor', 'Equipment', 'Site overheads', 'Office', 'Maintenance & repairs', 'Property tax & utilities', 'Other expense'],
};

const num = (v) => (v == null ? null : Number(v));
const settingOut = (s) => ({
  currency: s.currency,
  valuation_method: s.valuation_method,
  valuation_multiple: num(s.valuation_multiple),
  valuation_manual: num(s.valuation_manual),
  project_prefix: s.project_prefix,
  lead_prefix: s.lead_prefix,
  property_prefix: s.property_prefix,
  task_prefix: s.task_prefix,
});

// Created lazily with defaults so a Zephyr org needs no seeding step.
async function ensureSettings(orgId) {
  const existing = await prisma.zxSetting.findUnique({ where: { org_id: orgId } });
  if (existing) return existing;
  return prisma.zxSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
}

async function ensureCategories(orgId) {
  if ((await prisma.zxCategory.count({ where: { org_id: orgId } })) > 0) return;
  const data = [];
  for (const kind of KINDS) DEFAULT_CATEGORIES[kind].forEach((name, i) => data.push({ org_id: orgId, kind, name, sort_order: i }));
  await prisma.zxCategory.createMany({ data, skipDuplicates: true });
}

async function me(req) {
  const org = await prisma.org.findUnique({ where: { id: req.user.org_id }, select: { id: true, name: true, slug: true } });
  const s = await ensureSettings(req.user.org_id);
  return {
    user: { id: req.user.id, name: req.user.name, email: req.user.email },
    org,
    role: req.zx.role,
    caps: req.zx.caps,
    person_id: req.zx.person_id,
    currency: s.currency,
  };
}

async function getSettings(orgId) {
  return settingOut(await ensureSettings(orgId));
}

async function updateSettings(orgId, actorId, input) {
  const { reason, ...fields } = input;
  const before = await ensureSettings(orgId);
  const method = fields.valuation_method ?? before.valuation_method;
  const manual = fields.valuation_manual === undefined ? before.valuation_manual : fields.valuation_manual;
  if (method === 'manual' && manual == null) return { error: 'manual_value_required' };
  const row = await prisma.zxSetting.update({ where: { org_id: orgId }, data: fields });
  await writeAudit(null, { orgId, actorId, entity: 'setting', entityId: row.id, action: 'update', before: settingOut(before), after: settingOut(row), reason });
  return { settings: settingOut(row) };
}

async function listCategories(orgId, kind) {
  await ensureCategories(orgId);
  return prisma.zxCategory.findMany({
    where: { org_id: orgId, deleted_at: null, ...(kind ? { kind } : {}) },
    orderBy: [{ kind: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }],
  });
}

async function createCategory(orgId, actorId, input) {
  const dup = await prisma.zxCategory.findFirst({ where: { org_id: orgId, kind: input.kind, name: input.name } });
  if (dup && !dup.deleted_at) return { error: 'duplicate' };
  const category = dup
    ? await prisma.zxCategory.update({ where: { id: dup.id }, data: { deleted_at: null, active: true, sort_order: input.sort_order ?? dup.sort_order } })
    : await prisma.zxCategory.create({ data: { org_id: orgId, ...input } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: category.id, action: 'create', after: { kind: category.kind, name: category.name } });
  return { category };
}

async function updateCategory(orgId, actorId, id, input) {
  const before = await prisma.zxCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (input.name && input.name !== before.name) {
    const dup = await prisma.zxCategory.findFirst({ where: { org_id: orgId, kind: before.kind, name: input.name, NOT: { id } } });
    if (dup) return { error: 'duplicate' };
  }
  const category = await prisma.zxCategory.update({ where: { id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'update', before: { name: before.name, active: before.active }, after: { name: category.name, active: category.active } });
  return { category };
}

async function deleteCategory(orgId, actorId, id) {
  const before = await prisma.zxCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.zxCategory.update({ where: { id }, data: { deleted_at: new Date(), active: false } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'delete', before: { kind: before.kind, name: before.name } });
  return { ok: true };
}

async function listAudit(orgId, { entity, limit = 100 } = {}) {
  return prisma.zxAudit.findMany({
    where: { org_id: orgId, ...(entity ? { entity } : {}) },
    orderBy: { created_at: 'desc' },
    take: Math.min(Number(limit) || 100, 200),
  });
}

module.exports = {
  settingsSchema, categoryCreateSchema, categoryUpdateSchema,
  ensureCategories, me, getSettings, updateSettings, listCategories, createCategory, updateCategory, deleteCategory,
  listAudit,
};
