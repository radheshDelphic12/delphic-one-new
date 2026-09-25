/**
 * Recruiter list/get scoping for submissions (candidate pipeline).
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
let otherRecruiterToken;
let requirement;
let seatId;
let ownSubmissionId;
let otherSubmissionId;

beforeEach(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter', name: 'Recruiter One' });
  const otherRecruiter = await createUser({ role: 'recruiter', name: 'Recruiter Two' });
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  ({ access_token: otherRecruiterToken } = await loginAs(otherRecruiter));

  const account = await createActiveClientAccount(sales.id);
  requirement = await createRequirement(salesToken, account.id, { seats_total: 2 });
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
  seatId = seats.body.data[0].id;

  const ownProfile = await createProfile(recruiterToken);
  const otherProfile = await createProfile(otherRecruiterToken);

  const ownCreated = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
    requirement_seat_id: seatId,
    profile_id: ownProfile.id,
    proposed_rate: 100,
    proposed_rate_currency: 'INR',
  });
  ownSubmissionId = ownCreated.body.data.id;

  const otherSeatId = seats.body.data[1]?.id || seatId;
  const otherCreated = await authed(request(app).post('/api/v1/submissions'), otherRecruiterToken).send({
    requirement_seat_id: otherSeatId,
    profile_id: otherProfile.id,
    proposed_rate: 110,
    proposed_rate_currency: 'INR',
  });
  otherSubmissionId = otherCreated.body.data.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Recruiter submission scoping', () => {
  test('recruiter list returns only their own submissions', async () => {
    const res = await authed(request(app).get('/api/v1/submissions'), recruiterToken);
    expect(res.status).toBe(200);
    const ids = (res.body.data || []).map((row) => row.id);
    expect(ids).toContain(ownSubmissionId);
    expect(ids).not.toContain(otherSubmissionId);
  });

  test('recruiter list with requirement_id still scopes to submitted_by', async () => {
    const res = await authed(
      request(app).get('/api/v1/submissions').query({ requirement_id: requirement.id }),
      recruiterToken
    );
    expect(res.status).toBe(200);
    const ids = (res.body.data || []).map((row) => row.id);
    expect(ids).toContain(ownSubmissionId);
    expect(ids).not.toContain(otherSubmissionId);
  });

  test('recruiter cannot get another recruiter submission by id', async () => {
    const res = await authed(request(app).get(`/api/v1/submissions/${otherSubmissionId}`), recruiterToken);
    expect(res.status).toBe(403);
  });

  test('sales list is not auto-scoped to submitted_by', async () => {
    const res = await authed(request(app).get('/api/v1/submissions'), salesToken);
    expect(res.status).toBe(200);
    const ids = (res.body.data || []).map((row) => row.id);
    expect(ids).toContain(ownSubmissionId);
    expect(ids).toContain(otherSubmissionId);
  });
});
