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

describe('dashboard summary', () => {
  test('admin summary includes stuck leads and stuck requirements (not empty stubs)', async () => {
    const admin = await createUser({ role: 'admin' });
    const bda = await createUser({ role: 'bda' });
    const sales = await createUser({ role: 'sales' });
    const { access_token: adminToken } = await loginAs(admin);

    const stale = new Date(Date.now() - 10 * 86400000);
    await prisma.account.create({
      data: {
        type: 'client',
        name: 'Stale Lead Co',
        stage: 'lead',
        owner_id: bda.id,
        created_at: stale,
        updated_at: stale,
      },
    });
    const account = await createActiveClientAccount(bda.id);
    const req = await createRequirement((await loginAs(sales)).access_token, account.id);
    await prisma.requirement.update({
      where: { id: req.id },
      data: { created_at: stale, updated_at: stale },
    });

    const res = await authed(request(app).get('/api/v1/dashboard/summary'), adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.stuck_leads.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.stuck_leads[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), name: expect.any(String), days_in_stage: expect.any(Number) })
    );
    expect(res.body.data.stuck_requirements.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.stuck_requirements[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        days_open: expect.any(Number),
        submissions_count: expect.any(Number),
      })
    );
  });

  test('bda summary only counts own leads, not another bda lead', async () => {
    const bdaA = await createUser({ role: 'bda' });
    const bdaB = await createUser({ role: 'bda' });
    const { access_token: tokenA } = await loginAs(bdaA);

    await prisma.account.create({
      data: { type: 'client', name: 'Mine', stage: 'lead', owner_id: bdaA.id },
    });
    await prisma.account.create({
      data: { type: 'client', name: 'Theirs', stage: 'lead', owner_id: bdaB.id },
    });

    const res = await authed(request(app).get('/api/v1/dashboard/summary'), tokenA);
    expect(res.status).toBe(200);
    expect(res.body.data.leads_active).toBe(1);
    expect(res.body.data.requirements_open).toBe(0);
  });

  test('sales summary only counts own requirements', async () => {
    const bda = await createUser({ role: 'bda' });
    const salesA = await createUser({ role: 'sales' });
    const salesB = await createUser({ role: 'sales' });
    const { access_token: tokenA } = await loginAs(salesA);
    const { access_token: tokenB } = await loginAs(salesB);
    const account = await createActiveClientAccount(bda.id);

    await createRequirement(tokenA, account.id);
    await createRequirement(tokenB, account.id);

    const res = await authed(request(app).get('/api/v1/dashboard/summary'), tokenA);
    expect(res.status).toBe(200);
    expect(res.body.data.requirements_open).toBe(1);
  });
});

describe('ownership', () => {
  test('bda can edit another bda account and schedule a meeting', async () => {
    const bdaA = await createUser({ role: 'bda' });
    const bdaB = await createUser({ role: 'bda' });
    const { access_token: tokenA } = await loginAs(bdaA);
    const { access_token: tokenB } = await loginAs(bdaB);

    const create = await authed(request(app).post('/api/v1/accounts'), tokenA).send({
      type: 'client',
      name: 'Owned by A',
    });
    expect(create.status).toBe(201);
    const accountId = create.body.data.id;

    const list = await authed(request(app).get('/api/v1/accounts'), tokenB);
    expect(list.status).toBe(200);
    expect(list.body.data.some((row) => row.id === accountId)).toBe(true);

    const getOne = await authed(request(app).get(`/api/v1/accounts/${accountId}`), tokenB);
    expect(getOne.status).toBe(200);
    expect(getOne.body.data.id).toBe(accountId);

    const edit = await authed(request(app).patch(`/api/v1/accounts/${accountId}`), tokenB).send({
      industry: 'Shared edit',
    });
    expect(edit.status).toBe(200);
    expect(edit.body.data.industry).toBe('Shared edit');

    const stage = await authed(request(app).post(`/api/v1/accounts/${accountId}/stage`), tokenB).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
    });
    expect(stage.status).toBe(200);
    expect(stage.body.data.stage).toBe('meeting_scheduled');
  });

  test('sales cannot edit another sales requirement', async () => {
    const bda = await createUser({ role: 'bda' });
    const salesA = await createUser({ role: 'sales' });
    const salesB = await createUser({ role: 'sales' });
    const { access_token: tokenA } = await loginAs(salesA);
    const { access_token: tokenB } = await loginAs(salesB);
    const account = await createActiveClientAccount(bda.id);
    const req = await createRequirement(tokenA, account.id);

    const edit = await authed(request(app).patch(`/api/v1/requirements/${req.id}`), tokenB).send({
      title: 'Stolen title',
    });
    expect(edit.status).toBe(403);

    const status = await authed(request(app).post(`/api/v1/requirements/${req.id}/status`), tokenB).send({
      to_status: 'in_progress',
    });
    expect(status.status).toBe(403);
  });
});

