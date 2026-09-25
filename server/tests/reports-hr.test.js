/**
 * HR report - GET /reports/hr. Four per-day tables:
 *   sourcing, submissions, round1_by_sourcer, round1_by_interviewer.
 * On-bench profiles are excluded everywhere.
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
  createInterviewRound,
  authed,
} = require('./helpers');

const today = new Date().toISOString().slice(0, 10);

let adminToken;
let salesToken;
let recruiter;
let recruiterToken;
let interviewerA;
let interviewerB;
let submissionIds;

async function makeSubmission(seatId, profileId) {
  const res = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
    requirement_seat_id: seatId,
    profile_id: profileId,
    proposed_rate: 100,
    proposed_rate_currency: 'INR',
  });
  if (res.status !== 201) throw new Error(`submission failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

beforeEach(async () => {
  await cleanDatabase();
  const admin = await createUser({ role: 'admin' });
  const sales = await createUser({ role: 'sales' });
  recruiter = await createUser({ role: 'recruiter', name: 'Prashant' });
  interviewerA = await createUser({ role: 'recruiter', name: 'Ivy' });
  interviewerB = await createUser({ role: 'recruiter', name: 'Omar' });
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));

  const account = await createActiveClientAccount(sales.id);
  const requirement = await createRequirement(salesToken, account.id);
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
  const seatId = seats.body.data[0].id;

  // Prashant sources: 2 direct + 1 vendor (counted) + 1 on-bench (excluded).
  const mkProfile = (over) =>
    prisma.profile.create({
      data: {
        name: `Cand ${Math.random().toString(36).slice(2, 8)}`,
        total_experience_years: 5,
        primary_skills: ['Node.js'],
        source: 'direct',
        added_by: recruiter.id,
        ...over,
      },
    });
  const p1 = await mkProfile();
  const p2 = await mkProfile();
  await mkProfile({ source: 'vendor' });
  await mkProfile({ on_bench: true });

  submissionIds = [await makeSubmission(seatId, p1.id), await makeSubmission(seatId, p2.id)];

  // internal round 1 -> scheduled 4 / completed 3 (pass+pass+fail, no_show excluded) / shortlisted 2.
  // Note: recording a result does NOT flip `status`, so the pass rounds below keep
  // status 'scheduled' — completed must still count them.
  await createInterviewRound(submissionIds[0], {
    scheduled_at: new Date(),
    result: 'pass',
    interviewer_ids: [interviewerA.id, interviewerB.id],
  });
  await createInterviewRound(submissionIds[0], {
    scheduled_at: new Date(),
    result: 'pass',
    interviewer_ids: [interviewerA.id],
  });
  await createInterviewRound(submissionIds[0], {
    scheduled_at: new Date(),
    result: 'fail',
    interviewer_ids: [interviewerA.id],
  });
  await createInterviewRound(submissionIds[1], {
    scheduled_at: new Date(),
    result: 'no_show',
    interviewer_ids: [interviewerA.id],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const getHr = (token, query = {}) =>
  authed(request(app).get('/api/v1/reports/hr').query({ date_from: today, date_to: today, ...query }), token);

function table(body, key) {
  return body.data.tables.find((t) => t.key === key);
}

describe('GET /reports/hr', () => {
  test('admin only', async () => {
    expect((await getHr(salesToken)).status).toBe(403);
    expect((await getHr(recruiterToken)).status).toBe(403);
    expect((await getHr(adminToken)).status).toBe(200);
  });

  test('sourcing table: one row per sourcer/day, source split in by_type, excludes on-bench', async () => {
    const res = await getHr(adminToken);
    const rows = table(res.body, 'sourcing').rows;
    // Prashant sourced 2 direct + 1 vendor today (the on-bench one is excluded) -> a single row.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourcer: 'Prashant',
      date: today,
      count: 3,
      by_type: { Bench: 2, Vendor: 1 }, // direct -> "Bench" label
    });
  });

  test('source filter narrows every table', async () => {
    const res = await getHr(adminToken, { source: 'vendor' });
    const rows = table(res.body, 'sourcing').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 1, by_type: { Vendor: 1 } });
    expect(rows[0].by_type.Bench).toBeUndefined();
  });

  test('submissions table counts submissions per sourcer/day', async () => {
    const rows = table((await getHr(adminToken)).body, 'submissions').rows;
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(2);
    expect(rows[0]).toMatchObject({ sourcer: 'Prashant', date: today });
  });

  test('round1_by_sourcer: scheduled 4 / completed 3 (pass or fail) / shortlisted 2', async () => {
    const rows = table((await getHr(adminToken)).body, 'round1_by_sourcer').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourcer: 'Prashant', scheduled: 4, completed: 3, shortlisted: 2 });
  });

  test('round1_by_interviewer: both linked interviewers get credit; filter narrows', async () => {
    const all = table((await getHr(adminToken)).body, 'round1_by_interviewer').rows;
    const ivy = all.find((r) => r.interviewer === 'Ivy');
    const omar = all.find((r) => r.interviewer === 'Omar');
    expect(ivy).toMatchObject({ scheduled: 4, completed: 3, shortlisted: 2 });
    expect(omar).toMatchObject({ scheduled: 1, completed: 1, shortlisted: 1 });

    const narrowed = table((await getHr(adminToken, { interviewer_id: interviewerB.id })).body, 'round1_by_interviewer').rows;
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0].interviewer).toBe('Omar');
  });
});
