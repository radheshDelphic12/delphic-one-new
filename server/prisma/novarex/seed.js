/**
 * Novarex Pharmaceuticals - demo workspace (LOCAL / STAGING DEMO ONLY; refuses a non-local database, never run on production).
 *
 * Runs the non-destructive admin bootstrap first, then - only while the company has no products - loads a small pharma business:
 * company-owned, franchise and third-party outlets in several cities, warehouses, products with batches and expiry, a supplier purchase
 * and receipts, transfers to outlet stock rooms, sales orders to the franchise outlet and to a hospital with shipments (company vehicle
 * and a logistics partner), delivery with a damaged item, invoices and part payments, a customer return with a credit note, a franchise
 * agreement with an invoiced royalty, investments, salaries, overheads and projections. Everything is written through the same
 * services the API uses, so every figure is computed as the app computes it.
 *
 * Usage (from server/): npm run novarex:seed        (admin@novarex.in / Novarex@2026!)
 */
const bcrypt = require('bcryptjs');
const { assertNonProdDestructive } = require('../_guard');
const { run, prisma } = require('./seed-admin');

const PASSWORD = 'Novarex@2026!';
const LOGINS = [
  { name: 'Meera Kapoor', email: 'manager@novarex.in', access_role: 'manager', designation: 'Operations Manager' },
  { name: 'Arjun Nair', email: 'finance@novarex.in', access_role: 'finance', designation: 'Finance Controller' },
  { name: 'Isha Verma', email: 'staff@novarex.in', access_role: 'staff', designation: 'Accounts Executive' },
  { name: 'Pawan Gupta', email: 'procurement@novarex.in', access_role: 'procurement', designation: 'Procurement Manager' },
  { name: 'Hari Singh', email: 'warehouse@novarex.in', access_role: 'warehouse', designation: 'Warehouse Manager' },
  { name: 'Neha Sharma', email: 'sales@novarex.in', access_role: 'sales', designation: 'Sales Manager' },
  { name: 'Vikas Rao', email: 'logistics@novarex.in', access_role: 'logistics', designation: 'Logistics Manager' },
  { name: 'Tanya Bose', email: 'outlet@novarex.in', access_role: 'outlet_manager', designation: 'Delhi Store Manager', outlet: 'Delhi Store' },
  { name: 'Surat Pharma LLP', email: 'franchise@novarex.in', access_role: 'franchise_partner', designation: 'Franchise partner', outlet: 'Surat Franchise' },
];
const ymd = (d) => d.toISOString().slice(0, 10);
const daysFrom = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const monthsAgo = (n, day = 10) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); d.setUTCDate(day); return ymd(d); };
const monthsAhead = (n, day = 28) => monthsAgo(-n, day);

