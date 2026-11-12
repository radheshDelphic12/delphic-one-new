const { z, prisma, fail, num, round3, today, dayOf, toDate, text, optDate, uuid, nextNo, lockOrg, audit, priceLines, outletAllowed } = require('./common');
const stock = require('./stock.service');
const core = require('../core.service');

// Sales orders.  status: draft -> confirmed -> partially_fulfilled -> fulfilled (or cancelled).
// Order status, fulfilment, invoice status and payment status are four different fields: a confirmed order is not delivered, a delivered
// order is not invoiced, an invoiced order is not paid. Confirming reserves stock FEFO (earliest expiry first); what cannot be
// reserved stays a backorder on the line and can be allocated later. A customer that is a company-owned outlet cannot be sold to
// (that is a stock transfer); franchise, third-party and external customers are.
const line = z.object({ product_id: uuid, qty: z.coerce.number().positive().max(1e9), unit_price: z.coerce.number().min(0).max(1e9).optional(), discount_pct: z.coerce.number().min(0).max(100).optional() });
const fields = { customer_id: uuid, warehouse_id: uuid, order_date: optDate, expected_date: optDate, payment_terms: text(300), delivery_address: text(500), logistics_method: z.enum(['own_vehicle', 'partner']).nullable().optional(), notes: text(2000), lines: z.array(line).min(1).max(300) };
const createSchema = z.object(fields);
const updateSchema = z.object(fields).partial().extend({ reason: text(300) });

async function customerFor(tx, orgId, id) {
  const c = await tx.nxCustomer.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!c) fail('invalid_ref', 'customer');
  if (c.status !== 'active') fail('inactive_ref', 'customer');
  let outlet = null;
  if (c.outlet_id) {
    outlet = await tx.nxOutlet.findFirst({ where: { id: c.outlet_id, org_id: orgId }, include: { ownership_type: { select: { kind: true } } } });
    if (outlet?.ownership_type?.kind === 'company_owned') fail('use_transfer');
  }
  return { c, outlet };
}

/** Selling price for a customer: the product's selling price less the franchise agreement discount of the customer's outlet, if any. */
async function priceFor(tx, orgId, product, outletId) {
  let disc = 0;
  if (outletId) {
    const ag = await tx.nxFranchiseAgreement.findFirst({ where: { org_id: orgId, outlet_id: outletId, status: 'active', deleted_at: null } });
    if (ag) disc = num(ag.purchase_discount_pct);
  }
  return Math.round(num(product.selling_price) * (1 - disc / 100) * 100) / 100;
}

async function buildLines(tx, orgId, input, outletId, prev = []) {
  const prods = new Map((await tx.nxProduct.findMany({ where: { org_id: orgId, id: { in: input.map((l) => l.product_id) }, deleted_at: null } })).map((p) => [p.id, p]));
  const settings = await core.ensureSettings(orgId);
  const raw = [];
  for (const l of input) {
    const p = prods.get(l.product_id);
    if (!p) fail('invalid_ref', 'product');
    if (p.status !== 'active') fail('inactive_ref', 'product');
    const old = prev.find((x) => x.product_id === l.product_id);
    raw.push({ product_id: p.id, sku: p.sku, name: p.name, qty: l.qty, unit_price: l.unit_price ?? (await priceFor(tx, orgId, p, outletId)), discount_pct: l.discount_pct ?? 0, gst_rate: num(p.gst_rate ?? settings.default_gst_rate), allocations: old?.allocations || [], allocated_qty: num(old?.allocated_qty), shipped_qty: num(old?.shipped_qty), delivered_qty: num(old?.delivered_qty), backorder_qty: l.qty - num(old?.allocated_qty) });
  }
  return priceLines(raw);
}

const out = (o, names = {}) => ({ id: o.id, so_no: o.so_no, customer_id: o.customer_id, customer: names.customer, outlet_id: o.outlet_id, outlet: names.outlet, warehouse_id: o.warehouse_id, warehouse: names.warehouse, order_date: dayOf(o.order_date), expected_date: dayOf(o.expected_date), status: o.status, fulfilment: o.fulfilment, invoice_status: o.invoice_status, payment_status: o.payment_status, subtotal: num(o.subtotal), tax_total: num(o.tax_total), total: num(o.total), payment_terms: o.payment_terms, delivery_address: o.delivery_address, logistics_method: o.logistics_method, lines: o.lines, notes: o.notes });

