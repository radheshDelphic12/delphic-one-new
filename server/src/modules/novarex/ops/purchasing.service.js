const { z, prisma, fail, num, round2, round3, today, dayOf, toDate, addDays, text, optDate, uuid, uuidOrNull, nextNo, lockOrg, audit, gstSplit, priceLines } = require('./common');
const stock = require('./stock.service');
const billing = require('./billing.service');
const core = require('../core.service');

// Purchase orders and goods receipts.
//  PO: draft -> submitted -> approved -> partially_received -> received (or cancelled).
//  Receipt: draft -> posted. Posting is the ONLY thing that adds stock; it runs once (status guard + unique posting keys), creates the batch,
//  puts accepted units in `available`, damaged units in `damaged`, leaves rejected units out of stock, and records the supplier invoice
//  (payable). Purchases are inventory, not an expense: cost reaches the P&L as cost of goods sold when the goods are sold.

const poLine = z.object({ product_id: uuid, qty: z.coerce.number().positive().max(1e9), unit_price: z.coerce.number().min(0).max(1e9), gst_rate: z.coerce.number().min(0).max(100).optional(), notes: text(200) });
const poFields = { supplier_id: uuid, warehouse_id: uuid, order_date: optDate, expected_date: optDate, notes: text(2000), lines: z.array(poLine).min(1).max(300) };
const poCreate = z.object(poFields);
const poUpdate = z.object(poFields).partial().extend({ reason: text(300) });

async function loadRefs(tx, orgId, { supplier_id, warehouse_id, lines }) {
  const [sup, wh, prods] = await Promise.all([
    supplier_id ? tx.nxSupplier.findFirst({ where: { id: supplier_id, org_id: orgId, deleted_at: null } }) : null,
    warehouse_id ? tx.nxWarehouse.findFirst({ where: { id: warehouse_id, org_id: orgId, deleted_at: null } }) : null,
    lines ? tx.nxProduct.findMany({ where: { org_id: orgId, id: { in: lines.map((l) => l.product_id) }, deleted_at: null } }) : [],
  ]);
  if (supplier_id && !sup) fail('invalid_ref', 'supplier');
  if (warehouse_id && !wh) fail('invalid_ref', 'warehouse');
  if (lines && new Set(lines.map((l) => l.product_id)).size !== new Set(prods.map((p) => p.id)).size) fail('invalid_ref', 'product');
  return { sup, wh, prods: new Map(prods.map((p) => [p.id, p])) };
}

function buildPoLines(lines, prods, settings, keepReceived = []) {
  const raw = lines.map((l, i) => ({ product_id: l.product_id, sku: prods.get(l.product_id).sku, name: prods.get(l.product_id).name, qty: l.qty, unit_price: l.unit_price, discount_pct: 0, gst_rate: l.gst_rate ?? num(prods.get(l.product_id).gst_rate ?? settings.default_gst_rate), received_qty: num(keepReceived[i]?.received_qty), notes: l.notes || null }));
  return priceLines(raw);
}

const poOut = (p, names = {}) => ({ id: p.id, po_no: p.po_no, supplier_id: p.supplier_id, supplier: names.supplier, warehouse_id: p.warehouse_id, warehouse: names.warehouse, order_date: dayOf(p.order_date), expected_date: dayOf(p.expected_date), status: p.status, subtotal: num(p.subtotal), tax_total: num(p.tax_total), total: num(p.total), lines: p.lines, notes: p.notes });

