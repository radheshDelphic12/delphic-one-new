const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');

// ownership_type (Company-owned / Franchise / Third-party ...) and format (Retail pharmacy, Distributor ...) are the lists an outlet picks from; the company edits them like any category. An ownership type carries a `kind` that drives the accounting.
const SCOPES = ['investment', 'income', 'expense', 'ownership_type', 'format', 'product_category', 'return_reason'];
// The accounting treatment of an ownership type; the admin may add more types and pick one of these for each.
const OWNERSHIP_KINDS = ['company_owned', 'franchise', 'third_party', 'other'];
const DEFAULT_KINDS = { 'Company-owned': 'company_owned', Franchise: 'franchise', 'Third-party': 'third_party', 'Other arrangement': 'other' };
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const settingsSchema = z.object({
  investment_prefix: z.string().trim().min(1).max(12).optional(),
  outlet_prefix: z.string().trim().min(1).max(12).optional(),
  opening_balance: z.coerce.number().min(-1e12).max(1e12).nullable().optional(),
  opening_date: dateStr.nullable().optional(),
  fy_start_month: z.coerce.number().int().min(1).max(12).optional(),
  invoice_timing: z.enum(['delivery', 'dispatch', 'order']).optional(),
  expiry_warning_days: z.coerce.number().int().min(0).max(1000).optional(),
  expiry_block_days: z.coerce.number().int().min(0).max(1000).optional(),
  require_transfer_approval: z.boolean().optional(),
  invoice_prefix: z.string().trim().min(1).max(12).optional(),
  default_gst_rate: z.coerce.number().min(0).max(100).optional(),
  reason: z.string().trim().max(500).optional(),
});
const categoryCreateSchema = z.object({ scope: z.enum(SCOPES), name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).optional(), sort_order: z.coerce.number().int().min(0).max(9999).optional(), kind: z.enum(OWNERSHIP_KINDS).nullable().optional() });
const categoryUpdateSchema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).nullable(), active: z.boolean(), sort_order: z.coerce.number().int().min(0).max(9999), kind: z.enum(OWNERSHIP_KINDS).nullable() }).partial();

// Starting points only: the company adds, renames and switches off its own.
const DEFAULT_CATEGORIES = {
  investment: ['Outlet set-up', 'Equipment purchase', 'Land / lease', 'Inventory investment', 'Working capital', 'Other investment'],
  income: ['Product sales', 'Franchise fees and royalties', 'Other business income', 'Interest', 'Other income'],
  expense: ['Outlet operations', 'Product purchases', 'Freight and logistics', 'Fuel and vehicle', 'Labour and contractors', 'Outlet rent and utilities', 'Repairs and maintenance', 'Licences and compliance', 'Marketing', 'Administration', 'Other expense'],
  ownership_type: ['Company-owned', 'Franchise', 'Third-party', 'Other arrangement'],
  product_category: ['Medicines', 'Healthcare products', 'Medical supplies', 'Surgical and consumables', 'Other'],
  return_reason: ['Damaged in transit', 'Expired / near expiry', 'Wrong item', 'Customer return', 'Quality complaint', 'Recall', 'Other'],
  format: ['Retail pharmacy', 'Wholesale distributor', 'Hospital pharmacy', 'Clinic counter', 'Warehouse outlet', 'Other'],
};

const settingOut = (s) => ({
  currency: s.currency,
  investment_prefix: s.investment_prefix,
  outlet_prefix: s.outlet_prefix,
  opening_balance: s.opening_balance === null ? null : Number(s.opening_balance),
  opening_date: s.opening_date ? new Date(s.opening_date).toISOString().slice(0, 10) : null,
  fy_start_month: s.fy_start_month,
  invoice_timing: s.invoice_timing,
  expiry_warning_days: s.expiry_warning_days,
  expiry_block_days: s.expiry_block_days,
  require_transfer_approval: s.require_transfer_approval,
  invoice_prefix: s.invoice_prefix,
  default_gst_rate: Number(s.default_gst_rate),
});

// Created lazily with defaults, so the company needs no seeding step.
async function ensureSettings(orgId) {
  const existing = await prisma.nxSetting.findUnique({ where: { org_id: orgId } });
  if (existing) return existing;
  try {
    return await prisma.nxSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  } catch (err) {
    if (err.code === 'P2002') return prisma.nxSetting.findUnique({ where: { org_id: orgId } });
    throw err;
  }
}

async function ensureCategories(orgId) {
  // Per scope, so a company created before a scope existed (e.g. product categories) still gets its starting list.
  const have = new Set((await prisma.nxCategory.groupBy({ by: ['scope'], where: { org_id: orgId } })).map((r) => r.scope));
  if (have.size > 0 && SCOPES.every((s) => have.has(s))) return;
  const data = [];
  for (const scope of SCOPES) {
    if (have.has(scope)) continue;
    DEFAULT_CATEGORIES[scope].forEach((name, i) => data.push({ org_id: orgId, scope, name, sort_order: i, ...(scope === 'ownership_type' ? { kind: DEFAULT_KINDS[name] || 'other' } : {}) }));
  }
  if (data.length) await prisma.nxCategory.createMany({ data, skipDuplicates: true });
}

