/**
 * Reports > Hiring funnel > Hiring panels: one table per interview template, layer by layer (bucket, scheduled, attended,
 * decision pending, rejected, passed, skipped), found by the date of submission.
 */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createActiveClientAccount, createProfile, authed } = require('./helpers');

let sales;
let recruiter;
let admin;
let salesToken;
let recruiterToken;
let adminToken;
let account;
let rounds; // client template rounds by name
const DAY = 24 * 60 * 60 * 1000;
const SCREEN = 'Screening + Behavioural + Reasoning, Aptitude & Mind Test';

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

async function makeRequirement() {
  const res = await authed(request(app).post('/api/v1/requirements'), salesToken).send({ account_id: account.id, title: 'Backend Developer', req_type: 'recruitment' });
  const seats = await authed(request(app).get(`/api/v1/requirements/${res.body.data.id}/seats`), salesToken);
  const template = await prisma.interviewTemplate.findUnique({ where: { id: res.body.data.interview_template_id }, include: { rounds: true } });
  rounds = Object.fromEntries(template.rounds.map((r) => [r.name, r]));
  return { seatId: seats.body.data[0].id, templateId: template.id };
}

async function submit(seatId, name) {
  const profile = await createProfile(recruiterToken, { name });
  const res = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({ requirement_seat_id: seatId, profile_id: profile.id, proposed_rate: 100, proposed_rate_currency: 'INR' });
  return { id: res.body.data.id, profileId: profile.id };
}

const round = (submissionId, name, result, extra = {}) => prisma.interviewRound.create({
  data: {
    submission_id: submissionId, round_number: 1 + Math.floor(Math.random() * 1e6), round_type: rounds[name].conducted_by === 'client' ? 'template_client' : 'template_internal',
    template_round_id: rounds[name].id, status: 'completed', result, completed_at: new Date(), ...extra,
  },
});

const panels = (query = {}, token = adminToken) => {
  const from = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
  const to = new Date(Date.now() + DAY).toISOString().slice(0, 10);
  return authed(request(app).get('/api/v1/reports/hiring-panels').query({ date_from: from, date_to: to, ...query }), token);
};
const layerOf = (panel, name) => panel.layers.find((l) => l.name === name);

