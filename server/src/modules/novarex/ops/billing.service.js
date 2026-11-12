const { z, prisma, fail, num, round2, today, dayOf, toDate, addDays, text, optDate, nextNo, lockOrg, lockGuard, lockTouch, audit, categoryId, gstSplit, priceLines, outletAllowed } = require('./common');
const core = require('../core.service');

// Invoices, payments and credit / debit notes.
//  * Sales and franchise invoices recognise revenue: one finance entry (income, the amount WITHOUT GST) per invoice, unpaid until the invoice
//    is settled; the cost of the goods is recognised in the same period as a non-cash COGS entry (batch cost x quantity).
//  * Purchase invoices create NO expense: purchases are inventory. They only feed supplier payables.
//  * An invoice per transaction: (type, source_type, source_id) is unique, so the same shipment / receipt / settlement cannot be invoiced twice.
//  * Credit notes reduce revenue with a negative income entry dated in the credit note's own month (a locked month is never rewritten).
const PREFIX = { sales: 'sales', franchise: 'franchise', purchase: 'purchase', credit_note: 'credit_note', debit_note: 'debit_note' };
const NUMBER = { sales: null, franchise: 'FRN', purchase: 'PUR', credit_note: 'CN', debit_note: 'DN' };

const outstandingOf = (inv) => round2(num(inv.total) - num(inv.paid_amount) - num(inv.credited_amount));

const makeEntry = (tx, orgId, actorId, e) => tx.nxEntry.create({
  data: { org_id: orgId, created_by: actorId, kind: e.kind, category_id: e.category_id, outlet_id: e.outlet_id || null, entry_date: toDate(e.date), due_date: toDate(e.due_date), amount: e.amount, expense_class: e.expense_class || null, payment_status: e.payment_status || 'unpaid', party_name: e.party_name || null, reference: e.reference || null, description: e.description || null, source_type: e.source_type, source_id: e.source_id, non_cash: Boolean(e.non_cash) },
});

async function invoiceNo(tx, orgId, type, settings) {
  const prefix = type === 'sales' ? settings.invoice_prefix : NUMBER[type];
  return nextNo(tx, orgId, `invoice_${type}`, prefix, 5);
}

const invoiceOut = (i, extra = {}) => ({
  id: i.id, invoice_no: i.invoice_no, type: i.type, source_type: i.source_type, source_id: i.source_id, customer_id: i.customer_id, supplier_id: i.supplier_id, outlet_id: i.outlet_id, party_name: i.party_name,
  issue_date: dayOf(i.issue_date), due_date: dayOf(i.due_date), subtotal: num(i.subtotal), tax_total: num(i.tax_total), total: num(i.total), paid_amount: num(i.paid_amount), credited_amount: num(i.credited_amount),
  outstanding: outstandingOf(i), status: i.status, lines: i.lines, tax_split: i.tax_split, einvoice_status: i.einvoice_status, eway_status: i.eway_status, ref_invoice_id: i.ref_invoice_id, notes: i.notes, ...extra,
});

function statusFor(inv) {
  if (inv.status === 'cancelled') return 'cancelled';
  const out = outstandingOf(inv);
  if (out <= 0) return num(inv.paid_amount) > 0 || num(inv.total) === 0 ? 'paid' : 'credited';
  return num(inv.paid_amount) > 0 || num(inv.credited_amount) > 0 ? 'partially_paid' : 'issued';
}

/** Finance entries tied to an invoice: its revenue entry and the entries of its credit notes. */
async function linkedEntryFilter(tx, orgId, inv) {
  const credits = await tx.nxInvoice.findMany({ where: { org_id: orgId, ref_invoice_id: inv.id, type: 'credit_note' }, select: { id: true } });
  const or = [];
  if (inv.entry_id) or.push({ id: inv.entry_id });
  if (credits.length) or.push({ source_type: 'credit_note', source_id: { in: credits.map((c) => c.id) } });
  return or.length ? { org_id: orgId, deleted_at: null, OR: or } : null;
}
/** A settled invoice flips its revenue entry (and credit entries) to paid; re-opened, back to unpaid. */
async function settleEntries(tx, orgId, inv) {
  const w = await linkedEntryFilter(tx, orgId, inv);
  if (w) await tx.nxEntry.updateMany({ where: { ...w, payment_status: 'unpaid' }, data: { payment_status: 'paid' } });
}
async function unsettleEntries(tx, orgId, inv) {
  const w = await linkedEntryFilter(tx, orgId, inv);
  if (w) await tx.nxEntry.updateMany({ where: { ...w, payment_status: 'paid' }, data: { payment_status: 'unpaid' } });
}