async function demo(org, admin) {
  assertNonProdDestructive('prisma/novarex/seed.js (demo company)');
  const S = (m) => require(`../../src/modules/novarex/${m}`);
  const core = S('core.service'); const outletsSvc = S('outlets.service'); const investments = S('investments.service'); const entries = S('entries.service'); const projections = S('projections.service');
  const masters = S('ops/masters.service'); const purchasing = S('ops/purchasing.service'); const transfers = S('ops/transfers.service'); const sales = S('ops/sales.service');
  const logistics = S('ops/logistics.service'); const billing = S('ops/billing.service'); const returns = S('ops/returns.service'); const franchise = S('ops/franchise.service'); const stock = S('ops/stock.service');
  if ((await prisma.nxProduct.count({ where: { org_id: org.id } })) > 0) { console.log('  = demo skipped (the company already has products)'); return; }
  await core.ensureCategories(org.id);
  const A = admin.id; const O = org.id; const ctx = { isAdmin: true, payroll: true };
  const cats = await prisma.nxCategory.findMany({ where: { org_id: O } });
  const cat = (scope, name) => cats.find((c) => c.scope === scope && c.name === name)?.id;
  const kind = (k) => cats.find((c) => c.scope === 'ownership_type' && c.kind === k)?.id;

  // outlets
  const mkOutlet = async (name, k, body) => { const r = await outletsSvc.create(O, A, { name, ownership_type_id: kind(k), format_id: cat('format', 'Retail pharmacy'), status: 'active', ...body }); if (r.error) throw new Error(`outlet ${name}: ${r.error}`); return r.outlet; };
  const delhi = await mkOutlet('Delhi Store', 'company_owned', { location: 'Connaught Place, Delhi', state: 'Delhi', country: 'India', gstin: '07AAECN1234F1Z5', drug_licence_no: 'DL-20-2231', drug_licence_expiry: daysFrom(500), legal_entity: 'Novarex Pharmaceuticals Pvt Ltd', manager_name: 'Tanya Bose' });
  const ahd = await mkOutlet('Ahmedabad Store', 'company_owned', { location: 'Navrangpura, Ahmedabad', state: 'Gujarat', country: 'India', gstin: '24AAECN1234F1Z8', drug_licence_no: 'GJ-AH-9921', drug_licence_expiry: daysFrom(40), legal_entity: 'Novarex Pharmaceuticals Pvt Ltd' });
  const surat = await mkOutlet('Surat Franchise', 'franchise', { location: 'Adajan, Surat', state: 'Gujarat', country: 'India', legal_entity: 'Surat Pharma LLP', agreement_ref: 'FA-2026-04' });
  const pune = await mkOutlet('Pune Partner', 'third_party', { location: 'Kothrud, Pune', state: 'Maharashtra', country: 'India', legal_entity: 'Deccan Health Traders' });

  // people and logins
  const hash = await bcrypt.hash(PASSWORD, 10);
  for (const l of LOGINS) {
    let user = await prisma.user.findUnique({ where: { email: l.email } });
    if (!user) user = await prisma.user.create({ data: { name: l.name, email: l.email, password_hash: hash, role: 'employee', active: true } });
    if (!(await prisma.orgMembership.findFirst({ where: { person_id: user.id, org_id: O } }))) await prisma.orgMembership.create({ data: { person_id: user.id, org_id: O, role: 'employee' } });
    const outletIds = l.outlet ? [{ 'Delhi Store': delhi.id, 'Surat Franchise': surat.id }[l.outlet]] : [];
    const ex = await prisma.nxPerson.findFirst({ where: { org_id: O, user_id: user.id, deleted_at: null } });
    if (!ex) await prisma.nxPerson.create({ data: { org_id: O, name: l.name, user_id: user.id, access_role: l.access_role, designation: l.designation, outlet_ids: outletIds } });
  }
  const crew = [];
  for (const [name, designation] of [['Rohan Desai', 'Pharmacist, Delhi Store'], ['Kavya Iyer', 'Pharmacist, Ahmedabad Store'], ['Sameer Khan', 'Driver']]) crew.push(await prisma.nxPerson.create({ data: { org_id: O, name, designation, kind: 'employee' } }));

  // locations
  const wh = async (name, body) => (await masters.create(O, A, 'warehouses', { name, ...body })).id;
  const central = await wh('Central Warehouse', { city: 'Delhi', state: 'Delhi', manager_name: 'Hari Singh' });
  const regional = await wh('Regional Warehouse', { city: 'Ahmedabad', state: 'Gujarat' });
  const delhiStock = await wh('Delhi Store Stock', { type: 'outlet', outlet_id: delhi.id, city: 'Delhi', state: 'Delhi' });
  const ahdStock = await wh('Ahmedabad Store Stock', { type: 'outlet', outlet_id: ahd.id, city: 'Ahmedabad', state: 'Gujarat' });
  await wh('Surat Franchise Stock', { type: 'outlet', outlet_id: surat.id, city: 'Surat', state: 'Gujarat' });

  // products
  const prodDefs = [
    ['Paracetamol 500 mg', 'PARA-500', 'Tablet', 12, 18, 30, 40, 'Medicines', 200],
    ['Amoxicillin 250 mg', 'AMOX-250', 'Capsule', 12, 55, 80, 105, 'Medicines', 150, 'Schedule H', true],
    ['ORS sachet', 'ORS-01', 'Powder', 5, 9, 14, 20, 'Healthcare products', 300],
    ['Insulin glargine 3 ml', 'INS-GLA', 'Injection', 5, 620, 780, 860, 'Medicines', 40, 'Schedule H', true, true],
    ['Digital thermometer', 'THERM-D', 'Device', 18, 90, 150, 199, 'Medical supplies', 25],
    ['Surgical mask (box of 50)', 'MASK-50', 'Box', 12, 70, 110, 140, 'Medical supplies', 60],
  ];
  const P = {};
  for (const [name, sku, form, gst, buy, sell, mrp, c, reorder, reg, rx, cold] of prodDefs) P[sku] = await masters.create(O, A, 'products', { name, sku, dosage_form: form, gst_rate: gst, purchase_price: buy, selling_price: sell, mrp, category_id: cat('product_category', c), reorder_level: reorder, ...(reg ? { regulatory_class: reg } : {}), ...(rx ? { requires_prescription: true } : {}), ...(cold ? { cold_chain: true } : {}), manufacturer: 'Various', hsn: '3004' });
  const sup1 = await masters.create(O, A, 'suppliers', { name: 'MediSupply Distributors', state: 'Delhi', gstin: '07AABCM1111A1Z1', credit_days: 30, licence_no: 'WH-DL-8812', licence_expiry: daysFrom(700) });
  const sup2 = await masters.create(O, A, 'suppliers', { name: 'Gujarat Pharma Traders', state: 'Gujarat', credit_days: 15 });
  const cFr = await masters.create(O, A, 'customers', { name: 'Surat Franchise', outlet_id: surat.id, kind: 'outlet', state: 'Gujarat', credit_days: 10 });
  await masters.create(O, A, 'customers', { name: 'Pune Partner', outlet_id: pune.id, kind: 'outlet', state: 'Maharashtra', credit_days: 20 });
  const cHosp = await masters.create(O, A, 'customers', { name: 'City Hospital Delhi', kind: 'external', state: 'Delhi', credit_days: 30 });
  const partner = await masters.create(O, A, 'logistics-partners', { name: 'SwiftMove Logistics', regions: ['Gujarat', 'Maharashtra'], pricing_model: 'per_km', payment_terms: 'Monthly' });
  const card = await masters.create(O, A, 'rate-cards', { partner_id: partner.id, name: 'Gujarat per km', model: 'per_km', base_amount: 400, rate: 11, handling_charge: 150, cold_chain_charge: 300 });
  const veh = await masters.create(O, A, 'vehicles', { reg_no: 'DL01AB1234', vehicle_type: 'Mini truck', capacity: '1.5 t', driver_name: 'Sameer Khan', driver_person_id: crew[2].id, insurance_expiry: daysFrom(200), permit_expiry: daysFrom(25) });
  void card; void sup2;

  // purchase and receipts (one batch near expiry, one already expired, one cold-chain)
  const lines = (sku, qty, price) => ({ product_id: P[sku].id, qty, unit_price: price });
  const po = await purchasing.createPO(O, A, { supplier_id: sup1.id, warehouse_id: central, expected_date: daysFrom(5), lines: [lines('PARA-500', 2000, 18), lines('AMOX-250', 800, 55), lines('ORS-01', 3000, 9), lines('INS-GLA', 120, 620), lines('THERM-D', 100, 90), lines('MASK-50', 400, 70)] });
  await purchasing.actPO(O, A, po.id, 'approve');
  const rcv = async (ls) => { const r = await purchasing.createReceipt(O, A, { po_id: po.id, receipt_date: monthsAgo(2, 5), lines: ls }); return purchasing.postReceipt(O, A, r.id); };
  await rcv([
    { product_id: P['PARA-500'].id, batch_no: 'PC2601', expiry_date: daysFrom(420), received_qty: 1200, unit_cost: 18 },
    { product_id: P['PARA-500'].id, batch_no: 'PC2509', expiry_date: daysFrom(45), received_qty: 800, damaged_qty: 10, unit_cost: 17 },
    { product_id: P['AMOX-250'].id, batch_no: 'AX2601', expiry_date: daysFrom(300), received_qty: 800, rejected_qty: 20, unit_cost: 55 },
    { product_id: P['ORS-01'].id, batch_no: 'OR2512', expiry_date: daysFrom(-8), received_qty: 600, unit_cost: 9 },
    { product_id: P['ORS-01'].id, batch_no: 'OR2603', expiry_date: daysFrom(500), received_qty: 2400, unit_cost: 9 },
  ]);
  await rcv([
    { product_id: P['INS-GLA'].id, batch_no: 'IG2602', expiry_date: daysFrom(210), received_qty: 120, unit_cost: 620 },
    { product_id: P['THERM-D'].id, batch_no: 'TD2601', received_qty: 100, unit_cost: 90 },
    { product_id: P['MASK-50'].id, batch_no: 'MK2601', expiry_date: daysFrom(700), received_qty: 400, unit_cost: 70 },
  ]);
  const batch = async (sku, no) => (await prisma.nxBatch.findFirst({ where: { org_id: O, product_id: P[sku].id, batch_no: no } }));

  // supplier payment (part)
  const purInv = (await billing.list(O, { type: 'purchase' }))[0];
  await billing.pay(O, A, purInv.id, { amount: 50000, pay_date: monthsAgo(1, 3), method: 'bank' }, ctx);

  // transfers to the company-owned outlets (never revenue)
  const bPara = await batch('PARA-500', 'PC2601'); const bOrs = await batch('ORS-01', 'OR2603'); const bIns = await batch('INS-GLA', 'IG2602');
  const t1 = await transfers.create(O, A, { from_warehouse_id: central, to_warehouse_id: delhiStock, lines: [{ product_id: P['PARA-500'].id, batch_id: bPara.id, qty: 300 }, { product_id: P['ORS-01'].id, batch_id: bOrs.id, qty: 400 }] });
  await transfers.act(O, A, t1.id, 'dispatch'); await transfers.act(O, A, t1.id, 'receive', {});
  const t2 = await transfers.create(O, A, { from_warehouse_id: central, to_warehouse_id: regional, lines: [{ product_id: P['INS-GLA'].id, batch_id: bIns.id, qty: 40 }, { product_id: P['PARA-500'].id, batch_id: bPara.id, qty: 400 }] });
  await transfers.act(O, A, t2.id, 'dispatch'); await transfers.act(O, A, t2.id, 'receive', { lines: [{ product_id: P['INS-GLA'].id, batch_id: bIns.id, received_qty: 39, damaged_qty: 1 }, { product_id: P['PARA-500'].id, batch_id: bPara.id, received_qty: 400, damaged_qty: 0 }] });
  const t3 = await transfers.create(O, A, { from_warehouse_id: regional, to_warehouse_id: ahdStock, lines: [{ product_id: P['PARA-500'].id, batch_id: bPara.id, qty: 150 }] });
  await transfers.act(O, A, t3.id, 'dispatch'); await transfers.act(O, A, t3.id, 'receive', {});

  // sales: franchise (goods invoiced to it) and a hospital, over three months
  const fulfil = async (customer, fromWh, items, back, opts = {}) => {
    const date = monthsAgo(back, 12);
    const o = await sales.create(O, A, { customer_id: customer.id, warehouse_id: fromWh, order_date: date, expected_date: monthsAgo(back, 15), lines: items }, null);
    await sales.confirm(O, A, o.id, null);
    const s = await logistics.create(O, A, { sales_order_id: o.id, ...opts }, null);
    await logistics.setStatus(O, A, s.id, 'dispatched', {}, ctx, null);
    await logistics.setStatus(O, A, s.id, 'delivered', opts.deliver || {}, ctx, null);
    if (opts.actual_freight !== undefined) await logistics.update(O, A, s.id, { actual_freight: opts.actual_freight }, ctx);
    const inv = await billing.invoiceShipment(O, A, s.id, { ...ctx, date });
    return { order: o, shipment: s, invoice: inv, date };
  };
  const a1 = await fulfil(cFr, central, [{ product_id: P['PARA-500'].id, qty: 300 }, { product_id: P['AMOX-250'].id, qty: 120 }], 2, { method: 'partner', partner_id: partner.id, rate_card_id: card.id, distance_km: 270, actual_freight: 3720 });
  await billing.pay(O, A, a1.invoice.id, { amount: a1.invoice.total, pay_date: monthsAgo(1, 2), method: 'bank' }, ctx);
  const a2 = await fulfil(cHosp, central, [{ product_id: P['INS-GLA'].id, qty: 30 }, { product_id: P['MASK-50'].id, qty: 100 }, { product_id: P['THERM-D'].id, qty: 20 }], 1, { method: 'own_vehicle', vehicle_id: veh.id, distance_km: 18 });
  await billing.pay(O, A, a2.invoice.id, { amount: Math.round(a2.invoice.total * 0.6), pay_date: monthsAgo(0, 2), method: 'bank' }, ctx);
  await logistics.saveTrip(O, A, null, { vehicle_id: veh.id, shipment_id: a2.shipment.id, trip_date: monthsAgo(1, 12), distance_km: 18, fuel_cost: 420, toll_cost: 60 }, ctx);
  const a3 = await fulfil(cFr, central, [{ product_id: P['PARA-500'].id, qty: 200 }, { product_id: P['ORS-01'].id, qty: 500 }, { product_id: P['MASK-50'].id, qty: 60 }], 0, { method: 'partner', partner_id: partner.id, rate_card_id: card.id, distance_km: 270 });
  void a3;
  // return of damaged goods from the hospital, inspected and credited
  const mask = await batch('MASK-50', 'MK2601');
  const ret = await returns.create(O, A, { type: 'sales', invoice_id: a2.invoice.id, warehouse_id: central, product_id: P['MASK-50'].id, batch_id: mask.id, qty: 5, reason: 'Box seals damaged' });
  await returns.resolve(O, A, ret.id, { disposition: 'damaged' }, ctx);
  // an open order with a backorder, and a draft purchase order
  const open = await sales.create(O, A, { customer_id: cHosp.id, warehouse_id: central, expected_date: daysFrom(4), lines: [{ product_id: P['INS-GLA'].id, qty: 80 }] }, null);
  await sales.confirm(O, A, open.id, null);

  // franchise
  const ag = await franchise.create(O, A, { outlet_id: surat.id, partner_name: 'Surat Pharma LLP', start_date: monthsAgo(3, 1), end_date: daysFrom(40), renewal_date: daysFrom(40), royalty_pct: 5, purchase_discount_pct: 8, initial_fee: 250000, security_deposit: 100000, status: 'active', payment_terms: 'Royalty due 15 days after month end', terms: 'Exclusive territory: Adajan, Surat' });
  const st = await franchise.createSettlement(O, A, { agreement_id: ag.id, month: monthsAgo(1, 1).slice(0, 7), reported_sales: 640000, kind: 'royalty' }, null);
  await franchise.invoiceSettlement(O, A, st.id, { date: monthsAgo(0, 3) }, ctx);

  // finance books: capital, salaries, overheads, projections
  const E = (n) => cat('expense', n); const I = (n) => cat('investment', n);
  const inv = await investments.create(O, A, ctx, { name: 'Working capital from the promoters', category_id: I('Working capital'), investor: 'Promoters', investment_date: monthsAgo(3, 2), amount: 5000000, expected_return_amount: 5400000, expected_return_date: monthsAhead(8, 5), status: 'active' });
  if (inv.error) throw new Error(`investment: ${inv.error}`);
  const add = async (b) => { const r = await entries.create(O, A, ctx, b); if (r.error) throw new Error(`entry ${b.kind} ${b.amount}: ${r.error}`); };
  for (let back = 2; back >= 0; back -= 1) {
    await add({ kind: 'salary', person_id: crew[0].id, outlet_id: delhi.id, amount: 42000, entry_date: monthsAgo(back, 28), payment_status: back === 0 ? 'unpaid' : 'paid' });
    await add({ kind: 'salary', person_id: crew[1].id, outlet_id: ahd.id, amount: 40000, entry_date: monthsAgo(back, 28), payment_status: back === 0 ? 'unpaid' : 'paid' });
    await add({ kind: 'salary', person_id: crew[2].id, amount: 26000, entry_date: monthsAgo(back, 28), payment_status: back === 0 ? 'unpaid' : 'paid' });
    await add({ kind: 'expense', outlet_id: delhi.id, amount: 85000, entry_date: monthsAgo(back, 5), category_id: E('Outlet rent and utilities'), expense_class: 'operating', party_name: 'Landlord, Connaught Place' });
    await add({ kind: 'expense', outlet_id: ahd.id, amount: 48000, entry_date: monthsAgo(back, 5), category_id: E('Outlet rent and utilities'), expense_class: 'operating', party_name: 'Landlord, Navrangpura' });
    await add({ kind: 'expense', amount: 60000, entry_date: monthsAgo(back, 18), category_id: E('Licences and compliance'), expense_class: 'operating', party_name: 'Compliance consultant' });
  }
  const plan = async (month, line, amount, name, extra = {}) => { const r = await projections.create(O, A, { name, month, line, amount, status: 'approved', ...extra }); if (r.error) throw new Error(`projection ${name}: ${r.error}`); };
  for (let k = -2; k <= 8; k += 1) {
    const m = monthsAgo(-k, 1).slice(0, 7);
    await plan(m, 'sales_revenue', 600000 + k * 25000, `Sales plan ${m}`);
    await plan(m, 'cost_of_goods', 380000 + k * 15000, `Cost of goods plan ${m}`);
    await plan(m, 'logistics_cost', 18000, `Logistics plan ${m}`);
    await plan(m, 'franchise_income', 30000, `Franchise income plan ${m}`);
    await plan(m, 'salary', 110000, `Salary plan ${m}`);
    await plan(m, 'operating_expense', 150000, `Operating expense plan ${m}`);
  }
  await plan(monthsAhead(3, 1).slice(0, 7), 'new_investment', 1200000, 'Pune outlet opening', { status: 'draft' });
  const ledger = await prisma.nxStockLedger.count({ where: { org_id: O } });
  void stock;
  console.log(`  + demo company: 4 outlets (company-owned, franchise, third-party), 5 locations, 6 products with batches, purchase, receipts, transfers, 3 customer orders with shipments and invoices, a return, a franchise agreement and royalty, books and projections (${ledger} stock ledger rows)`);
  console.log(`    logins (password ${PASSWORD}): ${LOGINS.map((l) => l.email).join(', ')}`);
}

(async () => {
  if (!process.env.NOVAREX_ADMIN_EMAIL) process.env.NOVAREX_ADMIN_EMAIL = 'admin@novarex.in';
  if (!process.env.NOVAREX_ADMIN_PASSWORD) process.env.NOVAREX_ADMIN_PASSWORD = PASSWORD;
  const { org, admins } = await run();
  if (process.env.NOVAREX_NO_DEMO !== '1') await demo(org, admins[0]);
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
