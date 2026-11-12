jest.setTimeout(120000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

// Payment collection: due date, overdue, next follow-up date and the chase notes of an unpaid invoice,
// for client invoices (Finance > Invoicing) and group invoices (Book Keeping).

const G = '/api/v1/group-cash';
const B = '/api/v1/billing';
let org; let superToken; let user; let client; let entity; let wallet;

beforeEach(async () => {
  await cleanDatabase();
  org = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
  user = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: user.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: user.id, org_group_id: org.org_group_id } });
  await createOrgMembership(user.id, org.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(user));
  client = await prisma.account.create({ data: { org_id: org.id, type: 'client', name: 'Ginnar Tech', stage: 'active', owner_id: user.id, origin_owner_id: user.id } });
});
afterAll(async () => { await prisma.$disconnect(); });

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const clientInvoice = (over = {}) => prisma.clientInvoice.create({
  data: { org_id: org.id, client_account_id: client.id, period_month: 10, period_year: 2026, amount: 50000, currency: 'INR', status: 'sent', invoice_number: `INV-${Math.round(Math.random() * 1e6)}`, invoice_date: new Date(), created_by: user.id, line_items: {}, ...over },
});

describe('client invoices', () => {
  test('a sent invoice past its due date is overdue; the follow-up notes and next date are kept', async () => {
    const late = await clientInvoice({ due_date: new Date(day(-10)) });
    const fine = await clientInvoice({ due_date: new Date(day(10)) });
    const paid = await clientInvoice({ due_date: new Date(day(-10)), status: 'paid' });
    const list = (await authed(request(app).get(`${B}/invoices`), superToken)).body.data;
    const by = (id) => list.find((r) => r.id === id);
    expect(by(late.id)).toMatchObject({ overdue: true, days_overdue: 10, followup_count: 0 });
    expect(by(fine.id)).toMatchObject({ overdue: false, days_overdue: 0 });
    expect(by(paid.id).overdue).toBe(false); // paid invoices are never overdue

    const added = await authed(request(app).post(`${B}/invoices/${late.id}/followups`), superToken).send({ note: 'Called accounts, they will pay on Friday', next_followup_date: day(3) });
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({ note: 'Called accounts, they will pay on Friday', next_followup_date: day(3) });
    const after = (await authed(request(app).get(`${B}/invoices`), superToken)).body.data.find((r) => r.id === late.id);
    expect(after).toMatchObject({ followup_count: 1, last_followup_note: 'Called accounts, they will pay on Friday', next_followup_date: day(3), followup_due: false });

    const log = (await authed(request(app).get(`${B}/invoices/${late.id}/followups`), superToken)).body.data;
    expect(log.followups).toHaveLength(1);
    expect(log.followups[0].by).toBeTruthy();

    // the follow-up date has come
    await authed(request(app).patch(`${B}/invoices/${late.id}/collection`), superToken).send({ next_followup_date: day(-1) });
    expect((await authed(request(app).get(`${B}/invoices`), superToken)).body.data.find((r) => r.id === late.id).followup_due).toBe(true);

    // due date can be set later and cleared
    const set = await authed(request(app).patch(`${B}/invoices/${fine.id}/collection`), superToken).send({ due_date: day(-2) });
    expect(set.status).toBe(200);
    expect((await authed(request(app).get(`${B}/invoices`), superToken)).body.data.find((r) => r.id === fine.id).overdue).toBe(true);
    await authed(request(app).patch(`${B}/invoices/${fine.id}/collection`), superToken).send({ due_date: null });
    expect((await authed(request(app).get(`${B}/invoices`), superToken)).body.data.find((r) => r.id === fine.id).overdue).toBe(false);
  });

  test('a note is required, and another company\'s invoice is not found', async () => {
    const inv = await clientInvoice({});
    expect((await authed(request(app).post(`${B}/invoices/${inv.id}/followups`), superToken).send({ note: '   ' })).status).toBe(422);
    const other = await createOrg({ name: 'Other Co', slug: 'other' });
    const foreignClient = await prisma.account.create({ data: { org_id: other.id, type: 'client', name: 'X', stage: 'active', owner_id: user.id, origin_owner_id: user.id } });
    const foreign = await prisma.clientInvoice.create({ data: { org_id: other.id, client_account_id: foreignClient.id, period_month: 10, period_year: 2026, amount: 1, currency: 'INR', status: 'sent', invoice_number: 'F-1', created_by: user.id, line_items: {} } });
    expect((await authed(request(app).post(`${B}/invoices/${foreign.id}/followups`), superToken).send({ note: 'hello' })).status).toBe(404);
    expect((await authed(request(app).patch(`${B}/invoices/${foreign.id}/collection`), superToken).send({ due_date: day(1) })).status).toBe(404);
  });
});

describe('group invoices (Book Keeping)', () => {
  test('follow-ups and the next date show on the invoice list', async () => {
    const post = (path, body) => authed(request(app).post(`${G}${path}`), superToken).send(body);
    entity = (await post('/entities', { name: 'Delphic Global', workspace_id: org.id, invoice_prefix: 'dg', gstin: '23AABCD1234E1Z5', pan: 'AABCD1234E', state_code: '23', address: 'Indore, MP' })).body.data.entity;
    const acc = (await post('/accounts', { legal_entity_id: entity.id, name: 'HDFC', type: 'current', currency: 'INR', opening_date: '2026-04-01' })).body.data.account;
    wallet = (await post('/wallets', { bank_account_id: acc.id, owner_org_id: org.id, name: 'Delphic INR' })).body.data.wallet;
    const inv = (await post('/invoices', { legal_entity_id: entity.id, type: 'gst', invoice_date: day(-30), due_date: day(-5), buyer_name: 'Acme Pvt Ltd', buyer_gstin: '23AAACA1234A1Z5', buyer_state_code: '23', lines: [{ description: 'Services', hsn_sac: '998313', qty: '1', rate: '10000', gst_rate: 18 }], receiving_wallet_id: wallet.id })).body.data.invoice || null;
    const id = inv?.id || (await authed(request(app).get(`${G}/invoices`), superToken)).body.data.rows[0].id;

    let row = (await authed(request(app).get(`${G}/invoices`), superToken)).body.data.rows.find((r) => r.id === id);
    expect(row).toMatchObject({ overdue: true, days_overdue: 5, followup_count: 0, payment_status: 'overdue' });

    const added = await authed(request(app).post(`${G}/invoices/${id}/followups`), superToken).send({ note: 'Mailed a reminder', next_followup_date: day(2) });
    expect(added.status).toBe(201);
    row = (await authed(request(app).get(`${G}/invoices`), superToken)).body.data.rows.find((r) => r.id === id);
    expect(row).toMatchObject({ followup_count: 1, last_followup_note: 'Mailed a reminder', next_followup_date: day(2) });
    expect((await authed(request(app).get(`${G}/invoices/${id}/followups`), superToken)).body.data.followups).toHaveLength(1);
  });
});
