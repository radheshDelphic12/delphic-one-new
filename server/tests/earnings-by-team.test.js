/**
 * Live Analytics > Earnings by team: a project's earnings are split across the people allocated to it (by allocation share), each part goes to the
 * person's team, and the rows add up to the company's earnings (projects with nobody allocated fall on "Not tied to a team").
 */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

const api = (path) => `/api/v1${path}`;
const SEP = { period_month: 9, period_year: 2026 };

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Calendar', is_default: true } });
  const client = await prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: adminUser.id, org_id: org.id, industry: 'IT' } });
  return { org, adminUser, adminToken, client };
}

async function fixedProject(ctx, name, total) {
  const res = await authed(request(app).post(api('/calendars/projects')), ctx.adminToken).send({ name, service_category: 'project', client_account_id: ctx.client.id });
  expect(res.status).toBe(201);
  const patch = await authed(request(app).patch(api(`/billing/projects/${res.body.data.id}`)), ctx.adminToken).send({ agreement_start_date: '2026-01-01', billing: { rate_type: 'one_time', rate: total, currency: 'INR' } });
  expect(patch.status).toBe(200);
  return patch.body.data;
}

async function billAndLock(ctx, project, amount, number) {
  expect((await authed(request(app).post(api('/billing/invoices')), ctx.adminToken).send({ client_account_id: project.id, ...SEP, amount, invoice_number: number })).status).toBe(201);
  expect((await authed(request(app).post(api('/calculations/lock')), ctx.adminToken).send({ kind: 'billing', scope_key: project.id, ...SEP })).status).toBe(200);
}

async function person(ctx, name, team, project, percent) {
  const user = await createUser({ role: 'recruiter', withOrg: false, name });
  const membership = await createOrgMembership(user.id, ctx.org.id, { role: 'recruiter' });
  if (team) await prisma.orgMembership.update({ where: { id: membership.id }, data: { team_id: team.id } });
  if (project) await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: project.id, org_membership_id: membership.id, created_by: ctx.adminUser.id, allocation_percent: percent, start_date: new Date('2026-01-01T00:00:00Z') } });
  return membership;
}

describe('earnings by team', () => {
  test('a project is split by allocation share across teams, an unstaffed project and non-project earnings stay on their own row, the rows add up', async () => {
    const ctx = await seed();
    const alpha = await prisma.team.create({ data: { org_id: ctx.org.id, name: 'Alpha' } });
    const beta = await prisma.team.create({ data: { org_id: ctx.org.id, name: 'Beta' } });
    const staffed = await fixedProject(ctx, 'Staffed', 500000);
    const unstaffed = await fixedProject(ctx, 'Unstaffed', 500000);
    await billAndLock(ctx, staffed, 100000, 'T-001');
    await billAndLock(ctx, unstaffed, 40000, 'T-002');
    await person(ctx, 'Asha Alpha', alpha, staffed, 75);
    await person(ctx, 'Bela Beta', beta, staffed, 25);

    const res = await authed(request(app).get(api('/analytics/earnings-by-team')), ctx.adminToken).query({ from: '2026-09', to: '2026-09' });
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.teams.map((t) => [t.name, t]));
    expect(byName.Alpha.revenue).toBe(75000);
    expect(byName.Beta.revenue).toBe(25000);
    expect(byName['Not tied to a team'].revenue).toBe(40000);
    expect(byName.Alpha.people.map((p) => [p.name, p.revenue])).toEqual([['Asha Alpha', 75000]]);
    expect(byName.Alpha.share_percent + byName.Beta.share_percent + byName['Not tied to a team'].share_percent).toBeCloseTo(100, 0);
    // the rows add up to the company's earnings in the Earnings & profit table
    const total = await authed(request(app).get(api('/analytics/earnings-profit')), ctx.adminToken).query({ from: '2026-09', to: '2026-09' });
    expect(res.body.data.totals.revenue).toBe(total.body.data.totals.revenue);
    expect(res.body.data.totals.revenue).toBe(140000);
  });
});
