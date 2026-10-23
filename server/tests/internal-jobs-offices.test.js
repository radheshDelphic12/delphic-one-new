/** Internal job board (refer / apply from the bench) and the Offices overview. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');

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
});
