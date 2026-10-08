const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const calc = require('./property.calc');
const posting = require('./ledgerPosting');
const { addEvent } = require('./properties.service');

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const saleSchema = z.object({
  unit_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  buyer_party_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  sale_value: z.coerce.number().positive().max(1e13),
  sale_date: dateStr,
  selling_costs: z.preprocess((v) => (v === '' || v === null ? 0 : v), z.coerce.number().min(0).max(1e13)).default(0),
  notes: text(1000),
});
const listQuerySchema = z.object({ property_id: z.string().uuid().optional(), from: dateStr.optional(), to: dateStr.optional() });

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

function saleOut(s, extra = {}) {
  return {
    id: s.id, property_id: s.property_id, unit_id: s.unit_id, buyer_party_id: s.buyer_party_id, sale_value: num(s.sale_value), sale_date: dayOf(s.sale_date),
    selling_costs: num(s.selling_costs), cost_basis: num(s.cost_basis), realized_profit: num(s.realized_profit), holding_days: s.holding_days, notes: s.notes, ...extra,
  };
}

async function list(orgId, query) {
  const rows = await prisma.zxPropertySale.findMany({
    where: { org_id: orgId, deleted_at: null, ...(query.property_id ? { property_id: query.property_id } : {}), ...(query.from || query.to ? { sale_date: { ...(query.from ? { gte: toDate(query.from) } : {}), ...(query.to ? { lte: toDate(query.to) } : {}) } } : {}) },
    orderBy: [{ sale_date: 'desc' }, { created_at: 'desc' }],
  });
  const [props, units, parties] = await Promise.all([
    prisma.zxProperty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.property_id))] }, org_id: orgId }, select: { id: true, code: true, name: true } }),
    prisma.zxPropertyUnit.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.unit_id).filter(Boolean))] }, org_id: orgId }, select: { id: true, name: true } }),
    prisma.zxParty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.buyer_party_id).filter(Boolean))] }, org_id: orgId }, select: { id: true, name: true } }),
  ]);
  const pm = new Map(props.map((p) => [p.id, p]));
  const um = new Map(units.map((u) => [u.id, u]));
  const bm = new Map(parties.map((p) => [p.id, p]));
  const data = rows.map((r) => saleOut(r, { property: pm.get(r.property_id) || null, unit: um.get(r.unit_id) || null, buyer: bm.get(r.buyer_party_id) || null }));
  const totals = data.reduce((a, s) => ({ sale_value: a.sale_value + s.sale_value, cost_basis: a.cost_basis + s.cost_basis, selling_costs: a.selling_costs + s.selling_costs, realized_profit: a.realized_profit + s.realized_profit }), { sale_value: 0, cost_basis: 0, selling_costs: 0, realized_profit: 0 });
  return { data, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, calc.round2(v)])), count: data.length };
}

async function create(orgId, actorId, propertyId, input) {
  const property = await prisma.zxProperty.findFirst({ where: { id: propertyId, org_id: orgId, deleted_at: null } });
  if (!property) return { error: 'not_found' };
  if (input.sale_date > todayStr()) return { error: 'future_sale' };
  if (!(await posting.periodsOpen(orgId, [input.sale_date]))) return { error: 'period_closed' };
  if (input.buyer_party_id) {
    const buyer = await prisma.zxParty.findFirst({ where: { id: input.buyer_party_id, org_id: orgId, deleted_at: null }, select: { kind: true } });
    if (!buyer) return { error: 'buyer_not_found' };
    if (buyer.kind === 'vendor') return { error: 'buyer_is_vendor' };
  }
  if (property.purchase_date && input.sale_date < dayOf(property.purchase_date)) return { error: 'sold_before_purchase' };
  const invested = calc.totalInvestment(property);
  const units = await prisma.zxPropertyUnit.findMany({ where: { property_id: propertyId, org_id: orgId, deleted_at: null } });
  const previous = await prisma.zxPropertySale.findMany({ where: { property_id: propertyId, org_id: orgId, deleted_at: null } });
  const recovered = previous.reduce((a, s) => a + num(s.cost_basis), 0);
  let basis;
  let unit = null;
  if (input.unit_id) {
    unit = units.find((u) => u.id === input.unit_id);
    if (!unit) return { error: 'not_found' };
    if (unit.status === 'sold') return { error: 'already_sold' };
    if (unit.ownership !== 'zephyr') return { error: 'unit_not_owned' };
    if ((await prisma.zxLease.count({ where: { unit_id: unit.id, org_id: orgId, deleted_at: null, status: 'active' } })) > 0) return { error: 'has_active_lease' };
    basis = calc.unitCostBasis(unit, units, invested);
  } else {
    if (property.status === 'sold') return { error: 'already_sold' };
    if ((await prisma.zxLease.count({ where: { property_id: propertyId, org_id: orgId, deleted_at: null, status: 'active' } })) > 0) return { error: 'has_active_lease' };
    basis = calc.round2(Math.max(invested - recovered, 0));
  }
  const profit = calc.tradingProfit(input.sale_value, basis, input.selling_costs);
  const holding = property.purchase_date ? daysBetween(property.purchase_date, input.sale_date) : null;
  const sale = await prisma.$transaction(async (tx) => {
    const s = await tx.zxPropertySale.create({
      data: { org_id: orgId, created_by: actorId, property_id: propertyId, unit_id: input.unit_id || null, buyer_party_id: input.buyer_party_id || null, sale_value: input.sale_value, sale_date: toDate(input.sale_date), selling_costs: input.selling_costs, cost_basis: basis, realized_profit: profit, holding_days: holding, notes: input.notes || null },
    });
    if (unit) {
      await tx.zxPropertyUnit.update({ where: { id: unit.id }, data: { status: 'sold' } });
      const left = await tx.zxPropertyUnit.count({ where: { property_id: propertyId, org_id: orgId, deleted_at: null, status: { not: 'sold' }, NOT: { id: unit.id } } });
      if (left === 0) await tx.zxProperty.update({ where: { id: propertyId }, data: { status: 'sold' } });
    } else {
      await tx.zxPropertyUnit.updateMany({ where: { property_id: propertyId, org_id: orgId, deleted_at: null, status: { not: 'sold' } }, data: { status: 'sold' } });
      await tx.zxProperty.update({ where: { id: propertyId }, data: { status: 'sold' } });
    }
    return s;
  });
  // Realized figures reach the P&L only here: sale value in, cost of the property sold and selling costs out.
  const common = { entry_date: input.sale_date, service_type: 'property_trading', property_id: propertyId, unit_id: input.unit_id || null, source_type: 'property_sale', source_id: sale.id };
  const what = unit ? `${property.name} / ${unit.name}` : property.name;
  const revenue = await posting.post(orgId, actorId, { ...common, type: 'revenue', category: 'Property sale', amount: input.sale_value, party_id: input.buyer_party_id, description: `Sale of ${what}` });
  const cost = basis > 0 ? await posting.post(orgId, actorId, { ...common, type: 'expense', category: 'Cost of property sold', amount: basis, description: `Cost of ${what}` }) : null;
  if (input.selling_costs > 0) await posting.post(orgId, actorId, { ...common, type: 'expense', category: 'Selling costs', amount: input.selling_costs, description: `Selling costs for ${what}` });
  await prisma.zxPropertySale.update({ where: { id: sale.id }, data: { revenue_entry_id: revenue.id, cost_entry_id: cost?.id || null } });
  await addEvent(prisma, orgId, actorId, { property_id: propertyId, unit_id: input.unit_id || null, kind: 'sale', event_date: input.sale_date, title: `${unit ? unit.name : 'Property'} sold`, amount: input.sale_value, notes: input.notes, source_type: 'property_sale', source_id: sale.id });
  await writeAudit(null, { orgId, actorId, entity: 'property_sale', entityId: sale.id, action: 'create', after: { property_id: propertyId, unit_id: input.unit_id || null, sale_value: input.sale_value, cost_basis: basis, realized_profit: profit } });
  return { sale: saleOut(sale, { realized_profit: profit, cost_basis: basis }) };
}

