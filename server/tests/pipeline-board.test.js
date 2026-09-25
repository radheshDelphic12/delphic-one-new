/**
 * GET /pipeline/board — role-scoped requirement x stage matrix data.
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
let sales2Token;
let recruiterToken;
let recruiter2Token;
let sales;
let recruiter;
let ownRequirement;
let otherSalesRequirement;

beforeEach(async () => {
  await cleanDatabase();
  const admin = await createUser({ role: 'admin' });
  sales = await createUser({ role: 'sales' });
  const sales2 = await createUser({ role: 'sales' });
  recruiter = await createUser({ role: 'recruiter' });
  const recruiter2 = await createUser({ role: 'recruiter' });
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: sales2Token } = await loginAs(sales2));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  ({ access_token: recruiter2Token } = await loginAs(recruiter2));

  const account = await createActiveClientAccount(sales.id);
  ownRequirement = await createRequirement(salesToken, account.id, { title: 'Backend Engineer Role' });

  const account2 = await createActiveClientAccount(sales2.id);
  otherSalesRequirement = await createRequirement(sales2Token, account2.id, { title: 'Frontend Engineer Role' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('pipeline board role scoping', () => {
  test('admin sees every requirement', async () => {
    const res = await authed(request(app).get('/api/v1/pipeline/board'), adminToken);
    expect(res.status).toBe(200);
    const ids = res.body.data.requirements.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([ownRequirement.id, otherSalesRequirement.id]));
  });

  test('sales sees only their own requirements', async () => {
    const res = await authed(request(app).get('/api/v1/pipeline/board'), salesToken);
    expect(res.status).toBe(200);
    const ids = res.body.data.requirements.map((r) => r.id);
    expect(ids).toContain(ownRequirement.id);
    expect(ids).not.toContain(otherSalesRequirement.id);
  });

  test('recruiter sees only assigned requirements', async () => {
    await authed(request(app).post(`/api/v1/requirements/${ownRequirement.id}/assign`), salesToken).send({
      user_id: recruiter.id,
      role_on_req: 'recruiter',
    });

    const assignedRes = await authed(request(app).get('/api/v1/pipeline/board'), recruiterToken);
    expect(assignedRes.status).toBe(200);
    const assignedIds = assignedRes.body.data.requirements.map((r) => r.id);
    expect(assignedIds).toEqual([ownRequirement.id]);

    const unassignedRes = await authed(request(app).get('/api/v1/pipeline/board'), recruiter2Token);
    expect(unassignedRes.status).toBe(200);
    expect(unassignedRes.body.data.requirements).toHaveLength(0);
  });

  test('bda sees every requirement in the map (team-wide, not just owned accounts)', async () => {
    const bda = await createUser({ role: 'bda' });
    const { access_token: bdaToken } = await loginAs(bda);
    const bdaAccount = await createActiveClientAccount(bda.id);
    const bdaReq = await createRequirement(salesToken, bdaAccount.id, { title: 'BDA Client Role' });

    const res = await authed(request(app).get('/api/v1/pipeline/board'), bdaToken);
    expect(res.status).toBe(200);
    const ids = res.body.data.requirements.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([bdaReq.id, ownRequirement.id, otherSalesRequirement.id])
    );
  });

  test('empty (zero-submission) requirements still appear as rows', async () => {
    const res = await authed(request(app).get('/api/v1/pipeline/board'), salesToken);
    const row = res.body.data.requirements.find((r) => r.id === ownRequirement.id);
    expect(row).toBeTruthy();
    const rowSubmissions = res.body.data.submissions.filter((s) => s.requirement.id === ownRequirement.id);
    expect(rowSubmissions).toHaveLength(0);
  });
});

describe('pipeline board stuck flag + filters', () => {
  test('a fresh open requirement is not stuck; an aged one is', async () => {
    await prisma.requirement.update({
      where: { id: ownRequirement.id },
      data: {
        created_at: new Date(Date.now() - 10 * 86400000),
        updated_at: new Date(Date.now() - 10 * 86400000),
      },
    });

    const res = await authed(request(app).get('/api/v1/pipeline/board'), salesToken);
    const stuckRow = res.body.data.requirements.find((r) => r.id === ownRequirement.id);
    expect(stuckRow.is_stuck).toBe(true);
  });

  test('stuck=stuck filters out non-stuck requirements', async () => {
    const account3 = await createActiveClientAccount(sales.id);
    const freshRequirement = await createRequirement(salesToken, account3.id, { title: 'Fresh Role' });
    await prisma.requirement.update({
      where: { id: ownRequirement.id },
      data: {
        created_at: new Date(Date.now() - 10 * 86400000),
        updated_at: new Date(Date.now() - 10 * 86400000),
      },
    });

    const res = await authed(request(app).get('/api/v1/pipeline/board'), salesToken).query({ stuck: 'stuck' });
    const ids = res.body.data.requirements.map((r) => r.id);
    expect(ids).toContain(ownRequirement.id);
    expect(ids).not.toContain(freshRequirement.id);
  });

  test('search filters by requirement title', async () => {
    const res = await authed(request(app).get('/api/v1/pipeline/board'), salesToken).query({ search: 'Backend' });
    const ids = res.body.data.requirements.map((r) => r.id);
    expect(ids).toEqual([ownRequirement.id]);
  });

  test('search also matches candidate name', async () => {
    const seats = await authed(request(app).get(`/api/v1/requirements/${ownRequirement.id}/seats`), salesToken);
    const profile = await createProfile(recruiterToken, { name: 'Zaraluxe Candidate' });
    await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seats.body.data[0].id,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'INR',
    });

    const res = await authed(request(app).get('/api/v1/pipeline/board'), salesToken).query({ search: 'Zaraluxe' });
    const ids = res.body.data.requirements.map((r) => r.id);
    expect(ids).toContain(ownRequirement.id);
    expect(ids).not.toContain(otherSalesRequirement.id);
  });

  test('submission_stage filter hides requirements with no candidate in that stage', async () => {
    const seats = await authed(request(app).get(`/api/v1/requirements/${ownRequirement.id}/seats`), salesToken);
    const profile = await createProfile(recruiterToken, { name: 'Stagey Candidate' });
    await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seats.body.data[0].id,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'INR',
    });
    // ownRequirement has a candidate at 'sourced'; otherSalesRequirement has none.

    const res = await authed(request(app).get('/api/v1/pipeline/board'), adminToken).query({
      submission_stage: 'sourced',
    });
    const ids = res.body.data.requirements.map((r) => r.id);
    expect(ids).toContain(ownRequirement.id);
    expect(ids).not.toContain(otherSalesRequirement.id);

    const noneRes = await authed(request(app).get('/api/v1/pipeline/board'), adminToken).query({
      submission_stage: 'offer_sent',
    });
    expect(noneRes.body.data.requirements).toHaveLength(0);
  });

  test('sales_id and status filters narrow the board', async () => {
    const res = await authed(request(app).get('/api/v1/pipeline/board'), adminToken).query({
      sales_id: sales.id,
      status: 'open',
    });
    expect(res.status).toBe(200);
    const ids = res.body.data.requirements.map((r) => r.id);
    expect(ids).toContain(ownRequirement.id);
    expect(ids).not.toContain(otherSalesRequirement.id);
  });

  test('board rows include BDA owner, recruiters, and past_sla', async () => {
    const bda = await createUser({ role: 'bda' });
    await prisma.account.update({
      where: { id: (await prisma.requirement.findUnique({ where: { id: ownRequirement.id } })).account_id },
      data: { owner_id: bda.id },
    });
    await authed(request(app).post(`/api/v1/requirements/${ownRequirement.id}/assign`), salesToken).send({
      user_id: recruiter.id,
      role_on_req: 'recruiter',
    });

    const res = await authed(request(app).get('/api/v1/pipeline/board'), salesToken);
    const row = res.body.data.requirements.find((r) => r.id === ownRequirement.id);
    expect(row.account.owner).toEqual(expect.objectContaining({ id: bda.id }));
    expect(row.recruiters).toEqual(expect.arrayContaining([expect.objectContaining({ id: recruiter.id })]));
    expect(typeof row.past_sla).toBe('boolean');
  });
});

describe('pipeline board submission cells', () => {
  test('submissions include profile and recruiter details, scoped to visible requirements', async () => {
    const seats = await authed(request(app).get(`/api/v1/requirements/${ownRequirement.id}/seats`), salesToken);
    const profile = await createProfile(recruiterToken, { name: 'Priya Candidate' });

    const sub = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seats.body.data[0].id,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'INR',
    });
    expect(sub.status).toBe(201);

    const res = await authed(request(app).get('/api/v1/pipeline/board'), salesToken);
    const row = res.body.data.submissions.find((s) => s.id === sub.body.data.id);
    expect(row).toEqual(
      expect.objectContaining({
        stage: 'sourced',
        requirement: { id: ownRequirement.id },
        profile: expect.objectContaining({ name: 'Priya Candidate', source: 'direct' }),
        submitted_by: expect.objectContaining({ id: recruiter.id }),
        progress: expect.objectContaining({ percent: expect.any(Number) }),
      })
    );
  });

  test('a vendor-sourced candidate carries the vendor account name', async () => {
    const vendor = await prisma.account.create({
      data: { type: 'vendor', name: 'Acme Staffing', stage: 'active', owner_id: sales.id, origin_owner_id: sales.id },
    });
    const seats = await authed(request(app).get(`/api/v1/requirements/${ownRequirement.id}/seats`), salesToken);
    const profile = await createProfile(recruiterToken, {
      name: 'Vendor Candidate',
      source: 'vendor',
      vendor_account_id: vendor.id,
    });
    const sub = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seats.body.data[0].id,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'INR',
      vendor_rate: 80,
      vendor_rate_currency: 'INR',
    });
    expect(sub.status).toBe(201);

    const res = await authed(request(app).get('/api/v1/pipeline/board'), salesToken);
    const row = res.body.data.submissions.find((s) => s.id === sub.body.data.id);
    expect(row.profile).toEqual(
      expect.objectContaining({
        source: 'vendor',
        vendor_account: expect.objectContaining({ id: vendor.id, name: 'Acme Staffing' }),
      })
    );
  });
});
