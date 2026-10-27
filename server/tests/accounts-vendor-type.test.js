// Accounts > Vendor type (assets | bgv): empty by default, set on create or edit, cleared with an empty value, filterable in the list.
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

describe('vendor type', () => {
  test('empty by default; create, edit and clearing it all work', async () => {
    const none = await post('/accounts', { type: 'vendor', name: 'Untyped Vendor' });
    expect(none.status).toBe(201);
    expect(none.body.data.vendor_type).toBeNull();

    const assets = await post('/accounts', { type: 'vendor', name: 'Assets Vendor', vendor_type: 'assets' });
    expect(assets.status).toBe(201);
    expect(assets.body.data.vendor_type).toBe('assets');

    const bgv = await patch(`/accounts/${none.body.data.id}`, { vendor_type: 'bgv' });
    expect(bgv.status).toBe(200);
    expect(bgv.body.data.vendor_type).toBe('bgv');
    expect((await get(`/accounts/${none.body.data.id}`)).body.data.vendor_type).toBe('bgv');

    const cleared = await patch(`/accounts/${none.body.data.id}`, { vendor_type: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.vendor_type).toBeNull();
  });

  test('only assets or bgv are accepted', async () => {
    const acc = (await get('/accounts', { search: 'Untyped Vendor' })).body.data[0];
    expect((await patch(`/accounts/${acc.id}`, { vendor_type: 'other' })).status).toBe(422);
    expect((await get('/accounts', { vendor_type: 'other' })).status).toBe(422);
  });

  test('the list filters on vendor type, and no filter lists everyone', async () => {
    const acc = (await get('/accounts', { search: 'Untyped Vendor' })).body.data[0];
    await patch(`/accounts/${acc.id}`, { vendor_type: 'bgv' });
    expect(await names({ vendor_type: 'assets' })).toEqual(['Assets Vendor']);
    expect(await names({ vendor_type: 'bgv' })).toEqual(['Untyped Vendor']);
    expect(await names({})).toEqual(['Assets Vendor', 'Untyped Vendor']);
  });
});
