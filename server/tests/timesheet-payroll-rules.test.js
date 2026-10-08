// Attendance vs timesheet vs payroll: check-in/out is presence only; payroll
// is approved timesheet hours + approved overtime; pending is a projection;
// weeks run Sunday -> Saturday and lock; approved is final for the employee;
// admins correct history; company calendar vs client exceptions.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const { computeBreakdown } = require('../src/modules/payroll/payroll.service');
const salaryEngine = require('../src/modules/calculations/engines/salary.engine');
const workHours = require('../src/modules/timesheets/workHours.service');
const { todayIst } = require('../src/lib/istDate');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ymd = (d) => d.toISOString().slice(0, 10);
const DAY = 86400000;
// September 2026: 30 days, 8 weekend days -> 22 working days.
const SEPT = { period_start: new Date(Date.UTC(2026, 8, 1)), period_end: new Date(Date.UTC(2026, 8, 30)), days_in_month: 30 };
const septWorkingDays = () => {
  const out = [];
  for (let d = 1; d <= 30; d += 1) {
    const date = new Date(Date.UTC(2026, 8, d));
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) out.push(ymd(date));
  }
  return out;
};
// Every working day approved at 9h, then `overrides` per date.
function hoursMap(overrides = {}) {
  const map = new Map(septWorkingDays().map((k) => [k, { approved: 9, pending: 0 }]));
  for (const [k, v] of Object.entries(overrides)) map.set(k, v);
  return map;
}
const breakdown = (args) => computeBreakdown({ ...SEPT, ctc: 198000, shiftHours: 9, ...args });

describe('payroll = approved timesheet hours + approved OT (never check-in/out)', () => {
  test('Scenario 16: 22 company working days x 9h shift = 198h expected capacity', () => {
    const { breakdown: b, net, deductions } = breakdown({ hoursByDate: hoursMap() });
    expect(b).toMatchObject({ working_days: 22, expected_hours: 198, hourly_rate: 1000, paid_hours: 198, deficit_hours: 0 });
    expect(net).toBe(198000);
    expect(deductions).toBe(0);
  });

  test('Scenario 1: checked in 9am-9pm (12h presence) but timesheet 9h -> paid 9h, no OT', () => {
    const attendanceByDate = new Map([['2026-09-01', { status: 'present', check_in_at: new Date('2026-09-01T03:30:00Z'), check_out_at: new Date('2026-09-01T15:30:00Z'), overtime_minutes: 180 }]]);
    const { breakdown: b, net } = breakdown({ hoursByDate: hoursMap(), attendanceByDate });
    expect(b.ot_approved_hours).toBe(0);
    expect(b.ot_amount).toBe(0);
    expect(net).toBe(198000);
    // Presence alone never pays: a present day with no timesheet is a deficit.
    const noSheet = breakdown({ hoursByDate: hoursMap({ '2026-09-01': { approved: 0, pending: 0 } }), attendanceByDate });
    expect(noSheet.breakdown.deficit_hours).toBe(9);
    expect(noSheet.net).toBe(189000);
  });

  test('Scenario 2: 7h approved -> 7 paid + 2h deficit', () => {
    const { breakdown: b, net } = breakdown({ hoursByDate: hoursMap({ '2026-09-01': { approved: 7, pending: 0 } }) });
    expect(b.deficit_hours).toBe(2);
    expect(net).toBe(196000);
  });

  test('Scenarios 3-5: 12h -> 9 normal + 3 OT pending (projected only); approved OT paid; rejected OT not', () => {
    const hoursByDate = hoursMap({ '2026-09-02': { approved: 12, pending: 0 } });
    const pending = breakdown({ hoursByDate, overtimeByDate: new Map([['2026-09-02', { hours: 3, status: 'pending' }]]) });
    expect(pending.net).toBe(198000);
    expect(pending.breakdown).toMatchObject({ ot_approved_hours: 0, ot_pending_hours: 3, ot_amount: 0, projected_net: 201000, pending_amount: 3000 });

    const approved = breakdown({ hoursByDate, overtimeByDate: new Map([['2026-09-02', { hours: 3, status: 'approved' }]]) });
    expect(approved.breakdown).toMatchObject({ ot_approved_hours: 3, ot_amount: 3000 });
    expect(approved.net).toBe(201000);
    expect(approved.gross).toBe(201000);

    const rejected = breakdown({ hoursByDate, overtimeByDate: new Map([['2026-09-02', { hours: 3, status: 'rejected' }]]) });
    expect(rejected.net).toBe(198000);
    expect(rejected.breakdown).toMatchObject({ ot_amount: 0, projected_net: 198000, ot_rejected_hours: 3 });

    // Comp off: time off in lieu, not OT pay.
    const compOff = breakdown({ hoursByDate, overtimeByDate: new Map([['2026-09-02', { hours: 3, status: 'comp_off' }]]) });
    expect(compOff.net).toBe(198000);
    expect(compOff.breakdown.comp_off_days).toBe(1);
  });

  test('Scenario 6: pending hours are not actual payroll, only the projection', () => {
    const { breakdown: b, net } = breakdown({ hoursByDate: hoursMap({ '2026-09-03': { approved: 0, pending: 9 } }) });
    expect(net).toBe(189000);
    expect(b).toMatchObject({ pending_hours: 9, projected_net: 198000, pending_amount: 9000 });
  });

  test('a paid leave day counts as the full shift; weekend hours are overtime only', () => {
    const { breakdown: b, net } = breakdown({
      hoursByDate: hoursMap({ '2026-09-04': { approved: 0, pending: 0 }, '2026-09-06': { approved: 5, pending: 0 } }),
      leaveRanges: [{ from_date: new Date('2026-09-04'), to_date: new Date('2026-09-04'), paid: true }],
      overtimeByDate: new Map([['2026-09-06', { hours: 5, status: 'approved' }]]),
    });
    expect(b.paid_leave_days).toBe(1);
    expect(b.ot_approved_hours).toBe(5);
    expect(net).toBe(203000);
  });

  test('a client working Sunday marked on the calendar adds a working day; a company holiday removes one', () => {
    const { breakdown: b } = breakdown({ hoursByDate: new Map(), workingSet: new Set(['2026-09-06']), holidaySet: new Set(['2026-09-01']) });
    expect(b.working_days).toBe(22);
    expect(b.expected_hours).toBe(198);
  });
});

