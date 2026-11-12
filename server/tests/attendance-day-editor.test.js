// 5 Nov 2026 review: the admin day editor (attendance and office / home are two separate things, a leave type is a real
// leave) and the Stage 1 lock screen (a person who has left is listed, pending entries say what and who, and a non-IT
// person's open timesheet no longer stops a salary lock).
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const DAY = '2026-10-14'; // a Wednesday

async function seed(orgOverrides = {}) {
  const org = await createOrg(orgOverrides);
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const person = async (name, overrides = {}) => {
    const user = await createUser({ role: 'recruiter', name });
    const { left_at: leftAt, ...rest } = overrides;
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: new Date('2020-01-01'), ...rest });
    if (leftAt) await prisma.orgMembership.update({ where: { id: membership.id }, data: { left_at: leftAt } });
    return { user, membership };
  };
  const types = (await authed(request(app).get('/api/v1/leave/types'), adminToken)).body.data;
  const type = (name) => types.find((t) => t.name === name);
  return { org, adminUser, adminToken, person, type };
}

const setDay = (token, body) => authed(request(app).post('/api/v1/attendance/day'), token).send({ date: DAY, reason: 'checked with the manager', ...body });
const recordOf = (membership) => prisma.attendanceRecord.findFirst({ where: { org_membership_id: membership.id, date: new Date(`${DAY}T00:00:00.000Z`) } });

