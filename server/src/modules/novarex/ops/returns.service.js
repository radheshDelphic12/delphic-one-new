const { z, prisma, fail, num, round3, today, dayOf, toDate, text, optDate, uuid, uuidOrNull, nextNo, lockOrg, lockGuard, lockTouch, audit } = require('./common');
const stock = require('./stock.service');
const billing = require('./billing.service');

// Returns, damaged / expired stock and product recalls.
//  * Customer / outlet return (type sales): the goods arrive in QUARANTINE, never straight back into sellable stock. An inspection decides
//    the disposition: restock (-> available, cost of sales reversed), damaged, destroy (-> lost) or supplier_return. A credit note against
//    the original invoice reduces revenue in the month it is issued.
//  * Supplier return (type purchase): stock leaves from the chosen bucket and a debit note is raised against the supplier.
//  * Recall: the batch is flagged recalled, so it can no longer be allocated, dispatched or transferred; its path is traceable.
const DISPOSITIONS = ['restock', 'damaged', 'destroy', 'supplier_return'];
const createSchema = z.object({
  type: z.enum(['sales', 'purchase']), invoice_id: uuidOrNull, shipment_id: uuidOrNull, supplier_id: uuidOrNull, warehouse_id: uuid, product_id: uuid, batch_id: uuid,
  qty: z.coerce.number().positive().max(1e9), reason: z.string().trim().min(2).max(300), return_date: optDate, from_bucket: z.enum(['available', 'damaged', 'quarantine']).optional(),
});
const resolveSchema = z.object({ disposition: z.enum(DISPOSITIONS), issue_credit: z.boolean().optional(), reason: text(300) });

const out = (r, names = {}) => ({ id: r.id, return_no: r.return_no, type: r.type, invoice_id: r.invoice_id, shipment_id: r.shipment_id, supplier_id: r.supplier_id, warehouse_id: r.warehouse_id, warehouse: names.warehouse, product_id: r.product_id, product: names.product, batch_id: r.batch_id, batch_no: names.batch, qty: num(r.qty), reason: r.reason, status: r.status, disposition: r.disposition, return_date: dayOf(r.return_date), credit_invoice_id: r.credit_invoice_id });

async function list(orgId, f = {}) {
  const rows = await prisma.nxGoodsReturn.findMany({ where: { org_id: orgId, deleted_at: null, ...(f.type ? { type: f.type } : {}), ...(f.status ? { status: f.status } : {}), ...(f.warehouse_id ? { warehouse_id: f.warehouse_id } : {}), ...(f.product_id ? { product_id: f.product_id } : {}) }, orderBy: { created_at: 'desc' }, take: 500 });
  const [P, B, W] = await Promise.all([prisma.nxProduct.findMany({ where: { org_id: orgId } }), prisma.nxBatch.findMany({ where: { org_id: orgId, id: { in: rows.map((r) => r.batch_id) } } }), prisma.nxWarehouse.findMany({ where: { org_id: orgId } })]);
  const p = stock.mapBy(P); const b = stock.mapBy(B); const w = stock.mapBy(W);
  return rows.map((r) => out(r, { product: p.get(r.product_id)?.name, batch: b.get(r.batch_id)?.batch_no, warehouse: w.get(r.warehouse_id)?.name }));
}