/** Keep the sales order's invoice / payment status in step with its invoices. */
async function syncOrderStatus(tx, orgId, soId) {
  if (!soId) return;
  const so = await tx.nxSalesOrder.findFirst({ where: { id: soId, org_id: orgId } });
  if (!so) return;
  const ships = await tx.nxShipment.findMany({ where: { org_id: orgId, sales_order_id: soId, deleted_at: null, status: { notIn: ['returned', 'cancelled'] } }, select: { id: true } });
  const invs = await tx.nxInvoice.findMany({ where: { org_id: orgId, type: 'sales', source_type: 'shipment', source_id: { in: ships.map((s) => s.id) }, status: { not: 'cancelled' } } });
  const invoiced = invs.length === 0 ? 'none' : invs.length >= ships.length ? 'invoiced' : 'partial';
  const total = invs.reduce((a, i) => a + num(i.total), 0);
  const settled = invs.reduce((a, i) => a + num(i.paid_amount) + num(i.credited_amount), 0);
  const pay = invs.length === 0 ? 'unpaid' : settled <= 0 ? 'unpaid' : settled >= total ? 'paid' : 'partial';
  await tx.nxSalesOrder.update({ where: { id: soId }, data: { invoice_status: invoiced, payment_status: pay } });
}

/** Sales invoice for one shipment. Quantity = what was accepted at delivery (or shipped, under an earlier invoicing policy). */
async function invoiceShipment(orgId, actorId, shipmentId, ctx = {}) {
  const settings = await core.ensureSettings(orgId);
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const sh = await tx.nxShipment.findFirst({ where: { id: shipmentId, org_id: orgId, deleted_at: null } });
    if (!sh) fail('not_found');
    if (!sh.sales_order_id) fail('bad_status');
    const timing = settings.invoice_timing;
    const okStatus = timing === 'delivery' ? ['delivered', 'partially_delivered'] : timing === 'dispatch' ? ['dispatched', 'in_transit', 'out_for_delivery', 'delivered', 'partially_delivered'] : ['pending_dispatch', 'ready_for_dispatch', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered', 'partially_delivered'];
    if (!okStatus.includes(sh.status)) fail('not_ready_to_invoice');
    const dup = await tx.nxInvoice.findFirst({ where: { org_id: orgId, type: 'sales', source_type: 'shipment', source_id: sh.id } });
    if (dup) fail('invoice_exists');
    const [so, wh] = await Promise.all([tx.nxSalesOrder.findFirst({ where: { id: sh.sales_order_id, org_id: orgId } }), tx.nxWarehouse.findFirst({ where: { id: sh.from_warehouse_id, org_id: orgId } })]);
    const cust = await tx.nxCustomer.findFirst({ where: { id: so.customer_id, org_id: orgId } });
    const soLines = Array.isArray(so.lines) ? so.lines : [];
    const [prods, batches] = await Promise.all([
      tx.nxProduct.findMany({ where: { org_id: orgId, id: { in: (sh.lines || []).map((l) => l.product_id) } } }),
      tx.nxBatch.findMany({ where: { org_id: orgId, id: { in: (sh.lines || []).map((l) => l.batch_id) } } }),
    ]);
    const P = new Map(prods.map((p) => [p.id, p])); const B = new Map(batches.map((b) => [b.id, b]));
    const raw = []; let cogs = 0;
    for (const l of sh.lines || []) {
      const q = timing === 'delivery' ? Math.max(0, num(l.delivered_qty)) : num(l.qty); // delivered_qty = accepted by the customer; damaged / missing are not billed
      if (q <= 0) continue;
      const sl = soLines.find((x) => x.product_id === l.product_id) || {};
      const p = P.get(l.product_id); const b = B.get(l.batch_id);
      raw.push({ product_id: l.product_id, sku: p?.sku, name: p?.name, hsn: p?.hsn, batch_id: l.batch_id, batch_no: b?.batch_no, qty: q, unit_price: num(sl.unit_price), discount_pct: num(sl.discount_pct), gst_rate: sl.gst_rate !== undefined ? num(sl.gst_rate) : num(p?.gst_rate) });
      cogs += q * num(b?.unit_cost);
    }
    if (!raw.length) fail('nothing_to_invoice');
    const priced = priceLines(raw);
    const date = ctx.date || today();
    await lockGuard(orgId, [date], ctx);
    const split = gstSplit(priced.tax_total, wh?.state, cust?.state);
    const credit = cust?.credit_days ?? 0;
    const inv = await tx.nxInvoice.create({ data: { org_id: orgId, created_by: actorId, invoice_no: await invoiceNo(tx, orgId, 'sales', settings), type: 'sales', source_type: 'shipment', source_id: sh.id, customer_id: cust.id, outlet_id: so.outlet_id || cust.outlet_id || null, party_name: cust.name, issue_date: toDate(date), due_date: toDate(addDays(date, credit)), subtotal: priced.subtotal, tax_total: priced.tax_total, total: priced.total, lines: priced.lines, tax_split: split, eway_status: priced.total >= 50000 ? 'pending' : 'not_required', notes: so.payment_terms || null } });
    const outlet_id = so.outlet_id || cust.outlet_id || null;
    const incomeCat = await categoryId(tx, orgId, 'income', 'Product sales');
    const entry = await makeEntry(tx, orgId, actorId, { kind: 'income', category_id: incomeCat, outlet_id, date, due_date: addDays(date, credit), amount: priced.subtotal, party_name: cust.name, reference: inv.invoice_no, description: `Sales invoice ${inv.invoice_no}`, source_type: 'sales_invoice', source_id: inv.id });
    const cogsCat = await categoryId(tx, orgId, 'expense', 'Cost of goods sold');
    const ce = await makeEntry(tx, orgId, actorId, { kind: 'expense', category_id: cogsCat, outlet_id, date, amount: round2(cogs), expense_class: 'operating', payment_status: 'paid', reference: inv.invoice_no, description: `Cost of goods sold, ${inv.invoice_no}`, source_type: 'cogs', source_id: inv.id, non_cash: true });
    const done = await tx.nxInvoice.update({ where: { id: inv.id }, data: { entry_id: entry.id, cogs_entry_id: ce.id } });
    await syncOrderStatus(tx, orgId, so.id);
    await audit(tx, orgId, actorId, 'invoice', inv.id, 'create', null, { invoice_no: inv.invoice_no, total: priced.total, shipment: sh.shipment_no }, ctx.reason);
    await lockTouch(orgId, [date]);
    return invoiceOut(done);
  }, { timeout: 30000 });
}

