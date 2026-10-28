/**
 * Interview templates per service type: template pick, round order, mandatory feedback / skill ratings, pass %.
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
let account;

beforeEach(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  const admin = await createUser({ role: 'admin' });
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  ({ access_token: adminToken } = await loginAs(admin));
  account = await createActiveClientAccount(sales.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeRequirement(body = {}) {
  return authed(request(app).post('/api/v1/requirements'), salesToken).send({
    account_id: account.id,
    title: 'Backend Developer',
    req_type: 'internal_hiring',
    hiring_track: 'technical',
    ...body,
  });
}

async function makeSubmission(requirementId) {
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirementId}/seats`), salesToken);
  const profile = await createProfile(recruiterToken);
  const sub = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
    requirement_seat_id: seats.body.data[0].id,
    profile_id: profile.id,
    proposed_rate: 100,
    proposed_rate_currency: 'INR',
  });
  return sub.body.data.id;
}

const getPlan = async (submissionId) =>
  (await authed(request(app).get(`/api/v1/submissions/${submissionId}/interview-plan`), recruiterToken)).body.data;

const schedule = (submissionId, template_round_id, extra = {}) =>
  authed(request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`), recruiterToken).send({
    template_round_id,
    scheduled_at: new Date().toISOString(),
    ...extra,
  });

const skills = (rating) => [
  { skill_name: 'Node.js', rating },
  { skill_name: 'Communication', rating },
];

describe('template pick by service type', () => {
  test('internal hiring picks the template by track', async () => {
    const tech = await makeRequirement();
    const nonTech = await makeRequirement({ hiring_track: 'non_technical' });
    expect(tech.status).toBe(201);
    const names = await Promise.all(
      [tech, nonTech].map(async (r) => (await prisma.interviewTemplate.findUnique({ where: { id: r.body.data.interview_template_id } })).name)
    );
    expect(names).toEqual(['Internal Technical Hiring', 'Internal Sales, HR & Operations Hiring']);
  });

  test('recruitment, managed services and project use the client template', async () => {
    for (const req_type of ['recruitment', 'managed_services', 'project']) {
      const res = await makeRequirement({ req_type, hiring_track: undefined });
      const tpl = await prisma.interviewTemplate.findUnique({ where: { id: res.body.data.interview_template_id } });
      expect(tpl.name).toBe('Client Hiring');
    }
  });

  test('internal hiring needs a track', async () => {
    const res = await makeRequirement({ hiring_track: undefined });
    expect(res.status).toBe(422);
  });
});

describe('round order, feedback and ratings', () => {
  test('a mandatory round blocks the next until it has feedback and ratings', async () => {
    const requirement = await makeRequirement();
    const submissionId = await makeSubmission(requirement.body.data.id);
    let plan = await getPlan(submissionId);
    expect(plan.steps.map((s) => s.name)).toEqual([
      'Screening + Behavioural + Reasoning, Aptitude & Mind Test',
      'Developer 1',
      'Developer 2',
      'CTO Round',
      'MD Round',
    ]);
    const [screening, dev1] = plan.steps;
    expect(screening.can_start).toBe(true);
    expect(dev1.can_start).toBe(false);

    // Developer 1 cannot start before Screening is done
    expect((await schedule(submissionId, dev1.template_round_id)).body.message || '').toMatch(/previous mandatory round/i);

    const first = await schedule(submissionId, screening.template_round_id);
    expect(first.status).toBe(201);
    const roundId = first.body.data.id;
    const patchRound = (body) => authed(request(app).patch(`/api/v1/interview-rounds/${roundId}`), recruiterToken).send(body);

    // finishing needs feedback, then ratings
    expect((await patchRound({ result: 'pass' })).status).toBe(400);
    expect((await patchRound({ result: 'pass', feedback: 'Good fundamentals' })).status).toBe(400);
    expect((await schedule(submissionId, dev1.template_round_id)).status).toBe(400);

    // 5/10 + 6/10 -> 55%, below the 60% default: allowed, but flagged for the manager
    const done = await patchRound({
      result: 'pass',
      feedback: 'Good fundamentals',
      skill_ratings: [{ skill_name: 'Node.js', rating: 5 }, { skill_name: 'Communication', rating: 6 }],
    });
    expect(done.status).toBe(200);
    expect(Number(done.body.data.score_percent)).toBe(55);
    expect(done.body.data.pass_percentage).toBe(60);
    expect(done.body.data.below_pass).toBe(true);
    expect(done.body.data.skill_ratings).toHaveLength(2);

    plan = await getPlan(submissionId);
    expect(plan.steps[0].state).toBe('completed');
    expect(plan.steps[0].below_pass).toBe(true);
    expect(plan.steps[1].can_start).toBe(true);
    expect((await schedule(submissionId, dev1.template_round_id)).status).toBe(201);
  });

  test('the requirement can override the pass percentage', async () => {
    const requirement = await makeRequirement({ pass_percentage: 50 });
    const submissionId = await makeSubmission(requirement.body.data.id);
    const plan = await getPlan(submissionId);
    expect(plan.pass_percentage).toBe(50);
    const round = await schedule(submissionId, plan.steps[0].template_round_id);
    const done = await authed(request(app).patch(`/api/v1/interview-rounds/${round.body.data.id}`), recruiterToken).send({
      result: 'pass',
      feedback: 'ok',
      skill_ratings: skills(6),
    });
    expect(done.body.data.below_pass).toBe(false);
  });

  test('client optional rounds can be skipped; only rating-free feedback is needed', async () => {
    const requirement = await makeRequirement({ req_type: 'recruitment', hiring_track: undefined });
    const submissionId = await makeSubmission(requirement.body.data.id);
    const plan = await getPlan(submissionId);
    const [screening, client1, client2, , , md] = plan.steps;
    const s = await schedule(submissionId, screening.template_round_id);
    await authed(request(app).patch(`/api/v1/interview-rounds/${s.body.data.id}`), recruiterToken).send({ result: 'pass', feedback: 'fine', skill_ratings: skills(8) });
    const c1 = await schedule(submissionId, client1.template_round_id);
    // client round: feedback only, no ratings
    expect((await authed(request(app).patch(`/api/v1/interview-rounds/${c1.body.data.id}`), recruiterToken).send({ result: 'pass' })).status).toBe(400);
    expect((await authed(request(app).patch(`/api/v1/interview-rounds/${c1.body.data.id}`), recruiterToken).send({ result: 'pass', feedback: 'Client liked him' })).status).toBe(200);
    // Client Round 2 is optional: MD round can follow without it
    expect(client2.is_mandatory).toBe(false);
    expect((await schedule(submissionId, md.template_round_id)).status).toBe(201);
  });
});

describe('legacy requirements and the offer gate', () => {
  test('a requirement without a template keeps the old rounds', async () => {
    const requirement = await makeRequirement({ req_type: 'recruitment', hiring_track: undefined });
    await prisma.requirement.update({ where: { id: requirement.body.data.id }, data: { interview_template_id: null } });
    const submissionId = await makeSubmission(requirement.body.data.id);
    expect(await getPlan(submissionId)).toBeNull();
    const res = await authed(request(app).post(`/api/v1/submissions/${submissionId}/interview-rounds`), recruiterToken).send({
      round_type: 'internal_r1',
      scheduled_at: new Date().toISOString(),
    });
    expect(res.status).toBe(201);
  });

  test('the offer stage waits for the mandatory template rounds', async () => {
    const requirement = await makeRequirement({ req_type: 'recruitment', hiring_track: undefined });
    const submissionId = await makeSubmission(requirement.body.data.id);
    const plan = await getPlan(submissionId);
    const s = await schedule(submissionId, plan.steps[0].template_round_id, { result: 'pass', feedback: 'ok', skill_ratings: skills(9) });
    expect(s.status).toBe(201);
    await prisma.submission.update({ where: { id: submissionId }, data: { stage: 'interview_result' } });
    const res = await authed(request(app).post(`/api/v1/submissions/${submissionId}/stage`), recruiterToken).send({ to_stage: 'offer_sent' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mandatory interview rounds/i);
  });
});

describe('admin edits templates', () => {
  test('admin changes the default pass percentage and the rounds; others cannot', async () => {
    const list = await authed(request(app).get('/api/v1/interview-templates'), recruiterToken);
    expect(list.body.data.length).toBeGreaterThanOrEqual(3);

    // work on a copy: the seeded templates are shared by every test and survive cleanDatabase()
    const made = await authed(request(app).post('/api/v1/interview-templates'), adminToken).send({
      name: 'Copy', service_types: ['project'], pass_percentage: 60,
      rounds: [{ name: 'Round A' }, { name: 'Round B', is_mandatory: false }, { name: 'Round C' }],
    });
    expect(made.status).toBe(201);
    const tpl = made.body.data;

    const denied = await authed(request(app).patch(`/api/v1/interview-templates/${tpl.id}`), recruiterToken).send({ pass_percentage: 70 });
    expect(denied.status).toBe(403);

    const rounds = tpl.rounds.filter((r) => r.name !== 'Round C').map((r) => ({ id: r.id, name: r.name, conducted_by: r.conducted_by, kind: r.kind, is_mandatory: r.is_mandatory, rating_required: r.rating_required }));
    const ok = await authed(request(app).patch(`/api/v1/interview-templates/${tpl.id}`), adminToken).send({ pass_percentage: 70, rounds });
    expect(ok.status).toBe(200);
    expect(ok.body.data.pass_percentage).toBe(70);
    expect(ok.body.data.rounds).toHaveLength(2);
    await prisma.interviewTemplate.delete({ where: { id: tpl.id } });
  });
});
