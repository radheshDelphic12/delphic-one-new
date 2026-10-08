// Attendance backfill: an admin records past days one at a time
// (POST /attendance/manual) or from an uploaded sheet (POST /attendance/import,
// with a prefilled template from GET /attendance/import-template).
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const hr = await prisma.department.create({ data: { name: 'HR', org_id: org.id } });
  const sales = await prisma.department.create({ data: { name: 'Sales', org_id: org.id } });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;

  async function staff(name, department, employee_code) {
    const user = await createUser({ role: 'employee', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'employee', department_id: department.id, joined_at: new Date('2026-01-01') });
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { employee_code } });
    return { user, membership, token: (await loginAs(user)).access_token };
  }
  const priya = await staff('Priya', hr, 'HR-001');
  const rahul = await staff('Rahul', sales, 'SL-001');
  return { org, hr, sales, adminToken, priya, rahul };
}

const manual = (token, body) => authed(request(app).post('/api/v1/attendance/manual'), token).send({ reason: 'September backfill', ...body });
const importSheet = (token, body) => authed(request(app).post('/api/v1/attendance/import'), token).send({ reason: 'September backfill', ...body });

describe('Manual past-day attendance', () => {
  test('creates a missing day with IST times, then overwrites it; audited as manual', async () => {
    const ctx = await seed();
    const res = await manual(ctx.adminToken, { org_membership_id: ctx.priya.membership.id, date: '2026-09-10', status: 'present', check_in_time: '09:30', check_out_time: '18:15' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'present', source: 'manual', regularized_reason: 'September backfill' });
    expect(new Date(res.body.data.check_in_at).toISOString()).toBe('2026-09-10T04:00:00.000Z');
    expect(new Date(res.body.data.check_out_at).toISOString()).toBe('2026-09-10T12:45:00.000Z');

    const again = await manual(ctx.adminToken, { org_membership_id: ctx.priya.membership.id, date: '2026-09-10', status: 'absent', check_in_time: '09:30' });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ id: res.body.data.id, status: 'absent', check_in_at: null, check_out_at: null });
    expect(await prisma.attendanceRecord.count({ where: { org_membership_id: ctx.priya.membership.id } })).toBe(1);
  });

  test('rejects future dates, days before joining, approved leave days, and non-admins', async () => {
    const ctx = await seed();
    const id = ctx.priya.membership.id;
    const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    expect((await manual(ctx.adminToken, { org_membership_id: id, date: future, status: 'present' })).status).toBe(422);
    expect((await manual(ctx.adminToken, { org_membership_id: id, date: '2025-12-15', status: 'present' })).status).toBe(422);

    const leaveType = await prisma.leaveType.create({ data: { org_id: ctx.org.id, name: 'Paid Leave' } });
    await prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: id, leave_type_id: leaveType.id, from_date: new Date('2026-09-15'), to_date: new Date('2026-09-15'), status: 'approved' } });
    expect((await manual(ctx.adminToken, { org_membership_id: id, date: '2026-09-15', status: 'present' })).status).toBe(422);
    expect((await manual(ctx.adminToken, { org_membership_id: id, date: '2026-09-15', status: 'leave' })).status).toBe(201);

    expect((await manual(ctx.priya.token, { org_membership_id: id, date: '2026-09-11', status: 'present' })).status).toBe(403);
  });
});

describe('Bulk attendance import', () => {
  test('template is per department, one row per day, prefilled with what is recorded', async () => {
    const ctx = await seed();
    await manual(ctx.adminToken, { org_membership_id: ctx.priya.membership.id, date: '2026-09-02', status: 'wfh', check_in_time: '10:00' });
    const res = await authed(request(app).get('/api/v1/attendance/import-template'), ctx.adminToken).query({ from: '2026-09-01', to: '2026-09-05', department_id: ctx.hr.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.data.every((r) => r.employee === 'HR-001' && r.department === 'HR')).toBe(true);
    expect(res.body.data[1]).toMatchObject({ date: '2026-09-02', status: 'wfh', check_in: '10:00', check_out: '' });
    expect(res.body.data[0].status).toBe('');
  });

  test('checks every row first; a sheet with errors writes nothing', async () => {
    const ctx = await seed();
    const rows = [
      { employee: 'HR-001', date: '2026-09-01', status: 'Present', check_in: '09:30', check_out: '18:00' },
      { employee: 'nobody@example.com', date: '2026-09-01', status: 'present' },
      { employee: 'SL-001', date: '2026-09-01', status: 'sick' },
      { employee: 'SL-001', date: '2026-09-02', status: '' },
    ];
    const res = await importSheet(ctx.adminToken, { rows });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ applied: false, skipped: 1, created: 1 });
    expect(res.body.data.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(await prisma.attendanceRecord.count()).toBe(0);
  });

  test('dry run previews, then the same sheet applies; employees match by code or email', async () => {
    const ctx = await seed();
    const rows = [
      { employee: 'HR-001', date: '2026-09-01', status: 'present', check_in: '09:30', check_out: '18:00' },
      { employee: 'hr-001', date: '2026-09-02', status: 'half day' },
      { employee: ctx.rahul.user.email.toUpperCase(), date: '2026-09-01', status: 'absent' },
    ];
    const preview = await importSheet(ctx.adminToken, { rows, dry_run: true });
    expect(preview.body.data).toMatchObject({ applied: false, created: 3, updated: 0, errors: [] });
    expect(await prisma.attendanceRecord.count()).toBe(0);

    const applied = await importSheet(ctx.adminToken, { rows });
    expect(applied.body.data).toMatchObject({ applied: true, created: 3 });
    const priyaDays = await prisma.attendanceRecord.findMany({ where: { org_membership_id: ctx.priya.membership.id }, orderBy: { date: 'asc' } });
    expect(priyaDays.map((d) => [d.status, d.source])).toEqual([['present', 'manual'], ['half_day', 'manual']]);

    // Re-uploading the same sheet changes nothing.
    expect((await importSheet(ctx.adminToken, { rows })).body.data).toMatchObject({ applied: true, created: 0, updated: 0, unchanged: 3 });
  });
});
