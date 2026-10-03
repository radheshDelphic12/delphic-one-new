// Corrections: bulk Present is IT-only (+ clean-up of the earlier wrong run), the Timesheet Dashboard keeps
// attendance, leave and project hours apart (contractors have no attendance), bulk delete of logs, project
// duration decides Finance billing eligibility, client OT yes/no, and billing ignores attendance and cost rates.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const api = (path) => `/api/v1${path}`;
const SEP = { year: 2026, month: 9 };

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const it = await prisma.department.create({ data: { name: 'IT', org_id: org.id } });
  const hr = await prisma.department.create({ data: { name: 'HR', org_id: org.id } });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Calendar', is_default: true } });
  const client = await prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: adminUser.id, org_id: org.id, industry: 'IT' } });
  const person = async (name, { dept = null, worker_type = null } = {}) => {
    const user = await createUser({ role: 'employee', name });
    if (dept) await prisma.user.update({ where: { id: user.id }, data: { department_id: dept.id } });
    const membership = await createOrgMembership(user.id, org.id, { role: 'employee', joined_at: new Date('2020-01-01') });
    if (worker_type) await prisma.orgMembership.update({ where: { id: membership.id }, data: { worker_type } });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  return { org, it, hr, adminUser, adminToken, client, person };
}

async function addProject(ctx, name, { rate = 1000, rate_type = 'hourly', start = '2026-01-01', end = null, overtime = false } = {}) {
  const res = await authed(request(app).post(api('/calendars/projects')), ctx.adminToken).send({ name, service_category: 'managed_services', client_account_id: ctx.client.id });
  expect(res.status).toBe(201);
  const patch = await authed(request(app).patch(api(`/billing/projects/${res.body.data.id}`)), ctx.adminToken).send({
    agreement_start_date: start,
    ...(end ? { agreement_end_date: end } : {}),
    overtime_billable: overtime,
    ...(overtime ? { overtime_multiplier: 1.5 } : {}),
    billing: { rate_type, rate, currency: 'INR' },
  });
  expect(patch.status).toBe(200);
  return patch.body.data;
}

const day = (s) => new Date(`${s}T00:00:00.000Z`);

describe('bulk Present covers full-time employees, IT and non-IT', () => {
  test('backfill marks IT and non-IT full-time employees; contractors are never marked', async () => {
    const ctx = await seed();
    const itEmp = await ctx.person('It Emp', { dept: ctx.it });
    const hrEmp = await ctx.person('Hr Emp', { dept: ctx.hr });
    const noDept = await ctx.person('No Dept');
    const itContractor = await ctx.person('It Contractor', { dept: ctx.it, worker_type: 'contractor' });

    const res = await authed(request(app).post(api('/attendance/backfill-month')), ctx.adminToken).send({ ...SEP, reason: 'September attendance' });
    expect(res.status).toBe(200);
    for (const employee of [itEmp, hrEmp, noDept]) {
      expect(await prisma.attendanceRecord.count({ where: { org_membership_id: employee.membership.id } })).toBeGreaterThan(15);
    }
    expect(await prisma.attendanceRecord.count({ where: { org_membership_id: itContractor.membership.id } })).toBe(0);
  });

  test('department does not decide who is marked: a full-time HR employee is marked the same as IT', async () => {
    const ctx = await seed();
    const user = await createUser({ role: 'employee', name: 'Membership IT' });
    const viaMembership = await createOrgMembership(user.id, ctx.org.id, { role: 'employee', joined_at: new Date('2020-01-01'), department_id: ctx.it.id });
    const other = await createUser({ role: 'employee', name: 'Membership HR' });
    await prisma.user.update({ where: { id: other.id }, data: { department_id: ctx.it.id } });
    const hrWins = await createOrgMembership(other.id, ctx.org.id, { role: 'employee', joined_at: new Date('2020-01-01'), department_id: ctx.hr.id });

    await authed(request(app).post(api('/attendance/backfill-month')), ctx.adminToken).send({ ...SEP, reason: 'September attendance' });
    expect(await prisma.attendanceRecord.count({ where: { org_membership_id: viaMembership.id } })).toBeGreaterThan(15);
    expect(await prisma.attendanceRecord.count({ where: { org_membership_id: hrWins.id } })).toBeGreaterThan(15);
  });
});