async function create(orgId, actorId, body) {
  const input = createSchema.parse(body);
  const date = input.return_date || today();
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const [b, w] = await Promise.all([tx.nxBatch.findFirst({ where: { id: input.batch_id, org_id: orgId, product_id: input.product_id } }), tx.nxWarehouse.findFirst({ where: { id: input.warehouse_id, org_id: orgId, deleted_at: null } })]);
    if (!b || !w) fail('invalid_ref');
    const returnNo = await nextNo(tx, orgId, 'return', 'RET', 4);
    if (input.type === 'sales') {
      let inv = null;
      if (input.invoice_id) {
        inv = await tx.nxInvoice.findFirst({ where: { id: input.invoice_id, org_id: orgId, type: 'sales' } });
        if (!inv) fail('invalid_ref', 'invoice');
        const onInv = (inv.lines || []).filter((l) => l.product_id === input.product_id && l.batch_id === input.batch_id).reduce((a, l) => a + num(l.qty), 0);
        const prior = await tx.nxGoodsReturn.findMany({ where: { org_id: orgId, type: 'sales', invoice_id: inv.id, product_id: input.product_id, batch_id: input.batch_id, deleted_at: null } });
        if (round3(prior.reduce((a, r) => a + num(r.qty), 0) + input.qty) > round3(onInv) + 0.0001) fail('bad_qty', 'more than was invoiced');
      }
      const r = await tx.nxGoodsReturn.create({ data: { org_id: orgId, created_by: actorId, return_no: returnNo, type: 'sales', invoice_id: inv?.id || null, shipment_id: input.shipment_id, warehouse_id: w.id, product_id: input.product_id, batch_id: b.id, qty: input.qty, reason: input.reason, return_date: toDate(date), actor_id: actorId } });
      await stock.postLegs(tx, orgId, actorId, [{ product_id: input.product_id, batch_id: b.id, warehouse_id: w.id, bucket: 'quarantine', qty: input.qty, movement: 'return_in', ref_type: 'return', ref_id: r.id, posting_key: `ret:${r.id}:in`, note: 'returned goods, awaiting inspection' }]);
      await audit(tx, orgId, actorId, 'goods_return', r.id, 'create', null, { return_no: returnNo, qty: input.qty });
      return out(r);
    }
    // supplier return: goods leave stock now, a debit note follows
    const bucket = input.from_bucket || 'available';
    const r = await tx.nxGoodsReturn.create({ data: { org_id: orgId, created_by: actorId, return_no: returnNo, type: 'purchase', invoice_id: input.invoice_id, supplier_id: input.supplier_id || b.supplier_id, warehouse_id: w.id, product_id: input.product_id, batch_id: b.id, qty: input.qty, reason: input.reason, return_date: toDate(date), status: 'closed', disposition: 'supplier_return', actor_id: actorId } });
    await stock.postLegs(tx, orgId, actorId, [{ product_id: input.product_id, batch_id: b.id, warehouse_id: w.id, bucket, qty: -input.qty, movement: 'purchase_return', ref_type: 'return', ref_id: r.id, posting_key: `ret:${r.id}:out`, note: input.reason }]);
    const p = await tx.nxProduct.findFirst({ where: { id: input.product_id } });
    const dn = await billing.debitNote(tx, orgId, actorId, { supplier_id: r.supplier_id, invoice_id: input.invoice_id, lines: [{ product_id: p.id, sku: p.sku, name: p.name, batch_id: b.id, batch_no: b.batch_no, qty: input.qty, unit_price: num(b.unit_cost), discount_pct: 0, gst_rate: num(p.gst_rate) }], date, reason: input.reason });
    const done = await tx.nxGoodsReturn.update({ where: { id: r.id }, data: { credit_invoice_id: dn.id } });
    await audit(tx, orgId, actorId, 'goods_return', r.id, 'create', null, { return_no: returnNo, debit_note: dn.invoice_no });
    return out(done);
  });
}