// Admin: reverse a sale (wrong figures, deal fell through). Postings are voided and statuses restored.
async function remove(orgId, actorId, propertyId, saleId, reason) {
  const sale = await prisma.zxPropertySale.findFirst({ where: { id: saleId, property_id: propertyId, org_id: orgId, deleted_at: null } });
  if (!sale) return { error: 'not_found' };
  if (!(await posting.periodsOpen(orgId, [dayOf(sale.sale_date)]))) return { error: 'period_closed' };
  await prisma.$transaction(async (tx) => {
    await tx.zxPropertySale.update({ where: { id: saleId }, data: { deleted_at: new Date() } });
    if (sale.unit_id) await tx.zxPropertyUnit.update({ where: { id: sale.unit_id }, data: { status: 'available' } });
    else await tx.zxPropertyUnit.updateMany({ where: { property_id: propertyId, org_id: orgId, deleted_at: null, status: 'sold' }, data: { status: 'available' } });
    await tx.zxProperty.update({ where: { id: propertyId }, data: { status: 'held' } });
  });
  await posting.voidSource(orgId, actorId, 'property_sale', saleId);
  await addEvent(prisma, orgId, actorId, { property_id: propertyId, unit_id: sale.unit_id, kind: 'sale', title: 'Sale reversed', notes: reason });
  await writeAudit(null, { orgId, actorId, entity: 'property_sale', entityId: saleId, action: 'delete', before: { sale_value: num(sale.sale_value), realized_profit: num(sale.realized_profit) }, reason });
  return { ok: true };
}

// Editing a sale reverses it and records it again with the new figures, so the ledger, the unit
// status and the realized profit are all rebuilt from the same rules.
async function update(orgId, actorId, propertyId, saleId, input) {
  const sale = await prisma.zxPropertySale.findFirst({ where: { id: saleId, property_id: propertyId, org_id: orgId, deleted_at: null } });
  if (!sale) return { error: 'not_found' };
  const old = { unit_id: sale.unit_id, buyer_party_id: sale.buyer_party_id, sale_value: num(sale.sale_value), sale_date: dayOf(sale.sale_date), selling_costs: num(sale.selling_costs), notes: sale.notes };
  const next = {
    unit_id: sale.unit_id,
    buyer_party_id: input.buyer_party_id === undefined ? old.buyer_party_id : input.buyer_party_id,
    sale_value: input.sale_value ?? old.sale_value,
    sale_date: input.sale_date ?? old.sale_date,
    selling_costs: input.selling_costs ?? old.selling_costs,
    notes: input.notes === undefined ? old.notes : input.notes,
  };
  if (next.sale_date > todayStr()) return { error: 'future_sale' };
  if (!(await posting.periodsOpen(orgId, [old.sale_date, next.sale_date]))) return { error: 'period_closed' };
  const removed = await remove(orgId, actorId, propertyId, saleId, 'Edited');
  if (removed.error) return removed;
  const made = await create(orgId, actorId, propertyId, next);
  if (made.error) {
    await create(orgId, actorId, propertyId, old);
    return made;
  }
  return made;
}

module.exports = { saleSchema, saleUpdateSchema: saleSchema.omit({ unit_id: true }).partial(), listQuerySchema, list, create, update, remove };
