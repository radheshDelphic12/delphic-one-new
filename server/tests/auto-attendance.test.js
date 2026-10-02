// Automated attendance (no check-in / check-out): the daily process marks only TODAY present for
// applicable people once their working-hour start time has passed, never a future date; an admin
// can backfill a PREVIOUS month (audited); the Timesheet Dashboard shows attendance next to hours.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const autoAttendance = require('../src/modules/attendance/autoAttendance.service');
const { todayIst } = require('../src/lib/istDate');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ymd = (d) => d.toISOString().slice(0, 10);
const isWeekday = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

async function seed() {
  const org = await createOrg();
  const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const person = async (name, { it = true, shiftStart = 0, joined = new Date('2020-01-01T00:00:00Z') } = {}) => {
    const user = await createUser({ role: 'recruiter', name });
    if (it) await prisma.user.update({ where: { id: user.id }, data: { department_id: dept.id } });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: joined });
    if (shiftStart !== null) {
      const shift = await prisma.shift.create({ data: { org_id: org.id, name: `S${name}`, start_minutes: shiftStart, end_minutes: 1439, grace_minutes: 0 } });
      await prisma.orgMembership.update({ where: { id: membership.id }, data: { shift_id: shift.id } });
    }
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  return { org, adminUser, adminToken, person };
}

describe('daily attendance process', () => {
  test('marks only today, only once the start time has passed, never overwrites, never a future date', async () => {
    const ctx = await seed();
    const early = await ctx.person('Early', { shiftStart: 0 }); // started at 00:00 - already passed
    const late = await ctx.person('Late', { shiftStart: 1439 }); // starts at 23:59
    const outsider = await ctx.person('NotIt', { it: false }); // not IT, not attendance-paid
    const today = todayIst();

    const result = await autoAttendance.runDaily(ctx.org.id, new Date());
    const records = await prisma.attendanceRecord.findMany({ where: { org_id: ctx.org.id } });

    // Weekends are not working days; otherwise only the early starter is marked.
    if (isWeekday(today)) {
      expect(result.created).toBeGreaterThanOrEqual(1);
      expect(records.map((r) => r.org_membership_id)).toContain(early.membership.id);
    } else {
      expect(records).toHaveLength(0);
    }
    expect(records.map((r) => r.org_membership_id)).not.toContain(outsider.membership.id);
    if (new Date().getUTCHours() * 60 + new Date().getUTCMinutes() < 1439 - 330) expect(records.map((r) => r.org_membership_id)).not.toContain(late.membership.id);
    // Every record is for today - nothing in the future.
    for (const r of records) expect(ymd(r.date)).toBe(ymd(today));
    expect(await prisma.attendanceRecord.count({ where: { org_id: ctx.org.id, date: { gt: today } } })).toBe(0);

    // Idempotent: a second run creates nothing and keeps an admin's correction.
    if (isWeekday(today)) {
      await prisma.attendanceRecord.updateMany({ where: { org_membership_id: early.membership.id }, data: { status: 'wfh' } });
      expect((await autoAttendance.runDaily(ctx.org.id, new Date())).created).toBe(0);
      expect((await prisma.attendanceRecord.findFirst({ where: { org_membership_id: early.membership.id } })).status).toBe('wfh');
    }
  });

  test('an approved leave day is left to leave management', async () => {
    const ctx = await seed();
    const p = await ctx.person('OnLeave', { shiftStart: 0 });
    const type = await prisma.leaveType.create({ data: { org_id: ctx.org.id, name: 'Casual', paid: true, annual_quota: 12 } });
    const today = todayIst();
    await prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: p.membership.id, leave_type_id: type.id, from_date: today, to_date: today, status: 'approved' } });
    await autoAttendance.runDaily(ctx.org.id, new Date());
    expect(await prisma.attendanceRecord.count({ where: { org_membership_id: p.membership.id } })).toBe(0);
  });
});

