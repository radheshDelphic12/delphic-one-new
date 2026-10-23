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
    const user = await createUser({ role: 'recruiter', withOrg: false });
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

  test('exited people stay out of the chart when the page itself asks include_terminated=false', async () => {
    const { org, access_token: adminToken, membership: adminMembership } = await seedOrgAdmin();
    const { membership: gone } = await seedEmployeeUnder(org, adminMembership.id);
    await prisma.orgMembership.update({ where: { id: gone.id }, data: { employment_status: 'terminated', left_at: new Date('2026-09-30T00:00:00Z') } });
    // the text "false" used to be read as true, so the exited person showed up
    const res = await authed(request(app).get('/api/v1/org-chart?include_terminated=false'), adminToken);
    expect(res.body.data.headcount).toBe(1);
    expect((await authed(request(app).get('/api/v1/org-chart?include_terminated=true'), adminToken)).body.data.headcount).toBe(2);
    expect((await authed(request(app).get('/api/v1/org-chart?include_terminated=1'), adminToken)).body.data.headcount).toBe(2);
  });

  test('someone whose last working day has passed is out of the chart even before the nightly exit job has run', async () => {
    const { org, access_token: adminToken, membership: adminMembership } = await seedOrgAdmin();
    const { membership: pastLwd } = await seedEmployeeUnder(org, adminMembership.id);
    await prisma.orgMembership.update({ where: { id: pastLwd.id }, data: { employment_status: 'notice_period', notice_end_date: new Date('2026-09-01T00:00:00Z') } });
    const { membership: leftNoStatus } = await seedEmployeeUnder(org, adminMembership.id);
    await prisma.orgMembership.update({ where: { id: leftNoStatus.id }, data: { left_at: new Date('2026-09-01T00:00:00Z') } });
    const { membership: stillServing } = await seedEmployeeUnder(org, adminMembership.id);
    await prisma.orgMembership.update({ where: { id: stillServing.id }, data: { employment_status: 'notice_period', notice_end_date: new Date(Date.now() + 5 * 86400000) } });

    const res = await authed(request(app).get('/api/v1/org-chart'), adminToken);
    expect(res.body.data.headcount).toBe(2); // the admin and the person still serving notice
    expect(res.body.data.roots[0].direct_reports.map((r) => r.id)).toEqual([stillServing.id]);
    expect((await authed(request(app).get('/api/v1/org-chart?include_terminated=true'), adminToken)).body.data.headcount).toBe(4);
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

    // withOrg: false — no membership anywhere, so login doesn't enroll them
    // in the helper's test org (a second holding group would break the
    // single-group fallback this test relies on).
    const groupSuper = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: groupSuper.id }, data: { is_group_superadmin: true } });
    const { access_token: groupSuperToken } = await loginAs(groupSuper);

    const res = await authed(request(app).get('/api/v1/org-chart/group'), groupSuperToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const chartA = res.body.data.find((c) => c.org.id === orgA.id);
    const chartB = res.body.data.find((c) => c.org.id === orgB.id);
    expect(chartA.headcount).toBe(2);
    expect(chartB.headcount).toBe(2);
    // under each company comes its own admin (the group chart shows Super Admin > company > its admin > its teams)
    expect(chartA.admins.map((a) => a.id)).toEqual([adminAMembership.id]);
    expect(chartB.admins.map((a) => a.id)).toEqual([adminBMembership.id]);
    expect(chartA.admins[0]).toMatchObject({ name: expect.any(String) });
  });

  test('the group superadmin is left out of a company chart, unless they lead or sit in one of its teams', async () => {
    const { org, membership: adminMembership } = await seedOrgAdmin();
    const groupSuper = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: groupSuper.id }, data: { is_group_superadmin: true } });
    const { access_token } = await loginAs(groupSuper);
    const superMembership = await prisma.orgMembership.upsert({
      where: { person_id_org_id: { person_id: groupSuper.id, org_id: org.id } },
      update: {},
      create: { person_id: groupSuper.id, org_id: org.id, role: 'admin', employee_code: 'GS1' },
    });
    const ids = async () => {
      const res = await authed(request(app).get('/api/v1/org-chart/group'), access_token);
      expect(res.status).toBe(200);
      return res.body.data.find((c) => c.org.id === org.id);
    };
    const flat = (nodes) => nodes.flatMap((n) => [n.id, ...flat(n.direct_reports)]);
    expect(flat((await ids()).roots)).not.toContain(superMembership.id);

    // a new, still empty team is in the payload too, and the superadmin leading it keeps them in the chart
    const team = await prisma.team.create({ data: { org_id: org.id, name: 'Board of Directors', lead_membership_id: superMembership.id } });
    const after = await ids();
    expect(after.teams.map((t) => t.id)).toContain(team.id);
    expect(flat(after.roots)).toContain(superMembership.id);
    expect(flat(after.roots)).toContain(adminMembership.id);
  });

  test('the group superadmin as only the "reports-to" of a team is not drawn again inside the company; the company admin is named for the chart', async () => {
    const { org, membership: adminMembership } = await seedOrgAdmin();
    const groupSuper = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: groupSuper.id }, data: { is_group_superadmin: true } });
    const { access_token } = await loginAs(groupSuper);
    const superMembership = await prisma.orgMembership.upsert({
      where: { person_id_org_id: { person_id: groupSuper.id, org_id: org.id } },
      update: {},
      create: { person_id: groupSuper.id, org_id: org.id, role: 'admin', employee_code: 'GS2' },
    });
    await prisma.team.create({ data: { org_id: org.id, name: 'Board of Directors', lead_membership_id: adminMembership.id, manager_membership_id: superMembership.id } });
    const res = await authed(request(app).get('/api/v1/org-chart/group'), access_token);
    expect(res.status).toBe(200);
    const chart = res.body.data.find((c) => c.org.id === org.id);
    const flat = (nodes) => nodes.flatMap((n) => [n.id, ...flat(n.direct_reports)]);
    expect(flat(chart.roots)).not.toContain(superMembership.id);
    expect(flat(chart.roots)).toContain(adminMembership.id);
    expect(chart.company_admin_id).toBe(adminMembership.id);
  });

  test('the company admin of the chart is the company\'s own Admin account, even when another admin leads a team', async () => {
    const { org, membership: teamLeadAdmin } = await seedOrgAdmin();
    await prisma.user.update({ where: { id: teamLeadAdmin.person_id }, data: { is_superadmin: false } });
    const owner = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: owner.id }, data: { is_superadmin: true } });
    const ownerMembership = await prisma.orgMembership.upsert({
      where: { person_id_org_id: { person_id: owner.id, org_id: org.id } },
      update: {},
      create: { person_id: owner.id, org_id: org.id, role: 'admin', employee_code: 'OWN1' },
    });
    await prisma.team.create({ data: { org_id: org.id, name: 'LeadMinds', lead_membership_id: teamLeadAdmin.id } });
    const groupSuper = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: groupSuper.id }, data: { is_group_superadmin: true } });
    const { access_token } = await loginAs(groupSuper);
    const res = await authed(request(app).get('/api/v1/org-chart/group'), access_token);
    expect(res.status).toBe(200);
    expect(res.body.data.find((c) => c.org.id === org.id).company_admin_id).toBe(ownerMembership.id);
  });
});

