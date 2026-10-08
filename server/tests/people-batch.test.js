// People: default employee codes, the reporting view (manager / direct
// reports / team), department-sorted listing, and the salary structure's
// monthly CTC.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const admin = await createUser({ role: 'admin' });
  const adminMembership = await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const token = (await loginAs(admin)).access_token;
  return { org, admin, adminMembership, token };
}

const newUser = (ctx, name) => authed(request(app).post('/api/v1/users'), ctx.token).send({
  name,
  email: `${unique('emp')}@delphic.test`,
  password: 'Password123!',
  role: 'employee',
});

async function membershipOf(ctx, res) {
  return prisma.orgMembership.findFirst({ where: { person_id: res.body.data.id, org_id: ctx.org.id } });
}

describe('Default employee codes', () => {
  test('new employees get the next E-number, continuing after codes HR entered by hand; codes are unique per company', async () => {
    const ctx = await seed();
    const first = await newUser(ctx, 'First Hire');
    expect(first.status).toBe(201);
    expect((await membershipOf(ctx, first)).employee_code).toBe('E0001');
    expect((await membershipOf(ctx, await newUser(ctx, 'Second Hire'))).employee_code).toBe('E0002');

    // HR sets a real code by hand; the next hire continues from it.
    const second = await prisma.orgMembership.findFirst({ where: { org_id: ctx.org.id, employee_code: 'E0002' } });
    const set = await authed(request(app).patch(`/api/v1/orgs/memberships/${second.id}`), ctx.token).send({ employee_code: 'e0174' });
    expect(set.status).toBe(200);
    expect(set.body.data.employee_code).toBe('E0174');
    expect((await membershipOf(ctx, await newUser(ctx, 'Third Hire'))).employee_code).toBe('E0175');

    // Taken codes are refused, and a bad one fails validation.
    const firstMembership = await membershipOf(ctx, first);
    expect((await authed(request(app).patch(`/api/v1/orgs/memberships/${firstMembership.id}`), ctx.token).send({ employee_code: 'E0174' })).status).toBe(409);
    expect((await authed(request(app).patch(`/api/v1/orgs/memberships/${firstMembership.id}`), ctx.token).send({ employee_code: 'E 01!' })).status).toBe(422);

    // Another company numbers its own people from E0001.
    const other = await seed();
    expect((await membershipOf(other, await newUser(other, 'Elsewhere'))).employee_code).toBe('E0001');
  });
});

describe('Reporting view — manager, direct reports, team', () => {
  test('any member sees an employee\'s manager, direct reports and team members; terminated people are left out', async () => {
    const ctx = await seed();
    const person = async (name, extra = {}) => {
      const user = await createUser({ role: 'employee', name });
      const { manager_id = null, team_id = null, ...rest } = extra;
      const created = await createOrgMembership(user.id, ctx.org.id, { role: 'employee', ...rest });
      // The helper takes a fixed set of fields; set the reporting line directly.
      const membership = await prisma.orgMembership.update({ where: { id: created.id }, data: { manager_id, team_id } });
      return { user, membership };
    };
    const vipul = await person('Vipul Sharma');
    const team = await prisma.team.create({ data: { org_id: ctx.org.id, name: 'WebCore' } });
    const lead = await person('Deepanshu Chauhan', { manager_id: vipul.membership.id, team_id: team.id });
    await prisma.team.update({ where: { id: team.id }, data: { lead_membership_id: lead.membership.id } });
    const radhesh = await person('Radhesh Shrivastava', { manager_id: lead.membership.id, team_id: team.id });
    await person('Kantariya Devanshi', { manager_id: lead.membership.id, team_id: team.id });
    await person('Gone Person', { manager_id: lead.membership.id, team_id: team.id, employment_status: 'terminated' });

    const viewer = (await loginAs(radhesh.user)).access_token;
    const res = await authed(request(app).get(`/api/v1/orgs/memberships/${lead.membership.id}/reporting`), viewer);
    expect(res.status).toBe(200);
    expect(res.body.data.manager).toMatchObject({ id: vipul.membership.id, name: 'Vipul Sharma' });
    expect(res.body.data.direct_reports.map((p) => p.name)).toEqual(['Kantariya Devanshi', 'Radhesh Shrivastava']);
    expect(res.body.data.team).toMatchObject({ name: 'WebCore', lead: { name: 'Deepanshu Chauhan' } });
    expect(res.body.data.team.members.map((p) => p.name)).toEqual(['Deepanshu Chauhan', 'Kantariya Devanshi', 'Radhesh Shrivastava']);

    const mine = await authed(request(app).get('/api/v1/orgs/me/reporting'), viewer);
    expect(mine.body.data).toMatchObject({ manager: { name: 'Deepanshu Chauhan' }, direct_reports: [], team: { name: 'WebCore' } });

    const other = await seed();
    expect((await authed(request(app).get(`/api/v1/orgs/memberships/${lead.membership.id}/reporting`), other.token)).status).toBe(404);
  });
});

describe('People → Users sorted by department', () => {
  test('users come back grouped by department A→Z (none last), then by name', async () => {
    const ctx = await seed();
    const dept = async (name) => prisma.department.create({ data: { name, org_id: ctx.org.id } });
    const [hr, it] = [await dept('HR'), await dept('IT')];
    const add = (name, department_id) => authed(request(app).post('/api/v1/users'), ctx.token).send({
      name, email: `${unique('u')}@delphic.test`, password: 'Password123!', role: 'employee', department_id,
    });
    await add('Zed IT', it.id);
    await add('Amy IT', it.id);
    await add('Nobody');
    await add('Hina HR', hr.id);

    const res = await authed(request(app).get('/api/v1/users?limit=50'), ctx.token);
    expect(res.status).toBe(200);
    const names = res.body.data.map((u) => u.name).filter((n) => ['Zed IT', 'Amy IT', 'Nobody', 'Hina HR'].includes(n));
    expect(names).toEqual(['Hina HR', 'Amy IT', 'Zed IT', 'Nobody']);
  });
});
