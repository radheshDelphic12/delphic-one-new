const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createActiveClientAccount,
  createRequirement,
  createProfile,
  authed,
} = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('history and sub-resource ownership', () => {
  test('bda can read another bda account history', async () => {
    const owner = await createUser({ role: 'bda' });
    const other = await createUser({ role: 'bda' });
    const { access_token: otherToken } = await loginAs(other);
    const account = await createActiveClientAccount(owner.id);

    const res = await authed(request(app).get(`/api/v1/accounts/${account.id}/history`), otherToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('unassigned recruiter cannot get requirement or its history', async () => {
    const sales = await createUser({ role: 'sales' });
    const recruiter = await createUser({ role: 'recruiter' });
    const { access_token: salesToken } = await loginAs(sales);
    const { access_token: recruiterToken } = await loginAs(recruiter);
    const account = await createActiveClientAccount(sales.id);
    const requirement = await createRequirement(salesToken, account.id);

    const getOne = await authed(request(app).get(`/api/v1/requirements/${requirement.id}`), recruiterToken);
    expect(getOne.status).toBe(403);

    const history = await authed(
      request(app).get(`/api/v1/requirements/${requirement.id}/history`),
      recruiterToken
    );
    expect(history.status).toBe(403);
  });

  test('recruiter cannot read another recruiter submission history', async () => {
    const sales = await createUser({ role: 'sales' });
    const recruiterA = await createUser({ role: 'recruiter' });
    const recruiterB = await createUser({ role: 'recruiter' });
    const { access_token: salesToken } = await loginAs(sales);
    const { access_token: tokenA } = await loginAs(recruiterA);
    const { access_token: tokenB } = await loginAs(recruiterB);

    const account = await createActiveClientAccount(sales.id);
    const requirement = await createRequirement(salesToken, account.id);
    await authed(request(app).post(`/api/v1/requirements/${requirement.id}/assign`), salesToken).send({
      user_id: recruiterA.id,
      role_on_req: 'recruiter',
    });

    const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
    const seatId = seats.body.data[0].id;
    const profile = await createProfile(tokenA);

    const created = await authed(request(app).post('/api/v1/submissions'), tokenA).send({
      requirement_seat_id: seatId,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'INR',
    });
    expect(created.status).toBe(201);

    const history = await authed(
      request(app).get(`/api/v1/submissions/${created.body.data.id}/history`),
      tokenB
    );
    expect(history.status).toBe(403);
  });
});
