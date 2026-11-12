const { z, prisma, fail, num, round2, round3, today, dayOf, addDays, toDate, text, dateStr, uuid, lockOrg, audit } = require('./common');
const core = require('../core.service');

// Stock = an append-only ledger (nx_stock_ledger). Every movement is signed legs per product / batch / location / bucket; a balance
// is the sum of its legs, so history is never edited and a re-processed document cannot add stock twice (posting_key is unique).
// Buckets: available (can be sold) | reserved (allocated to an order) | in_transit | damaged | quarantine | lost (written off, traceability only).
const BUCKETS = ['available', 'reserved', 'in_transit', 'damaged', 'quarantine', 'lost'];
const VALUE_BUCKETS = ['available', 'reserved', 'in_transit', 'quarantine'];
const key = (l) => `${l.product_id}|${l.batch_id}|${l.warehouse_id}|${l.bucket}`;

/** Post legs. Negative legs may never take a bucket below zero. Legs whose posting_key already exists are skipped (idempotent). */
async function postLegs(tx, orgId, actorId, legs) {
  if (!legs.length) return 0;
  const keys = legs.map((l) => l.posting_key).filter(Boolean);
  const existing = keys.length ? new Set((await tx.nxStockLedger.findMany({ where: { org_id: orgId, posting_key: { in: keys } }, select: { posting_key: true } })).map((r) => r.posting_key)) : new Set();
  const fresh = legs.filter((l) => !(l.posting_key && existing.has(l.posting_key)) && num(l.qty) !== 0);
  if (!fresh.length) return 0;
  const net = new Map();
  for (const l of fresh) net.set(key(l), round3((net.get(key(l)) || 0) + num(l.qty)));
  for (const [k, delta] of net) {
    if (delta >= 0) continue;
    const [product_id, batch_id, warehouse_id, bucket] = k.split('|');
    const cur = await tx.nxStockLedger.aggregate({ where: { org_id: orgId, product_id, batch_id, warehouse_id, bucket }, _sum: { qty: true } });
    if (round3(num(cur._sum.qty) + delta) < 0) fail('insufficient_stock', { product_id, batch_id, warehouse_id, bucket });
  }
  await tx.nxStockLedger.createMany({
    data: fresh.map((l) => ({ org_id: orgId, actor_id: actorId || null, product_id: l.product_id, batch_id: l.batch_id, warehouse_id: l.warehouse_id, bucket: l.bucket || 'available', qty: l.qty, movement: l.movement, ref_type: l.ref_type || null, ref_id: l.ref_id || null, posting_key: l.posting_key || null, note: l.note || null })),
  });
  return fresh.length;
}

/** Move qty between two buckets / locations as one balanced pair of legs. */
const movePair = ({ product_id, batch_id, from, to, qty, movement, ref_type, ref_id, posting_key, note }) => [
  { product_id, batch_id, warehouse_id: from.warehouse_id, bucket: from.bucket, qty: -qty, movement, ref_type, ref_id, posting_key: posting_key && `${posting_key}:out`, note },
  { product_id, batch_id, warehouse_id: to.warehouse_id, bucket: to.bucket, qty, movement, ref_type, ref_id, posting_key: posting_key && `${posting_key}:in`, note },
];

const eligibleBatch = (b, todayStr, blockDays) => b.quality_status === 'released' && (!b.expiry_date || dayOf(b.expiry_date) >= addDays(todayStr, blockDays || 0));

/**
 * FEFO: allocate `qty` of a product from a location, earliest expiry first. Expired, quarantined, rejected and recalled batches (and
 * batches expiring within the blocking window) are skipped. Returns { allocations: [{ batch_id, qty }], short }.
 */
