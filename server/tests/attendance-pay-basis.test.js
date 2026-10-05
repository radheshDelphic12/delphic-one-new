// Phase 2 of the client / project timesheet redesign (docs/features/CLIENT-PROJECT-TIMESHEET.md):
// a person's pay basis decides what their salary is worked out from. 'timesheet' (default) is the
// original rule; 'attendance' pays from the check-in / half day / absent marking and approved leave,
// and the project timesheet then only feeds client billing.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const { computeBreakdown } = require('../src/modules/payroll/payroll.service');
const calculations = require('../src/modules/calculations/calculations.service');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ymd = (d) => d.toISOString().slice(0, 10);
// September 2026: 22 working days; 9h shift -> 198h expected; CTC 198000 -> Rs 1000 / hour.
const SEPT = { period_start: new Date(Date.UTC(2026, 8, 1)), period_end: new Date(Date.UTC(2026, 8, 30)), days_in_month: 30 };
const DAYS = [];
for (let d = 1; d <= 30; d += 1) {
  const date = new Date(Date.UTC(2026, 8, d));
  if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) DAYS.push(ymd(date));
}
const marks = (status = 'present', overrides = {}) => {
  const map = new Map(DAYS.map((k) => [k, { status }]));
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) map.delete(k);
    else map.set(k, { status: v });
  }
  return map;
};
const pay = (args) => computeBreakdown({ ...SEPT, ctc: 198000, shiftHours: 9, payBasis: 'attendance', ...args });

describe('attendance pay basis - the computation', () => {
  test('every working day marked present = the full month; the breakdown says it was paid from attendance', () => {
    const { breakdown: b, net } = pay({ attendanceByDate: marks() });
    expect(net).toBe(198000);
    expect(b).toMatchObject({ source: 'attendance', pay_basis: 'attendance', working_days: 22, paid_hours: 198, deficit_hours: 0, unmarked_days: 0, absent_days: 0, half_days: 0 });
  });

  test('half days pay half the shift, an absence pays nothing: 19 present + 2 half + 1 absent = 180h of 198h', () => {
    const attendanceByDate = marks('present', { [DAYS[3]]: 'half_day', [DAYS[4]]: 'half_day', [DAYS[10]]: 'absent' });
    const { breakdown: b, net, deductions } = pay({ attendanceByDate });
    // 19 x 9 + 2 x 4.5 = 180h paid; deficit 18h x Rs 1000.
    expect(b).toMatchObject({ paid_hours: 180, deficit_hours: 18, half_days: 2, absent_days: 1, unmarked_days: 0 });
    expect(deductions).toBe(18000);
    expect(net).toBe(180000);
  });

  test('a working day nobody marked is unpaid and listed as unmarked (it never silently pays)', () => {
    const { breakdown: b, net } = pay({ attendanceByDate: marks('present', { [DAYS[6]]: null }) });
    expect(b).toMatchObject({ unmarked_days: 1, absent_days: 0, deficit_hours: 9 });
    expect(net).toBe(189000);
  });

  test('project timesheet hours never matter: 16h logged on a day is not overtime and nothing is paid from them', () => {
    const hoursByDate = new Map(DAYS.map((k) => [k, { approved: 16, pending: 0 }])); // 8h + 8h on two projects, every day
    const overtimeByDate = new Map([[DAYS[0], { hours: 7, status: 'approved' }]]);
    const withSheets = pay({ attendanceByDate: marks(), hoursByDate, overtimeByDate });
    expect(withSheets.net).toBe(198000);
    expect(withSheets.breakdown).toMatchObject({ ot_approved_hours: 0, ot_amount: 0, approved_hours: 198 });
    // ... and with no timesheet at all the pay is the same.
    expect(pay({ attendanceByDate: marks() }).net).toBe(198000);
    // The timesheet basis, by contrast, is driven by those hours (this is what the basis switches).
    expect(computeBreakdown({ ...SEPT, ctc: 198000, shiftHours: 9, hoursByDate: new Map(), attendanceByDate: marks() }).net).toBeLessThan(198000);
  });

  test('approved leave covers an unmarked day: paid leave pays, unpaid leave does not - neither counts as unmarked', () => {
    const paidDay = DAYS[5];
    const unpaidDay = DAYS[8];
    const leaveRanges = [
      { from_date: new Date(paidDay), to_date: new Date(paidDay), is_half_day: false, paid: true },
      { from_date: new Date(unpaidDay), to_date: new Date(unpaidDay), is_half_day: false, paid: false },
    ];
    const { breakdown: b, net } = pay({ attendanceByDate: marks('present', { [paidDay]: null, [unpaidDay]: null }), leaveRanges });
    expect(b).toMatchObject({ unmarked_days: 0, paid_leave_days: 1, unpaid_leave_days: 1, deficit_hours: 9 });
    expect(net).toBe(189000);
  });

  test('a half-day paid leave plus a half-day presence is one full paid day (leave and attendance never double count)', () => {
    const day = DAYS[2];
    const leaveRanges = [{ from_date: new Date(day), to_date: new Date(day), is_half_day: true, paid: true }];
    const { breakdown: b, net } = pay({ attendanceByDate: marks('present', { [day]: 'half_day' }), leaveRanges });
    expect(b).toMatchObject({ paid_leave_hours: 4.5, deficit_hours: 0, unmarked_days: 0 });
    expect(net).toBe(198000);
  });

  test('working days before the joining date are unpaid but not unmarked', () => {
    // September has 22 working days. Joining on the 21st leaves the first 20 outside employment.
    const joinedAt = new Date(`${DAYS[20]}T15:30:00.000Z`);
    const afterJoin = new Map(DAYS.slice(20).map((k) => [k, { status: 'present' }]));
    const { breakdown: b, net } = pay({ attendanceByDate: afterJoin, joinedAt });
    expect(b).toMatchObject({ unmarked_days: 0, paid_hours: 18, deficit_hours: 180, working_days: 22 });
    expect(net).toBe(18000);
    // A working day after joining that nobody marked still blocks the lock.
    const missed = pay({ attendanceByDate: new Map([[DAYS[20], { status: 'present' }]]), joinedAt });
    expect(missed.breakdown.unmarked_days).toBe(1);
  });

  test('working days after the leaving date are unpaid but not unmarked', () => {
    const leftAt = new Date(DAYS[1]);
    const whileEmployed = new Map(DAYS.slice(0, 2).map((k) => [k, { status: 'present' }]));
    const { breakdown: b, net } = pay({ attendanceByDate: whileEmployed, leftAt });
    expect(b).toMatchObject({ unmarked_days: 0, paid_hours: 18, deficit_hours: 180 });
    expect(net).toBe(18000);
  });

  test('live "as of" mode: days after the date are upcoming, not unmarked', () => {
    const asOf = new Date(DAYS[9]);
    const attendanceByDate = new Map(DAYS.slice(0, 10).map((k) => [k, { status: 'present' }]));
    const { breakdown: b } = pay({ attendanceByDate, asOf });
    expect(b).toMatchObject({ unmarked_days: 0, upcoming_days: 12, deficit_hours: 0 });
  });
});