async function list(orgId, f = {}, scope) {
  const where = { org_id: orgId, deleted_at: null, ...(f.status ? { status: f.status } : {}), ...(f.fulfilment ? { fulfilment: f.fulfilment } : {}), ...(f.invoice_status ? { invoice_status: f.invoice_status } : {}), ...(f.payment_status ? { payment_status: f.payment_status } : {}), ...(f.customer_id ? { customer_id: f.customer_id } : {}), ...(f.warehouse_id ? { warehouse_id: f.warehouse_id } : {}) };
  if (scope) where.outlet_id = f.outlet_id && scope.includes(f.outlet_id) ? f.outlet_id : { in: scope };
  else if (f.outlet_id) where.outlet_id = f.outlet_id;
  if (f.from || f.to) where.order_date = { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lte: toDate(f.to) } : {}) };
  if (f.q) where.so_no = { contains: String(f.q), mode: 'insensitive' };
  const rows = await prisma.nxSalesOrder.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 });
  const [C, W, O] = await Promise.all([prisma.nxCustomer.findMany({ where: { org_id: orgId } }), prisma.nxWarehouse.findMany({ where: { org_id: orgId } }), prisma.nxOutlet.findMany({ where: { org_id: orgId }, select: { id: true, name: true } })]);
  const c = stock.mapBy(C); const w = stock.mapBy(W); const o = stock.mapBy(O);
  return rows.map((r) => out(r, { customer: c.get(r.customer_id)?.name, warehouse: w.get(r.warehouse_id)?.name, outlet: o.get(r.outlet_id)?.name }));
}

async function get(orgId, id, scope) {
  const r = await prisma.nxSalesOrder.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!r) fail('not_found');
  if (!outletAllowed(scope, r.outlet_id)) fail('forbidden_outlet');
  const [c, w, ships, batches] = await Promise.all([
    prisma.nxCustomer.findFirst({ where: { id: r.customer_id } }), prisma.nxWarehouse.findFirst({ where: { id: r.warehouse_id } }),
    prisma.nxShipment.findMany({ where: { org_id: orgId, sales_order_id: id, deleted_at: null }, select: { id: true, shipment_no: true, status: true, actual_freight: true, estimated_freight: true } }),
    prisma.nxBatch.findMany({ where: { org_id: orgId, id: { in: r.lines.flatMap((l) => (l.allocations || []).map((a) => a.batch_id)) } } }),
  ]);
  const B = stock.mapBy(batches);
  const invoices = await prisma.nxInvoice.findMany({ where: { org_id: orgId, source_type: 'shipment', source_id: { in: ships.map((s) => s.id) } }, select: { id: true, invoice_no: true, status: true, total: true } });
  return { ...out(r, { customer: c?.name, warehouse: w?.name }), lines: r.lines.map((l) => ({ ...l, allocations: (l.allocations || []).map((a) => ({ ...a, batch_no: B.get(a.batch_id)?.batch_no, expiry_date: dayOf(B.get(a.batch_id)?.expiry_date) })) })), shipments: ships.map((s) => ({ ...s, actual_freight: s.actual_freight === null ? null : num(s.actual_freight), estimated_freight: num(s.estimated_freight) })), invoices: invoices.map((i) => ({ ...i, total: num(i.total) })) };
}

