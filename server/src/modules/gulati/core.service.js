const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');

const METHODS = ['manual', 'revenue_multiple', 'profit_multiple'];
const KINDS = ['revenue', 'expense'];

const settingsSchema = z.object({
  valuation_method: z.enum(METHODS).optional(),
  valuation_multiple: z.coerce.number().min(0).max(1000).optional(),
  valuation_manual: z.coerce.number().min(0).nullable().optional(),
  lead_prefix: z.string().trim().min(1).max(12).optional(),
  deal_prefix: z.string().trim().min(1).max(12).optional(),
  task_prefix: z.string().trim().min(1).max(12).optional(),
  reason: z.string().trim().max(500).optional(),
});
const categoryCreateSchema = z.object({ kind: z.enum(KINDS), name: z.string().trim().min(1).max(80), sort_order: z.coerce.number().int().min(0).max(9999).optional() });
const categoryUpdateSchema = z.object({ name: z.string().trim().min(1).max(80), active: z.boolean(), sort_order: z.coerce.number().int().min(0).max(9999) }).partial();
const unitCreateSchema = z.object({ name: z.string().trim().min(1).max(40), sort_order: z.coerce.number().int().min(0).max(9999).optional() });
const unitUpdateSchema = z.object({ name: z.string().trim().min(1).max(40), active: z.boolean(), sort_order: z.coerce.number().int().min(0).max(9999) }).partial();
const keyOf = (label) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const typeCreateSchema = z.object({ label: z.string().trim().min(1).max(80), sort_order: z.coerce.number().int().min(0).max(9999).optional() });
const typeUpdateSchema = z.object({ label: z.string().trim().min(1).max(80), active: z.boolean(), sort_order: z.coerce.number().int().min(0).max(9999) }).partial();

const DEFAULT_CATEGORIES = {
  revenue: ['Trading sales', 'Other income'],
  expense: ['Transportation', 'Loading / Unloading', 'Brokerage', 'Documentation', 'Storage', 'Logistics', 'Handling', 'Bank charges', 'Office', 'Other expense'],
};
const DEFAULT_UNITS = ['Kg', 'MT', 'Ton', 'Piece', 'Other'];
const DEFAULT_TYPES = [
  { key: 'copper_cathode', label: 'Trading of Copper Cathode' },
  { key: 'trading_deals', label: 'Trading of Deals' },
];

const num = (v) => (v == null ? null : Number(v));
const settingOut = (s) => ({
  currency: s.currency,
  valuation_method: s.valuation_method,
  valuation_multiple: num(s.valuation_multiple),
  valuation_manual: num(s.valuation_manual),
  lead_prefix: s.lead_prefix,
  deal_prefix: s.deal_prefix,
  task_prefix: s.task_prefix,
});

// Created lazily with defaults so a Gulati org needs no seeding step.
async function ensureSettings(orgId) {
  const existing = await prisma.gxSetting.findUnique({ where: { org_id: orgId } });
  if (existing) return existing;
  return prisma.gxSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
}

async function ensureCategories(orgId) {
  if ((await prisma.gxCategory.count({ where: { org_id: orgId } })) > 0) return;
  const data = [];
  for (const kind of KINDS) DEFAULT_CATEGORIES[kind].forEach((name, i) => data.push({ org_id: orgId, kind, name, sort_order: i }));
  await prisma.gxCategory.createMany({ data, skipDuplicates: true });
}
async function ensureUnits(orgId) {
  if ((await prisma.gxUnit.count({ where: { org_id: orgId } })) > 0) return;
  await prisma.gxUnit.createMany({ data: DEFAULT_UNITS.map((name, i) => ({ org_id: orgId, name, sort_order: i })), skipDuplicates: true });
}
async function ensureTypes(orgId) {
  if ((await prisma.gxTradingType.count({ where: { org_id: orgId } })) > 0) return;
  await prisma.gxTradingType.createMany({ data: DEFAULT_TYPES.map((t, i) => ({ org_id: orgId, ...t, sort_order: i })), skipDuplicates: true });
}

async function me(req) {
  const org = await prisma.org.findUnique({ where: { id: req.user.org_id }, select: { id: true, name: true, slug: true } });
  const s = await ensureSettings(req.user.org_id);
  return { user: { id: req.user.id, name: req.user.name, email: req.user.email }, org, role: req.gx.role, caps: req.gx.caps, person_id: req.gx.person_id, currency: s.currency };
}

const getSettings = async (orgId) => settingOut(await ensureSettings(orgId));

async function updateSettings(orgId, actorId, input) {
  const { reason, ...fields } = input;
  const before = await ensureSettings(orgId);
  const method = fields.valuation_method ?? before.valuation_method;
  const manual = fields.valuation_manual === undefined ? before.valuation_manual : fields.valuation_manual;
  if (method === 'manual' && manual == null) return { error: 'manual_value_required' };
  const row = await prisma.gxSetting.update({ where: { org_id: orgId }, data: fields });
  await writeAudit(null, { orgId, actorId, entity: 'setting', entityId: row.id, action: 'update', before: settingOut(before), after: settingOut(row), reason });
  return { settings: settingOut(row) };
}

// --- generic master (category / unit / trading type) helpers ---
async function listMaster(model, ensure, orgId, where = {}, orderBy = [{ sort_order: 'asc' }]) {
  await ensure(orgId);
  return prisma[model].findMany({ where: { org_id: orgId, ...where }, orderBy });
}

