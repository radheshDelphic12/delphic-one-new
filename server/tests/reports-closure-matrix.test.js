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

// A won project = a requirement with a closed candidate (seat closed on `day`), as the Monthly Performance Review counts it.
async function mkWon(client, day, reqType, title, { candidates = 1 } = {}) {
  const requirement = await prisma.requirement.create({ data: { org_id: org.id, account_id: client.id, title: title || unique('Won '), req_type: reqType, sales_owner_id: admin.id, status: 'closed', closed_at: new Date(`${day}T06:00:00Z`) } });
  for (let i = 0; i < candidates; i += 1) {
    const seat = await prisma.requirementSeat.create({ data: { requirement_id: requirement.id, closed_at: new Date(`${day}T06:00:00Z`) } });
    const profile = await prisma.profile.create({ data: { org_id: org.id, name: unique('Won cand '), source: 'direct', added_by: admin.id, total_experience_years: 3, primary_skills: ['x'] } });
    await prisma.submission.create({ data: { requirement_seat_id: seat.id, profile_id: profile.id, stage: 'closed', submitted_by: admin.id } });
  }
  return requirement;
}
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
    await mkWon(acme, '2026-01-10', 'managed_services');
    await mkWon(acme, '2026-01-20', 'project');
    await mkWon(acme, '2026-03-05', 'managed_services');
    await mkWon(beta, '2026-02-01', 'project');
    // a Finance project and an open requirement are not wins
    await mkAccount({ name: unique('P '), is_project: true, client_account_id: acme.id, agreement_start_date: new Date('2026-01-12T00:00:00Z'), service_category: 'project' });
    await prisma.requirement.create({ data: { org_id: org.id, account_id: acme.id, title: 'Still open', req_type: 'project', sales_owner_id: admin.id } });

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
    expect(closed.rows[0]).toMatchObject({ name: 'Acme', total: 2 }); // both requirements have a closed candidate in February

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

  test('every project lists the people allocated to it today (open or running allocations; ended or future ones are not)', async () => {
    const client = await mkAccount({ name: 'Acme' });
    const mkProject = (code) => mkAccount({ name: unique('Proj '), is_project: true, client_account_id: client.id, project_code: code, project_name: code });
    const live = await mkProject('P0010');
    const ended = await mkProject('P0011');
    const future = await mkProject('P0012');
    const empty = await mkProject('P0013');
    const membership = await prisma.orgMembership.findFirst({ where: { person_id: admin.id, org_id: org.id } });
    const day = (offset) => new Date(Date.now() + offset * 86400000);
    const base = { org_id: org.id, org_membership_id: membership.id, created_by: admin.id };
    await prisma.projectMemberAssignment.create({ data: { ...base, account_id: live.id, start_date: day(-30), end_date: null } });
    await prisma.projectMemberAssignment.create({ data: { ...base, account_id: ended.id, start_date: day(-60), end_date: day(-3) } });
    await prisma.projectMemberAssignment.create({ data: { ...base, account_id: future.id, start_date: day(10), end_date: null } });
    const d = (await get('/reports/day-schedule')).body.data;
    const allocated = (code) => d.projects.find((p) => p.code === code).allocated.map((p) => p.name);
    expect(allocated('P0010')).toEqual([admin.name]);
    expect(d.projects.find((p) => p.code === 'P0010').allocated[0].id).toBe(admin.id); // the person id, as the shift lists use
    expect(allocated('P0011')).toEqual([]);
    expect(allocated('P0012')).toEqual([]);
    expect(allocated('P0013')).toEqual([]);
    void empty;
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

describe('GET /reports/closure-matrix/records (every number is clickable)', () => {
  const base = (kind, extra = '') => `/reports/closure-matrix/records?kind=${kind}&date_from=2026-01-01&date_to=2026-03-31${extra}`;
  const matrix = async (kind, extra = '') => (await get(`/reports/closure-matrix?kind=${kind}&date_from=2026-01-01&date_to=2026-03-31${extra}`)).body.data;

  test('projects: a cell, a row total, a column total and the grand total list exactly the records behind the number', async () => {
    const acme = await mkAccount({ name: 'Acme', stage: 'active' });
    const beta = await mkAccount({ name: 'Beta', stage: 'lead' });
    const p1 = await mkWon(acme, '2026-01-10', 'managed_services', 'Alpha build');
    await mkWon(acme, '2026-01-20', 'project', 'Alpha two');
    await mkWon(acme, '2026-03-05', 'managed_services', 'Alpha three');
    await mkWon(beta, '2026-02-01', 'project', 'Beta one');
    const m = await matrix('client');

    const cell = (await get(base('client', `&account_id=${acme.id}&month=2026-01`))).body.data;
    expect(cell.total).toBe(2);
    expect(cell.total).toBe(m.rows.find((r) => r.name === 'Acme').counts['2026-01']);
    expect(cell.records.map((r) => r.title).sort()).toEqual(['Alpha build', 'Alpha two']);
    expect(cell.records.find((r) => r.id === p1.id)).toMatchObject({ kind: 'requirement', party: 'Acme', date: '2026-01-10', date_label: 'Won on', path: `/requirements/${p1.id}` });

    const row = (await get(base('client', `&account_id=${acme.id}`))).body.data;
    expect(row.total).toBe(m.rows.find((r) => r.name === 'Acme').total); // 3
    const column = (await get(base('client', '&month=2026-02'))).body.data;
    expect(column.total).toBe(m.totals['2026-02']); // Beta one
    const all = (await get(base('client'))).body.data;
    expect(all.total).toBe(m.grand_total);
    expect(all.records).toHaveLength(4);
    // the filters of the report carry into the list: the same type narrows both
    const typed = (await get(base('client', `&account_id=${acme.id}&month=2026-01&req_type=managed_services`))).body.data;
    expect(typed.records.map((r) => r.title)).toEqual(['Alpha build']);
    expect(typed.total).toBe((await matrix('client', '&req_type=managed_services')).rows.find((r) => r.name === 'Acme').counts['2026-01']);
    // newest first
    expect(all.records.map((r) => r.date)).toEqual([...all.records.map((r) => r.date)].sort().reverse());
  });

  test('projects won match the Monthly Performance Review: once per requirement, month of the seat closing, a closed ticket alone does not count', async () => {
    const acme = await mkAccount({ name: 'Acme' });
    await mkWon(acme, '2026-01-31', 'recruitment', 'Two hires', { candidates: 2 });
    // requirement marked closed in March but no candidate closed: not a project won
    await prisma.requirement.create({ data: { org_id: org.id, account_id: acme.id, title: 'No hire', req_type: 'recruitment', sales_owner_id: admin.id, status: 'closed', closed_at: new Date('2026-03-05T06:00:00Z') } });
    // closed candidate with no seat closing date: counted in the joining month
    await mkJoining(acme.id, null, '2026-02-12');
    const d = (await get('/reports/closure-matrix?kind=client&date_from=2026-01-01&date_to=2026-03-31')).body.data;
    expect(d.rows[0]).toMatchObject({ name: 'Acme', total: 2, counts: { '2026-01': 1, '2026-02': 1 } });
  });

  test('joinings and closed requirements link to the candidate / requirement; vendors work the same way', async () => {
    const client = await mkAccount({ name: 'Acme' });
    const vendor = await mkAccount({ name: 'Vend Co', type: 'vendor' });
    const requirement = await mkJoining(client.id, vendor.id, '2026-02-12');
    await mkJoining(client.id, null, '2026-02-20');
    const closed = await mkWon(client, '2026-03-10', 'recruitment', 'Closed role');

    const joined = (await get(base('client', `&measure=joinings&account_id=${client.id}&month=2026-02`))).body.data;
    expect(joined.total).toBe(2);
    expect(joined.records[0]).toMatchObject({ kind: 'joining', party: 'Acme', date_label: 'Joined on' });
    expect(joined.records[0].path).toMatch(/^\/submissions\/[0-9a-f-]{36}$/);
    expect(joined.records.map((r) => r.subtitle)).toContain(requirement.title);

    const vendors = (await get(base('vendor', `&account_id=${vendor.id}`))).body.data;
    expect(vendors.total).toBe(1);
    expect(vendors.records[0]).toMatchObject({ party: 'Vend Co', date: '2026-02-12' });
    expect(vendors.total).toBe((await matrix('vendor')).rows.find((r) => r.name === 'Vend Co').total);

    const reqs = (await get(base('client', `&measure=requirements&account_id=${client.id}&month=2026-03`))).body.data;
    expect(reqs.records).toEqual([expect.objectContaining({ kind: 'requirement', id: closed.id, title: 'Closed role', path: `/requirements/${closed.id}`, date_label: 'Won on' })]);
  });

  test('bad input and no login are refused', async () => {
    expect((await get(base('client', '&month=2026-13x'))).status).toBe(422);
    expect((await get(base('client', '&account_id=not-a-uuid'))).status).toBe(422);
    expect((await request(app).get(`/api/v1${base('client')}`)).status).toBe(401);
  });
});
