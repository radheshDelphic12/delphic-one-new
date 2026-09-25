const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedOrgAdmin(overrides = {}) {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  const membership = await createOrgMembership(admin.id, org.id, { role: 'admin' });
  if (overrides.is_group_superadmin) {
    await prisma.user.update({ where: { id: admin.id }, data: { is_group_superadmin: true } });
  }
  const { access_token } = await loginAs(admin);
  return { org, admin, membership, access_token };
}

async function seedEmployeeUnder(org, managerMembershipId, role = 'recruiter') {
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role });
  await prisma.orgMembership.update({ where: { id: membership.id }, data: { manager_id: managerMembershipId } });
  const { access_token } = await loginAs(user);
  return { user, membership, access_token };
}

describe('Phase 10 — org chart requires an active org membership', () => {
  test('a user with no OrgMembership gets 403, not a crash', async () => {
    const user = await createUser({ role: 'recruiter' });
    const { access_token } = await loginAs(user);
    const res = await authed(request(app).get('/api/v1/org-chart'), access_token);
    expect(res.status).toBe(403);
  });
});

describe('Phase 10 — the tree follows OrgMembership.manager_id', () => {
  test('an admin with two direct reports, one of whom has their own report, builds a 3-level tree', async () => {
    const { org, access_token: adminToken, membership: adminMembership } = await seedOrgAdmin();
    const { membership: leadMembership, access_token: leadToken } = await seedEmployeeUnder(org, adminMembership.id, 'recruiter');
    await seedEmployeeUnder(org, adminMembership.id, 'sales');
    await seedEmployeeUnder(org, leadMembership.id, 'recruiter');

    const res = await authed(request(app).get('/api/v1/org-chart'), adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.headcount).toBe(4);
    expect(res.body.data.roots).toHaveLength(1);

    const root = res.body.data.roots[0];
    expect(root.id).toBe(adminMembership.id);
    expect(root.direct_reports).toHaveLength(2);

    const lead = root.direct_reports.find((r) => r.id === leadMembership.id);
    expect(lead.direct_reports).toHaveLength(1);

    // Any active org member can view the chart, not just admins.
    const asEmployee = await authed(request(app).get('/api/v1/org-chart'), leadToken);
    expect(asEmployee.status).toBe(200);
  });

  test('a terminated member is excluded by default and included with include_terminated=true', async () => {
    const { org, access_token: adminToken, membership: adminMembership } = await seedOrgAdmin();
    const { membership: goneMembership } = await seedEmployeeUnder(org, adminMembership.id);
    await prisma.orgMembership.update({ where: { id: goneMembership.id }, data: { employment_status: 'terminated' } });

    const withoutTerminated = await authed(request(app).get('/api/v1/org-chart'), adminToken);
    expect(withoutTerminated.body.data.headcount).toBe(1);

    const withTerminated = await authed(request(app).get('/api/v1/org-chart?include_terminated=true'), adminToken);
    expect(withTerminated.body.data.headcount).toBe(2);
  });

  test('pending_onboarding and notice_period carry through as lifecycle indicators', async () => {
    const { org, access_token: adminToken, membership: adminMembership } = await seedOrgAdmin();
    const { membership: onboarding } = await seedEmployeeUnder(org, adminMembership.id);
    await prisma.orgMembership.update({ where: { id: onboarding.id }, data: { employment_status: 'pending_onboarding' } });
    const { membership: leaving } = await seedEmployeeUnder(org, adminMembership.id);
    const noticeEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await prisma.orgMembership.update({
      where: { id: leaving.id },
      data: { employment_status: 'notice_period', notice_end_date: noticeEnd },
    });

    const res = await authed(request(app).get('/api/v1/org-chart'), adminToken);
    const root = res.body.data.roots[0];
    const onboardingNode = root.direct_reports.find((r) => r.id === onboarding.id);
    const leavingNode = root.direct_reports.find((r) => r.id === leaving.id);
    expect(onboardingNode.employment_status).toBe('pending_onboarding');
    expect(leavingNode.employment_status).toBe('notice_period');
    expect(leavingNode.notice_end_date).not.toBeNull();
  });
});

describe('Phase 10 — combined group chart is gated to group superadmins', () => {
  test('a regular org admin cannot see the combined group view', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const res = await authed(request(app).get('/api/v1/org-chart/group'), adminToken);
    expect(res.status).toBe(403);
  });

  test('a group superadmin sees every org, each with its own tree', async () => {
    const { org: orgA, membership: adminAMembership } = await seedOrgAdmin();
    await seedEmployeeUnder(orgA, adminAMembership.id);

    // Same holding group as orgA — a group superadmin with no explicit
    // org_group_membership relies on the single-holding-group fallback in
    // authorizeGroupSuperadmin, which only resolves when there's exactly one.
    const orgB = await createOrg({ name: 'Acconcy', slug: 'acconcy', org_group_id: orgA.org_group_id });
    const adminB = await createUser({ role: 'admin' });
    const adminBMembership = await createOrgMembership(adminB.id, orgB.id, { role: 'admin' });
    await seedEmployeeUnder(orgB, adminBMembership.id);

    const groupSuper = await createUser({ role: 'admin' });
    await prisma.user.update({ where: { id: groupSuper.id }, data: { is_group_superadmin: true } });
    const { access_token: groupSuperToken } = await loginAs(groupSuper);

    const res = await authed(request(app).get('/api/v1/org-chart/group'), groupSuperToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const chartA = res.body.data.find((c) => c.org.id === orgA.id);
    const chartB = res.body.data.find((c) => c.org.id === orgB.id);
    expect(chartA.headcount).toBe(2);
    expect(chartB.headcount).toBe(2);
  });
});
