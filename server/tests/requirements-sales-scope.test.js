/** The whole Sales team sees and manages every requirement; each change is tagged with who made it. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');

let aToken;
let bToken;
let rToken;
let aId;
let aName;
let reqA;
let reqB;

beforeAll(async () => {
  await cleanDatabase();
  const a = await createUser({ role: 'sales' });
  const b = await createUser({ role: 'sales' });
  aId = a.id;
  aName = a.name;
  ({ access_token: aToken } = await loginAs(a));
  ({ access_token: bToken } = await loginAs(b));
  ({ access_token: rToken } = await loginAs(await createUser({ role: 'recruiter' })));
  reqA = await createRequirement(aToken, (await createActiveClientAccount(a.id)).id);
  reqB = await createRequirement(bToken, (await createActiveClientAccount(b.id)).id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ids = (res) => res.body.data.map((r) => r.id).sort();
const url = (id, tail = '') => `/api/v1/requirements/${id}${tail}`;

describe('sales requirements: shared across the team', () => {
  test('scope=mine lists only the sales person own requirements', async () => {
    expect(ids(await authed(request(app).get('/api/v1/requirements?scope=mine'), aToken))).toEqual([reqA.id]);
  });

  test('by default every sales person sees all requirements and can open another one', async () => {
    expect(ids(await authed(request(app).get('/api/v1/requirements'), aToken))).toEqual([reqA.id, reqB.id].sort());
    expect(ids(await authed(request(app).get('/api/v1/requirements?scope=all'), bToken))).toEqual([reqA.id, reqB.id].sort());
    expect((await authed(request(app).get(url(reqB.id)), aToken)).status).toBe(200);
  });

  test('any sales person can edit, add a seat and delete another one; each action is tagged with who did it', async () => {
    const edit = await authed(request(app).patch(url(reqB.id)), aToken).send({ title: 'Renamed by A', priority: 'urgent' });
    expect(edit.status).toBe(200);
    expect(edit.body.data.title).toBe('Renamed by A');
    expect((await authed(request(app).post(url(reqB.id, '/seats')), aToken).send({ seat_label: 'Extra' })).status).toBe(201);

    const act = (await authed(request(app).get(url(reqB.id, '/activity')), bToken)).body.data;
    const upd = act.find((x) => x.kind === 'update');
    expect(upd.by.name).toBe(aName);
    expect(upd.details.changes.title).toEqual({ from: reqB.title, to: 'Renamed by A' });
    expect(act.some((x) => x.kind === 'add_seat' && x.by.name === aName)).toBe(true);

    // changing the owner stays an admin decision
    expect((await authed(request(app).patch(url(reqB.id)), aToken).send({ sales_owner_id: aId })).status).toBe(403);

    // delete needs a reason, hides it from every list, keeps it in the database with who and why
    expect((await authed(request(app).delete(url(reqB.id)), aToken).send({})).status).toBe(400);
    expect((await authed(request(app).delete(url(reqB.id)), aToken).send({ reason: 'Duplicate of another' })).status).toBe(200);
    expect(ids(await authed(request(app).get('/api/v1/requirements'), bToken))).toEqual([reqA.id]);
    const row = await prisma.requirement.findFirst({ where: { id: reqB.id, deleted_at: { not: null } } });
    expect(row).toMatchObject({ delete_reason: 'Duplicate of another', deleted_by: aId });
    expect(await prisma.auditLog.count({ where: { entity_id: reqB.id, action: 'soft_delete' } })).toBe(1);

    // other roles still cannot
    expect((await authed(request(app).delete(url(reqA.id)), rToken).send({ reason: 'not allowed' })).status).toBe(403);
  });
});