describe('Admin day editor', () => {
  test('present at home is attendance "present" plus an approved home place, not a wfh status', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    const res = await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'present', work_place: 'home' });
    expect(res.status).toBe(200);
    expect((await recordOf(eve.membership)).status).toBe('present');
    const place = await prisma.workPlaceDay.findFirst({ where: { org_membership_id: eve.membership.id } });
    expect(place).toMatchObject({ work_place: 'home', status: 'approved' });
    expect(await prisma.auditLog.count({ where: { action: 'attendance_day_set', entity_id: eve.membership.id } })).toBe(1);
  });

  test('a day recorded as wfh set back to present at the office becomes a plain present day', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: eve.membership.id, date: new Date(`${DAY}T00:00:00.000Z`), status: 'wfh', source: 'manual' } });
    const res = await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'present', work_place: 'office' });
    expect(res.status).toBe(200);
    expect((await recordOf(eve.membership)).status).toBe('present');
  });

  test('leave needs a type; the chosen type becomes an approved leave and the type can be changed afterwards', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    expect((await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'leave' })).status).toBe(422);

    const casual = await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'leave', leave_type_id: ctx.type('Casual Leave').id });
    expect(casual.status).toBe(200);
    let leaves = await prisma.leaveRequest.findMany({ where: { org_membership_id: eve.membership.id, status: 'approved' }, include: { leave_type: true } });
    expect(leaves.map((l) => l.leave_type.name)).toEqual(['Casual Leave']);

    const sick = await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'leave', leave_type_id: ctx.type('Sick Leave').id });
    expect(sick.status).toBe(200);
    leaves = await prisma.leaveRequest.findMany({ where: { org_membership_id: eve.membership.id, status: 'approved' }, include: { leave_type: true } });
    expect(leaves.map((l) => l.leave_type.name)).toEqual(['Sick Leave']);
    expect(await prisma.leaveRequest.count({ where: { org_membership_id: eve.membership.id, status: 'cancelled' } })).toBe(1);
  });

  test('a day with approved leave cannot be set to present; the message points to Leave', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'leave', leave_type_id: ctx.type('Casual Leave').id });
    const res = await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'present' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/approved leave/i);
  });

  test('half day worked with the other half on unpaid leave records both, and "no leave" clears it', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    const res = await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'half_day', leave_type_id: ctx.type('Unpaid Leave').id, work_place: 'office' });
    expect(res.status).toBe(200);
    expect((await recordOf(eve.membership)).status).toBe('half_day');
    const half = await prisma.leaveRequest.findMany({ where: { org_membership_id: eve.membership.id, status: 'approved', is_half_day: true }, include: { leave_type: true } });
    expect(half.map((l) => l.leave_type.name)).toEqual(['Unpaid Leave']);

    const cleared = await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'half_day', leave_type_id: null });
    expect(cleared.status).toBe(200);
    expect(await prisma.leaveRequest.count({ where: { org_membership_id: eve.membership.id, status: 'approved', is_half_day: true } })).toBe(0);
  });

  test('a leave that runs over several days is not silently split', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    const range = await authed(request(app).post('/api/v1/leave/requests/admin'), ctx.adminToken)
      .send({ org_membership_id: eve.membership.id, leave_type_id: ctx.type('Casual Leave').id, from_date: '2026-10-13', to_date: '2026-10-15', auto_approve: true });
    expect(range.status).toBe(201);
    const res = await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'leave', leave_type_id: ctx.type('Sick Leave').id });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/runs from 2026-10-13 to 2026-10-15/);
    expect(await prisma.leaveRequest.count({ where: { org_membership_id: eve.membership.id, status: 'approved' } })).toBe(1);
  });

  test('a several-day leave is withdrawn whole after the confirm and the other days go back with the same type', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    await authed(request(app).post('/api/v1/leave/requests/admin'), ctx.adminToken)
      .send({ org_membership_id: eve.membership.id, leave_type_id: ctx.type('Casual Leave').id, from_date: '2026-10-13', to_date: '2026-10-15', auto_approve: true });
    const res = await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'leave', leave_type_id: ctx.type('Sick Leave').id, confirm_span: true });
    expect(res.status).toBe(200);
    const approved = await prisma.leaveRequest.findMany({ where: { org_membership_id: eve.membership.id, status: 'approved' }, include: { leave_type: true }, orderBy: { from_date: 'asc' } });
    expect(approved.map((r) => [r.from_date.toISOString().slice(0, 10), r.to_date.toISOString().slice(0, 10), r.leave_type.name])).toEqual([
      ['2026-10-13', '2026-10-13', 'Casual Leave'], ['2026-10-14', '2026-10-14', 'Sick Leave'], ['2026-10-15', '2026-10-15', 'Casual Leave'],
    ]);
  });

  test('cancel_leave withdraws the leave of that day and then records the attendance', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'leave', leave_type_id: ctx.type('Casual Leave').id });
    const res = await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'present', cancel_leave: true });
    expect(res.status).toBe(200);
    expect((await recordOf(eve.membership)).status).toBe('present');
    expect(await prisma.leaveRequest.count({ where: { org_membership_id: eve.membership.id, status: 'approved' } })).toBe(0);
  });

  test('the register splits office from wfh, counts worked days and leave by code', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    const rec = (date, status) => prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: eve.membership.id, date: new Date(`${date}T00:00:00.000Z`), status, source: 'manual' } });
    await rec('2026-10-12', 'present');
    await rec('2026-10-13', 'wfh');
    await rec('2026-10-15', 'half_day');
    await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'leave', leave_type_id: ctx.type('Casual Leave').id });
    const res = await authed(request(app).get('/api/v1/attendance-dashboard/register?year=2026&month=10'), ctx.adminToken);
    expect(res.status).toBe(200);
    const totals = res.body.data.people.find((p) => p.name === 'Eve').totals;
    expect(totals).toMatchObject({ office: 1, wfh: 1, worked: 2.5, present: 2.5, leave: 1 });
    expect(totals.leave_by_code).toEqual({ CL: 1 });
  });

  test('Casual lowers the balance, Unpaid shows as UL, Comp Off uses its credit, and the monthly review figures match the register', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    const eveToken = (await loginAs(eve.user)).access_token;
    const balanceOf = async (name) => (await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), eveToken)).body.data.find((b) => b.leave_type_name === name);
    const day = (n) => `2026-10-${String(n).padStart(2, '0')}`;
    const setOn = (date, body) => authed(request(app).post('/api/v1/attendance/day'), ctx.adminToken).send({ reason: 'checked with the manager', org_membership_id: eve.membership.id, date, ...body });

    expect((await balanceOf('Casual Leave')).remaining).toBe(12);
    expect((await setOn(day(14), { status: 'leave', leave_type_id: ctx.type('Casual Leave').id })).status).toBe(200);
    expect((await balanceOf('Casual Leave')).remaining).toBe(11);

    expect((await setOn(day(15), { status: 'leave', leave_type_id: ctx.type('Unpaid Leave').id })).status).toBe(200);

    await prisma.timesheetDayOvertime.create({ data: { org_id: ctx.org.id, org_membership_id: eve.membership.id, date: new Date('2026-08-01T00:00:00Z'), hours: 4, status: 'comp_off' } });
    expect((await balanceOf('Comp Off')).remaining).toBe(1);
    expect((await setOn(day(16), { status: 'leave', leave_type_id: ctx.type('Comp Off').id })).status).toBe(200);
    expect((await balanceOf('Comp Off')).remaining).toBe(0);

    await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: eve.membership.id, date: new Date(`${day(12)}T00:00:00.000Z`), status: 'present', source: 'manual' } });
    const register = (await authed(request(app).get('/api/v1/attendance-dashboard/register?year=2026&month=10'), ctx.adminToken)).body.data;
    const totals = register.people.find((p) => p.name === 'Eve').totals;
    expect(totals.leave_by_code).toEqual({ CL: 1, UL: 1, CO: 1 });
    expect(totals).toMatchObject({ office: 1, worked: 1, present: 1, leave: 3 });
    expect(register.leave_codes.map((t) => t.code)).toEqual(expect.arrayContaining(['CL', 'UL', 'CO']));

    // The monthly review reads memberMonth: its present / leave / absent are what the register totals say.
    const attendance = require('../src/modules/attendanceDashboard/attendanceDashboard.service');
    const member = await prisma.orgMembership.findUnique({ where: { id: eve.membership.id } });
    const month = await attendance.memberMonth(ctx.org.id, member, { year: 2026, month: 10 });
    expect(month).toMatchObject({ present: totals.present, wfh: totals.wfh, leave: totals.leave });
  });

  test('revoking a leave and then setting Present works', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'leave', leave_type_id: ctx.type('Casual Leave').id });
    const request_ = await prisma.leaveRequest.findFirst({ where: { org_membership_id: eve.membership.id, status: 'approved' } });
    expect((await authed(request(app).post(`/api/v1/leave/requests/${request_.id}/revoke`), ctx.adminToken).send({ reason: 'plans changed' })).status).toBe(200);
    expect((await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'present' })).status).toBe(200);
    expect((await recordOf(eve.membership)).status).toBe('present');
  });

  test('a reason is required and a plain employee cannot use it', async () => {
    const ctx = await seed();
    const eve = await ctx.person('Eve');
    expect((await setDay(ctx.adminToken, { org_membership_id: eve.membership.id, status: 'present', reason: '' })).status).toBeGreaterThanOrEqual(400);
    const token = (await loginAs(eve.user)).access_token;
    expect([401, 403]).toContain((await setDay(token, { org_membership_id: eve.membership.id, status: 'present' })).status);
  });
});

