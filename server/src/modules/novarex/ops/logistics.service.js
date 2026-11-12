const { z, prisma, fail, num, round2, round3, today, dayOf, toDate, text, optDate, uuid, uuidOrNull, optNum, nextNo, lockOrg, lockGuard, lockTouch, audit, categoryId, outletAllowed } = require('./common');
const stock = require('./stock.service');
const sales = require('./sales.service');
const billing = require('./billing.service');

// Shipments, freight and company vehicle trips.
//   pending_dispatch -> ready_for_dispatch -> dispatched -> in_transit -> out_for_delivery -> delivered | partially_delivered | delivery_failed -> returned
// Status is entered by people (no carrier or GPS feed is invented). Stock leaves the warehouse (reserved -> out) when the shipment is
// DISPATCHED; goods that come back (damaged, undelivered, missing) are put into the right bucket at delivery confirmation, so stock and
// the order's shipped / delivered quantities always agree.
// Freight: a logistics-partner shipment has ONE expense entry for its actual freight (re-saved in place, never duplicated); a
// company-vehicle shipment has no freight entry - its cost is the fuel / toll / maintenance of its trips (also one entry per trip).
const STATUSES = ['pending_dispatch', 'ready_for_dispatch', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered', 'partially_delivered', 'delivery_failed', 'returned', 'cancelled'];
const ORDER = { pending_dispatch: 0, ready_for_dispatch: 1, dispatched: 2, in_transit: 3, out_for_delivery: 4 };
const AFTER_DISPATCH = ['dispatched', 'in_transit', 'out_for_delivery'];

/** Freight from a rate card. model: fixed (base) | per_km | per_unit | per_weight | zone (base = zone price); handling and cold chain are added. */
function calcFreight(card, { distance_km = 0, weight_kg = 0, units = 0, cold_chain = false } = {}) {
  if (!card) return 0;
  const base = num(card.base_amount); const rate = num(card.rate);
  const by = { fixed: base, zone: base, per_km: base + rate * num(distance_km), per_unit: base + rate * num(units), per_weight: base + rate * num(weight_kg) }[card.model] ?? base;
  return round2(by + num(card.handling_charge) + (cold_chain ? num(card.cold_chain_charge) : 0));
}

const shipFields = {
  method: z.enum(['own_vehicle', 'partner']).optional(), vehicle_id: uuidOrNull, partner_id: uuidOrNull, rate_card_id: uuidOrNull, driver_name: text(200), expected_at: optDate,
  tracking_ref: text(200), distance_km: optNum(0, 1e6), weight_kg: optNum(0, 1e7), estimated_freight: optNum(0), notes: text(2000),
};
const createSchema = z.object({ sales_order_id: uuidOrNull, transfer_id: uuidOrNull, to_outlet_note: text(100), lines: z.array(z.object({ product_id: uuid, batch_id: uuid, qty: z.coerce.number().positive() })).optional(), ...shipFields });
const updateSchema = z.object(shipFields).partial().extend({ actual_freight: optNum(0).nullable(), freight_status: z.enum(['unpaid', 'paid']).optional(), reason: text(300) });
const deliverSchema = z.object({ lines: z.array(z.object({ product_id: uuid, batch_id: uuid, delivered_qty: z.coerce.number().min(0), damaged_qty: z.coerce.number().min(0).default(0), missing_qty: z.coerce.number().min(0).default(0) })).optional(), pod_note: text(1000), delivered_at: optDate, actual_freight: optNum(0) });

async function refsOk(tx, orgId, i) {
  if (i.vehicle_id && !(await tx.nxVehicle.findFirst({ where: { id: i.vehicle_id, org_id: orgId, deleted_at: null } }))) fail('invalid_ref', 'vehicle');
  if (i.partner_id && !(await tx.nxLogisticsPartner.findFirst({ where: { id: i.partner_id, org_id: orgId, deleted_at: null } }))) fail('invalid_ref', 'partner');
  if (i.rate_card_id && !(await tx.nxRateCard.findFirst({ where: { id: i.rate_card_id, org_id: orgId, deleted_at: null } }))) fail('invalid_ref', 'rate card');
}

async function estimate(tx, orgId, i, lines) {
  if (i.estimated_freight !== undefined && i.estimated_freight !== null) return i.estimated_freight;
  if (!i.rate_card_id) return 0;
  const card = await tx.nxRateCard.findFirst({ where: { id: i.rate_card_id, org_id: orgId } });
  const prods = await tx.nxProduct.findMany({ where: { org_id: orgId, id: { in: lines.map((l) => l.product_id) } }, select: { cold_chain: true } });
  return calcFreight(card, { distance_km: i.distance_km, weight_kg: i.weight_kg, units: lines.reduce((a, l) => a + num(l.qty), 0), cold_chain: prods.some((p) => p.cold_chain) });
}

const out = (s, names = {}) => ({
  id: s.id, shipment_no: s.shipment_no, sales_order_id: s.sales_order_id, so_no: names.so_no, transfer_id: s.transfer_id, from_warehouse_id: s.from_warehouse_id, from: names.from, to_warehouse_id: s.to_warehouse_id, customer_id: s.customer_id, customer: names.customer, outlet_id: s.outlet_id, outlet: names.outlet,
  method: s.method, vehicle_id: s.vehicle_id, vehicle: names.vehicle, partner_id: s.partner_id, partner: names.partner, rate_card_id: s.rate_card_id, driver_name: s.driver_name, status: s.status, dispatch_at: s.dispatch_at, expected_at: dayOf(s.expected_at), delivered_at: s.delivered_at, tracking_ref: s.tracking_ref,
  estimated_freight: num(s.estimated_freight), actual_freight: s.actual_freight === null ? null : num(s.actual_freight), freight_variance: s.actual_freight === null ? null : round2(num(s.actual_freight) - num(s.estimated_freight)), freight_status: s.freight_status, distance_km: s.distance_km === null ? null : num(s.distance_km), weight_kg: s.weight_kg === null ? null : num(s.weight_kg),
  lines: s.lines, pod_note: s.pod_note, damaged_qty: num(s.damaged_qty), missing_qty: num(s.missing_qty), notes: s.notes,
});
async function names(orgId, rows) {
  const [W, C, O, V, P, S] = await Promise.all([
    prisma.nxWarehouse.findMany({ where: { org_id: orgId } }), prisma.nxCustomer.findMany({ where: { org_id: orgId } }), prisma.nxOutlet.findMany({ where: { org_id: orgId }, select: { id: true, name: true } }),
    prisma.nxVehicle.findMany({ where: { org_id: orgId } }), prisma.nxLogisticsPartner.findMany({ where: { org_id: orgId } }), prisma.nxSalesOrder.findMany({ where: { org_id: orgId, id: { in: rows.map((r) => r.sales_order_id).filter(Boolean) } }, select: { id: true, so_no: true } }),
  ]);
  const w = stock.mapBy(W); const c = stock.mapBy(C); const o = stock.mapBy(O); const v = stock.mapBy(V); const p = stock.mapBy(P); const s = stock.mapBy(S);
  return (r) => ({ from: w.get(r.from_warehouse_id)?.name, customer: c.get(r.customer_id)?.name, outlet: o.get(r.outlet_id)?.name, vehicle: v.get(r.vehicle_id)?.reg_no, partner: p.get(r.partner_id)?.name, so_no: s.get(r.sales_order_id)?.so_no });
}

async function list(orgId, f = {}, scope) {
  const where = { org_id: orgId, deleted_at: null, ...(f.status ? { status: f.status } : {}), ...(f.method ? { method: f.method } : {}), ...(f.partner_id ? { partner_id: f.partner_id } : {}), ...(f.vehicle_id ? { vehicle_id: f.vehicle_id } : {}), ...(f.sales_order_id ? { sales_order_id: f.sales_order_id } : {}), ...(f.warehouse_id ? { from_warehouse_id: f.warehouse_id } : {}), ...(f.freight_status ? { freight_status: f.freight_status } : {}) };
  if (scope) where.outlet_id = f.outlet_id && scope.includes(f.outlet_id) ? f.outlet_id : { in: scope };
  else if (f.outlet_id) where.outlet_id = f.outlet_id;
  if (f.from || f.to) where.created_at = { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lt: toDate(new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)) } : {}) };
  if (f.q) where.shipment_no = { contains: String(f.q), mode: 'insensitive' };
  const rows = await prisma.nxShipment.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 });
  const nm = await names(orgId, rows);
  return rows.map((r) => out(r, nm(r)));
}

