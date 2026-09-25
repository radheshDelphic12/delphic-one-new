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

async function seedOrgAdmin() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, access_token };
}

async function seedOrgEmployee(org) {
  const user = await createUser({ role: 'recruiter' });
  await createOrgMembership(user.id, org.id, { role: 'recruiter' });
  const { access_token } = await loginAs(user);
  return { access_token };
}

describe('designations — org-scoped directory', () => {
  test('a membership-less user gets 403, not a crash', async () => {
    const user = await createUser({ role: 'recruiter' });
    const { access_token } = await loginAs(user);
    const res = await authed(request(app).get('/api/v1/designations'), access_token);
    expect(res.status).toBe(403);
  });

  test('admin creates a designation, everyone in the org can list it', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);

    const created = await authed(request(app).post('/api/v1/designations'), adminToken).send({
      name: 'Senior Recruiter',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('Senior Recruiter');

    const dup = await authed(request(app).post('/api/v1/designations'), adminToken).send({
      name: 'Senior Recruiter',
    });
    expect(dup.status).toBe(409);

    const list = await authed(request(app).get('/api/v1/designations'), empToken);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
  });

  test('same designation name is allowed across two different orgs', async () => {
    const { access_token: adminAToken } = await seedOrgAdmin();
    const orgB = await createOrg({ name: 'Acconcy', slug: 'acconcy' });
    const adminB = await createUser({ role: 'admin' });
    await createOrgMembership(adminB.id, orgB.id, { role: 'admin' });
    const { access_token: adminBToken } = await loginAs(adminB);

    const a = await authed(request(app).post('/api/v1/designations'), adminAToken).send({ name: 'Engineer' });
    const b = await authed(request(app).post('/api/v1/designations'), adminBToken).send({ name: 'Engineer' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const listA = await authed(request(app).get('/api/v1/designations'), adminAToken);
    expect(listA.body.data).toHaveLength(1);
  });

  test('a non-admin cannot create a designation', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const res = await authed(request(app).post('/api/v1/designations'), access_token).send({ name: 'x' });
    expect(res.status).toBe(403);
  });

  test('admin can update a designation, rename collision is rejected', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const a = await authed(request(app).post('/api/v1/designations'), adminToken).send({ name: 'A' });
    const b = await authed(request(app).post('/api/v1/designations'), adminToken).send({ name: 'B' });

    const rename = await authed(request(app).patch(`/api/v1/designations/${a.body.data.id}`), adminToken).send({
      name: 'A Renamed',
    });
    expect(rename.status).toBe(200);
    expect(rename.body.data.name).toBe('A Renamed');

    const collide = await authed(request(app).patch(`/api/v1/designations/${b.body.data.id}`), adminToken).send({
      name: 'A Renamed',
    });
    expect(collide.status).toBe(409);
  });
});

describe('org context — write-side org_id auto-injection', () => {
  test('a department created by an org-context admin is auto-stamped with org_id', async () => {
    const { org, access_token } = await seedOrgAdmin();
    const res = await authed(request(app).post('/api/v1/departments'), access_token).send({ name: 'Engineering ERP Test' });
    expect(res.status).toBe(201);

    const row = await prisma.department.findUnique({ where: { id: res.body.data.id } });
    expect(row.org_id).toBe(org.id);
  });

  test('a department created by a membership-less caller is left with a null org_id (unchanged behavior)', async () => {
    const admin = await createUser({ role: 'admin' });
    const { access_token } = await loginAs(admin);
    const res = await authed(request(app).post('/api/v1/departments'), access_token).send({ name: 'Legacy Dept Test' });
    expect(res.status).toBe(201);

    const row = await prisma.department.findUnique({ where: { id: res.body.data.id } });
    expect(row.org_id).toBeNull();
  });

  test('an explicit org_id set by a service is never overridden by the injection', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const orgB = await createOrg({ name: 'Acconcy', slug: 'acconcy' });

    // calendars.service.create always sets org_id explicitly from
    // req.user.org_id — confirm the caller's own org wins, not some other id.
    const res = await authed(request(app).post('/api/v1/calendars'), adminToken).send({ name: 'Test Calendar' });
    expect(res.status).toBe(201);
    expect(res.body.data.org_id).toBe(org.id);
    expect(res.body.data.org_id).not.toBe(orgB.id);
  });
});
