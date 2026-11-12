const { app, prisma, request, cleanDatabase, createUser, loginAs, authed, unique } = require('./helpers');
const vendorCharges = require('../src/modules/billing/vendorCharges.service');

let admin;
let adminToken;
let org;

beforeEach(async () => {
  await cleanDatabase();
  admin = await createUser({ role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  org = await prisma.org.findUnique({ where: { slug: 'test-org' } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const call = (method, path, body) => authed(request(app)[method](`/api/v1${path}`).send(body), adminToken);
const mkAccount = (over = {}) => prisma.account.create({ data: { org_id: org.id, type: 'client', name: unique('Acct '), stage: 'active', owner_id: admin.id, origin_owner_id: admin.id, ...over } });

describe('vendor charges (GST / TDS set up like a contract\'s charges)', () => {
  test('chargeAmounts: GST is added, TDS withheld, anything else goes to other', () => {
    const charges = [
      { label: 'GST', mode: 'percent', value: 18, effect: 'add' },
      { label: 'TDS', mode: 'percent', value: 10, effect: 'deduct' },
      { label: 'Handling fee', mode: 'fixed', value: 250, effect: 'add' },
    ];
    const r = vendorCharges.chargeAmounts(10000, charges);
    expect(r).toMatchObject({ gst_amount: 1800, tds_amount: 1000, other_amount: 250 });
    expect(r.lines.map((l) => [l.label, l.amount, l.tax_kind])).toEqual([['GST', 1800, 'gst'], ['TDS', -1000, 'tds'], ['Handling fee', 250, 'other']]);
    expect(vendorCharges.chargeAmounts(10000, [])).toMatchObject({ gst_amount: 0, tds_amount: 0, other_amount: 0, lines: [] });
  });

  test('a vendor\'s charges are added, edited and deleted one by one', async () => {
    const vendor = await mkAccount({ type: 'vendor', name: 'Vendor A' });
    const add = await call('post', `/billing/vendors/${vendor.id}/charges`, { label: 'GST', mode: 'percent', value: 18, effect: 'add' });
    expect(add.status).toBe(201);
    const id = add.body.data.id;
    expect((await call('post', `/billing/vendors/${vendor.id}/charges`, { label: 'TDS', mode: 'percent', value: 10, effect: 'deduct' })).status).toBe(201);
    expect((await call('post', `/billing/vendors/${vendor.id}/charges`, { label: 'Too much', mode: 'percent', value: 150, effect: 'add' })).status).toBe(422);
    expect((await call('get', `/billing/vendors/${vendor.id}/charges`)).body.data.map((c) => [c.label, c.value, c.effect])).toEqual([['GST', 18, 'add'], ['TDS', 10, 'deduct']]);

    const edit = await call('patch', `/billing/vendor-charges/${id}`, { value: 12 });
    expect(edit.status).toBe(200);
    expect(edit.body.data.value).toBe(12);
    expect((await call('delete', `/billing/vendor-charges/${id}`)).status).toBe(200);
    expect((await call('get', `/billing/vendors/${vendor.id}/charges`)).body.data).toHaveLength(1);
    // only a vendor can carry vendor charges
    const client = await mkAccount({ name: 'Plain client' });
    expect((await call('post', `/billing/vendors/${client.id}/charges`, { label: 'GST', mode: 'percent', value: 18, effect: 'add' })).status).toBe(404);
  });

  test('GST adds to the vendor invoice payable, TDS and adjustment come off', async () => {
    const project = await mkAccount({ name: 'Proj', is_project: true });
    const vendor = await mkAccount({ type: 'vendor', name: 'Vendor A' });
    const inv = await prisma.projectVendorInvoice.create({
      data: { org_id: org.id, account_id: project.id, vendor_account_id: vendor.id, period_month: 8, period_year: 2026, invoice_number: unique('VINV-'), amount: 10000, gst_amount: 1800, tds_amount: 1000, adjustment_amount: -500, currency: 'INR', details: { project: { name: 'Proj' } }, created_by: admin.id },
    });
    const list = await call('get', '/billing/vendor-invoices?period_month=8&period_year=2026');
    const row = list.body.data.find((r) => r.id === inv.id);
    expect(row).toMatchObject({ amount: 10000, gst_amount: 1800, tds_amount: 1000, net_payable: 10300 });
    // tracking edit: GST can be corrected by hand and the payable follows
    const track = await call('patch', `/billing/vendor-invoices/${inv.id}/tracking`, { gst_amount: 900 });
    expect(track.status).toBe(200);
    expect(track.body.data).toMatchObject({ gst_amount: 900, net_payable: 9400 });
  });
});
