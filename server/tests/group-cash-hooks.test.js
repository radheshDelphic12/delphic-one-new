jest.setTimeout(120000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

// Group cash, Phase 2: after the go-live date a paid invoice / vendor payment / expense / salary goes through a wallet.

let org; let group; let superToken; let adminToken; let su; let adminUser; let membershipId; let wallet; let usdWallet; let client; let location;
const G = '/api/v1/group-cash';
const past = new Date('2020-01-01T00:00:00Z');

beforeEach(async () => {
  await cleanDatabase();
  org = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
  group = { id: org.org_group_id };
  su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: group.id } });
  await createOrgMembership(su.id, org.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(su));
  adminUser = await createUser({ role: 'admin', withOrg: false });
  membershipId = (await createOrgMembership(adminUser.id, org.id, { role: 'admin' })).id;
  ({ access_token: adminToken } = await loginAs(adminUser));
  const entity = (await authed(request(app).post(`${G}/entities`), superToken).send({ name: 'Delphic Global', workspace_id: org.id })).body.data.entity;
  const inr = (await authed(request(app).post(`${G}/accounts`), superToken).send({ legal_entity_id: entity.id, name: 'HDFC', type: 'current', currency: 'INR', opening_date: '2026-04-01' })).body.data.account;
  const usd = (await authed(request(app).post(`${G}/accounts`), superToken).send({ legal_entity_id: entity.id, name: 'USD', type: 'current', currency: 'USD', opening_date: '2026-04-01' })).body.data.account;
  wallet = (await authed(request(app).post(`${G}/wallets`), superToken).send({ bank_account_id: inr.id, owner_org_id: org.id, name: 'Delphic INR' })).body.data.wallet;
  usdWallet = (await authed(request(app).post(`${G}/wallets`), superToken).send({ bank_account_id: usd.id, owner_org_id: org.id, name: 'Delphic USD' })).body.data.wallet;
  client = await prisma.account.create({ data: { type: 'client', name: 'Acme Client', stage: 'active', owner_id: su.id, origin_owner_id: su.id, org_id: org.id } });
  location = await prisma.location.create({ data: { org_id: org.id, name: 'HQ' } });
});
afterAll(async () => { await prisma.$disconnect(); });

const goLive = (date) => authed(request(app).put(`${G}/settings`), superToken).send({ go_live_date: date });
const walletTx = (where = {}) => prisma.walletTransaction.findMany({ where: { deleted_at: null, ...where } });
const invoice = (over = {}) => prisma.clientInvoice.create({ data: { org_id: org.id, client_account_id: client.id, period_month: 5, period_year: 2026, amount: 1180, currency: 'INR', status: 'sent', line_items: [], invoice_number: 'INV-2026-001', created_by: su.id, ...over } });
const vendorPayment = (over = {}) => prisma.vendorPayment.create({ data: { org_id: org.id, vendor_name: 'Pixel Studio', vendor_type: 'third_party', amount: 500, currency: 'INR', period_month: 5, period_year: 2026, status: 'approved', created_by: su.id, ...over } });
const claim = (over = {}) => prisma.expenseClaim.create({ data: { org_id: org.id, org_membership_id: membershipId, location_id: location.id, category: 'Travel', amount: 250, currency: 'INR', status: 'approved', ...over } });
const payInvoice = (id, body = {}, t = adminToken) => authed(request(app).post(`/api/v1/billing/invoices/${id}/status`), t).send({ status: 'paid', ...body });
const wp = (over = {}) => ({ wallet_id: wallet.id, mode: 'neft', ...over });