describe('Stage 1 lock screen and the salary lock', () => {
  const status = (token, month = 10, year = 2026) => authed(request(app).get('/api/v1/timesheets/locks/month-status'), token).query({ year, month });
  const entry = (membership, date = '2026-10-10', extra = {}) => prisma.timesheetEntry.create({ data: { org_id: membership.org_id, org_membership_id: membership.id, date: new Date(`${date}T00:00:00.000Z`), hours: 9, status: 'submitted', ...extra } });

  test('a person who has left is listed with their status, and what is waiting is spelled out', async () => {
    const ctx = await seed();
    const left = await ctx.person('Lena Left', { employment_status: 'terminated', left_at: new Date('2026-10-20') });
    const gone = await ctx.person('Gone Earlier', { employment_status: 'terminated', left_at: new Date('2026-08-01') });
    await entry(left.membership);
    const res = await status(ctx.adminToken);
    expect(res.status).toBe(200);
    const names = res.body.data.people.map((p) => p.name);
    expect(names).toContain('Lena Left');
    expect(names).not.toContain('Gone Earlier'); // left long before and nothing logged
    const row = res.body.data.people.find((p) => p.name === 'Lena Left');
    expect(row).toMatchObject({ employment_status: 'terminated', left_at: '2026-10-20', pending: 1 });
    expect(row.pending_entries[0]).toMatchObject({ date: '2026-10-10', hours: 9, project: null });
    expect(row.pending_entries[0].waiting_on).toMatch(/Admin/);
    expect(gone).toBeTruthy();
  });

  test('a left person can have their timesheet month locked', async () => {
    const ctx = await seed();
    const left = await ctx.person('Lena Left', { employment_status: 'terminated', left_at: new Date('2026-10-20') });
    await entry(left.membership, '2026-10-10', { status: 'approved' });
    const res = await authed(request(app).post('/api/v1/timesheets/locks/month'), ctx.adminToken).send({ year: 2026, month: 10, org_membership_ids: [left.membership.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.locked).toBe(1);
  });

  test('open timesheets of people outside IT do not block a salary lock, an IT one still does', async () => {
    const financialLock = require('../src/modules/calculations/financialLock');
    const ctx = await seed({ enforce_lock_order: true });
    const it = await prisma.department.create({ data: { org_id: ctx.org.id, name: 'IT' } });
    const sales = await prisma.department.create({ data: { org_id: ctx.org.id, name: 'Sales' } });
    const dev = await ctx.person('Dev Dee', { department_id: it.id });
    const rep = await ctx.person('Rep Ray', { department_id: sales.id });
    await entry(dev.membership, '2026-10-10', { status: 'approved' });
    await entry(rep.membership, '2026-10-10');
    const period = { period_month: 10, period_year: 2026 };
    const blockers = (id) => financialLock.lockOrderBlockers(ctx.org.id, 'salary_employee', id, period);
    expect(await blockers(rep.membership.id)).toEqual([]); // Sales: general time never feeds salary
    const devBlockers = await blockers(dev.membership.id);
    expect(devBlockers.map((b) => b.code)).toEqual(['timesheets_not_locked']);
  });
});
