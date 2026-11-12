const { prisma, fail, num, round2, today, dayOf, toDate, addDays } = require('./common');
const stock = require('./stock.service');
const billing = require('./billing.service');
const core = require('../core.service');

// Dashboard and reports of the operations layer. Every figure is computed from the stock ledger, invoices, payments and the finance
// entries, with ONE set of filters (period, outlet, ownership type, warehouse, city / state, product, category, supplier, customer,
// logistics partner, statuses). Definitions:
//   sales revenue   = sales invoices' amount without GST - credit notes (by issue date)
//   cost of goods   = cost of the batches sold (COGS entries); purchases are NOT a cost, they are inventory
//   gross profit    = sales revenue - cost of goods
//   cash collected  = customer receipts in the period (payments), a different number from revenue and from invoices outstanding
//   receivables     = open sales + franchise invoices;  payables = open purchase invoices (as of the end of the period)
//   inventory value = quantity x batch cost of what is in stock now (available, reserved, in transit, quarantine)
const monthKey = (d) => dayOf(d).slice(0, 7);
function monthsBetween(from, to) {
  const out = []; let [y, m] = from.slice(0, 7).split('-').map(Number); const [ey, em] = to.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } if (out.length > 120) break; }
  return out;
}

/** Resolve the filters into outlet / warehouse id sets once (so every query below filters the same way). */
async function resolveFilters(orgId, f, scope) {
  const [outlets, whs] = await Promise.all([
    prisma.nxOutlet.findMany({ where: { org_id: orgId }, include: { ownership_type: { select: { id: true, kind: true, name: true } } } }),
    prisma.nxWarehouse.findMany({ where: { org_id: orgId } }),
  ]);
  let outletSet = null;
  const need = f.outlet_id || f.ownership_type_id || f.ownership_kind || f.state || f.city || scope;
  if (need) {
    outletSet = new Set(outlets.filter((o) => (!f.outlet_id || o.id === f.outlet_id) && (!f.ownership_type_id || o.ownership_type_id === f.ownership_type_id) && (!f.ownership_kind || o.ownership_type?.kind === f.ownership_kind) && (!f.state || (o.state || '').toLowerCase() === f.state.toLowerCase()) && (!f.city || (o.location || '').toLowerCase().includes(f.city.toLowerCase())) && (!scope || scope.includes(o.id))).map((o) => o.id));
  }
  const whSet = f.warehouse_id ? new Set([f.warehouse_id]) : null;
  return { outlets, whs, outletSet, whSet, O: new Map(outlets.map((o) => [o.id, o])), W: new Map(whs.map((w) => [w.id, w])) };
}
const inSet = (set, v) => !set || (v && set.has(v));
const rangeOk = (d, from, to) => { const x = dayOf(d); return (!from || x >= from) && (!to || x <= to); };

async function loadBase(orgId, f, scope) {
  const rf = await resolveFilters(orgId, f, scope);
  const from = f.from || addDays(today(), -90); const to = f.to || today();
  const [invAll, pay, entries, ships, orders, custs, sups] = await Promise.all([
    prisma.nxInvoice.findMany({ where: { org_id: orgId, deleted_at: null, status: { not: 'cancelled' } } }),
    prisma.nxPayment.findMany({ where: { org_id: orgId } }),
    prisma.nxEntry.findMany({ where: { org_id: orgId, deleted_at: null, payment_status: { not: 'cancelled' }, source_type: { in: ['cogs', 'shipment', 'trip', 'sales_invoice', 'franchise_invoice', 'credit_note'] } } }),
    prisma.nxShipment.findMany({ where: { org_id: orgId, deleted_at: null } }),
    prisma.nxSalesOrder.findMany({ where: { org_id: orgId, deleted_at: null } }),
    prisma.nxCustomer.findMany({ where: { org_id: orgId } }), prisma.nxSupplier.findMany({ where: { org_id: orgId } }),
  ]);
  // An outlet-type filter keeps that outlet's documents only; company purchases carry no outlet, so they drop out of an outlet view.
  const inv = invAll.filter((i) => !rf.outletSet || inSet(rf.outletSet, i.outlet_id));
  const invF = inv.filter((i) => (!f.customer_id || i.customer_id === f.customer_id) && (!f.supplier_id || i.supplier_id === f.supplier_id) && (!f.invoice_status || i.status === f.invoice_status));
  return { rf, from, to, inv: invF, invAll, pay, entries: entries.filter((e) => !rf.outletSet || inSet(rf.outletSet, e.outlet_id)), ships: ships.filter((s) => inSet(rf.outletSet, s.outlet_id) && (!rf.whSet || rf.whSet.has(s.from_warehouse_id)) && (!f.partner_id || s.partner_id === f.partner_id)), orders: orders.filter((o) => inSet(rf.outletSet, o.outlet_id) && (!rf.whSet || rf.whSet.has(o.warehouse_id)) && (!f.customer_id || o.customer_id === f.customer_id)), C: new Map(custs.map((c) => [c.id, c])), S: new Map(sups.map((s) => [s.id, s])) };
}

