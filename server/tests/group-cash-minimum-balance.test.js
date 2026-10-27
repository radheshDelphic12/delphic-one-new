// Group bank accounts: an optional minimum balance. An account whose balance falls below it is flagged (with the shortfall) in the position,
// and the flag follows the balance, not the filter.
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

const base = '/api/v1/group-cash';
let a; let token;
beforeEach(async () => {
  await cleanDatabase();
  a = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
  const su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: a.org_group_id } });
  await createOrgMembership(su.id, a.id, { role: 'admin' });
  ({ access_token: token } = await loginAs(su));
});
afterAll(async () => { await prisma.$disconnect(); });

const post = (p, b) => authed(request(app).post(`${base}${p}`), token).send(b);
const patch = (p, b) => authed(request(app).patch(`${base}${p}`), token).send(b);
const get = (p) => authed(request(app).get(`${base}${p}`), token);

async function account(name, opening, extra = {}) {
  const entity = (await post('/entities', { name: `${name} Ltd` })).body.data.entity;
  const r = await post('/accounts', { legal_entity_id: entity.id, name, type: 'current', bank_name: 'HDFC', account_last4: '1234', currency: 'INR', declared_opening_balance: String(opening), opening_date: '2026-04-01', ...extra });
  expect(r.status).toBe(201);
  const acc = r.body.data.account;
  await prisma.wallet.create({ data: { org_group_id: acc.org_group_id, bank_account_id: acc.id, currency: 'INR', owner_legal_entity_id: entity.id, purpose: 'general', name: `${name} wallet`, opening_balance: String(opening) } });
  return acc;
}
const position = async () => (await get('/position')).body.data;
const row = async (id) => (await position()).entities.flatMap((e) => e.accounts).find((x) => x.id === id);

describe('bank account minimum balance', () => {
  test('no minimum = no alert; a minimum above the balance flags it with the shortfall', async () => {
    const none = await account('No Minimum', 1000);
    expect(none.minimum_balance).toBeNull();
    expect(await row(none.id)).toMatchObject({ minimum_balance: null, below_minimum: false, shortfall: null });

    const low = await account('Low Balance', 1000, { minimum_balance: '2500.50' });
    expect(await row(low.id)).toMatchObject({ minimum_balance: '2500.50', below_minimum: true, shortfall: '1500.50' });
    const p = await position();
    expect(p.below_minimum).toEqual([expect.objectContaining({ id: low.id, shortfall: '1500.50', minimum_balance: '2500.50' })]);

    const ok = await account('Healthy', 5000, { minimum_balance: '2000' });
    expect(await row(ok.id)).toMatchObject({ below_minimum: false, shortfall: null });
    expect((await position()).below_minimum.map((x) => x.name)).toEqual(['Low Balance']);
  });

  test('exactly at the minimum is fine; the minimum can be set, changed and cleared', async () => {
    const acc = await account('Edge', 1000, { minimum_balance: '1000' });
    expect((await row(acc.id)).below_minimum).toBe(false);
    expect((await patch(`/accounts/${acc.id}`, { minimum_balance: '1000.01' })).status).toBe(200);
    expect((await row(acc.id)).below_minimum).toBe(true);
    expect((await patch(`/accounts/${acc.id}`, { minimum_balance: null })).status).toBe(200);
    expect(await row(acc.id)).toMatchObject({ minimum_balance: null, below_minimum: false });
    expect((await patch(`/accounts/${acc.id}`, { minimum_balance: '' })).status).toBe(200);
    expect((await patch(`/accounts/${acc.id}`, { minimum_balance: '500' })).status).toBe(200);
    expect((await row(acc.id)).minimum_balance).toBe('500.00');
  });

  test('a negative or non-numeric minimum is refused', async () => {
    const acc = await account('Bad', 1000);
    expect((await patch(`/accounts/${acc.id}`, { minimum_balance: '-5' })).status).toBe(422);
    expect((await patch(`/accounts/${acc.id}`, { minimum_balance: 'abc' })).status).toBe(422);
  });

  test('setup list and pick lists carry the minimum', async () => {
    const acc = await account('Listed', 1000, { minimum_balance: '300' });
    const setup = (await get('/setup')).body.data;
    expect(setup.accounts.find((x) => x.id === acc.id).minimum_balance).toBe('300.00');
    const opts = (await get('/options')).body.data;
    expect(opts.accounts.find((x) => x.id === acc.id).minimum_balance).toBe('300.00');
  });
});
