/**
 * Group Dashboard > GST & TDS "count months by" (invoice date or billing month) and Book Keeping > Receivables: switched on per holding group, every
 * client invoice from a billing month on, what is pending, GST / TDS to collect and what the group is left with.
 */
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

let alpha;
let group;
let superUser;
let superToken;
let adminToken;
let client;
const base = '/api/v1/group-tax';

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE group_receivable_settings');
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
});

afterAll(async () => {
  await prisma.$disconnect();
});

const get = (path, query = {}, token = superToken) => authed(request(app).get(`${base}${path}`), token).query(query);
const put = (path, body, token = superToken) => authed(request(app).put(`${base}${path}`), token).send(body);

const GST18 = (b) => ({ label: 'GST 18%', mode: 'percent', value: 18, effect: 'add', amount: b * 0.18 });
async function invoice({ number, billing, date, base: baseAmount, paid = 0, status = 'sent' }) {
  const charges = [GST18(baseAmount)];
  const total = baseAmount * 1.18;
  const row = await prisma.clientInvoice.create({
    data: {
      org_id: alpha.id, client_account_id: client.id, period_month: billing[1], period_year: billing[0], amount: baseAmount, currency: 'INR', status, invoice_number: number, invoice_date: new Date(date), created_by: superUser.id,
      line_items: { project: { name: 'Ginnar Project', client_name: 'Ginnar Tech' }, details: { subtotal: baseAmount, charges, total_amount: total } },
    },
  });
  if (paid) await prisma.paymentRecord.create({ data: { org_id: alpha.id, kind: 'client_invoice', reference_id: row.id, direction: 'in', paid_on: new Date(date), amount: paid, currency: 'INR', inr_amount: paid } });
  return row;
}

async function seed() {
  await invoice({ number: 'INV-AUG', billing: [2026, 8], date: '2026-08-30', base: 100000, status: 'paid', paid: 118000 });
  await invoice({ number: 'INV-SEP-LATE', billing: [2026, 9], date: '2026-10-08', base: 200000 }); // billed for September, generated in October
  await invoice({ number: 'INV-OCT', billing: [2026, 10], date: '2026-10-20', base: 100000, paid: 50000 });
}
const numbers = (res) => res.body.data.rows.map((r) => r.number).sort();

describe('count months by invoice date or billing month', () => {
  test('an invoice billed for September but generated in October counts in September only when counting by billing month', async () => {
    await seed();
    const byDate = await get('/invoices', { from: '2026-09', to: '2026-09' });
    expect(numbers(byDate)).toEqual([]); // by invoice date nothing is dated in September
    const byBilling = await get('/invoices', { from: '2026-09', to: '2026-09', basis: 'billing' });
    expect(numbers(byBilling)).toEqual(['INV-SEP-LATE']);
    const october = await get('/invoices', { from: '2026-10', to: '2026-10', basis: 'billing' });
    expect(numbers(october)).toEqual(['INV-OCT']);
    // the GST payable view buckets the same invoice under its billing month
    const gst = await get('/gst', { from: '2026-09', to: '2026-10', basis: 'billing' });
    const sept = gst.body.data.periods.find((p) => p.key === '2026-09');
    expect(sept.invoices.map((i) => i.number)).toEqual(['INV-SEP-LATE']);
    expect(sept.collected).toBe(36000);
  });
});

describe('Book Keeping receivables', () => {
  test('off for every group until a group admin switches it on; only the group superadmin can', async () => {
    await seed();
    expect((await get('/receivables')).body.data).toMatchObject({ enabled: false });
    const setting = await get('/receivable-setting');
    expect(setting.body.data.groups).toEqual([{ id: group.id, name: expect.any(String), enabled: false, since_month: '2026-09' }]);
    expect((await put('/receivable-setting', { org_group_id: group.id, enabled: true }, adminToken)).status).toBe(403);
    expect((await put('/receivable-setting', { org_group_id: '00000000-0000-4000-8000-000000000000', enabled: true })).status).toBe(404);
    expect((await put('/receivable-setting', { org_group_id: group.id, enabled: true, since_month: '2026-09' })).status).toBe(200);
    expect((await get('/receivable-setting')).body.data.groups[0]).toMatchObject({ enabled: true, since_month: '2026-09' });
  });

  test('every invoice from the billing month on, with pending, GST and what the group is left with', async () => {
    await seed();
    await put('/receivable-setting', { org_group_id: group.id, enabled: true, since_month: '2026-09' });
    const res = await get('/receivables');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toMatchObject({ enabled: true, since_month: '2026-09' });
    expect(numbers(res)).toEqual(['INV-OCT', 'INV-SEP-LATE']); // the August-billed invoice is before the start
    const sep = d.rows.find((r) => r.number === 'INV-SEP-LATE');
    expect(sep).toMatchObject({ billing_label: 'Sep 2026', pending: 236000, paid: 0 });
    const oct = d.rows.find((r) => r.number === 'INV-OCT');
    expect(oct).toMatchObject({ billing_label: 'Oct 2026', total: 118000, paid: 50000, pending: 68000 });
    expect(d.funds).toMatchObject({ currency: 'INR', to_collect: 304000, in_hand: 0 });
    expect(d.funds.gst_in_pending).toBeCloseTo(304000 * (0.18 / 1.18), 1);
    // GST collected on every invoice (36000 + 18000 + the August invoice 18000) is still to be deposited; nothing is in hand
    expect(d.funds.gst_to_deposit).toBe(72000);
    expect(d.funds.left_now).toBe(-72000);
    expect(d.funds.left_after_collection).toBe(232000);
    // a later start month drops the September-billed invoice
    expect(numbers(await get('/receivables', { from: '2026-10' }))).toEqual(['INV-OCT']);
  });
});

describe('the Receivable wallet follows the pending invoices', () => {
  test('shows the difference and one audited entry brings the wallet to the pending amount', async () => {
    await seed();
    await put('/receivable-setting', { org_group_id: group.id, enabled: true, since_month: '2026-09' });
    const wallet = await prisma.wallet.create({ data: { org_group_id: group.id, owner_org_id: alpha.id, purpose: 'general', name: 'Receivable', currency: 'INR', opening_balance: 1000 } });
    await prisma.wallet.create({ data: { org_group_id: group.id, owner_org_id: alpha.id, purpose: 'general', name: 'Delphic INR', currency: 'INR', opening_balance: 5 } });
    const before = (await get('/receivables')).body.data.wallets;
    expect(before).toHaveLength(1); // only the wallet named Receivable
    expect(before[0]).toMatchObject({ id: wallet.id, balance: 1000, expected: 304000, difference: 303000, in_sync: false });
    const res = await authed(request(app).post(`${base}/receivables/sync-wallet`), superToken).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.synced).toBe(1);
    expect(res.body.data.wallets[0]).toMatchObject({ balance: 304000, difference: 0, in_sync: true });
    const tx = await prisma.walletTransaction.findFirst({ where: { wallet_id: wallet.id } });
    expect(tx).toMatchObject({ direction: 'in', category: 'Receivable sync' });
    expect(await prisma.walletAudit.count({ where: { entity_id: tx.id, action: 'create' } })).toBe(1);
    // a second call changes nothing
    expect((await authed(request(app).post(`${base}/receivables/sync-wallet`), superToken).send({})).body.data.synced).toBe(0);
  });

  test('refused while Receivables is switched off', async () => {
    const res = await authed(request(app).post(`${base}/receivables/sync-wallet`), superToken).send({});
    expect(res.status).toBe(409);
  });
});
