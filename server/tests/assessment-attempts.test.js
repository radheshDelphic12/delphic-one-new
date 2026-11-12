/**
 * Test link management: one live attempt per submission + round, admin delete / retake, the attempt limit,
 * JD-to-skills prefill (and the skill dropdown), and the tests & interviews analytics counts.
 */
const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createActiveClientAccount,
  createProfile,
  authed,
} = require('./helpers');

let salesToken;
let recruiterToken;
let adminToken;
let recruiter;
let account;
let testId;
let questionId;

beforeEach(async () => {
  await cleanDatabase();
  // attempts have no foreign key to submissions, so the truncate does not clear them
  await prisma.assessmentAttempt.deleteMany();
  await prisma.assessmentTest.deleteMany();
  await prisma.assessmentQuestion.deleteMany();
  const sales = await createUser({ role: 'sales' });
  recruiter = await createUser({ role: 'recruiter' });
  const admin = await createUser({ role: 'admin' });
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  ({ access_token: adminToken } = await loginAs(admin));
  account = await createActiveClientAccount(sales.id);

  const q = await authed(request(app).post('/api/v1/assessments/questions'), adminToken).send({
    category: 'aptitude', text: 'Pick the right one', options: [{ text: 'wrong', marks: 0 }, { text: 'right', marks: 1 }],
  });
  questionId = q.body.data.id;
  const t = await authed(request(app).post('/api/v1/assessments/tests'), adminToken).send({
    name: 'Screening Round Test', pass_percentage: 60, question_ids: [questionId],
  });
  testId = t.body.data.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeRequirement(extra = {}) {
  const res = await authed(request(app).post('/api/v1/requirements'), salesToken).send({
    account_id: account.id, title: 'Backend Developer', req_type: 'internal_hiring', hiring_track: 'technical', ...extra,
  });
  return res.body.data;
}

async function makeSubmission(requirementId, token = recruiterToken) {
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirementId}/seats`), salesToken);
  const profile = await createProfile(recruiterToken);
  const sub = await authed(request(app).post('/api/v1/submissions'), token).send({
    requirement_seat_id: seats.body.data[0].id, profile_id: profile.id, proposed_rate: 100, proposed_rate_currency: 'INR',
  });
  return sub.body.data.id;
}

const send = (submissionId, extra = {}, token = recruiterToken) =>
  authed(request(app).post('/api/v1/assessments/attempts'), token).send({ test_id: testId, submission_id: submissionId, ...extra });
const list = async (submissionId) => (await authed(request(app).get(`/api/v1/assessments/attempts?submission_id=${submissionId}`), recruiterToken)).body.data;
const tokenOf = (link) => link.split('/').pop();
const openLink = (link) => request(app).get(`/api/v1/public/assessments/${tokenOf(link)}`);
const submitLink = (link, pick = 1) => request(app).post(`/api/v1/public/assessments/${tokenOf(link)}/submit`).send({ answers: { [questionId]: pick } });
const setLimit = (n) => authed(request(app).put('/api/v1/assessments/settings'), adminToken).send({ assessment_max_attempts: n });
const summary = async (query = '') => (await authed(request(app).get(`/api/v1/assessments/analytics/summary${query}`), adminToken)).body.data;

describe('one live attempt per submission and round', () => {
  test('a new link replaces an unopened one; mid-test and scored attempts block a new send', async () => {
    const req = await makeRequirement();
    const sub = await makeSubmission(req.id);

    const a = await send(sub);
    expect(a.status).toBe(201);
    const b = await send(sub);
    expect(b.status).toBe(201);
    expect(b.body.data.superseded).toBe(1);

    const state = await list(sub);
    expect(state.items.filter((x) => x.is_live)).toHaveLength(1);
    expect(state.live_id).toBe(b.body.data.id);
    expect(state.items.find((x) => x.id === a.body.data.id).view_status).toBe('superseded');
    // the replaced link no longer opens
    expect((await openLink(a.body.data.link)).status).toBe(410);

    // the candidate opens the live link: sending again is refused
    expect((await openLink(b.body.data.link)).status).toBe(200);
    const blocked = await send(sub);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/middle of this test/i);

    // scored: no new send either
    expect((await submitLink(b.body.data.link)).status).toBe(200);
    const done = await send(sub);
    expect(done.status).toBe(409);
    expect(done.body.message).toMatch(/already has a scored test/i);
    const after = await list(sub);
    expect(after.items.find((x) => x.id === b.body.data.id)).toMatchObject({ view_status: 'scored', score_percent: 100, passed: true });
  });

  test('legacy duplicate links (before this rule) are retired by the next send', async () => {
    const req = await makeRequirement();
    const sub = await makeSubmission(req.id);
    await setLimit(0);
    const test = await prisma.assessmentTest.findUnique({ where: { id: testId } });
    for (let i = 0; i < 3; i += 1) {
      await prisma.assessmentAttempt.create({
        data: { token: `legacy${i}`, test_id: testId, submission_id: sub, candidate_name: 'X', pass_percentage: test.pass_percentage, expires_at: new Date(Date.now() + 86400000) },
      });
    }
    const r = await send(sub);
    expect(r.status).toBe(201);
    expect(r.body.data.superseded).toBe(3);
    expect((await list(sub)).items.filter((x) => x.is_live)).toHaveLength(1);
  });
});

describe('deleting an attempt and retaking', () => {
  test('only an admin deletes; the audit entry records who and why; the candidate can retake', async () => {
    const req = await makeRequirement();
    const sub = await makeSubmission(req.id);
    const first = await send(sub);
    await submitLink(first.body.data.link);
    expect((await send(sub)).status).toBe(409);

    const id = first.body.data.id;
    expect((await authed(request(app).delete(`/api/v1/assessments/attempts/${id}`), recruiterToken).send({})).status).toBe(403);
    const del = await authed(request(app).delete(`/api/v1/assessments/attempts/${id}`), adminToken).send({ reason: 'Candidate had a network problem' });
    expect(del.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({ where: { entity_type: 'assessment_attempt', entity_id: id } });
    expect(audit).toMatchObject({ action: 'delete_attempt', reason: 'Candidate had a network problem' });
    expect(audit.actor_id).toBeTruthy();
    expect(audit.snapshot).toMatchObject({ status: 'submitted', score_percent: 100 });

    // gone from the list, the link is dead, and a retake can be sent
    expect((await list(sub)).items).toHaveLength(0);
    expect((await openLink(first.body.data.link)).status).toBe(404);
    expect((await send(sub)).status).toBe(201);
    expect((await authed(request(app).delete(`/api/v1/assessments/attempts/${id}`), adminToken).send({})).status).toBe(404);
  });

  test('an admin can extend an unfinished link, and it is audited', async () => {
    const req = await makeRequirement();
    const sub = await makeSubmission(req.id);
    const a = await send(sub);
    await prisma.assessmentAttempt.update({ where: { id: a.body.data.id }, data: { expires_at: new Date(Date.now() - 1000) } });
    expect((await openLink(a.body.data.link)).status).toBe(410);
    expect((await authed(request(app).post(`/api/v1/assessments/attempts/${a.body.data.id}/extend`), recruiterToken).send({})).status).toBe(403);
    expect((await authed(request(app).post(`/api/v1/assessments/attempts/${a.body.data.id}/extend`), adminToken).send({ days: 3 })).status).toBe(200);
    expect((await openLink(a.body.data.link)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entity_id: a.body.data.id, action: 'extend_attempt' } })).toBe(1);
    // a scored attempt cannot be extended
    await submitLink(a.body.data.link);
    expect((await authed(request(app).post(`/api/v1/assessments/attempts/${a.body.data.id}/extend`), adminToken).send({})).status).toBe(409);
  });
});

describe('attempt limit per submission', () => {
  test('defaults to 3, is an admin setting, and counts per submission', async () => {
    const req = await makeRequirement();
    const sub = await makeSubmission(req.id);
    const other = await makeSubmission(req.id);

    expect((await authed(request(app).get('/api/v1/assessments/settings'), recruiterToken)).body.data.assessment_max_attempts).toBe(3);
    expect((await setLimit(2)).status).toBe(200);
    expect((await authed(request(app).put('/api/v1/assessments/settings'), recruiterToken).send({ assessment_max_attempts: 9 })).status).toBe(403);

    expect((await send(sub)).status).toBe(201);
    expect((await send(sub)).status).toBe(201); // replaces the first link, still counts as a second attempt
    const state = await list(sub);
    expect(state).toMatchObject({ used: 2, limit: 2, remaining: 0 });

    const over = await send(sub);
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/2 of 2/);
    // a recruiter cannot override; an admin can
    expect((await send(sub, { override_limit: true })).status).toBe(409);
    expect((await send(sub, { override_limit: true }, adminToken)).status).toBe(201);
    // another submission has its own count
    expect((await send(other)).status).toBe(201);
  });

  test('deleting an attempt frees a slot; 0 means no limit', async () => {
    const req = await makeRequirement();
    const sub = await makeSubmission(req.id);
    await setLimit(1);
    const a = await send(sub);
    expect((await send(sub)).status).toBe(409);
    await authed(request(app).delete(`/api/v1/assessments/attempts/${a.body.data.id}`), adminToken).send({});
    expect((await send(sub)).status).toBe(201);

    await setLimit(0);
    for (let i = 0; i < 4; i += 1) expect((await send(sub)).status).toBe(201);
    expect((await list(sub)).remaining).toBeNull();
  });
});

describe('skill ratings prefilled from the JD', () => {
  test('the plan carries the JD stacks; empty and repeated entries are handled', async () => {
    const req = await makeRequirement();
    await prisma.requirement.update({ where: { id: req.id }, data: { primary_tech_stack: ['React', ' Node.js ', 'react', ''], secondary_tech_stack: ['AWS', 'node.js'] } });
    const sub = await makeSubmission(req.id);
    const plan = (await authed(request(app).get(`/api/v1/submissions/${sub}/interview-plan`), recruiterToken)).body.data;
    expect(plan.jd_skills).toEqual({ primary: ['React', 'Node.js'], secondary: ['AWS'] });

    // an empty secondary stack (e.g. HR Recruiter) shows only what exists
    await prisma.requirement.update({ where: { id: req.id }, data: { primary_tech_stack: ['Sourcing'], secondary_tech_stack: [] } });
    const again = (await authed(request(app).get(`/api/v1/submissions/${sub}/interview-plan`), recruiterToken)).body.data;
    expect(again.jd_skills).toEqual({ primary: ['Sourcing'], secondary: [] });

    await prisma.requirement.update({ where: { id: req.id }, data: { primary_tech_stack: [], secondary_tech_stack: [] } });
    const none = (await authed(request(app).get(`/api/v1/submissions/${sub}/interview-plan`), recruiterToken)).body.data;
    expect(none.jd_skills).toEqual({ primary: [], secondary: [] });
  });

  test('a skill an interviewer adds shows up in the dropdown; ratings accept 0 to 10', async () => {
    const req = await makeRequirement();
    await prisma.requirement.update({ where: { id: req.id }, data: { primary_tech_stack: ['React'] } });
    const sub = await makeSubmission(req.id);
    const plan = (await authed(request(app).get(`/api/v1/submissions/${sub}/interview-plan`), recruiterToken)).body.data;
    const step = plan.steps[0];

    const before = (await authed(request(app).get('/api/v1/interview-templates/skill-options'), recruiterToken)).body.data;
    expect(before).toContain('React');
    expect(before).not.toContain('Zig');

    const round = await authed(request(app).post(`/api/v1/submissions/${sub}/interview-rounds`), recruiterToken).send({
      template_round_id: step.template_round_id, scheduled_at: new Date().toISOString(), result: 'pass', feedback: 'ok',
      skill_ratings: [{ skill_name: 'React', rating: 10 }, { skill_name: 'Zig', rating: 0 }],
    });
    expect(round.status).toBe(201);
    const after = (await authed(request(app).get('/api/v1/interview-templates/skill-options'), recruiterToken)).body.data;
    expect(after).toContain('Zig');

    const bad = await authed(request(app).post(`/api/v1/submissions/${sub}/interview-rounds`), recruiterToken).send({
      template_round_id: step.template_round_id, scheduled_at: new Date().toISOString(), skill_ratings: [{ skill_name: 'React', rating: 11 }],
    });
    expect(bad.status).toBe(422);
  });
});

describe('tests & interviews analytics', () => {
  test('counts live attempts only: deleted and replaced ones are excluded, a retake counts once', async () => {
    const req = await makeRequirement();
    const sub1 = await makeSubmission(req.id);
    const sub2 = await makeSubmission(req.id);
    await setLimit(0);

    const a1 = await send(sub1);
    await send(sub1); // replaces a1 (unopened)
    const a2 = await send(sub2);
    await openLink(a2.body.data.link);
    let s = await summary();
    expect(s.tests).toMatchObject({ sent: 2, not_opened: 1, in_progress: 1, started: 1, completed: 0 });

    await submitLink(a2.body.data.link, 1); // 100%: passed
    s = await summary();
    expect(s.tests).toMatchObject({ sent: 2, completed: 1, passed: 1, failed: 0, pass_rate: 100 });

    // delete the scored result and retake with a failing answer: still two submissions, one live attempt each
    await authed(request(app).delete(`/api/v1/assessments/attempts/${a2.body.data.id}`), adminToken).send({});
    s = await summary();
    expect(s.tests).toMatchObject({ sent: 1, completed: 0 });
    const retake = await send(sub2);
    await submitLink(retake.body.data.link, 0);
    s = await summary();
    expect(s.tests).toMatchObject({ sent: 2, completed: 1, passed: 0, failed: 1, pass_rate: 0 });
    expect(a1.status).toBe(201);
  });

  test('interviews: scheduled, completed and cancelled; filters narrow both sections; records drill down', async () => {
    const req1 = await makeRequirement({ title: 'Requirement One' });
    const req2 = await makeRequirement({ title: 'Requirement Two' });
    const sub1 = await makeSubmission(req1.id);
    const sub2 = await makeSubmission(req2.id);
    await send(sub1);
    await send(sub2);

    const plan = (await authed(request(app).get(`/api/v1/submissions/${sub1}/interview-plan`), recruiterToken)).body.data;
    const stepId = plan.steps[0].template_round_id;
    const done = await authed(request(app).post(`/api/v1/submissions/${sub1}/interview-rounds`), recruiterToken).send({
      template_round_id: stepId, scheduled_at: new Date().toISOString(), result: 'pass', feedback: 'good', skill_ratings: [{ skill_name: 'React', rating: 9 }],
    });
    expect(done.status).toBe(201);
    const plan2 = (await authed(request(app).get(`/api/v1/submissions/${sub2}/interview-plan`), recruiterToken)).body.data;
    const open = await authed(request(app).post(`/api/v1/submissions/${sub2}/interview-rounds`), recruiterToken).send({
      template_round_id: plan2.steps[0].template_round_id, scheduled_at: new Date().toISOString(),
    });
    expect(open.status).toBe(201);
    await authed(request(app).post(`/api/v1/interviews/${open.body.data.id}/cancel`), recruiterToken).send({ reason: 'Candidate unavailable' });

    let s = await summary();
    expect(s.interviews).toMatchObject({ scheduled: 1, completed: 1, pending: 0, cancelled: 1 });
    expect(s.tests.sent).toBe(2);

    s = await summary(`?requirement_id=${req2.id}`);
    expect(s.tests.sent).toBe(1);
    expect(s.interviews).toMatchObject({ scheduled: 0, cancelled: 1 });
    s = await summary(`?recruiter_id=${recruiter.id}&account_id=${account.id}`);
    expect(s.tests.sent).toBe(2);
    s = await summary('?from=2000-01-01&to=2000-01-02');
    expect(s.tests.sent).toBe(0);
    expect(s.interviews.scheduled).toBe(0);

    const tests = (await authed(request(app).get(`/api/v1/assessments/analytics/records?kind=tests&requirement_id=${req1.id}`), adminToken)).body.data;
    expect(tests.total).toBe(1);
    expect(tests.items[0]).toMatchObject({ requirement: 'Requirement One', client: account.name, status: 'not_opened', round: expect.any(String) });
    expect(tests.items[0].recruiter).toBeTruthy();
    const rounds = (await authed(request(app).get('/api/v1/assessments/analytics/records?kind=interviews'), adminToken)).body.data;
    expect(rounds.total).toBe(2);
    expect(rounds.items.map((r) => r.status).sort()).toEqual(['cancelled', 'completed']);

    const filters = (await authed(request(app).get('/api/v1/assessments/analytics/filters'), adminToken)).body.data;
    expect(filters.requirements.map((r) => r.name).sort()).toEqual(['Requirement One', 'Requirement Two']);
    expect(filters.clients).toHaveLength(1);
    expect(filters.recruiters.length).toBeGreaterThan(0);
  });
});

describe('e-mail setting and answer review', () => {
  test('the test link is e-mailed only when the company setting is on (default off)', async () => {
    const req = await makeRequirement();
    const sub = await makeSubmission(req.id);
    await prisma.profile.updateMany({ data: { email: 'cand@test.local' } });
    expect((await authed(request(app).get('/api/v1/assessments/settings'), recruiterToken)).body.data.assessment_email_candidate).toBe(false);
    expect((await send(sub)).status).toBe(201);
    expect(await prisma.emailOutbox.count({ where: { kind: 'assessment_invite' } })).toBe(0);

    expect((await authed(request(app).put('/api/v1/assessments/settings'), recruiterToken).send({ assessment_email_candidate: true })).status).toBe(403);
    const on = await authed(request(app).put('/api/v1/assessments/settings'), adminToken).send({ assessment_email_candidate: true });
    expect(on.body.data).toMatchObject({ assessment_email_candidate: true, assessment_max_attempts: 3 });
    expect((await send(sub)).status).toBe(201);
    expect(await prisma.emailOutbox.count({ where: { kind: 'assessment_invite' } })).toBe(1);
  });

  test('a submitted attempt can be opened to see each answer marked right, partly right or wrong', async () => {
    const req = await makeRequirement();
    const sub = await makeSubmission(req.id);
    const q2 = (await authed(request(app).post('/api/v1/assessments/questions'), adminToken).send({
      category: 'behavioural', text: 'A teammate misses a deadline', options: [{ text: 'Ignore', marks: 0 }, { text: 'Ask why', marks: 2 }, { text: 'Help plan', marks: 4 }],
    })).body.data;
    const q3 = (await authed(request(app).post('/api/v1/assessments/questions'), adminToken).send({
      category: 'reasoning', text: 'Next in 2, 4, 8?', options: [{ text: '10', marks: 0 }, { text: '16', marks: 1 }],
    })).body.data;
    const t2 = (await authed(request(app).post('/api/v1/assessments/tests'), adminToken).send({ name: 'Three question test', pass_percentage: 50, question_ids: [questionId, q2.id, q3.id] })).body.data;
    const sent = await authed(request(app).post('/api/v1/assessments/attempts'), recruiterToken).send({ test_id: t2.id, submission_id: sub });
    const id = sent.body.data.id;

    // nothing to review before the candidate submits
    expect((await authed(request(app).get(`/api/v1/assessments/attempts/${id}/review`), recruiterToken)).status).toBe(409);

    // q1 right, q2 middle option (partly right), q3 not answered
    const token = tokenOf(sent.body.data.link);
    const res = await request(app).post(`/api/v1/public/assessments/${token}/submit`).send({ answers: { [questionId]: 1, [q2.id]: 1 } });
    expect(res.status).toBe(200);

    const review = (await authed(request(app).get(`/api/v1/assessments/attempts/${id}/review`), recruiterToken)).body.data;
    expect(review.summary).toEqual({ total: 3, correct: 1, partial: 1, wrong: 0, not_answered: 1 });
    expect(review.questions.map((q) => q.result)).toEqual(['correct', 'partial', 'not_answered']);
    expect(review.questions[1]).toMatchObject({ marks_got: 2, marks_full: 4 });
    expect(review.questions[1].options.map((o) => [o.picked, o.best])).toEqual([[false, false], [true, false], [false, true]]);
    expect(review.score_percent).toBe(50); // (1 + 2 + 0) of (1 + 4 + 1) marks, rounded
    // the candidate-facing link never exposes marks or answers
    expect((await request(app).get(`/api/v1/public/assessments/${token}`)).status).toBe(410);
    expect((await request(app).get(`/api/v1/assessments/attempts/${id}/review`)).status).toBe(401);

    // a wrong pick is marked wrong
    await authed(request(app).delete(`/api/v1/assessments/attempts/${id}`), adminToken).send({});
    const retake = await authed(request(app).post('/api/v1/assessments/attempts'), recruiterToken).send({ test_id: t2.id, submission_id: sub });
    await request(app).post(`/api/v1/public/assessments/${tokenOf(retake.body.data.link)}/submit`).send({ answers: { [questionId]: 0, [q2.id]: 0, [q3.id]: 0 } });
    const wrong = (await authed(request(app).get(`/api/v1/assessments/attempts/${retake.body.data.id}/review`), recruiterToken)).body.data;
    expect(wrong.summary).toMatchObject({ correct: 0, wrong: 3 });
    // a deleted attempt cannot be reviewed
    expect((await authed(request(app).get(`/api/v1/assessments/attempts/${id}/review`), recruiterToken)).status).toBe(404);
  });
});