async function allocateFefo(tx, orgId, { warehouse_id, product_id, qty, settings }) {
  const bal = await tx.nxStockLedger.groupBy({ by: ['batch_id'], where: { org_id: orgId, warehouse_id, product_id, bucket: 'available' }, _sum: { qty: true } });
  const have = bal.filter((b) => num(b._sum.qty) > 0);
  const batches = await tx.nxBatch.findMany({ where: { org_id: orgId, id: { in: have.map((b) => b.batch_id) }, deleted_at: null } });
  const td = today();
  const cand = batches.filter((b) => eligibleBatch(b, td, settings?.expiry_block_days)).sort((a, b) => {
    const ea = a.expiry_date ? a.expiry_date.getTime() : Infinity;
    const eb = b.expiry_date ? b.expiry_date.getTime() : Infinity;
    return ea - eb || a.created_at - b.created_at;
  });
  const availOf = new Map(have.map((b) => [b.batch_id, num(b._sum.qty)]));
  let left = round3(num(qty));
  const allocations = [];
  for (const b of cand) {
    if (left <= 0) break;
    const take = round3(Math.min(left, availOf.get(b.id)));
    if (take > 0) { allocations.push({ batch_id: b.id, qty: take }); left = round3(left - take); }
  }
  return { allocations, short: Math.max(0, left) };
}

// ---------------- reads ----------------
async function balanceRows(orgId, f = {}) {
  const where = { org_id: orgId, ...(f.warehouse_id ? { warehouse_id: f.warehouse_id } : {}), ...(f.product_id ? { product_id: f.product_id } : {}), ...(f.batch_id ? { batch_id: f.batch_id } : {}), ...(f.warehouse_ids ? { warehouse_id: { in: f.warehouse_ids } } : {}) };
  const rows = await prisma.nxStockLedger.groupBy({ by: ['product_id', 'batch_id', 'warehouse_id', 'bucket'], where, _sum: { qty: true } });
  return rows.filter((r) => num(r._sum.qty) !== 0).map((r) => ({ product_id: r.product_id, batch_id: r.batch_id, warehouse_id: r.warehouse_id, bucket: r.bucket, qty: num(r._sum.qty) }));
}

const mapBy = (rows) => new Map(rows.map((r) => [r.id, r]));

/**
 * Stock on hand per product + batch + location with every bucket, expiry state and value (qty x batch cost for the value buckets).
 * Filters: warehouse, outlet (via the location's outlet), product, category, batch status, expiry state.
 */
async function onHand(orgId, f = {}, settings) {
  const s = settings || (await core.ensureSettings(orgId));
  let warehouse_ids;
  const whs = await prisma.nxWarehouse.findMany({ where: { org_id: orgId, ...(f.warehouse_id ? { id: f.warehouse_id } : {}), ...(f.outlet_id ? { outlet_id: f.outlet_id } : {}), ...(f.city ? { city: f.city } : {}), ...(f.state ? { state: f.state } : {}), ...(f.type ? { type: f.type } : {}) } });
  if (f.warehouse_id || f.outlet_id || f.city || f.state || f.type || f.scope_warehouse_ids) {
    warehouse_ids = whs.map((w) => w.id).filter((id) => !f.scope_warehouse_ids || f.scope_warehouse_ids.includes(id));
  }
  const bal = await balanceRows(orgId, { product_id: f.product_id, warehouse_ids });
  const [products, batches, allWh] = await Promise.all([
    prisma.nxProduct.findMany({ where: { org_id: orgId, id: { in: [...new Set(bal.map((b) => b.product_id))] } } }),
    prisma.nxBatch.findMany({ where: { org_id: orgId, id: { in: [...new Set(bal.map((b) => b.batch_id))] } } }),
    prisma.nxWarehouse.findMany({ where: { org_id: orgId } }),
  ]);
  const P = mapBy(products); const B = mapBy(batches); const W = mapBy(allWh);
  const td = today();
  const warnTo = addDays(td, s.expiry_warning_days);
  const grouped = new Map();
  for (const r of bal) {
    const k = `${r.product_id}|${r.batch_id}|${r.warehouse_id}`;
    const p = P.get(r.product_id); const b = B.get(r.batch_id); const w = W.get(r.warehouse_id);
    if (!p || !b || !w) continue;
    if (f.category_id && p.category_id !== f.category_id) continue;
    const g = grouped.get(k) || {
      product_id: p.id, sku: p.sku, product: p.name, category_id: p.category_id, batch_id: b.id, batch_no: b.batch_no, expiry_date: dayOf(b.expiry_date), quality_status: b.quality_status,
      unit_cost: num(b.unit_cost), warehouse_id: w.id, warehouse: w.name, warehouse_type: w.type, city: w.city, outlet_id: w.outlet_id, available: 0, reserved: 0, in_transit: 0, damaged: 0, quarantine: 0, lost: 0,
    };
    g[r.bucket] = round3(g[r.bucket] + r.qty);
    grouped.set(k, g);
  }
  let rows = [...grouped.values()].map((g) => {
    const exp = g.expiry_date;
    const expiry_state = !exp ? 'no_expiry' : exp < td ? 'expired' : exp <= warnTo ? 'near_expiry' : 'ok';
    const value = round2(VALUE_BUCKETS.reduce((a, bk) => a + g[bk], 0) * g.unit_cost);
    return { ...g, expiry_state, days_to_expiry: exp ? Math.round((new Date(exp) - new Date(td)) / 86400000) : null, value };
  });
  if (f.batch_status) rows = rows.filter((r) => r.quality_status === f.batch_status);
  if (f.expiry_state) rows = rows.filter((r) => r.expiry_state === f.expiry_state);
  if (f.q) { const q = String(f.q).toLowerCase(); rows = rows.filter((r) => `${r.sku} ${r.product} ${r.batch_no} ${r.warehouse}`.toLowerCase().includes(q)); }
  return rows.sort((a, b) => a.product.localeCompare(b.product) || (a.expiry_date || '9').localeCompare(b.expiry_date || '9'));
}

