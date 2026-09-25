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

async function seedOrgAdmin(overrides = {}) {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  if (overrides.is_group_superadmin) {
    await prisma.user.update({ where: { id: admin.id }, data: { is_group_superadmin: true } });
  }
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

async function seedAccountAndRequirement(orgId, ownerId, salesOwnerId) {
  const account = await prisma.account.create({
    data: { type: 'client', name: 'Test Client Co', stage: 'active', owner_id: ownerId, org_id: orgId },
  });
  const requirement = await prisma.requirement.create({
    data: { account_id: account.id, title: 'Backend Engineer', req_type: 'recruitment', sales_owner_id: salesOwnerId, org_id: orgId },
  });
  return { account, requirement };
}

async function approvedEntry(orgId, membershipId, accountId, requirementId, date, hours, billable = true) {
  return prisma.timesheetEntry.create({
    data: {
      org_id: orgId,
      org_membership_id: membershipId,
      account_id: accountId,
      requirement_id: requirementId,
      date: new Date(date),
      hours,
      billable,
      status: 'approved',
    },
  });
}

describe('Phase 5 — billing routes require an active org membership', () => {
  test('a user with no OrgMembership gets 403, not a crash', async () => {
    const user = await createUser({ role: 'recruiter' });
    const { access_token } = await loginAs(user);
    const res = await authed(request(app).get('/api/v1/billing/rates'), access_token);
    expect(res.status).toBe(403);
  });
});

describe('Phase 5 — billing rates', () => {
  test('admin sets an account-wide rate; a non-admin cannot', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    const forbidden = await authed(request(app).post('/api/v1/billing/rates'), empToken).send({
      account_id: account.id,
      rate_type: 'hourly',
      rate: 500,
      effective_from: '2026-09-01',
    });
    expect(forbidden.status).toBe(403);

    const created = await authed(request(app).post('/api/v1/billing/rates'), adminToken).send({
      account_id: account.id,
      rate_type: 'hourly',
      rate: 500,
      effective_from: '2026-09-01',
    });
    expect(created.status).toBe(201);
    expect(Number(created.body.data.rate)).toBe(500);
  });

  test('a requirement not belonging to the given account is rejected', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { account: accountA } = await seedAccountAndRequirement(org.id, admin.id, admin.id);
    const { requirement: reqB } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    const res = await authed(request(app).post('/api/v1/billing/rates'), adminToken).send({
      account_id: accountA.id,
      requirement_id: reqB.id,
      rate_type: 'hourly',
      rate: 500,
      effective_from: '2026-09-01',
    });
    expect(res.status).toBe(404);
  });
});

