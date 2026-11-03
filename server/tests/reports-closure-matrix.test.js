const { app, prisma, request, cleanDatabase, createUser, loginAs, authed, unique } = require('./helpers');

let admin;
let adminToken;
let org;

beforeEach(async () => {
  await cleanDatabase();
  admin = await createUser({ role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  org = await prisma.org.findUnique({ where: { slug: 'test-org' } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const get = (path) => authed(request(app).get(`/api/v1${path}`), adminToken);
const mkAccount = (over = {}) => prisma.account.create({ data: { org_id: org.id, type: 'client', name: unique('Client '), stage: 'active', owner_id: admin.id, origin_owner_id: admin.id, ...over } });

async function mkJoining(clientId, vendorId, joinedOn, reqType = 'recruitment') {
  const requirement = await prisma.requirement.create({ data: { org_id: org.id, account_id: clientId, title: unique('Req '), req_type: reqType, sales_owner_id: admin.id } });
  const seat = await prisma.requirementSeat.create({ data: { requirement_id: requirement.id } });
  const profile = await prisma.profile.create({ data: { org_id: org.id, name: unique('Cand '), source: vendorId ? 'vendor' : 'direct', vendor_account_id: vendorId || null, added_by: admin.id, total_experience_years: 3, primary_skills: ['x'] } });
  await prisma.submission.create({ data: { requirement_seat_id: seat.id, profile_id: profile.id, stage: 'closed', actual_joining_date: new Date(`${joinedOn}T00:00:00Z`), submitted_by: admin.id } });
  return requirement;
}

describe('GET /reports/closure-matrix', () => {
  test('clients: won projects per client per month, all stages listed, filters', async () => {
    const acme = await mkAccount({ name: 'Acme', stage: 'active' });
    const beta = await mkAccount({ name: 'Beta', stage: 'lead' });
    await mkAccount({ name: 'Gamma', stage: 'dropped' });
    const mkProject = (client, start, category) => mkAccount({ name: unique('P '), is_project: true, client_account_id: client.id, agreement_start_date: new Date(`${start}T00:00:00Z`), service_category: category });
    await mkProject(acme, '2026-01-10', 'managed_services');
    await mkProject(acme, '2026-01-20', 'project');
    await mkProject(acme, '2026-03-05', 'managed_services');
    await mkProject(beta, '2026-02-01', 'project');

    const res = await get('/reports/closure-matrix?kind=client&date_from=2026-01-01&date_to=2026-03-31');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.measure).toBe('projects');
    expect(d.months.map((m) => m.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(d.rows.map((r) => r.name)).toEqual(['Acme', 'Beta', 'Gamma']); // Gamma has no wins but is listed
    expect(d.rows[0]).toMatchObject({ total: 3, counts: { '2026-01': 2, '2026-03': 1 } });
    expect(d.totals).toMatchObject({ '2026-01': 2, '2026-02': 1, '2026-03': 1 });
    expect(d.grand_total).toBe(4);

    const byType = (await get('/reports/closure-matrix?kind=client&date_from=2026-01-01&date_to=2026-03-31&req_type=managed_services')).body.data;
    expect(byType.grand_total).toBe(2);
    const byStatus = (await get('/reports/closure-matrix?kind=client&date_from=2026-01-01&date_to=2026-03-31&account_stage=lead')).body.data;
    expect(byStatus.rows.map((r) => r.name)).toEqual(['Beta']);
    const nonEmpty = (await get('/reports/closure-matrix?kind=client&date_from=2026-01-01&date_to=2026-03-31&hide_empty=true')).body.data;
    expect(nonEmpty.rows).toHaveLength(2);
    expect((await get('/reports/closure-matrix?kind=client&date_from=bad&date_to=2026-03-31')).status).toBe(422);
  });

  test('clients: joinings and closed requirements measures; vendors: joined via vendor, same shape', async () => {
    const acme = await mkAccount({ name: 'Acme' });
    const vendorA = await mkAccount({ type: 'vendor', name: 'Vendor A', stage: 'active', vendor_type: 'bgv' });
    await mkAccount({ type: 'vendor', name: 'Vendor B', stage: 'lead' });
    const r1 = await mkJoining(acme.id, vendorA.id, '2026-02-10');
    await mkJoining(acme.id, null, '2026-02-12', 'managed_services');
    await prisma.requirement.update({ where: { id: r1.id }, data: { status: 'closed', closed_at: new Date('2026-02-15T05:00:00Z') } });

    const joinings = (await get('/reports/closure-matrix?kind=client&measure=joinings&date_from=2026-01-01&date_to=2026-02-28')).body.data;
    expect(joinings.rows[0]).toMatchObject({ name: 'Acme', total: 2, counts: { '2026-02': 2 } });
    expect((await get('/reports/closure-matrix?kind=client&measure=joinings&req_type=managed_services&date_from=2026-01-01&date_to=2026-02-28')).body.data.grand_total).toBe(1);
    const closed = (await get('/reports/closure-matrix?kind=client&measure=requirements&date_from=2026-01-01&date_to=2026-02-28')).body.data;
    expect(closed.rows[0]).toMatchObject({ name: 'Acme', total: 1 });

    const vendors = (await get('/reports/closure-matrix?kind=vendor&date_from=2026-01-01&date_to=2026-02-28')).body.data;
    expect(vendors.measure).toBe('joinings');
    expect(vendors.rows.map((r) => [r.name, r.total])).toEqual([['Vendor A', 1], ['Vendor B', 0]]);
    expect((await get('/reports/closure-matrix?kind=vendor&vendor_type=bgv&date_from=2026-01-01&date_to=2026-02-28')).body.data.rows.map((r) => r.name)).toEqual(['Vendor A']);
  });
});

describe('project working hours and the day schedule', () => {
  test('work start / end are saved on a project and listed with shifts and their people', async () => {
    const client = await mkAccount({ name: 'Acme' });
    const project = await mkAccount({ name: unique('Proj '), is_project: true, client_account_id: client.id, project_code: 'P0001', project_name: 'Night desk' });
    const saved = await authed(request(app).patch(`/api/v1/billing/projects/${project.id}`), adminToken).send({ work_start_time: '21:00', work_end_time: '06:00' });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ work_start_time: '21:00', work_end_time: '06:00' });
    expect((await authed(request(app).patch(`/api/v1/billing/projects/${project.id}`), adminToken).send({ work_start_time: '25:00' })).status).toBe(422);

    const shift = await prisma.shift.create({ data: { org_id: org.id, name: 'General', start_minutes: 540, end_minutes: 1080 } });
    await prisma.orgMembership.updateMany({ where: { person_id: admin.id, org_id: org.id }, data: { shift_id: shift.id } });
    const d = (await get('/reports/day-schedule')).body.data;
    expect(d.projects.find((p) => p.code === 'P0001')).toMatchObject({ name: 'Night desk', start: '21:00', end: '06:00', client: 'Acme' });
    expect(d.shifts).toEqual([expect.objectContaining({ name: 'General', start: '09:00', end: '18:00', people: [expect.objectContaining({ name: admin.name })] })]);
  });
});

describe('GET /ai-interviews/report', () => {
  test('lists attempts with requirement, status, outcome and submission link; filters and by-requirement counts', async () => {
    const client = await mkAccount({ name: 'Acme' });
    const reqA = await prisma.requirement.create({ data: { org_id: org.id, account_id: client.id, title: 'Java dev', req_type: 'recruitment', sales_owner_id: admin.id } });
    const seat = await prisma.requirementSeat.create({ data: { requirement_id: reqA.id } });
    const mk = async (name, status, outcome, score) => {
      const profile = await prisma.profile.create({ data: { org_id: org.id, name, source: 'direct', added_by: admin.id, total_experience_years: 2, primary_skills: ['x'] } });
      const sub = await prisma.submission.create({ data: { requirement_seat_id: seat.id, profile_id: profile.id, submitted_by: admin.id } });
      await prisma.aiInterview.create({ data: { token: unique('tok'), submission_id: sub.id, org_id: org.id, candidate_name: name, status, outcome, score_percent: score, pass_percentage: 60, expires_at: new Date(Date.now() + 86400000), completed_at: status === 'completed' ? new Date() : null } });
      return sub;
    };
    const subA = await mk('Asha', 'completed', 'pass', 82.5);
    await mk('Ben', 'completed', 'below_pass', 40);
    await mk('Chitra', 'started', null, null);
    await mk('Dev', 'invited', null, null);

    const d = (await get('/ai-interviews/report')).body.data;
    expect(d.summary).toMatchObject({ sent: 4, attempted: 3, scored: 2, in_progress: 1, not_opened: 1, pass: 1, below_pass: 1, average_score: 61.3 });
    expect(d.by_requirement).toEqual([expect.objectContaining({ requirement_title: 'Java dev', client_name: 'Acme', sent: 4, attempted: 3, pass: 1, average_score: 61.3 })]);
    const asha = d.rows.find((r) => r.candidate_name === 'Asha');
    expect(asha).toMatchObject({ submission_id: subA.id, requirement_title: 'Java dev', client_name: 'Acme', view_status: 'scored', outcome: 'pass', score_percent: 82.5 });
    expect((await get('/ai-interviews/report?attempted=yes')).body.data.rows).toHaveLength(3);
    expect((await get('/ai-interviews/report?status=in_progress')).body.data.rows.map((r) => r.candidate_name)).toEqual(['Chitra']);
    expect((await get('/ai-interviews/report?outcome=pass')).body.data.rows).toHaveLength(1);
    expect((await get(`/ai-interviews/report?requirement_id=${reqA.id}&q=ben`)).body.data.rows).toHaveLength(1);
  });
});
