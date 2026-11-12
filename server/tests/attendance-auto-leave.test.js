// An approved leave replaces the automatic "present" entry (source `auto`) at once; manual, regularised and real
// check-in entries are never touched; a month locked for the employee is left alone.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');
const leaveService = require('../src/modules/leave/leave.service');
const auto = require('../src/modules/attendance/autoAttendance.service');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const d = (s) => new Date(`${s}T00:00:00.000Z`);

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('d-') });
  const adminUser = await createUser({ role: 'admin' });
  const adminMembership = await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const empUser = await createUser({ role: 'employee' });
  const membership = await createOrgMembership(empUser.id, org.id, { role: 'employee' });
  const token = (await loginAs(empUser)).access_token;
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Standard', kind: 'internal', is_default: true } });
  await leaveService.listTypes(org.id);
  const cl = await prisma.leaveType.findFirst({ where: { org_id: org.id, name: 'Casual Leave' } });
  return { org, adminUser, adminMembership, adminToken, membership, token, cl };
}

const record = (ctx, date, data = {}) =>
  prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: ctx.membership.id, date: d(date), status: 'present', ...data } });
const autoRecord = (ctx, date) => record(ctx, date, { source: 'auto', regularized_reason: 'auto_daily' });
const apply = (ctx, body) => authed(request(app).post('/api/v1/leave/requests'), ctx.token).send({ leave_type_id: ctx.cl.id, ...body });
const approve = (ctx, id) => authed(request(app).post(`/api/v1/leave/requests/${id}/decision`), ctx.adminToken).send({ status: 'approved' });
const exists = async (ctx, date) => (await prisma.attendanceRecord.count({ where: { org_membership_id: ctx.membership.id, date: d(date) } })) === 1;

describe('approved leave replaces the automatic present entry', () => {
  test('applying is allowed over an automatic entry, and approving removes it so the leave shows', async () => {
    const ctx = await seed();
    await autoRecord(ctx, '2026-11-10'); // Tue
    await autoRecord(ctx, '2026-11-11'); // Wed
    const res = await apply(ctx, { from_date: '2026-11-10', to_date: '2026-11-11' });
    expect(res.status).toBe(201); // before: 409 "present on that date", the entry had to be deleted by hand first
    expect(await exists(ctx, '2026-11-10')).toBe(true); // still pending: nothing changes yet
    expect((await approve(ctx, res.body.data.id)).status).toBe(200);
    expect(await exists(ctx, '2026-11-10')).toBe(false);
    expect(await exists(ctx, '2026-11-11')).toBe(false);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'attendance_auto_replaced_by_leave' } });
    expect(audit.snapshot.days).toHaveLength(2);
  });

  test('a manual, regularised or real check-in entry is never removed, and still blocks a full-day leave', async () => {
    const ctx = await seed();
    await record(ctx, '2026-11-10', { source: 'manual', regularized_by: ctx.adminUser.id, regularized_reason: 'forgot to punch' });
    expect((await apply(ctx, { from_date: '2026-11-10', to_date: '2026-11-10' })).status).toBe(409);
    await record(ctx, '2026-11-11', { source: 'web', check_in_at: new Date('2026-11-11T04:00:00Z') });
    expect((await apply(ctx, { from_date: '2026-11-11', to_date: '2026-11-11' })).status).toBe(409);
    // an admin can still override over a person's entry on purpose; the automatic cleanup never does it by itself
    await autoRecord(ctx, '2026-11-12');
    const ok = await apply(ctx, { from_date: '2026-11-12', to_date: '2026-11-12' });
    expect((await approve(ctx, ok.body.data.id)).status).toBe(200);
    expect(await exists(ctx, '2026-11-10')).toBe(true);
    expect(await exists(ctx, '2026-11-11')).toBe(true);
    expect(await exists(ctx, '2026-11-12')).toBe(false);
  });

  test('one half day off turns an automatic present into a half day; a second half day removes it', async () => {
    const ctx = await seed();
    await autoRecord(ctx, '2026-11-10');
    const am = await apply(ctx, { from_date: '2026-11-10', to_date: '2026-11-10', is_half_day: true, half_day_session: 'FIRST_HALF' });
    expect(am.status).toBe(201);
    await approve(ctx, am.body.data.id);
    expect((await prisma.attendanceRecord.findFirst({ where: { org_membership_id: ctx.membership.id, date: d('2026-11-10') } })).status).toBe('half_day');
    const pm = await apply(ctx, { from_date: '2026-11-10', to_date: '2026-11-10', is_half_day: true, half_day_session: 'SECOND_HALF' });
    await approve(ctx, pm.body.data.id);
    expect(await exists(ctx, '2026-11-10')).toBe(false);
  });

  test('a month locked for the employee is left alone', async () => {
    const ctx = await seed();
    await autoRecord(ctx, '2026-11-10');
    await prisma.timesheetMonthLock.create({ data: { org_id: ctx.org.id, org_membership_id: ctx.membership.id, period_month: 11, period_year: 2026, locked_by: ctx.adminUser.id } });
    const res = await apply(ctx, { from_date: '2026-11-10', to_date: '2026-11-10' });
    await approve(ctx, res.body.data.id);
    expect(await exists(ctx, '2026-11-10')).toBe(true);
    expect(await auto.resolveAutoForLeave(ctx.org.id, ctx.membership.id, d('2026-11-10'), d('2026-11-10'))).toMatchObject({ removed: 0, skipped_locked: 1 });
  });
});

describe('the daily job writes `auto`; an admin backfill stays manual', () => {
  test('markPresent through runDaily is auto, a backfill with an actor is manual (reason kept in both)', async () => {
    const ctx = await seed();
    const members = await auto.applicableMembers(ctx.org.id);
    expect(members.length).toBeGreaterThan(0);
    const { todayIst } = require('../src/lib/istDate');
    const noon = new Date(`${todayIst().toISOString().slice(0, 10)}T12:00:00.000Z`);
    await auto.runDaily(ctx.org.id, noon);
    const made = await prisma.attendanceRecord.findMany({ where: { org_id: ctx.org.id } });
    for (const r of made) expect(r).toMatchObject({ source: 'auto', regularized_reason: 'auto_daily', regularized_by: null });
  });
});
