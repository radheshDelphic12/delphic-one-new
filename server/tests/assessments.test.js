/**
 * Assessments: team-written questions, public-link test, auto scoring, pass %; candidate feedback message.
 */
const {
  app, prisma, request, cleanDatabase, createUser, loginAs, createActiveClientAccount, createRequirement, createProfile, authed,
} = require('./helpers');

let adminToken;
let recruiterToken;
let submissionId;

beforeEach(async () => {
  await cleanDatabase();
  // DELETE, not TRUNCATE ... CASCADE: that would also wipe the seeded interview template rounds (they point at tests).
  await prisma.assessmentAttempt.deleteMany();
  await prisma.assessmentTest.deleteMany();
  await prisma.assessmentQuestion.deleteMany();
  const sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  const admin = await createUser({ role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  const { access_token: salesToken } = await loginAs(sales);
  const account = await createActiveClientAccount(sales.id);
  const requirement = await createRequirement(salesToken, account.id);
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
  const profile = await createProfile(recruiterToken, { email: 'cand@test.local' });
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

const makeQuestion = (category, text, marks) =>
  authed(request(app).post('/api/v1/assessments/questions'), adminToken).send({
    category,
    text,
    options: marks.map((m, i) => ({ text: `Option ${i + 1}`, marks: m })),
  });

describe('assessments', () => {
  test('team builds a test; the candidate takes it from the public link and is scored', async () => {
    const q1 = (await makeQuestion('aptitude', '2 + 2 = ?', [0, 0, 1])).body.data;
    const q2 = (await makeQuestion('behavioural', 'A teammate misses a deadline...', [0, 2, 4])).body.data;
    const test = await authed(request(app).post('/api/v1/assessments/tests'), adminToken).send({
      name: 'Screening test', pass_percentage: 60, duration_minutes: 20, question_ids: [q1.id, q2.id],
    });
    expect(test.status).toBe(201);
    expect(test.body.data.questions).toHaveLength(2);

    const invite = await authed(request(app).post('/api/v1/assessments/attempts'), recruiterToken).send({ test_id: test.body.data.id, submission_id: submissionId });
    expect(invite.status).toBe(201);
    const token = invite.body.data.link.split('/assessment/')[1];
    expect(await prisma.emailOutbox.count({ where: { kind: 'assessment_invite' } })).toBe(1);

    // no login; the marks are never sent to the candidate
    const open = await request(app).get(`/api/v1/public/assessments/${token}`);
    expect(open.status).toBe(200);
    expect(open.body.data.questions).toHaveLength(2);
    expect(JSON.stringify(open.body.data)).not.toMatch(/marks/);

    // q1 correct (1/1), q2 middle option (2/4) -> 3/5 = 60% -> passes at 60
    const submit = await request(app).post(`/api/v1/public/assessments/${token}/submit`).send({ answers: { [q1.id]: 2, [q2.id]: 1 } });
    expect(submit.status).toBe(200);
    expect(submit.body.data).toEqual({ submitted: true });
    expect((await request(app).post(`/api/v1/public/assessments/${token}/submit`).send({ answers: {} })).status).toBe(410);

    const attempts = await authed(request(app).get(`/api/v1/assessments/attempts?submission_id=${submissionId}`), recruiterToken);
    expect(attempts.body.data[0]).toMatchObject({ status: 'submitted', score_percent: 60, passed: true });
  });

  test('a score below the test pass mark is a fail', async () => {
    const q = (await makeQuestion('reasoning', 'Pick the odd one', [0, 3])).body.data;
    const test = await authed(request(app).post('/api/v1/assessments/tests'), adminToken).send({ name: 'T', pass_percentage: 70, question_ids: [q.id] });
    const invite = await authed(request(app).post('/api/v1/assessments/attempts'), recruiterToken).send({ test_id: test.body.data.id, submission_id: submissionId });
    const token = invite.body.data.link.split('/assessment/')[1];
    await request(app).post(`/api/v1/public/assessments/${token}/submit`).send({ answers: { [q.id]: 0 } });
    const attempts = await authed(request(app).get(`/api/v1/assessments/attempts?submission_id=${submissionId}`), recruiterToken);
    expect(attempts.body.data[0]).toMatchObject({ score_percent: 0, passed: false });
  });

  test('an unknown token and an empty test are refused', async () => {
    expect((await request(app).get('/api/v1/public/assessments/nope')).status).toBe(404);
    const test = await authed(request(app).post('/api/v1/assessments/tests'), adminToken).send({ name: 'Empty', question_ids: [] });
    const invite = await authed(request(app).post('/api/v1/assessments/attempts'), recruiterToken).send({ test_id: test.body.data.id, submission_id: submissionId });
    expect(invite.status).toBe(400);
  });

  test('the manager can message the candidate that feedback is coming', async () => {
    const res = await authed(request(app).post(`/api/v1/submissions/${submissionId}/candidate-feedback-message`), recruiterToken).send({ note: 'We will call you.' });
    expect(res.status).toBe(200);
    const mail = await prisma.emailOutbox.findFirst({ where: { kind: 'candidate_feedback' } });
    expect(mail.to_email).toBe('cand@test.local');
    expect(mail.body_text).toMatch(/receive it shortly/);
  });
});