const listCategories = (orgId, kind) =>
  listMaster('gxCategory', ensureCategories, orgId, { deleted_at: null, ...(kind ? { kind } : {}) }, [{ kind: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }]);

async function createCategory(orgId, actorId, input) {
  const dup = await prisma.gxCategory.findFirst({ where: { org_id: orgId, kind: input.kind, name: input.name } });
  if (dup && !dup.deleted_at) return { error: 'duplicate' };
  const category = dup
    ? await prisma.gxCategory.update({ where: { id: dup.id }, data: { deleted_at: null, active: true, sort_order: input.sort_order ?? dup.sort_order } })
    : await prisma.gxCategory.create({ data: { org_id: orgId, ...input } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: category.id, action: 'create', after: { kind: category.kind, name: category.name } });
  return { category };
}
async function updateCategory(orgId, actorId, id, input) {
  const before = await prisma.gxCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (input.name && input.name !== before.name && (await prisma.gxCategory.findFirst({ where: { org_id: orgId, kind: before.kind, name: input.name, NOT: { id } } }))) return { error: 'duplicate' };
  const category = await prisma.gxCategory.update({ where: { id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'update', before: { name: before.name, active: before.active }, after: { name: category.name, active: category.active } });
  return { category };
}
async function deleteCategory(orgId, actorId, id) {
  const before = await prisma.gxCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.gxCategory.update({ where: { id }, data: { deleted_at: new Date(), active: false } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'delete', before: { kind: before.kind, name: before.name } });
  return { ok: true };
}

const listUnits = (orgId) => listMaster('gxUnit', ensureUnits, orgId, { deleted_at: null }, [{ sort_order: 'asc' }, { name: 'asc' }]);
async function createUnit(orgId, actorId, input) {
  const dup = await prisma.gxUnit.findFirst({ where: { org_id: orgId, name: input.name } });
  if (dup && !dup.deleted_at) return { error: 'duplicate' };
  const unit = dup
    ? await prisma.gxUnit.update({ where: { id: dup.id }, data: { deleted_at: null, active: true } })
    : await prisma.gxUnit.create({ data: { org_id: orgId, ...input } });
  await writeAudit(null, { orgId, actorId, entity: 'unit', entityId: unit.id, action: 'create', after: { name: unit.name } });
  return { unit };
}
async function updateUnit(orgId, actorId, id, input) {
  const before = await prisma.gxUnit.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (input.name && input.name !== before.name && (await prisma.gxUnit.findFirst({ where: { org_id: orgId, name: input.name, NOT: { id } } }))) return { error: 'duplicate' };
  const unit = await prisma.gxUnit.update({ where: { id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'unit', entityId: id, action: 'update', before: { name: before.name, active: before.active }, after: { name: unit.name, active: unit.active } });
  return { unit };
}
async function deleteUnit(orgId, actorId, id) {
  const before = await prisma.gxUnit.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.gxUnit.update({ where: { id }, data: { deleted_at: new Date(), active: false } });
  await writeAudit(null, { orgId, actorId, entity: 'unit', entityId: id, action: 'delete', before: { name: before.name } });
  return { ok: true };
}

const listTypes = (orgId) => listMaster('gxTradingType', ensureTypes, orgId, {}, [{ sort_order: 'asc' }, { label: 'asc' }]);
async function typeKeys(orgId) {
  return (await listTypes(orgId)).map((t) => t.key);
}
async function createType(orgId, actorId, input) {
  await ensureTypes(orgId);
  const key = keyOf(input.label);
  if (!key) return { error: 'invalid', message: 'Give the trading type a name' };
  if (await prisma.gxTradingType.findFirst({ where: { org_id: orgId, key } })) return { error: 'duplicate' };
  const type = await prisma.gxTradingType.create({ data: { org_id: orgId, key, label: input.label, sort_order: input.sort_order ?? 99 } });
  await writeAudit(null, { orgId, actorId, entity: 'trading_type', entityId: type.id, action: 'create', after: { key, label: type.label } });
  return { type };
}
async function updateType(orgId, actorId, key, input) {
  const before = await prisma.gxTradingType.findFirst({ where: { org_id: orgId, key } });
  if (!before) return { error: 'not_found' };
  const type = await prisma.gxTradingType.update({ where: { id: before.id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'trading_type', entityId: before.id, action: 'update', before: { label: before.label, active: before.active }, after: { label: type.label, active: type.active } });
  return { type };
}

async function listAudit(orgId, { entity, limit = 100 } = {}) {
  return prisma.gxAudit.findMany({ where: { org_id: orgId, ...(entity ? { entity } : {}) }, orderBy: { created_at: 'desc' }, take: Math.min(Number(limit) || 100, 200) });
}

module.exports = {
  settingsSchema, categoryCreateSchema, categoryUpdateSchema, unitCreateSchema, unitUpdateSchema, typeCreateSchema, typeUpdateSchema,
  ensureSettings, ensureCategories, ensureUnits, ensureTypes, me, getSettings, updateSettings,
  listCategories, createCategory, updateCategory, deleteCategory, listUnits, createUnit, updateUnit, deleteUnit,
  listTypes, typeKeys, createType, updateType, listAudit,
};
