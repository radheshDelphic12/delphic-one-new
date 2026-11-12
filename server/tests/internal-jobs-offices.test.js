/** Internal job board (refer / apply from the bench) and the Offices overview. */
const { app, prisma, request, cleanDatabase, createUser, createOrgMembership, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');

const { todayIst } = require('../src/lib/istDate');

let sales; let sToken; let empToken; let emp; let req; let adminToken; let org;
const slug = 'java-developer-ab12';
const CV = 'https://drive.google.com/file/d/abc/view';

beforeAll(async () => {
  await cleanDatabase();
  sales = await createUser({ role: 'sales' });
  ({ access_token: sToken } = await loginAs(sales));
  emp = await createUser({ role: 'employee' });
  ({ access_token: empToken } = await loginAs(emp));
  const admin = await createUser({ role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  const account = await createActiveClientAccount(sales.id);
  req = await createRequirement(sToken, account.id, { title: 'Java Developer' });
  await prisma.requirement.update({ where: { id: req.id }, data: { status: 'in_progress' } });
  org = await prisma.org.findUnique({ where: { id: req.org_id } });
  await prisma.websiteJobPosting.create({ data: { org_id: req.org_id, requirement_id: req.id, title: 'Java Developer', created_by: sales.id, slug } });
}, 120000);
afterAll(async () => { await prisma.$disconnect(); });

describe('internal job board', () => {
  test('an employee sees the published jobs, can refer someone and apply themselves, never twice', async () => {
    const list = await authed(request(app).get('/api/v1/internal-jobs'), empToken);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ slug, title: 'Java Developer', applied: false, referrals: 0 });

    const refer = await authed(request(app).post(`/api/v1/internal-jobs/${slug}/refer`), empToken).send({ cv_url: CV, name: 'Ravi Kumar', email: 'ravi@example.com', message: 'Worked with him' });
    expect(refer.status).toBe(201);
    expect((await authed(request(app).post(`/api/v1/internal-jobs/${slug}/refer`), empToken).send({ cv_url: CV, name: 'Ravi again', email: 'RAVI@example.com' })).status).toBe(409);
    const row = await prisma.jobApplicant.findFirst({ where: { email: 'ravi@example.com' } });
    expect(row).toMatchObject({ source: 'referral', channel: 'referral', status: 'new', created_by: emp.id });
    expect(row.notes).toContain('Referred by');

    // "Apply myself" is only for the bench or notice period; an ordinary employee is refused (referring stays open)
    expect(list.body.data[0].can_apply).toBe(false);
    expect((await authed(request(app).post(`/api/v1/internal-jobs/${slug}/apply`), empToken).send({ cv_url: CV, experience_years: 4 })).status).toBe(403);
    await prisma.orgMembership.updateMany({ where: { person_id: emp.id }, data: { bench_start_date: todayIst() } });
    expect((await authed(request(app).get('/api/v1/internal-jobs'), empToken)).body.data[0].can_apply).toBe(true);
    expect((await authed(request(app).post(`/api/v1/internal-jobs/${slug}/apply`), empToken).send({ cv_url: CV, experience_years: 4 })).status).toBe(201);
    expect((await authed(request(app).post(`/api/v1/internal-jobs/${slug}/apply`), empToken).send({ cv_url: CV })).status).toBe(409);
    expect(await prisma.jobApplicant.findFirst({ where: { email: emp.email } })).toMatchObject({ source: 'internal', channel: 'internal' });

    const after = (await authed(request(app).get('/api/v1/internal-jobs'), empToken)).body.data[0];
    expect(after).toMatchObject({ applied: true, referrals: 1 });
  });

  test('needs a login, and a closed job is gone', async () => {
    expect((await request(app).get('/api/v1/internal-jobs')).status).toBe(401);
    await prisma.websiteJobPosting.update({ where: { requirement_id: req.id }, data: { status: 'closed' } });
    expect((await authed(request(app).get('/api/v1/internal-jobs'), empToken)).body.data).toHaveLength(0);
    expect((await authed(request(app).post(`/api/v1/internal-jobs/${slug}/refer`), empToken).send({ cv_url: CV, name: 'X', email: 'x@example.com' })).status).toBe(404);
  });
});

describe('offices overview', () => {
  test('lists every location with its headcount; CCTV and biometrics are reported as not connected', async () => {
    const a = await prisma.location.create({ data: { org_id: org.id, name: 'Indore', city: 'Indore', country: 'India', is_default: true } });
    await prisma.location.create({ data: { org_id: org.id, name: 'Gurgaon', city: 'Gurgaon', country: 'India' } });
    await prisma.orgMembership.updateMany({ where: { org_id: org.id, person_id: emp.id }, data: { location_id: a.id } });
    const r = await authed(request(app).get('/api/v1/orgs/locations/overview'), adminToken);
    expect(r.status).toBe(200);
    expect(r.body.data.map((l) => l.name)).toEqual(['Indore', 'Gurgaon']);
    expect(r.body.data[0]).toMatchObject({ people_count: 1, cctv: { status: 'not_connected' }, biometric: { status: 'not_connected' } });
    expect(r.body.data[1].people_count).toBe(0);
  });

  test('the headcount follows the filters: work mode, employee status, user type and department', async () => {
    const office = await prisma.location.create({ data: { org_id: org.id, name: 'Ahmedabad', city: 'Ahmedabad', country: 'India' } });
    const dept = await prisma.department.create({ data: { org_id: org.id, name: 'Engineering' } });
    const person = async (data) => {
      const u = await createUser({ role: 'employee', withOrg: false });
      const m = await createOrgMembership(u.id, org.id, { role: 'employee' });
      await prisma.orgMembership.update({ where: { id: m.id }, data: { location_id: office.id, ...data } });
    };
    await person({ work_mode: 'remote', department_id: dept.id });
    await person({ work_mode: 'onsite', worker_type: 'contractor' });
    await person({ work_mode: 'hybrid', employment_status: 'notice_period' });
    await person({ employment_status: 'terminated' });
    await person({ employment_status: 'pending_onboarding' });
    const count = async (qs) => (await authed(request(app).get(`/api/v1/orgs/locations/overview${qs}`), adminToken)).body.data.find((l) => l.name === 'Ahmedabad').people_count;
    expect(await count('')).toBe(3); // still working: the remote one, the contractor and the one serving notice
    expect(await count('?work_mode=remote')).toBe(1);
    expect(await count('?work_mode=not_set')).toBe(0);
    expect(await count('?user_type=contractor')).toBe(1);
    expect(await count('?user_type=full_time_employee')).toBe(2);
    expect(await count('?department_id=' + dept.id)).toBe(1);
    expect(await count('?status=notice_period')).toBe(1);
    expect(await count('?status=terminated')).toBe(1);
    expect(await count('?status=pending_onboarding')).toBe(1);
    expect(await count('?status=all')).toBe(5);
    expect(await count('?status=all&work_mode=onsite&user_type=contractor')).toBe(1);
  });
});
