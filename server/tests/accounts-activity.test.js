/** Every edit of a lead / account is tagged with who made it, so a later person can see who worked on it before. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

let aToken;
let bToken;
let a;
let b;

beforeAll(async () => {
  await cleanDatabase();
  a = await createUser({ role: 'bda' });
  b = await createUser({ role: 'bda' });
  ({ access_token: aToken } = await loginAs(a));
  ({ access_token: bToken } = await loginAs(b));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('account / lead activity tags', () => {
  test('A adds a lead, B edits and moves it: the activity says who did each step', async () => {
    const created = await authed(request(app).post('/api/v1/accounts'), aToken).send({ name: 'Acme Lead', industry: 'IT' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const edit = await authed(request(app).patch(`/api/v1/accounts/${id}`), bToken).send({ name: 'Acme Lead Pvt', industry: 'Finance' });
    expect(edit.status).toBe(200);
    const move = await authed(request(app).post(`/api/v1/accounts/${id}/stage`), bToken).send({ to_stage: 'meeting_scheduled', meeting_mode: 'online', meeting_date: new Date(Date.now() + 86400000).toISOString() });
    expect(move.status).toBe(200);

    const act = (await authed(request(app).get(`/api/v1/accounts/${id}/activity`), aToken)).body.data;
    expect(act.find((x) => x.kind === 'create').by.name).toBe(a.name);
    const upd = act.find((x) => x.kind === 'update');
    expect(upd.by.name).toBe(b.name);
    expect(upd.details.changes.name).toEqual({ from: 'Acme Lead', to: 'Acme Lead Pvt' });
    expect(upd.details.changes.industry).toEqual({ from: 'IT', to: 'Finance' });
    const stage = act.find((x) => x.kind === 'stage');
    expect(stage.by.name).toBe(b.name);
    expect(stage.summary).toMatch(/meeting scheduled/);
    // newest first, so "last worked on by" is the first row
    expect(act[0].by.name).toBe(b.name);
    // an edit that changes nothing leaves no noise
    const before = act.length;
    await authed(request(app).patch(`/api/v1/accounts/${id}`), aToken).send({ name: 'Acme Lead Pvt' });
    expect((await authed(request(app).get(`/api/v1/accounts/${id}/activity`), aToken)).body.data).toHaveLength(before);
    expect((await authed(request(app).get('/api/v1/accounts/00000000-0000-4000-8000-000000000000/activity'), aToken)).status).toBe(404);
  });
});
