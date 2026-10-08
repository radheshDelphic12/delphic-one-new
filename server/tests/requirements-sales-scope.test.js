/** Sales default to their own requirements; ?scope=all lets them see (but not edit) other sales' requirements. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');

let aToken;
let bToken;
let reqA;
let reqB;

beforeAll(async () => {
  await cleanDatabase();
  const a = await createUser({ role: 'sales' });
  const b = await createUser({ role: 'sales' });
  ({ access_token: aToken } = await loginAs(a));
  ({ access_token: bToken } = await loginAs(b));
  reqA = await createRequirement(aToken, (await createActiveClientAccount(a.id)).id);
  reqB = await createRequirement(bToken, (await createActiveClientAccount(b.id)).id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ids = (res) => res.body.data.map((r) => r.id).sort();

describe('sales requirement scope', () => {
  test('default and scope=mine list only the sales person own requirements', async () => {
    expect(ids(await authed(request(app).get('/api/v1/requirements'), aToken))).toEqual([reqA.id]);
    expect(ids(await authed(request(app).get('/api/v1/requirements?scope=mine'), aToken))).toEqual([reqA.id]);
  });

  test('scope=all lists everyone, and the other sales person requirement can be opened but not edited', async () => {
    expect(ids(await authed(request(app).get('/api/v1/requirements?scope=all'), aToken))).toEqual([reqA.id, reqB.id].sort());
    expect((await authed(request(app).get(`/api/v1/requirements/${reqB.id}`), aToken)).status).toBe(200);
    const edit = await authed(request(app).patch(`/api/v1/requirements/${reqB.id}`), aToken).send({ title: 'Hijacked' });
    expect(edit.status).toBe(403);
  });
});