async function get(orgId, id, scope) {
  const s = await prisma.nxShipment.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!s) fail('not_found');
  if (!outletAllowed(scope, s.outlet_id)) fail('forbidden_outlet');
  const nm = await names(orgId, [s]);
  const [prods, batches, inv, trips] = await Promise.all([
    prisma.nxProduct.findMany({ where: { org_id: orgId, id: { in: s.lines.map((l) => l.product_id) } } }), prisma.nxBatch.findMany({ where: { org_id: orgId, id: { in: s.lines.map((l) => l.batch_id) } } }),
    prisma.nxInvoice.findFirst({ where: { org_id: orgId, type: 'sales', source_type: 'shipment', source_id: id, status: { not: 'cancelled' } } }),
    prisma.nxTrip.findMany({ where: { org_id: orgId, shipment_id: id, deleted_at: null } }),
  ]);
  const P = stock.mapBy(prods); const B = stock.mapBy(batches);
  const tripCost = round2(trips.reduce((a, t) => a + num(t.fuel_cost) + num(t.toll_cost) + num(t.maintenance_cost) + num(t.other_cost), 0));
  const freight = s.method === 'partner' ? num(s.actual_freight ?? 0) : tripCost;
  const revenue = inv ? num(inv.subtotal) : 0;
  let cogs = 0;
  if (inv) for (const l of inv.lines || []) cogs += num(l.qty) * num(B.get(l.batch_id)?.unit_cost);
  return { ...out(s, nm(s)), lines: s.lines.map((l) => ({ ...l, product: P.get(l.product_id)?.name, sku: P.get(l.product_id)?.sku, batch_no: B.get(l.batch_id)?.batch_no, expiry_date: dayOf(B.get(l.batch_id)?.expiry_date) })), invoice: inv ? { id: inv.id, invoice_no: inv.invoice_no, status: inv.status, total: num(inv.total) } : null, trip_cost: tripCost, profitability: inv ? { revenue, cogs: round2(cogs), freight_cost: round2(freight), profit: round2(revenue - cogs - freight) } : null };
}

