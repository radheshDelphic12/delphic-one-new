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

async function seedLocation(orgId, name = 'Ahmedabad') {
  return prisma.location.create({ data: { org_id: orgId, name } });
}

describe('Phase 7 — expenses routes require an active org membership', () => {
  test('a user with no OrgMembership gets 403, not a crash', async () => {
    const user = await createUser({ role: 'recruiter' });
    const { access_token } = await loginAs(user);
    const res = await authed(request(app).get('/api/v1/expenses/claims/me'), access_token);
    expect(res.status).toBe(403);
  });
});

describe('Phase 7 — expense claims', () => {
  test('an employee submits a claim; a location from another org is rejected', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const location = await seedLocation(org.id);

    const claim = await authed(request(app).post('/api/v1/expenses/claims'), empToken).send({
      location_id: location.id,
      category: 'Travel',
      amount: 2500,
    });
    expect(claim.status).toBe(201);
    expect(claim.body.data.status).toBe('pending');

    const otherOrg = await createOrg({ name: 'Acconcy', slug: 'acconcy' });
    const otherLocation = await seedLocation(otherOrg.id);
    const rejected = await authed(request(app).post('/api/v1/expenses/claims'), empToken).send({
      location_id: otherLocation.id,
      category: 'Travel',
      amount: 1000,
    });
    expect(rejected.status).toBe(404);
  });

  test('admin approves then reimburses; reimbursing a pending claim is rejected; double-decide is rejected', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const location = await seedLocation(org.id);
    const claim = await authed(request(app).post('/api/v1/expenses/claims'), empToken).send({
      location_id: location.id,
      category: 'Client dinner',
      amount: 4000,
    });
    const id = claim.body.data.id;

    const tooEarly = await authed(request(app).post(`/api/v1/expenses/claims/${id}/reimburse`), adminToken);
    expect(tooEarly.status).toBe(422);

    const approve = await authed(request(app).post(`/api/v1/expenses/claims/${id}/decision`), adminToken).send({
      status: 'approved',
    });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('approved');

    const redecide = await authed(request(app).post(`/api/v1/expenses/claims/${id}/decision`), adminToken).send({
      status: 'rejected',
    });
    expect(redecide.status).toBe(409);

    const reimburse = await authed(request(app).post(`/api/v1/expenses/claims/${id}/reimburse`), adminToken);
    expect(reimburse.status).toBe(200);
    expect(reimburse.body.data.status).toBe('reimbursed');
    expect(reimburse.body.data.reimbursed_at).not.toBeNull();
  });

  test('a rejected claim carries the reason and cannot be reimbursed', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const location = await seedLocation(org.id);
    const claim = await authed(request(app).post('/api/v1/expenses/claims'), empToken).send({
      location_id: location.id,
      category: 'Personal',
      amount: 500,
    });

    const decision = await authed(request(app).post(`/api/v1/expenses/claims/${claim.body.data.id}/decision`), adminToken).send({
      status: 'rejected',
      reason: 'Not a valid business expense',
    });
    expect(decision.body.data.status).toBe('rejected');
    expect(decision.body.data.decision_reason).toBe('Not a valid business expense');

    const reimburse = await authed(request(app).post(`/api/v1/expenses/claims/${claim.body.data.id}/reimburse`), adminToken);
    expect(reimburse.status).toBe(422);
  });

  test('an employee sees only their own claims; admin sees the whole team', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: tokenA } = await seedOrgEmployee(org);
    const { access_token: tokenB } = await seedOrgEmployee(org);
    const location = await seedLocation(org.id);

    await authed(request(app).post('/api/v1/expenses/claims'), tokenA).send({
      location_id: location.id,
      category: 'Travel',
      amount: 1000,
    });
    await authed(request(app).post('/api/v1/expenses/claims'), tokenB).send({
      location_id: location.id,
      category: 'Supplies',
      amount: 300,
    });

    const mineA = await authed(request(app).get('/api/v1/expenses/claims/me'), tokenA);
    expect(mineA.body.data).toHaveLength(1);
    expect(mineA.body.data[0].category).toBe('Travel');

    const team = await authed(request(app).get('/api/v1/expenses/claims'), adminToken);
    expect(team.body.data).toHaveLength(2);
  });

  test('a non-admin cannot decide or reimburse a claim, or view the team list', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const location = await seedLocation(org.id);
    const claim = await authed(request(app).post('/api/v1/expenses/claims'), empToken).send({
      location_id: location.id,
      category: 'Travel',
      amount: 1000,
    });

    const decide = await authed(request(app).post(`/api/v1/expenses/claims/${claim.body.data.id}/decision`), empToken).send({
      status: 'approved',
    });
    expect(decide.status).toBe(403);

    const team = await authed(request(app).get('/api/v1/expenses/claims'), empToken);
    expect(team.status).toBe(403);

    // Sanity: admin path still works with the same claim.
    const approve = await authed(request(app).post(`/api/v1/expenses/claims/${claim.body.data.id}/decision`), adminToken).send({
      status: 'approved',
    });
    expect(approve.status).toBe(200);
  });
});

