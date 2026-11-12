const { z, prisma, fail, num, round3, today, dayOf, toDate, text, optDate, uuid, nextNo, lockOrg, audit, outletAllowed } = require('./common');
const stock = require('./stock.service');
const core = require('../core.service');

// Stock transfers between the company's own locations (warehouse -> warehouse, warehouse -> outlet, outlet -> outlet).
//   draft -> approved -> dispatched -> received (or cancelled before dispatch)
// Dispatch moves stock out of the source's `available` into `in_transit` (bound for the destination); the destination's available stock
// only grows when receipt is confirmed. A transfer inside the company is never a sale or a purchase. Goods that go to a franchise or
// third-party outlet are sold to it, so a transfer to such an outlet is refused (use a sales order).
const line = z.object({ product_id: uuid, batch_id: uuid, qty: z.coerce.number().positive().max(1e9) });
const fields = { from_warehouse_id: uuid, to_warehouse_id: uuid, request_date: optDate, notes: text(1000), lines: z.array(line).min(1).max(300) };
const createSchema = z.object(fields).refine((v) => v.from_warehouse_id !== v.to_warehouse_id, { message: 'Source and destination must differ' });
const updateSchema = z.object(fields).partial().extend({ reason: text(300) });
const receiveSchema = z.object({ lines: z.array(z.object({ batch_id: uuid, product_id: uuid, received_qty: z.coerce.number().min(0), damaged_qty: z.coerce.number().min(0).default(0) })).optional(), notes: text(500) });

async function destinationKindCheck(tx, orgId, toId, fromId) {
  const whs = await tx.nxWarehouse.findMany({ where: { org_id: orgId, id: { in: [toId, fromId] }, deleted_at: null } });
  const to = whs.find((w) => w.id === toId); const from = whs.find((w) => w.id === fromId);
  if (!to || !from) fail('invalid_ref', 'warehouse');
  if (to.status !== 'active' || from.status !== 'active') fail('inactive_ref', 'warehouse');
  for (const w of [to]) {
    if (!w.outlet_id) continue;
    const o = await tx.nxOutlet.findFirst({ where: { id: w.outlet_id, org_id: orgId }, include: { ownership_type: { select: { kind: true } } } });
    if (o?.ownership_type && ['franchise', 'third_party'].includes(o.ownership_type.kind)) fail('use_sales_order');
  }
  return { from, to };
}

async function checkLines(tx, orgId, fromId, lines) {
  const b = await tx.nxBatch.findMany({ where: { org_id: orgId, id: { in: lines.map((l) => l.batch_id) } } });
  const B = new Map(b.map((x) => [x.id, x]));
  const need = new Map();
  for (const l of lines) {
    const batch = B.get(l.batch_id);
    if (!batch || batch.product_id !== l.product_id) fail('invalid_ref', 'batch');
    need.set(l.batch_id, round3((need.get(l.batch_id) || 0) + num(l.qty)));
  }
  for (const [batchId, q] of need) {
    const cur = await tx.nxStockLedger.aggregate({ where: { org_id: orgId, warehouse_id: fromId, batch_id: batchId, bucket: 'available' }, _sum: { qty: true } });
    if (round3(num(cur._sum.qty)) < q) fail('insufficient_stock', { batch_id: batchId });
  }
  return B;
}

const out = (t, names = {}) => ({ id: t.id, transfer_no: t.transfer_no, from_warehouse_id: t.from_warehouse_id, from: names.from, to_warehouse_id: t.to_warehouse_id, to: names.to, status: t.status, request_date: dayOf(t.request_date), lines: t.lines, notes: t.notes, dispatched_at: t.dispatched_at, received_at: t.received_at });

