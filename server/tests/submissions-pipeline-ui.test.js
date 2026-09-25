/**
 * Usage-shaped API coverage for RD-111 / RD-125 / RD-112:
 * stage moves with reasons, interview rounds CRUD, list-by-requirement for kanban.
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

let salesToken;
let recruiterToken;
let requirement;
let accountId;
let seatId;
let profile;
let submissionId;

beforeEach(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  const account = await createActiveClientAccount(sales.id);
  accountId = account.id;
  requirement = await createRequirement(salesToken, account.id, { seats_total: 1 });
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
  seatId = seats.body.data[0].id;
  profile = await createProfile(recruiterToken);
  const created = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
    requirement_seat_id: seatId,
    profile_id: profile.id,
    proposed_rate: 100,
    proposed_rate_currency: 'INR',
    vendor_rate: 70,
    vendor_rate_currency: 'INR',
  });
  submissionId = created.body.data.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('RD-111 submission stage buttons (API)', () => {
  test('moves sourced → internal_screening and records history', async () => {
    const res = await authed(request(app).post(`/api/v1/submissions/${submissionId}/stage`), recruiterToken).send({
      to_stage: 'internal_screening',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe('internal_screening');

    const history = await authed(request(app).get(`/api/v1/submissions/${submissionId}/history`), recruiterToken);
    expect(history.body.data.some((h) => h.to_stage === 'internal_screening')).toBe(true);
  });

  test('backout and rejected require reasons', async () => {
    const missing = await authed(request(app).post(`/api/v1/submissions/${submissionId}/stage`), recruiterToken).send({
      to_stage: 'backout',
    });
    expect(missing.status).toBe(400);

    const backout = await authed(request(app).post(`/api/v1/submissions/${submissionId}/stage`), recruiterToken).send({
      to_stage: 'backout',
      backout_reason: 'Candidate declined',
    });
    expect(backout.status).toBe(200);
    expect(backout.body.data.stage).toBe('backout');
  });
});

describe('RD-125 interview rounds UI (API)', () => {
  test('create internal round with feedback and update result', async () => {
    const create = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      recruiterToken
    ).send({
      round_type: 'internal_r1',
      round_name: 'Recruiter screen',
      scheduled_at: new Date().toISOString(),
      interviewer_name: 'Alex',
      result: 'pass',
      feedback: 'Strong communicator',
      rating: 8,
    });
    expect(create.status).toBe(201);
    expect(create.body.data.round_type).toBe('internal_r1');
    expect(create.body.data.result).toBe('pass');
    expect(create.body.data.rating).toBe(8);

    const roundId = create.body.data.id;
    const patch = await authed(request(app).patch(`/api/v1/interview-rounds/${roundId}`), recruiterToken).send({
      feedback: 'Updated notes',
      rating: 9,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.data.feedback).toBe('Updated notes');
    expect(patch.body.data.rating).toBe(9);

    const detail = await authed(request(app).get(`/api/v1/submissions/${submissionId}`), recruiterToken);
    expect(detail.body.data.interview_rounds).toHaveLength(1);
  });

  test('client round can be scheduled pending', async () => {
    const create = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      recruiterToken
    ).send({
      round_type: 'client_r1',
      scheduled_at: '2026-08-25T10:00:00.000Z',
      interviewer_name: 'Hiring Manager',
      result: 'pending',
    });
    expect(create.status).toBe(201);
    expect(create.body.data.round_type).toBe('client_r1');
    expect(create.body.data.result).toBe('pending');
  });
});

describe('RD-112 kanban data (list by requirement)', () => {
  test('lists submissions for a requirement grouped by the board', async () => {
    const profile2 = await createProfile(recruiterToken, { name: 'Second Candidate' });
    await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seatId,
      profile_id: profile2.id,
      proposed_rate: 90,
      proposed_rate_currency: 'INR',
      vendor_rate: 60,
      vendor_rate_currency: 'INR',
    });

    const list = await authed(request(app).get('/api/v1/submissions'), recruiterToken).query({
      requirement_id: requirement.id,
      limit: 100,
    });
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
    expect(list.body.data.every((s) => s.requirement.id === requirement.id)).toBe(true);
  });
});

describe('account pipeline board (list by account)', () => {
  test('lists only submissions whose requirement belongs to the account', async () => {
    const sales = await createUser({ role: 'sales' });
    const { access_token: otherSalesToken } = await loginAs(sales);
    const otherAccount = await createActiveClientAccount(sales.id);
    const otherReq = await createRequirement(otherSalesToken, otherAccount.id, { seats_total: 1 });
    const otherSeats = await authed(request(app).get(`/api/v1/requirements/${otherReq.id}/seats`), otherSalesToken);
    const otherProfile = await createProfile(recruiterToken, { name: 'Other Account Candidate' });
    await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: otherSeats.body.data[0].id,
      profile_id: otherProfile.id,
      proposed_rate: 80,
      proposed_rate_currency: 'INR',
      vendor_rate: 50,
      vendor_rate_currency: 'INR',
    });

    const list = await authed(request(app).get('/api/v1/submissions'), recruiterToken).query({
      account_id: accountId,
      limit: 100,
    });
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    expect(list.body.data.every((s) => s.requirement.id === requirement.id)).toBe(true);
    expect(list.body.data.some((s) => s.requirement.id === otherReq.id)).toBe(false);
  });
});
