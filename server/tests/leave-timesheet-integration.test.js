// Leave Balance <-> Timesheet <-> monthly hours <-> payroll integration.
// Rules: only APPROVED leave has any effect; full day = 9h, half = 4.5h, unpaid
// adds no paid hours; leave + worked hours never exceed the day; conflicts are
// refused (never overwritten) on apply AND on approval.
// September 2026 is fully in the past (today = Oct 2026) so the leave is "used";
// 1 Sep is a Tuesday and there are 22 working days (198h at a 9h shift).
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const salaryEngine = require('../src/modules/calculations/engines/salary.engine');
const leaveService = require('../src/modules/leave/leave.service');
const { computeBreakdown } = require('../src/modules/payroll/payroll.service');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const d = (s) => new Date(`${s}T00:00:00.000Z`);

async function person(org, { role = 'employee' } = {}) {
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role, joined_at: d('2026-01-01') });
  const { access_token } = await loginAs(user);
  return { user, membership, token: access_token };
}

let projectId;

async function seed() {
  const org = await createOrg();
  const admin = await person(org, { role: 'admin' });
  const emp = await person(org);
  const project = await prisma.account.create({ data: { org_id: org.id, name: 'Project', type: 'client', stage: 'active', owner_id: admin.user.id } });
  projectId = project.id;
  await prisma.projectMemberAssignment.create({
    data: { org_id: org.id, account_id: project.id, org_membership_id: emp.membership.id, created_by: admin.user.id },
  });
  await prisma.salaryStructure.create({
    data: { org_id: org.id, org_membership_id: emp.membership.id, effective_from: d('2020-01-01'), ctc: 198000, components: {}, created_by: admin.user.id },
  });
  await leaveService.listTypes(org.id);
  const types = await prisma.leaveType.findMany({ where: { org_id: org.id } });
  const byName = (n) => types.find((t) => t.name === n);
  return { org, admin, emp, CL: byName('Casual Leave'), UL: byName('Unpaid Leave') };
}

const api = (method, token, path) => authed(request(app)[method](`/api/v1${path}`), token);
const apply = (token, body) => api('post', token, '/leave/requests').send(body);
const adminApply = (token, body) => api('post', token, '/leave/requests/admin').send(body);
const decide = (token, id, status, reason) => api('post', token, `/leave/requests/${id}/decision`).send({ status, reason });
const revoke = (token, id) => api('post', token, `/leave/requests/${id}/revoke`).send({ reason: 'Plan changed' });
const logHours = (token, date, hours) => api('post', token, '/timesheets/entries').send({ date, hours, account_id: projectId });
const weekOf = async (token, date) => (await api('get', token, `/timesheets/week?date=${date}`)).body.data;
const dayOf = async (token, date) => (await weekOf(token, date)).days.find((x) => x.date === date);

// An approved timesheet entry straight into the DB (the payroll-side scenarios).
const entry = (s, date, hours, status = 'approved') =>
  prisma.timesheetEntry.create({ data: { org_id: s.org.id, org_membership_id: s.emp.membership.id, date: d(date), hours, status } });
const leaveRow = (s, type, from, to, status = 'approved', extra = {}) =>
  prisma.leaveRequest.create({
    data: { org_id: s.org.id, org_membership_id: s.emp.membership.id, leave_type_id: type.id, from_date: d(from), to_date: d(to), status, ...extra },
  });
const septLine = async (s) => {
  const salary = await salaryEngine.computeSalary(s.org.id, { period_month: 9, period_year: 2026 });
  return salary.lines.find((l) => l.org_membership_id === s.emp.membership.id);
};
const balanceOf = async (s, type) => (await api('get', s.emp.token, '/leave/balances/me?year=2026')).body.data.find((b) => b.leave_type_id === type.id);