async function list(orgId, f = {}, scopeWh) {
  const where = { org_id: orgId, deleted_at: null, ...(f.status ? { status: f.status } : {}) };
  if (f.warehouse_id) where.OR = [{ from_warehouse_id: f.warehouse_id }, { to_warehouse_id: f.warehouse_id }];
  if (f.from || f.to) where.request_date = { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lte: toDate(f.to) } : {}) };
  const rows = await prisma.nxTransfer.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 });
  const W = stock.mapBy(await prisma.nxWarehouse.findMany({ where: { org_id: orgId } }));
  return rows.filter((t) => !scopeWh || scopeWh.includes(t.from_warehouse_id) || scopeWh.includes(t.to_warehouse_id)).map((t) => out(t, { from: W.get(t.from_warehouse_id)?.name, to: W.get(t.to_warehouse_id)?.name }));
}
async function get(orgId, id) {
  const t = await prisma.nxTransfer.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!t) fail('not_found');
  const W = stock.mapBy(await prisma.nxWarehouse.findMany({ where: { org_id: orgId, id: { in: [t.from_warehouse_id, t.to_warehouse_id] } } }));
  const prods = stock.mapBy(await prisma.nxProduct.findMany({ where: { org_id: orgId, id: { in: t.lines.map((l) => l.product_id) } } }));
  const batches = stock.mapBy(await prisma.nxBatch.findMany({ where: { org_id: orgId, id: { in: t.lines.map((l) => l.batch_id) } } }));
  return { ...out(t, { from: W.get(t.from_warehouse_id)?.name, to: W.get(t.to_warehouse_id)?.name }), lines: t.lines.map((l) => ({ ...l, product: prods.get(l.product_id)?.name, batch_no: batches.get(l.batch_id)?.batch_no })) };
}

async function create(orgId, actorId, body) {
  const input = createSchema.parse(body);
  return prisma.$transaction(async (tx) => {
    await destinationKindCheck(tx, orgId, input.to_warehouse_id, input.from_warehouse_id);
    await checkLines(tx, orgId, input.from_warehouse_id, input.lines);
    const t = await tx.nxTransfer.create({ data: { org_id: orgId, created_by: actorId, transfer_no: await nextNo(tx, orgId, 'transfer', 'TRF', 4), from_warehouse_id: input.from_warehouse_id, to_warehouse_id: input.to_warehouse_id, request_date: toDate(input.request_date || today()), lines: input.lines, notes: input.notes } });
    await audit(tx, orgId, actorId, 'transfer', t.id, 'create', null, { transfer_no: t.transfer_no });
    return out(t);
  });
}

async function update(orgId, actorId, id, body) {
  const input = updateSchema.parse(body || {});
  const { reason, ...rest } = input;
  return prisma.$transaction(async (tx) => {
    const t = await tx.nxTransfer.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
    if (!t) fail('not_found');
    if (!['draft', 'approved'].includes(t.status)) fail('bad_status');
    const from = rest.from_warehouse_id || t.from_warehouse_id; const to = rest.to_warehouse_id || t.to_warehouse_id;
    if (from === to) fail('same_location');
    await destinationKindCheck(tx, orgId, to, from);
    await checkLines(tx, orgId, from, rest.lines || t.lines);
    const data = { ...rest, updated_by: actorId, ...(t.status === 'approved' ? { status: 'draft', approved_by: null } : {}) };
    if ('request_date' in rest) data.request_date = toDate(rest.request_date || today());
    const row = await tx.nxTransfer.update({ where: { id }, data });
    await audit(tx, orgId, actorId, 'transfer', id, 'update', null, { transfer_no: row.transfer_no }, reason);
    return out(row);
  });
}