async function create(orgId, actorId, body, scope) {
  const input = createSchema.parse(body);
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    await refsOk(tx, orgId, input);
    const method = input.method || (input.partner_id ? 'partner' : 'own_vehicle');
    let lines = input.lines; let so = null; let tr = null;
    if (input.sales_order_id) {
      so = await tx.nxSalesOrder.findFirst({ where: { id: input.sales_order_id, org_id: orgId, deleted_at: null } });
      if (!so) fail('invalid_ref', 'sales order');
      if (!outletAllowed(scope, so.outlet_id)) fail('forbidden_outlet');
      if (!['confirmed', 'partially_fulfilled'].includes(so.status)) fail('bad_status');
      const soLines = so.lines.map((l) => ({ ...l, allocations: (l.allocations || []).map((a) => ({ ...a })) }));
      const picked = [];
      if (!lines) { for (const l of soLines) for (const a of l.allocations) { const q = round3(num(a.qty) - num(a.committed_qty)); if (q > 0) picked.push({ product_id: l.product_id, batch_id: a.batch_id, qty: q }); } }
      else for (const l of lines) picked.push(l);
      if (!picked.length) fail('nothing_to_invoice', 'no reserved stock is left to ship');
      for (const p of picked) {
        const line = soLines.find((x) => x.product_id === p.product_id);
        const a = line?.allocations.find((x) => x.batch_id === p.batch_id);
        if (!a || round3(num(a.qty) - num(a.committed_qty)) < num(p.qty) - 0.0001) fail('bad_qty', 'more than is reserved for this order');
        a.committed_qty = round3(num(a.committed_qty) + num(p.qty));
      }
      lines = picked;
      await tx.nxSalesOrder.update({ where: { id: so.id }, data: { lines: soLines } });
    } else if (input.transfer_id) {
      tr = await tx.nxTransfer.findFirst({ where: { id: input.transfer_id, org_id: orgId, deleted_at: null } });
      if (!tr) fail('invalid_ref', 'transfer');
      lines = lines || tr.lines.map((l) => ({ product_id: l.product_id, batch_id: l.batch_id, qty: l.qty }));
    } else fail('invalid_ref', 'a shipment needs a sales order or a transfer');
    const est = await estimate(tx, orgId, input, lines);
    const s = await tx.nxShipment.create({ data: { org_id: orgId, created_by: actorId, shipment_no: await nextNo(tx, orgId, 'shipment', 'SHP', 4), sales_order_id: so?.id || null, transfer_id: tr?.id || null, from_warehouse_id: so?.warehouse_id || tr.from_warehouse_id, to_warehouse_id: tr?.to_warehouse_id || null, customer_id: so?.customer_id || null, outlet_id: so?.outlet_id || null, method, vehicle_id: input.vehicle_id, partner_id: input.partner_id, rate_card_id: input.rate_card_id, driver_name: input.driver_name, expected_at: toDate(input.expected_at || (so?.expected_date ? dayOf(so.expected_date) : null)), tracking_ref: input.tracking_ref, estimated_freight: est, distance_km: input.distance_km, weight_kg: input.weight_kg, lines: lines.map((l) => ({ product_id: l.product_id, batch_id: l.batch_id, qty: l.qty, delivered_qty: 0, damaged_qty: 0, missing_qty: 0 })), notes: input.notes } });
    await audit(tx, orgId, actorId, 'shipment', s.id, 'create', null, { shipment_no: s.shipment_no, estimated_freight: est });
    return out(s);
  }, { timeout: 30000 });
}

