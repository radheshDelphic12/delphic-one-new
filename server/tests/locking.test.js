const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('record locking', () => {
  test('dropping an account locks it, blocking further edits, until unlocked', async () => {
    const bda = await createUser({ role: 'bda' });
    const { access_token: bdaToken } = await loginAs(bda);

    const create = await authed(request(app).post('/api/v1/accounts'), bdaToken).send({
      type: 'client',
      name: 'Lockable Co',
    });
    expect(create.status).toBe(201);
    const accountId = create.body.data.id;

    const editBeforeLock = await authed(request(app).patch(`/api/v1/accounts/${accountId}`), bdaToken).send({
      industry: 'FinTech',
    });
    expect(editBeforeLock.status).toBe(200);

    // lead cannot drop directly — schedule a meeting first
    const toMeeting = await authed(request(app).post(`/api/v1/accounts/${accountId}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
    });
    expect(toMeeting.status).toBe(200);

    const drop = await authed(request(app).post(`/api/v1/accounts/${accountId}/stage`), bdaToken).send({
      to_stage: 'dropped',
      reason: 'client went cold',
    });
    expect(drop.status).toBe(200);
    expect(drop.body.data.is_locked).toBe(true);

    const editAfterLock = await authed(request(app).patch(`/api/v1/accounts/${accountId}`), bdaToken).send({
      industry: 'Healthcare',
    });
    expect(editAfterLock.status).toBe(403);

    const transitionAfterLock = await authed(request(app).post(`/api/v1/accounts/${accountId}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
    });
    // lock check runs before transition validity → 403, not 400
    expect(transitionAfterLock.status).toBe(403);

    const unlock = await authed(request(app).post(`/api/v1/admin/account/${accountId}/unlock`), bdaToken).send({
      reason: 'reopening by mistake',
    });
    expect(unlock.status).toBe(200);

    const editAfterUnlock = await authed(request(app).patch(`/api/v1/accounts/${accountId}`), bdaToken).send({
      industry: 'Retail',
    });
    expect(editAfterUnlock.status).toBe(200);
    expect(editAfterUnlock.body.data.industry).toBe('Retail');
  });

  test('a recruiter cannot call the unlock endpoint', async () => {
    const bda = await createUser({ role: 'bda' });
    const recruiter = await createUser({ role: 'recruiter' });
    const { access_token: bdaToken } = await loginAs(bda);
    const { access_token } = await loginAs(recruiter);

    const create = await authed(request(app).post('/api/v1/accounts'), bdaToken).send({ type: 'client', name: 'X' });
    const res = await authed(request(app).post(`/api/v1/admin/account/${create.body.data.id}/unlock`), access_token).send({
      reason: 'trying anyway',
    });

    expect(res.status).toBe(403);
  });

  test('bda can unlock accounts but not requirements', async () => {
    const bda = await createUser({ role: 'bda' });
    const sales = await createUser({ role: 'sales' });
    const { access_token: bdaToken } = await loginAs(bda);
    const { access_token: salesToken } = await loginAs(sales);

    const account = await prisma.account.create({
      data: {
        type: 'client',
        name: 'Active Client',
        stage: 'active',
        owner_id: bda.id,
        origin_owner_id: bda.id,
      },
    });
    const reqCreate = await authed(request(app).post('/api/v1/requirements'), salesToken).send({
      account_id: account.id,
      title: 'Locked Req',
      req_type: 'recruitment',
      seats_total: 1,
    });
    expect(reqCreate.status).toBe(201);
    await prisma.requirement.update({ where: { id: reqCreate.body.data.id }, data: { is_locked: true } });
    await prisma.account.update({ where: { id: account.id }, data: { is_locked: true, stage: 'dropped' } });

    const unlockAccount = await authed(
      request(app).post(`/api/v1/admin/account/${account.id}/unlock`),
      bdaToken
    ).send({ reason: 'account reopen' });
    expect(unlockAccount.status).toBe(200);

    const unlockReq = await authed(
      request(app).post(`/api/v1/admin/requirement/${reqCreate.body.data.id}/unlock`),
      bdaToken
    ).send({ reason: 'req reopen' });
    expect(unlockReq.status).toBe(403);
  });
});
