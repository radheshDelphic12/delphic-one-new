// Admin backfill of timesheets (one entry, or a CSV sheet) and overtime =
// logged hours beyond the day's shift in the IT timesheet views.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const service = require('../src/modules/timesheets/timesheets.service');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const it = await prisma.department.create({ data: { name: 'IT', org_id: org.id } });
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const token = (await loginAs(admin)).access_token;
  const dev = await createUser({ role: 'employee' });
  await prisma.user.update({ where: { id: dev.id }, data: { department_id: it.id } });
  const devMembership = await createOrgMembership(dev.id, org.id, { role: 'employee', employee_code: 'EMP7' });
  await prisma.orgMembership.update({ where: { id: devMembership.id }, data: { joined_at: new Date('2026-01-01') } });
  const project = await prisma.account.create({ data: { org_id: org.id, name: 'Acme', type: 'client', stage: 'active', project_code: 'P0042', owner_id: admin.id } });
  return { org, admin, token, devMembership, project };
}

const importUrl = '/api/v1/timesheets/entries/admin/import';

describe('Admin timesheet backfill', () => {
  test('a CSV sheet is checked first, refused whole when a row is wrong, then applied as approved entries', async () => {
    const ctx = await seed();
    const good = [
      { employee: 'EMP7', date: '2026-09-01', project: 'P0042', hours: '8', overtime_hours: '', billable: '', notes: 'API work' },
      { employee: 'emp7', date: '2026-09-02', project: 'acme', hours: '6', overtime_hours: '1', billable: 'no', notes: '' },
      { employee: '', date: '', project: '', hours: '', overtime_hours: '', billable: '', notes: '' },
    ];
    const bad = [...good, { employee: 'nobody@x.com', date: '2026-09-03', project: '', hours: '8' }, { employee: 'EMP7', date: '2099-01-01', project: '', hours: '8' }];

    const refused = await authed(request(app).post(importUrl), ctx.token).send({ rows: bad, reason: 'Paper timesheets' });
    expect(refused.status).toBe(200);
    expect(refused.body.data.applied).toBe(false);
    expect(refused.body.data.errors.map((e) => e.row)).toEqual([5, 6]);
    expect(await prisma.timesheetEntry.count()).toBe(0);

    const dry = await authed(request(app).post(importUrl), ctx.token).send({ rows: good, reason: 'Paper timesheets', dry_run: true });
    expect(dry.body.data).toMatchObject({ created: 2, skipped: 1, applied: false, errors: [] });
    expect(await prisma.timesheetEntry.count()).toBe(0);

    const applied = await authed(request(app).post(importUrl), ctx.token).send({ rows: good, reason: 'Paper timesheets' });
    expect(applied.body.data).toMatchObject({ created: 2, applied: true });
    const entries = await prisma.timesheetEntry.findMany({ orderBy: { date: 'asc' } });
    expect(entries.map((e) => [Number(e.hours), Number(e.overtime_hours), e.billable, e.status, e.account_id])).toEqual([
      [8, 0, true, 'approved', ctx.project.id],
      [6, 1, false, 'approved', ctx.project.id],
    ]);

    const emp = await createUser({ role: 'employee' });
    await createOrgMembership(emp.id, ctx.org.id, { role: 'employee' });
    expect((await authed(request(app).post(importUrl), (await loginAs(emp)).access_token).send({ rows: good, reason: 'Paper timesheets' })).status).toBe(403);
  });
});

describe('IT timesheet overtime = hours beyond the shift', () => {
  test('11h logged on a working day shows 2h OT even with nothing in the OT field; weekend hours are all OT', async () => {
    const ctx = await seed();
    for (const [date, hours] of [['2026-09-01', 11], ['2026-09-02', 9], ['2026-09-05', 4]]) {
      await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: ctx.devMembership.id, account_id: ctx.project.id, date: new Date(date), hours, status: 'approved' } });
    }
    const days = await service.monthlyGrouped(ctx.org.id, ctx.devMembership.id, 2026, 9);
    expect(days.map((d) => [d.date, d.total_hours, d.ot_hours])).toEqual([
      ['2026-09-01', 11, 2],
      ['2026-09-02', 9, 0],
      ['2026-09-05', 4, 4], // Saturday
    ]);

    const overview = await service.teamOverview(ctx.org.id, { month: 9, year: 2026 });
    expect(overview.summary.overtime_hours).toBe(6);
    expect(overview.members.find((m) => m.org_membership_id === ctx.devMembership.id)).toMatchObject({ month_hours: 24, overtime_hours: 6 });
  });
});

