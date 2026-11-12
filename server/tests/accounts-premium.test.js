// Accounts > Premium (yes/no): off by default, set on create or edit, shown on the account, filterable in the list, and the edit is logged.
const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

let token;
beforeAll(async () => {
  await cleanDatabase();
  const user = await createUser({ role: 'admin' });
  ({ access_token: token } = await loginAs(user));
}, 120000);
afterAll(async () => { await prisma.$disconnect(); });

const post = (p, b) => authed(request(app).post(`/api/v1${p}`), token).send(b);
const patch = (p, b) => authed(request(app).patch(`/api/v1${p}`), token).send(b);
const get = (p, q) => authed(request(app).get(`/api/v1${p}`).query(q || {}), token);
const names = async (q) => (await get('/accounts', { limit: 50, ...q })).body.data.map((a) => a.name).sort();

describe('account premium flag', () => {
  test('an account is not premium unless it is marked; create and edit both set it', async () => {
    const plain = await post('/accounts', { type: 'client', name: 'Plain Co' });
    expect(plain.status).toBe(201);
    expect(plain.body.data.is_premium).toBe(false);

    const premium = await post('/accounts', { type: 'client', name: 'Premium Co', is_premium: true });
    expect(premium.status).toBe(201);
    expect(premium.body.data.is_premium).toBe(true);

    const edited = await patch(`/accounts/${plain.body.data.id}`, { is_premium: true });
    expect(edited.status).toBe(200);
    expect(edited.body.data.is_premium).toBe(true);
    expect((await get(`/accounts/${plain.body.data.id}`)).body.data.is_premium).toBe(true);
    const back = await patch(`/accounts/${plain.body.data.id}`, { is_premium: false });
    expect(back.body.data.is_premium).toBe(false);
  });

  test('a value that is not yes/no is refused', async () => {
    const acc = await post('/accounts', { type: 'vendor', name: 'Vendor Co' });
    expect((await patch(`/accounts/${acc.body.data.id}`, { is_premium: 'maybe' })).status).toBe(422);
  });

  test('the list filters on premium yes / no, and no filter lists everyone', async () => {
    await patch(`/accounts/${(await get('/accounts', { search: 'Vendor Co' })).body.data[0].id}`, { is_premium: true });
    expect(await names({ premium: 'yes' })).toEqual(['Premium Co', 'Vendor Co']);
    expect(await names({ premium: 'no' })).toEqual(['Plain Co']);
    expect(await names({})).toEqual(['Plain Co', 'Premium Co', 'Vendor Co']);
    expect((await get('/accounts', { premium: 'sometimes' })).status).toBe(422);
  });

  test('the change shows in the account activity', async () => {
    const acc = (await get('/accounts', { search: 'Plain Co' })).body.data[0];
    await patch(`/accounts/${acc.id}`, { is_premium: true });
    const activity = await get(`/accounts/${acc.id}/activity`);
    expect(activity.status).toBe(200);
    expect(JSON.stringify(activity.body.data)).toContain('is premium');
  });
});