/** Inspection of returned goods. Decides where the quarantined stock goes and whether a credit note is issued. */
async function resolve(orgId, actorId, id, body, ctx = {}) {
  const input = resolveSchema.parse(body || {});
  const date = today();
  const r0 = await prisma.nxGoodsReturn.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!r0) fail('not_found');
  const credit = input.issue_credit ?? Boolean(r0.invoice_id);
  if (credit) await lockGuard(orgId, [date], { ...ctx, reason: ctx.reason || input.reason });
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const claim = await tx.nxGoodsReturn.updateMany({ where: { id, org_id: orgId, type: 'sales', status: 'pending' }, data: { status: 'closed', disposition: input.disposition, updated_by: actorId } });
    if (claim.count !== 1) fail('bad_status');
    const r = await tx.nxGoodsReturn.findFirst({ where: { id, org_id: orgId } });
    const to = { restock: 'available', damaged: 'damaged', destroy: 'lost', supplier_return: 'lost' }[input.disposition];
    await stock.postLegs(tx, orgId, actorId, stock.movePair({ product_id: r.product_id, batch_id: r.batch_id, from: { warehouse_id: r.warehouse_id, bucket: 'quarantine' }, to: { warehouse_id: r.warehouse_id, bucket: to }, qty: num(r.qty), movement: 'return_disposition', ref_type: 'return', ref_id: r.id, posting_key: `ret:${r.id}:disp`, note: input.disposition }));
    let creditId = null;
    if (credit) {
      if (!r.invoice_id) fail('invalid_ref', 'a credit note needs the original invoice');
      const cn = await billing.creditNote(tx, orgId, actorId, r.invoice_id, { lines: [{ product_id: r.product_id, batch_id: r.batch_id, qty: num(r.qty) }], restocked: input.disposition === 'restock', date, reason: `${r.return_no}: ${r.reason}` });
      creditId = cn.id;
    }
    const done = await tx.nxGoodsReturn.update({ where: { id }, data: { credit_invoice_id: creditId } });
    await audit(tx, orgId, actorId, 'goods_return', id, 'resolve', { status: 'pending' }, { status: 'closed', disposition: input.disposition, credit_note: creditId }, input.reason);
    await lockTouch(orgId, [date]);
    return out(done);
  }, { timeout: 30000 });
}

// ---------------- recalls ----------------
const recallSchema = z.object({ product_id: uuid, batch_id: uuid, reason: z.string().trim().min(3).max(500), recall_date: optDate, notes: text(1000) });
async function listRecalls(orgId) {
  const rows = await prisma.nxRecall.findMany({ where: { org_id: orgId, deleted_at: null }, orderBy: { created_at: 'desc' }, take: 300 });
  const [P, B] = await Promise.all([prisma.nxProduct.findMany({ where: { org_id: orgId } }), prisma.nxBatch.findMany({ where: { org_id: orgId, id: { in: rows.map((r) => r.batch_id).filter(Boolean) } } })]);
  const p = stock.mapBy(P); const b = stock.mapBy(B);
  return rows.map((r) => ({ id: r.id, recall_no: r.recall_no, product_id: r.product_id, product: p.get(r.product_id)?.name, batch_id: r.batch_id, batch_no: b.get(r.batch_id)?.batch_no, reason: r.reason, status: r.status, recall_date: dayOf(r.recall_date), notes: r.notes }));
}
async function createRecall(orgId, actorId, body) {
  const input = recallSchema.parse(body);
  return prisma.$transaction(async (tx) => {
    const b = await tx.nxBatch.findFirst({ where: { id: input.batch_id, org_id: orgId, product_id: input.product_id } });
    if (!b) fail('invalid_ref', 'batch');
    const r = await tx.nxRecall.create({ data: { org_id: orgId, created_by: actorId, recall_no: await nextNo(tx, orgId, 'recall', 'RCL', 4), product_id: input.product_id, batch_id: b.id, reason: input.reason, recall_date: toDate(input.recall_date || today()), notes: input.notes, actor_id: actorId } });
    await tx.nxBatch.update({ where: { id: b.id }, data: { quality_status: 'recalled' } });
    await audit(tx, orgId, actorId, 'recall', r.id, 'create', { quality_status: b.quality_status }, { quality_status: 'recalled', reason: input.reason });
    return { id: r.id, recall_no: r.recall_no };
  });
}
async function closeRecall(orgId, actorId, id, body = {}) {
  const r = await prisma.nxRecall.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!r) fail('not_found');
  if (r.status === 'closed') fail('bad_status');
  await prisma.nxRecall.update({ where: { id }, data: { status: 'closed', notes: body.notes ?? r.notes } });
  await audit(prisma, orgId, actorId, 'recall', id, 'close', { status: 'open' }, { status: 'closed' }, body.reason);
  return { id, status: 'closed' };
}

module.exports = { list, create, resolve, listRecalls, createRecall, closeRecall, DISPOSITIONS };
