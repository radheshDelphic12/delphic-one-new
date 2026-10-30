/**
 * Reports > Hiring funnel: profiles sourced in the dates, followed through every round (cohort by sourcing date).
 */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createActiveClientAccount, createProfile, authed } = require('./helpers');

let sales;
let recruiter;
let admin;
let salesToken;
let recruiterToken;
let adminToken;
let account;
let templateRounds; // client template rounds by name
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await cleanDatabase();
  sales = await createUser({ role: 'sales' });
  recruiter = await createUser({ role: 'recruiter' });
  admin = await createUser({ role: 'admin' });
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  ({ access_token: adminToken } = await loginAs(admin));
  account = await createActiveClientAccount(sales.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeRequirement(body = {}) {
  const res = await authed(request(app).post('/api/v1/requirements'), salesToken).send({
    account_id: account.id, title: 'Backend Developer', req_type: 'recruitment', ...body,
  });
  const seats = await authed(request(app).get(`/api/v1/requirements/${res.body.data.id}/seats`), salesToken);
  const template = await prisma.interviewTemplate.findUnique({ where: { id: res.body.data.interview_template_id }, include: { rounds: true } });
  templateRounds = Object.fromEntries(template.rounds.map((r) => [r.name, r]));
  return { id: res.body.data.id, seatId: seats.body.data[0].id };
}

async function sourced(daysAgo, name) {
  const profile = await createProfile(recruiterToken, { name });
  await prisma.profile.update({ where: { id: profile.id }, data: { created_at: new Date(Date.now() - daysAgo * DAY) } });
  return profile;
}

async function submit(seatId, profileId) {
  const res = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
    requirement_seat_id: seatId, profile_id: profileId, proposed_rate: 100, proposed_rate_currency: 'INR',
  });
  return res.body.data.id;
}

const round = (submissionId, name, result, extra = {}) =>
  prisma.interviewRound.create({
    data: {
      submission_id: submissionId, round_number: 1 + Math.floor(Math.random() * 1e6), round_type: templateRounds[name].conducted_by === 'client' ? 'template_client' : 'template_internal',
      template_round_id: templateRounds[name].id, status: 'completed', result, completed_at: new Date(), ...extra,
    },
  });

const history = (submissionId, to_stage, daysAgo = 0) =>
  prisma.stageHistory.create({ data: { entity_type: 'submission', entity_id: submissionId, to_stage, changed_by: recruiter.id, changed_at: new Date(Date.now() - daysAgo * DAY) } });

const funnel = (query = {}, token = adminToken) => {
  const from = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const to = new Date(Date.now() + DAY).toISOString().slice(0, 10);
  return authed(request(app).get('/api/v1/reports/hiring-funnel').query({ date_from: from, date_to: to, ...query }), token);
};
const stage = (fn, key) => fn.stages.find((s) => s.key === key);