async function update(orgId, actorId, id, body, ctx = {}) {
  const input = updateSchema.parse(body || {});
  const { reason, actual_freight, freight_status, ...rest } = input;
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const s = await tx.nxShipment.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
    if (!s) fail('not_found');
    await refsOk(tx, orgId, rest);
    const data = { ...rest, updated_by: actorId };
    if ('expected_at' in rest) data.expected_at = toDate(rest.expected_at);
    if (actual_freight !== undefined) data.actual_freight = actual_freight;
    if (freight_status) data.freight_status = freight_status;
    if (rest.rate_card_id && rest.estimated_freight === undefined) { const q = await estimate(tx, orgId, { ...s, ...rest, estimated_freight: undefined }, s.lines); data.estimated_freight = q; }
    let row = await tx.nxShipment.update({ where: { id }, data });
    row = await syncFreightEntry(tx, orgId, actorId, row, { ...ctx, reason: ctx.reason || reason });
    await audit(tx, orgId, actorId, 'shipment', id, 'update', { actual_freight: s.actual_freight === null ? null : num(s.actual_freight), status: s.status }, { actual_freight: row.actual_freight === null ? null : num(row.actual_freight), freight_status: row.freight_status }, reason);
    return out(row);
  });
}

/** One expense entry per partner shipment, kept in step with its actual freight and payment status (no duplicate, no second entry). */
async function syncFreightEntry(tx, orgId, actorId, s, ctx = {}) {
  if (s.method !== 'partner' || s.actual_freight === null) return s;
  const amount = round2(num(s.actual_freight));
  const status = s.freight_status === 'paid' ? 'paid' : 'unpaid';
  if (s.freight_entry_id) {
    const e = await tx.nxEntry.findFirst({ where: { id: s.freight_entry_id, org_id: orgId } });
    if (e && (num(e.amount) !== amount || e.payment_status !== status)) {
      await lockGuard(orgId, [dayOf(e.entry_date)], ctx);
      await tx.nxEntry.update({ where: { id: e.id }, data: { amount, payment_status: status, updated_by: actorId } });
      await lockTouch(orgId, [dayOf(e.entry_date)]);
    }
    return s;
  }
  if (amount <= 0) return s;
  const date = today();
  await lockGuard(orgId, [date], ctx);
  const cat = await categoryId(tx, orgId, 'expense', 'Freight and logistics');
  const partner = s.partner_id ? await tx.nxLogisticsPartner.findFirst({ where: { id: s.partner_id } }) : null;
  const e = await billing.makeEntry(tx, orgId, actorId, { kind: 'expense', category_id: cat, outlet_id: s.outlet_id, date, amount, expense_class: 'operating', payment_status: status, party_name: partner?.name, reference: s.shipment_no, description: `Freight, ${s.shipment_no}`, source_type: 'shipment', source_id: s.id });
  await lockTouch(orgId, [date]);
  return tx.nxShipment.update({ where: { id: s.id }, data: { freight_entry_id: e.id } });
}

