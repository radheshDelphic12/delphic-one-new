// People → Capacity & Allocation: effective-dated Resource → Team → Project
// allocations. Current assignment can change; historical assignment never
// gets rewritten, and a change reaching a locked month is flagged, not applied.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const AUG = { period_month: 8, period_year: 2026 }; // 21 weekdays, fully in the past
const DAY = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);
const today = () => {
  const ist = new Date(Date.now() + 330 * 60000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
};
const inDays = (n) => ymd(new Date(today().getTime() + n * DAY));

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const it = await prisma.department.create({ data: { name: 'IT', org_id: org.id } });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const client = await prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: adminUser.id, org_id: org.id, industry: 'IT' } });
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Default', is_default: true } });
  return { org, it, adminUser, adminToken, client };
}

async function person(ctx, name) {
  const user = await createUser({ role: 'employee', name });
  await prisma.user.update({ where: { id: user.id }, data: { department_id: ctx.it.id } });
  const membership = await createOrgMembership(user.id, ctx.org.id, { role: 'employee', department_id: ctx.it.id, joined_at: new Date('2026-01-01') });
  await prisma.salaryStructure.create({ data: { org_id: ctx.org.id, org_membership_id: membership.id, effective_from: new Date('2026-01-01'), ctc: 42000, components: { basic: 42000 }, created_by: ctx.adminUser.id } });
  return { user, membership, token: (await loginAs(user)).access_token };
}

async function project(ctx, name, { end } = {}) {
  const res = await authed(request(app).post('/api/v1/calendars/projects'), ctx.adminToken).send({ name, service_category: 'managed_services', client_account_id: ctx.client.id });
  expect(res.status).toBe(201);
  await authed(request(app).patch(`/api/v1/billing/projects/${res.body.data.id}`), ctx.adminToken).send({
    agreement_start_date: '2026-01-01',
    ...(end ? { agreement_end_date: end } : {}),
    billing: { rate_type: 'monthly', rate: 210000, currency: 'INR' },
  });
  return res.body.data;
}

const api = (ctx) => ({
  assign: (body) => authed(request(app).post('/api/v1/billing/cost-assignments'), ctx.adminToken).send(body),
  move: (body) => authed(request(app).post('/api/v1/allocations/move'), ctx.adminToken).send(body),
  end: (id, body) => authed(request(app).post(`/api/v1/allocations/${id}/end`), ctx.adminToken).send(body),
  report: (name, query) => authed(request(app).get(`/api/v1/allocations/reports/${name}`), ctx.adminToken).query(query),
  teamChange: (body) => authed(request(app).post('/api/v1/allocations/team-change'), ctx.adminToken).send(body),
});