const paySchema = z.object({ amount: z.coerce.number().positive().max(1e12), pay_date: optDate, method: text(40), reference: text(120), notes: text(500), reason: text(300) });

/** Record a payment (customer receipt / supplier payment) or a refund when the invoice is over-settled. */
async function pay(orgId, actorId, invoiceId, body, ctx = {}) {
  const input = paySchema.parse(body || {});
  const date = input.pay_date || today();
  await lockGuard(orgId, [date], { ...ctx, reason: ctx.reason || input.reason });
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const inv = await tx.nxInvoice.findFirst({ where: { id: invoiceId, org_id: orgId, deleted_at: null } });
    if (!inv) fail('not_found');
    if (!['sales', 'franchise', 'purchase'].includes(inv.type) || inv.status === 'cancelled') fail('bad_status');
    const out = outstandingOf(inv);
    const refund = out < 0;
    if (!refund && input.amount > out + 0.004) fail('overpayment');
    if (refund && input.amount > -out + 0.004) fail('overpayment');
    const direction = inv.type === 'purchase' ? (refund ? 'in' : 'out') : (refund ? 'out' : 'in');
    await tx.nxPayment.create({ data: { org_id: orgId, created_by: actorId, invoice_id: inv.id, direction, amount: input.amount, pay_date: toDate(date), method: input.method, reference: input.reference, notes: input.notes, actor_id: actorId } });
    const paid = round2(num(inv.paid_amount) + (refund ? -input.amount : input.amount));
    const next = { ...inv, paid_amount: paid };
    const status = statusFor(next);
    const row = await tx.nxInvoice.update({ where: { id: inv.id }, data: { paid_amount: paid, status, updated_by: actorId } });
    if (inv.type !== 'purchase' && status === 'paid') await settleEntries(tx, orgId, row);
    if (inv.type !== 'purchase' && status !== 'paid') await unsettleEntries(tx, orgId, row);
    if (inv.type === 'sales' && inv.source_type === 'shipment') { const sh = await tx.nxShipment.findFirst({ where: { id: inv.source_id, org_id: orgId }, select: { sales_order_id: true } }); await syncOrderStatus(tx, orgId, sh?.sales_order_id); }
    if (inv.type === 'franchise' && inv.source_type === 'franchise_settlement') await tx.nxFranchiseSettlement.updateMany({ where: { id: inv.source_id, org_id: orgId }, data: { status: status === 'paid' ? 'settled' : 'invoiced' } });
    await audit(tx, orgId, actorId, 'payment', inv.id, 'create', null, { invoice_no: inv.invoice_no, amount: input.amount, direction, date });
    await lockTouch(orgId, [date]);
    return invoiceOut(row);
  });
}

