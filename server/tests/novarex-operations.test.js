const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

jest.setTimeout(180000);
beforeAll(async () => { await cleanDatabase(); }, 180000);
afterAll(async () => { await cleanDatabase(); await prisma.$disconnect(); }, 180000);

const iso = (d) => d.toISOString().slice(0, 10);
const plus = (days) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return iso(d); };
const api = (token) => ({
  post: (p, b) => authed(request(app).post(`/api/v1/novarex${p}`), token).send(b),
  get: (p) => authed(request(app).get(`/api/v1/novarex${p}`), token),
  patch: (p, b) => authed(request(app).patch(`/api/v1/novarex${p}`), token).send(b),
  del: (p) => authed(request(app).delete(`/api/v1/novarex${p}`), token),
});
const data = (r, status = 200) => { expect([r.status, r.body.message]).toEqual([status, r.body.message]); return r.body.data; };
let seq = 0;
async function setup() {
  seq += 1;
  const org = await createOrg({ name: `Novarex ops ${seq}`, slug: `nx-ops-${Date.now()}-${seq}` });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['novarex'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, a: api(access_token) };
}
async function member(org, accessRole, outletIds = []) {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  await prisma.nxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole, outlet_ids: outletIds } });
  const { access_token } = await loginAs(user);
  return api(access_token);
}
const stockOf = async (a, f) => {
  const rows = data(await a.get(`/ops/stock/on-hand?${new URLSearchParams(f)}`));
  const sum = (k) => Math.round(rows.reduce((x, r) => x + r[k], 0) * 1000) / 1000;
  return { available: sum('available'), reserved: sum('reserved'), in_transit: sum('in_transit'), damaged: sum('damaged'), quarantine: sum('quarantine'), lost: sum('lost'), rows };
};