/** status changes by people. dispatch posts stock; deliver / fail / return post what came back. */
async function setStatus(orgId, actorId, id, status, body = {}, ctx = {}, scope) {
  if (!STATUSES.includes(status)) fail('bad_status');
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const s = await tx.nxShipment.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
    if (!s) fail('not_found');
    if (!outletAllowed(scope, s.outlet_id)) fail('forbidden_outlet');
    const so = s.sales_order_id ? await tx.nxSalesOrder.findFirst({ where: { id: s.sales_order_id, org_id: orgId } }) : null;
    const before = s.status;
    let data = { status, updated_by: actorId };
    const isStep = status in ORDER;
    if (isStep) {
      if (before === 'cancelled' || !(before in ORDER)) fail('bad_status');
      if (ORDER[status] < ORDER[before]) fail('bad_status');
    }
    if (status === 'dispatched') {
      if (before !== 'pending_dispatch' && before !== 'ready_for_dispatch') fail('bad_status');
      data.dispatch_at = new Date();
      if (so) await dispatchOrderStock(tx, orgId, actorId, s, so);
    } else if (['in_transit', 'out_for_delivery'].includes(status)) {
      if (!AFTER_DISPATCH.includes(before) && !(before === 'dispatched')) fail('bad_status');
    } else if (status === 'ready_for_dispatch') {
      if (before !== 'pending_dispatch') fail('bad_status');
    } else if (status === 'delivered' || status === 'partially_delivered') {
      if (!AFTER_DISPATCH.includes(before)) fail('bad_status');
      const input = deliverSchema.parse(body);
      const r = await deliverStock(tx, orgId, actorId, s, so, input);
      data = { ...data, status: r.status, delivered_at: input.delivered_at ? toDate(input.delivered_at) : new Date(), lines: r.lines, damaged_qty: r.damaged, missing_qty: r.missing, pod_note: input.pod_note ?? s.pod_note };
      if (input.actual_freight !== undefined) data.actual_freight = input.actual_freight;
    } else if (status === 'delivery_failed') {
      if (!AFTER_DISPATCH.includes(before)) fail('bad_status');
      data.pod_note = body.pod_note || s.pod_note;
    } else if (status === 'returned') {
      if (!['delivery_failed', ...AFTER_DISPATCH, 'delivered', 'partially_delivered'].includes(before)) fail('bad_status');
      if (['delivered', 'partially_delivered'].includes(before)) fail('bad_status');
      await returnStock(tx, orgId, actorId, s, so);
      data.pod_note = body.pod_note || s.pod_note;
    } else if (status === 'cancelled') {
      if (!['pending_dispatch', 'ready_for_dispatch'].includes(before)) fail('bad_status');
      if (so) await uncommit(tx, orgId, s, so);
    }
    let row = await tx.nxShipment.update({ where: { id }, data });
    if (so && ['dispatched', 'delivered', 'partially_delivered', 'returned'].includes(row.status)) await sales.refreshFulfilment(tx, orgId, so.id);
    row = await syncFreightEntry(tx, orgId, actorId, row, ctx);
    await audit(tx, orgId, actorId, 'shipment', id, 'status', { status: before }, { status: row.status }, body.reason);
    return out(row);
  }, { timeout: 30000 });
}