/** Cancel an invoice that has no payment or credit: its revenue, cost and receivable disappear; the number stays used (no re-invoicing the same transaction without an admin). */
async function cancel(orgId, actorId, invoiceId, ctx = {}) {
  const inv0 = await prisma.nxInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!inv0) fail('not_found');
  await lockGuard(orgId, [dayOf(inv0.issue_date)], ctx);
  return prisma.$transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const inv = await tx.nxInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
    if (!['issued'].includes(inv.status) || num(inv.paid_amount) > 0 || num(inv.credited_amount) > 0) fail('bad_status');
    await tx.nxInvoice.update({ where: { id: inv.id }, data: { status: 'cancelled', updated_by: actorId } });
    await tx.nxEntry.updateMany({ where: { org_id: orgId, id: { in: [inv.entry_id, inv.cogs_entry_id].filter(Boolean) } }, data: { payment_status: 'cancelled' } });
    if (inv.type === 'franchise') await tx.nxFranchiseSettlement.updateMany({ where: { id: inv.source_id, org_id: orgId }, data: { status: 'draft', invoice_id: null } });
    if (inv.source_type === 'shipment') { const sh = await tx.nxShipment.findFirst({ where: { id: inv.source_id, org_id: orgId }, select: { sales_order_id: true } }); await syncOrderStatus(tx, orgId, sh?.sales_order_id); }
    await audit(tx, orgId, actorId, 'invoice', inv.id, 'cancel', { status: inv.status }, { status: 'cancelled' }, ctx.reason);
    await lockTouch(orgId, [dayOf(inv.issue_date)]);
    return { id: inv.id, status: 'cancelled' };
  });
}

/**
 * Credit note against a sales invoice (customer return / price correction). `lines` = [{ product_id, batch_id, qty }] taken from the invoice
 * at its own price. Reduces revenue (negative income entry in the credit note's month) and, if the goods were restocked, the cost of sales.
 */