async function listPO(orgId, f = {}) {
  const where = { org_id: orgId, deleted_at: null, ...(f.status ? { status: f.status } : {}), ...(f.supplier_id ? { supplier_id: f.supplier_id } : {}), ...(f.warehouse_id ? { warehouse_id: f.warehouse_id } : {}) };
  if (f.from || f.to) where.order_date = { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lte: toDate(f.to) } : {}) };
  if (f.q) where.po_no = { contains: String(f.q), mode: 'insensitive' };
  const rows = await prisma.nxPurchaseOrder.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 });
  const [S, W] = await Promise.all([prisma.nxSupplier.findMany({ where: { org_id: orgId } }), prisma.nxWarehouse.findMany({ where: { org_id: orgId } })]);
  const s = stock.mapBy(S); const w = stock.mapBy(W);
  return rows.map((r) => poOut(r, { supplier: s.get(r.supplier_id)?.name, warehouse: w.get(r.warehouse_id)?.name }));
}
async function getPO(orgId, id) {
  const r = await prisma.nxPurchaseOrder.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!r) fail('not_found');
  const [s, w, receipts] = await Promise.all([prisma.nxSupplier.findFirst({ where: { id: r.supplier_id } }), prisma.nxWarehouse.findFirst({ where: { id: r.warehouse_id } }), prisma.nxGoodsReceipt.findMany({ where: { org_id: orgId, po_id: id, deleted_at: null }, select: { id: true, grn_no: true, status: true, receipt_date: true } })]);
  return { ...poOut(r, { supplier: s?.name, warehouse: w?.name }), receipts: receipts.map((x) => ({ id: x.id, grn_no: x.grn_no, status: x.status, date: dayOf(x.receipt_date) })) };
}

async function createPO(orgId, actorId, body) {
  const input = poCreate.parse(body);
  const settings = await core.ensureSettings(orgId);
  return prisma.$transaction(async (tx) => {
    const { prods } = await loadRefs(tx, orgId, input);
    const priced = buildPoLines(input.lines, prods, settings);
    const po = await tx.nxPurchaseOrder.create({ data: { org_id: orgId, created_by: actorId, po_no: await nextNo(tx, orgId, 'po', 'PO', 4), supplier_id: input.supplier_id, warehouse_id: input.warehouse_id, order_date: toDate(input.order_date || today()), expected_date: toDate(input.expected_date), notes: input.notes, subtotal: priced.subtotal, tax_total: priced.tax_total, total: priced.total, lines: priced.lines } });
    await audit(tx, orgId, actorId, 'purchase_order', po.id, 'create', null, { po_no: po.po_no, total: priced.total });
    return poOut(po);
  });
}

async function updatePO(orgId, actorId, id, body) {
  const input = poUpdate.parse(body || {});
  const settings = await core.ensureSettings(orgId);
  return prisma.$transaction(async (tx) => {
    const before = await tx.nxPurchaseOrder.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
    if (!before) fail('not_found');
    if (!['draft', 'submitted'].includes(before.status)) fail('bad_status');
    const { reason, lines, ...rest } = input;
    const { prods } = await loadRefs(tx, orgId, { supplier_id: rest.supplier_id, warehouse_id: rest.warehouse_id, lines });
    const data = { ...rest, updated_by: actorId };
    if ('order_date' in rest) data.order_date = toDate(rest.order_date || today());
    if ('expected_date' in rest) data.expected_date = toDate(rest.expected_date);
    if (lines) { const p = buildPoLines(lines, prods, settings); Object.assign(data, { lines: p.lines, subtotal: p.subtotal, tax_total: p.tax_total, total: p.total }); }
    const row = await tx.nxPurchaseOrder.update({ where: { id }, data });
    await audit(tx, orgId, actorId, 'purchase_order', id, 'update', { total: num(before.total) }, { total: num(row.total) }, reason);
    return poOut(row);
  });
}

const TRANSITIONS = { submit: [['draft'], 'submitted'], approve: [['draft', 'submitted'], 'approved'], cancel: [['draft', 'submitted', 'approved'], 'cancelled'], reopen: [['cancelled'], 'draft'] };
async function actPO(orgId, actorId, id, action, reason) {
  const t = TRANSITIONS[action];
  if (!t) fail('bad_status');
  const po = await prisma.nxPurchaseOrder.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!po) fail('not_found');
  if (!t[0].includes(po.status)) fail('bad_status');
  const row = await prisma.nxPurchaseOrder.update({ where: { id }, data: { status: t[1], ...(action === 'approve' ? { approved_by: actorId } : {}), updated_by: actorId } });
  await audit(prisma, orgId, actorId, 'purchase_order', id, action, { status: po.status }, { status: row.status }, reason);
  return poOut(row);
}

