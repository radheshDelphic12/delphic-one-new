/**
 * The person who took a round can write and amend its feedback after it is completed (without scheduling rights), and the team can leave
 * feedback on a finished AI interview.
 */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createActiveClientAccount, createProfile, createInterviewRound, authed } = require('./helpers');

let recruiter;
let admin;
let interviewer; // a plain employee-level user assigned to the round: no scheduling rights
let outsider;
let tokens;
let submissionId;
let seatId;

beforeEach(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  recruiter = await createUser({ role: 'recruiter' });
  admin = await createUser({ role: 'admin' });
  interviewer = await createUser({ role: 'bda', name: 'Round Interviewer' });
  outsider = await createUser({ role: 'bda', name: 'Not On The Round' });
  tokens = {
    sales: (await loginAs(sales)).access_token,
    recruiter: (await loginAs(recruiter)).access_token,
    admin: (await loginAs(admin)).access_token,
    interviewer: (await loginAs(interviewer)).access_token,
    outsider: (await loginAs(outsider)).access_token,
  };
  const account = await createActiveClientAccount(sales.id);
  const req = await authed(request(app).post('/api/v1/requirements'), tokens.sales).send({ account_id: account.id, title: 'Backend Developer', req_type: 'recruitment' });
  seatId = (await authed(request(app).get(`/api/v1/requirements/${req.body.data.id}/seats`), tokens.sales)).body.data[0].id;
  const profile = await createProfile(tokens.recruiter, { name: 'Candidate One' });
  const sub = await authed(request(app).post('/api/v1/submissions'), tokens.recruiter).send({ requirement_seat_id: seatId, profile_id: profile.id, proposed_rate: 100, proposed_rate_currency: 'INR' });
  submissionId = sub.body.data.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const patchRound = (id, body, token) => authed(request(app).patch(`/api/v1/interview-rounds/${id}`), token).send(body);

describe('feedback by the interviewer of a round', () => {
  test('an assigned interviewer adds feedback and a result after the round, and amends it later; they cannot move the interview or touch other rounds', async () => {
    const round = await createInterviewRound(submissionId, { round_type: 'internal_r1', interviewer_ids: [interviewer.id], scheduled_at: new Date(Date.now() - 3600000) });
    const other = await createInterviewRound(submissionId, { round_type: 'internal_r2', interviewer_ids: [admin.id] });

    const first = await patchRound(round.id, { result: 'pass', feedback: 'Strong on Java, clear communication.', rating: 8 }, tokens.interviewer);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ result: 'pass', feedback: 'Strong on Java, clear communication.', rating: 8 });
    expect(first.body.data.completed_at).toBeTruthy();

    // amended after completion
    const second = await patchRound(round.id, { feedback: 'Strong on Java, clear communication. Weak on testing.' }, tokens.interviewer);
    expect(second.status).toBe(200);
    expect(second.body.data.feedback).toContain('Weak on testing');

    // scheduling fields are not theirs: the date stays
    const before = (await prisma.interviewRound.findUnique({ where: { id: round.id } })).scheduled_at.getTime();
    const moved = await patchRound(round.id, { scheduled_at: new Date(Date.now() + 5 * 86400000).toISOString(), feedback: 'Still fine.' }, tokens.interviewer);
    expect(moved.status).toBe(200);
    expect((await prisma.interviewRound.findUnique({ where: { id: round.id } })).scheduled_at.getTime()).toBe(before);

    // somebody who is not on the round gets nothing; nor does the interviewer on another person's round
    expect((await patchRound(round.id, { feedback: 'I was not there' }, tokens.outsider)).status).toBe(403);
    expect((await patchRound(other.id, { feedback: 'not mine' }, tokens.interviewer)).status).toBe(403);
    // the person who manages the round still can
    expect((await patchRound(round.id, { feedback: 'Recruiter note' }, tokens.recruiter)).status).toBe(200);
  });

  test('on a template round the interviewer\'s feedback follows the same completion rules (feedback and ratings are required)', async () => {
    const tpl = await prisma.interviewTemplate.findFirst({ where: { is_active: true, service_types: { has: 'recruitment' } }, include: { rounds: { orderBy: { sort_order: 'asc' } } } });
    const tr = tpl.rounds.find((r) => r.kind !== 'screening_test' && r.rating_required) || tpl.rounds.find((r) => r.kind !== 'screening_test');
    const round = await createInterviewRound(submissionId, { round_type: tr.conducted_by === 'client' ? 'template_client' : 'template_internal', template_round_id: tr.id, interviewer_ids: [interviewer.id] });
    const noFeedback = await patchRound(round.id, { result: 'pass' }, tokens.interviewer);
    expect(noFeedback.status).toBe(400);
    if (tr.rating_required) {
      expect((await patchRound(round.id, { result: 'pass', feedback: 'Good' }, tokens.interviewer)).status).toBe(400);
      const done = await patchRound(round.id, { result: 'pass', feedback: 'Good', skill_ratings: [{ skill_name: 'Java', rating: 8 }] }, tokens.interviewer);
      expect(done.status).toBe(200);
      expect(done.body.data.skill_ratings).toHaveLength(1);
    } else {
      expect((await patchRound(round.id, { result: 'pass', feedback: 'Good' }, tokens.interviewer)).status).toBe(200);
    }
  });
});