describe('Team view data', () => {
  test('the chart carries this org\'s teams (with lead) and each member\'s team and worker type', async () => {
    const { org, access_token, membership: adminMembership } = await seedOrgAdmin();
    const { membership: lead } = await seedEmployeeUnder(org, adminMembership.id);
    const { membership: member } = await seedEmployeeUnder(org, lead.id);
    const team = await prisma.team.create({ data: { org_id: org.id, name: 'Nexosoft', lead_membership_id: lead.id } });
    await prisma.orgMembership.updateMany({ where: { id: { in: [lead.id, member.id] } }, data: { team_id: team.id } });
    const other = await createOrg({ name: 'Other', slug: 'other' });
    await prisma.team.create({ data: { org_id: other.id, name: 'Elsewhere' } });

    const res = await authed(request(app).get('/api/v1/org-chart'), access_token);
    expect(res.body.data.teams).toEqual([expect.objectContaining({ id: team.id, name: 'Nexosoft', lead_membership_id: lead.id, manager_membership_id: null, open_positions: 0, sort_order: 0 })]);
    const leadNode = res.body.data.roots[0].direct_reports[0];
    expect(leadNode).toMatchObject({ team_id: team.id, worker_type: 'full_time_employee' });
    expect(leadNode.direct_reports[0]).toMatchObject({ id: member.id, team_id: team.id });
  });
});