async function creditNote(tx, orgId, actorId, invoiceId, { lines, restocked = false, date = today(), reason }) {
  const inv = await tx.nxInvoice.findFirst({ where: { id: invoiceId, org_id: orgId, deleted_at: null } });
  if (!inv || inv.type !== 'sales' || inv.status === 'cancelled') fail('bad_status');
  const orig = Array.isArray(inv.lines) ? inv.lines : [];
  const prior = await tx.nxInvoice.findMany({ where: { org_id: orgId, type: 'credit_note', ref_invoice_id: inv.id, status: { not: 'cancelled' } } });
  const creditedQty = new Map();
  for (const c of prior) for (const l of c.lines || []) creditedQty.set(`${l.product_id}|${l.batch_id}`, (creditedQty.get(`${l.product_id}|${l.batch_id}`) || 0) + num(l.qty));
  const raw = [];
  for (const l of lines) {
    const o = orig.find((x) => x.product_id === l.product_id && x.batch_id === l.batch_id);
    if (!o) fail('invalid_ref');
    const left = num(o.qty) - (creditedQty.get(`${l.product_id}|${l.batch_id}`) || 0);
    if (num(l.qty) <= 0 || num(l.qty) > left + 0.0001) fail('bad_qty');
    raw.push({ product_id: o.product_id, sku: o.sku, name: o.name, hsn: o.hsn, batch_id: o.batch_id, batch_no: o.batch_no, qty: num(l.qty), unit_price: o.unit_price, discount_pct: o.discount_pct, gst_rate: o.gst_rate });
  }
  if (!raw.length) fail('empty_lines');
  const priced = priceLines(raw);
  const settings = await core.ensureSettings(orgId);
  const cn = await tx.nxInvoice.create({ data: { org_id: orgId, created_by: actorId, invoice_no: await invoiceNo(tx, orgId, 'credit_note', settings), type: 'credit_note', source_type: 'return', source_id: null, customer_id: inv.customer_id, outlet_id: inv.outlet_id, party_name: inv.party_name, issue_date: toDate(date), subtotal: priced.subtotal, tax_total: priced.tax_total, total: priced.total, status: 'issued', lines: priced.lines, tax_split: inv.tax_split ? gstSplit(priced.tax_total, inv.tax_split.type === 'IGST' ? 'from' : null, inv.tax_split.type === 'IGST' ? 'to' : null) : null, ref_invoice_id: inv.id, notes: reason || null } });
  const incomeCat = await categoryId(tx, orgId, 'income', 'Product sales');
  await makeEntry(tx, orgId, actorId, { kind: 'income', category_id: incomeCat, outlet_id: inv.outlet_id, date, due_date: date, amount: -priced.subtotal, party_name: inv.party_name, reference: cn.invoice_no, description: `Credit note ${cn.invoice_no} against ${inv.invoice_no}`, source_type: 'credit_note', source_id: cn.id, payment_status: 'unpaid' });
  if (restocked) {
    const bs = await tx.nxBatch.findMany({ where: { org_id: orgId, id: { in: raw.map((r) => r.batch_id) } } });
    const cost = raw.reduce((a, r) => a + r.qty * num(bs.find((b) => b.id === r.batch_id)?.unit_cost), 0);
    const cogsCat = await categoryId(tx, orgId, 'expense', 'Cost of goods sold');
    await makeEntry(tx, orgId, actorId, { kind: 'expense', category_id: cogsCat, outlet_id: inv.outlet_id, date, amount: -round2(cost), expense_class: 'operating', payment_status: 'paid', reference: cn.invoice_no, description: `Cost of goods sold reversed, ${cn.invoice_no}`, source_type: 'cogs', source_id: cn.id, non_cash: true });
  }
  const credited = round2(num(inv.credited_amount) + priced.total);
  const next = { ...inv, credited_amount: credited };
  const status = statusFor(next);
  const upd = await tx.nxInvoice.update({ where: { id: inv.id }, data: { credited_amount: credited, status } });
  if (status === 'paid' || status === 'credited') await settleEntries(tx, orgId, upd);
  if (inv.source_type === 'shipment') { const sh = await tx.nxShipment.findFirst({ where: { id: inv.source_id, org_id: orgId }, select: { sales_order_id: true } }); await syncOrderStatus(tx, orgId, sh?.sales_order_id); }
  await audit(tx, orgId, actorId, 'invoice', cn.id, 'create', null, { credit_note: cn.invoice_no, against: inv.invoice_no, total: priced.total }, reason);
  return cn;
}