describe('Timesheet Dashboard keeps attendance, leave and project hours apart', () => {
  test('Present stays Present, a leave row shows the real leave type, a contractor has no attendance or leave', async () => {
    const ctx = await seed();
    const dev = await ctx.person('Dev', { dept: ctx.it });
    const contractor = await ctx.person('Contractor', { dept: ctx.it, worker_type: 'contractor' });
    const sick = await prisma.leaveType.create({ data: { org_id: ctx.org.id, name: 'Sick Leave', paid: true, annual_quota: 12 } });
    const casual = await prisma.leaveType.create({ data: { org_id: ctx.org.id, name: 'Casual Leave', paid: true, annual_quota: 12 } });
    const att = (membership, date, status) => prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: membership.id, date: day(date), status, source: 'manual' } });
    const leave = (membership, type, date) => prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: membership.id, leave_type_id: type.id, from_date: day(date), to_date: day(date), status: 'approved' } });
    await att(dev.membership, '2026-09-07', 'present'); // manually marked Present, no leave anywhere
    await att(dev.membership, '2026-09-08', 'leave');
    await leave(dev.membership, sick, '2026-09-08');
    await att(dev.membership, '2026-09-09', 'present'); // Present AND an approved leave: flagged, never silently changed
    await leave(dev.membership, casual, '2026-09-09');
    // a contractor with junk attendance + project hours
    await att(contractor.membership, '2026-09-07', 'present');
    const project = await addProject(ctx, 'Proj');
    await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: contractor.membership.id, account_id: project.id, date: day('2026-09-07'), hours: 6, status: 'approved' } });

    const cal = async (m) => (await authed(request(app).get(api('/timesheets/dashboard/calendar')), ctx.adminToken).query({ ...SEP, org_membership_id: m.membership.id })).body.data;
    const days = Object.fromEntries((await cal(dev)).days.map((d) => [d.date, d]));
    expect(days['2026-09-07']).toMatchObject({ attendance_status: 'present', attendance_label: null, leave: null });
    expect(days['2026-09-08']).toMatchObject({ attendance_status: 'leave', attendance_label: 'Sick Leave' });
    expect(days['2026-09-09']).toMatchObject({ attendance_status: 'present', attendance_conflict: true });
    expect(days['2026-09-09'].leave.name).toBe('Casual Leave');

    const c = await cal(contractor);
    expect(c.attendance_applicable).toBe(false);
    const cd = c.days.find((d) => d.date === '2026-09-07');
    expect(cd).toMatchObject({ attendance_status: null, leave: null, logged: 6 }); // only the project timesheet
  });

  test('the month lock of the Attendance Locks tab shows per person', async () => {
    const ctx = await seed();
    const a = await ctx.person('A', { dept: ctx.it });
    await ctx.person('B', { dept: ctx.it });
    await prisma.timesheetMonthLock.create({ data: { org_id: ctx.org.id, org_membership_id: a.membership.id, period_month: 9, period_year: 2026, locked_by: ctx.adminUser.id } });
    const people = (await authed(request(app).get(api('/timesheets/dashboard')), ctx.adminToken).query(SEP)).body.data.people;
    expect(people.find((p) => p.name === 'A').month_locked).toBe(true);
    expect(people.find((p) => p.name === 'B').month_locked).toBe(false);
  });
});

