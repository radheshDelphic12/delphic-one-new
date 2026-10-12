const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');

const SCOPES = ['investment', 'income', 'expense'];
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const settingsSchema = z.object({
  investment_prefix: z.string().trim().min(1).max(12).optional(),
  opening_balance: z.coerce.number().min(-1e12).max(1e12).nullable().optional(),
  opening_date: dateStr.nullable().optional(),
  fy_start_month: z.coerce.number().int().min(1).max(12).optional(),
  reason: z.string().trim().max(500).optional(),
});
const categoryCreateSchema = z.object({ scope: z.enum(SCOPES), name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).optional(), sort_order: z.coerce.number().int().min(0).max(9999).optional() });
const categoryUpdateSchema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).nullable(), active: z.boolean(), sort_order: z.coerce.number().int().min(0).max(9999) }).partial();

// Starting points only: the company adds, renames and switches off its own.
const DEFAULT_CATEGORIES = {
  investment: ['Equity', 'Debt / lending', 'Fixed deposit', 'Real estate', 'Fund / portfolio', 'Other investment'],
  income: ['Interest', 'Dividend', 'Sales', 'Commission', 'Rental income', 'Other income'],
  expense: ['Operations', 'Office and administration', 'Rent and utilities', 'Travel and transport', 'Marketing and business development', 'Professional and service fees', 'Equipment and assets', 'Other expense'],
};

const settingOut = (s) => ({
  currency: s.currency,
  investment_prefix: s.investment_prefix,
  opening_balance: s.opening_balance === null ? null : Number(s.opening_balance),
  opening_date: s.opening_date ? new Date(s.opening_date).toISOString().slice(0, 10) : null,
  fy_start_month: s.fy_start_month,
});

// Created lazily with defaults, so the company needs no seeding step.
async function ensureSettings(orgId) {
  const existing = await prisma.zkSetting.findUnique({ where: { org_id: orgId } });
  if (existing) return existing;
  try {
    return await prisma.zkSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  } catch (err) {
    if (err.code === 'P2002') return prisma.zkSetting.findUnique({ where: { org_id: orgId } });
    throw err;
  }
}

async function ensureCategories(orgId) {
  if ((await prisma.zkCategory.count({ where: { org_id: orgId } })) > 0) return;
  const data = [];
  for (const scope of SCOPES) DEFAULT_CATEGORIES[scope].forEach((name, i) => data.push({ org_id: orgId, scope, name, sort_order: i }));
  await prisma.zkCategory.createMany({ data, skipDuplicates: true });
}

async function me(req) {
  const org = await prisma.org.findUnique({ where: { id: req.user.org_id }, select: { id: true, name: true, slug: true } });
  const s = await ensureSettings(req.user.org_id);
  return { user: { id: req.user.id, name: req.user.name, email: req.user.email }, org, role: req.zk.role, caps: req.zk.caps, person_id: req.zk.person_id, currency: s.currency, fy_start_month: s.fy_start_month };
}

const getSettings = async (orgId) => settingOut(await ensureSettings(orgId));

async function updateSettings(orgId, actorId, input) {
  const { reason, opening_date, ...fields } = input;
  const before = await ensureSettings(orgId);
  const data = { ...fields, ...(opening_date !== undefined ? { opening_date: opening_date ? new Date(`${opening_date}T00:00:00.000Z`) : null } : {}) };
  const row = await prisma.zkSetting.update({ where: { org_id: orgId }, data });
  await writeAudit(null, { orgId, actorId, entity: 'setting', entityId: row.id, action: 'update', before: settingOut(before), after: settingOut(row), reason });
  return { settings: settingOut(row) };
}

async function listCategories(orgId, scope) {
  await ensureCategories(orgId);
  return prisma.zkCategory.findMany({ where: { org_id: orgId, deleted_at: null, ...(scope ? { scope } : {}) }, orderBy: [{ scope: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }] });
}

async function createCategory(orgId, actorId, input) {
  const dup = await prisma.zkCategory.findFirst({ where: { org_id: orgId, scope: input.scope, name: input.name } });
  if (dup && !dup.deleted_at) return { error: 'duplicate' };
  const category = dup
    ? await prisma.zkCategory.update({ where: { id: dup.id }, data: { deleted_at: null, active: true, description: input.description ?? dup.description, sort_order: input.sort_order ?? dup.sort_order } })
    : await prisma.zkCategory.create({ data: { org_id: orgId, created_by: actorId, ...input } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: category.id, action: 'create', after: { scope: category.scope, name: category.name } });
  return { category };
}

async function updateCategory(orgId, actorId, id, input) {
  const before = await prisma.zkCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (input.name && input.name !== before.name && (await prisma.zkCategory.findFirst({ where: { org_id: orgId, scope: before.scope, name: input.name, NOT: { id } } }))) return { error: 'duplicate' };
  const category = await prisma.zkCategory.update({ where: { id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'update', before: { name: before.name, active: before.active }, after: { name: category.name, active: category.active } });
  return { category };
}

async function deleteCategory(orgId, actorId, id) {
  const before = await prisma.zkCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.zkCategory.update({ where: { id }, data: { deleted_at: new Date(), active: false } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'delete', before: { scope: before.scope, name: before.name } });
  return { ok: true };
}

async function listAudit(orgId, { entity, entity_id, limit = 100 } = {}) {
  return prisma.zkAudit.findMany({ where: { org_id: orgId, ...(entity ? { entity } : {}), ...(entity_id ? { entity_id } : {}) }, orderBy: { created_at: 'desc' }, take: Math.min(Number(limit) || 100, 200) });
}

module.exports = {
  SCOPES, settingsSchema, categoryCreateSchema, categoryUpdateSchema, ensureSettings, ensureCategories, me, getSettings, updateSettings,
  listCategories, createCategory, updateCategory, deleteCategory, listAudit,
};
