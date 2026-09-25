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
const profitabilityJob = require('../src/jobs/profitabilityCompute');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// createOrgMembership defaults joined_at to "now" (the real system clock at
// test-run time). This suite computes profitability for fixed 2026-09-10/11
// dates, which are before "now" on any run after that — so every membership
// must be explicitly backdated or the eligibility check in
// profitability.service (joined_at <= date) excludes them for reasons
// unrelated to what each test is actually checking.
async function backdate(membership) {
  return prisma.orgMembership.update({ where: { id: membership.id }, data: { joined_at: new Date('2026-01-01') } });
}

async function seedOrgAdmin(overrides = {}) {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  if (overrides.is_group_superadmin) {
    await prisma.user.update({ where: { id: admin.id }, data: { is_group_superadmin: true } });
  }
  const membership = await backdate(await createOrgMembership(admin.id, org.id, { role: 'admin' }));
  const { access_token } = await loginAs(admin);
  return { org, admin, membership, access_token };
}

async function seedOrgEmployee(org, role = 'recruiter') {
  const user = await createUser({ role });
  const membership = await backdate(await createOrgMembership(user.id, org.id, { role }));
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

async function setSalary(orgId, adminToken, membershipId, ctc) {
  return authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken).send({
    org_membership_id: membershipId,
    effective_from: '2026-09-01',
    ctc,
    components: { basic: ctc },
  });
}

async function setRate(adminToken, accountId, rate) {
  return authed(request(app).post('/api/v1/billing/rates'), adminToken).send({
    account_id: accountId,
    rate_type: 'hourly',
    rate,
    effective_from: '2026-09-01',
  });
}

async function approvedEntry(orgId, membershipId, accountId, requirementId, date, hours) {
  return prisma.timesheetEntry.create({
    data: {
      org_id: orgId,
      org_membership_id: membershipId,
      account_id: accountId,
      requirement_id: requirementId,
      date: new Date(date),
      hours,
      billable: true,
      status: 'approved',
    },
  });
}

describe('Phase 6 — profitability routes require an active org membership', () => {
  test('a user with no OrgMembership gets 403, not a crash', async () => {
    const user = await createUser({ role: 'recruiter' });
    const { access_token } = await loginAs(user);
    const res = await authed(request(app).get('/api/v1/profitability/me'), access_token);
    expect(res.status).toBe(403);
  });
});

describe('Phase 6 — computing daily employee profitability', () => {
  test('revenue is allocated pro-rata by hours across two employees on the same project-day; cost from each own salary', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { membership: empA } = await seedOrgEmployee(org);
    const { membership: empB } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    await setRate(adminToken, account.id, 1000); // hourly
    await setSalary(org.id, adminToken, empA.id, 30000); // 30000/30 = 1000/day
    await setSalary(org.id, adminToken, empB.id, 60000); // 60000/30 = 2000/day

    // Sep 10 2026: A logs 6h, B logs 2h -> total 8h, project revenue = 8*1000 = 8000
    await approvedEntry(org.id, empA.id, account.id, null, '2026-09-10', 6);
    await approvedEntry(org.id, empB.id, account.id, null, '2026-09-10', 2);

    const compute = await authed(request(app).post('/api/v1/profitability/compute'), adminToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });
    expect(compute.status).toBe(200);
    expect(compute.body.data.computed_count).toBe(2);

    const team = await authed(request(app).get('/api/v1/profitability/team'), adminToken);
    const rowA = team.body.data.find((r) => r.org_membership_id === empA.id);
    const rowB = team.body.data.find((r) => r.org_membership_id === empB.id);

    // A: 6/8 * 8000 = 6000 revenue, cost 1000 -> margin 5000
    expect(Number(rowA.revenue)).toBe(6000);
    expect(Number(rowA.cost)).toBe(1000);
    expect(Number(rowA.margin)).toBe(5000);
    // B: 2/8 * 8000 = 2000 revenue, cost 2000 -> margin 0
    expect(Number(rowB.revenue)).toBe(2000);
    expect(Number(rowB.cost)).toBe(2000);
    expect(Number(rowB.margin)).toBe(0);
  });

  test('a membership with no salary structure is skipped, not failed', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);
    await setRate(adminToken, account.id, 1000);
    await approvedEntry(org.id, membership.id, account.id, null, '2026-09-10', 4);
    // admin's own membership also has no salary structure — expect both skipped.

    const compute = await authed(request(app).post('/api/v1/profitability/compute'), adminToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });
    expect(compute.body.data.computed_count).toBe(0);
    expect(compute.body.data.skipped.some((s) => s.org_membership_id === membership.id)).toBe(true);
  });

  test('a day with no billable activity nets a pure cost (negative margin) — recompute is idempotent', async () => {
    const { org, access_token: adminToken, membership: adminMembership } = await seedOrgAdmin();
    await setSalary(org.id, adminToken, adminMembership.id, 30000);

    const first = await authed(request(app).post('/api/v1/profitability/compute'), adminToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });
    expect(first.body.data.computed_count).toBe(1);

    const mine = await authed(request(app).get('/api/v1/profitability/me'), adminToken);
    expect(Number(mine.body.data[0].revenue)).toBe(0);
    expect(Number(mine.body.data[0].margin)).toBe(-1000);

    // Recompute the same day — must update in place, not duplicate.
    await authed(request(app).post('/api/v1/profitability/compute'), adminToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });
    const again = await authed(request(app).get('/api/v1/profitability/me'), adminToken);
    expect(again.body.data).toHaveLength(1);
  });

  test('a non-admin cannot compute or view the team', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const compute = await authed(request(app).post('/api/v1/profitability/compute'), access_token).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });
    expect(compute.status).toBe(403);
    const team = await authed(request(app).get('/api/v1/profitability/team'), access_token);
    expect(team.status).toBe(403);
  });
});

