const { app, prisma, request, cleanDatabase, createUser, loginAs, authed, unique } = require('./helpers');
const records = require('../src/modules/calculations/records.service');

let admin;
let adminToken;
let org;
let vendor;
let category;

beforeEach(async () => {
  await cleanDatabase();
  admin = await createUser({ role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  org = await prisma.org.findUnique({ where: { slug: 'test-org' } });
  vendor = await prisma.account.create({ data: { org_id: org.id, type: 'vendor', name: unique('Vendor '), stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
  category = await prisma.financeCategory.create({ data: { org_id: org.id, kind: 'group_charge', name: 'Software subscriptions' } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const api = (p) => `/api/v1/billing${p}`;
const post = (p, body, token = adminToken) => authed(request(app).post(api(p)), token).send(body);
const patch = (p, body, token = adminToken) => authed(request(app).patch(api(p)), token).send(body);
const get = (p, token = adminToken) => authed(request(app).get(api(p)), token);
const bill = (over = {}) => ({ vendor_account_id: vendor.id, bill_number: unique('BILL-'), bill_date: '2026-10-12', amount: 10000, gst_amount: 1800, tds_amount: 100, category_id: category.id, description: 'Annual licence', ...over });

describe('normal purchases (Finance > Vendor Invoices)', () => {
  test('adding a purchase books ONE expense row for the bill month and works out the payable', async () => {
    const res = await post('/vendor-purchases', bill({ bill_number: 'INV-77' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: 'purchase', bill_number: 'INV-77', amount: 10000, gst_amount: 1800, tds_amount: 100, net_payable: 11700, status: 'active', paid: false, period_month: 10, period_year: 2026, expense_posted: true, category_name: 'Software subscriptions' });

    const charges = await prisma.groupBillingCharge.findMany({ where: { org_id: org.id } });
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ kind: 'Software subscriptions', period_month: 10, period_year: 2026 });
    expect(Number(charges[0].amount)).toBe(10000); // the cost before GST
    expect(charges[0].notes).toContain('INV-77');

    // The expense reads like any other: Live Analytics > Expenses shows it (and it can be locked there)
    const month = await records.expenseRecords(org.id, { period_month: 10, period_year: 2026 });
    expect(month.records.map((r) => [r.type, r.category, r.amount_inr])).toEqual([['charge', 'Software subscriptions', 10000]]);
    // ... but the Group Charges lists leave it out (it is managed in Vendor Invoices)
    expect((await get('/group-charges?period_month=10&period_year=2026')).body.data).toEqual([]);

    const list = await get('/vendor-purchases?period_month=10&period_year=2026');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ bill_number: 'INV-77', vendor_account: { id: vendor.id } });
    expect((await get('/vendor-purchases?period_month=11&period_year=2026')).body.data).toEqual([]);
  });

  test('the vendor must be a vendor account of this company, and a bill number is used once per vendor', async () => {
    const client = await prisma.account.create({ data: { org_id: org.id, type: 'client', name: unique('Client '), stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
    expect((await post('/vendor-purchases', bill({ vendor_account_id: client.id }))).status).toBe(404);

    const first = await post('/vendor-purchases', bill({ bill_number: 'DUP-1' }));
    expect(first.status).toBe(201);
    expect((await post('/vendor-purchases', bill({ bill_number: 'dup-1' }))).status).toBe(409); // not case sensitive
    // once cancelled, the number is free again
    expect((await post(`/vendor-purchases/${first.body.data.id}/cancel`, { reason: 'entered twice' })).status).toBe(200);
    expect((await post('/vendor-purchases', bill({ bill_number: 'DUP-1' }))).status).toBe(201);
  });

  test('editing the bill updates its expense row, and moving the date moves the expense to that month', async () => {
    const created = (await post('/vendor-purchases', bill())).body.data;
    const res = await patch(`/vendor-purchases/${created.id}`, { amount: 12000, bill_date: '2026-11-03', gst_amount: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ amount: 12000, net_payable: 11900, period_month: 11, period_year: 2026 });
    const charge = await prisma.groupBillingCharge.findFirst({ where: { org_id: org.id } });
    expect(Number(charge.amount)).toBe(12000);
    expect(charge).toMatchObject({ period_month: 11, period_year: 2026 });
    expect(await prisma.groupBillingCharge.count({ where: { org_id: org.id } })).toBe(1);
  });

  test('paid / unpaid is tracked on the purchase and never moves the expense', async () => {
    const created = (await post('/vendor-purchases', bill())).body.data;
    const paid = await post(`/vendor-purchases/${created.id}/pay`, { paid_on: '2026-10-20', payment_mode: 'neft', payment_reference: 'UTR-1' });
    expect(paid.status).toBe(200);
    expect(paid.body.data).toMatchObject({ paid: true, paid_on: '2026-10-20', paid_amount: 11700, payment_mode: 'neft', payment_reference: 'UTR-1' });
    expect(await prisma.groupBillingCharge.count({ where: { org_id: org.id } })).toBe(1);
    // a paid purchase cannot be cancelled until it is marked unpaid
    expect((await post(`/vendor-purchases/${created.id}/cancel`, {})).status).toBe(409);
    const unpaid = await post(`/vendor-purchases/${created.id}/unpay`, {});
    expect(unpaid.body.data).toMatchObject({ paid: false, paid_on: null, paid_amount: null });
  });

  test('cancelling keeps the purchase (with who / why) but removes its expense row; a cancelled one cannot be changed', async () => {
    const created = (await post('/vendor-purchases', bill())).body.data;
    const res = await post(`/vendor-purchases/${created.id}/cancel`, { reason: 'wrong vendor' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'cancelled', cancel_reason: 'wrong vendor', expense_posted: false });
    expect(await prisma.groupBillingCharge.count({ where: { org_id: org.id } })).toBe(0);
    expect(await prisma.vendorPurchase.count({ where: { org_id: org.id } })).toBe(1);
    expect((await patch(`/vendor-purchases/${created.id}`, { amount: 5 })).status).toBe(409);
    expect((await post(`/vendor-purchases/${created.id}/pay`, {})).status).toBe(409);
    const cancelAgain = await post(`/vendor-purchases/${created.id}/cancel`, {});
    expect(cancelAgain.status).toBe(409);
  });

  test('a month whose financials are locked refuses new, changed and cancelled purchases', async () => {
    const created = (await post('/vendor-purchases', bill())).body.data;
    await prisma.financialCalculation.create({ data: { org_id: org.id, kind: 'financials', scope_key: 'org', period_month: 10, period_year: 2026, status: 'locked', current_version: 1, locked_by: admin.id, locked_at: new Date() } });
    expect((await post('/vendor-purchases', bill())).status).toBe(423);
    expect((await patch(`/vendor-purchases/${created.id}`, { amount: 1 })).status).toBe(423);
    expect((await post(`/vendor-purchases/${created.id}/cancel`, {})).status).toBe(423);
    // moving a bill INTO a locked month is refused too
    const other = (await post('/vendor-purchases', bill({ bill_date: '2026-12-02' }))).body.data;
    expect((await patch(`/vendor-purchases/${other.id}`, { bill_date: '2026-10-25' })).status).toBe(423);
    // paying is cash tracking only, so it still works
    expect((await post(`/vendor-purchases/${created.id}/pay`, {})).status).toBe(200);
  });

  test('a category must be an active group-charge category of this company; a bad amount or a missing bill number is refused', async () => {
    const other = await prisma.financeCategory.create({ data: { org_id: org.id, kind: 'expense', name: 'Meals' } });
    expect((await post('/vendor-purchases', bill({ category_id: other.id }))).status).toBe(404);
    expect((await post('/vendor-purchases', bill({ amount: 0 }))).status).toBe(422);
    expect((await post('/vendor-purchases', bill({ bill_number: '' }))).status).toBe(422);
    expect((await post('/vendor-purchases', bill({ category_id: undefined }))).status).toBe(201); // category is optional
  });

  test('only admins can use it', async () => {
    const employee = await createUser({ role: 'employee' });
    const { access_token: token } = await loginAs(employee);
    expect((await get('/vendor-purchases', token)).status).toBe(403);
    expect((await post('/vendor-purchases', bill(), token)).status).toBe(403);
  });
});
