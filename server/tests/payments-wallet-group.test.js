jest.setTimeout(120000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

// 5 Nov 2026: the wallets sit in one Book Keeping group while some companies belong to another group. Tracking a payment in a wallet the
// company owns must work whichever group the wallet is kept in ("That wallet does not belong to this company" was wrongly shown), the group
// admin may use the wallets of every group they belong to, and nobody else gets a wallet that is not theirs.

let orgA; let orgB; let adminB; let adminBToken; let superToken; let onlyBToken; let walletZi; let walletDg;
const P = '/api/v1/payments/track';
const W = '/api/v1/payments/track/wallets';
const REF = '22222222-2222-4222-8222-222222222222';
const track = (token, body) => authed(request(app).post(P), token).send({ reference_id: REF, kind: 'rent_payment', amount: '500', ...body });

beforeEach(async () => {
  await cleanDatabase();
  orgA = await createOrg({ name: 'Delphic Global', slug: 'delphic' }); // the group that keeps the wallets
  orgB = await createOrg({ name: 'Zephyr Infrastructure', slug: 'zephyr' }); // a company in a group of its own
  walletZi = await prisma.wallet.create({ data: { org_group_id: orgA.org_group_id, owner_org_id: orgB.id, purpose: 'general', name: 'Current ZI', currency: 'INR' } });
  walletDg = await prisma.wallet.create({ data: { org_group_id: orgA.org_group_id, owner_org_id: orgA.id, purpose: 'general', name: 'Current DG', currency: 'INR' } });

  adminB = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(adminB.id, orgB.id, { role: 'admin' });
  ({ access_token: adminBToken } = await loginAs(adminB));

  const su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: orgA.org_group_id } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: orgB.org_group_id } });
  await createOrgMembership(su.id, orgA.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(su));

  const onlyB = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: onlyB.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: onlyB.id, org_group_id: orgB.org_group_id } });
  await createOrgMembership(onlyB.id, orgB.id, { role: 'admin' });
  ({ access_token: onlyBToken } = await loginAs(onlyB));
});
afterAll(async () => { await prisma.$disconnect(); });

const walletTx = (where = {}) => prisma.walletTransaction.findMany({ where: { deleted_at: null, ...where } });

describe('a wallet kept in another group than its owner company', () => {
  test('the owner company tracks a payment in its own wallet', async () => {
    const res = await track(adminBToken, { wallet_payment: { wallet_id: walletZi.id, mode: 'neft' } });
    expect(res.status).toBe(201);
    expect(await walletTx({ wallet_id: walletZi.id })).toHaveLength(1);
    // the entry is audited under the group the wallet is kept in
    const entry = (await walletTx({ wallet_id: walletZi.id }))[0];
    const audit = await prisma.walletAudit.findFirst({ where: { entity_type: 'transaction', entity_id: entry.id } });
    expect(audit.org_group_id).toBe(orgA.org_group_id);
  });

  test('a company admin still cannot use a wallet another company owns', async () => {
    const res = await track(adminBToken, { wallet_payment: { wallet_id: walletDg.id, mode: 'neft' } });
    expect(res.status).toBe(403);
    expect(await walletTx()).toHaveLength(0);
  });

  test('the group admin, for the company, lists its own wallets first and the wallets of every group they belong to', async () => {
    const list = (await authed(request(app).get(W).query({ org_id: orgB.id }), superToken)).body.data;
    expect(list.map((w) => [w.name, w.own])).toEqual([['Current ZI', true], ['Current DG', false]]);
    expect((await track(superToken, { org_id: orgB.id, wallet_payment: { wallet_id: walletDg.id, mode: 'neft' } })).status).toBe(201);
    expect(await walletTx({ wallet_id: walletDg.id })).toHaveLength(1);
  });

  test('a group admin who is not in the wallet\'s group cannot use it, but still uses the company\'s own wallet', async () => {
    const list = (await authed(request(app).get(W), onlyBToken)).body.data;
    expect(list.map((w) => w.name)).toEqual(['Current ZI']);
    expect((await track(onlyBToken, { wallet_payment: { wallet_id: walletDg.id, mode: 'neft' } })).status).toBe(403);
    expect((await track(onlyBToken, { wallet_payment: { wallet_id: walletZi.id, mode: 'neft' } })).status).toBe(201);
  });
});
