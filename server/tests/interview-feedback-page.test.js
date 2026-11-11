/**
 * Interview feedback page: the interviewer of a round (a plain employee, no pipeline access), HR and admins give the feedback of a round. A person sees only the
 * rounds they took (HR and admins: all), with the candidate's work background and nothing about price or the client.
 */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createActiveClientAccount, createProfile, createInterviewRound, authed } = require('./helpers');

let tokens;
let users;
let submissionId;

beforeEach(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter', name: 'Sender HR' });
  const otherHr = await createUser({ role: 'recruiter', name: 'Diksha HR' });
  const admin = await createUser({ role: 'admin' });
  const harshit = await createUser({ role: 'bda', name: 'Harshit Dev' });
  const outsider = await createUser({ role: 'bda', name: 'Not On The Round' });
  users = { recruiter, otherHr, admin, harshit, outsider };
  tokens = {};
  for (const [key, u] of Object.entries({ sales, ...users })) tokens[key] = (await loginAs(u)).access_token;
  const account = await createActiveClientAccount(sales.id);
  const req = await authed(request(app).post('/api/v1/requirements'), tokens.sales).send({ account_id: account.id, title: 'Backend Developer', req_type: 'recruitment' });
  const seatId = (await authed(request(app).get(`/api/v1/requirements/${req.body.data.id}/seats`), tokens.sales)).body.data[0].id;
  const profile = await createProfile(tokens.recruiter, { name: 'Candidate One' });
  const sub = await authed(request(app).post('/api/v1/submissions'), tokens.recruiter).send({ requirement_seat_id: seatId, profile_id: profile.id, proposed_rate: 4321, proposed_rate_currency: 'INR' });
  submissionId = sub.body.data.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const F = '/api/v1/interview-feedback';
const get = (path, token) => authed(request(app).get(`${F}${path}`), token);
const patchRound = (id, body, token) => authed(request(app).patch(`/api/v1/interview-rounds/${id}`), token).send(body);

describe('interview feedback page', () => {
  test('an assigned interviewer sees their own rounds and the candidate, never the price; someone not on the round gets nothing', async () => {
    const mine = await createInterviewRound(submissionId, { round_type: 'internal_r1', interviewer_ids: [users.harshit.id], scheduled_at: new Date(Date.now() - 3600000) });
    await createInterviewRound(submissionId, { round_type: 'internal_r2', interviewer_ids: [users.admin.id] });

    const list = await get('/mine', tokens.harshit);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: mine.id, submission_id: submissionId, candidate: 'Candidate One', requirement: 'Backend Developer', has_feedback: false, mine: true });

    const page = await get(`/submission/${submissionId}`, tokens.harshit);
    expect(page.status).toBe(200);
    expect(page.body.data.candidate.name).toBe('Candidate One');
    expect(page.body.data.rounds.map((r) => r.id)).toEqual([mine.id]); // only the round they took
    expect(JSON.stringify(page.body)).not.toMatch(/4321|proposed_rate|account/i);

    expect((await get(`/submission/${submissionId}`, tokens.outsider)).status).toBe(403);
    expect((await get('/all', tokens.harshit)).status).toBe(403);
    expect((await get('/mine', tokens.outsider)).body.data).toEqual([]);
  });

  test('the interviewer gives the feedback from there and it shows as given; HR who did not send the candidate and the admin see every round and can write feedback too', async () => {
    const r1 = await createInterviewRound(submissionId, { round_type: 'internal_r1', interviewer_ids: [users.harshit.id], scheduled_at: new Date(Date.now() - 3600000) });
    const r2 = await createInterviewRound(submissionId, { round_type: 'internal_r2', interviewer_ids: [users.admin.id], scheduled_at: new Date(Date.now() - 1800000) });

    expect((await patchRound(r1.id, { result: 'pass', feedback: 'Solid on Java.' }, tokens.harshit)).status).toBe(200);
    const after = await get('/mine', tokens.harshit);
    expect(after.body.data[0]).toMatchObject({ has_feedback: true, result: 'pass', feedback: 'Solid on Java.' });

    // HR (any recruiter, not only the one who sent the candidate) and the admin see everything
    for (const key of ['otherHr', 'recruiter', 'admin']) {
      const all = await get('/all', tokens[key]);
      expect(all.status).toBe(200);
      expect(all.body.data.rounds.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort());
      expect((await get(`/submission/${submissionId}`, tokens[key])).body.data.rounds).toHaveLength(2);
    }
    expect((await get('/all?pending=1', tokens.otherHr)).body.data.rounds.map((r) => r.id)).toEqual([r2.id]); // only the one still waiting

    // HR who did not send the candidate writes the feedback of a round, but cannot move it
    const before = (await prisma.interviewRound.findUnique({ where: { id: r2.id } })).scheduled_at.getTime();
    const hr = await patchRound(r2.id, { result: 'fail', feedback: 'Not a fit for the role.', scheduled_at: new Date(Date.now() + 5 * 86400000).toISOString() }, tokens.otherHr);
    expect(hr.status).toBe(200);
    expect(hr.body.data).toMatchObject({ result: 'fail', feedback: 'Not a fit for the role.' });
    expect((await prisma.interviewRound.findUnique({ where: { id: r2.id } })).scheduled_at.getTime()).toBe(before);
    expect((await get('/all?pending=1', tokens.admin)).body.data.rounds).toEqual([]);
  });

  test('a candidate whose process has ended (closed) is not listed as waiting for feedback, and the round is marked as ended', async () => {
    const past = new Date(Date.now() - 3600000);
    await createInterviewRound(submissionId, { round_type: 'internal_r1', interviewer_ids: [users.harshit.id], scheduled_at: past });
    expect((await get('/all?pending=1', tokens.admin)).body.data.rounds).toHaveLength(1);
    expect((await get('/mine', tokens.harshit)).body.data[0]).toMatchObject({ has_feedback: false, candidate_ended: false });

    // the candidate is closed (and the record locked) without the round's feedback being typed in
    await prisma.submission.update({ where: { id: submissionId }, data: { stage: 'closed', is_locked: true } });
    expect((await get('/all?pending=1', tokens.admin)).body.data.rounds).toHaveLength(0); // nothing is waited for any more
    const all = (await get('/all', tokens.admin)).body.data.rounds;
    expect(all).toHaveLength(1); // still listed in the full view, marked as ended
    expect(all[0]).toMatchObject({ has_feedback: false, candidate_ended: true, submission_stage: 'closed' });
    expect((await get('/mine', tokens.harshit)).body.data[0]).toMatchObject({ candidate_ended: true });
  });
});