describe('Effective-dated project allocation — history is never rewritten', () => {
  test('Harshit moves Project A → B on 16 Aug: 10 Aug is still A, 20 Aug is B; timesheets follow the date', async () => {
    const ctx = await seed();
    const a = await project(ctx, 'Project A');
    const b = await project(ctx, 'Project B');
    const harshit = await person(ctx, 'Harshit');
    const { assign, move, report } = api(ctx);

    expect((await assign({ account_id: a.id, org_membership_id: harshit.membership.id, start_date: '2026-08-01' })).status).toBe(201);
    const moved = await move({ org_membership_id: harshit.membership.id, from_account_id: a.id, to_account_id: b.id, effective_date: '2026-08-16' });
    expect(moved.status).toBe(200);

    const on = async (date) => (await report('resources', { from: date, to: date })).body.data.rows.map((r) => r.project.name);
    expect(await on('2026-08-10')).toEqual(['Project A']);
    expect(await on('2026-08-20')).toEqual(['Project B']);

    const spans = await prisma.projectMemberAssignment.findMany({ where: { org_membership_id: harshit.membership.id }, orderBy: { start_date: 'asc' } });
    expect(spans.map((s) => [s.account_id, ymd(s.start_date), s.end_date ? ymd(s.end_date) : null])).toEqual([
      [a.id, '2026-08-01', '2026-08-15'],
      [b.id, '2026-08-16', null],
    ]);

    // He can log A only on A's days, B only on B's days.
    const log = (body) => authed(request(app).post('/api/v1/timesheets/entries'), harshit.token).send({ hours: 8, ...body });
    expect((await log({ date: '2026-08-10', account_id: a.id })).status).toBe(201);
    expect((await log({ date: '2026-08-20', account_id: a.id })).status).toBe(403);
    expect((await log({ date: '2026-08-20', account_id: b.id })).status).toBe(201);
    expect((await log({ date: '2026-08-11', account_id: b.id })).status).toBe(403);

    // Movement history shows the change.
    const moves = (await report('movements', { from: '2026-08-01', to: '2026-08-31' })).body.data.rows;
    expect(moves.map((m) => [m.effective_date, m.change_type])).toEqual([['2026-08-16', 'project'], ['2026-08-01', 'joined_project']]);
    expect(moves[0]).toEqual(expect.objectContaining({ effective_date: '2026-08-16', change_type: 'project', previous_projects: [expect.objectContaining({ name: 'Project A' })], new_projects: [expect.objectContaining({ name: 'Project B' })] }));
  });

  test('ending an allocation keeps its history; only an allocation entered by mistake is deleted', async () => {
    const ctx = await seed();
    const a = await project(ctx, 'Project A');
    const p = await person(ctx, 'Ravi');
    const { assign, end, report } = api(ctx);
    const created = (await assign({ account_id: a.id, org_membership_id: p.membership.id, start_date: '2026-08-01' })).body.data;
    const ended = await end(created.id, { end_date: '2026-08-20' });
    expect(ended.body.data).toMatchObject({ end_date: '2026-08-20', status: 'ended' });
    expect((await end(created.id, { end_date: '2026-07-01' })).status).toBe(422);
    expect((await report('resources', { from: '2026-08-10', to: '2026-08-10' })).body.data.rows).toHaveLength(1);
    // Overlapping a span of the same person on the same project is refused.
    expect((await assign({ account_id: a.id, org_membership_id: p.membership.id, start_date: '2026-08-15', end_date: '2026-08-25' })).status).toBe(409);
    // Coming back later is a new span.
    expect((await assign({ account_id: a.id, org_membership_id: p.membership.id, start_date: '2026-09-01' })).status).toBe(201);
    expect(await prisma.projectMemberAssignment.count({ where: { org_membership_id: p.membership.id } })).toBe(2);
  });
});