async function me(req) {
  const org = await prisma.org.findUnique({ where: { id: req.user.org_id }, select: { id: true, name: true, slug: true } });
  const s = await ensureSettings(req.user.org_id);
  return { user: { id: req.user.id, name: req.user.name, email: req.user.email }, org, role: req.nx.role, caps: req.nx.caps, person_id: req.nx.person_id, currency: s.currency, fy_start_month: s.fy_start_month };
}

const getSettings = async (orgId) => settingOut(await ensureSettings(orgId));

async function updateSettings(orgId, actorId, input) {
  const { reason, opening_date, ...fields } = input;
  const before = await ensureSettings(orgId);
  const data = { ...fields, ...(opening_date !== undefined ? { opening_date: opening_date ? new Date(`${opening_date}T00:00:00.000Z`) : null } : {}) };
  const row = await prisma.nxSetting.update({ where: { org_id: orgId }, data });
  await writeAudit(null, { orgId, actorId, entity: 'setting', entityId: row.id, action: 'update', before: settingOut(before), after: settingOut(row), reason });
  return { settings: settingOut(row) };
}

async function listCategories(orgId, scope) {
  await ensureCategories(orgId);
  return prisma.nxCategory.findMany({ where: { org_id: orgId, deleted_at: null, ...(scope ? { scope } : {}) }, orderBy: [{ scope: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }] });
}

async function createCategory(orgId, actorId, input) {
  const dup = await prisma.nxCategory.findFirst({ where: { org_id: orgId, scope: input.scope, name: input.name } });
  if (dup && !dup.deleted_at) return { error: 'duplicate' };
  const category = dup
    ? await prisma.nxCategory.update({ where: { id: dup.id }, data: { deleted_at: null, active: true, description: input.description ?? dup.description, sort_order: input.sort_order ?? dup.sort_order, kind: input.kind ?? dup.kind } })
    : await prisma.nxCategory.create({ data: { org_id: orgId, created_by: actorId, ...input } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: category.id, action: 'create', after: { scope: category.scope, name: category.name } });
  return { category };
}

async function updateCategory(orgId, actorId, id, input) {
  const before = await prisma.nxCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (input.name && input.name !== before.name && (await prisma.nxCategory.findFirst({ where: { org_id: orgId, scope: before.scope, name: input.name, NOT: { id } } }))) return { error: 'duplicate' };
  const category = await prisma.nxCategory.update({ where: { id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'update', before: { name: before.name, active: before.active }, after: { name: category.name, active: category.active } });
  return { category };
}

async function deleteCategory(orgId, actorId, id) {
  const before = await prisma.nxCategory.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.nxCategory.update({ where: { id }, data: { deleted_at: new Date(), active: false } });
  await writeAudit(null, { orgId, actorId, entity: 'category', entityId: id, action: 'delete', before: { scope: before.scope, name: before.name } });
  return { ok: true };
}

/** One outlet-filter for every record that carries an outlet: an outlet, "none" (company level), an ownership type or a format. */
function outletWhere(f = {}) {
  const and = [];
  if (f.outlet_id === 'none') and.push({ outlet_id: null });
  else if (f.outlet_id) and.push({ outlet_id: f.outlet_id });
  const s = {};
  if (f.ownership_type_id) s.ownership_type_id = f.ownership_type_id;
  if (f.format_id) s.format_id = f.format_id;
  if (Object.keys(s).length) and.push({ outlet: s });
  return and.length ? { AND: and } : {};
}

/** A record may only point at an outlet of THIS company; a closed outlet takes no new records (history stays). */
async function outletCheck(orgId, outletId, { creating = false } = {}) {
  if (!outletId) return null;
  const outlet = await prisma.nxOutlet.findFirst({ where: { id: outletId, org_id: orgId }, select: { id: true, status: true } });
  if (!outlet) return 'outlet_not_found';
  if (creating && outlet.status === 'closed') return 'outlet_closed';
  return null;
}

async function listAudit(orgId, { entity, entity_id, limit = 100 } = {}) {
  return prisma.nxAudit.findMany({ where: { org_id: orgId, ...(entity ? { entity } : {}), ...(entity_id ? { entity_id } : {}) }, orderBy: { created_at: 'desc' }, take: Math.min(Number(limit) || 100, 200) });
}

module.exports = {
  SCOPES, OWNERSHIP_KINDS, settingsSchema, categoryCreateSchema, categoryUpdateSchema, ensureSettings, ensureCategories, me, getSettings, updateSettings,
  listCategories, createCategory, updateCategory, deleteCategory, listAudit, outletWhere, outletCheck,
};
