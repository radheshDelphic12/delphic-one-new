const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const { SERVICE_TYPES } = require('./serviceTypes');

const KINDS = ['revenue', 'expense'];

const settingsSchema = z.object({
  profit_multiplier: z.coerce.number().min(0).max(100000).optional(),
  asset_multiplier: z.coerce.number().min(0).max(100000).optional(),
  include_investments_in_assets: z.boolean().optional(),
  lead_prefix: z.string().trim().min(1).max(12).optional(),
  deal_prefix: z.string().trim().min(1).max(12).optional(),
  task_prefix: z.string().trim().min(1).max(12).optional(),
  investment_prefix: z.string().trim().min(1).max(12).optional(),
  reason: z.string().trim().max(500).optional(),
});
const categoryCreateSchema = z.object({ kind: z.enum(KINDS), name: z.string().trim().min(1).max(80), sort_order: z.coerce.number().int().min(0).max(9999).optional() });
const categoryUpdateSchema = z.object({ name: z.string().trim().min(1).max(80), active: z.boolean(), sort_order: z.coerce.number().int().min(0).max(9999) }).partial();

const DEFAULT_CATEGORIES = {
  revenue: ['Consulting fees', 'Advisory fees', 'Transaction fees', 'Valuation fees', 'Realised investment gain', 'Other income'],
  expense: ['Professional fees', 'Travel', 'Documentation', 'Legal', 'Consulting expenses', 'Advisory expenses', 'Transaction expenses', 'Bank charges', 'Office', 'Other expense'],
};

const num = (v) => (v == null ? null : Number(v));
const settingOut = (s) => ({
  currency: s.currency,
  profit_multiplier: num(s.profit_multiplier),
  asset_multiplier: num(s.asset_multiplier),
  include_investments_in_assets: s.include_investments_in_assets,
  lead_prefix: s.lead_prefix,
  deal_prefix: s.deal_prefix,
  task_prefix: s.task_prefix,
  investment_prefix: s.investment_prefix,
});

// Created lazily with defaults so an Acconcy org needs no seeding step.
async function ensureSettings(orgId) {
  const existing = await prisma.axSetting.findUnique({ where: { org_id: orgId } });
  if (existing) return existing;
  try {
    return await prisma.axSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  } catch (err) {
    // Two requests (e.g. the group dashboard's current and previous period) can create the row at the same moment.
    if (err.code === 'P2002') return prisma.axSetting.findUnique({ where: { org_id: orgId } });
    throw err;
  }
}

async function ensureCategories(orgId) {
  if ((await prisma.axCategory.count({ where: { org_id: orgId } })) > 0) return;
  const data = [];
  for (const kind of KINDS) DEFAULT_CATEGORIES[kind].forEach((name, i) => data.push({ org_id: orgId, kind, name, sort_order: i }));
  await prisma.axCategory.createMany({ data, skipDuplicates: true });
}

async function me(req) {
  const org = await prisma.org.findUnique({ where: { id: req.user.org_id }, select: { id: true, name: true, slug: true } });
  const s = await ensureSettings(req.user.org_id);
  return { user: { id: req.user.id, name: req.user.name, email: req.user.email }, org, role: req.ax.role, caps: req.ax.caps, person_id: req.ax.person_id, currency: s.currency, service_types: SERVICE_TYPES };
}

const getSettings = async (orgId) => settingOut(await ensureSettings(orgId));

// Changing a multiplier is audited with its old and new values (valuation history keeps the multipliers used at the time).
async function updateSettings(orgId, actorId, input) {
  const { reason, ...fields } = input;
  const before = await ensureSettings(orgId);
  const row = await prisma.axSetting.update({ where: { org_id: orgId }, data: fields });
  await writeAudit(null, { orgId, actorId, entity: 'setting', entityId: row.id, action: 'update', before: settingOut(before), after: settingOut(row), reason });
  return { settings: settingOut(row) };
}

async function listCategories(orgId, kind) {
  await ensureCategories(orgId);
  return prisma.axCategory.findMany({ where: { org_id: orgId, deleted_at: null, ...(kind ? { kind } : {}) }, orderBy: [{ kind: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }] });
}

async function createCategory(orgId, actorId, input) {
  const dup = await prisma.axCategory.findFirst({ where: { org_id: orgId, kind: input.kind, name: input.name } });
  if (dup && !dup.deleted_at) return { error: 'duplicate' };
  const category = dup
    ? await prisma.axCategory.update({ where: { id: dup.id }, data: { deleted_at: null, active: true, sort_order: input.sort_order ?? dup.sort_order } })
    : await prisma.axCategory.create({ data: { org_id: orgId, ...input } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: category.id, action: 'create', after: { kind: category.kind, name: category.name } });
  return { category };
}
async function updateCategory(orgId, actorId, id, input) {
  const before = await prisma.axCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (input.name && input.name !== before.name && (await prisma.axCategory.findFirst({ where: { org_id: orgId, kind: before.kind, name: input.name, NOT: { id } } }))) return { error: 'duplicate' };
  const category = await prisma.axCategory.update({ where: { id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'update', before: { name: before.name, active: before.active }, after: { name: category.name, active: category.active } });
  return { category };
}
async function deleteCategory(orgId, actorId, id) {
  const before = await prisma.axCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.axCategory.update({ where: { id }, data: { deleted_at: new Date(), active: false } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'delete', before: { kind: before.kind, name: before.name } });
  return { ok: true };
}

async function listAudit(orgId, { entity, limit = 100 } = {}) {
  return prisma.axAudit.findMany({ where: { org_id: orgId, ...(entity ? { entity } : {}) }, orderBy: { created_at: 'desc' }, take: Math.min(Number(limit) || 100, 200) });
}

module.exports = {
  settingsSchema, categoryCreateSchema, categoryUpdateSchema, ensureSettings, ensureCategories, me, getSettings, updateSettings,
  listCategories, createCategory, updateCategory, deleteCategory, listAudit,
};
