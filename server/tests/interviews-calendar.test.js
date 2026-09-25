/**
 * Interview calendar feed + feedback + cancel.
 *   GET /interviews         — date-windowed, role-scoped, `mine=1`
 *   POST /interviews/:id/feedback — assigned interviewer OR manager; writes the
 *                                   same InterviewRound row the panel shows
 *   POST /interviews/:id/cancel   — manager only; sets status + notifies
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
  createInterviewRound,
  authed,
} = require('./helpers');

const DAY = 24 * 60 * 60 * 1000;

let bda;
let sales;
let recruiterA;
let recruiterB;
let interviewer;
let salesToken;
let recruiterAToken;
let recruiterBToken;
let interviewerToken;
let submissionId;
let inRangeRoundId;
let outOfRangeRoundId;

beforeEach(async () => {
  await cleanDatabase();
  bda = await createUser({ role: 'bda' });
  sales = await createUser({ role: 'sales' });
  recruiterA = await createUser({ role: 'recruiter' });
  recruiterB = await createUser({ role: 'recruiter' });
  interviewer = await createUser({ role: 'recruiter' });
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterAToken } = await loginAs(recruiterA));
  ({ access_token: recruiterBToken } = await loginAs(recruiterB));
  ({ access_token: interviewerToken } = await loginAs(interviewer));

  const account = await createActiveClientAccount(bda.id);
  const requirement = await createRequirement(salesToken, account.id);
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
  const profile = await createProfile(recruiterAToken);
  const sub = await authed(request(app).post('/api/v1/submissions'), recruiterAToken).send({
    requirement_seat_id: seats.body.data[0].id,
    profile_id: profile.id,
    proposed_rate: 100,
    proposed_rate_currency: 'INR',
  });
  submissionId = sub.body.data.id;

  const inRange = await createInterviewRound(submissionId, {
    round_type: 'internal_r1',
    scheduled_at: new Date(Date.now() + 2 * DAY),
    interviewer_ids: [interviewer.id],
    scheduled_by: recruiterA.id,
  });
  inRangeRoundId = inRange.id;

  const outOfRange = await createInterviewRound(submissionId, {
    round_type: 'client_r1',
    scheduled_at: new Date(Date.now() + 90 * DAY),
    scheduled_by: recruiterA.id,
  });
  outOfRangeRoundId = outOfRange.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function calendar(token, params = {}) {
  const from = params.from || new Date(Date.now() - DAY).toISOString();
  const to = params.to || new Date(Date.now() + 30 * DAY).toISOString();
  return authed(request(app).get('/api/v1/interviews').query({ from, to, ...params }), token);
}

describe('GET /interviews', () => {
  test('returns only in-range rounds the user is scoped to', async () => {
    const res = await calendar(recruiterAToken);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((e) => e.id);
    expect(ids).toContain(inRangeRoundId);
    expect(ids).not.toContain(outOfRangeRoundId);
  });

  test('All is team-wide — an unrelated recruiter still sees every round; mine=1 hides them', async () => {
    const allRes = await calendar(recruiterBToken);
    expect(allRes.status).toBe(200);
    expect(allRes.body.data.map((e) => e.id)).toContain(inRangeRoundId);

    const mineRes = await calendar(recruiterBToken, { mine: '1' });
    expect(mineRes.status).toBe(200);
    expect(mineRes.body.data).toHaveLength(0);
  });

  test('mine=1 surfaces rounds where the caller is an assigned interviewer', async () => {
    const res = await calendar(interviewerToken, { mine: '1' });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((e) => e.id);
    expect(ids).toContain(inRangeRoundId);
  });

  test('sales All shows owned-requirement rounds; Mine hides them unless personal', async () => {
    const allRes = await calendar(salesToken);
    expect(allRes.status).toBe(200);
    expect(allRes.body.data.map((e) => e.id)).toContain(inRangeRoundId);

    const mineRes = await calendar(salesToken, { mine: '1' });
    expect(mineRes.status).toBe(200);
    expect(mineRes.body.data.map((e) => e.id)).not.toContain(inRangeRoundId);
  });

  test('recruiter All includes rounds on assigned requirements even when another recruiter submitted', async () => {
    const requirement = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { seat: { select: { requirement_id: true } } },
    });
    await prisma.requirementAssignment.create({
      data: {
        requirement_id: requirement.seat.requirement_id,
        user_id: recruiterB.id,
        role_on_req: 'recruiter',
        assigned_by: sales.id,
      },
    });

    const allRes = await calendar(recruiterBToken);
    expect(allRes.status).toBe(200);
    expect(allRes.body.data.map((e) => e.id)).toContain(inRangeRoundId);

    const mineRes = await calendar(recruiterBToken, { mine: '1' });
    expect(mineRes.status).toBe(200);
    expect(mineRes.body.data.map((e) => e.id)).not.toContain(inRangeRoundId);
  });

  test('audience=external returns only client rounds; sort=audience puts internal first', async () => {
    const clientRound = await createInterviewRound(submissionId, {
      round_type: 'client_r1',
      scheduled_at: new Date(Date.now() + 3 * DAY),
      scheduled_by: recruiterA.id,
    });

    const externalOnly = await calendar(recruiterAToken, { audience: 'external' });
    expect(externalOnly.status).toBe(200);
    const externalIds = externalOnly.body.data.map((e) => e.id);
    expect(externalIds).toContain(clientRound.id);
    expect(externalIds).not.toContain(inRangeRoundId);

    const sorted = await calendar(recruiterAToken, { sort: 'audience' });
    expect(sorted.status).toBe(200);
    const audiences = sorted.body.data.map((e) => e.audience);
    const firstExternal = audiences.indexOf('external');
    const lastInternal = audiences.lastIndexOf('internal');
    if (firstExternal !== -1 && lastInternal !== -1) {
      expect(lastInternal).toBeLessThan(firstExternal);
    }
  });

  test('scheduled_by is returned and the scheduler may reschedule', async () => {
    const res = await calendar(recruiterAToken);
    const row = res.body.data.find((e) => e.id === inRangeRoundId);
    expect(row.scheduled_by?.id).toBe(recruiterA.id);
    expect(row.can_reschedule).toBe(true);
    expect(row.audience).toBe('internal');

    const next = new Date(Date.now() + 5 * DAY).toISOString();
    const patch = await authed(request(app).patch(`/api/v1/interview-rounds/${inRangeRoundId}`), recruiterAToken).send({
      scheduled_at: next,
    });
    expect(patch.status).toBe(200);
  });

  test('a cancelled round comes back with status "cancelled"', async () => {
    await authed(request(app).post(`/api/v1/interviews/${inRangeRoundId}/cancel`), recruiterAToken).send({
      reason: 'Client unavailable',
    });
    const res = await calendar(recruiterAToken, { status: 'cancelled' });
    const row = res.body.data.find((e) => e.id === inRangeRoundId);
    expect(row).toBeTruthy();
    expect(row.status).toBe('cancelled');
  });
});

describe('GET /interviews — client meetings in the feed', () => {
  async function scheduleMeeting({ mode = 'online', when, attendee } = {}) {
    return prisma.account.create({
      data: {
        name: `Acme ${mode} ${Date.now()}${Math.random()}`,
        type: 'client',
        stage: 'meeting_scheduled',
        owner_id: bda.id,
        origin_owner_id: bda.id,
        meeting_mode: mode,
        meeting_date: when || new Date(Date.now() + 2 * DAY),
        meeting_location: mode === 'offline' ? 'Client HQ, 4th floor' : null,
        ...(attendee ? { meeting_attendees: { create: { user_id: attendee } } } : {}),
      },
    });
  }

  test('online and offline meetings ride the feed with kind + meeting_mode', async () => {
    const online = await scheduleMeeting({ mode: 'online' });
    const offline = await scheduleMeeting({ mode: 'offline' });

    const res = await calendar(recruiterAToken);
    expect(res.status).toBe(200);
    const rows = res.body.data;
    const on = rows.find((e) => e.id === `meeting-${online.id}`);
    const off = rows.find((e) => e.id === `meeting-${offline.id}`);
    expect(on).toMatchObject({ kind: 'client_meeting', meeting_mode: 'online', audience: 'external' });
    expect(off).toMatchObject({ kind: 'client_meeting', meeting_mode: 'offline', meeting_location: 'Client HQ, 4th floor' });
    expect(on.candidate_name).toBeNull();
  });

  test('audience=internal drops client meetings; audience=external keeps them', async () => {
    const m = await scheduleMeeting();
    const internal = await calendar(recruiterAToken, { audience: 'internal' });
    expect(internal.body.data.some((e) => e.id === `meeting-${m.id}`)).toBe(false);
    const external = await calendar(recruiterAToken, { audience: 'external' });
    expect(external.body.data.some((e) => e.id === `meeting-${m.id}`)).toBe(true);
  });

  test('mine=1 scopes meetings to owner / origin owner / attendee', async () => {
    const mineByOwner = await scheduleMeeting();
    const mineByAttendee = await scheduleMeeting({ attendee: recruiterB.id });

    const bdaMine = await calendar(salesToken, { mine: '1' });
    // sales user owns neither meeting nor attends → none of these two
    expect(bdaMine.body.data.some((e) => e.id === `meeting-${mineByOwner.id}`)).toBe(false);

    const attendeeMine = await calendar(recruiterBToken, { mine: '1' });
    expect(attendeeMine.body.data.some((e) => e.id === `meeting-${mineByAttendee.id}`)).toBe(true);
  });
});

describe('POST /interviews/:id/feedback', () => {
  test('an assigned interviewer may submit; result flips status to completed', async () => {
    const res = await authed(request(app).post(`/api/v1/interviews/${inRangeRoundId}/feedback`), interviewerToken).send({
      result: 'pass',
      feedback: 'Strong systems fundamentals',
      rating: 8,
    });
    expect(res.status).toBe(200);

    const round = await prisma.interviewRound.findUnique({ where: { id: inRangeRoundId } });
    expect(round.result).toBe('pass');
    expect(round.feedback).toBe('Strong systems fundamentals');
    expect(round.rating).toBe(8);
    expect(round.status).toBe('completed');
    expect(round.completed_at).not.toBeNull();
  });

  test('an unrelated user is forbidden', async () => {
    const res = await authed(request(app).post(`/api/v1/interviews/${inRangeRoundId}/feedback`), recruiterBToken).send({
      result: 'fail',
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /interviews/:id/cancel', () => {
  test('a manager cancels: fields set + notifications created', async () => {
    const res = await authed(request(app).post(`/api/v1/interviews/${inRangeRoundId}/cancel`), recruiterAToken).send({
      reason: 'Candidate withdrew',
    });
    expect(res.status).toBe(200);

    const round = await prisma.interviewRound.findUnique({ where: { id: inRangeRoundId } });
    expect(round.status).toBe('cancelled');
    expect(round.cancellation_reason).toBe('Candidate withdrew');
    expect(round.cancelled_at).not.toBeNull();

    const notifs = await prisma.notification.findMany({ where: { type: 'interview_cancelled' } });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
  });

  test('an unrelated user cannot cancel', async () => {
    const res = await authed(request(app).post(`/api/v1/interviews/${inRangeRoundId}/cancel`), recruiterBToken).send({
      reason: 'nope',
    });
    expect(res.status).toBe(403);
  });
});
