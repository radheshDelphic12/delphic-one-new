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

// Mirrors erp-phase6-profitability.test.js's own backdate rationale —
// createOrgMembership defaults joined_at to "now", which is after the
// fixed 2026-09-10 dates this suite computes against.
async function backdate(membership) {
  return prisma.orgMembership.update({ where: { id: membership.id }, data: { joined_at: new Date('2026-01-01') } });
}

async function seedOrgAdmin() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  const membership = await backdate(await createOrgMembership(admin.id, org.id, { role: 'admin' }));
  const { access_token } = await loginAs(admin);
  return { org, admin, membership, access_token };
}

async function seedOrgEmployee(org, role = 'employee') {
  const user = await createUser({ role });
  const membership = await backdate(await createOrgMembership(user.id, org.id, { role }));
  const { access_token } = await loginAs(user);
  return { user, membership, access_token };
}

async function seedAccount(orgId, ownerId, overrides = {}) {
  return prisma.account.create({
    data: { type: 'client', name: 'Costed Project', stage: 'active', owner_id: ownerId, org_id: orgId, ...overrides },
  });
}

async function setSalary(orgId, adminToken, membershipId, ctc) {
  return authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken).send({
    org_membership_id: membershipId,
    effective_from: '2026-09-01',
    ctc,
    components: { basic: ctc },
  });
}

async function approvedEntry(orgId, membershipId, accountId, date, hours) {
  return prisma.timesheetEntry.create({
    data: { org_id: orgId, org_membership_id: membershipId, account_id: accountId, date: new Date(date), hours, billable: true, status: 'approved' },
  });
}

describe('Module C — project cost rate assignment', () => {
  test('admin sets a cost rate; posting again for the same person+project updates it instead of erroring', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const account = await seedAccount(org.id, membership.person_id);

    const first = await authed(request(app).post('/api/v1/billing/cost-assignments'), adminToken).send({
      account_id: account.id, org_membership_id: membership.id, cost_rate_per_hr: 500,
    });
    expect(first.status).toBe(201);
    expect(Number(first.body.data.cost_rate_per_hr)).toBe(500);

    const second = await authed(request(app).post('/api/v1/billing/cost-assignments'), adminToken).send({
      account_id: account.id, org_membership_id: membership.id, cost_rate_per_hr: 750,
    });
    expect(second.status).toBe(201);
    expect(Number(second.body.data.cost_rate_per_hr)).toBe(750);

    const list = await authed(request(app).get('/api/v1/billing/cost-assignments').query({ account_id: account.id }), adminToken);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(Number(list.body.data[0].cost_rate_per_hr)).toBe(750);
  });

  test('a non-admin cannot set or list cost assignments, or read the budget summary', async () => {
    const { org } = await seedOrgAdmin();
    const { membership, access_token } = await seedOrgEmployee(org);
    const account = await seedAccount(org.id, membership.person_id);

    const create = await authed(request(app).post('/api/v1/billing/cost-assignments'), access_token).send({
      account_id: account.id, org_membership_id: membership.id, cost_rate_per_hr: 500,
    });
    expect(create.status).toBe(403);
    const list = await authed(request(app).get('/api/v1/billing/cost-assignments').query({ account_id: account.id }), access_token);
    expect(list.status).toBe(403);
    const budget = await authed(request(app).get('/api/v1/billing/budget-summary').query({ account_id: account.id }), access_token);
    expect(budget.status).toBe(403);
  });
});

describe('Module C — cost rate is recorded against the project, never added on top of salary', () => {
  test('daily profitability cost = salary-prorated cost only; hours × cost rate is kept in the breakdown for reference', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const costedAccount = await seedAccount(org.id, membership.person_id, { name: 'Costed Project' });
    const plainAccount = await seedAccount(org.id, membership.person_id, { name: 'Plain Project' });

    await setSalary(org.id, adminToken, membership.id, 30000); // 30000/30 = 1000/day
    await authed(request(app).post('/api/v1/billing/cost-assignments'), adminToken).send({
      account_id: costedAccount.id, org_membership_id: membership.id, cost_rate_per_hr: 200,
    });

    // 3h on the costed project (200/hr -> 600) + 2h on a plain project (no assignment -> 0 extra).
    await approvedEntry(org.id, membership.id, costedAccount.id, '2026-09-10', 3);
    await approvedEntry(org.id, membership.id, plainAccount.id, '2026-09-10', 2);

    const compute = await authed(request(app).post('/api/v1/profitability/compute'), adminToken).send({
      date_from: '2026-09-10', date_to: '2026-09-10',
    });
    expect(compute.status).toBe(200);

    const row = await prisma.dailyEmployeeProfitability.findUnique({
      where: { org_membership_id_date: { org_membership_id: membership.id, date: new Date('2026-09-10') } },
    });
    // The cost rate is the person's internal cost on the project (used by
    // Project P&L instead of a salary allocation) — never added on top of the
    // salary here, which would count the same person twice.
    expect(Number(row.cost)).toBe(1000);
    expect(row.breakdown.per_day_salary_cost).toBe(1000);
    expect(row.breakdown.project_cost).toBe(600);
    expect(row.breakdown.project_cost_counted).toBe(false);
    expect(row.breakdown.project_cost_allocations).toHaveLength(1);
    expect(row.breakdown.project_cost_allocations[0]).toMatchObject({ account_id: costedAccount.id, hours: 3, cost_rate_per_hr: 200, cost: 600 });
  });
});

describe('Module C — live project budget summary', () => {
  test('remaining budget shrinks as approved hours accrue; rejected/unapproved entries are never counted', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const account = await seedAccount(org.id, membership.person_id, { budget_amount: 10000, client_billing_currency: 'INR' });

    await authed(request(app).post('/api/v1/billing/cost-assignments'), adminToken).send({
      account_id: account.id, org_membership_id: membership.id, cost_rate_per_hr: 300,
    });

    const before = await authed(request(app).get('/api/v1/billing/budget-summary').query({ account_id: account.id }), adminToken);
    expect(before.status).toBe(200);
    expect(before.body.data).toMatchObject({ budget_amount: 10000, currency: 'INR', cost_incurred: 0, remaining_budget: 10000 });

    await approvedEntry(org.id, membership.id, account.id, '2026-09-10', 10); // 10 * 300 = 3000
    await prisma.timesheetEntry.create({
      data: { org_id: org.id, org_membership_id: membership.id, account_id: account.id, date: new Date('2026-09-11'), hours: 5, billable: true, status: 'submitted' },
    });
    await prisma.timesheetEntry.create({
      data: { org_id: org.id, org_membership_id: membership.id, account_id: account.id, date: new Date('2026-09-12'), hours: 5, billable: true, status: 'rejected' },
    });

    const after = await authed(request(app).get('/api/v1/billing/budget-summary').query({ account_id: account.id }), adminToken);
    expect(after.body.data.cost_incurred).toBe(3000);
    expect(after.body.data.remaining_budget).toBe(7000);
  });

  test('an account with no budget set returns a null remaining_budget, not an error', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const account = await seedAccount(org.id, membership.person_id);

    const res = await authed(request(app).get('/api/v1/billing/budget-summary').query({ account_id: account.id }), adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.budget_amount).toBeNull();
    expect(res.body.data.remaining_budget).toBeNull();
  });
});