describe('Resource Revenue splits a month by the allocation in force each day', () => {
  test('Ankita on A 1–16 Aug, B from 17 Aug: cost shares are 10/21 and 11/21 of August', async () => {
    const ctx = await seed();
    const a = await project(ctx, 'Project A');
    const b = await project(ctx, 'Project B');
    const ankita = await person(ctx, 'Ankita');
    const { assign, move } = api(ctx);
    await assign({ account_id: a.id, org_membership_id: ankita.membership.id, start_date: '2026-08-01' });
    await move({ org_membership_id: ankita.membership.id, to_account_id: b.id, effective_date: '2026-08-17' });

    const res = await authed(request(app).get('/api/v1/analytics/resource-revenue'), ctx.adminToken).query(AUG);
    expect(res.status).toBe(200);
    const lines = res.body.data.lines.filter((l) => l.org_membership_id === ankita.membership.id);
    const share = (id) => lines.find((l) => l.project.id === id)?.allocation_percent;
    expect(share(a.id)).toBeCloseTo((10 / 21) * 100, 1);
    expect(share(b.id)).toBeCloseTo((11 / 21) * 100, 1);
    const cost = (id) => lines.find((l) => l.project.id === id).cost;
    expect(cost(a.id) + cost(b.id)).toBeCloseTo(lines.reduce((s, l) => s + l.cost, 0), 2);
  });

  test('a locked month is not rewritten by a later allocation change — it is flagged for review', async () => {
    const ctx = await seed();
    const a = await project(ctx, 'Project A');
    const b = await project(ctx, 'Project B');
    const ankita = await person(ctx, 'Ankita');
    const { assign, move } = api(ctx);
    await assign({ account_id: a.id, org_membership_id: ankita.membership.id, start_date: '2026-08-01' });

    const lock = await authed(request(app).post('/api/v1/calculations/lock'), ctx.adminToken).send({ kind: 'resource_revenue', ...AUG, reason: 'August done' });
    expect(lock.status).toBe(200);
    const before = await authed(request(app).get('/api/v1/analytics/resource-revenue'), ctx.adminToken).query(AUG);
    const lockedShareA = before.body.data.lines.find((l) => l.project.id === a.id).allocation_percent;
    expect(lockedShareA).toBe(100);

    // Retroactive move into the locked month.
    await move({ org_membership_id: ankita.membership.id, to_account_id: b.id, effective_date: '2026-08-17' });

    const calc = await prisma.financialCalculation.findFirst({ where: { org_id: ctx.org.id, kind: 'resource_revenue', ...AUG } });
    expect(calc.status).toBe('change_detected');
    const changes = await prisma.financialCalculationChange.findMany({ where: { calculation_id: calc.id } });
    expect(changes.some((c) => c.source_type === 'allocation')).toBe(true);
    const after = await authed(request(app).get('/api/v1/analytics/resource-revenue'), ctx.adminToken).query(AUG);
    expect(after.body.data.source).toBe('locked');
    expect(after.body.data.lines.find((l) => l.project.id === a.id).allocation_percent).toBe(100);
    expect(after.body.data.lines.some((l) => l.project.id === b.id)).toBe(false);
  });
});