/** Per-product totals across locations, with reorder status. */
async function productStock(orgId, f = {}) {
  const rows = await onHand(orgId, f);
  const byP = new Map();
  for (const r of rows) {
    const g = byP.get(r.product_id) || { product_id: r.product_id, sku: r.sku, product: r.product, available: 0, reserved: 0, in_transit: 0, damaged: 0, quarantine: 0, value: 0 };
    for (const b of ['available', 'reserved', 'in_transit', 'damaged', 'quarantine']) g[b] = round3(g[b] + r[b]);
    g.value = round2(g.value + r.value);
    byP.set(r.product_id, g);
  }
  const prods = await prisma.nxProduct.findMany({ where: { org_id: orgId, deleted_at: null, status: 'active', ...(f.category_id ? { category_id: f.category_id } : {}), ...(f.product_id ? { id: f.product_id } : {}) } });
  return prods.map((p) => {
    const g = byP.get(p.id) || { product_id: p.id, sku: p.sku, product: p.name, available: 0, reserved: 0, in_transit: 0, damaged: 0, quarantine: 0, value: 0 };
    const reorder = num(p.reorder_level);
    return { ...g, reorder_level: reorder, below_reorder: reorder > 0 && g.available <= reorder };
  }).sort((a, b) => a.product.localeCompare(b.product));
}

async function ledger(orgId, f = {}) {
  const where = { org_id: orgId, ...(f.product_id ? { product_id: f.product_id } : {}), ...(f.batch_id ? { batch_id: f.batch_id } : {}), ...(f.warehouse_id ? { warehouse_id: f.warehouse_id } : {}), ...(f.movement ? { movement: f.movement } : {}), ...(f.ref_type ? { ref_type: f.ref_type } : {}), ...(f.ref_id ? { ref_id: f.ref_id } : {}) };
  if (f.from || f.to) where.created_at = { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lt: toDate(addDays(f.to, 1)) } : {}) };
  const rows = await prisma.nxStockLedger.findMany({ where, orderBy: { created_at: 'desc' }, take: Math.min(Number(f.limit) || 300, 2000) });
  const [P, B, W] = await Promise.all([
    prisma.nxProduct.findMany({ where: { org_id: orgId, id: { in: [...new Set(rows.map((r) => r.product_id))] } }, select: { id: true, sku: true, name: true } }),
    prisma.nxBatch.findMany({ where: { org_id: orgId, id: { in: [...new Set(rows.map((r) => r.batch_id))] } }, select: { id: true, batch_no: true } }),
    prisma.nxWarehouse.findMany({ where: { org_id: orgId, id: { in: [...new Set(rows.map((r) => r.warehouse_id))] } }, select: { id: true, name: true } }),
  ]);
  const p = mapBy(P); const b = mapBy(B); const w = mapBy(W);
  return rows.map((r) => ({ id: r.id, date: r.created_at, product: p.get(r.product_id)?.name, sku: p.get(r.product_id)?.sku, batch_no: b.get(r.batch_id)?.batch_no, warehouse: w.get(r.warehouse_id)?.name, bucket: r.bucket, qty: num(r.qty), movement: r.movement, ref_type: r.ref_type, ref_id: r.ref_id, note: r.note }));
}