describe('report avg-day metrics', () => {
  test('recruiter performance fills avg_days from stage history', async () => {
    const admin = await createUser({ role: 'admin' });
    const bda = await createUser({ role: 'bda' });
    const sales = await createUser({ role: 'sales' });
    const recruiter = await createUser({ role: 'recruiter' });
    const { access_token: adminToken } = await loginAs(admin);
    const { access_token: salesToken } = await loginAs(sales);
    const { access_token: recruiterToken } = await loginAs(recruiter);

    const account = await createActiveClientAccount(bda.id);
    const requirement = await createRequirement(salesToken, account.id);
    const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
    const profile = await createProfile(recruiterToken);

    const createdAt = new Date(Date.now() - 10 * 86400000);
    const submittedAt = new Date(Date.now() - 7 * 86400000);
    const offerAt = new Date(Date.now() - 3 * 86400000);
    const closedAt = new Date(Date.now() - 1 * 86400000);

    const submission = await prisma.submission.create({
      data: {
        requirement_seat_id: seats.body.data[0].id,
        profile_id: profile.id,
        submitted_by: recruiter.id,
        stage: 'closed',
        is_locked: true,
        proposed_rate: 100,
        proposed_rate_currency: 'USD',
        vendor_rate: 70,
        vendor_rate_currency: 'USD',
        margin: 30,
        margin_percentage: 30,
        actual_joining_date: closedAt,
        created_at: createdAt,
        updated_at: closedAt,
      },
    });

    await prisma.stageHistory.createMany({
      data: [
        {
          entity_type: 'submission',
          entity_id: submission.id,
          from_stage: 'sourced',
          to_stage: 'submitted_to_client',
          changed_by: recruiter.id,
          changed_at: submittedAt,
        },
        {
          entity_type: 'submission',
          entity_id: submission.id,
          from_stage: 'submitted_to_client',
          to_stage: 'offer_sent',
          changed_by: recruiter.id,
          changed_at: offerAt,
        },
        {
          entity_type: 'submission',
          entity_id: submission.id,
          from_stage: 'offer_sent',
          to_stage: 'closed',
          changed_by: recruiter.id,
          changed_at: closedAt,
        },
      ],
    });

    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const res = await authed(request(app).get('/api/v1/reports/recruiter-performance'), adminToken).query({
      date_from: from,
      date_to: to,
      recruiter_id: recruiter.id,
    });

    expect(res.status).toBe(200);
    const row = res.body.data.find((r) => r.recruiter.id === recruiter.id);
    expect(row.avg_days_sourced_to_submitted).toBe(3);
    expect(row.avg_days_offer_to_closed).toBe(2);
    expect(row.avg_days_total_cycle).toBe(9);
    expect(row.closures_count).toBe(1);
    expect(row.closure_rate_percentage).toBe(100);
  });

  test('recruiter can log interview feedback and report counts interviews + turnaround', async () => {
    const admin = await createUser({ role: 'admin' });
    const bda = await createUser({ role: 'bda' });
    const sales = await createUser({ role: 'sales' });
    const recruiter = await createUser({ role: 'recruiter' });
    const { access_token: adminToken } = await loginAs(admin);
    const { access_token: salesToken } = await loginAs(sales);
    const { access_token: recruiterToken } = await loginAs(recruiter);

    const account = await createActiveClientAccount(bda.id);
    const requirement = await createRequirement(salesToken, account.id);
    const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
    const profile = await createProfile(recruiterToken);

    const sub = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seats.body.data[0].id,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'USD',
    });
    expect(sub.status).toBe(201);

    await authed(request(app).post(`/api/v1/submissions/${sub.body.data.id}/stage`), recruiterToken).send({
      to_stage: 'internal_screening',
    });

    const scheduledAt = new Date(Date.now() - 2 * 86400000).toISOString();
    const round = await authed(request(app).post(`/api/v1/submissions/${sub.body.data.id}/interview-rounds`), recruiterToken).send({
      round_type: 'internal_r1',
      round_name: 'Recruiter screen',
      scheduled_at: scheduledAt,
      result: 'pass',
      feedback: 'Strong Node.js, clear communicator',
      rating: 8,
    });
    expect(round.status).toBe(201);
    expect(round.body.data.feedback).toBe('Strong Node.js, clear communicator');
    expect(round.body.data.rating).toBe(8);
    expect(round.body.data.result).toBe('pass');
    expect(round.body.data.completed_at).toBeTruthy();

    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const res = await authed(request(app).get('/api/v1/reports/recruiter-performance'), adminToken).query({
      date_from: from,
      date_to: to,
      recruiter_id: recruiter.id,
    });
    expect(res.status).toBe(200);
    const row = res.body.data.find((r) => r.recruiter.id === recruiter.id);
    expect(row.interviews_total).toBeGreaterThanOrEqual(1);
    expect(row.interviews_completed).toBeGreaterThanOrEqual(1);
    expect(row.interviews_internal).toBeGreaterThanOrEqual(1);
    expect(row.interviews_with_feedback).toBeGreaterThanOrEqual(1);
    expect(row.avg_interview_rating).toBe(8);
    expect(row.avg_days_interview_turnaround).toBeGreaterThanOrEqual(1);
  });

  test('vendor performance fills avg_days_to_submit from requirement created_at', async () => {
    const admin = await createUser({ role: 'admin' });
    const bda = await createUser({ role: 'bda' });
    const sales = await createUser({ role: 'sales' });
    const recruiter = await createUser({ role: 'recruiter' });
    const { access_token: adminToken } = await loginAs(admin);
    const { access_token: salesToken } = await loginAs(sales);
    const { access_token: recruiterToken } = await loginAs(recruiter);

    const vendor = await prisma.account.create({
      data: { type: 'vendor', name: 'Vendor Co', stage: 'active', owner_id: bda.id },
    });
    const client = await createActiveClientAccount(bda.id);
    const requirement = await createRequirement(salesToken, client.id);
    const reqCreated = new Date(Date.now() - 5 * 86400000);
    await prisma.requirement.update({ where: { id: requirement.id }, data: { created_at: reqCreated } });

    const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
    const profile = await createProfile(recruiterToken, {
      source: 'vendor',
      vendor_account_id: vendor.id,
    });

    await prisma.submission.create({
      data: {
        requirement_seat_id: seats.body.data[0].id,
        profile_id: profile.id,
        submitted_by: recruiter.id,
        stage: 'sourced',
        proposed_rate: 100,
        proposed_rate_currency: 'USD',
        vendor_rate: 60,
        vendor_rate_currency: 'USD',
        margin: 40,
        margin_percentage: 40,
        created_at: new Date(Date.now() - 2 * 86400000),
      },
    });

    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const res = await authed(request(app).get('/api/v1/reports/vendor-performance'), adminToken).query({
      date_from: from,
      date_to: to,
      vendor_id: vendor.id,
    });

    expect(res.status).toBe(200);
    const row = res.body.data.find((r) => r.vendor.id === vendor.id);
    expect(row.avg_days_to_submit).toBe(3);
  });
});