describe('hiring funnel', () => {
  test('follows the profiles sourced in the dates through every round and counts missing rounds as assumed passes', async () => {
    const { seatId } = await makeRequirement();
    // A: cleared everything, optional client rounds 2-4 never held, closed
    const a = await sourced(10, 'Funnel A');
    const subA = await submit(seatId, a.id);
    await round(subA, 'Screening + Behavioural + Reasoning, Aptitude & Mind Test', 'pass');
    await history(subA, 'submitted_to_client', 8);
    await round(subA, 'Client Round 1', 'pass');
    await round(subA, 'MD Round', 'pass');
    await history(subA, 'offer_sent', 3);
    await history(subA, 'closed', 2);
    await prisma.submission.update({ where: { id: subA }, data: { stage: 'closed' } });
    // B: failed Client Round 1
    const b = await sourced(9, 'Funnel B');
    const subB = await submit(seatId, b.id);
    await round(subB, 'Screening + Behavioural + Reasoning, Aptitude & Mind Test', 'pass');
    await history(subB, 'submitted_to_client', 7);
    await round(subB, 'Client Round 1', 'fail');
    // C: submitted, nothing happened yet; D: sourced but never submitted; E: sourced before the dates
    const c = await sourced(5, 'Funnel C');
    await submit(seatId, c.id);
    await sourced(4, 'Funnel D');
    await sourced(90, 'Funnel E');

    const res = await funnel();
    expect(res.status).toBe(200);
    const { summary, funnels } = res.body.data;
    expect(summary).toMatchObject({ sourced: 4, submitted: 3, selected: 1, dropped: 1, in_progress: 1, not_submitted: 1, first_round_cleared: 2, reached_client_round: 2 });
    expect(summary.avg_days_to_join).toBeGreaterThan(7.5);
    expect(summary.avg_days_to_join).toBeLessThan(8.5);

    expect(funnels).toHaveLength(1);
    const fn = funnels[0];
    expect(fn.track).toBe('client');
    expect(fn.profiles).toBe(3);
    expect(stage(fn, 'sourced').reached).toBe(3);
    expect(stage(fn, 'screening')).toMatchObject({ reached: 3, passed: 2, pending: 1 });
    expect(stage(fn, 'submitted')).toMatchObject({ reached: 2, passed: 2 });
    expect(stage(fn, 'client_r1')).toMatchObject({ reached: 2, passed: 1, dropped: 1 });
    // A never had the optional client rounds 2-4: passed by default, shown as "not held"
    expect(stage(fn, 'client_r2')).toMatchObject({ reached: 1, assumed: 1, passed: 0 });
    expect(stage(fn, 'md')).toMatchObject({ reached: 1, passed: 1 });
    expect(stage(fn, 'joined')).toMatchObject({ reached: 1, passed: 1 });
    expect(stage(fn, 'client_r1').avg_days_from_start).not.toBeNull();

    const row = res.body.data.recruiters.find((r) => r.sourcer_id === recruiter.id);
    expect(row).toMatchObject({ sourced: 4, submitted: 3, selected: 1, dropped: 1 });
    expect(res.body.data.trend.length).toBeGreaterThan(0);
    expect(res.body.data.assumptions.length).toBeGreaterThan(3);
  });

  test('a skipped bench round counts as an assumed pass; old data without rounds goes to "data unavailable"', async () => {
    const { seatId } = await makeRequirement();
    const a = await sourced(6, 'Skipped A');
    const subA = await submit(seatId, a.id);
    await round(subA, 'Screening + Behavioural + Reasoning, Aptitude & Mind Test', 'skipped');
    await history(subA, 'submitted_to_client', 5);
    await round(subA, 'Client Round 1', 'pass');
    // closed with no round records at all (migrated old data)
    const b = await sourced(6, 'No rounds B');
    const subB = await submit(seatId, b.id);
    await history(subB, 'submitted_to_client', 5);
    await history(subB, 'closed', 1);
    await prisma.submission.update({ where: { id: subB }, data: { stage: 'closed' } });

    const res = await funnel();
    const fn = res.body.data.funnels[0];
    // both moved past screening, so both count as having cleared it in the summary; the client-round rate never exceeds 100%
    expect(res.body.data.summary.first_round_cleared).toBe(2);
    expect(res.body.data.summary.client_round_pct).toBeLessThanOrEqual(100);
    expect(stage(fn, 'screening')).toMatchObject({ reached: 2, assumed: 1, unavailable: 1, passed: 0 });
    expect(stage(fn, 'client_r1')).toMatchObject({ reached: 2, passed: 1, unavailable: 1 });
  });

  test('filters: service type, recruiter and client narrow the cohort; access is admin only; export works', async () => {
    const { seatId } = await makeRequirement();
    const a = await sourced(3, 'Filter A');
    await submit(seatId, a.id);

    const internalOnly = await funnel({ service_type: 'internal' });
    expect(internalOnly.body.data.funnels).toHaveLength(0);
    expect(internalOnly.body.data.summary.sourced).toBe(0);
    expect((await funnel({ service_type: 'client' })).body.data.summary.sourced).toBe(1);
    expect((await funnel({ client_id: account.id })).body.data.summary.sourced).toBe(1);
    expect((await funnel({ sourcer_id: admin.id })).body.data.summary.sourced).toBe(0);
    expect((await funnel({ sourcer_id: recruiter.id })).body.data.summary.sourced).toBe(1);

    expect((await funnel({}, recruiterToken)).status).toBe(403);

    const from = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
    const to = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    const xlsx = await authed(request(app).get('/api/v1/reports/export').query({ type: 'xlsx', report: 'hiring-funnel', date_from: from, date_to: to }), adminToken);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect((await authed(request(app).get('/api/v1/reports/export').query({ type: 'xlsx', report: 'hiring-funnel', date_from: from, date_to: to }), recruiterToken)).status).toBe(403);
  });
});