// ---------------- goods receipts ----------------
const rLine = z.object({ po_line_index: z.coerce.number().int().min(0).optional(), product_id: uuid, batch_no: z.string().trim().min(1).max(60), mfg_date: optDate, expiry_date: optDate, received_qty: z.coerce.number().positive().max(1e9), damaged_qty: z.coerce.number().min(0).max(1e9).default(0), rejected_qty: z.coerce.number().min(0).max(1e9).default(0), unit_cost: z.coerce.number().min(0).max(1e9), notes: text(200) });
const rFields = { po_id: uuidOrNull, supplier_id: uuidOrNull, warehouse_id: uuidOrNull, receipt_date: optDate, notes: text(2000), lines: z.array(rLine).min(1).max(300) };
const rCreate = z.object(rFields);
const rUpdate = z.object(rFields).partial().extend({ reason: text(300) });

async function checkReceiptLines(tx, orgId, po, lines) {
  const prods = await tx.nxProduct.findMany({ where: { org_id: orgId, id: { in: lines.map((l) => l.product_id) }, deleted_at: null } });
  if (new Set(prods.map((p) => p.id)).size !== new Set(lines.map((l) => l.product_id)).size) fail('invalid_ref', 'product');
  for (const l of lines) {
    if (num(l.damaged_qty) + num(l.rejected_qty) > num(l.received_qty) + 0.0001) fail('bad_qty', 'damaged + rejected is more than received');
    if (l.mfg_date && l.expiry_date && l.expiry_date < l.mfg_date) fail('bad_qty', 'expiry before manufacturing date');
  }
  if (po) {
    const poLines = po.lines || [];
    const sums = new Map();
    for (const l of lines) sums.set(l.product_id, (sums.get(l.product_id) || 0) + num(l.received_qty) - num(l.rejected_qty));
    for (const [pid, q] of sums) {
      const ordered = poLines.filter((x) => x.product_id === pid).reduce((a, x) => a + num(x.qty), 0);
      const got = poLines.filter((x) => x.product_id === pid).reduce((a, x) => a + num(x.received_qty), 0);
      if (!ordered) fail('invalid_ref', 'product is not on the purchase order');
      if (round3(got + q) > round3(ordered) + 0.0001) fail('bad_qty', 'more than ordered');
    }
  }
}

async function createReceipt(orgId, actorId, body) {
  const input = rCreate.parse(body);
  return prisma.$transaction(async (tx) => {
    let po = null;
    if (input.po_id) {
      po = await tx.nxPurchaseOrder.findFirst({ where: { id: input.po_id, org_id: orgId, deleted_at: null } });
      if (!po) fail('invalid_ref', 'po');
      if (!['approved', 'partially_received'].includes(po.status)) fail('bad_status');
    }
    const supplier_id = input.supplier_id || po?.supplier_id;
    const warehouse_id = input.warehouse_id || po?.warehouse_id;
    if (!supplier_id || !warehouse_id) fail('invalid_ref');
    await loadRefs(tx, orgId, { supplier_id, warehouse_id });
    await checkReceiptLines(tx, orgId, po, input.lines);
    const r = await tx.nxGoodsReceipt.create({ data: { org_id: orgId, created_by: actorId, grn_no: await nextNo(tx, orgId, 'grn', 'GRN', 4), po_id: input.po_id || null, supplier_id, warehouse_id, receipt_date: toDate(input.receipt_date || today()), lines: input.lines, notes: input.notes } });
    await audit(tx, orgId, actorId, 'goods_receipt', r.id, 'create', null, { grn_no: r.grn_no });
    return receiptOut(r);
  });
}

async function updateReceipt(orgId, actorId, id, body) {
  const input = rUpdate.parse(body || {});
  return prisma.$transaction(async (tx) => {
    const r = await tx.nxGoodsReceipt.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
    if (!r) fail('not_found');
    if (r.status !== 'draft') fail('already_posted');
    const { reason, ...rest } = input;
    const po = (rest.po_id ?? r.po_id) ? await tx.nxPurchaseOrder.findFirst({ where: { id: rest.po_id ?? r.po_id, org_id: orgId } }) : null;
    if (rest.lines) await checkReceiptLines(tx, orgId, po, rest.lines);
    if (rest.supplier_id || rest.warehouse_id) await loadRefs(tx, orgId, rest);
    const data = { ...rest, updated_by: actorId };
    if ('receipt_date' in rest) data.receipt_date = toDate(rest.receipt_date || today());
    const row = await tx.nxGoodsReceipt.update({ where: { id }, data });
    await audit(tx, orgId, actorId, 'goods_receipt', id, 'update', null, { grn_no: row.grn_no }, reason);
    return receiptOut(row);
  });
}