// ---------------- batches ----------------
const batchPatch = z.object({ quality_status: z.enum(['released', 'quarantine', 'rejected', 'recalled']).optional(), expiry_date: z.preprocess((v) => (v === '' ? null : v), dateStr.nullable().optional()), mfg_date: z.preprocess((v) => (v === '' ? null : v), dateStr.nullable().optional()), unit_cost: z.coerce.number().min(0).optional(), notes: text(1000), reason: text(300) });

async function listBatches(orgId, f = {}) {
  const rows = await prisma.nxBatch.findMany({ where: { org_id: orgId, deleted_at: null, ...(f.product_id ? { product_id: f.product_id } : {}), ...(f.quality_status ? { quality_status: f.quality_status } : {}), ...(f.supplier_id ? { supplier_id: f.supplier_id } : {}) }, orderBy: [{ expiry_date: 'asc' }], take: 1000 });
  const s = await core.ensureSettings(orgId);
  const [P, S] = await Promise.all([
    prisma.nxProduct.findMany({ where: { org_id: orgId, id: { in: [...new Set(rows.map((r) => r.product_id))] } }, select: { id: true, sku: true, name: true } }),
    prisma.nxSupplier.findMany({ where: { org_id: orgId, id: { in: [...new Set(rows.map((r) => r.supplier_id).filter(Boolean))] } }, select: { id: true, name: true } }),
  ]);
  const p = mapBy(P); const sp = mapBy(S); const td = today(); const warnTo = addDays(td, s.expiry_warning_days);
  let out = rows.map((b) => { const exp = dayOf(b.expiry_date); return { id: b.id, product_id: b.product_id, sku: p.get(b.product_id)?.sku, product: p.get(b.product_id)?.name, batch_no: b.batch_no, mfg_date: dayOf(b.mfg_date), expiry_date: exp, supplier_id: b.supplier_id, supplier: sp.get(b.supplier_id)?.name || null, unit_cost: num(b.unit_cost), quality_status: b.quality_status, received_qty: num(b.received_qty), expiry_state: !exp ? 'no_expiry' : exp < td ? 'expired' : exp <= warnTo ? 'near_expiry' : 'ok', notes: b.notes }; });
  if (f.expiry_state) out = out.filter((b) => b.expiry_state === f.expiry_state);
  if (f.q) out = out.filter((b) => `${b.sku} ${b.product} ${b.batch_no}`.toLowerCase().includes(String(f.q).toLowerCase()));
  return out;
}

async function updateBatch(orgId, actorId, id, body) {
  const input = batchPatch.parse(body || {});
  const { reason, ...rest } = input;
  const before = await prisma.nxBatch.findFirst({ where: { id, org_id: orgId } });
  if (!before) fail('not_found');
  const data = { ...rest };
  if ('expiry_date' in data) data.expiry_date = toDate(data.expiry_date);
  if ('mfg_date' in data) data.mfg_date = toDate(data.mfg_date);
  const row = await prisma.nxBatch.update({ where: { id }, data: { ...data, updated_by: actorId } });
  await audit(prisma, orgId, actorId, 'batch', id, 'update', { quality_status: before.quality_status, expiry_date: dayOf(before.expiry_date), unit_cost: num(before.unit_cost) }, { quality_status: row.quality_status, expiry_date: dayOf(row.expiry_date), unit_cost: num(row.unit_cost) }, reason);
  return { id: row.id, quality_status: row.quality_status };
}

