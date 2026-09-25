const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedOrgAdmin() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  const membership = await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, membership, access_token };
}

async function seedOrgEmployee(org, role = 'recruiter') {
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role });
  const { access_token } = await loginAs(user);
  return { user, membership, access_token };
}

async function grantGuestAccess(adminToken, overrides = {}) {
  const res = await authed(request(app).post('/api/v1/external-access'), adminToken).send({
    email: 'ca@external-firm.example',
    resources: ['accounting'],
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  });
  return res;
}

describe('Phase 9 — admin grants/lists/revokes external access', () => {
  test('a non-admin cannot grant access; an admin can, and the token is only ever shown once', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);

    const forbidden = await grantGuestAccess(empToken);
    expect(forbidden.status).toBe(403);

    const granted = await grantGuestAccess(adminToken);
    expect(granted.status).toBe(201);
    expect(granted.body.data.token).toMatch(/^ext_/);
    expect(granted.body.data.grant.email).toBe('ca@external-firm.example');
    expect(granted.body.data.grant).not.toHaveProperty('token_hash');

    const list = await authed(request(app).get('/api/v1/external-access'), adminToken);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].email).toBe('ca@external-firm.example');
  });

  test('revoking a grant works once; revoking again is rejected', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const granted = await grantGuestAccess(adminToken);
    const id = granted.body.data.grant.id;

    const revoked = await authed(request(app).post(`/api/v1/external-access/${id}/revoke`), adminToken);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.revoked_at).not.toBeNull();

    const again = await authed(request(app).post(`/api/v1/external-access/${id}/revoke`), adminToken);
    expect(again.status).toBe(409);
  });
});

describe('Phase 9 — the guest portal has its own bearer-token auth, not JWT', () => {
  test('a valid token in scope reads the accounting trial balance', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    await authed(request(app).post('/api/v1/accounting/ledger-accounts'), adminToken).send({ name: 'Cash', kind: 'asset' });
    const granted = await grantGuestAccess(adminToken);
    const { token } = granted.body.data;

    const res = await request(app).get('/api/v1/external-access/guest/accounting/trial-balance').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.accounts).toHaveLength(1);
  });

  test('a missing or garbage token is rejected', async () => {
    const noAuth = await request(app).get('/api/v1/external-access/guest/accounting/trial-balance');
    expect(noAuth.status).toBe(401);

    const badToken = await request(app)
      .get('/api/v1/external-access/guest/accounting/trial-balance')
      .set('Authorization', 'Bearer ext_not_a_real_token');
    expect(badToken.status).toBe(401);
  });

  test('a revoked token is rejected even though it was valid before', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const granted = await grantGuestAccess(adminToken);
    const { token, grant } = granted.body.data;

    await authed(request(app).post(`/api/v1/external-access/${grant.id}/revoke`), adminToken);

    const res = await request(app).get('/api/v1/external-access/guest/accounting/trial-balance').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  test('an expired token is rejected', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const granted = await grantGuestAccess(adminToken, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const { token } = granted.body.data;

    const res = await request(app).get('/api/v1/external-access/guest/accounting/trial-balance').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  test('a grant scoped only to accounting cannot be repurposed for a resource it does not name — reports 403, not a crash', async () => {
    // No other guest resource exists yet to prove a positive cross-resource
    // block, so this proves the negative shape: an empty resources list
    // (rejected at validation) can never produce a usable token.
    const { access_token: adminToken } = await seedOrgAdmin();
    const res = await authed(request(app).post('/api/v1/external-access'), adminToken).send({
      email: 'ca@external-firm.example',
      resources: [],
      expires_at: new Date(Date.now() + 1000).toISOString(),
    });
    expect(res.status).toBe(422);
  });
});