describe('Approval inbox: many at once, and filtered totals', () => {
  test('bulk reject needs one reason and rejects each item; bulk approve approves; the entries list reports hours for the whole filter', async () => {
    const ctx = await seed();
    const mk = (date, hours) => prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: ctx.devMembership.id, account_id: ctx.project.id, date: new Date(date), hours, overtime_hours: 1, status: 'submitted' } });
    const [a, b, c] = [await mk('2026-09-01', 8), await mk('2026-09-02', 7), await mk('2026-09-03', 6)];
    const bulk = (body) => authed(request(app).post('/api/v1/timesheets/approvals/bulk'), ctx.token).send(body);

    expect((await bulk({ status: 'rejected', entries: [a.id, b.id] })).status).toBe(422);
    const rejected = await bulk({ status: 'rejected', reason: 'Wrong project', entries: [a.id, b.id] });
    expect(rejected.body.data).toMatchObject({ status: 'rejected', approved: 2, failed: [] });
    expect((await bulk({ entries: [c.id, a.id] })).body.data).toMatchObject({ approved: 1, failed: [{ id: a.id }] });
    const rows = await prisma.timesheetEntry.findMany({ orderBy: { date: 'asc' }, select: { status: true, decision_reason: true } });
    expect(rows.map((r) => r.status)).toEqual(['rejected', 'rejected', 'approved']);
    expect(rows[0].decision_reason).toBe('Wrong project');

    const list = await authed(request(app).get('/api/v1/timesheets/entries').query({ org_membership_id: ctx.devMembership.id, account_id: ctx.project.id, from: '2026-09-01', to: '2026-09-02', limit: 1 }), ctx.token);
    expect(list.body.pagination.total).toBe(2);
    expect(list.body.totals).toEqual({ hours: 15, overtime_hours: 2 });
  });
});

describe('time for an employee who has left', () => {
  test('an admin can still enter hours for the days before their last working day: one by one, by CSV, and in the employee lists', async () => {
    const ctx = await seed();
    const mali = await createUser({ role: 'employee', name: 'Mali Exited' });
    const m = await createOrgMembership(mali.id, ctx.org.id, { role: 'employee', employee_code: 'EMP9' });
    // last working day 20 Oct; the nightly job has already marked them Exited
    await prisma.orgMembership.update({ where: { id: m.id }, data: { joined_at: new Date('2026-01-01'), employment_status: 'terminated', left_at: new Date('2026-10-20') } });

    // the pick-lists can include exited people (and mark them), the default list still hides them
    const named = async (q) => (await authed(request(app).get(`/api/v1/orgs/memberships${q}`), ctx.token)).body.data.map((r) => r.person?.name);
    expect(await named('')).not.toContain('Mali Exited');
    expect(await named('?include_terminated=true')).toContain('Mali Exited');

    // one entry
    const one = await authed(request(app).post('/api/v1/timesheets/entries/admin'), ctx.token).send({ org_membership_id: m.id, date: '2026-10-05', hours: 8, account_id: ctx.project.id, reason: 'Entered after exit' });
    expect(one.status).toBe(201);
    // a sheet for the rest of the month, by employee code
    const rows = ['2026-10-06', '2026-10-07', '2026-10-20'].map((date) => ({ employee: 'EMP9', date, project: 'P0042', hours: '8', overtime_hours: '', billable: '', notes: '' }));
    const sheet = await authed(request(app).post(importUrl), ctx.token).send({ rows, reason: 'Entered after exit' });
    expect(sheet.body.data).toMatchObject({ created: 3, applied: true, errors: [] });
    expect(await prisma.timesheetEntry.count({ where: { org_membership_id: m.id } })).toBe(4);

    // they stay in the monitoring overview for the month they worked, but not for a later month
    const overview = async (month) => (await authed(request(app).get(`/api/v1/timesheets/overview?month=${month}&year=2026`), ctx.token)).body.data.members.map((x) => x.name);
    expect(await overview(10)).toContain('Mali Exited');
    expect(await overview(11)).not.toContain('Mali Exited');
  });
});
