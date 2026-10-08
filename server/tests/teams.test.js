// HR Settings → Teams, and Team / Work Mode on the employee membership.
const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createOrg,
  createOrgMembership,
  authed,
} = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedMember(org, role = 'admin') {
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role });
  const { access_token } = await loginAs(user);
  return { user, membership, token: access_token };
}

describe('teams — org-scoped HR setting', () => {
  test('a membership-less user gets 403', async () => {
    const user = await createUser({ role: 'recruiter', withOrg: false });
    const { access_token } = await loginAs(user);
    expect((await authed(request(app).get('/api/v1/teams'), access_token)).status).toBe(403);
  });

  test('admin creates a team with a department and lead; everyone in the org can list it', async () => {
    const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const admin = await seedMember(org, 'admin');
    const employee = await seedMember(org, 'recruiter');
    const department = await prisma.department.create({ data: { name: 'Delivery', org_id: org.id } });

    const created = await authed(request(app).post('/api/v1/teams'), admin.token).send({
      name: 'Java Squad',
      department_id: department.id,
      lead_membership_id: admin.membership.id,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: 'Java Squad',
      department: { id: department.id, name: 'Delivery' },
      lead_membership_id: admin.membership.id,
      // The lead is on the team too (they weren't on any team, so they join it).
      member_count: 1,
    });

    const dup = await authed(request(app).post('/api/v1/teams'), admin.token).send({ name: 'Java Squad' });
    expect(dup.status).toBe(409);

    const list = await authed(request(app).get('/api/v1/teams'), employee.token);
    expect(list.status).toBe(200);
    expect(list.body.data.map((t) => t.name)).toEqual(['Java Squad']);

    const denied = await authed(request(app).post('/api/v1/teams'), employee.token).send({ name: 'Nope' });
    expect(denied.status).toBe(403);
  });

  test('a department or lead from another org is rejected, and teams do not leak across orgs', async () => {
    const orgA = await createOrg({ name: 'A', slug: 'org-a' });
    const orgB = await createOrg({ name: 'B', slug: 'org-b' });
    const adminA = await seedMember(orgA, 'admin');
    const adminB = await seedMember(orgB, 'admin');
    const deptB = await prisma.department.create({ data: { name: 'B Dept', org_id: orgB.id } });

    const badDept = await authed(request(app).post('/api/v1/teams'), adminA.token).send({ name: 'X', department_id: deptB.id });
    expect(badDept.status).toBe(404);
    const badLead = await authed(request(app).post('/api/v1/teams'), adminA.token).send({ name: 'X', lead_membership_id: adminB.membership.id });
    expect(badLead.status).toBe(404);

    const teamB = await authed(request(app).post('/api/v1/teams'), adminB.token).send({ name: 'X' });
    expect(teamB.status).toBe(201);
    expect((await authed(request(app).get('/api/v1/teams'), adminA.token)).body.data).toEqual([]);
    expect((await authed(request(app).patch(`/api/v1/teams/${teamB.body.data.id}`), adminA.token).send({ name: 'Y' })).status).toBe(404);
    expect((await authed(request(app).delete(`/api/v1/teams/${teamB.body.data.id}`), adminA.token)).status).toBe(404);
  });

  test('rename, then delete is refused while the team has members', async () => {
    const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const admin = await seedMember(org, 'admin');
    const team = (await authed(request(app).post('/api/v1/teams'), admin.token).send({ name: 'Alpha' })).body.data;

    const renamed = await authed(request(app).patch(`/api/v1/teams/${team.id}`), admin.token).send({ name: 'Beta' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Beta');

    await prisma.orgMembership.update({ where: { id: admin.membership.id }, data: { team_id: team.id } });
    const blocked = await authed(request(app).delete(`/api/v1/teams/${team.id}`), admin.token);
    expect(blocked.status).toBe(409);

    await prisma.orgMembership.update({ where: { id: admin.membership.id }, data: { team_id: null } });
    expect((await authed(request(app).delete(`/api/v1/teams/${team.id}`), admin.token)).status).toBe(200);
  });
});

describe('membership — team and work mode', () => {
  test('admin sets team + work mode on an employee; both come back on the membership', async () => {
    const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const admin = await seedMember(org, 'admin');
    const employee = await seedMember(org, 'recruiter');
    const team = (await authed(request(app).post('/api/v1/teams'), admin.token).send({ name: 'Alpha' })).body.data;

    const res = await authed(request(app).patch(`/api/v1/orgs/memberships/${employee.membership.id}`), admin.token).send({
      team_id: team.id,
      work_mode: 'hybrid',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.team).toEqual({ id: team.id, name: 'Alpha' });
    expect(res.body.data.work_mode).toBe('hybrid');

    const cleared = await authed(request(app).patch(`/api/v1/orgs/memberships/${employee.membership.id}`), admin.token).send({ team_id: null, work_mode: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.team).toBeNull();
    expect(cleared.body.data.work_mode).toBeNull();
  });

  test('an unknown work mode is a 422, and another org\'s team is a 404', async () => {
    const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const other = await createOrg({ name: 'Other', slug: 'other' });
    const admin = await seedMember(org, 'admin');
    const otherAdmin = await seedMember(other, 'admin');
    const foreignTeam = (await authed(request(app).post('/api/v1/teams'), otherAdmin.token).send({ name: 'Foreign' })).body.data;

    const badMode = await authed(request(app).patch(`/api/v1/orgs/memberships/${admin.membership.id}`), admin.token).send({ work_mode: 'moon' });
    expect(badMode.status).toBe(422);
    const badTeam = await authed(request(app).patch(`/api/v1/orgs/memberships/${admin.membership.id}`), admin.token).send({ team_id: foreignTeam.id });
    expect(badTeam.status).toBe(404);
  });
});