describe('hiring panels', () => {
  test('layer by layer: bucket = passed + skipped of the layer before; scheduled, attended, pending, rejected, passed, skipped; since first / layer by layer', async () => {
    const { seatId, templateId } = await makeRequirement();
    // s1 fails the screening; s5 is never scheduled
    const s1 = await submit(seatId, 'P One');
    await round(s1.id, SCREEN, 'fail');
    await submit(seatId, 'P Five');
    // s2 passes the screening, Client Round 1 happened but no decision yet
    const s2 = await submit(seatId, 'P Two');
    await round(s2.id, SCREEN, 'pass');
    await round(s2.id, 'Client Round 1', 'pending', { status: 'scheduled', completed_at: null, scheduled_at: new Date(Date.now() - DAY) });
    // s3 passes the screening and Client Round 1, fails Client Round 2
    const s3 = await submit(seatId, 'P Three');
    await round(s3.id, SCREEN, 'pass');
    await round(s3.id, 'Client Round 1', 'pass');
    await round(s3.id, 'Client Round 2', 'fail');
    // s4 passes CR1 and CR2, skips the optional CR3 / CR4 (no record) and passes the MD round
    const s4 = await submit(seatId, 'P Four');
    await round(s4.id, SCREEN, 'pass');
    await round(s4.id, 'Client Round 1', 'pass');
    await round(s4.id, 'Client Round 2', 'pass');
    await round(s4.id, 'MD Round', 'pass');
    // s6 passes the screening, Client Round 1 is booked for tomorrow
    const s6 = await submit(seatId, 'P Six');
    await round(s6.id, SCREEN, 'pass');
    await round(s6.id, 'Client Round 1', 'pending', { status: 'scheduled', completed_at: null, scheduled_at: new Date(Date.now() + DAY) });

    const res = await panels();
    expect(res.status).toBe(200);
    // the three templates keep a panel each
    expect(res.body.data.panels.map((p) => p.template.name)).toEqual(expect.arrayContaining(['Client Hiring', 'Internal Technical Hiring', 'Internal Sales, HR & Operations Hiring']));
    const panel = res.body.data.panels.find((p) => p.template.id === templateId);
    expect(panel.submissions).toBe(6);
    expect(panel.layers.map((l) => l.no)).toEqual([1, 2, 3, 4, 5, 6]);

    const l1 = layerOf(panel, SCREEN);
    expect(l1).toMatchObject({ bucket: 6, scheduled: 5, attended: 5, pending: 0, rejected: 1, passed: 4, skipped: 0, since_first_pct: 100, layer_pct: 100 });
    expect(l1.label).toBe(`${SCREEN} (Delphic, mandatory, rating required) / AI Round`);
    const cr1 = layerOf(panel, 'Client Round 1');
    expect(cr1).toMatchObject({ bucket: 4, scheduled: 4, attended: 3, pending: 1, rejected: 0, passed: 2, skipped: 0, since_first_pct: 66.67, layer_pct: 66.67 });
    const cr2 = layerOf(panel, 'Client Round 2');
    expect(cr2).toMatchObject({ bucket: 2, scheduled: 2, attended: 2, rejected: 1, passed: 1, since_first_pct: 33.33, layer_pct: 50 });
    // CR3 / CR4: s4 moved on without them, so they are skipped and still flow to the next bucket
    expect(layerOf(panel, 'Client Round 3')).toMatchObject({ bucket: 1, scheduled: 0, attended: 0, skipped: 1, since_first_pct: 16.67, layer_pct: 50 });
    expect(layerOf(panel, 'Client Round 4')).toMatchObject({ bucket: 1, skipped: 1, layer_pct: 100 });
    expect(layerOf(panel, 'MD Round')).toMatchObject({ bucket: 1, scheduled: 1, attended: 1, passed: 1, layer_pct: 100 });
    // Attended = decision pending + rejected + passed on every layer
    for (const l of panel.layers) expect(l.attended).toBe(l.pending + l.rejected + l.passed);
  });

  test('layer 1 combines the screening round, the screening test and the AI interview (best result wins)', async () => {
    const { seatId, templateId } = await makeRequirement();
    const a = await submit(seatId, 'Test Only');
    await prisma.assessmentAttempt.create({ data: { token: `t-${Date.now()}-a`, test_id: (await prisma.assessmentTest.create({ data: { name: 'T', pass_percentage: 60 } })).id, submission_id: a.id, candidate_name: 'Test Only', status: 'submitted', passed: true, score_percent: 80, pass_percentage: 60, expires_at: new Date(Date.now() + DAY), template_round_id: rounds[SCREEN].id } });
    const b = await submit(seatId, 'Ai Only');
    await prisma.aiInterview.create({ data: { token: `ai-${Date.now()}-b`, submission_id: b.id, candidate_name: 'Ai Only', status: 'completed', outcome: 'below_pass', pass_percentage: 60, expires_at: new Date(Date.now() + DAY), template_round_id: rounds[SCREEN].id } });
    const c = await submit(seatId, 'Ai Overridden');
    await prisma.aiInterview.create({ data: { token: `ai-${Date.now()}-c`, submission_id: c.id, candidate_name: 'Ai Overridden', status: 'completed', outcome: 'below_pass', override_outcome: 'pass', pass_percentage: 60, expires_at: new Date(Date.now() + DAY), template_round_id: rounds[SCREEN].id } });
    const panel = (await panels()).body.data.panels.find((p) => p.template.id === templateId);
    expect(layerOf(panel, SCREEN)).toMatchObject({ bucket: 3, scheduled: 3, attended: 3, passed: 2, rejected: 1 });
  });

  test('filters (profile type, recruiter, client, sales owner), the candidates behind a count, the export and the access rule', async () => {
    const { seatId, templateId } = await makeRequirement();
    const a = await submit(seatId, 'Market Person');
    await round(a.id, SCREEN, 'pass');
    const b = await submit(seatId, 'Bench Person');
    await prisma.profile.update({ where: { id: b.profileId }, data: { on_bench: true } });
    await round(b.id, SCREEN, 'fail');
    const find = (res) => res.body.data.panels.find((p) => p.template.id === templateId);

    expect(find(await panels()).layers[0].bucket).toBe(2);
    expect(find(await panels({ profile_type: 'bench' })).layers[0]).toMatchObject({ bucket: 1, rejected: 1 });
    expect(find(await panels({ profile_type: 'market' })).layers[0]).toMatchObject({ bucket: 1, passed: 1 });
    expect(find(await panels({ profile_type: 'vendor' })).layers[0].bucket).toBe(0);
    expect(find(await panels({ sourcer_id: recruiter.id })).layers[0].bucket).toBe(2);
    expect(find(await panels({ sourcer_id: admin.id })).layers[0].bucket).toBe(0);
    expect(find(await panels({ client_id: account.id })).layers[0].bucket).toBe(2);
    expect(find(await panels({ sales_owner_id: admin.id })).layers[0].bucket).toBe(0);
    // a submission date outside the range leaves it out
    expect(find(await panels({ date_from: '2020-01-01', date_to: '2020-01-31' })).layers[0].bucket).toBe(0);

    // the candidates behind a count equal the count
    const from = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
    const to = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    const details = await authed(request(app).get('/api/v1/reports/hiring-panels/details').query({ date_from: from, date_to: to, template_id: templateId, layer: 1, metric: 'passed' }), adminToken);
    expect(details.status).toBe(200);
    expect(details.body.data).toMatchObject({ total: 1, items: [expect.objectContaining({ name: 'Market Person', layer_status: 'Passed', profile_type: 'Market' })] });

    const xlsx = await authed(request(app).get('/api/v1/reports/export').query({ type: 'xlsx', report: 'hiring-panels', date_from: from, date_to: to }), adminToken).buffer(true).parse((r, cb) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(xlsx.status).toBe(200);
    expect(xlsx.body.slice(0, 2).toString()).toBe('PK');

    // recruiters cannot open it
    expect((await panels({}, recruiterToken)).status).toBe(403);
  });
});