describe('bulk delete logs', () => {
  test('admin deletes exactly the selected logs with a reason; a member only deletes own pending ones; single delete still works', async () => {
    const ctx = await seed();
    const dev = await ctx.person('Dev', { dept: ctx.it });
    const other = await ctx.person('Other', { dept: ctx.it });
    const project = await addProject(ctx, 'Proj');
    const entry = (membership, date, status = 'submitted') => prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: membership.id, account_id: project.id, date: day(date), hours: 4, status } });
    const [e1, e2, e3, e4] = [await entry(dev.membership, '2026-09-01'), await entry(dev.membership, '2026-09-02'), await entry(dev.membership, '2026-09-03'), await entry(dev.membership, '2026-09-04')];
    const theirs = await entry(other.membership, '2026-09-01');
    const bulk = (token, body) => authed(request(app).post(api('/timesheets/entries/bulk-delete')), token).send(body);

    expect((await bulk(ctx.adminToken, { ids: [e1.id, e2.id] })).status).toBe(422); // an admin must give a reason
    const res = await bulk(ctx.adminToken, { ids: [e1.id, e2.id], reason: 'Duplicate logs' });
    expect(res.body.data.deleted.sort()).toEqual([e1.id, e2.id].sort());
    expect(await prisma.timesheetEntry.count({ where: { id: { in: [e1.id, e2.id] } } })).toBe(0);
    expect(await prisma.timesheetEntry.count({ where: { id: { in: [e3.id, e4.id, theirs.id] } } })).toBe(3); // nothing else touched

    // A member: own pending ok; someone else's and a decided one are refused.
    await prisma.timesheetEntry.update({ where: { id: e4.id }, data: { status: 'approved' } });
    const own = await bulk(dev.token, { ids: [e3.id, e4.id, theirs.id] });
    expect(own.body.data.deleted).toEqual([e3.id]);
    expect(own.body.data.failed.map((f) => f.id).sort()).toEqual([e4.id, theirs.id].sort());

    // The individual delete is unchanged.
    expect((await authed(request(app).delete(api(`/timesheets/entries/${theirs.id}`)), ctx.adminToken).send({ reason: 'single delete' })).status).toBe(200);
  });
});

describe('Finance billing follows the project duration', () => {
  test('a project is listed only for the months its start / end dates overlap, whoever is still allocated', async () => {
    const ctx = await seed();
    const dev = await ctx.person('Dev', { dept: ctx.it });
    const ended = await addProject(ctx, 'Beremote', { start: '2026-01-01', end: '2026-09-30' });
    const running = await addProject(ctx, 'Open Ended', { start: '2026-01-01' });
    const later = await addProject(ctx, 'Starts Nov', { start: '2026-11-15' });
    const spans = await addProject(ctx, 'Sep15-Oct15', { start: '2026-09-15', end: '2026-10-15' });
    // Beremote still has an open-ended allocation - the old code listed it for every later month because of that.
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: ended.id, org_membership_id: dev.membership.id, created_by: ctx.adminUser.id } });

    const names = async (period_month) => (await authed(request(app).get(api('/calculations/finance/month-projects')), ctx.adminToken).query({ period_month, period_year: 2026 })).body.data.projects.map((p) => p.project);
    expect(await names(8)).toEqual(expect.arrayContaining(['Beremote', 'Open Ended']));
    expect(await names(8)).not.toContain('Sep15-Oct15');
    expect(await names(9)).toEqual(expect.arrayContaining(['Beremote', 'Open Ended', 'Sep15-Oct15']));
    const oct = await names(10);
    expect(oct).toEqual(expect.arrayContaining(['Open Ended', 'Sep15-Oct15']));
    expect(oct).not.toContain('Beremote'); // ended 30 Sep
    const nov = await names(11);
    expect(nov).toEqual(expect.arrayContaining(['Open Ended', 'Starts Nov']));
    expect(nov).not.toContain('Beremote');
    expect(nov).not.toContain('Sep15-Oct15');
    expect(oct).not.toContain('Starts Nov');
    expect([ended.id, running.id, later.id, spans.id]).toHaveLength(4);

    // Live Analytics (Billing & sales) uses the same rule.
    const live = async (period_month) => (await authed(request(app).get(api('/analytics/billing')), ctx.adminToken).query({ period_month, period_year: 2026 })).body.data.projects.map((p) => p.project.name);
    expect(await live(11)).not.toContain('Beremote');
    expect(await live(9)).toContain('Beremote');
  });
});