describe('leave types x timesheet day view (rules 1, 3, 9)', () => {
  test('full paid leave shows as a paid-leave day with 9h; half paid shows 4.5h and still 4.5h to work', async () => {
    const s = await seed();
    const full = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-08' });
    const half = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-09', to_date: '2026-09-09', is_half_day: true, half_day_session: 'FIRST_HALF' });
    expect(full.status).toBe(201);
    expect(half.status).toBe(201);
    await decide(s.admin.token, full.body.data.id, 'approved');
    await decide(s.admin.token, half.body.data.id, 'approved');

    const sep8 = await dayOf(s.emp.token, '2026-09-08');
    expect(sep8.leave).toMatchObject({ name: 'Casual Leave', paid: true, is_half_day: false, hours: 9, status: 'approved' });
    expect(sep8).toMatchObject({ leave_hours: 9, paid_leave_hours: 9, unpaid_leave_hours: 0, expected: 0, paid_hours: 9, deficit: 0 });

    const sep9 = await dayOf(s.emp.token, '2026-09-09');
    expect(sep9.leave).toMatchObject({ is_half_day: true, half_day_session: 'FIRST_HALF', hours: 4.5 });
    expect(sep9).toMatchObject({ leave_hours: 4.5, paid_leave_hours: 4.5, expected: 4.5, paid_hours: 4.5, deficit: 4.5 });
  });

  test('full unpaid leave: 9h of leave, 0 paid hours; half unpaid: worked half paid, leave half not', async () => {
    const s = await seed();
    const full = await apply(s.emp.token, { leave_type_id: s.UL.id, from_date: '2026-09-08', to_date: '2026-09-08' });
    const half = await apply(s.emp.token, { leave_type_id: s.UL.id, from_date: '2026-09-09', to_date: '2026-09-09', is_half_day: true, half_day_session: 'SECOND_HALF' });
    await decide(s.admin.token, full.body.data.id, 'approved');
    await decide(s.admin.token, half.body.data.id, 'approved');
    expect((await logHours(s.emp.token, '2026-09-09', 4.5)).status).toBe(201);

    const sep8 = await dayOf(s.emp.token, '2026-09-08');
    expect(sep8).toMatchObject({ leave_hours: 9, paid_leave_hours: 0, unpaid_leave_hours: 9, paid_hours: 0 });
    const sep9 = await dayOf(s.emp.token, '2026-09-09');
    expect(sep9).toMatchObject({ leave_hours: 4.5, unpaid_leave_hours: 4.5, paid_leave_hours: 0, pending: 4.5 });
  });
});