async function uncommit(tx, orgId, s, so) {
  const lines = so.lines.map((l) => ({ ...l, allocations: (l.allocations || []).map((a) => ({ ...a })) }));
  for (const sl of s.lines) {
    const a = lines.find((x) => x.product_id === sl.product_id)?.allocations.find((x) => x.batch_id === sl.batch_id);
    if (a) a.committed_qty = Math.max(0, round3(num(a.committed_qty) - num(sl.qty)));
  }
  await tx.nxSalesOrder.update({ where: { id: so.id }, data: { lines } });
}

/** Dispatch: the reserved quantity leaves the warehouse. Expired / quarantined / recalled batches cannot be dispatched. */
async function dispatchOrderStock(tx, orgId, actorId, s, so) {
  const B = new Map((await tx.nxBatch.findMany({ where: { org_id: orgId, id: { in: s.lines.map((l) => l.batch_id) } } })).map((b) => [b.id, b]));
  const td = today();
  const lines = so.lines.map((l) => ({ ...l, allocations: (l.allocations || []).map((a) => ({ ...a })) }));
  const legs = [];
  s.lines.forEach((sl, i) => {
    if (!stock.eligibleBatch(B.get(sl.batch_id), td, 0)) fail('expired_batch', { batch_id: sl.batch_id });
    legs.push({ product_id: sl.product_id, batch_id: sl.batch_id, warehouse_id: s.from_warehouse_id, bucket: 'reserved', qty: -num(sl.qty), movement: 'sale_dispatch', ref_type: 'shipment', ref_id: s.id, posting_key: `shp:${s.id}:${i}:dispatch` });
    const line = lines.find((x) => x.product_id === sl.product_id);
    const a = line?.allocations.find((x) => x.batch_id === sl.batch_id);
    if (!a) fail('invalid_ref', 'allocation');
    a.shipped_qty = round3(num(a.shipped_qty) + num(sl.qty));
    line.shipped_qty = round3(num(line.shipped_qty) + num(sl.qty));
  });
  await stock.postLegs(tx, orgId, actorId, legs);
  await tx.nxSalesOrder.update({ where: { id: so.id }, data: { lines } });
}

