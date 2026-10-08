const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const { isClosed } = require('./periods');
const { ensureCategories } = require('./core.service');

// System postings (rent receipts, property sales, commission) write ordinary ledger rows so the
// P&L, overview, plans and month close all keep reading ONE money table. A posting remembers what
// created it (source_type / source_id) so reversing the source reverses the row.
const DEFAULT_KIND = { revenue: 'revenue', expense: 'expense' };

async function categoryFor(orgId, kind, name) {
  // seed the default categories first, or a system posting would make an org look "already seeded"
  await ensureCategories(orgId);
  const found = await prisma.zxCategory.findFirst({ where: { org_id: orgId, kind: DEFAULT_KIND[kind], name, deleted_at: null } });
  if (found) return found;
  const count = await prisma.zxCategory.count({ where: { org_id: orgId, kind } });
  return prisma.zxCategory.create({ data: { org_id: orgId, kind, name, sort_order: count } });
}

const toDate = (s) => new Date(`${s}T00:00:00.000Z`);
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

// Refuses when any of the given dates falls in a closed month (an admin reopens the month first).
async function periodsOpen(orgId, dates) {
  for (const d of dates) if (d && (await isClosed(orgId, d))) return false;
  return true;
}

async function post(orgId, actorId, e) {
  const category = await categoryFor(orgId, e.type, e.category);
  const row = await prisma.zxLedgerEntry.create({
    data: {
      org_id: orgId,
      created_by: actorId,
      entry_date: toDate(e.entry_date),
      type: e.type,
      category_id: category.id,
      project_id: e.project_id || null,
      party_id: e.party_id || null,
      amount: e.amount,
      tax: e.tax || 0,
      status: 'actual',
      payment_mode: e.payment_mode || null,
      reference: e.reference || null,
      description: e.description || null,
      service_type: e.service_type || null,
      property_id: e.property_id || null,
      unit_id: e.unit_id || null,
      source_type: e.source_type,
      source_id: e.source_id,
    },
  });
  await writeAudit(null, { orgId, actorId, entity: 'ledger', entityId: row.id, action: 'create', after: { date: e.entry_date, type: e.type, amount: e.amount, source: e.source_type } });
  return row;
}

// Soft-deletes every ledger row a source created.
async function voidSource(orgId, actorId, sourceType, sourceId) {
  const rows = await prisma.zxLedgerEntry.findMany({ where: { org_id: orgId, source_type: sourceType, source_id: sourceId, deleted_at: null } });
  for (const r of rows) {
    await prisma.zxLedgerEntry.update({ where: { id: r.id }, data: { deleted_at: new Date() } });
    await writeAudit(null, { orgId, actorId, entity: 'ledger', entityId: r.id, action: 'delete', before: { date: dayOf(r.entry_date), type: r.type, amount: Number(r.amount), source: sourceType } });
  }
  return rows;
}

module.exports = { categoryFor, periodsOpen, post, voidSource };