async function act(orgId, actorId, id, action, body = {}) {
  const settings = await core.ensureSettings(orgId);
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const t = await tx.nxTransfer.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
    if (!t) fail('not_found');
    if (action === 'approve') {
      if (t.status !== 'draft') fail('bad_status');
      const r = await tx.nxTransfer.update({ where: { id }, data: { status: 'approved', approved_by: actorId } });
      await audit(tx, orgId, actorId, 'transfer', id, 'approve', { status: t.status }, { status: 'approved' });
      return out(r);
    }
    if (action === 'cancel') {
      if (!['draft', 'approved'].includes(t.status)) fail('bad_status');
      const r = await tx.nxTransfer.update({ where: { id }, data: { status: 'cancelled' } });
      await audit(tx, orgId, actorId, 'transfer', id, 'cancel', { status: t.status }, { status: 'cancelled' }, body.reason);
      return out(r);
    }
    if (action === 'dispatch') {
      const claim = await tx.nxTransfer.updateMany({ where: { id, org_id: orgId, status: settings.require_transfer_approval ? 'approved' : { in: ['draft', 'approved'] } }, data: { status: 'dispatched', dispatched_at: new Date() } });
      if (claim.count !== 1) fail('bad_status');
      await destinationKindCheck(tx, orgId, t.to_warehouse_id, t.from_warehouse_id);
      const B = await checkLines(tx, orgId, t.from_warehouse_id, t.lines);
      const td = today(); const legs = [];
      t.lines.forEach((l, i) => {
        if (!stock.eligibleBatch(B.get(l.batch_id), td, 0)) fail('expired_batch', { batch_id: l.batch_id });
        legs.push(...stock.movePair({ product_id: l.product_id, batch_id: l.batch_id, from: { warehouse_id: t.from_warehouse_id, bucket: 'available' }, to: { warehouse_id: t.to_warehouse_id, bucket: 'in_transit' }, qty: num(l.qty), movement: 'transfer_out', ref_type: 'transfer', ref_id: t.id, posting_key: `trf:${t.id}:${i}:dispatch` }));
      });
      await stock.postLegs(tx, orgId, actorId, legs);
      await audit(tx, orgId, actorId, 'transfer', id, 'dispatch', { status: t.status }, { status: 'dispatched' });
      return out(await tx.nxTransfer.findFirst({ where: { id } }));
    }
    if (action === 'receive') {
      const input = receiveSchema.parse(body);
      const claim = await tx.nxTransfer.updateMany({ where: { id, org_id: orgId, status: 'dispatched' }, data: { status: 'received', received_at: new Date() } });
      if (claim.count !== 1) fail('bad_status');
      const legs = []; const lines = t.lines.map((l) => ({ ...l }));
      lines.forEach((l, i) => {
        const given = input.lines?.find((x) => x.batch_id === l.batch_id && x.product_id === l.product_id);
        const received = given ? num(given.received_qty) : num(l.qty);
        const damaged = given ? num(given.damaged_qty) : 0;
        if (received + damaged > num(l.qty) + 0.0001) fail('bad_qty', 'received + damaged is more than dispatched');
        const short = round3(num(l.qty) - received - damaged);
        Object.assign(l, { received_qty: received, damaged_qty: damaged, shortage_qty: short });
        const base = { product_id: l.product_id, batch_id: l.batch_id, warehouse_id: t.to_warehouse_id, movement: 'transfer_in', ref_type: 'transfer', ref_id: t.id };
        legs.push({ ...base, bucket: 'in_transit', qty: -num(l.qty), posting_key: `trf:${t.id}:${i}:rcv:transit` });
        if (received > 0) legs.push({ ...base, bucket: 'available', qty: received, posting_key: `trf:${t.id}:${i}:rcv:avail` });
        if (damaged > 0) legs.push({ ...base, bucket: 'damaged', qty: damaged, posting_key: `trf:${t.id}:${i}:rcv:dmg`, note: 'damaged in transit' });
        if (short > 0) legs.push({ ...base, bucket: 'lost', qty: short, posting_key: `trf:${t.id}:${i}:rcv:lost`, note: 'shortage on receipt' });
      });
      await stock.postLegs(tx, orgId, actorId, legs);
      await tx.nxTransfer.update({ where: { id }, data: { lines, notes: input.notes ? `${t.notes ? `${t.notes}\n` : ''}${input.notes}` : t.notes } });
      await audit(tx, orgId, actorId, 'transfer', id, 'receive', { status: 'dispatched' }, { status: 'received', discrepancies: lines.filter((l) => l.shortage_qty > 0 || l.damaged_qty > 0).length });
      return out(await tx.nxTransfer.findFirst({ where: { id } }));
    }
    return fail('bad_status');
  }, { timeout: 30000 });
}

module.exports = { list, get, create, update, act, outletAllowed };