async function deliverStock(tx, orgId, actorId, s, so, input) {
  const lines = s.lines.map((l) => ({ ...l }));
  const legs = []; let damaged = 0; let missing = 0; let partial = false;
  lines.forEach((l, i) => {
    const given = input.lines?.find((x) => x.product_id === l.product_id && x.batch_id === l.batch_id);
    const d = given ? num(given.delivered_qty) : num(l.qty);
    const dm = given ? num(given.damaged_qty) : 0; const ms = given ? num(given.missing_qty) : 0;
    if (round3(d + dm + ms) > round3(num(l.qty)) + 0.0001) fail('bad_qty', 'delivered + damaged + missing is more than shipped');
    const back = round3(num(l.qty) - d - dm - ms);
    Object.assign(l, { delivered_qty: d, damaged_qty: dm, missing_qty: ms, returned_qty: back });
    damaged += dm; missing += ms;
    if (dm > 0 || ms > 0 || back > 0) partial = true;
    const base = { product_id: l.product_id, batch_id: l.batch_id, warehouse_id: s.from_warehouse_id, movement: 'delivery_return', ref_type: 'shipment', ref_id: s.id };
    if (so) { // customer shipments left stock at dispatch; what did not stay with the customer comes back
      if (dm > 0) legs.push({ ...base, bucket: 'damaged', qty: dm, posting_key: `shp:${s.id}:${i}:dmg`, note: 'damaged at delivery' });
      if (ms > 0) legs.push({ ...base, bucket: 'lost', qty: ms, posting_key: `shp:${s.id}:${i}:miss`, note: 'missing at delivery' });
      if (back > 0) legs.push({ ...base, bucket: 'quarantine', qty: back, posting_key: `shp:${s.id}:${i}:back`, note: 'undelivered, awaiting inspection' });
    }
  });
  await stock.postLegs(tx, orgId, actorId, legs);
  if (so) {
    const sol = so.lines.map((l) => ({ ...l }));
    for (const l of lines) { const x = sol.find((q) => q.product_id === l.product_id); if (x) x.delivered_qty = round3(num(x.delivered_qty) + num(l.delivered_qty)); }
    await tx.nxSalesOrder.update({ where: { id: so.id }, data: { lines: sol } });
  }
  return { lines, damaged, missing, status: partial ? 'partially_delivered' : 'delivered' };
}

/** A failed delivery comes back: stock returns to quarantine (to be inspected) and the order line goes back to backorder. */
async function returnStock(tx, orgId, actorId, s, so) {
  if (!so) return;
  const lines = so.lines.map((l) => ({ ...l, allocations: (l.allocations || []).map((a) => ({ ...a })) }));
  const legs = [];
  s.lines.forEach((sl, i) => {
    legs.push({ product_id: sl.product_id, batch_id: sl.batch_id, warehouse_id: s.from_warehouse_id, bucket: 'quarantine', qty: num(sl.qty), movement: 'delivery_return', ref_type: 'shipment', ref_id: s.id, posting_key: `shp:${s.id}:${i}:ret`, note: 'returned undelivered, awaiting inspection' });
    const line = lines.find((x) => x.product_id === sl.product_id);
    const a = line?.allocations.find((x) => x.batch_id === sl.batch_id);
    if (a) { a.qty = Math.max(0, round3(num(a.qty) - num(sl.qty))); a.shipped_qty = Math.max(0, round3(num(a.shipped_qty) - num(sl.qty))); a.committed_qty = Math.max(0, round3(num(a.committed_qty) - num(sl.qty))); }
    if (line) { line.shipped_qty = Math.max(0, round3(num(line.shipped_qty) - num(sl.qty))); line.allocated_qty = Math.max(0, round3(num(line.allocated_qty) - num(sl.qty))); line.backorder_qty = round3(num(line.qty) - num(line.allocated_qty)); }
  });
  await stock.postLegs(tx, orgId, actorId, legs);
  await tx.nxSalesOrder.update({ where: { id: so.id }, data: { lines } });
}

// ---------------- vehicle trips ----------------
const tripSchema = z.object({ vehicle_id: uuid, shipment_id: uuidOrNull, trip_date: optDate, distance_km: optNum(0, 1e6), fuel_cost: optNum(0), toll_cost: optNum(0), maintenance_cost: optNum(0), other_cost: optNum(0), notes: text(1000), reason: text(300) });
const tripTotal = (t) => round2(num(t.fuel_cost) + num(t.toll_cost) + num(t.maintenance_cost) + num(t.other_cost));
const tripOut = (t, names = {}) => ({ id: t.id, vehicle_id: t.vehicle_id, vehicle: names.vehicle, shipment_id: t.shipment_id, shipment_no: names.shipment, trip_date: dayOf(t.trip_date), distance_km: t.distance_km === null ? null : num(t.distance_km), fuel_cost: num(t.fuel_cost), toll_cost: num(t.toll_cost), maintenance_cost: num(t.maintenance_cost), other_cost: num(t.other_cost), total_cost: tripTotal(t), notes: t.notes });