async function create(orgId, actorId, body, scope) {
  const input = createSchema.parse(body);
  return prisma.$transaction(async (tx) => {
    const { c, outlet } = await customerFor(tx, orgId, input.customer_id);
    if (!outletAllowed(scope, c.outlet_id)) fail('forbidden_outlet');
    const wh = await tx.nxWarehouse.findFirst({ where: { id: input.warehouse_id, org_id: orgId, deleted_at: null } });
    if (!wh) fail('invalid_ref', 'warehouse');
    const priced = await buildLines(tx, orgId, input.lines, outlet?.id || null);
    const o = await tx.nxSalesOrder.create({ data: { org_id: orgId, created_by: actorId, so_no: await nextNo(tx, orgId, 'so', 'SO', 4), customer_id: c.id, outlet_id: outlet?.id || null, warehouse_id: wh.id, order_date: toDate(input.order_date || today()), expected_date: toDate(input.expected_date), payment_terms: input.payment_terms ?? (c.credit_days ? `Net ${c.credit_days} days` : null), delivery_address: input.delivery_address ?? c.address, logistics_method: input.logistics_method ?? null, notes: input.notes, subtotal: priced.subtotal, tax_total: priced.tax_total, total: priced.total, lines: priced.lines } });
    await audit(tx, orgId, actorId, 'sales_order', o.id, 'create', null, { so_no: o.so_no, total: priced.total });
    return out(o);
  });
}

async function update(orgId, actorId, id, body, scope) {
  const input = updateSchema.parse(body || {});
  const { reason, lines, ...rest } = input;
  return prisma.$transaction(async (tx) => {
    const o = await tx.nxSalesOrder.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
    if (!o) fail('not_found');
    if (!outletAllowed(scope, o.outlet_id)) fail('forbidden_outlet');
    if (o.status !== 'draft') fail('bad_status');
    const data = { ...rest, updated_by: actorId };
    let outletId = o.outlet_id;
    if (rest.customer_id) { const { c, outlet } = await customerFor(tx, orgId, rest.customer_id); data.outlet_id = outlet?.id || null; outletId = data.outlet_id; void c; }
    if (rest.warehouse_id && !(await tx.nxWarehouse.findFirst({ where: { id: rest.warehouse_id, org_id: orgId, deleted_at: null } }))) fail('invalid_ref', 'warehouse');
    if ('order_date' in rest) data.order_date = toDate(rest.order_date || today());
    if ('expected_date' in rest) data.expected_date = toDate(rest.expected_date);
    if (lines) { const p = await buildLines(tx, orgId, lines, outletId, []); Object.assign(data, { lines: p.lines, subtotal: p.subtotal, tax_total: p.tax_total, total: p.total }); }
    const row = await tx.nxSalesOrder.update({ where: { id }, data });
    await audit(tx, orgId, actorId, 'sales_order', id, 'update', { total: num(o.total) }, { total: num(row.total) }, reason);
    return out(row);
  });
}

/** Reserve (FEFO) whatever is still unallocated on each line. Idempotent: running it again only reserves new availability. */
async function reserve(tx, orgId, actorId, order) {
  const settings = await core.ensureSettings(orgId);
  const lines = order.lines.map((l) => ({ ...l, allocations: (l.allocations || []).map((a) => ({ ...a })) }));
  const legs = []; let seq = 0;
  for (const l of lines) {
    const need = round3(num(l.qty) - num(l.allocated_qty));
    if (need <= 0) continue;
    const { allocations } = await stock.allocateFefo(tx, orgId, { warehouse_id: order.warehouse_id, product_id: l.product_id, qty: need, settings });
    for (const a of allocations) {
      seq += 1;
      legs.push(...stock.movePair({ product_id: l.product_id, batch_id: a.batch_id, from: { warehouse_id: order.warehouse_id, bucket: 'available' }, to: { warehouse_id: order.warehouse_id, bucket: 'reserved' }, qty: a.qty, movement: 'reserve', ref_type: 'sales_order', ref_id: order.id, posting_key: `so:${order.id}:res:${l.product_id}:${a.batch_id}:${round3(num(l.allocated_qty))}:${seq}` }));
      const ex = l.allocations.find((x) => x.batch_id === a.batch_id);
      if (ex) ex.qty = round3(ex.qty + a.qty); else l.allocations.push({ batch_id: a.batch_id, qty: a.qty, committed_qty: 0, shipped_qty: 0 });
      l.allocated_qty = round3(num(l.allocated_qty) + a.qty);
    }
    l.backorder_qty = round3(num(l.qty) - num(l.allocated_qty));
  }
  await stock.postLegs(tx, orgId, actorId, legs);
  return lines;
}