/** Post a draft receipt: batches, stock legs, supplier invoice, PO progress. Runs once; a second call is refused. */
async function postReceipt(orgId, actorId, id) {
  const settings = await core.ensureSettings(orgId);
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const claimed = await tx.nxGoodsReceipt.updateMany({ where: { id, org_id: orgId, status: 'draft', deleted_at: null }, data: { status: 'posted', updated_by: actorId } });
    if (claimed.count !== 1) {
      const exists = await tx.nxGoodsReceipt.findFirst({ where: { id, org_id: orgId } });
      fail(exists ? 'already_posted' : 'not_found');
    }
    const r = await tx.nxGoodsReceipt.findFirst({ where: { id, org_id: orgId } });
    const lines = r.lines || [];
    const prods = new Map((await tx.nxProduct.findMany({ where: { org_id: orgId, id: { in: lines.map((l) => l.product_id) } } })).map((p) => [p.id, p]));
    const legs = []; const invLines = []; let idx = 0;
    for (const l of lines) {
      let b = await tx.nxBatch.findFirst({ where: { org_id: orgId, product_id: l.product_id, batch_no: l.batch_no } });
      const exp = l.expiry_date || null;
      if (b) {
        if (exp && b.expiry_date && dayOf(b.expiry_date) !== exp) fail('duplicate', 'that batch number exists with a different expiry date');
        const total = num(b.received_qty) + num(l.received_qty);
        const cost = total > 0 ? round2((num(b.unit_cost) * num(b.received_qty) + num(l.unit_cost) * num(l.received_qty)) / total) : num(l.unit_cost);
        b = await tx.nxBatch.update({ where: { id: b.id }, data: { received_qty: total, unit_cost: cost, ...(exp && !b.expiry_date ? { expiry_date: toDate(exp) } : {}) } });
      } else {
        b = await tx.nxBatch.create({ data: { org_id: orgId, created_by: actorId, product_id: l.product_id, batch_no: l.batch_no, mfg_date: toDate(l.mfg_date), expiry_date: toDate(exp), supplier_id: r.supplier_id, unit_cost: l.unit_cost, received_qty: l.received_qty, receipt_id: r.id } });
      }
      const accepted = round3(num(l.received_qty) - num(l.damaged_qty) - num(l.rejected_qty));
      const base = { product_id: l.product_id, batch_id: b.id, warehouse_id: r.warehouse_id, movement: 'receipt', ref_type: 'goods_receipt', ref_id: r.id };
      if (accepted > 0) legs.push({ ...base, bucket: 'available', qty: accepted, posting_key: `grn:${r.id}:${idx}:available` });
      if (num(l.damaged_qty) > 0) legs.push({ ...base, bucket: 'damaged', qty: num(l.damaged_qty), posting_key: `grn:${r.id}:${idx}:damaged`, note: 'damaged on receipt' });
      const billable = num(l.received_qty) - num(l.rejected_qty);
      if (billable > 0) { const p = prods.get(l.product_id); invLines.push({ product_id: l.product_id, sku: p?.sku, name: p?.name, hsn: p?.hsn, batch_id: b.id, batch_no: b.batch_no, qty: billable, unit_price: num(l.unit_cost), discount_pct: 0, gst_rate: num(p?.gst_rate ?? settings.default_gst_rate) }); }
      idx += 1;
    }
    await stock.postLegs(tx, orgId, actorId, legs);
    // supplier invoice (payable), once per receipt
    let invoiceId = null;
    if (invLines.length) {
      const [sup, wh] = await Promise.all([tx.nxSupplier.findFirst({ where: { id: r.supplier_id } }), tx.nxWarehouse.findFirst({ where: { id: r.warehouse_id } })]);
      const priced = priceLines(invLines);
      const inv = await tx.nxInvoice.create({ data: { org_id: orgId, created_by: actorId, invoice_no: await billing.invoiceNo(tx, orgId, 'purchase', settings), type: 'purchase', source_type: 'goods_receipt', source_id: r.id, supplier_id: r.supplier_id, party_name: sup?.name, issue_date: r.receipt_date, due_date: toDate(addDays(dayOf(r.receipt_date), sup?.credit_days ?? 0)), subtotal: priced.subtotal, tax_total: priced.tax_total, total: priced.total, lines: priced.lines, tax_split: gstSplit(priced.tax_total, sup?.state, wh?.state) } });
      invoiceId = inv.id;
    }
    await tx.nxGoodsReceipt.update({ where: { id: r.id }, data: { invoice_id: invoiceId } });
    if (r.po_id) {
      const po = await tx.nxPurchaseOrder.findFirst({ where: { id: r.po_id, org_id: orgId } });
      const poLines = (po.lines || []).map((x) => ({ ...x }));
      for (const l of lines) {
        let left = num(l.received_qty) - num(l.rejected_qty);
        for (const pl of poLines.filter((x) => x.product_id === l.product_id)) {
          const room = num(pl.qty) - num(pl.received_qty);
          const take = Math.min(room, left);
          pl.received_qty = round3(num(pl.received_qty) + take); left = round3(left - take);
        }
      }
      const full = poLines.every((x) => num(x.received_qty) >= num(x.qty) - 0.0001);
      await tx.nxPurchaseOrder.update({ where: { id: po.id }, data: { lines: poLines, status: full ? 'received' : 'partially_received' } });
    }
    await audit(tx, orgId, actorId, 'goods_receipt', r.id, 'post', { status: 'draft' }, { status: 'posted', invoice_id: invoiceId });
    return receiptOut(await tx.nxGoodsReceipt.findFirst({ where: { id: r.id } }));
  }, { timeout: 30000 });
}