describe('Phase 5 — computing daily project revenue', () => {
  test('hourly rate: approved + billable hours generate revenue; non-billable and non-approved do not', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    await authed(request(app).post('/api/v1/billing/rates'), adminToken).send({
      account_id: account.id,
      rate_type: 'hourly',
      rate: 1000,
      effective_from: '2026-09-01',
    });

    await approvedEntry(org.id, membership.id, account.id, null, '2026-09-10', 6);
    // non-billable — must not count
    await approvedEntry(org.id, membership.id, account.id, null, '2026-09-10', 2, false);
    // draft (unapproved) — must not count
    await prisma.timesheetEntry.create({
      data: { org_id: org.id, org_membership_id: membership.id, account_id: account.id, date: new Date('2026-09-10'), hours: 3 },
    });

    const compute = await authed(request(app).post('/api/v1/billing/daily-revenue/compute'), adminToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });
    expect(compute.status).toBe(200);
    expect(compute.body.data.computed_count).toBe(1);

    const list = await authed(request(app).get('/api/v1/billing/daily-revenue?account_id=' + account.id), adminToken);
    expect(list.body.data).toHaveLength(1);
    expect(Number(list.body.data[0].billable_hours)).toBe(6);
    expect(Number(list.body.data[0].revenue)).toBe(6000);
  });

  test("monthly rate: 160h benchmark spread over the month working days (Phase 2)", async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    await authed(request(app).post('/api/v1/billing/rates'), adminToken).send({
      account_id: account.id,
      rate_type: 'monthly',
      rate: 30000, // Sep 2026 has 22 Mon-Fri days; 4h of the 160h benchmark = 30000 x 4/160
      effective_from: '2026-09-01',
    });
    await approvedEntry(org.id, membership.id, account.id, null, '2026-09-15', 4);

    await authed(request(app).post('/api/v1/billing/daily-revenue/compute'), adminToken).send({
      date_from: '2026-09-15',
      date_to: '2026-09-15',
    });

    const list = await authed(request(app).get('/api/v1/billing/daily-revenue?account_id=' + account.id), adminToken);
    expect(Number(list.body.data[0].revenue)).toBe(750);
  });

  test('a requirement-specific rate overrides the account-wide rate', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const { account, requirement } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    await authed(request(app).post('/api/v1/billing/rates'), adminToken).send({
      account_id: account.id,
      rate_type: 'hourly',
      rate: 500,
      effective_from: '2026-09-01',
    });
    await authed(request(app).post('/api/v1/billing/rates'), adminToken).send({
      account_id: account.id,
      requirement_id: requirement.id,
      rate_type: 'hourly',
      rate: 1500,
      effective_from: '2026-09-01',
    });
    await approvedEntry(org.id, membership.id, account.id, requirement.id, '2026-09-10', 4);

    await authed(request(app).post('/api/v1/billing/daily-revenue/compute'), adminToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });

    const list = await authed(request(app).get('/api/v1/billing/daily-revenue?account_id=' + account.id), adminToken);
    const row = list.body.data.find((r) => r.requirement_id === requirement.id);
    expect(Number(row.revenue)).toBe(6000); // 4h * 1500
  });

  test('no billing rate — the pairing is skipped, not failed', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);
    await approvedEntry(org.id, membership.id, account.id, null, '2026-09-10', 4);

    const compute = await authed(request(app).post('/api/v1/billing/daily-revenue/compute'), adminToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });
    expect(compute.body.data.computed_count).toBe(0);
    expect(compute.body.data.skipped).toHaveLength(1);
    expect(compute.body.data.skipped[0].reason).toBe('no_billing_rate');
  });

  test('recomputing a date updates the existing row instead of duplicating', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    await authed(request(app).post('/api/v1/billing/rates'), adminToken).send({
      account_id: account.id,
      rate_type: 'hourly',
      rate: 1000,
      effective_from: '2026-09-01',
    });
    await approvedEntry(org.id, membership.id, account.id, null, '2026-09-10', 4);

    await authed(request(app).post('/api/v1/billing/daily-revenue/compute'), adminToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });
    // Log more hours the same day, then recompute.
    await approvedEntry(org.id, membership.id, account.id, null, '2026-09-10', 2);
    await authed(request(app).post('/api/v1/billing/daily-revenue/compute'), adminToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });

    const list = await authed(request(app).get('/api/v1/billing/daily-revenue?account_id=' + account.id), adminToken);
    expect(list.body.data).toHaveLength(1);
    expect(Number(list.body.data[0].billable_hours)).toBe(6);
  });
});

describe('Phase 5 — client invoices', () => {
  async function setupRevenue(adminToken, org, membership, account, hours = 6, rate = 1000) {
    await authed(request(app).post('/api/v1/billing/rates'), adminToken).send({
      account_id: account.id,
      rate_type: 'hourly',
      rate,
      effective_from: '2026-09-01',
    });
    await approvedEntry(org.id, membership.id, account.id, null, '2026-09-10', hours);
    await authed(request(app).post('/api/v1/billing/daily-revenue/compute'), adminToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });
  }

  test('generates a draft invoice from computed revenue; a duplicate period is rejected', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);
    await setupRevenue(adminToken, org, membership, account);

    const invoice = await authed(request(app).post('/api/v1/billing/invoices'), adminToken).send({
      client_account_id: account.id,
      period_month: 9,
      period_year: 2026,
    });
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.status).toBe('draft');
    expect(Number(invoice.body.data.amount)).toBe(6000);
    expect(invoice.body.data.line_items).toHaveLength(1);

    const dup = await authed(request(app).post('/api/v1/billing/invoices'), adminToken).send({
      client_account_id: account.id,
      period_month: 9,
      period_year: 2026,
    });
    expect(dup.status).toBe(409);
  });

  test('generating an invoice with no computed revenue is rejected', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    const res = await authed(request(app).post('/api/v1/billing/invoices'), adminToken).send({
      client_account_id: account.id,
      period_month: 9,
      period_year: 2026,
    });
    expect(res.status).toBe(422);
  });

  test('status moves draft -> sent -> paid; skipping a step is rejected; a non-admin cannot transition', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { membership, access_token: empToken } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);
    await setupRevenue(adminToken, org, membership, account);

    const invoice = await authed(request(app).post('/api/v1/billing/invoices'), adminToken).send({
      client_account_id: account.id,
      period_month: 9,
      period_year: 2026,
    });
    const id = invoice.body.data.id;

    const skip = await authed(request(app).post(`/api/v1/billing/invoices/${id}/status`), adminToken).send({ status: 'paid' });
    expect(skip.status).toBe(409);

    const byEmp = await authed(request(app).post(`/api/v1/billing/invoices/${id}/status`), empToken).send({ status: 'sent' });
    expect(byEmp.status).toBe(403);

    const sent = await authed(request(app).post(`/api/v1/billing/invoices/${id}/status`), adminToken).send({ status: 'sent' });
    expect(sent.status).toBe(200);
    expect(sent.body.data.status).toBe('sent');

    const paid = await authed(request(app).post(`/api/v1/billing/invoices/${id}/status`), adminToken).send({ status: 'paid' });
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('paid');
  });
});