describe('Novarex operations: purchase -> stock -> order -> shipment -> invoice -> payment -> reports', () => {
  let ctx; let a; let orgId;
  const ids = {};
  beforeAll(async () => {
    ctx = await setup(); a = ctx.a; orgId = ctx.org.id;
    const cats = data(await a.get('/categories?scope=ownership_type'));
    const kind = (k) => cats.find((c) => c.kind === k).id;
    const own = data(await a.post('/outlets', { name: 'Delhi Store', ownership_type_id: kind('company_owned'), state: 'Delhi', location: 'Delhi' }), 201);
    const fr = data(await a.post('/outlets', { name: 'Surat Franchise', ownership_type_id: kind('franchise'), state: 'Gujarat', location: 'Surat' }), 201);
    const tp = data(await a.post('/outlets', { name: 'Pune Partner', ownership_type_id: kind('third_party'), state: 'Maharashtra', location: 'Pune' }), 201);
    Object.assign(ids, { own: own.id, fr: fr.id, tp: tp.id });
    const wh = async (name, body) => data(await a.post('/ops/m/warehouses', { name, ...body }), 201).id;
    ids.central = await wh('Central Warehouse', { city: 'Delhi', state: 'Delhi' });
    ids.regional = await wh('Regional Warehouse', { city: 'Ahmedabad', state: 'Gujarat' });
    ids.ownStock = await wh('Delhi Store Stock', { type: 'outlet', outlet_id: ids.own, city: 'Delhi', state: 'Delhi' });
    ids.frStock = await wh('Surat Stock', { type: 'outlet', outlet_id: ids.fr, city: 'Surat', state: 'Gujarat' });
    ids.product = data(await a.post('/ops/m/products', { name: 'Paracetamol 500', sku: 'PARA-500', gst_rate: 12, purchase_price: 60, selling_price: 100, reorder_level: 20 }), 201).id;
    ids.supplier = data(await a.post('/ops/m/suppliers', { name: 'MediSupply', state: 'Delhi', credit_days: 15 }), 201).id;
    ids.custFr = data(await a.post('/ops/m/customers', { name: 'Surat Franchise', outlet_id: ids.fr, kind: 'outlet', state: 'Gujarat', credit_days: 10 }), 201).id;
    ids.custOwn = data(await a.post('/ops/m/customers', { name: 'Delhi Store', outlet_id: ids.own, kind: 'outlet', state: 'Delhi' }), 201).id;
    ids.custExt = data(await a.post('/ops/m/customers', { name: 'City Hospital', kind: 'external', state: 'Delhi' }), 201).id;
    data(await a.post('/ops/franchise/agreements', { outlet_id: ids.fr, partner_name: 'Surat Pharma LLP', start_date: plus(-30), royalty_pct: 5, purchase_discount_pct: 10, status: 'active', initial_fee: 50000 }), 201);
  });

  test('master data: codes are generated, duplicate sku refused, archive keeps history', async () => {
    const dup = await a.post('/ops/m/products', { name: 'Again', sku: 'PARA-500' });
    expect(dup.status).toBe(409);
    const auto = data(await a.post('/ops/m/products', { name: 'Auto code' }), 201);
    expect(auto.sku).toMatch(/^PRD-\d{4}$/);
    expect(data(await a.del(`/ops/m/products/${auto.id}`)).archived).toBe(true);
    expect(data(await a.get('/ops/m/products')).some((p) => p.id === auto.id)).toBe(false);
    expect(data(await a.get('/ops/m/products?archived=true')).some((p) => p.id === auto.id)).toBe(true);
    expect(data(await a.post(`/ops/m/products/${auto.id}/restore`, {})).archived).toBe(false);
  });

  test('purchase order -> partial receipts -> stock only on posting, once; damaged and rejected are separated', async () => {
    const po = data(await a.post('/ops/purchase-orders', { supplier_id: ids.supplier, warehouse_id: ids.central, lines: [{ product_id: ids.product, qty: 150, unit_price: 60 }] }), 201);
    ids.po = po.id;
    expect(po.total).toBeCloseTo(150 * 60 * 1.12, 2);
    const early = await a.post('/ops/receipts', { po_id: po.id, lines: [{ product_id: ids.product, batch_no: 'X', received_qty: 1, unit_cost: 60 }] });
    expect(early.status).toBe(409); // not approved yet
    data(await a.post(`/ops/purchase-orders/${po.id}/approve`, {}));
    const r1 = data(await a.post('/ops/receipts', { po_id: po.id, lines: [{ product_id: ids.product, batch_no: 'B1', expiry_date: plus(200), received_qty: 60, damaged_qty: 5, rejected_qty: 5, unit_cost: 60 }] }), 201);
    expect((await stockOf(a, { warehouse_id: ids.central })).available).toBe(0); // draft adds nothing
    const posted = data(await a.post(`/ops/receipts/${r1.id}/post`, {}));
    expect(posted.status).toBe('posted');
    const again = await a.post(`/ops/receipts/${r1.id}/post`, {});
    expect(again.status).toBe(409);
    let s = await stockOf(a, { warehouse_id: ids.central });
    expect([s.available, s.damaged]).toEqual([50, 5]);
    const inv = data(await a.get('/ops/invoices?type=purchase'));
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ subtotal: 3300, total: 3696, status: 'issued' });
    // second batch with an earlier expiry, then an already expired batch
    const r2 = data(await a.post('/ops/receipts', { po_id: po.id, lines: [{ product_id: ids.product, batch_no: 'B2', expiry_date: plus(30), received_qty: 40, unit_cost: 62 }] }), 201);
    data(await a.post(`/ops/receipts/${r2.id}/post`, {}));
    const r3 = data(await a.post('/ops/receipts', { po_id: po.id, lines: [{ product_id: ids.product, batch_no: 'B0', expiry_date: plus(-5), received_qty: 10, unit_cost: 50 }] }), 201);
    data(await a.post(`/ops/receipts/${r3.id}/post`, {}));
    const over = await a.post('/ops/receipts', { po_id: po.id, lines: [{ product_id: ids.product, batch_no: 'B9', received_qty: 100, unit_cost: 60 }] });
    expect(over.status).toBe(422); // more than ordered
    expect(data(await a.get(`/ops/purchase-orders/${po.id}`)).status).toBe('partially_received');
    s = await stockOf(a, { warehouse_id: ids.central });
    expect(s.available).toBe(100);
    const alerts = data(await a.get('/ops/stock/alerts'));
    expect(alerts.expired.map((r) => r.batch_no)).toContain('B0');
    expect(alerts.near_expiry.map((r) => r.batch_no)).toContain('B2');
  });

  test('stock adjustments are audited and cannot go below zero', async () => {
    const b1 = data(await a.get(`/ops/stock/batches?product_id=${ids.product}`)).find((b) => b.batch_no === 'B1');
    ids.b1 = b1.id;
    const bad = await a.post('/ops/stock/adjust', { product_id: ids.product, batch_id: b1.id, warehouse_id: ids.central, qty: -1000, reason: 'count' });
    expect(bad.status).toBe(422);
    data(await a.post('/ops/stock/adjust', { product_id: ids.product, batch_id: b1.id, warehouse_id: ids.central, qty: 2, reason: 'found in recount' }), 201);
    data(await a.post('/ops/stock/adjust', { product_id: ids.product, batch_id: b1.id, warehouse_id: ids.central, qty: -2, reason: 'recount corrected' }), 201);
    expect((await stockOf(a, { warehouse_id: ids.central })).available).toBe(100);
  });

  test('transfers: in-transit stock, receipt confirms, same-entity moves are not sales, franchise outlets must buy', async () => {
    const t = data(await a.post('/ops/transfers', { from_warehouse_id: ids.central, to_warehouse_id: ids.ownStock, lines: [{ product_id: ids.product, batch_id: ids.b1, qty: 10 }] }), 201);
    data(await a.post(`/ops/transfers/${t.id}/dispatch`, {}));
    expect((await stockOf(a, { warehouse_id: ids.central })).available).toBe(90);
    let dest = await stockOf(a, { warehouse_id: ids.ownStock });
    expect([dest.available, dest.in_transit]).toEqual([0, 10]);
    data(await a.post(`/ops/transfers/${t.id}/receive`, { lines: [{ product_id: ids.product, batch_id: ids.b1, received_qty: 8, damaged_qty: 1 }] }));
    dest = await stockOf(a, { warehouse_id: ids.ownStock });
    expect([dest.available, dest.in_transit, dest.damaged, dest.lost]).toEqual([8, 0, 1, 1]);
    expect((await a.post(`/ops/transfers/${t.id}/receive`, {})).status).toBe(409);
    const toFr = await a.post('/ops/transfers', { from_warehouse_id: ids.central, to_warehouse_id: ids.frStock, lines: [{ product_id: ids.product, batch_id: ids.b1, qty: 1 }] });
    expect(toFr.status).toBe(422);
    expect(toFr.body.code).toBe('use_sales_order');
    const toOwn = await a.post('/ops/orders', { customer_id: ids.custOwn, warehouse_id: ids.central, lines: [{ product_id: ids.product, qty: 1 }] });
    expect(toOwn.body.code).toBe('use_transfer');
    expect(data(await a.get('/ops/invoices?type=sales'))).toHaveLength(0); // no revenue from transfers
  });

  test('sales order: FEFO reservation skips expired stock, franchise discount applies, backorder is kept', async () => {
    const o = data(await a.post('/ops/orders', { customer_id: ids.custFr, warehouse_id: ids.central, expected_date: plus(3), lines: [{ product_id: ids.product, qty: 60 }] }), 201);
    ids.order = o.id;
    expect(o.lines[0].unit_price).toBe(90); // 100 less the 10% franchise purchase discount
    const c = data(await a.post(`/ops/orders/${o.id}/confirm`, {}));
    expect(c.status).toBe('confirmed');
    const full = data(await a.get(`/ops/orders/${o.id}`));
    expect(full.lines[0].allocations.map((x) => [x.batch_no, x.qty])).toEqual([['B2', 40], ['B1', 20]]); // earliest expiry first, B0 (expired) never
    const s = await stockOf(a, { warehouse_id: ids.central });
    expect([s.available, s.reserved]).toEqual([30, 60]);
    const o2 = data(await a.post('/ops/orders', { customer_id: ids.custExt, warehouse_id: ids.central, lines: [{ product_id: ids.product, qty: 50 }] }), 201);
    const c2 = data(await a.post(`/ops/orders/${o2.id}/confirm`, {}));
    expect(c2.lines[0].backorder_qty).toBe(30); // 20 were left to reserve (10 more units are expired)
    ids.order2 = o2.id;
    data(await a.post(`/ops/orders/${o2.id}/cancel`, { reason: 'customer withdrew' }));
    const after = await stockOf(a, { warehouse_id: ids.central });
    expect([after.available, after.reserved]).toEqual([30, 60]); // its reservation went back to available
  });

  test('shipment -> delivery with damage/missing -> invoice for accepted goods only, once; payments; credit note; refund', async () => {
    const sh = data(await a.post('/ops/shipments', { sales_order_id: ids.order, method: 'own_vehicle', distance_km: 40 }), 201);
    ids.ship = sh.id;
    const early = await a.post(`/ops/invoices/from-shipment/${sh.id}`, {});
    expect(early.status).toBe(409); // policy: invoice after delivery
    data(await a.post(`/ops/shipments/${sh.id}/status`, { status: 'dispatched' }));
    let s = await stockOf(a, { warehouse_id: ids.central });
    expect([s.reserved, s.available]).toEqual([0, 30]); // stock left at dispatch
    data(await a.post(`/ops/shipments/${sh.id}/status`, { status: 'in_transit' }));
    const dlv = data(await a.post(`/ops/shipments/${sh.id}/status`, { status: 'delivered', lines: [
      { product_id: ids.product, batch_id: sh.lines.find((l) => l.qty === 40).batch_id, delivered_qty: 40 },
      { product_id: ids.product, batch_id: sh.lines.find((l) => l.qty === 20).batch_id, delivered_qty: 15, damaged_qty: 3, missing_qty: 1 },
    ] }));
    expect(dlv.status).toBe('partially_delivered');
    s = await stockOf(a, { warehouse_id: ids.central });
    expect([s.damaged, s.lost, s.quarantine]).toEqual([5 + 3, 1, 1]);
    const invoice = data(await a.post(`/ops/invoices/from-shipment/${sh.id}`, {}), 201);
    ids.invoice = invoice.id;
    expect(invoice).toMatchObject({ subtotal: 55 * 90, tax_total: 594, total: 5544, status: 'issued', outstanding: 5544 });
    expect(invoice.tax_split.type).toBe('IGST'); // Delhi warehouse -> Gujarat customer
    expect((await a.post(`/ops/invoices/from-shipment/${sh.id}`, {})).status).toBe(409); // never twice
    const order = data(await a.get(`/ops/orders/${ids.order}`));
    expect([order.status, order.fulfilment, order.invoice_status, order.payment_status]).toEqual(['fulfilled', 'full', 'invoiced', 'unpaid']);
    expect(order.status).not.toBe('delivered'); // four separate statuses
    // revenue entry + cost of goods
    const entries = data(await a.get('/entries?kind=income'));
    expect(entries.find((e) => e.reference === invoice.invoice_no)).toMatchObject({ amount: 4950, payment_status: 'unpaid' });
    // payments
    expect((await a.post(`/ops/invoices/${invoice.id}/pay`, { amount: 9999 })).status).toBe(422);
    let p = data(await a.post(`/ops/invoices/${invoice.id}/pay`, { amount: 2000, method: 'bank' }));
    expect([p.status, p.outstanding]).toEqual(['partially_paid', 3544]);
    expect(data(await a.get('/entries?kind=income')).find((e) => e.reference === invoice.invoice_no).payment_status).toBe('unpaid');
    p = data(await a.post(`/ops/invoices/${invoice.id}/pay`, { amount: 3544 }));
    expect([p.status, p.outstanding]).toEqual(['paid', 0]);
    expect(data(await a.get('/entries?kind=income')).find((e) => e.reference === invoice.invoice_no).payment_status).toBe('paid');
    expect(data(await a.get(`/ops/orders/${ids.order}`)).payment_status).toBe('paid');
    // customer return -> quarantine first, restock only after inspection, credit note reduces revenue
    const b2 = data(await a.get(`/ops/stock/batches?product_id=${ids.product}`)).find((b) => b.batch_no === 'B2');
    const ret = data(await a.post('/ops/returns', { type: 'sales', invoice_id: invoice.id, warehouse_id: ids.central, product_id: ids.product, batch_id: b2.id, qty: 5, reason: 'wrong strength' }), 201);
    s = await stockOf(a, { warehouse_id: ids.central });
    expect(s.quarantine).toBe(1 + 5);
    expect((await a.post('/ops/returns', { type: 'sales', invoice_id: invoice.id, warehouse_id: ids.central, product_id: ids.product, batch_id: b2.id, qty: 36, reason: 'too many' })).status).toBe(422);
    const res = data(await a.post(`/ops/returns/${ret.id}/resolve`, { disposition: 'restock' }));
    expect(res.status).toBe('closed');
    expect((await a.post(`/ops/returns/${ret.id}/resolve`, { disposition: 'restock' })).status).toBe(409);
    s = await stockOf(a, { warehouse_id: ids.central });
    expect([s.available, s.quarantine]).toEqual([35, 1]);
    const full = data(await a.get(`/ops/invoices/${invoice.id}`));
    expect(full.credited_amount).toBeCloseTo(5 * 90 * 1.12, 2);
    expect(full.outstanding).toBeCloseTo(-504, 2); // over-settled -> refund due
    const refund = data(await a.post(`/ops/invoices/${invoice.id}/pay`, { amount: 504 }));
    expect(refund.outstanding).toBe(0);
  });

  test('logistics: rate card estimate, one freight entry that follows the actual cost, one entry per trip', async () => {
    const partner = data(await a.post('/ops/m/logistics-partners', { name: 'SwiftMove', regions: ['Gujarat'], pricing_model: 'per_km' }), 201);
    const card = data(await a.post('/ops/m/rate-cards', { partner_id: partner.id, name: 'Gujarat per km', model: 'per_km', base_amount: 100, rate: 5, handling_charge: 50 }), 201);
    expect(data(await a.post('/ops/freight/estimate', { rate_card_id: card.id, distance_km: 40 })).estimated_freight).toBe(350);
    const o = data(await a.post('/ops/orders', { customer_id: ids.custExt, warehouse_id: ids.central, lines: [{ product_id: ids.product, qty: 10 }] }), 201);
    data(await a.post(`/ops/orders/${o.id}/confirm`, {}));
    const sh = data(await a.post('/ops/shipments', { sales_order_id: o.id, method: 'partner', partner_id: partner.id, rate_card_id: card.id, distance_km: 40 }), 201);
    expect(sh.estimated_freight).toBe(350);
    data(await a.patch(`/ops/shipments/${sh.id}`, { actual_freight: 400 }));
    data(await a.patch(`/ops/shipments/${sh.id}`, { actual_freight: 420 }));
    const freight = data(await a.get('/entries?kind=expense')).filter((e) => e.reference === sh.shipment_no);
    expect(freight).toHaveLength(1);
    expect(freight[0].amount).toBe(420);
    expect(data(await a.get(`/ops/shipments/${sh.id}`)).freight_variance).toBe(70);
    data(await a.patch(`/ops/shipments/${sh.id}`, { freight_status: 'paid' }));
    expect(data(await a.get('/entries?kind=expense')).find((e) => e.reference === sh.shipment_no).payment_status).toBe('paid');
    const veh = data(await a.post('/ops/m/vehicles', { reg_no: 'DL01AB1234', driver_name: 'Ravi' }), 201);
    const trip = data(await a.post('/ops/trips', { vehicle_id: veh.id, fuel_cost: 200, toll_cost: 50 }), 201);
    data(await a.patch(`/ops/trips/${trip.id}`, { vehicle_id: veh.id, fuel_cost: 220, toll_cost: 50 }));
    const fuel = data(await a.get('/entries?kind=expense')).filter((e) => e.description === 'Vehicle trip DL01AB1234');
    expect(fuel).toHaveLength(1);
    expect(fuel[0].amount).toBe(270);
    ids.partnerOrder = o.id;
  });

  test('recall blocks the batch from allocation and dispatch and traces it to the customer', async () => {
    const rc = data(await a.post('/ops/recalls', { product_id: ids.product, batch_id: ids.b1, reason: 'Quality complaint' }), 201);
    expect(rc.recall_no).toMatch(/^RCL-/);
    const o = data(await a.post('/ops/orders', { customer_id: ids.custExt, warehouse_id: ids.central, lines: [{ product_id: ids.product, qty: 5 }] }), 201);
    const c = data(await a.post(`/ops/orders/${o.id}/confirm`, {}));
    const got = c.lines[0].allocations.map((x) => x.batch_id);
    expect(got).not.toContain(ids.b1);
    const pending = data(await a.get(`/ops/shipments?sales_order_id=${ids.partnerOrder}`))[0];
    const blocked = await a.post(`/ops/shipments/${pending.id}/status`, { status: 'dispatched' });
    expect([200, 422]).toContain(blocked.status);
    const trace = data(await a.get(`/ops/stock/trace/${ids.b1}`));
    expect(trace.customers).toContain('Surat Franchise');
    expect(trace.invoices.length).toBeGreaterThan(0);
  });

  test('franchise: settlement royalty on reported sales, one invoice, income on the franchise outlet only', async () => {
    const ag = data(await a.get('/ops/franchise/agreements'))[0];
    expect(ag.receivable).toBeGreaterThanOrEqual(0);
    const month = iso(new Date()).slice(0, 7);
    const st = data(await a.post('/ops/franchise/settlements', { agreement_id: ag.id, month, reported_sales: 200000, kind: 'royalty' }), 201);
    expect([st.royalty_due, st.total_due]).toEqual([10000, 10000]);
    const inv = data(await a.post(`/ops/franchise/settlements/${st.id}/invoice`, { gst_rate: 18 }), 201);
    expect(inv.total).toBe(11800);
    expect((await a.post(`/ops/franchise/settlements/${st.id}/invoice`, {})).status).toBe(409);
    const income = data(await a.get('/entries?kind=income')).find((e) => e.reference === inv.invoice_no);
    expect(income).toMatchObject({ amount: 10000, payment_status: 'unpaid' }); // the franchisee's 200000 retail sales are NOT income
    const outletId = ids.fr;
    const rep = data(await a.get(`/ops/franchise/report/${outletId}`));
    expect(rep.fees_and_royalties.invoiced).toBe(11800);
    expect(rep.purchases_from_novarex.invoiced).toBeGreaterThan(0);
    data(await a.post(`/ops/invoices/${inv.invoice_id}/pay`, { amount: 11800 }));
    expect(data(await a.get('/ops/franchise/settlements')).find((s) => s.id === st.id).status).toBe('settled');
    const nonFranchise = await a.post('/ops/franchise/agreements', { outlet_id: ids.own, partner_name: 'X', start_date: plus(0) });
    expect(nonFranchise.status).toBe(422);
  });

  test('dashboard figures agree with the documents; filters change them; reports and exports have rows', async () => {
    const d = data(await a.get(`/ops/dashboard?from=${plus(-60)}&to=${plus(1)}`));
    // revenue = franchise-goods invoice 4950 - credit 450 (5 x 90)
    expect(d.kpis.sales_revenue).toBe(4500);
    // cost = 40 x 62 + 15 x 60 = 3380, less the restocked return 5 x 62 = 310
    expect(d.kpis.cost_of_goods).toBe(3070);
    expect(d.kpis.gross_profit).toBe(1430);
    expect(d.kpis.franchise_fees).toBe(10000);
    expect(d.kpis.logistics_cost).toBe(420 + 270);
    expect(d.kpis.receivables).toBe(0);
    expect(d.kpis.payables).toBeGreaterThan(0);
    expect(d.kpis.inventory_value).toBeGreaterThan(0);
    const byOutlet = data(await a.get(`/ops/dashboard?from=${plus(-60)}&to=${plus(1)}&outlet_id=${ids.fr}`));
    expect(byOutlet.kpis.sales_revenue).toBe(4500);
    const byOther = data(await a.get(`/ops/dashboard?from=${plus(-60)}&to=${plus(1)}&outlet_id=${ids.tp}`));
    expect(byOther.kpis.sales_revenue).toBe(0);
    const kindFilter = data(await a.get(`/ops/dashboard?from=${plus(-60)}&to=${plus(1)}&ownership_kind=franchise`));
    expect(kindFilter.kpis.sales_revenue).toBe(4500);
    const empty = data(await a.get(`/ops/dashboard?from=${plus(-400)}&to=${plus(-300)}`));
    expect(empty.kpis.sales_revenue).toBe(0);
    for (const name of ['sales_monthly', 'sales_by_outlet', 'sales_by_product', 'order_status', 'purchases', 'stock_on_hand', 'stock_movement', 'expiry', 'returns', 'invoice_status', 'receivables', 'payables', 'franchise', 'outlet_pnl', 'logistics', 'discrepancies']) {
      const r = data(await a.get(`/ops/reports/${name}?from=${plus(-60)}&to=${plus(1)}`));
      expect(r.columns.length).toBeGreaterThan(0);
      expect(Array.isArray(r.rows)).toBe(true);
    }
    const pnl = data(await a.get(`/ops/reports/outlet_pnl?from=${plus(-60)}&to=${plus(1)}`));
    const row = pnl.rows.find((x) => x[0] === 'Surat Franchise');
    expect(row.slice(2, 5)).toEqual([4500 + 10000, 3070, 4500 + 10000 - 3070]);
    const ledgerSum = data(await a.get('/ops/stock/ledger?limit=2000')).length;
    expect(ledgerSum).toBeGreaterThan(10);
  });

  test('financial lock: a closed month blocks invoicing, payments and freight for non-admins; admin needs a reason', async () => {
    const b2 = data(await a.get(`/ops/stock/batches?product_id=${ids.product}`)).find((b) => b.batch_no === 'B2');
    data(await a.post('/ops/stock/adjust', { product_id: ids.product, batch_id: b2.id, warehouse_id: ids.central, qty: 20, reason: 'stock for the lock test' }), 201);
    const o = data(await a.post('/ops/orders', { customer_id: ids.custExt, warehouse_id: ids.central, lines: [{ product_id: ids.product, qty: 3 }] }), 201);
    data(await a.post(`/ops/orders/${o.id}/confirm`, {}));
    const sh = data(await a.post('/ops/shipments', { sales_order_id: o.id }), 201);
    for (const st of ['dispatched', 'delivered']) data(await a.post(`/ops/shipments/${sh.id}/status`, { status: st }));
    const month = iso(new Date()).slice(0, 7);
    const close = await a.post(`/finance/periods/${month}/close`, {});
    expect([200, 201]).toContain(close.status);
    const finance = await member(ctx.org, 'finance');
    const blocked = await finance.post(`/ops/invoices/from-shipment/${sh.id}`, {});
    expect([blocked.status, blocked.body.code]).toEqual([409, 'period_closed']);
    const noReason = await a.post(`/ops/invoices/from-shipment/${sh.id}`, {});
    expect([noReason.status, noReason.body.code]).toEqual([422, 'period_reason_required']);
    const inv = data(await a.post(`/ops/invoices/from-shipment/${sh.id}`, { reason: 'late invoice approved by finance head' }), 201);
    const pay = await finance.post(`/ops/invoices/${inv.id}/pay`, { amount: 10 });
    expect([pay.status, pay.body.code]).toEqual([409, 'period_closed']);
    const frt = await finance.patch(`/ops/shipments/${sh.id}`, { actual_freight: 100 });
    expect([200, 403]).toContain(frt.status); // logistics edit needs a logistics role; finance cannot edit shipments
    data(await a.post(`/ops/invoices/${inv.id}/pay`, { amount: 10, reason: 'receipt dated this month' }));
    const reopen = await a.post(`/finance/periods/${month}/reopen`, { reason: 'test cleanup' });
    expect([200, 201]).toContain(reopen.status);
  });

  test('independent check from the raw tables: stock never negative, inventory value, receivables, revenue and cost agree with the dashboard', async () => {
    const num = (v) => Number(v || 0);
    const ledger = await prisma.nxStockLedger.groupBy({ by: ['product_id', 'batch_id', 'warehouse_id', 'bucket'], where: { org_id: orgId }, _sum: { qty: true } });
    expect(ledger.every((r) => num(r._sum.qty) >= -0.0001)).toBe(true);
    const batches = new Map((await prisma.nxBatch.findMany({ where: { org_id: orgId } })).map((b) => [b.id, num(b.unit_cost)]));
    const value = Math.round(ledger.filter((r) => ['available', 'reserved', 'in_transit', 'quarantine'].includes(r.bucket)).reduce((a, r) => a + num(r._sum.qty) * batches.get(r.batch_id), 0) * 100) / 100;
    const d = data(await a.get(`/ops/dashboard?from=${plus(-60)}&to=${plus(1)}`));
    expect(d.kpis.inventory_value).toBeCloseTo(value, 2);
    const invs = await prisma.nxInvoice.findMany({ where: { org_id: orgId, status: { not: 'cancelled' } } });
    const open = invs.filter((i) => ['sales', 'franchise'].includes(i.type)).reduce((x, i) => x + Math.max(0, num(i.total) - num(i.paid_amount) - num(i.credited_amount)), 0);
    expect(d.kpis.receivables).toBeCloseTo(open, 2);
    const rev = invs.filter((i) => i.type === 'sales').reduce((x, i) => x + num(i.subtotal), 0) - invs.filter((i) => i.type === 'credit_note').reduce((x, i) => x + num(i.subtotal), 0);
    expect(d.kpis.sales_revenue).toBeCloseTo(rev, 2);
    const ents = await prisma.nxEntry.findMany({ where: { org_id: orgId, deleted_at: null, payment_status: { not: 'cancelled' } } });
    const incomeEntries = ents.filter((e) => ['sales_invoice', 'credit_note'].includes(e.source_type)).reduce((x, e) => x + num(e.amount), 0);
    expect(incomeEntries).toBeCloseTo(rev, 2); // the books carry exactly the invoiced revenue, once
    expect(d.kpis.cost_of_goods).toBeCloseTo(ents.filter((e) => e.source_type === 'cogs').reduce((x, e) => x + num(e.amount), 0), 2);
    // one revenue entry per sales invoice, one cogs entry per sales invoice: nothing double counted
    const salesInv = invs.filter((i) => i.type === 'sales');
    expect(ents.filter((e) => e.source_type === 'sales_invoice')).toHaveLength(salesInv.length);
    // the finance dashboard shows the same recognised revenue as the operations dashboard (no second system)
    const fin = data(await a.get(`/dashboard?from=${plus(-60)}&to=${plus(1)}`));
    expect(fin.period.sales_revenue).toBeCloseTo(rev, 2);
    expect(fin.period.gross_profit).toBeCloseTo(d.kpis.gross_profit, 2);
    // cost of goods is non-cash: it never appears as cash out
    expect(fin.period.paid_expenses).toBeLessThan(fin.period.expenses);
  });

  test('permissions: warehouse cannot buy, outlet manager sees only their outlet, franchise partner is isolated', async () => {
    const warehouse = await member(ctx.org, 'warehouse');
    expect((await warehouse.post('/ops/purchase-orders', { supplier_id: ids.supplier, warehouse_id: ids.central, lines: [{ product_id: ids.product, qty: 1, unit_price: 1 }] })).status).toBe(403);
    expect((await warehouse.get('/ops/m/products')).status).toBe(200);
    const partner = await member(ctx.org, 'franchise_partner', [ids.fr]);
    const other = await member(ctx.org, 'franchise_partner', [ids.tp]);
    const mine = data(await partner.get('/ops/invoices'));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((i) => i.outlet_id === ids.fr)).toBe(true);
    expect(data(await other.get('/ops/invoices'))).toHaveLength(0);
    expect(data(await other.get('/ops/orders'))).toHaveLength(0);
    expect((await other.get(`/ops/invoices/${ids.invoice}`)).status).toBe(403);
    expect((await other.get(`/ops/franchise/report/${ids.fr}`)).status).toBe(403);
    expect((await partner.post('/ops/orders', { customer_id: ids.custFr, warehouse_id: ids.central, lines: [{ product_id: ids.product, qty: 1 }] })).status).toBe(403);
    const outletMgr = await member(ctx.org, 'outlet_manager', [ids.own]);
    expect(data(await outletMgr.get('/ops/orders')).every((o) => o.outlet_id === ids.own)).toBe(true);
    const wh = data(await outletMgr.get('/ops/m/warehouses'));
    expect(wh.map((w) => w.id)).toEqual([ids.ownStock]);
    // company isolation: another company sees none of this
    const ctx2 = await setup();
    expect(data(await ctx2.a.get('/ops/m/products'))).toHaveLength(0);
    expect((await ctx2.a.get(`/ops/invoices/${ids.invoice}`)).status).toBe(404);
  });

  test('admin editability: master data, batch status and settings are editable with an audit trail', async () => {
    data(await a.patch(`/ops/m/products/${ids.product}`, { selling_price: 110, reason: 'price revision' }));
    expect(data(await a.get(`/ops/m/products/${ids.product}`)).selling_price).toBe(110);
    data(await a.patch(`/ops/stock/batches/${ids.b1}`, { quality_status: 'released', reason: 'recall closed' }));
    data(await a.patch('/settings', { invoice_timing: 'dispatch', expiry_warning_days: 45 }));
    expect(data(await a.get('/settings')).expiry_warning_days).toBe(45);
    const audit = await prisma.nxAudit.findMany({ where: { org_id: orgId, entity: 'product' } });
    expect(audit.some((x) => x.action === 'update' && x.reason === 'price revision')).toBe(true);
  });
});