describe('feedback on a finished AI interview', () => {
  const makeAi = (status = 'completed') => prisma.aiInterview.create({
    data: { token: `ai-${Date.now()}-${Math.random()}`, submission_id: submissionId, candidate_name: 'Candidate One', status, outcome: 'borderline', pass_percentage: 60, expires_at: new Date(Date.now() + 86400000) },
  });
  const feedback = (id, token, body) => authed(request(app).put(`/api/v1/ai-interviews/${id}/feedback`), token).send(body);

  test('a team member adds feedback once the interview is finished, amends it in place, and each person has their own note', async () => {
    const ai = await makeAi();
    const mine = await feedback(ai.id, tokens.recruiter, { feedback: 'Answers were shallow on system design.' });
    expect(mine.status).toBe(200);
    expect(mine.body.data).toMatchObject({ feedback: 'Answers were shallow on system design.', mine: true, by: { name: expect.any(String) } });
    // amended, not duplicated
    await feedback(ai.id, tokens.recruiter, { feedback: 'Answers were shallow on system design, good on basics.' });
    await feedback(ai.id, tokens.admin, { feedback: 'Fine for a junior role.' });
    const list = (await authed(request(app).get(`/api/v1/ai-interviews/${ai.id}/feedback`), tokens.recruiter)).body.data;
    expect(list).toHaveLength(2);
    expect(list.find((n) => n.mine).feedback).toContain('good on basics');
    // removing takes back only your own
    await authed(request(app).delete(`/api/v1/ai-interviews/${ai.id}/feedback`), tokens.recruiter);
    expect((await authed(request(app).get(`/api/v1/ai-interviews/${ai.id}/feedback`), tokens.admin)).body.data).toHaveLength(1);
    const audits = await prisma.auditLog.count({ where: { entity_type: 'ai_interview', action: 'ai_interview_feedback' } });
    expect(audits).toBe(3);
  });

  test('feedback needs a finished interview and some text, and not every role can write it', async () => {
    const running = await makeAi('started');
    expect((await feedback(running.id, tokens.recruiter, { feedback: 'Too early' })).status).toBe(409);
    const done = await makeAi('pending_review');
    expect((await feedback(done.id, tokens.recruiter, { feedback: 'ok' })).status).toBe(422);
    expect((await feedback(done.id, tokens.recruiter, { feedback: 'Needs a person to decide' })).status).toBe(200);
    expect((await feedback(done.id, tokens.outsider, { feedback: 'Not my role' })).status).toBe(403);
    expect((await feedback('11111111-1111-4111-8111-111111111111', tokens.recruiter, { feedback: 'Nothing here' })).status).toBe(404);
  });
});