describe('Phase 5 — intra-group billing charges', () => {
  test('only a group-superadmin can raise a charge; the charged org sees it in its own list', async () => {
    const { org: orgA, access_token: groupSuperToken } = await seedOrgAdmin({ is_group_superadmin: true });
    const orgB = await prisma.org.create({
      data: { org_group_id: orgA.org_group_id, name: 'Acconcy', slug: 'acconcy' },
    });
    const orgBAdmin = await createUser({ role: 'admin' });
    await createOrgMembership(orgBAdmin.id, orgB.id, { role: 'admin' });
    const { access_token: orgBToken } = await loginAs(orgBAdmin);

    const forbidden = await authed(request(app).post('/api/v1/billing/group-charges'), orgBToken).send({
      org_id: orgB.id,
      period_month: 9,
      period_year: 2026,
      kind: 'management_fee',
      amount: 5000,
    });
    expect(forbidden.status).toBe(403);

    const created = await authed(request(app).post('/api/v1/billing/group-charges'), groupSuperToken).send({
      org_id: orgB.id,
      period_month: 9,
      period_year: 2026,
      kind: 'management_fee',
      amount: 5000,
    });
    expect(created.status).toBe(201);

    const selfView = await authed(request(app).get('/api/v1/billing/group-charges'), orgBToken);
    expect(selfView.body.data).toHaveLength(1);
    expect(selfView.body.data[0].kind).toBe('management_fee');

    const groupView = await authed(request(app).get('/api/v1/billing/group-charges/all'), groupSuperToken);
    expect(groupView.body.data).toHaveLength(1);
    expect(groupView.body.data[0].org.id).toBe(orgB.id);

    const groupViewForbidden = await authed(request(app).get('/api/v1/billing/group-charges/all'), orgBToken);
    expect(groupViewForbidden.status).toBe(403);
  });

  test('Add Group Expense: an org admin adds a charge to their OWN org only; non-admins are refused', async () => {
    const { org, admin, access_token } = await seedOrgAdmin();
    const otherOrg = await prisma.org.create({ data: { org_group_id: org.org_group_id, name: 'Acconcy', slug: 'acconcy' } });
    const body = { period_month: 9, period_year: 2026, kind: 'Shared office', amount: 12500.5, currency: 'INR' };

    // An org_id in the body is ignored — the charge always lands on the caller's org.
    const created = await authed(request(app).post('/api/v1/billing/group-charges/mine'), access_token).send({ ...body, org_id: otherOrg.id });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ org_id: org.id, org_group_id: org.org_group_id, kind: 'Shared office', raised_by: admin.id });
    expect(Number(created.body.data.amount)).toBe(12500.5);
    expect(await prisma.groupBillingCharge.count({ where: { org_id: otherOrg.id } })).toBe(0);

    const list = await authed(request(app).get('/api/v1/billing/group-charges'), access_token);
    expect(list.body.data).toHaveLength(1);

    const invalid = await authed(request(app).post('/api/v1/billing/group-charges/mine'), access_token).send({ ...body, amount: 0 });
    expect(invalid.status).toBe(422);

    for (const role of ['sales', 'recruiter', 'bda', 'employee']) {
      const { access_token: token } = await seedOrgEmployee(org, role);
      expect((await authed(request(app).post('/api/v1/billing/group-charges/mine'), token).send(body)).status).toBe(403);
    }
    expect(await prisma.groupBillingCharge.count()).toBe(1);
  });
});
