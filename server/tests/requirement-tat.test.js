/** TAT: a new requirement is "Super Active" for 24 hours by default (or the hours Sales picks), then leaves the TAT Active tab. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');

let sToken;
let rToken;
let req;

beforeAll(async () => {
  await cleanDatabase();
  const s = await createUser({ role: 'sales' });
  ({ access_token: sToken } = await loginAs(s));
  ({ access_token: rToken } = await loginAs(await createUser({ role: 'recruiter' })));
  req = await createRequirement(sToken, (await createActiveClientAccount(s.id)).id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const get = (token, qs = '') => authed(request(app).get(`/api/v1/requirements${qs}`), token);
const tatOf = async (id) => (await authed(request(app).get(`/api/v1/requirements/${id}`), sToken)).body.data.tat;

describe('requirement TAT', () => {
  test('defaults to 24 hours and shows as Super Active', async () => {
    const tat = await tatOf(req.id);
    expect(tat).toMatchObject({ hours: 24, state: 'active', tag: 'Super Active' });
    expect(tat.remaining_minutes).toBeGreaterThan(23 * 60);
  });

  test('recruiters see every TAT-active requirement on the TAT tab, and only their own elsewhere', async () => {
    expect((await get(rToken, '?tat=active')).body.data.map((r) => r.id)).toEqual([req.id]);
    expect((await get(rToken)).body.data).toEqual([]);
  });

  test('Sales picks the TAT; changing it restarts the clock, resaving with the same value does not', async () => {
    const before = (await prisma.requirement.findUnique({ where: { id: req.id } })).tat_ends_at;
    expect((await authed(request(app).patch(`/api/v1/requirements/${req.id}`), sToken).send({ tat_hours: 24 })).status).toBe(200);
    expect((await prisma.requirement.findUnique({ where: { id: req.id } })).tat_ends_at).toEqual(before);
    const res = await authed(request(app).patch(`/api/v1/requirements/${req.id}`), sToken).send({ tat_hours: 48 });
    expect(res.body.data.tat).toMatchObject({ hours: 48, state: 'active' });
    expect(res.body.data.tat.remaining_minutes).toBeGreaterThan(47 * 60);
  });

  test('the last quarter is Expiring soon; after it ends the requirement leaves the TAT tab but stays open', async () => {
    await prisma.requirement.update({ where: { id: req.id }, data: { tat_hours: 24, tat_ends_at: new Date(Date.now() + 2 * 3600000) } });
    expect(await tatOf(req.id)).toMatchObject({ state: 'expiring', tag: 'Expiring soon' });

    await prisma.requirement.update({ where: { id: req.id }, data: { tat_ends_at: new Date(Date.now() - 60000) } });
    expect(await tatOf(req.id)).toMatchObject({ state: 'expired', tag: null });
    expect((await get(rToken, '?tat=active')).body.data).toEqual([]);
    const all = (await get(sToken)).body.data.find((r) => r.id === req.id);
    expect(all.status).toBe('open');
  });

  test('Sales can extend: from now when it already ran out, from the end when it is still running; recruiters cannot', async () => {
    const res = await authed(request(app).post(`/api/v1/requirements/${req.id}/tat/extend`), sToken).send({ hours: 12 });
    expect(res.status).toBe(200);
    expect(res.body.data.tat.state).toBe('active');
    expect(res.body.data.tat.remaining_minutes).toBeGreaterThan(11 * 60 + 50);
    expect(res.body.data.tat.remaining_minutes).toBeLessThanOrEqual(12 * 60);

    const again = await authed(request(app).post(`/api/v1/requirements/${req.id}/tat/extend`), sToken).send({ hours: 24 });
    expect(again.body.data.tat.remaining_minutes).toBeGreaterThan(35 * 60 + 50);

    expect((await authed(request(app).post(`/api/v1/requirements/${req.id}/tat/extend`), rToken).send({ hours: 1 })).status).toBe(403);
    expect((await authed(request(app).post(`/api/v1/requirements/${req.id}/tat/extend`), sToken).send({ hours: 0 })).status).toBe(422);
  });

  test('a closed requirement carries no tag', async () => {
    await prisma.requirement.update({ where: { id: req.id }, data: { status: 'on_hold' } });
    expect(await tatOf(req.id)).toMatchObject({ state: 'closed', tag: null });
    expect((await get(rToken, '?tat=active')).body.data).toEqual([]);
  });
});