// ---------------- adjustments ----------------
const adjustSchema = z.object({ product_id: uuid, batch_id: uuid, warehouse_id: uuid, bucket: z.enum(BUCKETS).default('available'), qty: z.coerce.number().refine((v) => v !== 0, 'Quantity cannot be 0').refine((v) => Math.abs(v) < 1e9), reason: z.string().trim().min(3).max(300) });

/** A signed correction (count difference, write-off, found stock). Audited; negative adjustments cannot go below zero. */
async function adjust(orgId, actorId, body) {
  const input = adjustSchema.parse(body);
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const [b, w] = await Promise.all([tx.nxBatch.findFirst({ where: { id: input.batch_id, org_id: orgId, product_id: input.product_id } }), tx.nxWarehouse.findFirst({ where: { id: input.warehouse_id, org_id: orgId } })]);
    if (!b || !w) fail('invalid_ref');
    const row = await tx.nxStockAdjustment.create({ data: { org_id: orgId, ...input, actor_id: actorId, created_by: actorId } });
    await postLegs(tx, orgId, actorId, [{ product_id: input.product_id, batch_id: input.batch_id, warehouse_id: input.warehouse_id, bucket: input.bucket, qty: input.qty, movement: 'adjustment', ref_type: 'adjustment', ref_id: row.id, posting_key: `adj:${row.id}`, note: input.reason }]);
    await audit(tx, orgId, actorId, 'stock_adjustment', row.id, 'create', null, { qty: input.qty, bucket: input.bucket, reason: input.reason });
    return { id: row.id };
  });
}

async function listAdjustments(orgId, f = {}) {
  const rows = await prisma.nxStockAdjustment.findMany({ where: { org_id: orgId, ...(f.warehouse_id ? { warehouse_id: f.warehouse_id } : {}) }, orderBy: { created_at: 'desc' }, take: 300 });
  const [P, B, W] = await Promise.all([
    prisma.nxProduct.findMany({ where: { org_id: orgId, id: { in: rows.map((r) => r.product_id) } }, select: { id: true, name: true } }),
    prisma.nxBatch.findMany({ where: { org_id: orgId, id: { in: rows.map((r) => r.batch_id) } }, select: { id: true, batch_no: true } }),
    prisma.nxWarehouse.findMany({ where: { org_id: orgId, id: { in: rows.map((r) => r.warehouse_id) } }, select: { id: true, name: true } }),
  ]);
  const p = mapBy(P); const b = mapBy(B); const w = mapBy(W);
  return rows.map((r) => ({ id: r.id, date: r.created_at, product: p.get(r.product_id)?.name, batch_no: b.get(r.batch_id)?.batch_no, warehouse: w.get(r.warehouse_id)?.name, bucket: r.bucket, qty: num(r.qty), reason: r.reason }));
}

// ---------------- alerts ----------------
async function alerts(orgId, scopeWh) {
  const s = await core.ensureSettings(orgId);
  const rows = await onHand(orgId, { scope_warehouse_ids: scopeWh || undefined }, s);
  const prods = await productStock(orgId, {});
  const live = (r) => r.available + r.reserved + r.in_transit + r.quarantine > 0;
  return {
    warning_days: s.expiry_warning_days,
    near_expiry: rows.filter((r) => r.expiry_state === 'near_expiry' && live(r)),
    expired: rows.filter((r) => r.expiry_state === 'expired' && live(r)),
    recalled: rows.filter((r) => ['recalled', 'rejected'].includes(r.quality_status) && live(r)),
    below_reorder: prods.filter((p) => p.below_reorder),
    quarantined: rows.filter((r) => r.quarantine > 0),
  };
}

