/**
 * GET /reports/pipeline-explorer — joined client/BDA/sales/recruiter rows with role scope.
 */
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

let adminToken;
let salesToken;
let sales;
let recruiterToken;
let recruiter;
let bdaToken;
let bda;
let ownRequirement;
let otherRequirement;
let bdaOwnedRequirement;

beforeEach(async () => {
  await cleanDatabase();
  const admin = await createUser({ role: 'admin' });
  sales = await createUser({ role: 'sales' });
  const sales2 = await createUser({ role: 'sales' });
  recruiter = await createUser({ role: 'recruiter' });
  bda = await createUser({ role: 'bda' });
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  ({ access_token: bdaToken } = await loginAs(bda));

  const account = await createActiveClientAccount(bda.id);
  ownRequirement = await createRequirement(salesToken, account.id, { title: 'Explorer Backend Role' });

  const otherAccount = await createActiveClientAccount(sales2.id);
  otherRequirement = await createRequirement(
    (await loginAs(sales2)).access_token,
    otherAccount.id,
    { title: 'Other Sales Role' }
  );

  const bdaAccount = await createActiveClientAccount(bda.id);
  bdaOwnedRequirement = await createRequirement(salesToken, bdaAccount.id, { title: 'BDA Owned Role' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('pipeline explorer access and shape', () => {
  test('admin returns requirement grain rows with client, BDA, sales, recruiters', async () => {
    await authed(request(app).post(`/api/v1/requirements/${ownRequirement.id}/assign`), salesToken).send({
      user_id: recruiter.id,
      role_on_req: 'recruiter',
    });

    const res = await authed(request(app).get('/api/v1/reports/pipeline-explorer'), adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.rows)).toBe(true);
    expect(res.body.data.rows.length).toBeGreaterThanOrEqual(2);

    const row = res.body.data.rows.find((r) => r.id === ownRequirement.id);
    expect(row).toEqual(
      expect.objectContaining({
        grain: 'requirement',
        client: expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
        bda: expect.objectContaining({ id: bda.id, name: expect.any(String) }),
        sales_owner: expect.objectContaining({ id: sales.id }),
        recruiters: expect.arrayContaining([expect.objectContaining({ id: recruiter.id })]),
        aging: expect.objectContaining({
          days_open: expect.any(Number),
          is_stuck: expect.any(Boolean),
        }),
        submissions: expect.objectContaining({
          total: expect.any(Number),
          active: expect.any(Number),
          closed: expect.any(Number),
        }),
      })
    );
  });

  test('sales sees only own requirements', async () => {
    const res = await authed(request(app).get('/api/v1/reports/pipeline-explorer'), salesToken);
    expect(res.status).toBe(200);
    const ids = res.body.data.rows.map((r) => r.id);
    expect(ids).toContain(ownRequirement.id);
    expect(ids).toContain(bdaOwnedRequirement.id);
    expect(ids).not.toContain(otherRequirement.id);
  });

  test('bda sees every requirement (team-wide, like admin)', async () => {
    const res = await authed(request(app).get('/api/v1/reports/pipeline-explorer'), bdaToken);
    expect(res.status).toBe(200);
    const ids = res.body.data.rows.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([ownRequirement.id, bdaOwnedRequirement.id, otherRequirement.id])
    );
  });

  test('recruiter sees only assigned requirements', async () => {
    await authed(request(app).post(`/api/v1/requirements/${ownRequirement.id}/assign`), salesToken).send({
      user_id: recruiter.id,
      role_on_req: 'recruiter',
    });

    const res = await authed(request(app).get('/api/v1/reports/pipeline-explorer'), recruiterToken);
    expect(res.status).toBe(200);
    expect(res.body.data.rows.map((r) => r.id)).toEqual([ownRequirement.id]);
  });

  test('search and stuck_only filters apply', async () => {
    await prisma.requirement.update({
      where: { id: ownRequirement.id },
      data: {
        created_at: new Date(Date.now() - 10 * 86400000),
        updated_at: new Date(Date.now() - 10 * 86400000),
      },
    });

    const searchRes = await authed(request(app).get('/api/v1/reports/pipeline-explorer'), salesToken).query({
      search: 'Explorer Backend',
    });
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data.rows.map((r) => r.id)).toEqual([ownRequirement.id]);

    const stuckRes = await authed(request(app).get('/api/v1/reports/pipeline-explorer'), salesToken).query({
      stuck_only: 'true',
    });
    expect(stuckRes.status).toBe(200);
    const stuckIds = stuckRes.body.data.rows.map((r) => r.id);
    expect(stuckIds).toContain(ownRequirement.id);
    expect(stuckIds).not.toContain(bdaOwnedRequirement.id);
  });

  test('submission grain expands rows with profile and recruiter', async () => {
    const seats = await authed(request(app).get(`/api/v1/requirements/${ownRequirement.id}/seats`), salesToken);
    const profile = await createProfile(recruiterToken, { name: 'Explorer Candidate' });
    const sub = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seats.body.data[0].id,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'INR',
    });
    expect(sub.status).toBe(201);

    const res = await authed(request(app).get('/api/v1/reports/pipeline-explorer'), salesToken).query({
      grain: 'submission',
    });
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r) => r.id === sub.body.data.id);
    expect(row).toEqual(
      expect.objectContaining({
        grain: 'submission',
        profile: expect.objectContaining({ name: 'Explorer Candidate' }),
        recruiter: expect.objectContaining({ id: recruiter.id }),
        client: expect.objectContaining({ id: expect.any(String) }),
        bda: expect.objectContaining({ id: bda.id }),
      })
    );
  });
});
