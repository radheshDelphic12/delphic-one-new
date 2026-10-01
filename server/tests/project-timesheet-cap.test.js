// Client / project timesheet (phase 1): a project's day has a capacity (the sum of its allocated
// people's billable_hours_per_day), everyone sees what is already logged, the cap is enforced,
// the person allocated or a team mate can log, admin edits bypass the cap. Design:
// docs/features/CLIENT-PROJECT-TIMESHEET.md
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

describe('Client / project timesheet - the project day', () => {
  test('capacity is the allocated people\'s billable hours; each person sees what is already logged; a full day refuses more', async () => {
    const ctx = await seed();
    const a = await ctx.dev('Asha');
    const b = await ctx.dev('Bilal');
    const p = await ctx.project('Miicare');
    await assign(ctx, p, a); // default 8h
    await assign(ctx, p, b, { billable_hours_per_day: 4 });

    expect((await dayOf(a, p)).body.data).toMatchObject({ capped: true, capacity: 12, logged: 0, remaining: 12, mine: 0 });
    expect((await log(a, p, 8)).status).toBe(201);
    // Bilal sees Asha's hours before he logs his own.
    const seen = (await dayOf(b, p)).body.data;
    expect(seen).toMatchObject({ capacity: 12, logged: 8, remaining: 4, mine: 0 });
    expect(seen.people.find((x) => x.name === 'Asha')).toMatchObject({ billable_hours_per_day: 8, logged: 8 });
    expect((await log(b, p, 4)).status).toBe(201);

    // The project's day is now full: nobody can add more.
    const over = await log(a, p, 1);
    expect(over.status).toBe(422);
    expect(over.body.message || over.body.error?.message || JSON.stringify(over.body)).toMatch(/12h of 12h already logged/);
    expect((await dayOf(a, p)).body.data).toMatchObject({ logged: 12, remaining: 0, over_by: 0 });
  });

  test('one person can bill 8h on project A and 8h on project B on the same day - the caps are per project, not per person', async () => {
    const ctx = await seed();
    const a = await ctx.dev('Asha');
    const projectA = await ctx.project('Project A');
    const projectB = await ctx.project('Project B');
    await assign(ctx, projectA, a);
    await assign(ctx, projectB, a);
    expect((await log(a, projectA, 8)).status).toBe(201);
    expect((await log(a, projectB, 8)).status).toBe(201);
    expect((await dayOf(a, projectA)).body.data).toMatchObject({ capacity: 8, logged: 8 });
    expect((await dayOf(a, projectB)).body.data).toMatchObject({ capacity: 8, logged: 8 });
  });

  test('rejected hours free the capacity; an own edit is checked against the cap; overtime does not use the day', async () => {
    const ctx = await seed();
    const a = await ctx.dev('Asha');
    const p = await ctx.project('Miicare');
    await assign(ctx, p, a, { billable_hours_per_day: 6 });
    const first = (await log(a, p, 6)).body.data;
    expect((await log(a, p, 1)).status).toBe(422);

    // Editing the same entry up is refused (6 -> 7 on a 6h project), down is fine.
    expect((await authed(request(app).patch(`/api/v1/timesheets/entries/${first.id}`), a.token).send({ hours: 7 })).status).toBe(422);
    expect((await authed(request(app).patch(`/api/v1/timesheets/entries/${first.id}`), a.token).send({ hours: 5 })).status).toBe(200);

    // A rejected entry no longer counts.
    await prisma.timesheetEntry.update({ where: { id: first.id }, data: { status: 'rejected' } });
    expect((await dayOf(a, p)).body.data).toMatchObject({ logged: 0, remaining: 6 });
    expect((await log(a, p, 6)).status).toBe(201);

    // Overtime hours are ticket based and separate: they never use the day's capacity.
    expect((await dayOf(a, p)).body.data.logged).toBe(6);
  });

  test('a project with nobody allocated has no cap; admin entries bypass the cap', async () => {
    const ctx = await seed();
    const a = await ctx.dev('Asha');
    const p = await ctx.project('Miicare');
    await assign(ctx, p, a, { billable_hours_per_day: 4 });
    expect((await log(a, p, 4)).status).toBe(201);

    const admin = await authed(request(app).post('/api/v1/timesheets/entries/admin'), ctx.adminToken).send({ org_membership_id: a.membership.id, date: DAY, account_id: p.id, hours: 3, reason: 'Client approved extra support' });
    expect(admin.status).toBe(201);
    expect((await dayOf(a, p)).body.data).toMatchObject({ capacity: 4, logged: 7, remaining: 0, over_by: 3 });

    const loose = await ctx.project('Unstaffed');
    expect((await authed(request(app).get('/api/v1/timesheets/project-day'), ctx.adminToken).query({ account_id: loose.id, date: DAY })).body.data).toMatchObject({ capped: false, capacity: 0, remaining: null });
  });

  test('billable hours per day are set on the allocation by an admin and raise the cap; a team mate of an allocated person may log, an outsider may not', async () => {
    const ctx = await seed();
    const a = await ctx.dev('Asha');
    const mate = await ctx.dev('Mohan');
    const outsider = await ctx.dev('Olga');
    const p = await ctx.project('Miicare');
    await assign(ctx, p, a);

    // The team: Asha and Mohan; Olga is elsewhere.
    const team = await prisma.team.create({ data: { org_id: ctx.org.id, name: 'Web' } });
    for (const person of [a, mate]) {
      await prisma.teamMembershipPeriod.create({ data: { org_id: ctx.org.id, org_membership_id: person.membership.id, team_id: team.id } });
    }

    // Not allocated, but on the same team as someone who is: can log, sees the project in the picker.
    expect((await log(mate, p, 3)).status).toBe(201);
    const mine = (await authed(request(app).get('/api/v1/timesheets/my-projects'), mate.token)).body.data;
    expect(mine.find((x) => x.id === p.id)).toMatchObject({ via_team: true });
    expect((await log(outsider, p, 1)).status).toBe(403);

    // Asha 5 + Mohan 3 = 8 of 8; the admin raises Asha's billable hours to 10 -> capacity 10.
    expect((await log(a, p, 5)).status).toBe(201);
    expect((await log(a, p, 1)).status).toBe(422);
    const raise = await authed(request(app).post('/api/v1/billing/cost-assignments'), ctx.adminToken).send({ account_id: p.id, org_membership_id: a.membership.id, billable_hours_per_day: 10 });
    expect([200, 201]).toContain(raise.status);
    expect(raise.body.data.billable_hours_per_day).toBe(10);
    expect((await dayOf(a, p)).body.data).toMatchObject({ capacity: 10, logged: 8, remaining: 2 });
    expect((await log(a, p, 2)).status).toBe(201);
  });
});