describe('account specialization filter', () => {
  test('any role can list specialization tags and filter vendors by one', async () => {
    const admin = await createUser({ role: 'admin' });
    const sales = await createUser({ role: 'sales' });
    const bda = await createUser({ role: 'bda' });
    const { access_token: salesToken } = await loginAs(sales);
    const { access_token: bdaToken } = await loginAs(bda);

    await prisma.account.create({
      data: {
        type: 'vendor',
        name: 'React Shop',
        stage: 'active',
        owner_id: bda.id,
        origin_owner_id: bda.id,
        vendor_specializations: ['React', 'Node.js'],
      },
    });
    await prisma.account.create({
      data: {
        type: 'vendor',
        name: 'Java Shop',
        stage: 'active',
        owner_id: bda.id,
        origin_owner_id: bda.id,
        vendor_specializations: ['Java'],
      },
    });
    await createActiveClientAccount(bda.id);

    const tags = await authed(request(app).get('/api/v1/accounts/specializations'), salesToken);
    expect(tags.status).toBe(200);
    expect(tags.body.data).toEqual(expect.arrayContaining(['React', 'Node.js', 'Java']));

    const filtered = await authed(request(app).get('/api/v1/accounts'), bdaToken).query({
      specialization: 'React',
    });
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.map((r) => r.name)).toEqual(['React Shop']);

    const adminTags = await authed(request(app).get('/api/v1/accounts/specializations'), (await loginAs(admin)).access_token);
    expect(adminTags.status).toBe(200);
  });
});