/** Where a batch went: receipts, locations holding it now, transfers, shipments, sales orders, invoices and customers. */
async function traceBatch(orgId, batchId) {
  const batch = await prisma.nxBatch.findFirst({ where: { id: batchId, org_id: orgId } });
  if (!batch) fail('not_found');
  const product = await prisma.nxProduct.findFirst({ where: { id: batch.product_id }, select: { sku: true, name: true } });
  const supplier = batch.supplier_id ? await prisma.nxSupplier.findFirst({ where: { id: batch.supplier_id }, select: { name: true } }) : null;
  const hold = await balanceRows(orgId, { batch_id: batchId });
  const W = mapBy(await prisma.nxWarehouse.findMany({ where: { org_id: orgId } }));
  const has = (lines) => (Array.isArray(lines) ? lines : []).some((l) => l.batch_id === batchId || (l.allocations || []).some((a) => a.batch_id === batchId));
  const [receipts, transfers, shipments, orders, invoices] = await Promise.all([
    prisma.nxGoodsReceipt.findMany({ where: { org_id: orgId, id: batch.receipt_id || '00000000-0000-0000-0000-000000000000' } }),
    prisma.nxTransfer.findMany({ where: { org_id: orgId, deleted_at: null } }),
    prisma.nxShipment.findMany({ where: { org_id: orgId, deleted_at: null } }),
    prisma.nxSalesOrder.findMany({ where: { org_id: orgId, deleted_at: null } }),
    prisma.nxInvoice.findMany({ where: { org_id: orgId, deleted_at: null, type: 'sales' } }),
  ]);
  const shp = shipments.filter((x) => has(x.lines));
  const so = orders.filter((x) => has(x.lines));
  const soIds = new Set(so.map((x) => x.id));
  const custs = mapBy(await prisma.nxCustomer.findMany({ where: { org_id: orgId, id: { in: [...new Set(so.map((x) => x.customer_id))] } }, select: { id: true, name: true, outlet_id: true } }));
  const shipIds = new Set(shp.map((x) => x.id));
  const inv = invoices.filter((i) => i.source_type === 'shipment' && shipIds.has(i.source_id));
  return {
    batch: { id: batch.id, batch_no: batch.batch_no, product: product?.name, sku: product?.sku, supplier: supplier?.name || null, expiry_date: dayOf(batch.expiry_date), quality_status: batch.quality_status, received_qty: num(batch.received_qty), unit_cost: num(batch.unit_cost) },
    receipts: receipts.map((r) => ({ id: r.id, grn_no: r.grn_no, date: dayOf(r.receipt_date) })),
    holding: hold.filter((h) => h.qty !== 0).map((h) => ({ warehouse: W.get(h.warehouse_id)?.name, outlet_id: W.get(h.warehouse_id)?.outlet_id || null, bucket: h.bucket, qty: h.qty })),
    transfers: transfers.filter((t) => has(t.lines)).map((t) => ({ id: t.id, transfer_no: t.transfer_no, status: t.status, from: W.get(t.from_warehouse_id)?.name, to: W.get(t.to_warehouse_id)?.name })),
    shipments: shp.map((x) => ({ id: x.id, shipment_no: x.shipment_no, status: x.status })),
    sales_orders: so.map((x) => ({ id: x.id, so_no: x.so_no, status: x.status, customer: custs.get(x.customer_id)?.name })),
    invoices: inv.map((i) => ({ id: i.id, invoice_no: i.invoice_no, status: i.status, party: i.party_name, total: num(i.total) })),
    customers: [...new Set(so.filter((x) => soIds.has(x.id)).map((x) => custs.get(x.customer_id)?.name).filter(Boolean))],
  };
}

/** Inventory value by dimension from live balances. */
async function valuation(orgId, f = {}) {
  const rows = await onHand(orgId, f);
  const sum = (arr, k) => round2(arr.reduce((a, r) => a + r[k], 0));
  const by = (pick) => { const m = new Map(); for (const r of rows) { const k = pick(r) || 'Unassigned'; m.set(k, round2((m.get(k) || 0) + r.value)); } return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value); };
  return { total: sum(rows, 'value'), by_warehouse: by((r) => r.warehouse), by_product: by((r) => r.product).slice(0, 15), by_city: by((r) => r.city), expired_value: round2(rows.filter((r) => r.expiry_state === 'expired').reduce((a, r) => a + r.value, 0)), near_expiry_value: round2(rows.filter((r) => r.expiry_state === 'near_expiry').reduce((a, r) => a + r.value, 0)) };
}

module.exports = { BUCKETS, VALUE_BUCKETS, postLegs, movePair, allocateFefo, eligibleBatch, balanceRows, onHand, productStock, ledger, listBatches, updateBatch, adjust, listAdjustments, alerts, traceBatch, valuation, mapBy };
