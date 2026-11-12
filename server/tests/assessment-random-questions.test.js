// A test can give each candidate a random, shuffled subset of its questions: the pick is fixed on the first open, scored and
// reviewed against that pick, and a test without the setting behaves as before.
const crypto = require('crypto');
const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');
const service = require('../src/modules/assessments/assessments.service');

let adminToken;
let questionIds;

beforeEach(async () => {
  await cleanDatabase();
  await prisma.assessmentAttempt.deleteMany();
  await prisma.assessmentTest.deleteMany();
  await prisma.assessmentQuestion.deleteMany();
  const admin = await createUser({ role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  questionIds = [];
  for (let i = 1; i <= 12; i += 1) {
    const res = await authed(request(app).post('/api/v1/assessments/questions'), adminToken).send({
      category: 'aptitude', text: `Question ${i}`, options: [{ text: 'wrong', marks: 0 }, { text: 'right', marks: 1 }],
    });
    questionIds.push(res.body.data.id);
  }
});
afterAll(async () => {
  await prisma.$disconnect();
});

const makeTest = (extra = {}) =>
  authed(request(app).post('/api/v1/assessments/tests'), adminToken).send({ name: 'Screening', pass_percentage: 50, question_ids: questionIds, ...extra });
const makeAttempt = async (testId) =>
  prisma.assessmentAttempt.create({ data: { token: crypto.randomBytes(12).toString('hex'), test_id: testId, candidate_name: 'Cand', pass_percentage: 50, expires_at: new Date(Date.now() + 86400000) } });
const open = (token) => request(app).get(`/api/v1/public/assessments/${token}`);

test('the pick helper returns the asked number, without repeats, from the pool; no number keeps the order', () => {
  const picked = service.pickQuestionIds(questionIds, 5);
  expect(picked).toHaveLength(5);
  expect(new Set(picked).size).toBe(5);
  expect(picked.every((id) => questionIds.includes(id))).toBe(true);
  expect(service.pickQuestionIds(questionIds, null)).toEqual(questionIds);
  expect(service.pickQuestionIds(questionIds, 12).slice().sort()).toEqual(questionIds.slice().sort());
});

test('an admin sets questions per candidate; it cannot exceed the pool, and can be cleared', async () => {
  expect((await makeTest({ questions_per_candidate: 13 })).status).toBe(400);
  const made = await makeTest({ questions_per_candidate: 10 });
  expect(made.status).toBe(201);
  expect(made.body.data.questions_per_candidate).toBe(10);
  const id = made.body.data.id;
  expect((await authed(request(app).patch(`/api/v1/assessments/tests/${id}`), adminToken).send({ questions_per_candidate: 20 })).status).toBe(400);
  // shrinking the pool below the number is refused too
  expect((await authed(request(app).patch(`/api/v1/assessments/tests/${id}`), adminToken).send({ question_ids: questionIds.slice(0, 4) })).status).toBe(400);
  const cleared = await authed(request(app).patch(`/api/v1/assessments/tests/${id}`), adminToken).send({ questions_per_candidate: null });
  expect(cleared.status).toBe(200);
  expect(cleared.body.data.questions_per_candidate).toBeNull();
});

test('each candidate gets a random subset, fixed on first open, scored and reviewed on that subset', async () => {
  const made = await makeTest({ questions_per_candidate: 10 });
  const a = await makeAttempt(made.body.data.id);
  const b = await makeAttempt(made.body.data.id);

  const first = await open(a.token);
  expect(first.status).toBe(200);
  const shown = first.body.data.questions.map((q) => q.id);
  expect(shown).toHaveLength(10);
  expect(new Set(shown).size).toBe(10);
  // a refresh shows the same questions in the same order
  expect((await open(a.token)).body.data.questions.map((q) => q.id)).toEqual(shown);
  expect((await prisma.assessmentAttempt.findUnique({ where: { id: a.id } })).question_ids).toEqual(shown);

  // a second candidate is drawn independently (twelve questions, ten each: identical order is vanishingly unlikely)
  const other = (await open(b.token)).body.data.questions.map((q) => q.id);
  expect(other).toHaveLength(10);
  expect(other).not.toEqual(shown);

  // answering all ten correctly scores 100% even though the test has twelve questions
  const answers = Object.fromEntries(shown.map((id) => [id, 1]));
  expect((await request(app).post(`/api/v1/public/assessments/${a.token}/submit`).send({ answers })).status).toBe(200);
  const done = await prisma.assessmentAttempt.findUnique({ where: { id: a.id } });
  expect(Number(done.score_percent)).toBe(100);
  expect(done.passed).toBe(true);

  const review = await authed(request(app).get(`/api/v1/assessments/attempts/${a.id}/review`), adminToken);
  expect(review.status).toBe(200);
  expect(review.body.data.questions.map((q) => q.id)).toEqual(shown);
  expect(review.body.data.summary.total).toBe(10);
});

test('a test without the setting still gives every question in order', async () => {
  const made = await makeTest();
  expect(made.body.data.questions_per_candidate).toBeNull();
  const a = await makeAttempt(made.body.data.id);
  expect((await open(a.token)).body.data.questions.map((q) => q.id)).toEqual(questionIds);
  expect((await prisma.assessmentAttempt.findUnique({ where: { id: a.id } })).question_ids).toBeNull();
});