describe('previous-month attendance backfill (admin)', () => {
  const lastMonth = () => {
    const t = todayIst();
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  };
  const workingDays = ({ year, month }, skip = new Set()) => {
    let n = 0;
    for (let d = new Date(Date.UTC(year, month - 1, 1)); d.getUTCMonth() === month - 1; d = new Date(d.getTime() + 86400000)) if (isWeekday(d) && !skip.has(ymd(d))) n += 1;
    return n;
  };

  test('marks each working day of a past month present, skips leave and existing records, and writes an audit row', async () => {
    const ctx = await seed();
    const a = await ctx.person('Asha');
    const b = await ctx.person('Bilal');
    const m = lastMonth();
    const firstWeekday = (() => { for (let d = new Date(Date.UTC(m.year, m.month - 1, 1)); ; d = new Date(d.getTime() + 86400000)) if (isWeekday(d)) return d; })();
    // Bilal is on leave on the first working day; Asha already has a correction that day.
    const type = await prisma.leaveType.create({ data: { org_id: ctx.org.id, name: 'Casual', paid: true, annual_quota: 12 } });
    await prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: b.membership.id, leave_type_id: type.id, from_date: firstWeekday, to_date: firstWeekday, status: 'approved' } });
    await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: a.membership.id, date: firstWeekday, status: 'absent', source: 'manual' } });

    const preview = await authed(request(app).post('/api/v1/attendance/backfill-month'), ctx.adminToken).send({ ...m, reason: 'September IT', dry_run: true });
    expect(preview.status).toBe(200);
    expect(preview.body.data.records).toBe(workingDays(m) * 2 - 2);
    expect(await prisma.auditLog.count({ where: { action: 'attendance_backfill_month' } })).toBe(0); // a preview is not a marking

    const res = await authed(request(app).post('/api/v1/attendance/backfill-month'), ctx.adminToken).send({ ...m, reason: 'September IT' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ employees_affected: 2, records: workingDays(m) * 2 - 2 });
    expect(await prisma.attendanceRecord.count({ where: { org_membership_id: a.membership.id, status: 'present' } })).toBe(workingDays(m) - 1);
    expect((await prisma.attendanceRecord.findFirst({ where: { org_membership_id: a.membership.id, date: firstWeekday } })).status).toBe('absent');
    expect(await prisma.attendanceRecord.count({ where: { org_membership_id: b.membership.id, date: firstWeekday } })).toBe(0);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'attendance_backfill_month' } });
    expect(audit).toMatchObject({ actor_id: ctx.adminUser.id, reason: 'September IT' });
    expect(audit.snapshot).toMatchObject({ year: m.year, month: m.month, employees_affected: 2, records: workingDays(m) * 2 - 2 });
    expect(audit.created_at).toBeTruthy();

    const runs = await authed(request(app).get('/api/v1/attendance/backfill-month/runs'), ctx.adminToken);
    expect(runs.body.data).toHaveLength(1);

    // A second run adds nothing.
    const again = await authed(request(app).post('/api/v1/attendance/backfill-month'), ctx.adminToken).send({ ...m, reason: 'again' });
    expect(again.body.data.records).toBe(0);
  });

  test('the current or a future month cannot be backfilled; only admins can run it', async () => {
    const ctx = await seed();
    const p = await ctx.person('Asha');
    const t = todayIst();
    const current = await authed(request(app).post('/api/v1/attendance/backfill-month'), ctx.adminToken).send({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, reason: 'too early' });
    expect(current.status).toBe(422);
    const future = await authed(request(app).post('/api/v1/attendance/backfill-month'), ctx.adminToken).send({ year: t.getUTCFullYear() + 1, month: 1, reason: 'future' });
    expect(future.status).toBe(422);
    expect(await prisma.attendanceRecord.count()).toBe(0);
    const forbidden = await authed(request(app).post('/api/v1/attendance/backfill-month'), p.token).send({ year: 2026, month: 1, reason: 'nope' });
    expect(forbidden.status).toBe(403);
  });

  test('a manual attendance marking is audited too', async () => {
    const ctx = await seed();
    const p = await ctx.person('Asha');
    const res = await authed(request(app).post('/api/v1/attendance/manual'), ctx.adminToken).send({ org_membership_id: p.membership.id, date: '2026-01-05', status: 'present', reason: 'Paper register' });
    expect(res.status).toBe(201);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'attendance_manual_mark' } });
    expect(audit).toMatchObject({ actor_id: ctx.adminUser.id, reason: 'Paper register' });
    expect(audit.snapshot).toMatchObject({ status: 'present', records: 1, employees: [p.membership.id] });
  });
});

describe('Timesheet Dashboard', () => {
  test('lists the month\'s timesheets and opens a calendar with hours, attendance, leave and lock per day', async () => {
    const ctx = await seed();
    const p = await ctx.person('Asha');
    const project = await prisma.account.create({ data: { org_id: ctx.org.id, type: 'client', name: 'Miicare', stage: 'active', owner_id: ctx.adminUser.id, origin_owner_id: ctx.adminUser.id } });
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: project.id, org_membership_id: p.membership.id, created_by: ctx.adminUser.id } });
    const log = await authed(request(app).post('/api/v1/timesheets/entries'), p.token).send({ date: '2026-07-01', account_id: project.id, hours: 7, notes: 'Built the API' });
    expect(log.status).toBe(201);
    await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: p.membership.id, date: new Date('2026-07-01T00:00:00Z'), status: 'present', source: 'manual' } });
    await prisma.timesheetLock.create({ data: { org_id: ctx.org.id, date: new Date('2026-07-01T00:00:00Z'), locked_by: ctx.adminUser.id } });

    const list = await authed(request(app).get('/api/v1/timesheets/dashboard'), ctx.adminToken).query({ year: 2026, month: 7 });
    expect(list.status).toBe(200);
    expect(list.body.data.people.find((x) => x.name === 'Asha')).toMatchObject({ logged_hours: 7, pending_hours: 7, status: 'pending' });

    const cal = await authed(request(app).get('/api/v1/timesheets/dashboard/calendar'), p.token).query({ year: 2026, month: 7 });
    expect(cal.status).toBe(200);
    expect(cal.body.data.days).toHaveLength(31);
    const day = cal.body.data.days.find((d) => d.date === '2026-07-01');
    expect(day).toMatchObject({ logged: 7, status: 'pending', locked: true, attendance_status: 'present' });
    expect(day.project_hours).toEqual([{ project: 'Miicare', hours: 7 }]);
    expect(day.notes).toEqual([{ project: 'Miicare', notes: 'Built the API' }]);

    // A person only sees their own timesheet; someone else's is not theirs to open.
    const own = await authed(request(app).get('/api/v1/timesheets/dashboard'), p.token).query({ year: 2026, month: 7 });
    expect(own.body.data.people.map((x) => x.name)).toEqual(['Asha']);
    const other = await ctx.person('Bilal');
    expect((await authed(request(app).get('/api/v1/timesheets/dashboard/calendar'), other.token).query({ year: 2026, month: 7, org_membership_id: p.membership.id })).status).toBe(403);
  });
});
