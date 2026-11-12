/**
 * Group Dashboard > GST & TDS: invoice-wise base / GST / TDS, the TDS receivable (refunds recorded against invoices), GST payable by month and
 * quarter, and the TDS withheld from vendors. Group superadmin only.
 */
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

let alpha;
let group;
let superUser;
let superToken;
let adminToken;
let client;
let vendor;
let project;
const base = '/api/v1/group-tax';
const RANGE = { from: '2026-09', to: '2026-10' };

beforeEach(async () => {
  await cleanDatabase();
  alpha = await createOrg({ name: 'Delphic Global' });
  group = { id: alpha.org_group_id };
  superUser = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: superUser.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: superUser.id, org_group_id: group.id } });
  await createOrgMembership(superUser.id, alpha.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(superUser));
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, alpha.id, { role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  client = await prisma.account.create({ data: { org_id: alpha.id, type: 'client', name: 'Ginnar Tech', stage: 'active', owner_id: superUser.id, origin_owner_id: superUser.id } });
  vendor = await prisma.account.create({ data: { org_id: alpha.id, type: 'vendor', name: 'EkamNext', stage: 'active', owner_id: superUser.id, origin_owner_id: superUser.id } });
  project = await prisma.account.create({ data: { org_id: alpha.id, type: 'client', name: 'Ginnar Project', project_name: 'Ginnar Project', stage: 'active', owner_id: superUser.id, origin_owner_id: superUser.id } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const get = (path, query = {}, token = superToken) => authed(request(app).get(`${base}${path}`), token).query(query);
const post = (path, body, token = superToken) => authed(request(app).post(`${base}${path}`), token).send(body);
const del = (path, token = superToken) => authed(request(app).delete(`${base}${path}`), token);
// A challan is posted as a form (the challan file can come with it).
const challan = (fields, file, token = superToken) => {
  const r = authed(request(app).post(`${base}/challans`), token);
  for (const [k, v] of Object.entries(fields)) r.field(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (file) r.attach('file', file.buffer, file.name);
  return r;
};

// The worked example of the brief: 15,00,000 + GST 18% (2,70,000) - TDS 10% (1,50,000) = 16,20,000.
async function clientInvoice({ number, date, base: baseAmount, currency = 'INR', charges = [], status = 'sent', paid = 0 }) {
  const total = charges.reduce((s, c) => s + c.amount, baseAmount);
  const row = await prisma.clientInvoice.create({
    data: {
      org_id: alpha.id, client_account_id: client.id, period_month: 9, period_year: 2026, amount: baseAmount, currency, status, invoice_number: number, invoice_date: new Date(date), created_by: superUser.id,
      line_items: { project: { name: 'Ginnar Project', client_name: 'Ginnar Tech' }, details: { subtotal: baseAmount, charges, total_amount: total } },
    },
  });
  if (paid) await prisma.paymentRecord.create({ data: { org_id: alpha.id, kind: 'client_invoice', reference_id: row.id, direction: 'in', paid_on: new Date(date), amount: paid, currency, inr_amount: paid } });
  return row;
}
const GST18 = (b) => ({ label: 'GST 18%', mode: 'percent', value: 18, effect: 'add', amount: b * 0.18 });
const TDS10 = (b) => ({ label: 'TDS 10%', mode: 'percent', value: 10, effect: 'deduct', amount: -b * 0.1 });

async function seedInvoices() {
  const a = await clientInvoice({ number: 'INV-A', date: '2026-09-10', base: 1500000, charges: [GST18(1500000), TDS10(1500000)], status: 'paid', paid: 1620000 });
  const usd = await clientInvoice({ number: 'INV-USD', date: '2026-09-20', base: 10000, currency: 'USD', status: 'paid', paid: 10000 });
  const c = await clientInvoice({ number: 'INV-C', date: '2026-10-05', base: 100000, charges: [GST18(100000), TDS10(100000)], status: 'sent' });
  const draft = await clientInvoice({ number: 'INV-D', date: '2026-10-06', base: 999, status: 'draft' });
  const entity = await prisma.legalEntity.create({ data: { org_group_id: group.id, workspace_id: alpha.id, name: 'Delphic Global Pvt Ltd' } });
  await prisma.groupInvoice.create({
    data: {
      org_group_id: group.id, legal_entity_id: entity.id, series: 'GI', seq: 1, number: 'GI-1', type: 'gst', invoice_date: new Date('2026-10-12'), currency: 'INR', seller: {}, buyer_name: 'Buyer Ltd', lines: [],
      subtotal: 100000, cgst: 9000, sgst: 9000, igst: 0, total: 118000, receiving_wallet_id: entity.id,
    },
  });
  return { a, usd, c, draft };
}

describe('GST & TDS tracking', () => {
  test('invoice-wise base / GST / TDS / payable / paid, totals per currency, no GST / TDS on a foreign-currency invoice, drafts left out', async () => {
    await seedInvoices();
    const res = await get('/invoices', RANGE);
    expect(res.status).toBe(200);
    const byNumber = Object.fromEntries(res.body.data.rows.map((r) => [r.number, r]));
    expect(Object.keys(byNumber).sort()).toEqual(['GI-1', 'INV-A', 'INV-C', 'INV-USD']);
    expect(byNumber['INV-A']).toMatchObject({ base: 1500000, gst: 270000, tds: 150000, total: 1620000, paid: 1620000, pending: 0, tax_mode: 'gst_tds', fy: 'FY 2026-27', company: 'Delphic Global', client: 'Ginnar Tech' });
    expect(byNumber['INV-A'].lines).toEqual([{ label: 'GST 18%', kind: 'gst', amount: 270000 }, { label: 'TDS 10%', kind: 'tds', amount: -150000 }]);
    expect(byNumber['INV-C']).toMatchObject({ total: 108000, paid: 0, pending: 108000 });
    expect(byNumber['INV-USD']).toMatchObject({ currency: 'USD', gst: 0, tds: 0, tax_mode: 'none' });
    expect(byNumber['GI-1']).toMatchObject({ kind: 'group_invoice', gst: 18000, tds: 0, total: 118000, company: 'Delphic Global Pvt Ltd' });

    const inr = res.body.data.totals.find((t) => t.currency === 'INR');
    expect(inr).toMatchObject({ invoices: 3, base: 1700000, gst: 306000, tds: 160000, total: 1846000, paid: 1620000, pending: 226000 });
    expect(res.body.data.totals.find((t) => t.currency === 'USD')).toMatchObject({ invoices: 1, base: 10000, no_tax_invoices: 1 });
    // a narrower range, a currency and a company filter
    expect((await get('/invoices', { from: '2026-10', to: '2026-10' })).body.data.rows.map((r) => r.number).sort()).toEqual(['GI-1', 'INV-C']);
    expect((await get('/invoices', { ...RANGE, currency: 'USD' })).body.data.rows).toHaveLength(1);
  });

  test('a combined invoice adds up the GST / TDS of its contracts; the adjustment is taken off the base first and GST / TDS follow; the billing period is returned beside the date', async () => {
    const item = (name, gross, adj, gst, tds) => {
      const sub = gross + adj;
      return { account_id: client.id, project: { name, client_name: 'Ginnar Tech' }, details: { base_amount: gross, adjustment_amount: adj, subtotal: sub, amount: sub, total_amount: sub + gst - tds, charges: [{ label: 'GST', mode: 'percent', value: 18, effect: 'add', amount: gst }, { label: 'TDS', mode: 'percent', value: 10, effect: 'deduct', amount: -tds }] } };
    };
    // 1,60,000 - 20,000 adjustment = 1,40,000 -> GST 25,200, TDS 14,000, payable 1,51,200; and 1,00,000 with no adjustment -> 18,000 / 10,000 / 1,08,000
    const items = [item('CloudNova', 160000, -20000, 25200, 14000), item('Five Nine', 100000, 0, 18000, 10000)];
    await prisma.clientInvoice.create({
      data: {
        org_id: alpha.id, client_account_id: client.id, period_month: 10, period_year: 2026, amount: 259200, currency: 'INR', status: 'sent', invoice_number: 'DELG-COMBINED', invoice_date: new Date('2026-11-06'), created_by: superUser.id,
        line_items: { consolidated: true, project: { name: '2 contracts - Ginnar Tech', client_name: 'Ginnar Tech' }, details: { billing_type: 'consolidated', amount: 259200, subtotal: 259200, total_amount: 259200, charges: [], contracts: 2 }, items },
      },
    });
    const res = await get('/invoices', { from: '2026-11', to: '2026-11' });
    const row = res.body.data.rows.find((r) => r.number === 'DELG-COMBINED');
    expect(row).toMatchObject({ gross_base: 260000, adjustment: -20000, base: 240000, gst: 43200, tds: 24000, total: 259200, tax_mode: 'gst_tds', contracts: 2, billing_month: 10, billing_year: 2026, period_month: 11 });
    expect(row.lines).toHaveLength(4);
    // a single-project invoice carries its adjustment too
    const single = await prisma.clientInvoice.create({
      data: {
        org_id: alpha.id, client_account_id: client.id, period_month: 9, period_year: 2026, amount: 156818, currency: 'INR', status: 'paid', invoice_number: 'INV-ADJ', invoice_date: new Date('2026-11-05'), created_by: superUser.id,
        line_items: { project: { name: 'Ugap', client_name: 'Ginnar Tech' }, details: { base_amount: 150000, adjustment_amount: 6818, subtotal: 156818, total_amount: 169363.44, charges: [GST18(156818), TDS10(156818)] } },
      },
    });
    const one = (await get('/invoices', { from: '2026-11', to: '2026-11' })).body.data.rows.find((r) => r.id === single.id);
    expect(one).toMatchObject({ gross_base: 150000, adjustment: 6818, base: 156818, billing_month: 9, period_month: 11 });
  });

  test('TDS receivable: TDS is deducted when the client pays; a refund is recorded against the invoice, can be removed, and cannot exceed the TDS', async () => {
    const { a, c } = await seedInvoices();
    let res = (await get('/tds-receivable', RANGE)).body.data;
    expect(res.items.map((i) => i.number).sort()).toEqual(['INV-A', 'INV-C']);
    expect(res.items.find((i) => i.number === 'INV-A')).toMatchObject({ tds_expected: 150000, tds_deducted: 150000, received: 0, outstanding: 150000, status: 'receivable', fy: 'FY 2026-27' });
    expect(res.items.find((i) => i.number === 'INV-C')).toMatchObject({ tds_deducted: 0, tds_yet_to_deduct: 10000, outstanding: 0, status: 'not_deducted' });
    expect(res.totals[0]).toMatchObject({ currency: 'INR', expected: 160000, deducted: 150000, yet_to_deduct: 10000, received: 0, outstanding: 150000 });

    const refund = await post('/tds-receipts', { invoice_kind: 'client_invoice', invoice_id: a.id, amount: 50000, received_on: '2028-03-01', reference: 'Refund order 1' });
    expect(refund.status).toBe(201);
    res = (await get('/tds-receivable', RANGE)).body.data;
    expect(res.items.find((i) => i.number === 'INV-A')).toMatchObject({ received: 50000, outstanding: 100000, status: 'part_received', receipts: [expect.objectContaining({ amount: 50000, reference: 'Refund order 1' })] });
    expect(res.totals[0]).toMatchObject({ received: 50000, outstanding: 100000 });
    expect(res.by_fy[0]).toMatchObject({ fy: 'FY 2026-27', deducted: 150000, received: 50000, outstanding: 100000 });

    // more than the TDS deducted on the invoice is refused; an invoice without TDS too
    expect((await post('/tds-receipts', { invoice_kind: 'client_invoice', invoice_id: a.id, amount: 100001, received_on: '2028-03-02' })).status).toBe(422);
    const usd = await prisma.clientInvoice.findFirst({ where: { invoice_number: 'INV-USD' } });
    expect((await post('/tds-receipts', { invoice_kind: 'client_invoice', invoice_id: usd.id, amount: 1, received_on: '2028-03-02' })).status).toBe(422);

    // the rest, then the whole invoice reads as received; removing a refund brings the outstanding back
    const rest = await post('/tds-receipts', { invoice_kind: 'client_invoice', invoice_id: a.id, amount: 100000, received_on: '2028-04-01' });
    expect((await get('/tds-receivable', RANGE)).body.data.items.find((i) => i.number === 'INV-A').status).toBe('received');
    expect((await del(`/tds-receipts/${rest.body.data.id}`)).status).toBe(200);
    expect((await get('/tds-receivable', RANGE)).body.data.items.find((i) => i.number === 'INV-A')).toMatchObject({ received: 50000, outstanding: 100000 });
    expect(await prisma.auditLog.count({ where: { entity_type: 'group_tax' } })).toBe(3);
    // part payment of an invoice deducts the TDS in proportion
    await prisma.paymentRecord.create({ data: { org_id: alpha.id, kind: 'client_invoice', reference_id: c.id, direction: 'in', paid_on: new Date('2026-10-20'), amount: 54000, currency: 'INR', inr_amount: 54000 } });
    expect((await get('/tds-receivable', RANGE)).body.data.items.find((i) => i.number === 'INV-C')).toMatchObject({ tds_deducted: 5000, tds_yet_to_deduct: 5000, outstanding: 5000, status: 'receivable' });
  });

  test('GST payable by month and by quarter, with payments and credits recorded against a period and the balance carried forward', async () => {
    await seedInvoices();
    let res = (await get('/gst', { ...RANGE, by: 'month' })).body.data;
    const sep = res.periods.find((p) => p.label === 'Sep 2026');
    const oct = res.periods.find((p) => p.label === 'Oct 2026');
    expect(sep).toMatchObject({ collected: 270000, paid: 0, payable: 270000, balance: 270000 });
    expect(oct).toMatchObject({ collected: 36000, payable: 36000, balance: 306000 }); // INV-C 18,000 + the Book Keeping invoice 18,000
    expect(oct.invoices.map((i) => i.number).sort()).toEqual(['GI-1', 'INV-C']);
    expect(res.totals).toMatchObject({ collected: 306000, paid: 0, balance: 306000 });

    // GST paid for September (with its challan), and an input credit against October
    expect((await challan({ kind: 'gst', period_month: 9, period_year: 2026, amount: 270000, paid_on: '2026-10-20', challan_number: 'CRN2610200001' })).status).toBe(201);
    expect((await challan({ kind: 'gst_credit', period_month: 10, period_year: 2026, amount: 6000, paid_on: '2026-11-20', note: 'Input tax credit' })).status).toBe(201);
    res = (await get('/gst', { ...RANGE, by: 'month' })).body.data;
    expect(res.periods.find((p) => p.label === 'Sep 2026')).toMatchObject({ paid: 270000, payable: 0, balance: 0, payments: [expect.objectContaining({ challan_number: 'CRN2610200001', kind: 'payment' })] });
    expect(res.periods.find((p) => p.label === 'Oct 2026')).toMatchObject({ credits: 6000, payable: 30000, balance: 30000 });
    expect(res.totals).toMatchObject({ collected: 306000, paid: 270000, credits: 6000, balance: 30000 });

    // quarters: Apr-Jun Q1 ... Oct-Dec is Q3 of FY 2026-27
    const q = (await get('/gst', { ...RANGE, by: 'quarter' })).body.data;
    expect(q.periods.map((p) => p.label)).toEqual(['Q3 FY 2026-27 (Oct-Dec)', 'Q2 FY 2026-27 (Jul-Sep)']);
    expect(q.periods[1]).toMatchObject({ collected: 270000, paid: 270000, payable: 0 });
    expect(q.periods[0]).toMatchObject({ collected: 36000, credits: 6000, balance: 30000 });
    // a quarterly filing: one payment covering the quarter ending in December
    const quarterly = await challan({ kind: 'gst', period_month: 12, period_year: 2026, covers_months: 3, amount: 30000, paid_on: '2027-01-18' });
    expect(quarterly.status).toBe(201);
    expect((await challan({ kind: 'gst', period_month: 12, period_year: 2026, covers_months: 2, amount: 1, paid_on: '2027-01-18' })).status).toBe(422);
    expect((await del(`/challans/${quarterly.body.data.id}`)).status).toBe(200);
  });

  test('TDS withheld from vendors and from salaries, deposits recorded as challans, what is still to deposit', async () => {
    await prisma.projectVendorInvoice.create({ data: { org_id: alpha.id, account_id: project.id, vendor_account_id: vendor.id, period_month: 10, period_year: 2026, invoice_number: 'EKAM-1', amount: 200000, currency: 'INR', tds_amount: 20000, adjustment_amount: 36000, created_by: superUser.id } });
    await prisma.projectVendorInvoice.create({ data: { org_id: alpha.id, account_id: project.id, vendor_account_id: vendor.id, period_month: 10, period_year: 2026, invoice_number: 'NOTDS', amount: 5000, currency: 'INR', created_by: superUser.id } });
    const emp = await createUser({ role: 'employee', name: 'Salary Person', withOrg: false });
    const membership = await createOrgMembership(emp.id, alpha.id, { role: 'employee', employee_code: 'E-77' });
    await prisma.salaryAdjustment.create({ data: { org_id: alpha.id, org_membership_id: membership.id, period_month: 10, period_year: 2026, kind: 'tds', amount: 4000, created_by: superUser.id } });

    let res = (await get('/tds-payable', RANGE)).body.data;
    expect(res.rows).toHaveLength(1);
    // base 2,00,000 + GST (entered as the adjustment) 36,000 - TDS 20,000 = 2,16,000
    expect(res.rows[0]).toMatchObject({ vendor: 'EkamNext', number: 'EKAM-1', base: 200000, tds: 20000, adjustment: 36000, net_payable: 216000, company: 'Delphic Global' });
    expect(res.inr).toMatchObject({ withheld: 20000, deposited: 0, to_deposit: 20000 });
    expect(res.employee_rows).toEqual([expect.objectContaining({ employee: 'Salary Person', employee_code: 'E-77', tds: 4000, company: 'Delphic Global' })]);
    expect(res.employees).toMatchObject({ withheld: 4000, deposited: 0, to_deposit: 4000 });

    // one TDS challan for a vendor, one for an employee; each only counts against its own kind
    const dep = await challan({ kind: 'tds_vendor', period_month: 10, period_year: 2026, amount: 5000, paid_on: '2026-11-07', challan_number: 'CHN-281', bsr_code: '0510308', parties: [{ kind: 'vendor', id: vendor.id, amount: 5000 }] });
    expect(dep.status).toBe(201);
    await challan({ kind: 'tds_salary', period_month: 10, period_year: 2026, amount: 4000, paid_on: '2026-11-07', challan_number: 'CHN-192', parties: [{ kind: 'employee', id: membership.id }] });
    res = (await get('/tds-payable', RANGE)).body.data;
    expect(res.inr).toMatchObject({ deposited: 5000, to_deposit: 15000 });
    expect(res.employees).toMatchObject({ deposited: 4000, to_deposit: 0 });
    expect(res.deposits.find((d) => d.challan_number === 'CHN-281')).toMatchObject({ amount: 5000, kind: 'tds_vendor', bsr_code: '0510308', parties: [{ kind: 'vendor', label: 'EkamNext', amount: 5000 }] });
    await del(`/challans/${dep.body.data.id}`);
    expect((await get('/tds-payable', RANGE)).body.data.inr.to_deposit).toBe(20000);
  });

  test('challans: number, bank, period, covered employees / vendors, the uploaded challan, edit, remove, filters and the audit trail', async () => {
    const emp = await createUser({ role: 'employee', name: 'Covered Employee', withOrg: false });
    const membership = await createOrgMembership(emp.id, alpha.id, { role: 'employee' });
    // who a challan can cover
    const who = (await get('/parties')).body.data;
    expect(who.employees.map((e) => e.label)).toContain('Covered Employee');
    expect(who.vendors.map((v) => v.label)).toEqual(['EkamNext']);

    const pdf = { buffer: Buffer.from('%PDF-1.4 challan'), name: 'challan-281.pdf' };
    const made = await challan({ kind: 'tds_salary', challan_number: 'CIN-0001', bsr_code: '6390340', bank: 'HDFC Bank', period_month: 10, period_year: 2026, amount: 800000, paid_on: '2026-11-06', org_id: alpha.id, note: 'Salary TDS Oct', parties: [{ kind: 'employee', id: membership.id, amount: 5000 }, { kind: 'vendor', id: vendor.id }] }, pdf);
    expect(made.status).toBe(201);
    const id = made.body.data.id;

    let list = (await get('/challans', { from: '2026-11', to: '2026-11' })).body.data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'tds_salary', kind_label: 'TDS on salaries (employees)', challan_number: 'CIN-0001', bsr_code: '6390340', bank: 'HDFC Bank', amount: 800000, company: 'Delphic Global', has_file: true, file_name: 'challan-281.pdf', fy: 'FY 2026-27' });
    expect(list.items[0].parties).toEqual([{ kind: 'employee', id: membership.id, label: 'Covered Employee', amount: 5000 }, { kind: 'vendor', id: vendor.id, label: 'EkamNext' }]);
    expect(list.totals).toEqual([{ kind: 'tds_salary', label: 'TDS on salaries (employees)', challans: 1, amount: 800000 }]);
    expect(list.kinds.map((k) => k.value)).toEqual(expect.arrayContaining(['gst', 'tds_salary', 'tds_vendor', 'advance_tax', 'pf', 'esi', 'pt', 'other']));
    expect((await get('/challans', { kind: 'gst' })).body.data.items).toHaveLength(0);
    expect((await get('/challans', { from: '2026-12', to: '2026-12' })).body.data.items).toHaveLength(0);

    // the uploaded challan comes back to the superadmin only
    const file = await authed(request(app).get(`${base}/challans/${id}/file`), superToken).buffer(true).parse((r, cb) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(file.status).toBe(200);
    expect(file.body.toString()).toBe('%PDF-1.4 challan');
    expect(file.headers['content-disposition']).toContain('challan-281.pdf');
    expect((await authed(request(app).get(`${base}/challans/${id}/file`), adminToken)).status).toBe(403);

    // wrong file type, a party outside the group and a bad kind are refused
    expect((await challan({ kind: 'gst', period_month: 10, period_year: 2026, amount: 1, paid_on: '2026-11-06' }, { buffer: Buffer.from('x'), name: 'run.exe' })).status).toBe(422);
    expect((await challan({ kind: 'gst', period_month: 10, period_year: 2026, amount: 1, paid_on: '2026-11-06', parties: [{ kind: 'vendor', id: '11111111-1111-4111-8111-111111111111' }] })).status).toBe(422);
    expect((await challan({ kind: 'lottery', period_month: 10, period_year: 2026, amount: 1, paid_on: '2026-11-06' })).status).toBe(422);

    // edit the number and the amount, then remove it with a reason; a challan with no file has no download
    const edit = await authed(request(app).patch(`${base}/challans/${id}`), superToken).field('challan_number', 'CIN-0002').field('amount', '810000');
    expect(edit.status).toBe(200);
    list = (await get('/challans')).body.data;
    expect(list.items[0]).toMatchObject({ challan_number: 'CIN-0002', amount: 810000, has_file: true });
    const noFile = await challan({ kind: 'pf', period_month: 10, period_year: 2026, amount: 5000, paid_on: '2026-11-15' });
    expect((await authed(request(app).get(`${base}/challans/${noFile.body.data.id}/file`), superToken)).status).toBe(404);
    expect((await del(`/challans/${id}`)).status).toBe(200);
    expect((await get('/challans')).body.data.items.map((c) => c.kind)).toEqual(['pf']);
    expect((await authed(request(app).get(`${base}/challans/${id}/file`), superToken)).status).toBe(404);
    expect((await prisma.auditLog.findMany({ where: { entity_type: 'group_tax' }, select: { action: true } })).map((a) => a.action).sort()).toEqual(['tax_challan_add', 'tax_challan_add', 'tax_challan_edit', 'tax_challan_remove']);
  });

  test('options list the group\'s companies; only the group superadmin can open it', async () => {
    const options = await get('/options');
    expect(options.body.data.companies.map((c) => c.name)).toEqual(['Delphic Global']);
    expect(options.body.data.currencies).toContain('INR');
    expect((await get('/invoices', RANGE, adminToken)).status).toBe(403);
    expect((await challan({ kind: 'gst', period_month: 9, period_year: 2026, amount: 1, paid_on: '2026-10-01' }, null, adminToken)).status).toBe(403);
  });

  test('a vendor invoice billed for September but dated in October: its TDS and GST show for October by invoice date, for September by billing month', async () => {
    await prisma.projectVendorInvoice.create({ data: { org_id: alpha.id, account_id: project.id, vendor_account_id: vendor.id, period_month: 9, period_year: 2026, invoice_date: new Date('2026-10-06'), invoice_number: 'VINV-LATE', amount: 65000, gst_amount: 11700, tds_amount: 6500, currency: 'INR', created_by: superUser.id } });
    const oct = { from: '2026-10', to: '2026-11' };
    const tds = (await get('/tds-payable', oct)).body.data;
    expect(tds.rows).toHaveLength(1);
    expect(tds.rows[0]).toMatchObject({ number: 'VINV-LATE', gst: 11700, tds: 6500 });
    expect((await get('/tds-payable', { ...oct, basis: 'billing' })).body.data.rows).toHaveLength(0);
    expect((await get('/tds-payable', { from: '2026-09', to: '2026-09', basis: 'billing' })).body.data.rows).toHaveLength(1);
    const gst = (await get('/gst', oct)).body.data;
    expect(gst.vendor_gst.total).toBe(11700);
    expect(gst.vendor_gst.rows[0]).toMatchObject({ vendor: 'EkamNext', number: 'VINV-LATE', gst: 11700, base: 65000 });
    expect(gst.totals.vendor_gst).toBe(11700);
    expect((await get('/gst', { ...oct, basis: 'billing' })).body.data.vendor_gst.rows).toHaveLength(0);
  });
});