describe('Team capacity', () => {
  test('same-team members on one project count once; capacity = members × projects per resource; never below zero', async () => {
    const ctx = await seed();
    const { assign, report, teamChange } = api(ctx);
    const team = (await authed(request(app).post('/api/v1/teams'), ctx.adminToken).send({ name: 'Data Smith' })).body.data;
    const people = [];
    for (const name of ['Harshit', 'Ankita', 'Nikhil', 'Ravi']) {
      const p = await person(ctx, name);
      expect((await teamChange({ org_membership_id: p.membership.id, team_id: team.id, effective_date: '2026-08-01' })).status).toBe(200);
      people.push(p);
    }
    await authed(request(app).patch(`/api/v1/teams/${team.id}`), ctx.adminToken).send({ lead_membership_id: people[0].membership.id });
    const a = await project(ctx, 'Project A', { end: inDays(10) });
    const b = await project(ctx, 'Project B', { end: inDays(60) });
    await assign({ account_id: a.id, org_membership_id: people[0].membership.id }); // Harshit → A
    await assign({ account_id: a.id, org_membership_id: people[1].membership.id }); // Ankita → A
    await assign({ account_id: b.id, org_membership_id: people[2].membership.id }); // Nikhil → B
    await assign({ account_id: b.id, org_membership_id: people[3].membership.id }); // Ravi → B

    const row = async (query = {}) => (await report('team-capacity', query)).body.data.teams.find((t) => t.team?.id === team.id);
    expect(await row()).toMatchObject({
      lead: { name: 'Harshit' },
      members: 4,
      capacity_per_resource: 1.5,
      total_capacity: 6,
      current_allocation: 2,
      available_capability: 4,
      projects_ending_soon: 1,
      can_allocate: 5,
      status: 'available',
    });

    // Capability is a whole number, rounded up: capacity 4.52 - allocation 2 = 2.52 shows as 3; can allocate follows it.
    await authed(request(app).put('/api/v1/allocations/settings'), ctx.adminToken).send({ projects_per_resource: 1.13 });
    expect(await row()).toMatchObject({ total_capacity: 4.52, current_allocation: 2, available_capability: 3, projects_ending_soon: 1, can_allocate: 4 });

    // Configurable: 0.25 projects/resource → capacity 1, allocation 2 → available 0, over capacity.
    await authed(request(app).put('/api/v1/allocations/settings'), ctx.adminToken).send({ projects_per_resource: 0.25 });
    expect(await row()).toMatchObject({ total_capacity: 1, current_allocation: 2, available_capability: 0, over_capacity_by: 1, status: 'over_capacity' });
    // A team override beats the org default.
    await authed(request(app).patch(`/api/v1/teams/${team.id}`), ctx.adminToken).send({ projects_per_resource: 2 });
    expect(await row()).toMatchObject({ capacity_per_resource: 2, total_capacity: 8, uses_org_default: false });

    // Ending soon: A (ends in 10 days) is inside the 30-day window, B (60) is not.
    const soon = (await report('ending-soon', {})).body.data.projects;
    expect(soon.map((p) => p.project.name)).toEqual(['Project A']);
    expect(soon[0]).toMatchObject({ days_remaining: 10, resource_count: 2, teams: [{ id: team.id, name: 'Data Smith' }] });
  });

  test('team capacity is date-aware: a member who moves team on 17 Aug counts for the old team before it', async () => {
    const ctx = await seed();
    const { report, teamChange } = api(ctx);
    const smith = (await authed(request(app).post('/api/v1/teams'), ctx.adminToken).send({ name: 'Data Smith' })).body.data;
    const growth = (await authed(request(app).post('/api/v1/teams'), ctx.adminToken).send({ name: 'Growth' })).body.data;
    const members = [];
    for (const name of ['A1', 'A2', 'A3', 'A4']) {
      const p = await person(ctx, name);
      await teamChange({ org_membership_id: p.membership.id, team_id: smith.id, effective_date: '2026-08-01' });
      members.push(p);
    }
    expect((await teamChange({ org_membership_id: members[3].membership.id, team_id: growth.id, effective_date: '2026-08-17' })).status).toBe(200);
    // Future-dated team moves are refused (the current team must be today's).
    expect((await teamChange({ org_membership_id: members[0].membership.id, team_id: growth.id, effective_date: inDays(5) })).status).toBe(422);

    const capOn = async (date, id) => (await report('team-capacity', { date })).body.data.teams.find((t) => t.team?.id === id);
    expect(await capOn('2026-08-10', smith.id)).toMatchObject({ members: 4, total_capacity: 6 });
    // Nothing allocated: capability 4.5 shows as 5 and 1.5 as 2 (whole projects, rounded up).
    expect(await capOn('2026-08-20', smith.id)).toMatchObject({ members: 3, total_capacity: 4.5, available_capability: 5 });
    expect(await capOn('2026-08-20', growth.id)).toMatchObject({ members: 1, total_capacity: 1.5, available_capability: 2 });

    const moves = (await report('movements', { from: '2026-08-15', to: '2026-08-31' })).body.data.rows;
    expect(moves).toEqual([expect.objectContaining({ effective_date: '2026-08-17', change_type: 'team', from_team: { id: smith.id, name: 'Data Smith' }, to_team: { id: growth.id, name: 'Growth' } })]);

    // The August salary team filter is historical: A4 is in both teams' August, only Growth's September.
    const salaryTeam = async (query) => (await authed(request(app).get('/api/v1/analytics/salary-attendance'), ctx.adminToken).query(query)).body.data.lines.map((l) => l.name).sort();
    expect(await salaryTeam({ ...AUG, team_id: smith.id })).toEqual(['A1', 'A2', 'A3', 'A4']);
    expect(await salaryTeam({ period_month: 7, period_year: 2026, team_id: growth.id })).toEqual([]);
  });
});