async function confirm(orgId, actorId, id, scope) {
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const o = await tx.nxSalesOrder.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
    if (!o) fail('not_found');
    if (!outletAllowed(scope, o.outlet_id)) fail('forbidden_outlet');
    if (o.status !== 'draft') fail('bad_status');
    await customerFor(tx, orgId, o.customer_id);
    const lines = await reserve(tx, orgId, actorId, o);
    const row = await tx.nxSalesOrder.update({ where: { id }, data: { status: 'confirmed', lines } });
    await audit(tx, orgId, actorId, 'sales_order', id, 'confirm', { status: 'draft' }, { status: 'confirmed', backorder: lines.some((l) => num(l.backorder_qty) > 0) });
    return out(row);
  }, { timeout: 30000 });
}

async function allocate(orgId, actorId, id, scope) {
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const o = await tx.nxSalesOrder.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
    if (!o) fail('not_found');
    if (!outletAllowed(scope, o.outlet_id)) fail('forbidden_outlet');
    if (!['confirmed', 'partially_fulfilled'].includes(o.status)) fail('bad_status');
    const lines = await reserve(tx, orgId, actorId, o);
    const row = await tx.nxSalesOrder.update({ where: { id }, data: { lines } });
    await audit(tx, orgId, actorId, 'sales_order', id, 'allocate', null, { backorder: lines.reduce((a, l) => a + num(l.backorder_qty), 0) });
    return out(row);
  }, { timeout: 30000 });
}

/** Cancel an order: only while nothing has left the warehouse and no shipment is open. Reserved stock returns to available. */
async function cancel(orgId, actorId, id, reason, scope) {
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const o = await tx.nxSalesOrder.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
    if (!o) fail('not_found');
    if (!outletAllowed(scope, o.outlet_id)) fail('forbidden_outlet');
    if (!['draft', 'confirmed'].includes(o.status)) fail('bad_status');
    const open = await tx.nxShipment.count({ where: { org_id: orgId, sales_order_id: id, deleted_at: null, status: { not: 'cancelled' } } });
    if (open) fail('bad_status', 'cancel its shipments first');
    const legs = [];
    for (const l of o.lines) for (const a of l.allocations || []) {
      const rem = round3(num(a.qty) - num(a.shipped_qty));
      if (rem > 0) legs.push(...stock.movePair({ product_id: l.product_id, batch_id: a.batch_id, from: { warehouse_id: o.warehouse_id, bucket: 'reserved' }, to: { warehouse_id: o.warehouse_id, bucket: 'available' }, qty: rem, movement: 'release', ref_type: 'sales_order', ref_id: o.id, posting_key: `so:${o.id}:rel:${l.product_id}:${a.batch_id}` }));
    }
    await stock.postLegs(tx, orgId, actorId, legs);
    const lines = o.lines.map((l) => ({ ...l, allocations: [], allocated_qty: 0, backorder_qty: l.qty }));
    const row = await tx.nxSalesOrder.update({ where: { id }, data: { status: 'cancelled', lines } });
    await audit(tx, orgId, actorId, 'sales_order', id, 'cancel', { status: o.status }, { status: 'cancelled' }, reason);
    return out(row);
  });
}

/** Recompute fulfilment / status of an order from its lines (called by shipments). */
async function refreshFulfilment(tx, orgId, soId) {
  const o = await tx.nxSalesOrder.findFirst({ where: { id: soId, org_id: orgId } });
  if (!o || o.status === 'cancelled') return;
  const tq = o.lines.reduce((a, l) => a + num(l.qty), 0);
  const sq = o.lines.reduce((a, l) => a + num(l.shipped_qty), 0);
  const fulfilment = sq <= 0 ? 'none' : sq >= tq - 0.0001 ? 'full' : 'partial';
  const status = fulfilment === 'full' ? 'fulfilled' : fulfilment === 'partial' ? 'partially_fulfilled' : o.status === 'draft' ? 'draft' : 'confirmed';
  await tx.nxSalesOrder.update({ where: { id: soId }, data: { fulfilment, status } });
}

module.exports = { list, get, create, update, confirm, allocate, cancel, refreshFulfilment, out };