describe('approval workflow: only approved leave has any effect (rule 2)', () => {
  test('pending leave: shown, but no hours, no payroll effect, and does not block timesheets', async () => {
    const s = await seed();
    const res = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-08' });
    expect(res.body.data.status).toBe('pending');

    const day = await dayOf(s.emp.token, '2026-09-08');
    expect(day.leave).toBeNull();
    expect(day.pending_leaves).toHaveLength(1);
    expect(day).toMatchObject({ leave_hours: 0, paid_leave_hours: 0, expected: 9 });
    expect((await logHours(s.emp.token, '2026-09-08', 9)).status).toBe(201); // not blocked

    const line = await septLine(s);
    expect(line.breakdown).toMatchObject({ paid_leave_days: 0, paid_leave_hours: 0 });
    // Pending counts only as "pending" on the balance (existing rule), never as used.
    expect(await balanceOf(s, s.CL)).toMatchObject({ used: 0, upcoming: 0, pending: 1 });
  });

  test('approved leave: balance is deducted at approval, hours and payroll follow', async () => {
    const s = await seed();
    const res = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-08' });
    expect(await balanceOf(s, s.CL)).toMatchObject({ used: 0, pending: 1, remaining: 12 });
    expect((await decide(s.admin.token, res.body.data.id, 'approved')).status).toBe(200);
    expect(await balanceOf(s, s.CL)).toMatchObject({ used: 1, pending: 0, remaining: 11 });
    expect((await septLine(s)).breakdown).toMatchObject({ paid_leave_days: 1, paid_leave_hours: 9 });
  });

  test('rejected leave: no effect on balance, hours, payroll or timesheets', async () => {
    const s = await seed();
    const res = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-08' });
    expect((await decide(s.admin.token, res.body.data.id, 'rejected', 'Busy week')).status).toBe(200);
    expect(await balanceOf(s, s.CL)).toMatchObject({ used: 0, upcoming: 0, pending: 0, remaining: 12 });
    expect((await dayOf(s.emp.token, '2026-09-08')).leave).toBeNull();
    expect((await septLine(s)).breakdown).toMatchObject({ paid_leave_hours: 0 });
    expect((await logHours(s.emp.token, '2026-09-08', 9)).status).toBe(201);
  });

  test('cancelled / revoked approved leave reverses balance, paid hours and the timesheet block', async () => {
    const s = await seed();
    const res = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-09' });
    await decide(s.admin.token, res.body.data.id, 'approved');
    expect((await logHours(s.emp.token, '2026-09-08', 9)).status).toBe(422); // blocked while approved
    expect((await septLine(s)).breakdown.paid_leave_hours).toBe(18);
    expect(await balanceOf(s, s.CL)).toMatchObject({ used: 2, remaining: 10 });

    expect((await revoke(s.admin.token, res.body.data.id)).status).toBe(200);
    expect(await balanceOf(s, s.CL)).toMatchObject({ used: 0, remaining: 12 });
    expect((await septLine(s)).breakdown).toMatchObject({ paid_leave_hours: 0, paid_leave_days: 0 });
    const day = await dayOf(s.emp.token, '2026-09-08');
    expect(day).toMatchObject({ leave: null, leave_hours: 0, expected: 9 });
    expect((await logHours(s.emp.token, '2026-09-08', 9)).status).toBe(201);
    // A cancelled request can't be revoked again.
    expect((await revoke(s.admin.token, res.body.data.id)).status).toBe(409);
  });
});

