const { app, prisma, request, cleanDatabase, createUser, loginAs, authed, unique } = require('./helpers');

let superToken;
let bdaToken;
let bda;
let otherUser;

beforeEach(async () => {
  await cleanDatabase();
  const superUser = await createUser({ role: 'admin', is_superadmin: true });
  bda = await createUser({ role: 'bda' });
  otherUser = await createUser({ role: 'sales' });
  ({ access_token: superToken } = await loginAs(superUser));
  ({ access_token: bdaToken } = await loginAs(bda));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeAccount(overrides = {}) {
  return prisma.account.create({
    data: {
      type: 'client',
      name: unique('Acct '),
      stage: 'active',
      owner_id: bda.id,
      origin_owner_id: bda.id,
      ...overrides,
    },
  });
}

describe('superadmin account powers', () => {
  test('bda can reclassify client/vendor type like an admin', async () => {
    const account = await makeAccount({ type: 'client' });
    const res = await authed(request(app).patch(`/api/v1/accounts/${account.id}`), bdaToken).send({
      type: 'vendor',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('vendor');
  });

  test('superadmin can change origin_owner_id ("Brought by")', async () => {
    const account = await makeAccount();
    const res = await authed(request(app).patch(`/api/v1/accounts/${account.id}`), superToken).send({
      origin_owner_id: otherUser.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.origin_owner.id).toBe(otherUser.id);
  });

  test('a BDA can change origin_owner_id ("Brought by") like an admin', async () => {
    const account = await makeAccount();
    const res = await authed(request(app).patch(`/api/v1/accounts/${account.id}`), bdaToken).send({
      origin_owner_id: otherUser.id,
      name: 'Renamed Co',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.origin_owner.id).toBe(otherUser.id);
    expect(res.body.data.name).toBe('Renamed Co');
  });

  test('an admin (non-superadmin) can change origin_owner_id', async () => {
    const admin = await createUser({ role: 'admin', is_superadmin: false });
    const { access_token: adminToken } = await loginAs(admin);
    const account = await makeAccount();
    const res = await authed(request(app).patch(`/api/v1/accounts/${account.id}`), adminToken).send({
      origin_owner_id: otherUser.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.origin_owner.id).toBe(otherUser.id);
  });

  test('superadmin can edit a locked account; others cannot', async () => {
    const account = await makeAccount({ stage: 'dropped', is_locked: true });

    const blocked = await authed(request(app).patch(`/api/v1/accounts/${account.id}`), bdaToken).send({
      name: 'Nope',
    });
    expect(blocked.status).toBe(403);

    const ok = await authed(request(app).patch(`/api/v1/accounts/${account.id}`), superToken).send({
      name: 'Corrected Name',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.name).toBe('Corrected Name');
  });

  test('non-superadmin cannot use the stage override route', async () => {
    const account = await makeAccount();
    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage/override`), bdaToken).send({
      to_stage: 'lead',
      reason: 'testing',
    });
    expect(res.status).toBe(403);
  });

  test('superadmin can move a dropped/locked account backward to lead and it is audited', async () => {
    const account = await makeAccount({ stage: 'dropped', is_locked: true });
    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage/override`), superToken).send({
      to_stage: 'lead',
      reason: 'reopened after client came back',
      is_locked: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe('lead');
    expect(res.body.data.is_locked).toBe(false);

    const history = await prisma.stageHistory.findMany({ where: { entity_type: 'account', entity_id: account.id } });
    expect(history).toHaveLength(1);
    expect(history[0].from_stage).toBe('dropped');
    expect(history[0].to_stage).toBe('lead');
    expect(history[0].reason.startsWith('[override]')).toBe(true);
  });

  test('stage override requires a reason', async () => {
    const account = await makeAccount();
    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage/override`), superToken).send({
      to_stage: 'lead',
    });
    expect(res.status).toBe(422);
  });
});
