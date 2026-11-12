const ExcelJS = require('exceljs');
const { app, prisma, request, cleanDatabase, createUser, loginAs, authed, unique } = require('./helpers');

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

const get = (path, token = adminToken) => authed(request(app).get(`/api/v1${path}`), token);
const mkAccount = (over = {}) => prisma.account.create({ data: { org_id: org.id, type: 'client', name: unique('Acct '), stage: 'active', owner_id: admin.id, origin_owner_id: admin.id, ...over } });
// fake bank values only
const BANK = { vendor_bank_holder: 'Fake Holder Pvt Ltd', vendor_bank_name: 'Fake Bank', vendor_bank_account_number: '000011112222', vendor_bank_ifsc: 'FAKE0001234' };
const invoice = (project, vendor, over = {}) => prisma.projectVendorInvoice.create({ data: { org_id: org.id, account_id: project.id, vendor_account_id: vendor.id, period_month: 8, period_year: 2026, invoice_number: unique('VINV-'), amount: 10000, currency: 'INR', created_by: admin.id, ...over } });
const payout = (extra = '') => get(`/billing/vendor-invoices/payout?period_month=8&period_year=2026&format=json${extra}`);

describe('GET /billing/vendor-invoices/payout', () => {
  test('adds up net payable per vendor, only unpaid invoices, flags missing bank details, month total', async () => {
    const project = await mkAccount({ name: 'Proj', is_project: true });
    const a = await mkAccount({ type: 'vendor', name: 'Vendor A', ...BANK });
    const b = await mkAccount({ type: 'vendor', name: 'Vendor B' }); // no bank details
    const c = await mkAccount({ type: 'vendor', name: 'Vendor C', ...BANK }); // fully paid
    await invoice(project, a, { amount: 10000, tds_amount: 1000, adjustment_amount: -500 }); // net 8500
    await invoice(project, a, { amount: 5000 }); // net 5000
    await invoice(project, b, { amount: 7000 });
    await invoice(project, c, { amount: 9000 });
    await invoice(project, a, { amount: 3000, period_month: 9 }); // another month
    await prisma.vendorPayment.create({ data: { org_id: org.id, vendor_name: 'Vendor C', vendor_type: 'contractor', vendor_account_id: c.id, amount: 9000, currency: 'INR', period_month: 8, period_year: 2026, status: 'paid', paid_at: new Date(), created_by: admin.id } });

    const res = await payout();
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.rows.map((r) => [r.vendor, r.invoices, r.amount, r.bank_missing])).toEqual([['Vendor A', 2, 13500, false], ['Vendor B', 1, 7000, true]]);
    expect(d.rows[0]).toMatchObject({ bank_account_number: '000011112222', bank_ifsc: 'FAKE0001234', account_holder: 'Fake Holder Pvt Ltd', bank_name: 'Fake Bank' });
    expect(d.totals).toEqual([{ currency: 'INR', amount: 20500 }]);
    expect(d.excel_totals).toEqual([{ currency: 'INR', amount: 13500 }]);
    expect(d.bank_missing_count).toBe(1);
  });

  test('marking the vendor paid removes it; "sent only" narrows to invoices marked sent', async () => {
    const project = await mkAccount({ name: 'Proj', is_project: true });
    const a = await mkAccount({ type: 'vendor', name: 'Vendor A', ...BANK });
    await invoice(project, a, { amount: 4000, sent_at: new Date() });
    await invoice(project, a, { amount: 6000 });
    expect((await payout()).body.data.rows[0]).toMatchObject({ invoices: 2, amount: 10000 });
    expect((await payout('&sent_only=true')).body.data.rows[0]).toMatchObject({ invoices: 1, amount: 4000 });
    await prisma.vendorPayment.create({ data: { org_id: org.id, vendor_name: 'Vendor A', vendor_type: 'contractor', vendor_account_id: a.id, amount: 10000, currency: 'INR', period_month: 8, period_year: 2026, status: 'paid', paid_at: new Date(), created_by: admin.id } });
    expect((await payout()).body.data.rows).toEqual([]);
  });

  test('the Excel matches the screen: vendors with bank details only, a total, and a sheet of the left-out vendors', async () => {
    const project = await mkAccount({ name: 'Proj', is_project: true });
    const a = await mkAccount({ type: 'vendor', name: 'Vendor A', ...BANK });
    const b = await mkAccount({ type: 'vendor', name: 'Vendor B' });
    await invoice(project, a, { amount: 10000, tds_amount: 1000 });
    await invoice(project, b, { amount: 7000 });
    const res = await get('/billing/vendor-invoices/payout?period_month=8&period_year=2026').buffer(true).parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const sheet = wb.getWorksheet('Vendor payout');
    const rows = [];
    sheet.eachRow((row) => rows.push(row.values.slice(1)));
    expect(rows[1]).toEqual(['Vendor', 'Account Holder', 'Bank', 'Account Number', 'IFSC Code', 'Invoices', 'Amount', 'Currency']);
    expect(rows[2]).toEqual(['Vendor A', 'Fake Holder Pvt Ltd', 'Fake Bank', '000011112222', 'FAKE0001234', 1, 9000, 'INR']);
    expect(rows[3][0]).toBe('Total (INR)');
    expect(rows[3][6]).toBe(9000);
    expect(rows).toHaveLength(4); // Vendor B is not in the bank sheet
    const missing = wb.getWorksheet('Missing bank details');
    expect(missing).toBeTruthy();
    const names = [];
    missing.eachRow((row) => names.push(row.values[1]));
    expect(names).toContain('Vendor B');
  });

  test('bad input and non-finance users are refused', async () => {
    expect((await get('/billing/vendor-invoices/payout?period_month=13&period_year=2026&format=json')).status).toBe(422);
    expect((await request(app).get('/api/v1/billing/vendor-invoices/payout?period_month=8&period_year=2026&format=json')).status).toBe(401);
    const recruiter = await createUser({ role: 'recruiter' });
    const { access_token } = await loginAs(recruiter);
    expect((await get('/billing/vendor-invoices/payout?period_month=8&period_year=2026&format=json', access_token)).status).toBe(403);
  });
});