const sumBy = (rows, pick) => round2(rows.reduce((a, r) => a + num(pick(r)), 0));

async function dashboard(orgId, f = {}, scope) {
  const b = await loadBase(orgId, f, scope);
  const { from, to } = b;
  const sales = b.inv.filter((i) => i.type === 'sales' && rangeOk(i.issue_date, from, to));
  const credits = b.inv.filter((i) => i.type === 'credit_note' && rangeOk(i.issue_date, from, to));
  const purchases = b.inv.filter((i) => i.type === 'purchase' && rangeOk(i.issue_date, from, to));
  const debits = b.inv.filter((i) => i.type === 'debit_note' && rangeOk(i.issue_date, from, to));
  const franchise = b.inv.filter((i) => i.type === 'franchise' && rangeOk(i.issue_date, from, to));
  const revenue = round2(sumBy(sales, (i) => i.subtotal) - sumBy(credits, (i) => i.subtotal));
  const cogsE = b.entries.filter((e) => e.source_type === 'cogs' && rangeOk(e.entry_date, from, to));
  const cogs = sumBy(cogsE, (e) => e.amount);
  const freightE = b.entries.filter((e) => ['shipment', 'trip'].includes(e.source_type) && rangeOk(e.entry_date, from, to));
  const logistics = sumBy(freightE, (e) => e.amount);
  const invById = new Map(b.invAll.map((i) => [i.id, i]));
  const cust = b.pay.filter((p) => p.direction === 'in' && rangeOk(p.pay_date, from, to) && invById.get(p.invoice_id) && invById.get(p.invoice_id).type !== 'purchase' && b.inv.some((i) => i.id === p.invoice_id));
  const collected = sumBy(cust, (p) => p.amount);
  const open = (types) => b.inv.filter((i) => types.includes(i.type) && dayOf(i.issue_date) <= to && billing.outstandingOf(i) > 0);
  const receivables = round2(open(['sales', 'franchise']).reduce((a, i) => a + billing.outstandingOf(i), 0));
  const overdue = round2(open(['sales', 'franchise']).filter((i) => i.due_date && dayOf(i.due_date) < today()).reduce((a, i) => a + billing.outstandingOf(i), 0));
  const payables = round2(open(['purchase']).reduce((a, i) => a + billing.outstandingOf(i), 0));
  const settings = await core.ensureSettings(orgId);
  const whScope = scope ? b.rf.whs.filter((w) => scope.includes(w.outlet_id)).map((w) => w.id) : undefined;
  const val = await stock.valuation(orgId, { warehouse_id: f.warehouse_id, outlet_id: f.outlet_id, city: f.city, state: f.state, product_id: f.product_id, category_id: f.category_id, scope_warehouse_ids: whScope }, settings);
  const al = await stock.alerts(orgId, whScope);
  const delivered = b.ships.filter((s) => ['delivered', 'partially_delivered'].includes(s.status) && s.delivered_at && rangeOk(s.delivered_at, from, to));
  const onTime = delivered.filter((s) => s.expected_at && dayOf(s.delivered_at) <= dayOf(s.expected_at)).length;
  const freightShips = b.ships.filter((s) => s.actual_freight !== null && rangeOk(s.created_at, from, to));
  const months = monthsBetween(from, to);
  const series = months.map((m) => {
    const sm = (arr, pick, dateK) => sumBy(arr.filter((r) => monthKey(r[dateK]) === m), pick);
    const rev = round2(sm(sales, (i) => i.subtotal, 'issue_date') - sm(credits, (i) => i.subtotal, 'issue_date'));
    const c = sm(cogsE, (e) => e.amount, 'entry_date');
    return { month: m, sales: rev, cogs: c, gross_profit: round2(rev - c), purchases: round2(sm(purchases, (i) => i.subtotal, 'issue_date') - sm(debits, (i) => i.subtotal, 'issue_date')), collections: sm(cust, (p) => p.amount, 'pay_date'), logistics: sm(freightE, (e) => e.amount, 'entry_date'), franchise_fees: sm(franchise, (i) => i.subtotal, 'issue_date') };
  });
  const byOutlet = new Map();
  const bump = (id, k, v) => { const key = id || 'none'; const r = byOutlet.get(key) || { outlet_id: id || null, revenue: 0, cogs: 0, franchise_fees: 0, receivable: 0, logistics: 0, orders: 0 }; r[k] = round2(r[k] + v); byOutlet.set(key, r); };
  for (const i of sales) bump(i.outlet_id, 'revenue', num(i.subtotal));
  for (const i of credits) bump(i.outlet_id, 'revenue', -num(i.subtotal));
  for (const e of cogsE) bump(e.outlet_id, 'cogs', num(e.amount));
  for (const i of franchise) bump(i.outlet_id, 'franchise_fees', num(i.subtotal));
  for (const i of open(['sales', 'franchise'])) bump(i.outlet_id, 'receivable', billing.outstandingOf(i));
  for (const e of freightE) bump(e.outlet_id, 'logistics', num(e.amount));
  for (const o of b.orders.filter((x) => rangeOk(x.order_date, from, to) && x.status !== 'cancelled')) bump(o.outlet_id, 'orders', 1);
  const outlets = [...byOutlet.values()].map((r) => ({ ...r, outlet: b.rf.O.get(r.outlet_id)?.name || 'Company level / external', ownership: b.rf.O.get(r.outlet_id)?.ownership_type?.name || null, ownership_kind: b.rf.O.get(r.outlet_id)?.ownership_type?.kind || null, gross_profit: round2(r.revenue - r.cogs) })).sort((a, c) => c.revenue - a.revenue);
  const byProd = new Map();
  for (const i of sales) for (const l of i.lines || []) { const r = byProd.get(l.product_id) || { product_id: l.product_id, product: l.name, sku: l.sku, qty: 0, revenue: 0 }; r.qty = round2(r.qty + num(l.qty)); r.revenue = round2(r.revenue + num(l.net_amount)); byProd.set(l.product_id, r); }
  const orderCounts = {}; for (const o of b.orders.filter((x) => rangeOk(x.order_date, from, to))) orderCounts[o.status] = (orderCounts[o.status] || 0) + 1;
  const shipCounts = {}; for (const s of b.ships.filter((x) => rangeOk(x.created_at, from, to))) shipCounts[s.status] = (shipCounts[s.status] || 0) + 1;
  return {
    from, to,
    kpis: { sales_revenue: revenue, cost_of_goods: cogs, gross_profit: round2(revenue - cogs), gross_margin_pct: revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : null, purchases: round2(sumBy(purchases, (i) => i.subtotal) - sumBy(debits, (i) => i.subtotal)), cash_collected: collected, receivables, receivables_overdue: overdue, payables, franchise_fees: sumBy(franchise, (i) => i.subtotal), logistics_cost: logistics, inventory_value: val.total, expired_stock_value: val.expired_value, near_expiry_value: val.near_expiry_value, invoices_issued: sales.length + franchise.length, orders: Object.values(orderCounts).reduce((a, n) => a + n, 0) },
    delivery: { delivered: delivered.length, on_time: onTime, on_time_pct: delivered.length ? Math.round((onTime / delivered.length) * 1000) / 10 : null, freight_estimated: sumBy(freightShips, (s) => s.estimated_freight), freight_actual: sumBy(freightShips, (s) => s.actual_freight), freight_variance: round2(sumBy(freightShips, (s) => s.actual_freight) - sumBy(freightShips, (s) => s.estimated_freight)) },
    stock: { value_by_warehouse: val.by_warehouse, value_by_city: val.by_city, alerts: { near_expiry: al.near_expiry.length, expired: al.expired.length, below_reorder: al.below_reorder.length, recalled: al.recalled.length, quarantined: al.quarantined.length } },
    series, outlets, top_products: [...byProd.values()].sort((a, c) => c.revenue - a.revenue).slice(0, 10), order_status: orderCounts, shipment_status: shipCounts,
  };
}

