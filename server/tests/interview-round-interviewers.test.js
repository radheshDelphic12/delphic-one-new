/**
 * Internal interview rounds: multiselect interviewers from active users.
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

let recruiterToken;
let submissionId;
let interviewerOne;
let interviewerTwo;
let inactiveUser;

beforeEach(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  interviewerOne = await createUser({ role: 'admin', name: 'Interviewer One' });
  interviewerTwo = await createUser({ role: 'recruiter', name: 'Interviewer Two' });
  inactiveUser = await createUser({ role: 'recruiter', name: 'Inactive User', active: false });
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  const { access_token: salesToken } = await loginAs(sales);

  const account = await createActiveClientAccount(sales.id);
  const requirement = await createRequirement(salesToken, account.id);
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
  const profile = await createProfile(recruiterToken);

  const sub = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
    requirement_seat_id: seats.body.data[0].id,
    profile_id: profile.id,
    proposed_rate: 100,
    proposed_rate_currency: 'INR',
  });
  submissionId = sub.body.data.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('internal interview round interviewers', () => {
  test('create internal round with multiple active interviewers', async () => {
    const res = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      recruiterToken
    ).send({
      round_type: 'internal_r1',
      scheduled_at: new Date().toISOString(),
      interviewer_ids: [interviewerOne.id, interviewerTwo.id],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.interviewers).toHaveLength(2);
    expect(res.body.data.interviewers.map((i) => i.id).sort()).toEqual([interviewerOne.id, interviewerTwo.id].sort());
  });

  test('rejects inactive or unknown interviewer ids', async () => {
    const inactiveRes = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      recruiterToken
    ).send({
      round_type: 'internal_r2',
      scheduled_at: new Date().toISOString(),
      interviewer_ids: [inactiveUser.id],
    });
    expect(inactiveRes.status).toBe(400);
    expect(inactiveRes.body.message).toMatch(/inactive/i);

    const unknownRes = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      recruiterToken
    ).send({
      round_type: 'internal_r2',
      scheduled_at: new Date().toISOString(),
      interviewer_ids: ['00000000-0000-4000-8000-000000000099'],
    });
    expect(unknownRes.status).toBe(400);
  });

  test('patch replaces interviewers on an internal round', async () => {
    const create = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      recruiterToken
    ).send({
      round_type: 'internal_r1',
      scheduled_at: new Date().toISOString(),
      interviewer_ids: [interviewerOne.id],
    });
    expect(create.status).toBe(201);

    const patch = await authed(
      request(app).patch(`/api/v1/interview-rounds/${create.body.data.id}`),
      recruiterToken
    ).send({ interviewer_ids: [interviewerTwo.id] });
    expect(patch.status).toBe(200);
    expect(patch.body.data.interviewers).toHaveLength(1);
    expect(patch.body.data.interviewers[0].id).toBe(interviewerTwo.id);
  });

  test('submission detail includes interviewers on internal rounds', async () => {
    await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      recruiterToken
    ).send({
      round_type: 'internal_r1',
      scheduled_at: new Date().toISOString(),
      interviewer_ids: [interviewerOne.id],
    });

    const detail = await authed(request(app).get(`/api/v1/submissions/${submissionId}`), recruiterToken);
    expect(detail.status).toBe(200);
    expect(detail.body.data.interview_rounds[0].interviewers[0].name).toBe('Interviewer One');
  });
});