/** Debit note for a supplier return: reduces what we owe on the receipt's invoice (no finance entry: purchases are inventory). */
async function debitNote(tx, orgId, actorId, { supplier_id, invoice_id, lines, date = today(), reason }) {
  const settings = await core.ensureSettings(orgId);
  const priced = priceLines(lines);
  const dn = await tx.nxInvoice.create({ data: { org_id: orgId, created_by: actorId, invoice_no: await invoiceNo(tx, orgId, 'debit_note', settings), type: 'debit_note', source_type: 'return', supplier_id, issue_date: toDate(date), subtotal: priced.subtotal, tax_total: priced.tax_total, total: priced.total, status: 'issued', lines: priced.lines, ref_invoice_id: invoice_id || null, notes: reason || null } });
  if (invoice_id) {
    const inv = await tx.nxInvoice.findFirst({ where: { id: invoice_id, org_id: orgId, type: 'purchase' } });
    if (inv) {
      const credited = round2(num(inv.credited_amount) + Math.min(priced.total, outstandingOf(inv) > 0 ? outstandingOf(inv) : 0));
      await tx.nxInvoice.update({ where: { id: inv.id }, data: { credited_amount: credited, status: statusFor({ ...inv, credited_amount: credited }) } });
    }
  }
  return dn;
}

async function list(orgId, f = {}, scope) {
  const where = { org_id: orgId, deleted_at: null };
  if (f.type) where.type = f.type;
  if (f.status) where.status = f.status;
  if (f.outlet_id) where.outlet_id = f.outlet_id;
  if (f.customer_id) where.customer_id = f.customer_id;
  if (f.supplier_id) where.supplier_id = f.supplier_id;
  if (f.from || f.to) where.issue_date = { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lte: toDate(f.to) } : {}) };
  if (scope) where.outlet_id = f.outlet_id && scope.includes(f.outlet_id) ? f.outlet_id : { in: scope };
  if (f.q) where.OR = [{ invoice_no: { contains: String(f.q), mode: 'insensitive' } }, { party_name: { contains: String(f.q), mode: 'insensitive' } }];
  const rows = await prisma.nxInvoice.findMany({ where, orderBy: [{ issue_date: 'desc' }, { created_at: 'desc' }], take: 1000 });
  let out = rows.map((r) => invoiceOut(r));
  if (f.payment === 'open') out = out.filter((r) => r.outstanding > 0 && r.status !== 'cancelled');
  if (f.payment === 'overdue') { const t = today(); out = out.filter((r) => r.outstanding > 0 && r.due_date && r.due_date < t && r.status !== 'cancelled'); }
  return out;
}

async function get(orgId, id, scope) {
  const inv = await prisma.nxInvoice.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!inv) fail('not_found');
  if (!outletAllowed(scope, inv.outlet_id)) fail('forbidden_outlet');
  const [payments, notes] = await Promise.all([
    prisma.nxPayment.findMany({ where: { org_id: orgId, invoice_id: id }, orderBy: { pay_date: 'asc' } }),
    prisma.nxInvoice.findMany({ where: { org_id: orgId, ref_invoice_id: id } }),
  ]);
  return invoiceOut(inv, { payments: payments.map((p) => ({ id: p.id, direction: p.direction, amount: num(p.amount), pay_date: dayOf(p.pay_date), method: p.method, reference: p.reference })), related: notes.map((n) => ({ id: n.id, invoice_no: n.invoice_no, type: n.type, total: num(n.total), status: n.status })) });
}

module.exports = { outstandingOf, makeEntry, invoiceNo, invoiceOut, statusFor, syncOrderStatus, invoiceShipment, pay, cancel, creditNote, debitNote, list, get, settleEntries, unsettleEntries, PREFIX };
