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
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const token = (await loginAs(admin)).access_token;
  const dev = await createUser({ role: 'employee' });
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
