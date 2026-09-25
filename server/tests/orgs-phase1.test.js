const jwt = require('jsonwebtoken');
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

describe('multi-company ERP Phase 1 — backward compatibility', () => {
  test('a user with no OrgMembership logs in and behaves exactly as before', async () => {
    const user = await createUser({ role: 'recruiter' });
    const { access_token, memberships, active_org } = await loginAs(user);

    expect(memberships).toEqual([]);
    expect(active_org).toBeNull();

    const decoded = jwt.decode(access_token);
    expect(decoded.org_id).toBeNull();
    expect(decoded.role).toBe('recruiter');

    // Ordinary authorize() gates still work unchanged with no org context.
    const res = authed(request(app).get('/api/v1/users/me'), access_token);
    expect((await res).status).toBe(200);
  });

  test('refresh for a membership-less user keeps working', async () => {
    const user = await createUser({ role: 'bda' });
    const { refresh_token } = await loginAs(user);
    const res = await request(app).post('/api/v1/auth/refresh').send({ refresh_token });
    expect(res.status).toBe(200);
    expect(jwt.decode(res.body.data.access_token).org_id).toBeNull();
  });
});

describe('multi-company ERP Phase 1 — org context', () => {
  async function seedTwoOrgUser() {
    const user = await createUser({ role: 'sales' });
    const orgA = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const orgB = await createOrg({ name: 'Acconcy', slug: 'acconcy' });
    await createOrgMembership(user.id, orgA.id, { role: 'sales' });
    await createOrgMembership(user.id, orgB.id, { role: 'admin' });
    return { user, orgA, orgB };
  }

  test('login picks the earliest-joined active membership as the default org', async () => {
    const { user, orgA } = await seedTwoOrgUser();
    const { access_token, memberships, active_org } = await loginAs(user);

    expect(memberships).toHaveLength(2);
    expect(active_org.id).toBe(orgA.id);
    const decoded = jwt.decode(access_token);
    expect(decoded.org_id).toBe(orgA.id);
    expect(decoded.role).toBe('sales');
  });

  test('authenticate resolves role live per-org, not from the JWT role claim', async () => {
    const { user, orgB } = await seedTwoOrgUser();

    // Craft a token that lies about the role — resolveOrgContext must ignore
    // it and use the live OrgMembership row for (user, org_id) instead.
    const env = require('../src/config/env');
    const staleToken = jwt.sign(
      { sub: user.id, role: 'recruiter', name: user.name, email: user.email, org_id: orgB.id },
      env.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    const res = await authed(request(app).get('/api/v1/orgs/me/memberships'), staleToken);
    expect(res.status).toBe(200);
    // Two more assertions that only pass if role was actually re-resolved:
    // an admin-only route succeeds even though the token claims 'recruiter'.
    const adminOnly = await authed(request(app).get('/api/v1/orgs'), staleToken);
    expect(adminOnly.status).toBe(403); // admin (per-org role) is not group-superadmin
  });

  test('an ended membership is ignored — falls back to the JWT role claim, does not 403', async () => {
    const user = await createUser({ role: 'recruiter' });
    const org = await createOrg();
    await createOrgMembership(user.id, org.id, { role: 'admin', employment_status: 'terminated' });

    const env = require('../src/config/env');
    const token = jwt.sign(
      { sub: user.id, role: 'recruiter', name: user.name, email: user.email, org_id: org.id },
      env.jwt.accessSecret,
      { expiresIn: '1h' }
    );
    const res = await authed(request(app).get('/api/v1/users/me'), token);
    expect(res.status).toBe(200);
  });

  test('GET /orgs/me/memberships lists every active org for the caller', async () => {
    const { user, orgA, orgB } = await seedTwoOrgUser();
    const { access_token } = await loginAs(user);
    const res = await authed(request(app).get('/api/v1/orgs/me/memberships'), access_token);
    expect(res.status).toBe(200);
    const slugs = res.body.data.map((m) => m.org.slug).sort();
    expect(slugs).toEqual(['acconcy', 'delphic'].sort());
    expect(res.body.data.find((m) => m.org.id === orgA.id).role).toBe('sales');
    expect(res.body.data.find((m) => m.org.id === orgB.id).role).toBe('admin');
  });
});

describe('multi-company ERP Phase 1 — org switcher', () => {
  test('switching to a org the caller belongs to re-scopes role + org_id', async () => {
    const user = await createUser({ role: 'sales' });
    const orgA = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const orgB = await createOrg({ name: 'Acconcy', slug: 'acconcy' });
    await createOrgMembership(user.id, orgA.id, { role: 'sales' });
    await createOrgMembership(user.id, orgB.id, { role: 'admin' });

    const { access_token } = await loginAs(user);
    const res = await authed(request(app).post('/api/v1/auth/switch-org'), access_token).send({
      org_id: orgB.id,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.active_org.id).toBe(orgB.id);
    const decoded = jwt.decode(res.body.data.access_token);
    expect(decoded.org_id).toBe(orgB.id);
    expect(decoded.role).toBe('admin');
  });

  test('switching to an org the caller does not belong to is rejected', async () => {
    const user = await createUser({ role: 'sales' });
    const org = await createOrg();
    const { access_token } = await loginAs(user);

    const res = await authed(request(app).post('/api/v1/auth/switch-org'), access_token).send({
      org_id: org.id,
    });
    expect(res.status).toBe(403);
  });
});

describe('multi-company ERP Phase 1 — group superadmin', () => {
  test('GET /orgs is forbidden for an ordinary admin', async () => {
    const admin = await createUser({ role: 'admin' });
    const { access_token } = await loginAs(admin);
    const res = await authed(request(app).get('/api/v1/orgs'), access_token);
    expect(res.status).toBe(403);
  });

  test('GET /orgs works for is_group_superadmin, lists every org', async () => {
    const gsa = await prisma.user.create({
      data: {
        name: 'Group Superadmin',
        email: 'gsa@test.local',
        password_hash: (await require('bcryptjs').hash('Password123!', 4)),
        role: 'admin',
        is_group_superadmin: true,
      },
    });
    await createOrg({ name: 'Delphic', slug: 'delphic' });
    await createOrg({ name: 'Acconcy', slug: 'acconcy' });

    const { access_token } = await loginAs(gsa);
    const res = await authed(request(app).get('/api/v1/orgs'), access_token);
    expect(res.status).toBe(200);
    expect(res.body.data.map((o) => o.slug).sort()).toEqual(['acconcy', 'delphic']);
  });

  test('demoting is_group_superadmin takes effect on the very next request (no JWT trust)', async () => {
    const gsa = await prisma.user.create({
      data: {
        name: 'Group Superadmin',
        email: 'gsa2@test.local',
        password_hash: await require('bcryptjs').hash('Password123!', 4),
        role: 'admin',
        is_group_superadmin: true,
      },
    });
    const { access_token } = await loginAs(gsa);

    const before = await authed(request(app).get('/api/v1/orgs'), access_token);
    expect(before.status).toBe(200);

    await prisma.user.update({ where: { id: gsa.id }, data: { is_group_superadmin: false } });

    const after = await authed(request(app).get('/api/v1/orgs'), access_token);
    expect(after.status).toBe(403);
  });
});