// ---------------- reports (columns + rows, same shape as the finance reports so the existing CSV / PDF export works) ----------------
async function report(orgId, name, f = {}, scope) {
  const R = { ...f };
  const b = name.startsWith('stock') || ['expiry', 'batches'].includes(name) ? null : await loadBase(orgId, R, scope);
  const rep = (title, columns, rows) => ({ title, columns, rows });
  const O = b?.rf.O;
  switch (name) {
    case 'sales_monthly': {
      const d = await dashboard(orgId, f, scope);
      return rep('Monthly sales', ['Month', 'Sales revenue', 'Cost of goods', 'Gross profit', 'Collections', 'Franchise fees', 'Logistics'], d.series.map((s) => [s.month, s.sales, s.cogs, s.gross_profit, s.collections, s.franchise_fees, s.logistics]));
    }
    case 'sales_by_outlet': {
      const d = await dashboard(orgId, f, scope);
      return rep('Sales by outlet', ['Outlet', 'Ownership', 'Orders', 'Sales revenue', 'Cost of goods', 'Gross profit', 'Receivable'], d.outlets.map((r) => [r.outlet, r.ownership || '', r.orders, r.revenue, r.cogs, r.gross_profit, r.receivable]));
    }
    case 'sales_by_product': {
      const sales = b.inv.filter((i) => i.type === 'sales' && rangeOk(i.issue_date, b.from, b.to));
      const m = new Map();
      for (const i of sales) for (const l of i.lines || []) { if (R.product_id && l.product_id !== R.product_id) continue; const r = m.get(l.product_id) || [l.sku, l.name, 0, 0]; r[2] = round2(r[2] + num(l.qty)); r[3] = round2(r[3] + num(l.net_amount)); m.set(l.product_id, r); }
      return rep('Sales by product', ['SKU', 'Product', 'Quantity', 'Sales revenue'], [...m.values()].sort((a, c) => c[3] - a[3]));
    }
    case 'order_status': return rep('Sales orders', ['Order', 'Date', 'Customer', 'Order status', 'Fulfilment', 'Invoice', 'Payment', 'Total'], b.orders.filter((o) => rangeOk(o.order_date, b.from, b.to) && (!R.status || o.status === R.status)).map((o) => [o.so_no, dayOf(o.order_date), b.C.get(o.customer_id)?.name || '', o.status, o.fulfilment, o.invoice_status, o.payment_status, num(o.total)]));
    case 'purchases': return rep('Purchases', ['Invoice', 'Date', 'Supplier', 'Status', 'Subtotal', 'GST', 'Total', 'Paid', 'Outstanding'], b.inv.filter((i) => ['purchase', 'debit_note'].includes(i.type) && rangeOk(i.issue_date, b.from, b.to)).map((i) => [i.invoice_no, dayOf(i.issue_date), i.supplier_id ? b.S.get(i.supplier_id)?.name : i.party_name, i.status, num(i.subtotal), num(i.tax_total), num(i.total), num(i.paid_amount), billing.outstandingOf(i)]));
    case 'stock_on_hand': return rep('Stock on hand', ['SKU', 'Product', 'Batch', 'Expiry', 'Location', 'Available', 'Reserved', 'In transit', 'Damaged', 'Quarantine', 'Value'], (await stock.onHand(orgId, { ...f, scope_warehouse_ids: scope ? (await prisma.nxWarehouse.findMany({ where: { org_id: orgId, outlet_id: { in: scope } } })).map((w) => w.id) : undefined })).map((r) => [r.sku, r.product, r.batch_no, r.expiry_date || '', r.warehouse, r.available, r.reserved, r.in_transit, r.damaged, r.quarantine, r.value]));
    case 'stock_movement': return rep('Stock movement', ['Date', 'SKU', 'Product', 'Batch', 'Location', 'Bucket', 'Movement', 'Quantity', 'Reference'], (await stock.ledger(orgId, { ...f, limit: 2000 })).map((r) => [dayOf(r.date), r.sku, r.product, r.batch_no, r.warehouse, r.bucket, r.movement, r.qty, r.ref_type || '']));
    case 'expiry': case 'batches': return rep('Batch and expiry', ['SKU', 'Product', 'Batch', 'Expiry', 'Days to expiry', 'State', 'Quality', 'Location', 'Stock', 'Value'], (await stock.onHand(orgId, f)).filter((r) => (name === 'batches' || r.expiry_state !== 'ok') && r.expiry_state !== undefined).map((r) => [r.sku, r.product, r.batch_no, r.expiry_date || '', r.days_to_expiry ?? '', r.expiry_state, r.quality_status, r.warehouse, round2(r.available + r.reserved + r.in_transit + r.quarantine), r.value]));
    case 'returns': {
      const rows = await prisma.nxGoodsReturn.findMany({ where: { org_id: orgId, deleted_at: null }, orderBy: { created_at: 'desc' }, take: 1000 });
      const [P, Bt] = await Promise.all([prisma.nxProduct.findMany({ where: { org_id: orgId } }), prisma.nxBatch.findMany({ where: { org_id: orgId } })]);
      const p = stock.mapBy(P); const bt = stock.mapBy(Bt);
      return rep('Returns and damaged stock', ['Return', 'Date', 'Type', 'Product', 'Batch', 'Quantity', 'Reason', 'Status', 'Disposition'], rows.filter((r) => rangeOk(r.return_date, b.from, b.to)).map((r) => [r.return_no, dayOf(r.return_date), r.type, p.get(r.product_id)?.name, bt.get(r.batch_id)?.batch_no, num(r.qty), r.reason, r.status, r.disposition || '']));
    }
    case 'invoice_status': return rep('Invoices and payments', ['Invoice', 'Type', 'Date', 'Party', 'Status', 'Total', 'Paid', 'Credited', 'Outstanding', 'Due'], b.inv.filter((i) => rangeOk(i.issue_date, b.from, b.to)).map((i) => [i.invoice_no, i.type, dayOf(i.issue_date), i.party_name || '', i.status, num(i.total), num(i.paid_amount), num(i.credited_amount), billing.outstandingOf(i), dayOf(i.due_date) || '']));
    case 'receivables': return rep('Customer receivables', ['Invoice', 'Customer / outlet', 'Date', 'Due', 'Total', 'Outstanding', 'Days overdue'], b.inv.filter((i) => ['sales', 'franchise'].includes(i.type) && billing.outstandingOf(i) > 0 && dayOf(i.issue_date) <= b.to).map((i) => [i.invoice_no, i.party_name || '', dayOf(i.issue_date), dayOf(i.due_date) || '', num(i.total), billing.outstandingOf(i), i.due_date && dayOf(i.due_date) < today() ? Math.round((new Date(today()) - new Date(dayOf(i.due_date))) / 86400000) : 0]));
    case 'payables': return rep('Supplier payables', ['Invoice', 'Supplier', 'Date', 'Due', 'Total', 'Outstanding'], b.inv.filter((i) => i.type === 'purchase' && billing.outstandingOf(i) > 0 && dayOf(i.issue_date) <= b.to).map((i) => [i.invoice_no, b.S.get(i.supplier_id)?.name || '', dayOf(i.issue_date), dayOf(i.due_date) || '', num(i.total), billing.outstandingOf(i)]));
    case 'franchise': {
      const sets = await prisma.nxFranchiseSettlement.findMany({ where: { org_id: orgId, deleted_at: null, ...(scope ? { outlet_id: { in: scope } } : {}) }, orderBy: { month: 'desc' } });
      const ags = stock.mapBy(await prisma.nxFranchiseAgreement.findMany({ where: { org_id: orgId } }));
      return rep('Franchise fees and settlements', ['Month', 'Outlet', 'Partner', 'Type', 'Reported sales', 'Royalty', 'Revenue share', 'Fee', 'Total due', 'Status'], sets.filter((s) => (!b.from || s.month >= b.from.slice(0, 7)) && (!b.to || s.month <= b.to.slice(0, 7))).map((s) => [s.month, O.get(s.outlet_id)?.name || '', ags.get(s.agreement_id)?.partner_name || '', s.kind, num(s.reported_sales), num(s.royalty_due), num(s.share_due), num(s.fee_due), num(s.total_due), s.status]));
    }
    case 'outlet_pnl': {
      const ents = await prisma.nxEntry.findMany({ where: { org_id: orgId, deleted_at: null, payment_status: { not: 'cancelled' }, kind: { in: ['income', 'expense', 'salary'] }, entry_date: { gte: toDate(b.from), lte: toDate(b.to) } } });
      const m = new Map();
      for (const e of ents) { if (!inSet(b.rf.outletSet, e.outlet_id) && b.rf.outletSet) continue; const k = e.outlet_id || 'none'; const r = m.get(k) || { income: 0, cogs: 0, expenses: 0, salaries: 0 }; if (e.kind === 'income') r.income += num(e.amount); else if (e.kind === 'salary') r.salaries += num(e.amount); else if (e.source_type === 'cogs') r.cogs += num(e.amount); else r.expenses += num(e.amount); m.set(k, r); }
      return rep('Outlet-wise profit and loss', ['Outlet', 'Ownership', 'Income', 'Cost of goods', 'Gross profit', 'Expenses', 'Salaries', 'Net result'], [...m].map(([k, r]) => [O.get(k)?.name || 'Company level', O.get(k)?.ownership_type?.name || '', round2(r.income), round2(r.cogs), round2(r.income - r.cogs), round2(r.expenses), round2(r.salaries), round2(r.income - r.cogs - r.expenses - r.salaries)]));
    }
    case 'logistics': return rep('Logistics cost and delivery', ['Shipment', 'Order', 'Method', 'Status', 'Estimated freight', 'Actual freight', 'Variance', 'Expected', 'Delivered', 'On time'], b.ships.filter((s) => rangeOk(s.created_at, b.from, b.to)).map((s) => [s.shipment_no, s.sales_order_id ? b.orders.find((o) => o.id === s.sales_order_id)?.so_no || '' : 'Transfer', s.method, s.status, num(s.estimated_freight), s.actual_freight === null ? '' : num(s.actual_freight), s.actual_freight === null ? '' : round2(num(s.actual_freight) - num(s.estimated_freight)), dayOf(s.expected_at) || '', s.delivered_at ? dayOf(s.delivered_at) : '', s.delivered_at && s.expected_at ? (dayOf(s.delivered_at) <= dayOf(s.expected_at) ? 'Yes' : 'No') : '']));
    case 'discrepancies': {
      const adj = await stock.listAdjustments(orgId, {});
      const lost = await prisma.nxStockLedger.findMany({ where: { org_id: orgId, bucket: 'lost' }, orderBy: { created_at: 'desc' }, take: 500 });
      const [P, Bt, W] = await Promise.all([prisma.nxProduct.findMany({ where: { org_id: orgId } }), prisma.nxBatch.findMany({ where: { org_id: orgId } }), prisma.nxWarehouse.findMany({ where: { org_id: orgId } })]);
      const p = stock.mapBy(P); const bt = stock.mapBy(Bt); const w = stock.mapBy(W);
      return rep('Stock discrepancies and write-offs', ['Date', 'Kind', 'Product', 'Batch', 'Location', 'Quantity', 'Reason'], [...adj.map((a) => [dayOf(a.date), 'Adjustment', a.product, a.batch_no, a.warehouse, a.qty, a.reason]), ...lost.map((l) => [dayOf(l.created_at), l.movement, p.get(l.product_id)?.name, bt.get(l.batch_id)?.batch_no, w.get(l.warehouse_id)?.name, num(l.qty), l.note || ''])]);
    }
    default: return fail('unknown_report');
  }
}
const REPORTS = [
  ['sales_monthly', 'Monthly sales'], ['sales_by_outlet', 'Sales by outlet'], ['sales_by_product', 'Sales by product'], ['order_status', 'Sales order status'], ['purchases', 'Purchases'], ['stock_on_hand', 'Stock on hand'],
  ['stock_movement', 'Stock movement and transfers'], ['expiry', 'Near-expiry and expired stock'], ['batches', 'Batch register'], ['returns', 'Returns and damaged stock'], ['invoice_status', 'Invoice and payment status'],
  ['receivables', 'Customer receivables'], ['payables', 'Supplier payables'], ['franchise', 'Franchise fees and settlements'], ['outlet_pnl', 'Outlet-wise profit and loss'], ['logistics', 'Logistics cost and delivery'], ['discrepancies', 'Stock discrepancies'],
];

module.exports = { dashboard, report, REPORTS, monthsBetween };
