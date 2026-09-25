/**
 * canManageInterviewRound scoping: recruiter (submission owner) can log any round type;
 * sales (requirement owner) can only log client-facing rounds; a sales user who does not
 * own the requirement, or a recruiter who does not own the submission, is forbidden.
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
let otherSalesToken;
let recruiterToken;
let otherRecruiterToken;
let submissionId;

beforeEach(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  const otherSales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  const otherRecruiter = await createUser({ role: 'recruiter' });
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: otherSalesToken } = await loginAs(otherSales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  ({ access_token: otherRecruiterToken } = await loginAs(otherRecruiter));

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

function roundPayload(round_type) {
  return { round_type, scheduled_at: new Date().toISOString() };
}

describe('interview round management scoping', () => {
  test('recruiter (submission owner) can add any round type', async () => {
    const res = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      recruiterToken
    ).send(roundPayload('internal_r1'));
    expect(res.status).toBe(201);
  });

  test('a different recruiter cannot add a round to a submission they do not own', async () => {
    const res = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      otherRecruiterToken
    ).send(roundPayload('internal_r1'));
    expect(res.status).toBe(403);
  });

  test('sales (requirement owner) can add client-facing rounds but not internal rounds', async () => {
    const clientRound = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      salesToken
    ).send(roundPayload('client_r1'));
    expect(clientRound.status).toBe(201);

    const hrRound = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      salesToken
    ).send(roundPayload('hr_cto_ceo'));
    expect(hrRound.status).toBe(201);

    const internalRound = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      salesToken
    ).send(roundPayload('internal_r1'));
    expect(internalRound.status).toBe(403);
  });

  test('sales who does not own the requirement is forbidden even for client rounds', async () => {
    const res = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      otherSalesToken
    ).send(roundPayload('client_r1'));
    expect(res.status).toBe(403);
  });

  test('sales can update a client round they added; round_type stays immutable', async () => {
    const create = await authed(
      request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`),
      salesToken
    ).send(roundPayload('client_r2'));
    expect(create.status).toBe(201);

    const patch = await authed(
      request(app).patch(`/api/v1/interview-rounds/${create.body.data.id}`),
      salesToken
    ).send({ result: 'pass', feedback: 'Client liked the candidate.' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.feedback).toBe('Client liked the candidate.');
  });
});
