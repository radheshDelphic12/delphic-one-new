// Project timesheet: NO artificial hour cap (people log the hours they actually worked), the
// allocated person or a team mate can log, and everyone allocated to a project can see the team's
// logged hours (visibility only). Design: docs/features/CLIENT-PROJECT-TIMESHEET.md
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const DAY = '2026-07-01';

async function seed() {
  const org = await createOrg();
  const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const dev = async (name) => {
    const user = await createUser({ role: 'recruiter', name });
    await prisma.user.update({ where: { id: user.id }, data: { department_id: dept.id } });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter' });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  const project = (name) => prisma.account.create({ data: { org_id: org.id, type: 'client', name, stage: 'active', owner_id: adminUser.id, origin_owner_id: adminUser.id } });
  return { org, adminUser, adminToken, dev, project };
}

const assign = (ctx, account, person, extra = {}) =>
  prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: account.id, org_membership_id: person.membership.id, created_by: ctx.adminUser.id, ...extra } });
const log = (person, account, hours, extra = {}) => authed(request(app).post('/api/v1/timesheets/entries'), person.token).send({ date: DAY, account_id: account.id, hours, ...extra });
const dayOf = (person, account) => authed(request(app).get('/api/v1/timesheets/project-day'), person.token).query({ account_id: account.id, date: DAY });
const teamOf = (person, account) => authed(request(app).get('/api/v1/timesheets/project-team'), person.token).query({ account_id: account.id, year: 2026, month: 7 });

describe('Project timesheet - no hour cap', () => {
  test('people log their actual hours: more than the billable hours, and 8h on two projects the same day', async () => {
    const ctx = await seed();
    const a = await ctx.dev('Asha');
    const projectA = await ctx.project('Project A');
    const projectB = await ctx.project('Project B');
    await assign(ctx, projectA, a);
    await assign(ctx, projectB, a, { billable_hours_per_day: 4 });

    expect((await log(a, projectA, 8)).status).toBe(201);
    expect((await log(a, projectA, 2)).status).toBe(201); // already past the 8h allocation - no cap
    expect((await log(a, projectB, 8)).status).toBe(201); // past the 4h allocation
    // Only the 24h-a-day rule remains: 10 + 8 = 18, another 7 would pass 24.
    expect((await log(a, projectB, 7)).status).toBe(422);
  });

  test('an own edit upward is not capped either; the day view is informational (who logged what, no limit)', async () => {
    const ctx = await seed();
    const a = await ctx.dev('Asha');
    const b = await ctx.dev('Bilal');
    const p = await ctx.project('Miicare');
    await assign(ctx, p, a, { billable_hours_per_day: 6 });
    await assign(ctx, p, b);
    const first = (await log(a, p, 6)).body.data;
    expect((await authed(request(app).patch(`/api/v1/timesheets/entries/${first.id}`), a.token).send({ hours: 9 })).status).toBe(200);
    expect((await log(b, p, 8)).status).toBe(201);

    const seen = (await dayOf(b, p)).body.data;
    expect(seen).toMatchObject({ logged: 17, mine: 8 });
    expect(seen).not.toHaveProperty('capacity');
    expect(seen.people.find((x) => x.name === 'Asha')).toMatchObject({ logged: 9 });
  });

  test('a team mate of an allocated person may log, an outsider may not', async () => {
    const ctx = await seed();
    const a = await ctx.dev('Asha');
    const mate = await ctx.dev('Mohan');
    const outsider = await ctx.dev('Olga');
    const p = await ctx.project('Miicare');
    await assign(ctx, p, a);
    const team = await prisma.team.create({ data: { org_id: ctx.org.id, name: 'Web' } });
    for (const person of [a, mate]) {
      await prisma.teamMembershipPeriod.create({ data: { org_id: ctx.org.id, org_membership_id: person.membership.id, team_id: team.id } });
    }
    expect((await log(mate, p, 3)).status).toBe(201);
    const mine = (await authed(request(app).get('/api/v1/timesheets/my-projects'), mate.token)).body.data;
    expect(mine.find((x) => x.id === p.id)).toMatchObject({ via_team: true });
    expect((await log(outsider, p, 1)).status).toBe(403);
  });
});

describe('Project team timesheet visibility', () => {
  test('an assigned user sees members, who logged, per-person / date-wise / total hours; rejected hours are left out', async () => {
    const ctx = await seed();
    const a = await ctx.dev('Developer A');
    const b = await ctx.dev('Developer B');
    const c = await ctx.dev('Developer C');
    const p = await ctx.project('Miicare');
    for (const person of [a, b, c]) await assign(ctx, p, person);
    await log(a, p, 8);
    await authed(request(app).post('/api/v1/timesheets/entries'), a.token).send({ date: '2026-07-02', account_id: p.id, hours: 6 });
    await log(b, p, 5);
    const rejected = (await log(b, p, 2, { notes: 'x' })).body.data;
    await prisma.timesheetEntry.update({ where: { id: rejected.id }, data: { status: 'rejected' } });

    const res = await teamOf(c, p); // C has logged nothing but is assigned, so can look
    expect(res.status).toBe(200);
    const team = res.body.data;
    expect(team.members.map((m) => m.name).sort()).toEqual(['Developer A', 'Developer B', 'Developer C']);
    expect(team.members.find((m) => m.name === 'Developer A')).toMatchObject({ total_hours: 14, has_logged: true, assigned: true });
    expect(team.members.find((m) => m.name === 'Developer B')).toMatchObject({ total_hours: 5 });
    expect(team.members.find((m) => m.name === 'Developer C')).toMatchObject({ total_hours: 0, has_logged: false });
    expect(team.total_hours).toBe(19);
    expect(team.dates).toEqual([{ date: DAY, hours: 13 }, { date: '2026-07-02', hours: 6 }]);
  });

  test('a user who is not assigned to the project cannot see its team timesheet; an admin can', async () => {
    const ctx = await seed();
    const a = await ctx.dev('Asha');
    const outsider = await ctx.dev('Olga');
    const p = await ctx.project('Miicare');
    await assign(ctx, p, a);
    await log(a, p, 4);
    expect((await teamOf(outsider, p)).status).toBe(403);
    const admin = await authed(request(app).get('/api/v1/timesheets/project-team'), ctx.adminToken).query({ account_id: p.id, year: 2026, month: 7 });
    expect(admin.status).toBe(200);
    expect(admin.body.data.total_hours).toBe(4);
  });
});