describe('conflicts: apply, approve and timesheet creation (rule 8)', () => {
  test('full-day leave vs an existing timesheet is refused with a clear message and nothing is overwritten', async () => {
    const s = await seed();
    await logHours(s.emp.token, '2026-09-10', 6);
    const res = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-10', to_date: '2026-09-10' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/timesheet with 6h already exists on 2026-09-10/);
    expect(await prisma.leaveRequest.count()).toBe(0);
    expect(await prisma.timesheetEntry.count()).toBe(1);
  });

  test('a multi-day full-day request is refused if ANY working day in it has a timesheet; weekends are ignored', async () => {
    const s = await seed();
    await entry(s, '2026-09-12', 5); // Saturday - not a working day, no conflict
    expect((await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-11', to_date: '2026-09-14' })).status).toBe(201);
    await entry(s, '2026-09-16', 8, 'submitted');
    const clash = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-15', to_date: '2026-09-17' });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toMatch(/2026-09-16/);
  });

  test('approved full-day leave blocks timesheet creation (employee, admin entry and CSV-style admin add)', async () => {
    const s = await seed();
    const res = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-10', to_date: '2026-09-10' });
    await decide(s.admin.token, res.body.data.id, 'approved');
    const own = await logHours(s.emp.token, '2026-09-10', 2);
    expect(own.status).toBe(422);
    expect(own.body.message).toMatch(/approved Casual Leave leave/);
    const byAdmin = await api('post', s.admin.token, '/timesheets/entries/admin').send({ org_membership_id: s.emp.membership.id, date: '2026-09-10', hours: 2, reason: 'Backfill' });
    expect(byAdmin.status).toBe(422);
    expect(await prisma.timesheetEntry.count()).toBe(0);
  });

  test('half-day leave caps work at the remaining 4.5h (create and edit); apply is refused above 4.5h', async () => {
    const s = await seed();
    // Apply side: 6h already logged -> a half day cannot be applied.
    await logHours(s.emp.token, '2026-09-10', 6);
    const refused = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-10', to_date: '2026-09-10', is_half_day: true, half_day_session: 'FIRST_HALF' });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/6h are already logged on 2026-09-10.*only 4\.5h/);
    // 4.5h fits.
    await prisma.timesheetEntry.deleteMany();
    await logHours(s.emp.token, '2026-09-10', 4.5);
    const ok = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-10', to_date: '2026-09-10', is_half_day: true, half_day_session: 'FIRST_HALF' });
    expect(ok.status).toBe(201);
    await decide(s.admin.token, ok.body.data.id, 'approved');

    // Create side on another half-day: working + leave <= 9.
    const half = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-11', to_date: '2026-09-11', is_half_day: true, half_day_session: 'SECOND_HALF' });
    await decide(s.admin.token, half.body.data.id, 'approved');
    const tooMuch = await logHours(s.emp.token, '2026-09-11', 5);
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.message).toMatch(/only 4\.5h can be logged/);
    const first = await logHours(s.emp.token, '2026-09-11', 3);
    expect(first.status).toBe(201);
    expect((await logHours(s.emp.token, '2026-09-11', 2)).status).toBe(422); // 3 + 2 > 4.5
    expect((await logHours(s.emp.token, '2026-09-11', 1.5)).status).toBe(201); // exactly 4.5
    const edit = await api('patch', s.emp.token, `/timesheets/entries/${first.body.data.id}`).send({ hours: 4 });
    expect(edit.status).toBe(422); // 4 + 1.5 > 4.5
  });

  test('approval after a timesheet already exists: approval is refused, request stays pending, nothing is changed', async () => {
    const s = await seed();
    const res = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-10', to_date: '2026-09-10' });
    expect(res.status).toBe(201);
    expect((await logHours(s.emp.token, '2026-09-10', 9)).status).toBe(201); // allowed while leave is only pending

    const approval = await decide(s.admin.token, res.body.data.id, 'approved');
    expect(approval.status).toBe(409);
    expect(approval.body.message).toMatch(/timesheet with 9h already exists on 2026-09-10/);
    expect((await prisma.leaveRequest.findUnique({ where: { id: res.body.data.id } })).status).toBe('pending');
    expect(await prisma.timesheetEntry.count()).toBe(1);
    // After the employee clears the timesheet the same approval goes through.
    await prisma.timesheetEntry.deleteMany();
    expect((await decide(s.admin.token, res.body.data.id, 'approved')).status).toBe(200);
  });

  test('approval of a half day is refused when more than 4.5h was logged meanwhile', async () => {
    const s = await seed();
    const res = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-10', to_date: '2026-09-10', is_half_day: true, half_day_session: 'FIRST_HALF' });
    await logHours(s.emp.token, '2026-09-10', 7);
    const approval = await decide(s.admin.token, res.body.data.id, 'approved');
    expect(approval.status).toBe(409);
    expect(approval.body.message).toMatch(/only 4\.5h/);
  });

  test('duplicate prevention: overlapping leave is refused, a double approval is refused, AM + PM halves are allowed', async () => {
    const s = await seed();
    const first = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-09' });
    expect(first.status).toBe(201);
    expect((await apply(s.emp.token, { leave_type_id: s.UL.id, from_date: '2026-09-09', to_date: '2026-09-10' })).status).toBe(409);
    expect((await decide(s.admin.token, first.body.data.id, 'approved')).status).toBe(200);
    expect((await decide(s.admin.token, first.body.data.id, 'approved')).status).toBe(409);
    expect((await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-08', is_half_day: true, half_day_session: 'FIRST_HALF' })).status).toBe(409);
    // The balance moved once.
    expect(await balanceOf(s, s.CL)).toMatchObject({ used: 2, remaining: 10 });

    // AM + PM on one date are compatible and together block the whole day.
    const am = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-15', to_date: '2026-09-15', is_half_day: true, half_day_session: 'FIRST_HALF' });
    const pm = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-15', to_date: '2026-09-15', is_half_day: true, half_day_session: 'SECOND_HALF' });
    expect([am.status, pm.status]).toEqual([201, 201]);
    await decide(s.admin.token, am.body.data.id, 'approved');
    await decide(s.admin.token, pm.body.data.id, 'approved');
    expect((await logHours(s.emp.token, '2026-09-15', 1)).status).toBe(422);
    expect(await dayOf(s.emp.token, '2026-09-15')).toMatchObject({ leave_hours: 9, paid_leave_hours: 9, expected: 0 });
  });
});

describe('admin applies leave (rule 7)', () => {
  test('admin applies for an employee: pending by default (same approval rules), employee sees it', async () => {
    const s = await seed();
    const res = await adminApply(s.admin.token, { org_membership_id: s.emp.membership.id, leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-08', reason: 'Medical' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ org_membership_id: s.emp.membership.id, status: 'pending' });
    const mine = await api('get', s.emp.token, '/leave/requests/me');
    expect(mine.body.data).toHaveLength(1);
    expect((await dayOf(s.emp.token, '2026-09-08')).leave).toBeNull(); // still pending: no effect
    expect((await decide(s.admin.token, res.body.data.id, 'approved')).status).toBe(200);
    expect((await dayOf(s.emp.token, '2026-09-08')).leave_hours).toBe(9);
  });

  test('admin can auto-approve on behalf of an employee; conflicts are still enforced; employees cannot use the endpoint', async () => {
    const s = await seed();
    const res = await adminApply(s.admin.token, { org_membership_id: s.emp.membership.id, leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-08', auto_approve: true });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.approver_id).toBe(s.admin.membership.id);

    await entry(s, '2026-09-10', 9);
    const clash = await adminApply(s.admin.token, { org_membership_id: s.emp.membership.id, leave_type_id: s.CL.id, from_date: '2026-09-10', to_date: '2026-09-10', auto_approve: true });
    expect(clash.status).toBe(409);
    expect(await prisma.leaveRequest.count()).toBe(1);

    expect((await adminApply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-14', to_date: '2026-09-14' })).status).toBe(403);
    const unknown = await adminApply(s.admin.token, { org_membership_id: '00000000-0000-4000-8000-0000000000aa', leave_type_id: s.CL.id, from_date: '2026-09-14', to_date: '2026-09-14' });
    expect(unknown.status).toBe(404);
  });

  test('admin override: full-day leave over days marked present is applied + approved, the days become leave, audited; admin only, reason required', async () => {
    const s = await seed();
    const present = (date) => prisma.attendanceRecord.create({ data: { org_id: s.org.id, org_membership_id: s.emp.membership.id, date: d(date), status: 'present' } });
    await present('2026-09-08');
    await present('2026-09-09');
    const body = { org_membership_id: s.emp.membership.id, leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-09' };

    // Without the override the present days still block it.
    expect((await adminApply(s.admin.token, { ...body, auto_approve: true })).status).toBe(409);
    // Override needs a reason and immediate approval.
    expect((await adminApply(s.admin.token, { ...body, auto_approve: true, override_attendance: true })).status).toBe(400);
    expect((await adminApply(s.admin.token, { ...body, override_attendance: true, reason: 'Family emergency' })).status).toBe(400);
    // A Leave Manager who is not an admin cannot override.
    const manager = await person(s.org);
    await prisma.orgMembership.update({ where: { id: manager.membership.id }, data: { is_leave_manager: true } });
    expect((await adminApply(manager.token, { ...body, auto_approve: true, override_attendance: true, reason: 'Family emergency' })).status).toBe(403);
    expect(await prisma.leaveRequest.count()).toBe(0);

    const res = await adminApply(s.admin.token, { ...body, auto_approve: true, override_attendance: true, reason: 'Family emergency' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'approved', attendance_overridden: 2 });

    const records = await prisma.attendanceRecord.findMany({ where: { org_membership_id: s.emp.membership.id }, orderBy: { date: 'asc' } });
    expect(records.map((r) => r.status)).toEqual(['leave', 'leave']);
    expect(records[0]).toMatchObject({ regularized_by: s.admin.user.id, regularized_reason: '[leave override] Family emergency' });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'attendance_leave_override' } });
    expect(audit).toMatchObject({ actor_id: s.admin.user.id, reason: 'Family emergency' });
    expect(audit.snapshot).toMatchObject({ records: 2, days: [{ date: '2026-09-08', from: 'present' }, { date: '2026-09-09', from: 'present' }] });
    expect((await dayOf(s.emp.token, '2026-09-08')).leave_hours).toBe(9);
  });

  test('admin applies for themselves (org_membership_id omitted) and it follows the same rules', async () => {
    const s = await seed();
    const res = await adminApply(s.admin.token, { leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-08' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ org_membership_id: s.admin.membership.id, status: 'pending' });
    expect((await adminApply(s.admin.token, { leave_type_id: s.CL.id, from_date: '2026-09-08', to_date: '2026-09-08' })).status).toBe(409); // overlap
    expect((await decide(s.admin.token, res.body.data.id, 'approved')).status).toBe(200);
    expect((await dayOf(s.admin.token, '2026-09-08')).leave_hours).toBe(9);
  });
});

describe('monthly paid hours and payroll (rules 5, 6, 10)', () => {
  // Disabled: salary is calculated from attendance for everyone; the timesheet-hours salary basis is switched off.
  test.skip('140h worked + 2 approved full paid days = 158 paid hours; unpaid leave and pending leave add nothing', async () => {
    const s = await seed();
    const workDays = ['01', '02', '03', '04', '07', '08', '09', '10', '11', '14', '15', '16', '17', '18', '21'];
    for (const day of workDays) await entry(s, `2026-09-${day}`, 9);
    await entry(s, '2026-09-22', 5); // 15 x 9 + 5 = 140h worked
    await leaveRow(s, s.CL, '2026-09-23', '2026-09-24'); // 2 paid full days
    await leaveRow(s, s.UL, '2026-09-25', '2026-09-25'); // unpaid: no paid hours
    await leaveRow(s, s.CL, '2026-09-28', '2026-09-28', 'pending'); // pending: nothing
    await leaveRow(s, s.CL, '2026-09-29', '2026-09-29', 'rejected'); // rejected: nothing

    const hours = (await api('get', s.emp.token, '/timesheets/hours?from=2026-09-01&to=2026-09-30')).body.data;
    expect(hours.totals).toMatchObject({ approved: 140, paid_leave_hours: 18, unpaid_leave_hours: 9, paid_hours: 158 });

    const line = await septLine(s);
    expect(line.breakdown).toMatchObject({ approved_hours: 140, paid_hours: 158, paid_leave_hours: 18, unpaid_leave_hours: 9, paid_leave_days: 2, unpaid_leave_days: 1 });
    // Payroll and the timesheet totals agree: no double counting.
    expect(line.breakdown.paid_hours).toBe(hours.totals.paid_hours);
  });

  test('a half paid day adds 4.5h to paid hours; the rest of that day is worked hours - leave + work never exceed 9h', () => {
    const base = { period_start: d('2026-09-01'), period_end: d('2026-09-30'), days_in_month: 30, ctc: 198000, shiftHours: 9 };
    const hoursByDate = new Map([['2026-09-08', { approved: 4.5, pending: 0 }]]);
    const half = computeBreakdown({ ...base, hoursByDate, leaveRanges: [{ from_date: d('2026-09-08'), to_date: d('2026-09-08'), is_half_day: true, paid: true }] });
    expect(half.breakdown).toMatchObject({ paid_hours: 9, paid_leave_hours: 4.5, paid_leave_days: 0.5 });

    // Even if more hours were (wrongly) approved alongside a full paid leave, the day pays 9h once.
    const doubled = computeBreakdown({
      ...base,
      hoursByDate: new Map([['2026-09-08', { approved: 9, pending: 0 }]]),
      leaveRanges: [{ from_date: d('2026-09-08'), to_date: d('2026-09-08'), is_half_day: false, paid: true }],
    });
    expect(doubled.breakdown.paid_hours).toBe(9);
    // Half unpaid: only the worked half is paid, the leave half is a deficit.
    const unpaidHalf = computeBreakdown({ ...base, hoursByDate, leaveRanges: [{ from_date: d('2026-09-08'), to_date: d('2026-09-08'), is_half_day: true, paid: false }] });
    expect(unpaidHalf.breakdown).toMatchObject({ paid_hours: 4.5, unpaid_leave_hours: 4.5, unpaid_leave_days: 0.5 });
  });

  // Disabled: salary is calculated from attendance for everyone; the timesheet-hours salary basis is switched off.
  test.skip('payroll after approved paid leave: no salary deduction for the leave days; unpaid leave is deducted; revoke puts it back', async () => {
    const s = await seed();
    for (let day = 1; day <= 30; day += 1) {
      const date = d(`2026-09-${String(day).padStart(2, '0')}`);
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
      if (day === 8 || day === 9 || day === 10) continue; // leave days: no timesheet
      await entry(s, `2026-09-${String(day).padStart(2, '0')}`, 9);
    }
    // Before any leave: three full days short -> 27h deficit = 27,000.
    expect((await septLine(s))).toMatchObject({ net: 171000, deductions: 27000 });

    const paid = await leaveRow(s, s.CL, '2026-09-08', '2026-09-09'); // 2 paid days
    const unpaid = await leaveRow(s, s.UL, '2026-09-10', '2026-09-10'); // 1 unpaid day
    expect(await septLine(s)).toMatchObject({ net: 189000, deductions: 9000 }); // only the unpaid day is deducted

    await revoke(s.admin.token, paid.id);
    expect((await septLine(s))).toMatchObject({ net: 171000, deductions: 27000 });
    expect((await prisma.leaveRequest.findUnique({ where: { id: unpaid.id } })).status).toBe('approved');
  });

  test('multi-day leave: Mon-Wed = 3 days / 27h, weekend inside a longer range costs nothing; balance counts working days', async () => {
    const s = await seed();
    const three = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-14', to_date: '2026-09-16' });
    expect(three.body.data.days).toBe(3);
    const overWeekend = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-17', to_date: '2026-09-22' }); // Thu-Tue: 4 working days
    expect(overWeekend.body.data.days).toBe(4);
    await decide(s.admin.token, three.body.data.id, 'approved');
    await decide(s.admin.token, overWeekend.body.data.id, 'approved');
    const hours = (await api('get', s.emp.token, '/timesheets/hours?from=2026-09-14&to=2026-09-22')).body.data;
    expect(hours.totals).toMatchObject({ paid_leave_hours: 63, leave_hours: 63 });
    expect(hours.days.find((x) => x.date === '2026-09-19')).toMatchObject({ leave: null, leave_hours: 0, day_type: 'weekend' });
    expect(await balanceOf(s, s.CL)).toMatchObject({ used: 7, remaining: 5 });
  });

  test('leave spanning two months is split by month: paid hours go to the month each day falls in', async () => {
    const s = await seed();
    // Tue 29 Sep -> Fri 2 Oct 2026: 4 working days (29, 30 Sep; 1, 2 Oct).
    const res = await apply(s.emp.token, { leave_type_id: s.CL.id, from_date: '2026-09-29', to_date: '2026-10-02' });
    expect(res.status).toBe(201);
    expect(res.body.data.days).toBe(4);
    await decide(s.admin.token, res.body.data.id, 'approved');

    expect((await septLine(s)).breakdown).toMatchObject({ paid_leave_days: 2, paid_leave_hours: 18 });
    const oct = (await salaryEngine.computeSalary(s.org.id, { period_month: 10, period_year: 2026 })).lines.find((l) => l.org_membership_id === s.emp.membership.id);
    expect(oct.breakdown).toMatchObject({ paid_leave_days: 2, paid_leave_hours: 18 });
    const hours = (await api('get', s.emp.token, '/timesheets/hours?from=2026-09-28&to=2026-10-03')).body.data;
    expect(hours.totals.paid_leave_hours).toBe(36);
    const bal = await balanceOf(s, s.CL);
    expect(bal.used + bal.upcoming).toBe(4); // the whole leave is deducted once, whatever today is
  });
});