async function listTrips(orgId, f = {}) {
  const where = { org_id: orgId, deleted_at: null, ...(f.vehicle_id ? { vehicle_id: f.vehicle_id } : {}), ...(f.shipment_id ? { shipment_id: f.shipment_id } : {}) };
  if (f.from || f.to) where.trip_date = { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lte: toDate(f.to) } : {}) };
  const rows = await prisma.nxTrip.findMany({ where, orderBy: { trip_date: 'desc' }, take: 500 });
  const [V, S] = await Promise.all([prisma.nxVehicle.findMany({ where: { org_id: orgId } }), prisma.nxShipment.findMany({ where: { org_id: orgId, id: { in: rows.map((r) => r.shipment_id).filter(Boolean) } }, select: { id: true, shipment_no: true } })]);
  const v = stock.mapBy(V); const s = stock.mapBy(S);
  return rows.map((t) => tripOut(t, { vehicle: v.get(t.vehicle_id)?.reg_no, shipment: s.get(t.shipment_id)?.shipment_no }));
}

async function saveTrip(orgId, actorId, id, body, ctx = {}) {
  const input = tripSchema.parse(body);
  const date = input.trip_date || today();
  await lockGuard(orgId, [date], { ...ctx, reason: ctx.reason || input.reason });
  return prisma.$transaction(async (tx) => {
    if (!(await tx.nxVehicle.findFirst({ where: { id: input.vehicle_id, org_id: orgId, deleted_at: null } }))) fail('invalid_ref', 'vehicle');
    const sh = input.shipment_id ? await tx.nxShipment.findFirst({ where: { id: input.shipment_id, org_id: orgId } }) : null;
    if (input.shipment_id && !sh) fail('invalid_ref', 'shipment');
    const { reason, ...rest } = input;
    const data = { ...rest, trip_date: toDate(date) };
    let trip;
    if (id) {
      const before = await tx.nxTrip.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
      if (!before) fail('not_found');
      trip = await tx.nxTrip.update({ where: { id }, data: { ...data, updated_by: actorId } });
    } else trip = await tx.nxTrip.create({ data: { ...data, org_id: orgId, created_by: actorId } });
    const total = tripTotal(trip);
    if (trip.entry_id) await tx.nxEntry.update({ where: { id: trip.entry_id }, data: { amount: total, entry_date: toDate(date), outlet_id: sh?.outlet_id || null, payment_status: total > 0 ? 'paid' : 'cancelled' } });
    else if (total > 0) {
      const cat = await categoryId(tx, orgId, 'expense', 'Fuel and vehicle');
      const veh = await tx.nxVehicle.findFirst({ where: { id: trip.vehicle_id } });
      const e = await billing.makeEntry(tx, orgId, actorId, { kind: 'expense', category_id: cat, outlet_id: sh?.outlet_id || null, date, amount: total, expense_class: 'operating', payment_status: 'paid', party_name: veh?.reg_no, reference: sh?.shipment_no, description: `Vehicle trip ${veh?.reg_no || ''}`, source_type: 'trip', source_id: trip.id });
      trip = await tx.nxTrip.update({ where: { id: trip.id }, data: { entry_id: e.id } });
    }
    await audit(tx, orgId, actorId, 'trip', trip.id, id ? 'update' : 'create', null, { total_cost: total }, reason);
    await lockTouch(orgId, [date]);
    return tripOut(trip);
  });
}

module.exports = { STATUSES, calcFreight, list, get, create, update, setStatus, listTrips, saveTrip };
