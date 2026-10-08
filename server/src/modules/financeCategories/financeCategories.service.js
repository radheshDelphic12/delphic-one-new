const prisma = require('../../config/db');

// Finance → Categories: two admin-managed lists, one for Group Charges and one
// for Expenses (same idea as HR Settings → Designations). Categories are
// deactivated, not deleted, once used — the records keep their category and
// the name stays readable; an unused one can be deleted outright.

const SELECT = { id: true, kind: true, name: true, is_active: true, created_at: true, updated_at: true };

// Sensible defaults the first time an org opens the section.
const DEFAULTS = {
  group_charge: ['Office Rent', 'Electricity', 'Internet', 'Infrastructure', 'Administration'],
  expense: ['Travel', 'Office Supplies', 'Meals', 'Client Entertainment', 'Training'],
};

async function ensureDefaults(orgId, kind) {
  const count = await prisma.financeCategory.count({ where: { org_id: orgId, kind } });
  if (count) return;
  await prisma.financeCategory.createMany({ data: DEFAULTS[kind].map((name) => ({ org_id: orgId, kind, name })), skipDuplicates: true });
}

async function list(orgId, { kind, include_inactive }) {
  await ensureDefaults(orgId, kind);
  const rows = await prisma.financeCategory.findMany({
    where: { org_id: orgId, kind, ...(include_inactive ? {} : { is_active: true }) },
    select: { ...SELECT, _count: { select: { group_charges: true, expense_claims: true } } },
    orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
  });
  return rows.map(({ _count, ...row }) => ({ ...row, usage: _count.group_charges + _count.expense_claims }));
}

async function nameTaken(orgId, kind, name, exceptId = null) {
  return prisma.financeCategory.findFirst({
    where: { org_id: orgId, kind, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
}

async function audit(orgId, actorId, action, row, reason) {
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: actorId, action, entity_type: 'finance_category', entity_id: row.id, reason: reason || action, snapshot: { kind: row.kind, name: row.name, is_active: row.is_active } },
  });
}

async function create(orgId, actorId, { kind, name }) {
  if (await nameTaken(orgId, kind, name)) return { error: 'name_taken' };
  const category = await prisma.financeCategory.create({ data: { org_id: orgId, kind, name, created_by: actorId }, select: SELECT });
  await audit(orgId, actorId, 'finance_category_create', category);
  return { category };
}

async function update(orgId, actorId, id, { name, is_active }) {
  const existing = await prisma.financeCategory.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (name && (await nameTaken(orgId, existing.kind, name, id))) return { error: 'name_taken' };
  const category = await prisma.financeCategory.update({
    where: { id },
    data: { ...(name ? { name } : {}), ...(is_active !== undefined ? { is_active } : {}) },
    select: SELECT,
  });
  await audit(orgId, actorId, 'finance_category_update', category, name && name !== existing.name ? `Renamed from ${existing.name}` : undefined);
  return { category };
}

// Deletes an unused category; one already on records is deactivated instead.
async function remove(orgId, actorId, id) {
  const existing = await prisma.financeCategory.findFirst({
    where: { id, org_id: orgId },
    include: { _count: { select: { group_charges: true, expense_claims: true } } },
  });
  if (!existing) return { error: 'not_found' };
  if (existing._count.group_charges + existing._count.expense_claims > 0) {
    const category = await prisma.financeCategory.update({ where: { id }, data: { is_active: false }, select: SELECT });
    await audit(orgId, actorId, 'finance_category_deactivate', category, 'In use — deactivated instead of deleted');
    return { category, deactivated: true };
  }
  await prisma.financeCategory.delete({ where: { id } });
  await audit(orgId, actorId, 'finance_category_delete', existing);
  return { deleted: true };
}

// For the Group Charge / Expense forms: resolve a picked category (must be an
// active one of the right kind in this org).
async function resolve(orgId, kind, id) {
  if (!id) return null;
  return prisma.financeCategory.findFirst({ where: { id, org_id: orgId, kind, is_active: true }, select: { id: true, name: true } });
}

module.exports = { list, create, update, remove, resolve, DEFAULTS };
