/**
 * Usage-shaped API coverage for RD-103 / RD-104 frontend flows:
 * create requirement → detail panels (get + seats + assignments + history) →
 * edit → status → add seat → seat stage path with joined_at.
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
  authed,
} = require('./helpers');

let sales;
let salesToken;
let recruiterToken;
let account;

beforeEach(async () => {
  await cleanDatabase();
  sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  account = await createActiveClientAccount(sales.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('RD-104 create / update requirement (form API)', () => {
  test('sales can create a requirement with tech stack and seats_total', async () => {
    const res = await authed(request(app).post('/api/v1/requirements'), salesToken).send({
      account_id: account.id,
      title: 'Python + AI/ML Engineer',
      req_type: 'recruitment',
      seats_total: 2,
      priority: 'high',
      primary_tech_stack: ['Python', 'PyTorch'],
      work_mode: 'hybrid',
      work_location: 'Indore',
      experience_min: 4,
      experience_max: 8,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Python + AI/ML Engineer');
    expect(res.body.data.status).toBe('open');
    expect(res.body.data.seats_total).toBe(2);
    expect(res.body.data.sales_owner.name).toBe(sales.name);
    expect(res.body.data.account.name).toBe(account.name);
    expect(res.body.data.primary_tech_stack).toEqual(['Python', 'PyTorch']);

    const seats = await authed(request(app).get(`/api/v1/requirements/${res.body.data.id}/seats`), salesToken);
    expect(seats.body.data).toHaveLength(2);
  });

  test('rejects create against non-active client', async () => {
    const lead = await prisma.account.create({
      data: { type: 'client', name: 'Lead Co', stage: 'lead', owner_id: sales.id },
    });
    const res = await authed(request(app).post('/api/v1/requirements'), salesToken).send({
      account_id: lead.id,
      title: 'Should fail',
      req_type: 'recruitment',
      seats_total: 1,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('owner can PATCH job fields used by the edit form', async () => {
    const req = await createRequirement(salesToken, account.id);
    const res = await authed(request(app).patch(`/api/v1/requirements/${req.id}`), salesToken).send({
      title: 'Updated title',
      designation: 'Senior Engineer',
      priority: 'urgent',
      work_location: 'Pune',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated title');
    expect(res.body.data.designation).toBe('Senior Engineer');
    expect(res.body.data.priority).toBe('urgent');
  });

  test('the requirements list can be filtered by work_mode', async () => {
    await createRequirement(salesToken, account.id, { title: 'Remote role', work_mode: 'remote' });
    await createRequirement(salesToken, account.id, { title: 'Onsite role', work_mode: 'onsite' });

    const remote = await authed(request(app).get('/api/v1/requirements').query({ work_mode: 'remote' }), salesToken);
    expect(remote.status).toBe(200);
    expect(remote.body.data.length).toBeGreaterThan(0);
    expect(remote.body.data.every((r) => r.work_mode === 'remote')).toBe(true);
    expect(remote.body.data.some((r) => r.title === 'Onsite role')).toBe(false);

    const bad = await authed(request(app).get('/api/v1/requirements').query({ work_mode: 'wfh' }), salesToken);
    expect(bad.status).toBe(422);
  });
});

describe('RD-103 detail page data + seat controls (API)', () => {
  test('detail endpoints return requirement, seats, assignments, and history', async () => {
    const req = await createRequirement(salesToken, account.id, { seats_total: 1, title: 'Detail Job' });

    const detail = await authed(request(app).get(`/api/v1/requirements/${req.id}`), salesToken);
    expect(detail.status).toBe(200);
    expect(detail.body.data.title).toBe('Detail Job');
    expect(detail.body.data.account.id).toBe(account.id);

    const seats = await authed(request(app).get(`/api/v1/requirements/${req.id}/seats`), salesToken);
    expect(seats.status).toBe(200);
    expect(seats.body.data[0]).toMatchObject({
      seat_status: 'open',
      submissions_count: 0,
      active_submissions_count: 0,
    });

    const assignments = await authed(request(app).get(`/api/v1/requirements/${req.id}/assignments`), salesToken);
    expect(assignments.status).toBe(200);
    expect(Array.isArray(assignments.body.data)).toBe(true);

    const history = await authed(request(app).get(`/api/v1/requirements/${req.id}/history`), salesToken);
    expect(history.status).toBe(200);
    expect(Array.isArray(history.body.data)).toBe(true);
  });

  test('add seat increments seats_total and appears on seats list', async () => {
    const req = await createRequirement(salesToken, account.id, { seats_total: 1 });
    const add = await authed(request(app).post(`/api/v1/requirements/${req.id}/seats`), salesToken).send({
      seat_label: 'Seat 2 — Backend',
    });
    expect(add.status).toBe(201);
    expect(add.body.data.seat_label).toBe('Seat 2 — Backend');

    const detail = await authed(request(app).get(`/api/v1/requirements/${req.id}`), salesToken);
    expect(detail.body.data.seats_total).toBe(2);

    const seats = await authed(request(app).get(`/api/v1/requirements/${req.id}/seats`), salesToken);
    expect(seats.body.data).toHaveLength(2);
  });

  test('recruiter can walk a seat open → … → closed with joined_at', async () => {
    const req = await createRequirement(salesToken, account.id);
    const seatsRes = await authed(request(app).get(`/api/v1/requirements/${req.id}/seats`), salesToken);
    const seatId = seatsRes.body.data[0].id;

    for (const to_status of ['interviewing', 'offer', 'bgv']) {
      const step = await authed(request(app).post(`/api/v1/seats/${seatId}/stage`), recruiterToken).send({ to_status });
      expect(step.status).toBe(200);
      expect(step.body.data.seat_status).toBe(to_status);
    }

    const missingJoin = await authed(request(app).post(`/api/v1/seats/${seatId}/stage`), recruiterToken).send({
      to_status: 'closed',
    });
    expect(missingJoin.status).toBe(400);

    const close = await authed(request(app).post(`/api/v1/seats/${seatId}/stage`), recruiterToken).send({
      to_status: 'closed',
      joined_at: '2026-08-21',
    });
    expect(close.status).toBe(200);
    expect(close.body.data.seat_status).toBe('closed');
    expect(close.body.data.is_locked).toBe(true);
    expect(close.body.data.joined_at).toBeTruthy();
  });

  test('sales can move requirement open → in_progress from status control', async () => {
    const req = await createRequirement(salesToken, account.id);
    const res = await authed(request(app).post(`/api/v1/requirements/${req.id}/status`), salesToken).send({
      to_status: 'in_progress',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_progress');

    const history = await authed(request(app).get(`/api/v1/requirements/${req.id}/history`), salesToken);
    expect(history.body.data.some((h) => h.to_stage === 'in_progress')).toBe(true);
  });

  test('client_submissions_count only counts submitted_to_client → bgv stages', async () => {
    const req = await createRequirement(salesToken, account.id, { seats_total: 1 });
    const seatsRes = await authed(request(app).get(`/api/v1/requirements/${req.id}/seats`), salesToken);
    const seatId = seatsRes.body.data[0].id;

    // One submission per stage, straight into the DB so we skip the transition map.
    const stages = [
      'sourced', 'internal_screening',            // excluded (not yet with the client)
      'submitted_to_client', 'interview_scheduled', 'interview_result', 'offer_sent', 'bgv', // counted
      'closed', 'backout', 'rejected',            // excluded (out of play)
    ];
    for (const stage of stages) {
      const profile = await prisma.profile.create({
        data: {
          name: `cand-${stage}`, total_experience_years: 5, primary_skills: ['Node.js'],
          source: 'direct', added_by: sales.id,
        },
      });
      await prisma.submission.create({
        data: { requirement_seat_id: seatId, profile_id: profile.id, submitted_by: sales.id, stage },
      });
    }

    const listed = await authed(request(app).get('/api/v1/requirements'), salesToken);
    const row = listed.body.data.find((r) => r.id === req.id);
    expect(row.client_submissions_count).toBe(5);
    expect(row).not.toHaveProperty('tagged_profiles_count');

    const detail = await authed(request(app).get(`/api/v1/requirements/${req.id}`), salesToken);
    expect(detail.body.data.client_submissions_count).toBe(5);
  });
});