describe('client billing comes from the project timesheet', () => {
  const AUG = { period_month: 8, period_year: 2026 };
  const billing = (ctx) => authed(request(app).get(api('/analytics/billing')), ctx.adminToken).query(AUG);

  test('client OT: Yes adds the OT hours to the bill, No does not; attendance and internal cost never change it', async () => {
    const ctx = await seed();
    const dev = await ctx.person('Dev', { dept: ctx.it });
    const yes = await addProject(ctx, 'Pays OT', { rate: 1000, overtime: true });
    const no = await addProject(ctx, 'No OT', { rate: 1000, overtime: false });
    for (const p of [yes, no]) {
      // 8 normal hours + 2 OT hours on one working day (Mon 3 Aug 2026).
      await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: dev.membership.id, account_id: p.id, date: day('2026-08-03'), hours: 8, overtime_hours: 2, status: 'approved', approved_by: ctx.adminUser.id } });
    }
    const amounts = async () => Object.fromEntries((await billing(ctx)).body.data.projects.map((r) => [r.project.name, r.amount]));
    const before = await amounts();
    expect(before['No OT']).toBe(8000); // OT = No: the 2 OT hours add nothing
    expect(before['Pays OT']).toBe(11000); // OT = Yes: 8 x 1000 + 2 x 1000 x 1.5

    // Attendance (even absent) and an internal cost rate leave the project bill untouched.
    await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: dev.membership.id, date: day('2026-08-03'), status: 'absent', source: 'manual' } });
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: yes.id, org_membership_id: dev.membership.id, created_by: ctx.adminUser.id, cost_rate_per_hr: 700 } });
    expect(await amounts()).toEqual(before);
  });

  test('monthly billing counts only the working days inside the project duration (calendar working days, 8-hour day)', async () => {
    const ctx = await seed();
    // August 2026 has 21 working days (105000 / 21 = 5000 a day). A project starting Mon 17 Aug has 11 of them.
    const project = await addProject(ctx, 'Monthly Co', { rate: 105000, rate_type: 'monthly', start: '2026-08-17' });
    const row = (await billing(ctx)).body.data.projects.find((p) => p.project.id === project.id);
    expect(row.amount).toBe(55000);
    expect(row.project.billable_day_hours ?? 8).toBe(8); // the client billing day is 8 hours by default
  });
});

describe('salary is calculated from attendance for everyone', () => {
  test('a non-IT person with no pay basis is paid from attendance; project timesheet hours change nothing; an unmarked day is unpaid', async () => {
    const ctx = await seed();
    const exec = await ctx.person('Exec Sales', { dept: ctx.hr }); // non-IT, pay_basis never set
    await prisma.salaryStructure.create({ data: { org_id: ctx.org.id, org_membership_id: exec.membership.id, effective_from: day('2026-01-01'), ctc: 198000, components: { basic: 198000 }, created_by: ctx.adminUser.id } });
    const project = await addProject(ctx, 'Proj');
    // 16h of approved project hours on every working day - must not pay anything or create overtime.
    const workdays = [];
    for (let d = 1; d <= 30; d += 1) { const t = new Date(Date.UTC(2026, 8, d)); if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) workdays.push(t.toISOString().slice(0, 10)); }
    await prisma.timesheetEntry.createMany({ data: workdays.map((date) => ({ org_id: ctx.org.id, org_membership_id: exec.membership.id, account_id: project.id, date: day(date), hours: 8, overtime_hours: 8, status: 'approved' })) });
    // Attendance: present on every working day except one that nobody marked.
    await prisma.attendanceRecord.createMany({ data: workdays.slice(1).map((date) => ({ org_id: ctx.org.id, org_membership_id: exec.membership.id, date: day(date), status: 'present', source: 'manual' })) });

    const res = await authed(request(app).get(api('/payroll/attendance-salary')), ctx.adminToken).query({ period_month: 9, period_year: 2026 });
    const line = res.body.data.lines.find((l) => l.name === 'Exec Sales');
    expect(line).toMatchObject({ pay_basis: 'attendance' });
    expect(line.breakdown).toMatchObject({ source: 'attendance', unmarked_days: 1, ot_approved_hours: 0 });
    expect(line.net).toBe(198000 - 9000); // one unmarked 9h day at Rs 1000 / hour
  });

  test('the Pay basis switch to "timesheet" is not available any more', async () => {
    const ctx = await seed();
    const dev = await ctx.person('Dev', { dept: ctx.it });
    const res = await authed(request(app).post(api('/payroll/pay-basis')), ctx.adminToken).send({ pay_basis: 'timesheet', org_membership_ids: [dev.membership.id], reason: 'try' });
    expect(res.status).toBe(422);
  });
});
