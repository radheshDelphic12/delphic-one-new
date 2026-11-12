const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');

const SCOPES = ['initiative', 'expense', 'funding'];

const settingsSchema = z.object({
  campaign_prefix: z.string().trim().min(1).max(12).optional(),
  block_overspend: z.boolean().optional(),
  forecast_method: z.enum(['plan', 'run_rate']).optional(),
  run_rate_months: z.coerce.number().int().min(2).max(12).optional(),
  ending_soon_days: z.coerce.number().int().min(1).max(365).optional(),
  reason: z.string().trim().max(500).optional(),
});
const categoryCreateSchema = z.object({ scope: z.enum(SCOPES), name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).optional(), sort_order: z.coerce.number().int().min(0).max(9999).optional() });
const categoryUpdateSchema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).nullable(), active: z.boolean(), sort_order: z.coerce.number().int().min(0).max(9999) }).partial();

// Starting points only: the foundation adds, renames and switches off its own.
const DEFAULT_CATEGORIES = {
  initiative: ['Child Care', 'Education', 'Healthcare', 'Food Distribution', 'Women Empowerment', 'Environmental Protection', 'Community Development'],
  expense: ['Campaign expenditure', 'Investment / disbursement', 'Operational expense', 'Equipment / material purchase', 'Service payment', 'Travel / logistics', 'Salaries and stipends', 'Other expense'],
  funding: ['Donation', 'Grant', 'Sponsor contribution', 'Foundation allocation', 'Other funding'],
};

const settingOut = (s) => ({
  currency: s.currency,
  campaign_prefix: s.campaign_prefix,
  block_overspend: s.block_overspend,
  forecast_method: s.forecast_method,
  run_rate_months: s.run_rate_months,
  ending_soon_days: s.ending_soon_days,
});

// Created lazily with defaults, so a foundation org needs no seeding step.
async function ensureSettings(orgId) {
  const existing = await prisma.fxSetting.findUnique({ where: { org_id: orgId } });
  if (existing) return existing;
  try {
    return await prisma.fxSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  } catch (err) {
    if (err.code === 'P2002') return prisma.fxSetting.findUnique({ where: { org_id: orgId } });
    throw err;
  }
}

async function ensureCategories(orgId) {
  if ((await prisma.fxCategory.count({ where: { org_id: orgId } })) > 0) return;
  const data = [];
  for (const scope of SCOPES) DEFAULT_CATEGORIES[scope].forEach((name, i) => data.push({ org_id: orgId, scope, name, sort_order: i }));
  await prisma.fxCategory.createMany({ data, skipDuplicates: true });
}

async function me(req) {
  const org = await prisma.org.findUnique({ where: { id: req.user.org_id }, select: { id: true, name: true, slug: true } });
  const s = await ensureSettings(req.user.org_id);
  return { user: { id: req.user.id, name: req.user.name, email: req.user.email }, org, role: req.fx.role, caps: req.fx.caps, person_id: req.fx.person_id, currency: s.currency };
}

const getSettings = async (orgId) => settingOut(await ensureSettings(orgId));

async function updateSettings(orgId, actorId, input) {
  const { reason, ...fields } = input;
  const before = await ensureSettings(orgId);
  const row = await prisma.fxSetting.update({ where: { org_id: orgId }, data: fields });
  await writeAudit(null, { orgId, actorId, entity: 'setting', entityId: row.id, action: 'update', before: settingOut(before), after: settingOut(row), reason });
  return { settings: settingOut(row) };
}

async function listCategories(orgId, scope) {
  await ensureCategories(orgId);
  return prisma.fxCategory.findMany({ where: { org_id: orgId, deleted_at: null, ...(scope ? { scope } : {}) }, orderBy: [{ scope: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }] });
}

async function createCategory(orgId, actorId, input) {
  const dup = await prisma.fxCategory.findFirst({ where: { org_id: orgId, scope: input.scope, name: input.name } });
  if (dup && !dup.deleted_at) return { error: 'duplicate' };
  const category = dup
    ? await prisma.fxCategory.update({ where: { id: dup.id }, data: { deleted_at: null, active: true, description: input.description ?? dup.description, sort_order: input.sort_order ?? dup.sort_order } })
    : await prisma.fxCategory.create({ data: { org_id: orgId, created_by: actorId, ...input } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: category.id, action: 'create', after: { scope: category.scope, name: category.name } });
  return { category };
}

async function updateCategory(orgId, actorId, id, input) {
  const before = await prisma.fxCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (input.name && input.name !== before.name && (await prisma.fxCategory.findFirst({ where: { org_id: orgId, scope: before.scope, name: input.name, NOT: { id } } }))) return { error: 'duplicate' };
  const category = await prisma.fxCategory.update({ where: { id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'update', before: { name: before.name, active: before.active }, after: { name: category.name, active: category.active } });
  return { category };
}

async function deleteCategory(orgId, actorId, id) {
  const before = await prisma.fxCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.fxCategory.update({ where: { id }, data: { deleted_at: new Date(), active: false } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'delete', before: { scope: before.scope, name: before.name } });
  return { ok: true };
}

async function listAudit(orgId, { entity, entity_id, limit = 100 } = {}) {
  return prisma.fxAudit.findMany({ where: { org_id: orgId, ...(entity ? { entity } : {}), ...(entity_id ? { entity_id } : {}) }, orderBy: { created_at: 'desc' }, take: Math.min(Number(limit) || 100, 200) });
}

module.exports = {
  SCOPES, settingsSchema, categoryCreateSchema, categoryUpdateSchema, ensureSettings, ensureCategories, me, getSettings, updateSettings,
  listCategories, createCategory, updateCategory, deleteCategory, listAudit,
};