describe('Phase 6 — rollup', () => {
  test('group_by=month sums revenue/cost/margin across days and employees', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);
    await setRate(adminToken, account.id, 1000);
    await setSalary(org.id, adminToken, membership.id, 30000);

    await approvedEntry(org.id, membership.id, account.id, null, '2026-09-10', 4);
    await approvedEntry(org.id, membership.id, account.id, null, '2026-09-11', 4);
    await authed(request(app).post('/api/v1/profitability/compute'), adminToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-11',
    });

    const rollup = await authed(
      request(app).get('/api/v1/profitability/rollup?from=2026-09-01&to=2026-09-30&group_by=month'),
      adminToken
    );
    expect(rollup.status).toBe(200);
    expect(rollup.body.data).toHaveLength(1);
    expect(rollup.body.data[0].period).toBe('2026-09');
    expect(Number(rollup.body.data[0].revenue)).toBe(8000); // 4000 + 4000
    expect(rollup.body.data[0].headcount).toBe(1);
  });
});

describe('Phase 6 — super dashboard (cross-org, group-superadmin only)', () => {
  test('a non-group-superadmin is rejected from both routes', async () => {
    const { access_token } = await seedOrgAdmin();
    const compute = await authed(request(app).post('/api/v1/super-dashboard/compute'), access_token).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });
    expect(compute.status).toBe(403);
    const rollup = await authed(request(app).get('/api/v1/super-dashboard/rollup?from=2026-09-01&to=2026-09-30'), access_token);
    expect(rollup.status).toBe(403);
  });

  test('a group-superadmin with no org membership at all can still use it — not gated by requireOrgMembership', async () => {
    const groupSuper = await createUser({ role: 'admin' });
    await prisma.user.update({ where: { id: groupSuper.id }, data: { is_group_superadmin: true } });
    const { access_token } = await loginAs(groupSuper);

    const res = await authed(request(app).get('/api/v1/super-dashboard/rollup?from=2026-09-01&to=2026-09-30'), access_token);
    expect(res.status).toBe(200);
  });

  test('computes across every org; rollup with no org_id totals the group, org_id drills into one company', async () => {
    // Simpler, deterministic fixture: one salaried membership per org, no
    // revenue — just confirm cross-org totals vs. single-org drill-in.
    const { org: orgA, membership: membershipA, access_token: groupSuperToken } = await seedOrgAdmin({ is_group_superadmin: true });
    const orgB = await prisma.org.create({ data: { org_group_id: orgA.org_group_id, name: 'Acconcy', slug: 'acconcy' } });
    const adminB = await createUser({ role: 'admin' });
    const membershipB = await backdate(await createOrgMembership(adminB.id, orgB.id, { role: 'admin' }));
    const { access_token: tokenB } = await loginAs(adminB);

    await setSalary(orgA.id, groupSuperToken, membershipA.id, 30000);
    await setSalary(orgB.id, tokenB, membershipB.id, 30000);

    const compute = await authed(request(app).post('/api/v1/super-dashboard/compute'), groupSuperToken).send({
      date_from: '2026-09-10',
      date_to: '2026-09-10',
    });
    expect(compute.status).toBe(200);
    expect(compute.body.data.orgs_processed).toBeGreaterThanOrEqual(2);

    const groupWide = await authed(
      request(app).get('/api/v1/super-dashboard/rollup?from=2026-09-01&to=2026-09-30&group_by=month'),
      groupSuperToken
    );
    expect(groupWide.status).toBe(200);
    // Both orgs' 1000/day cost summed into one group-wide total.
    expect(Number(groupWide.body.data[0].cost)).toBe(2000);

    const drillIntoB = await authed(
      request(app).get(`/api/v1/super-dashboard/rollup?from=2026-09-01&to=2026-09-30&group_by=month&org_id=${orgB.id}`),
      groupSuperToken
    );
    expect(drillIntoB.status).toBe(200);
    expect(Number(drillIntoB.body.data[0].cost)).toBe(1000);
  });
});

describe('Phase 6 — nightly job computes "yesterday"', () => {
  test('run(now) computes the calendar day before now, across every active org', async () => {
    const { org, access_token: adminToken, membership } = await seedOrgAdmin();
    await setSalary(org.id, adminToken, membership.id, 30000);

    const now = new Date('2026-09-11T03:00:00.000Z');
    const result = await profitabilityJob.run(now);
    expect(result.orgs_processed).toBeGreaterThanOrEqual(1);

    const row = await prisma.dailyEmployeeProfitability.findUnique({
      where: { org_membership_id_date: { org_membership_id: membership.id, date: new Date('2026-09-10') } },
    });
    expect(row).not.toBeNull();
  });
});