const receiptOut = (r, names = {}) => ({ id: r.id, grn_no: r.grn_no, po_id: r.po_id, supplier_id: r.supplier_id, supplier: names.supplier, warehouse_id: r.warehouse_id, warehouse: names.warehouse, receipt_date: dayOf(r.receipt_date), status: r.status, lines: r.lines, invoice_id: r.invoice_id, notes: r.notes });
async function listReceipts(orgId, f = {}) {
  const rows = await prisma.nxGoodsReceipt.findMany({ where: { org_id: orgId, deleted_at: null, ...(f.status ? { status: f.status } : {}), ...(f.po_id ? { po_id: f.po_id } : {}), ...(f.supplier_id ? { supplier_id: f.supplier_id } : {}), ...(f.warehouse_id ? { warehouse_id: f.warehouse_id } : {}) }, orderBy: { created_at: 'desc' }, take: 500 });
  const [S, W] = await Promise.all([prisma.nxSupplier.findMany({ where: { org_id: orgId } }), prisma.nxWarehouse.findMany({ where: { org_id: orgId } })]);
  const s = stock.mapBy(S); const w = stock.mapBy(W);
  return rows.map((r) => receiptOut(r, { supplier: s.get(r.supplier_id)?.name, warehouse: w.get(r.warehouse_id)?.name }));
}
async function getReceipt(orgId, id) {
  const r = await prisma.nxGoodsReceipt.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!r) fail('not_found');
  return receiptOut(r);
}
async function deleteReceipt(orgId, actorId, id, reason) {
  const r = await prisma.nxGoodsReceipt.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!r) fail('not_found');
  if (r.status !== 'draft') fail('already_posted');
  await prisma.nxGoodsReceipt.update({ where: { id }, data: { deleted_at: new Date(), updated_by: actorId } });
  await audit(prisma, orgId, actorId, 'goods_receipt', id, 'delete', { grn_no: r.grn_no }, null, reason);
  return { id };
}

async function supplierLedger(orgId, supplierId) {
  const invs = await billing.list(orgId, { supplier_id: supplierId });
  return { invoices: invs, outstanding: round2(invs.filter((i) => i.type === 'purchase' && i.status !== 'cancelled').reduce((a, i) => a + i.outstanding, 0)) };
}

module.exports = { listPO, getPO, createPO, updatePO, actPO, listReceipts, getReceipt, createReceipt, updateReceipt, postReceipt, deleteReceipt, supplierLedger };
