// Client / vendor POC (owner from our end) changes are dated: reports credit the owner the account HAD on each day,
// so a later change never moves earlier records or earlier revenue to the new person.
const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

let token;
let admin;
let ownerA;
let ownerB;

beforeAll(async () => {
  await cleanDatabase();
  admin = await createUser({ role: 'admin' });
  ownerA = await createUser({ role: 'bda', name: 'Owner A' });
  ownerB = await createUser({ role: 'bda', name: 'Owner B' });
  ({ access_token: token } = await loginAs(admin));
}, 120000);
afterAll(async () => { await prisma.$disconnect(); });

const post = (p, b) => authed(request(app).post(`/api/v1${p}`), token).send(b);
const patch = (p, b) => authed(request(app).patch(`/api/v1${p}`), token).send(b);
const get = (p, q) => authed(request(app).get(`/api/v1${p}`).query(q || {}), token);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// an account that already existed for 60 days, with the first owner on record from then
async function oldAccount(name) {
  const created = await post('/accounts', { type: 'client', name });
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  await prisma.account.update({ where: { id }, data: { created_at: new Date(Date.now() - 60 * 86400000) } });
  await prisma.accountOwnerHistory.updateMany({ where: { account_id: id }, data: { effective_from: new Date(`${day(-60)}T00:00:00.000Z`) } });
  return id;
}

describe('account owner history', () => {
  test('a new account records its first owner', async () => {
    const created = await post('/accounts', { type: 'client', name: 'Fresh Co' });
    const history = await get(`/accounts/${created.body.data.id}/owner-history`);
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].owner.id).toBe(admin.id);
  });

  test('changing the owner on a past day keeps the earlier days with the previous owner', async () => {
    const id = await oldAccount('Dated Co');
    const changed = await patch(`/accounts/${id}`, { owner_id: ownerA.id, owner_effective_from: day(-20) });
    expect(changed.status).toBe(200);
    expect(changed.body.data.owner.id).toBe(ownerA.id);

    const history = (await get(`/accounts/${id}/owner-history`)).body.data;
    expect(history.map((h) => [h.owner.id, h.effective_from])).toEqual([[ownerA.id, day(-20)], [admin.id, day(-60)]]);

    // a later change without a date takes effect today and the latest row always matches the current owner
    const again = await patch(`/accounts/${id}`, { owner_id: ownerB.id });
    expect(again.status).toBe(200);
    const after = (await get(`/accounts/${id}/owner-history`)).body.data;
    expect(after).toHaveLength(3);
    expect(after[0].owner.id).toBe(ownerB.id);
    expect((await get(`/accounts/${id}`)).body.data.owner.id).toBe(ownerB.id);
  });

  test('a date in the future, before the account existed, or not a date is refused and nothing changes', async () => {
    const id = await oldAccount('Guard Co');
    expect((await patch(`/accounts/${id}`, { owner_id: ownerA.id, owner_effective_from: day(3) })).status).toBe(422);
    expect((await patch(`/accounts/${id}`, { owner_id: ownerA.id, owner_effective_from: day(-70) })).status).toBe(422);
    expect((await patch(`/accounts/${id}`, { owner_id: ownerA.id, owner_effective_from: 'soon' })).status).toBe(422);
    expect((await get(`/accounts/${id}`)).body.data.owner.id).toBe(admin.id);
    expect((await get(`/accounts/${id}/owner-history`)).body.data).toHaveLength(1);
  });

  test('a date without an owner change is ignored, and other edits still work', async () => {
    const id = await oldAccount('Plain Edit Co');
    const res = await patch(`/accounts/${id}`, { name: 'Plain Edit Co 2', owner_effective_from: day(-5) });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Plain Edit Co 2');
    expect((await get(`/accounts/${id}/owner-history`)).body.data).toHaveLength(1);
  });

  test('revenue before the change stays with the previous owner', async () => {
    const id = await oldAccount('Revenue Co');
    await patch(`/accounts/${id}`, { owner_id: ownerA.id, owner_effective_from: day(-20) });
    const account = await prisma.account.findUnique({ where: { id } });
    const row = (offset, revenue) => ({ org_id: account.org_id, account_id: id, date: new Date(`${day(offset)}T00:00:00.000Z`), billable_hours: 8, rate: 100, revenue });
    await prisma.dailyProjectRevenue.createMany({ data: [row(-30, 1000), row(-10, 500)] });

    const res = await get('/analytics/revenue-by-client', { from: day(-60), to: day(0) });
    expect(res.status).toBe(200);
    expect(res.body.data.total_revenue).toBe(1500);
    const byOwner = Object.fromEntries(res.body.data.by_owner.map((o) => [o.user?.id, o]));
    expect(byOwner[admin.id]).toMatchObject({ revenue: 1000, clients: 1 });
    expect(byOwner[ownerA.id]).toMatchObject({ revenue: 500, clients: 1 });
    // the client row names the owner at the end of the period
    expect(res.body.data.clients[0].owner.id).toBe(ownerA.id);

    // a period before the change belongs entirely to the previous owner
    const early = await get('/analytics/revenue-by-client', { from: day(-60), to: day(-25) });
    expect(early.body.data.by_owner.map((o) => [o.user?.id, o.revenue])).toEqual([[admin.id, 1000]]);
  });
});