describe('group cash: payment hooks', () => {
  test('the go-live date is a superadmin setting', async () => {
    expect((await authed(request(app).get(`${G}/settings`), adminToken)).status).toBe(403);
    expect((await goLive('2026-05-01')).body.data).toEqual({ go_live_date: '2026-05-01' });
    expect((await authed(request(app).get(`${G}/settings`), superToken)).body.data).toEqual({ go_live_date: '2026-05-01' });
    expect((await goLive('')).body.data).toEqual({ go_live_date: null });
    expect((await goLive('not a date')).status).toBe(422);
  });

  test('before go-live, or for older records, nothing changes: no wallet needed, nothing posted', async () => {
    const inv = await invoice();
    expect((await payInvoice(inv.id)).status).toBe(200); // no go-live date at all
    await goLive('2026-05-01');
    const old = await invoice({ invoice_number: 'INV-OLD', created_at: past });
    expect((await payInvoice(old.id)).status).toBe(200); // created before go-live
    expect((await payInvoice((await invoice({ invoice_number: 'INV-OLD2', created_at: past })).id, { wallet_payment: wp() })).status).toBe(200);
    expect(await walletTx({ reference_type: 'invoice' })).toHaveLength(0); // an old record's payment is entered by hand
  });

  test('a client invoice created after go-live needs a wallet, then the receipt is posted with its reference', async () => {
    await goLive('2020-01-01');
    const inv = await invoice();
    const missing = await payInvoice(inv.id);
    expect(missing.status).toBe(422);
    expect((await prisma.clientInvoice.findUnique({ where: { id: inv.id } })).status).toBe('sent'); // not paid without it
    const ok = await payInvoice(inv.id, { wallet_payment: wp({ date: '2026-05-20' }) });
    expect(ok.status).toBe(200);
    const [row] = await walletTx({ reference_id: inv.id });
    expect(row).toMatchObject({ wallet_id: wallet.id, direction: 'in', mode: 'neft', reference_type: 'invoice', party: 'Acme Client' });
    expect(row.amount.toFixed(2)).toBe('1180.00');
    expect(row.date.toISOString().slice(0, 10)).toBe('2026-05-20');
    expect(await prisma.clientInvoice.findUnique({ where: { id: inv.id } })).toMatchObject({ status: 'paid' });
  });

  test('the wallet must be this company\'s, active and in the payment\'s currency', async () => {
    await goLive('2020-01-01');
    const other = await createOrg({ name: 'Other Co', org_group_id: group.id });
    const entity = await prisma.legalEntity.findFirst();
    const acc = await prisma.bankAccount.findFirst({ where: { currency: 'INR' } });
    const foreign = (await authed(request(app).post(`${G}/wallets`), superToken).send({ bank_account_id: acc.id, owner_org_id: other.id, name: 'Other wallet' })).body.data.wallet;
    expect(entity).toBeTruthy();
    const inv = await invoice();
    expect((await payInvoice(inv.id, { wallet_payment: wp({ wallet_id: foreign.id }) })).status).toBe(403); // someone else's wallet
    expect((await payInvoice(inv.id, { wallet_payment: wp({ wallet_id: usdWallet.id }) })).status).toBe(422); // INR invoice, USD wallet
    expect((await payInvoice(inv.id, { wallet_payment: wp({ wallet_id: '11111111-1111-4111-8111-111111111111' }) })).status).toBe(403);
    expect((await payInvoice(inv.id, { wallet_payment: { wallet_id: wallet.id, mode: 'barter' } })).status).toBe(422);
    expect(await walletTx()).toHaveLength(0);
    // the group superadmin may use any wallet of the group for a company's payment
    expect((await payInvoice(inv.id, { wallet_payment: wp({ wallet_id: foreign.id }) }, superToken)).status).toBe(200);
  });

  test('vendor payments and expenses go out of the wallet; deleting an expense removes its entry', async () => {
    await goLive('2020-01-01');
    const vp = await vendorPayment();
    const pay = (id, body, t = adminToken) => authed(request(app).post(`/api/v1/expenses/vendor-payments/${id}/pay`), t).send(body);
    expect((await pay(vp.id, {})).status).toBe(422);
    expect((await pay(vp.id, { wallet_payment: wp({ mode: 'cheque' }) })).status).toBe(200);
    const [out] = await walletTx({ reference_type: 'vendor_payment' });
    expect(out).toMatchObject({ direction: 'out', mode: 'cheque', party: 'Pixel Studio', reference_id: vp.id });
    const c = await claim();
    const reimburse = (id, body) => authed(request(app).post(`/api/v1/expenses/claims/${id}/reimburse`), adminToken).send(body);
    expect((await reimburse(c.id, {})).status).toBe(422);
    expect((await reimburse(c.id, { wallet_payment: wp({ mode: 'upi' }) })).status).toBe(200);
    expect(await walletTx({ reference_type: 'expense' })).toHaveLength(1);
    await prisma.user.update({ where: { id: adminUser.id }, data: { is_superadmin: true } }); // only a superadmin may delete a decided claim
    const del = await authed(request(app).delete(`/api/v1/expenses/claims/${c.id}`), adminToken);
    expect(del.status).toBe(200);
    expect(await walletTx({ reference_type: 'expense' })).toHaveLength(0);
    const removed = await prisma.walletTransaction.findFirst({ where: { reference_type: 'expense' } });
    expect(removed.deleted_at).not.toBeNull();
    expect(await prisma.walletAudit.count({ where: { entity_id: removed.id, action: 'delete' } })).toBe(1);
  });

  test('a salary marked paid posts to the wallet; changing it updates the entry and marking it not paid removes it', async () => {
    await goLive('2020-01-01');
    const save = (body) => authed(request(app).put('/api/v1/payroll/salary-payments'), adminToken).send({ org_membership_id: membershipId, period_month: 4, period_year: 2026, ...body });
    expect((await save({ status: 'paid', paid_on: '2026-05-01', amount_paid: 40000 })).status).toBe(422);
    expect((await save({ status: 'paid', paid_on: '2026-05-01', amount_paid: 40000, wallet_payment: wp({ mode: 'neft' }) })).status).toBe(200);
    let rows = await walletTx({ reference_type: 'salary_run' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'out', party: adminUser.name });
    expect(rows[0].amount.toFixed(2)).toBe('40000.00');
    expect((await save({ status: 'paid', paid_on: '2026-05-02', amount_paid: 41000, wallet_payment: wp({ mode: 'imps' }) })).status).toBe(200);
    rows = await walletTx({ reference_type: 'salary_run' });
    expect(rows).toHaveLength(1); // the same entry, not a second one
    expect(rows[0].amount.toFixed(2)).toBe('41000.00');
    expect((await save({ status: 'not_paid' })).status).toBe(200);
    expect(await walletTx({ reference_type: 'salary_run' })).toHaveLength(0);
  });
});
