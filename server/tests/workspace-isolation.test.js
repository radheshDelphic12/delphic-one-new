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

async function adminIn(orgOverrides = {}) {
  const org = await createOrg(orgOverrides);
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}

const GATED_GET_ROUTES = [
  '/api/v1/accounts',
  '/api/v1/requirements',
  '/api/v1/profiles',
  '/api/v1/submissions',
  '/api/v1/pipeline',
  '/api/v1/reports/clients-without-requirements',
  '/api/v1/analytics/live-sales',
  '/api/v1/financials/monthly',
];

describe('workspace isolation — recruitment/strategic layer is Delphic-Global-only', () => {
  test('a non-master workspace gets 403 on every gated route', async () => {
    const { token } = await adminIn({ is_master_workspace: false });
    for (const path of GATED_GET_ROUTES) {
      const res = await authed(request(app).get(path), token);
      expect(res.status).toBe(403);
    }
  });

  test('the master workspace (createOrg default) still gets normal responses on the same routes', async () => {
    const { token } = await adminIn();
    for (const path of ['/api/v1/accounts', '/api/v1/requirements', '/api/v1/profiles', '/api/v1/submissions']) {
      const res = await authed(request(app).get(path), token);
      expect(res.status).toBe(200);
    }
  });

  test('a user with no org context (no membership) is passed through, not blocked — matches the existing global-role fallback', async () => {
    const user = await createUser({ role: 'admin' });
    const { access_token } = await loginAs(user);
    const res = await authed(request(app).get('/api/v1/accounts'), access_token);
    expect(res.status).toBe(200);
  });

  test('is_master_workspace is surfaced on the org object from login and from /orgs/me/memberships', async () => {
    const { org, token } = await adminIn({ is_master_workspace: false });
    const membership = await prisma.orgMembership.findFirst({ where: { org_id: org.id }, include: { person: true } });
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: membership.person.email, password: 'Password123!' });
    expect(loginRes.body.data.active_org.is_master_workspace).toBe(false);

    const membershipsRes = await authed(request(app).get('/api/v1/orgs/me/memberships'), token);
    expect(membershipsRes.body.data[0].org.is_master_workspace).toBe(false);
  });

  test('flipping the flag takes effect on the very next request (no token trust, matches requireModule/authorizeSuperadmin posture)', async () => {
    const { org, token } = await adminIn({ is_master_workspace: false });
    const blocked = await authed(request(app).get('/api/v1/accounts'), token);
    expect(blocked.status).toBe(403);

    await prisma.org.update({ where: { id: org.id }, data: { is_master_workspace: true } });
    const allowed = await authed(request(app).get('/api/v1/accounts'), token);
    expect(allowed.status).toBe(200);
  });
});

describe('dashboard stays available to every workspace', () => {
  test('a non-master workspace can still load /dashboard/summary (branches client-side, not blocked)', async () => {
    const { token } = await adminIn({ is_master_workspace: false });
    const res = await authed(request(app).get('/api/v1/dashboard/summary'), token);
    expect(res.status).toBe(200);
  });
});