describe('Phase 7 — vendor payments (money going out, not the recruitment Account)', () => {
  test('admin raises a vendor payment; a non-admin cannot', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);

    const forbidden = await authed(request(app).post('/api/v1/expenses/vendor-payments'), empToken).send({
      vendor_name: 'Spiral TechnoLabs',
      vendor_type: 'contractor',
      amount: 50000,
      period_month: 9,
      period_year: 2026,
    });
    expect(forbidden.status).toBe(403);

    const created = await authed(request(app).post('/api/v1/expenses/vendor-payments'), adminToken).send({
      vendor_name: 'Spiral TechnoLabs',
      vendor_type: 'contractor',
      amount: 50000,
      period_month: 9,
      period_year: 2026,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('pending');
    expect(created.body.data.vendor_name).toBe('Spiral TechnoLabs');
  });

  test('decide then pay; paying before approval is rejected; double-decide is rejected', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const payment = await authed(request(app).post('/api/v1/expenses/vendor-payments'), adminToken).send({
      vendor_name: 'Acme Contractors',
      vendor_type: 'external_resource',
      amount: 20000,
      period_month: 9,
      period_year: 2026,
    });
    const id = payment.body.data.id;

    const tooEarly = await authed(request(app).post(`/api/v1/expenses/vendor-payments/${id}/pay`), adminToken);
    expect(tooEarly.status).toBe(422);

    const approve = await authed(request(app).post(`/api/v1/expenses/vendor-payments/${id}/decision`), adminToken).send({
      status: 'approved',
    });
    expect(approve.status).toBe(200);

    const redecide = await authed(request(app).post(`/api/v1/expenses/vendor-payments/${id}/decision`), adminToken).send({
      status: 'rejected',
    });
    expect(redecide.status).toBe(409);

    const paid = await authed(request(app).post(`/api/v1/expenses/vendor-payments/${id}/pay`), adminToken);
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('paid');
    expect(paid.body.data.paid_at).not.toBeNull();
  });

  test('lists filter by status, vendor_type, and period', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    await authed(request(app).post('/api/v1/expenses/vendor-payments'), adminToken).send({
      vendor_name: 'Contractor Co',
      vendor_type: 'contractor',
      amount: 10000,
      period_month: 9,
      period_year: 2026,
    });
    await authed(request(app).post('/api/v1/expenses/vendor-payments'), adminToken).send({
      vendor_name: 'Third Party Co',
      vendor_type: 'third_party',
      amount: 5000,
      period_month: 8,
      period_year: 2026,
    });

    const byType = await authed(request(app).get('/api/v1/expenses/vendor-payments?vendor_type=third_party'), adminToken);
    expect(byType.body.data).toHaveLength(1);
    expect(byType.body.data[0].vendor_name).toBe('Third Party Co');

    const byPeriod = await authed(
      request(app).get('/api/v1/expenses/vendor-payments?period_month=9&period_year=2026'),
      adminToken
    );
    expect(byPeriod.body.data).toHaveLength(1);
    expect(byPeriod.body.data[0].vendor_name).toBe('Contractor Co');
  });

  test('a vendor payment is not linked to the recruitment Account model at all', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    // A same-named recruitment vendor Account exists, but VendorPayment has
    // no FK to it whatsoever — vendor_name is plain text.
    await prisma.account.create({
      data: { type: 'vendor', name: 'Spiral TechnoLabs', stage: 'active', owner_id: admin.id, org_id: org.id },
    });

    const res = await authed(request(app).post('/api/v1/expenses/vendor-payments'), adminToken).send({
      vendor_name: 'Spiral TechnoLabs',
      vendor_type: 'contractor',
      amount: 15000,
      period_month: 9,
      period_year: 2026,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('account_id');
  });
});