async function person(org, { role = 'employee', managerMembership } = {}) {
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role });
  if (managerMembership) await prisma.orgMembership.update({ where: { id: membership.id }, data: { manager_id: managerMembership.id } });
  const { access_token } = await loginAs(user);
  return { user, membership, token: access_token };
}

// The most recent date <= today with the given weekday test (IST calendar).
function recent(test) {
  let d = todayIst();
  while (!test(d)) d = new Date(d.getTime() - DAY);
  return ymd(d);
}
const recentWeekday = () => recent((d) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5);
const recentSunday = () => recent((d) => d.getUTCDay() === 0);

describe('timesheet rules end to end', () => {
  let projectId;
  async function seed() {
    const org = await createOrg();
    const admin = await person(org, { role: 'admin' });
    const manager = await person(org);
    const emp = await person(org, { managerMembership: manager.membership });
    const project = await prisma.account.create({ data: { org_id: org.id, name: 'Project', type: 'client', stage: 'active', owner_id: admin.user.id } });
    projectId = project.id;
    await prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: project.id, org_membership_id: emp.membership.id, created_by: admin.user.id } });
    return { org, admin, manager, emp, project };
  }
  const post = (token, path, body) => {
    const withProject = body && path === '/entries' && !body.account_id ? { ...body, account_id: projectId } : body;
    return authed(request(app).post(`/api/v1/timesheets${path}`), token).send(withProject);
  };
  const patch = (token, path, body) => authed(request(app).patch(`/api/v1/timesheets${path}`), token).send(body);
  const del = (token, path, body = {}) => authed(request(app).delete(`/api/v1/timesheets${path}`), token).send(body);
  const week = async (token, date, member) => (await authed(request(app).get(`/api/v1/timesheets/week?date=${date}${member ? `&org_membership_id=${member}` : ''}`), token)).body.data;

  // Disabled: salary is calculated from attendance for everyone; the timesheet salary basis is switched off.
  test.skip('Scenarios 3, 7, 8, 4: 12h -> 3h OT pending; editable while pending; approved is final; manager approves OT', async () => {
    const { org, manager, emp } = await seed();
    const date = recentWeekday();
    const created = await post(emp.token, '/entries', { date, hours: 12 });
    expect(created.status).toBe(201);

    let day = (await week(emp.token, date)).days.find((d) => d.date === date);
    expect(day).toMatchObject({ expected: 9, logged: 12, pending: 12, approved: 0, ot_hours: 3, ot_status: 'pending', status: 'pending', day_type: 'working' });

    // Scenario 7: pending + unlocked -> the employee can edit. 7h -> no OT, 2h deficit.
    expect((await patch(emp.token, `/entries/${created.body.data.id}`, { hours: 7 })).status).toBe(200);
    day = (await week(emp.token, date)).days.find((d) => d.date === date);
    expect(day).toMatchObject({ ot_hours: 0, ot_status: null, deficit: 2 });
    expect(await prisma.timesheetDayOvertime.count()).toBe(0);
    await patch(emp.token, `/entries/${created.body.data.id}`, { hours: 12 });

    // Manager approves the hours; the employee can no longer touch them (Scenario 8).
    expect((await post(manager.token, `/entries/${created.body.data.id}/decision`, { status: 'approved' })).status).toBe(200);
    expect((await patch(emp.token, `/entries/${created.body.data.id}`, { hours: 9 })).status).toBe(409);
    expect((await del(emp.token, `/entries/${created.body.data.id}`)).status).toBe(409);

    // The OT still waits for its own decision; the employee can't decide it.
    const inbox = (await authed(request(app).get('/api/v1/timesheets/approvals/pending'), manager.token)).body.data;
    expect(inbox.overtime).toHaveLength(1);
    const otId = inbox.overtime[0].id;
    expect((await post(emp.token, `/overtime/${otId}/decision`, { status: 'approved' })).status).toBe(403);
    expect((await post(manager.token, `/overtime/${otId}/decision`, { status: 'rejected' })).status).toBe(422); // reason required
    expect((await post(manager.token, `/overtime/${otId}/decision`, { status: 'approved' })).status).toBe(200);
    // A manager decides once.
    expect((await post(manager.token, `/overtime/${otId}/decision`, { status: 'rejected', reason: 'changed mind' })).status).toBe(409);

    day = (await week(manager.token, date, emp.membership.id)).days.find((d) => d.date === date);
    expect(day).toMatchObject({ approved: 12, normal_approved: 9, ot_status: 'approved', ot_payable: 3, status: 'approved' });

    // Payroll reads the same: 9 normal + 3 approved OT for that day.
    const [y, m] = date.split('-').map(Number);
    await prisma.salaryStructure.create({ data: { org_id: org.id, org_membership_id: emp.membership.id, effective_from: new Date('2020-01-01'), ctc: 100000, components: {}, created_by: manager.user.id } });
    const salary = await salaryEngine.computeSalary(org.id, { period_month: m, period_year: y });
    const line = salary.lines.find((l) => l.org_membership_id === emp.membership.id);
    expect(line.breakdown).toMatchObject({ source: 'approved_timesheets', ot_approved_hours: 3, approved_hours: 12 });
  });

  test('Scenarios 9, 10, 12: a locked week is read-only for the employee; the manager still decides; the admin corrects anything', async () => {
    const { admin, manager, emp } = await seed();
    const date = recentWeekday();
    const pending = await post(emp.token, '/entries', { date, hours: 8 });
    await post(admin.token, '/locks', { date });

    expect((await post(emp.token, '/entries', { date, hours: 1 })).status).toBe(409);
    expect((await patch(emp.token, `/entries/${pending.body.data.id}`, { hours: 9 })).status).toBe(409);
    expect((await del(emp.token, `/entries/${pending.body.data.id}`)).status).toBe(409);
    expect((await week(emp.token, date)).days.find((d) => d.date === date).locked).toBe(true);

    // Scenario 10: the manager can still approve a locked week's pending entry.
    expect((await post(manager.token, `/entries/${pending.body.data.id}/decision`, { status: 'approved' })).status).toBe(200);

    // Scenario 12: admin adds, re-decides, corrects and deletes on the locked day.
    const added = await post(admin.token, '/entries/admin', { org_membership_id: emp.membership.id, date, hours: 2, reason: 'Missed support call' });
    expect(added.status).toBe(201);
    expect(added.body.data.entry.status).toBe('approved');
    expect((await patch(admin.token, `/entries/${pending.body.data.id}/admin`, { status: 'rejected', reason: 'Wrong day' })).status).toBe(200);
    expect((await patch(admin.token, `/entries/${added.body.data.entry.id}/admin`, { hours: 3, reason: 'Was 3h' })).status).toBe(200);
    expect((await del(admin.token, `/entries/${added.body.data.entry.id}`, { reason: 'Duplicate' })).status).toBe(200);
    // Employees (and managers) can't use the admin endpoints.
    expect((await post(manager.token, '/entries/admin', { org_membership_id: emp.membership.id, date, hours: 2, reason: 'x x x' })).status).toBe(403);
  });

  test('Scenario 11: a pending entry of a locked week goes to Admin Review after the grace period', () => {
    const sat = new Date('2026-09-19'); // week Sun 13 - Sat 19, locks Sun 20
    expect(workHours.needsAdminReview(new Date('2026-09-15'), new Date('2026-09-20'))).toBe(false);
    const reviewDay = new Date(sat.getTime() + (1 + workHours.ADMIN_REVIEW_GRACE_DAYS) * DAY);
    expect(workHours.needsAdminReview(new Date('2026-09-15'), reviewDay)).toBe(true);
  });

  // Disabled: salary is calculated from attendance for everyone; the timesheet salary basis is switched off.
  test.skip('Scenarios 13-15: Sunday work is logged as OT (or comp off); client exceptions show without changing the company calendar', async () => {
    const { org, admin, manager, emp } = await seed();
    const sunday = recentSunday();
    const client = await prisma.account.create({ data: { org_id: org.id, name: 'Weekend Client', type: 'client', stage: 'active', owner_id: admin.user.id, is_project: true } });
    const clientCal = await prisma.calendar.create({ data: { org_id: org.id, name: 'Client US', kind: 'client' } });
    await prisma.projectCalendar.create({ data: { org_id: org.id, account_id: client.id, calendar_id: clientCal.id } });
    // Client works this Sunday — an exception on the CLIENT calendar only.
    const exception = await authed(request(app).post(`/api/v1/calendars/${clientCal.id}/holidays`), admin.token).send({ date: sunday, label: 'Client release', is_working_day: true });
    expect(exception.status).toBe(201);

    expect((await post(emp.token, '/entries', { date: sunday, hours: 6, account_id: client.id })).status).toBe(201);
    const day = (await week(emp.token, sunday)).days.find((d) => d.date === sunday);
    expect(day).toMatchObject({ day_type: 'weekend', expected: 0, ot_hours: 6, ot_status: 'pending', comp_off_eligible: true });
    expect(day.client_flags).toEqual([expect.objectContaining({ type: 'client_working', project: 'Weekend Client' })]);

    const otId = (await authed(request(app).get('/api/v1/timesheets/approvals/pending'), manager.token)).body.data.overtime[0].id;
    expect((await post(manager.token, `/overtime/${otId}/decision`, { status: 'comp_off' })).status).toBe(200);
    expect((await week(emp.token, sunday)).days.find((d) => d.date === sunday).ot_status).toBe('comp_off');

    // Company holiday on a weekday: expected 0 there; a client holiday elsewhere is only a flag.
    const weekday = recentWeekday();
    const company = await prisma.calendar.create({ data: { org_id: org.id, name: 'Ahmedabad', is_default: true } });
    await prisma.calendarHoliday.create({ data: { calendar_id: company.id, date: new Date(weekday), label: 'Company holiday' } });
    const holidayDay = (await week(emp.token, weekday)).days.find((d) => d.date === weekday);
    expect(holidayDay).toMatchObject({ day_type: 'company_holiday', expected: 0, day_label: 'Company holiday' });
  });

  test('a manager sees only direct reports\' weeks; a stranger is refused', async () => {
    const { org, manager, emp } = await seed();
    const stranger = await person(org);
    const date = recentWeekday();
    expect((await authed(request(app).get(`/api/v1/timesheets/week?date=${date}&org_membership_id=${emp.membership.id}`), manager.token)).status).toBe(200);
    expect((await authed(request(app).get(`/api/v1/timesheets/week?date=${date}&org_membership_id=${emp.membership.id}`), stranger.token)).status).toBe(403);
    const w = await week(emp.token, date);
    expect(w.days).toHaveLength(7);
    expect(new Date(w.week_start).getUTCDay()).toBe(0);
    expect(new Date(w.week_end).getUTCDay()).toBe(6);
  });
});