describe('attendance pay basis - admin controls and integration', () => {
  async function seed() {
    const org = await createOrg();
    const it = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
    const sales = await prisma.department.create({ data: { org_id: org.id, name: 'Sales' } });
    const adminUser = await createUser({ role: 'admin' });
    await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
    const adminToken = (await loginAs(adminUser)).access_token;
    const person = async (name, department) => {
      const user = await createUser({ role: 'recruiter', name });
      await prisma.user.update({ where: { id: user.id }, data: { department_id: department.id } });
      const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter', department_id: department.id, joined_at: new Date('2026-01-01') });
      await prisma.salaryStructure.create({ data: { org_id: org.id, org_membership_id: membership.id, effective_from: new Date('2026-01-01'), ctc: 198000, components: { basic: 198000 }, created_by: adminUser.id } });
      return { user, membership, token: (await loginAs(user)).access_token };
    };
    const mark = (member, dates, status = 'present') =>
      prisma.attendanceRecord.createMany({ data: dates.map((d) => ({ org_id: org.id, org_membership_id: member.membership.id, date: new Date(d), status })) });
    return { org, it, sales, adminUser, adminToken, person, mark };
  }
  const SEP = { period_month: 9, period_year: 2026 };

  // Disabled: salary is calculated from attendance for everyone; the timesheet salary basis is switched off.
  test.skip('comparison shows both nets per person before anything is switched; switching IT to attendance is audited and moves only IT', async () => {
    const ctx = await seed();
    const dev = await ctx.person('Dev IT', ctx.it);
    const exec = await ctx.person('Exec Sales', ctx.sales);
    await ctx.mark(dev, DAYS.filter((d) => d !== DAYS[4])); // one unmarked day
    await ctx.mark(exec, DAYS);

    const compare = await authed(request(app).get('/api/v1/payroll/pay-basis'), ctx.adminToken).query(SEP);
    expect(compare.status).toBe(200);
    const row = compare.body.data.rows.find((r) => r.name === 'Dev IT');
    expect(row).toMatchObject({ current_basis: 'timesheet', is_it: true, attendance: { unmarked_days: 1 } });
    expect(row.attendance_net).toBe(189000); // 21 of 22 days
    expect(row.timesheet_net).toBe(0); // no approved timesheet hours at all
    expect(compare.body.data.totals.unmarked_days).toBe(1);

    expect((await authed(request(app).post('/api/v1/payroll/pay-basis'), ctx.adminToken).send({ pay_basis: 'attendance', it_department: true })).status).toBe(422); // reason is required
    const set = await authed(request(app).post('/api/v1/payroll/pay-basis'), ctx.adminToken).send({ pay_basis: 'attendance', it_department: true, reason: 'IT is paid from attendance from September' });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ pay_basis: 'attendance', changed: 1 });
    expect((await prisma.orgMembership.findUnique({ where: { id: dev.membership.id } })).pay_basis).toBe('attendance');
    expect((await prisma.orgMembership.findUnique({ where: { id: exec.membership.id } })).pay_basis).toBeNull();
    expect(await prisma.auditLog.count({ where: { org_id: ctx.org.id, action: 'pay_basis_set' } })).toBe(1);

    // The salary now follows the basis, and says so.
    const salary = await authed(request(app).get('/api/v1/payroll/attendance-salary'), ctx.adminToken).query(SEP);
    const devLine = salary.body.data.lines.find((l) => l.name === 'Dev IT');
    expect(devLine).toMatchObject({ net: 189000, pay_basis: 'attendance' });
    expect(devLine.breakdown).toMatchObject({ source: 'attendance', unmarked_days: 1 });
    expect(salary.body.data.lines.find((l) => l.name === 'Exec Sales')).toMatchObject({ pay_basis: 'timesheet' });

    // Switching back is the same call; only admins can switch.
    expect((await authed(request(app).post('/api/v1/payroll/pay-basis'), dev.token).send({ pay_basis: 'timesheet', org_membership_ids: [dev.membership.id], reason: 'sneaky' })).status).toBeGreaterThanOrEqual(401);
    expect((await authed(request(app).post('/api/v1/payroll/pay-basis'), ctx.adminToken).send({ pay_basis: 'timesheet', org_membership_ids: [dev.membership.id], reason: 'Back to timesheet pay' })).body.data.changed).toBe(1);
  });

  test('an unmarked working day blocks locking that person\'s salary until it is marked', async () => {
    const ctx = await seed();
    const dev = await ctx.person('Dev IT', ctx.it);
    await prisma.orgMembership.update({ where: { id: dev.membership.id }, data: { pay_basis: 'attendance' } });
    await ctx.mark(dev, DAYS.filter((d) => d !== DAYS[4]));

    const blocked = await calculations.computeLive(ctx.org.id, 'salary_employee', dev.membership.id, SEP);
    expect(blocked.readiness.can_lock).toBe(false);
    expect(blocked.readiness.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unmarked_attendance', count: 1 })]));

    await ctx.mark(dev, [DAYS[4]], 'present');
    const ready = await calculations.computeLive(ctx.org.id, 'salary_employee', dev.membership.id, SEP);
    expect(ready.readiness.blockers.some((b) => b.code === 'unmarked_attendance')).toBe(false);
    expect(ready.amount).toBe(198000);
  });

  // Disabled: salary is calculated from attendance for everyone; the timesheet salary basis is switched off.
  test.skip('an attendance-paid person logs 8h + 8h on two projects: no overtime ticket is created; a timesheet-paid person logging 12h still gets one', async () => {
    const ctx = await seed();
    const dev = await ctx.person('Dev IT', ctx.it);
    const other = await ctx.person('Dev Two', ctx.it);
    await prisma.orgMembership.update({ where: { id: dev.membership.id }, data: { pay_basis: 'attendance' } });
    const project = (name) => prisma.account.create({ data: { org_id: ctx.org.id, type: 'client', name, stage: 'active', owner_id: ctx.adminUser.id, origin_owner_id: ctx.adminUser.id } });
    const [a, b] = [await project('Project A'), await project('Project B')];
    for (const person of [dev, other]) {
      for (const p of [a, b]) await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: p.id, org_membership_id: person.membership.id, billable_hours_per_day: 12, created_by: ctx.adminUser.id } });
    }
    const day = '2026-07-01';
    const log = (person, account, hours) => authed(request(app).post('/api/v1/timesheets/entries'), person.token).send({ date: day, account_id: account.id, hours });

    expect((await log(dev, a, 8)).status).toBe(201);
    expect((await log(dev, b, 8)).status).toBe(201);
    expect(await prisma.timesheetDayOvertime.count({ where: { org_membership_id: dev.membership.id } })).toBe(0);

    expect((await log(other, a, 12)).status).toBe(201);
    expect(await prisma.timesheetDayOvertime.count({ where: { org_membership_id: other.membership.id } })).toBe(1);
  });
});
