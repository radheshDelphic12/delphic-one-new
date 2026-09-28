const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createOrg,
  createOrgMembership,
  authed,
} = require('./helpers');
const { computeLateMinutes } = require('../src/modules/attendance/attendance.service');
const { pickCalendarId } = require('../src/modules/calendars/calendars.service');
const payrollDraft = require('../src/jobs/payrollDraft');

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
  const adminToken = (await loginAs(admin)).access_token;

  const user = await createUser({ role: 'recruiter' });
  const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter' });
  const empToken = (await loginAs(user)).access_token;

  const usClient = await prisma.account.create({ data: { type: 'client', name: 'US Client', stage: 'active', owner_id: admin.id, org_id: org.id } });
  const inClient = await prisma.account.create({ data: { type: 'client', name: 'India Client', stage: 'active', owner_id: admin.id, org_id: org.id } });
  return { org, admin, adminToken, user, membership, empToken, usClient, inClient };
}

async function makeCalendar(adminToken, body, holidays = []) {
  const res = await authed(request(app).post('/api/v1/calendars'), adminToken).send(body);
  expect(res.status).toBe(201);
  for (const [date, label] of holidays) {
    const h = await authed(request(app).post(`/api/v1/calendars/${res.body.data.id}/holidays`), adminToken).send({ date, label });
    expect(h.status).toBe(201);
  }
  return res.body.data;
}

function logHours(token, body) {
  return authed(request(app).post('/api/v1/timesheets/entries'), token).send(body);
}

describe('multi-project timesheet allocation', () => {
  test('4h on Project A + 4h on Project B in one day is accepted; the 24h/day cap spans projects', async () => {
    const { empToken, usClient, inClient } = await seed();
    expect((await logHours(empToken, { date: '2026-09-01', account_id: usClient.id, hours: 4 })).status).toBe(201);
    expect((await logHours(empToken, { date: '2026-09-01', account_id: inClient.id, hours: 4 })).status).toBe(201);
    const over = await logHours(empToken, { date: '2026-09-01', account_id: inClient.id, hours: 16.5 });
    expect(over.status).toBe(422);
  });

  test('editing an entry cannot push the day past 24h (no bypass via PATCH)', async () => {
    const { empToken, usClient, inClient } = await seed();
    await logHours(empToken, { date: '2026-09-01', account_id: usClient.id, hours: 20 });
    const small = await logHours(empToken, { date: '2026-09-01', account_id: inClient.id, hours: 2 });
    const patch = await authed(request(app).patch(`/api/v1/timesheets/entries/${small.body.data.id}`), empToken).send({ hours: 6 });
    expect(patch.status).toBe(422);
    const ok = await authed(request(app).patch(`/api/v1/timesheets/entries/${small.body.data.id}`), empToken).send({ hours: 4 });
    expect(ok.status).toBe(200);
  });

  test('a regularization ticket cannot push the day past 24h either', async () => {
    const { adminToken, empToken, usClient, inClient } = await seed();
    await logHours(empToken, { date: '2026-09-02', account_id: usClient.id, hours: 20 });
    const small = await logHours(empToken, { date: '2026-09-02', account_id: inClient.id, hours: 2 });
    await authed(request(app).post('/api/v1/timesheets/locks'), adminToken).send({ date: '2026-09-02' });
    const ticket = await authed(request(app).post(`/api/v1/timesheets/entries/${small.body.data.id}/regularization-tickets`), empToken)
      .send({ requested_change: { hours: 8 }, reason: 'forgot hours' });
    expect(ticket.status).toBe(201);
    const decide = await authed(request(app).post(`/api/v1/timesheets/regularization-tickets/${ticket.body.data.id}/decision`), adminToken)
      .send({ status: 'approved' });
    expect(decide.status).toBe(422);
    const entry = await prisma.timesheetEntry.findUnique({ where: { id: small.body.data.id } });
    expect(Number(entry.hours)).toBe(2);
  });
});

describe('timesheets follow the PROJECT calendar', () => {
  test("a US-client holiday no longer blocks logging on that project — it's allowed and flagged as holiday overtime, scoped to that project only", async () => {
    const { org, adminToken, empToken, membership, usClient, inClient } = await seed();
    const location = await prisma.location.create({ data: { org_id: org.id, name: 'Ahmedabad' } });
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { location_id: location.id } });

    const office = await makeCalendar(adminToken, { name: 'Ahmedabad Office', kind: 'internal', location_id: location.id }, [['2026-08-15', 'Independence Day']]);
    const usCal = await makeCalendar(adminToken, { name: 'US Client Calendar', kind: 'client' }, [['2026-07-03', 'Independence Day (observed)']]);
    expect(office.location.name).toBe('Ahmedabad');

    const map = await authed(request(app).post(`/api/v1/calendars/${usCal.id}/assign`), adminToken)
      .send({ org_membership_id: membership.id, account_id: usClient.id });
    expect(map.status).toBe(200);

    // US project: July 3 is allowed, flagged as holiday overtime with the holiday named.
    const onHoliday = await logHours(empToken, { date: '2026-07-03', account_id: usClient.id, hours: 8 });
    expect(onHoliday.status).toBe(201);
    expect(onHoliday.body.data.is_holiday_overtime).toBe(true);
    expect(onHoliday.body.data.holiday_label).toContain('Independence Day (observed)');
    expect(onHoliday.body.data.holiday_label).toContain('US Client Calendar');

    // US project on an Indian holiday: an ordinary entry — the project calendar governs, not the office.
    const usOnIndianHoliday = await logHours(empToken, { date: '2026-08-15', account_id: usClient.id, hours: 8 });
    expect(usOnIndianHoliday.status).toBe(201);
    expect(usOnIndianHoliday.body.data.is_holiday_overtime).toBe(false);

    // India project (no project mapping) falls back to the employee's office calendar:
    // Aug 15 is flagged overtime there, Jul 3 (a US-only holiday) is an ordinary entry.
    const inOnOfficeHoliday = await logHours(empToken, { date: '2026-08-15', account_id: inClient.id, hours: 4 });
    expect(inOnOfficeHoliday.status).toBe(201);
    expect(inOnOfficeHoliday.body.data.is_holiday_overtime).toBe(true);
    expect(inOnOfficeHoliday.body.data.holiday_label).toContain('Independence Day');
    const inOrdinary = await logHours(empToken, { date: '2026-07-03', account_id: inClient.id, hours: 4 });
    expect(inOrdinary.status).toBe(201);
    expect(inOrdinary.body.data.is_holiday_overtime).toBe(false);
  });

  test('calendar creation validates the location belongs to the org', async () => {
    const { adminToken } = await seed();
    const res = await authed(request(app).post('/api/v1/calendars'), adminToken)
      .send({ name: 'Ghost', kind: 'internal', location_id: '00000000-0000-4000-8000-000000000099' });
    expect(res.status).toBe(404);
  });

  test('calendar resolution order: project > employee default > location > org default', () => {
    const calendars = [
      { id: 'org-default', location_id: null, is_default: true },
      { id: 'loc-cal', location_id: 'loc-1', is_default: false },
    ];
    const ctx = (assignments, loc) => ({ assignments, membershipLocationId: loc, calendars });
    expect(pickCalendarId(ctx([{ account_id: 'p1', calendar_id: 'proj-cal' }], 'loc-1'), 'p1')).toBe('proj-cal');
    expect(pickCalendarId(ctx([{ account_id: null, calendar_id: 'emp-cal' }], 'loc-1'), 'p1')).toBe('emp-cal');
    expect(pickCalendarId(ctx([], 'loc-1'), 'p1')).toBe('loc-cal');
    expect(pickCalendarId(ctx([], null), 'p1')).toBe('org-default');
  });
});

describe('admin can edit and delete calendars and their holidays', () => {
  test('editing a calendar updates its name/kind/location; a bad location is rejected', async () => {
    const { org, adminToken } = await seed();
    const location = await prisma.location.create({ data: { org_id: org.id, name: 'Gurgaon' } });
    const calendar = await makeCalendar(adminToken, { name: 'Draft Calendar', kind: 'internal' });

    const edit = await authed(request(app).patch(`/api/v1/calendars/${calendar.id}`), adminToken)
      .send({ name: 'Gurgaon Office', location_id: location.id });
    expect(edit.status).toBe(200);
    expect(edit.body.data.name).toBe('Gurgaon Office');
    expect(edit.body.data.location.name).toBe('Gurgaon');

    const badLocation = await authed(request(app).patch(`/api/v1/calendars/${calendar.id}`), adminToken)
      .send({ location_id: '00000000-0000-4000-8000-000000000099' });
    expect(badLocation.status).toBe(404);
  });

  test('a non-admin cannot edit or delete a calendar or its holidays', async () => {
    const { adminToken, empToken } = await seed();
    const calendar = await makeCalendar(adminToken, { name: 'Locked Down', kind: 'internal' }, [['2026-12-25', 'Christmas']]);
    const holidays = (await authed(request(app).get(`/api/v1/calendars/${calendar.id}/holidays`), adminToken)).body.data;

    expect((await authed(request(app).patch(`/api/v1/calendars/${calendar.id}`), empToken).send({ name: 'Hacked' })).status).toBe(403);
    expect((await authed(request(app).delete(`/api/v1/calendars/${calendar.id}`), empToken)).status).toBe(403);
    expect((await authed(request(app).patch(`/api/v1/calendars/${calendar.id}/holidays/${holidays[0].id}`), empToken).send({ label: 'Hacked' })).status).toBe(403);
    expect((await authed(request(app).delete(`/api/v1/calendars/${calendar.id}/holidays/${holidays[0].id}`), empToken)).status).toBe(403);
  });

  test('deleting a calendar removes its holidays too; deleting one still mapped to an employee is blocked until reassigned', async () => {
    const { org, adminToken, membership } = await seed();
    const calendar = await makeCalendar(adminToken, { name: 'Temp Calendar', kind: 'internal' }, [['2026-12-25', 'Christmas']]);

    // Not yet in use — deletes cleanly, holidays cascade.
    const freeDelete = await authed(request(app).delete(`/api/v1/calendars/${calendar.id}`), adminToken);
    expect(freeDelete.status).toBe(200);
    expect(await prisma.calendarHoliday.count({ where: { calendar_id: calendar.id } })).toBe(0);

    // Now map a second calendar to an employee, then try to delete it.
    const mappedCalendar = await makeCalendar(adminToken, { name: 'Mapped Calendar', kind: 'internal' });
    await authed(request(app).post(`/api/v1/calendars/${mappedCalendar.id}/assign`), adminToken).send({ org_membership_id: membership.id });
    const blocked = await authed(request(app).delete(`/api/v1/calendars/${mappedCalendar.id}`), adminToken);
    expect(blocked.status).toBe(409);
    expect(await prisma.calendar.findUnique({ where: { id: mappedCalendar.id } })).not.toBeNull();
    expect(org).toBeTruthy();
  });

  test('a holiday can be edited and deleted; editing onto an already-used date is rejected', async () => {
    const { adminToken } = await seed();
    const calendar = await makeCalendar(adminToken, { name: 'Editable Calendar', kind: 'internal' }, [
      ['2026-12-25', 'Christmas'],
      ['2026-01-01', 'New Year'],
    ]);
    const holidays = (await authed(request(app).get(`/api/v1/calendars/${calendar.id}/holidays`), adminToken)).body.data;
    const christmas = holidays.find((h) => h.label === 'Christmas');
    const newYear = holidays.find((h) => h.label === 'New Year');

    const edit = await authed(request(app).patch(`/api/v1/calendars/${calendar.id}/holidays/${christmas.id}`), adminToken)
      .send({ label: 'Christmas Day' });
    expect(edit.status).toBe(200);
    expect(edit.body.data.label).toBe('Christmas Day');

    const clash = await authed(request(app).patch(`/api/v1/calendars/${calendar.id}/holidays/${christmas.id}`), adminToken)
      .send({ date: '2026-01-01' });
    expect(clash.status).toBe(409);

    const remove = await authed(request(app).delete(`/api/v1/calendars/${calendar.id}/holidays/${newYear.id}`), adminToken);
    expect(remove.status).toBe(200);
    const remaining = (await authed(request(app).get(`/api/v1/calendars/${calendar.id}/holidays`), adminToken)).body.data;
    expect(remaining.map((h) => h.label)).toEqual(['Christmas Day']);
  });
});

describe('real-time daily revenue', () => {
  test('approving an entry creates the day revenue immediately; a ticket that removes billable hours removes it', async () => {
    const { org, admin, adminToken, empToken, usClient } = await seed();
    await prisma.billingRate.create({
      data: { org_id: org.id, account_id: usClient.id, rate_type: 'hourly', rate: 100, currency: 'INR', effective_from: new Date('2026-01-01'), created_by: admin.id },
    });
    const entry = (await logHours(empToken, { date: '2026-09-03', account_id: usClient.id, hours: 6 })).body.data;
    expect(await prisma.dailyProjectRevenue.count({ where: { org_id: org.id } })).toBe(0); // submitted != revenue

    await authed(request(app).post(`/api/v1/timesheets/entries/${entry.id}/decision`), adminToken).send({ status: 'approved' });
    const rows = await prisma.dailyProjectRevenue.findMany({ where: { org_id: org.id } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].revenue)).toBe(600); // 6h x 100/h, no manual "compute" step

    await authed(request(app).post('/api/v1/timesheets/locks'), adminToken).send({ date: '2026-09-03' });
    const ticket = await authed(request(app).post(`/api/v1/timesheets/entries/${entry.id}/regularization-tickets`), empToken)
      .send({ requested_change: { billable: false }, reason: 'was internal work' });
    await authed(request(app).post(`/api/v1/timesheets/regularization-tickets/${ticket.body.data.id}/decision`), adminToken).send({ status: 'approved' });
    expect(await prisma.dailyProjectRevenue.count({ where: { org_id: org.id } })).toBe(0);
  });
});

describe('attendance grace period & lateness', () => {
  const shift = { start_minutes: 9 * 60, end_minutes: 18 * 60, grace_minutes: 15 };
  const at = (hhmmIst) => new Date(`2026-09-10T${hhmmIst}:00+05:30`);

  test('within grace is on time; beyond grace records minutes past shift start; no shift is null', () => {
    expect(computeLateMinutes(shift, at('09:10'), 'Asia/Kolkata')).toBe(0);
    expect(computeLateMinutes(shift, at('09:15'), 'Asia/Kolkata')).toBe(0);
    expect(computeLateMinutes(shift, at('09:30'), 'Asia/Kolkata')).toBe(30);
    expect(computeLateMinutes(shift, at('08:40'), 'Asia/Kolkata')).toBe(0);
    expect(computeLateMinutes(null, at('11:00'), 'Asia/Kolkata')).toBeNull();
  });

  test('evaluated in the org timezone, and an overnight shift is not read as 20h late', () => {
    expect(computeLateMinutes(shift, new Date('2026-09-10T04:00:00Z'), 'Asia/Kolkata')).toBe(30); // 09:30 IST
    const night = { start_minutes: 22 * 60, end_minutes: 6 * 60, grace_minutes: 15 };
    expect(computeLateMinutes(night, at('21:50'), 'Asia/Kolkata')).toBe(0);
    expect(computeLateMinutes(night, at('22:45'), 'Asia/Kolkata')).toBe(45);
  });

  test('check-in stores late_minutes for an employee with an assigned shift', async () => {
    const { org, adminToken, membership, empToken } = await seed();
    const created = await authed(request(app).post('/api/v1/attendance/shifts'), adminToken)
      .send({ name: 'Always late', start_minutes: 0, end_minutes: 60, grace_minutes: 0 });
    expect(created.status).toBe(201);
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { shift_id: created.body.data.id } });
    const res = await authed(request(app).post('/api/v1/attendance/check-in'), empToken);
    expect(res.status).toBe(201);
    expect(org).toBeTruthy();
    expect(res.body.data.late_minutes).toBeGreaterThanOrEqual(0);
    expect(res.body.data.late_minutes).not.toBeNull();
  });
});

describe('leave guards', () => {
  async function paidType(adminToken, quota = 2) {
    const res = await authed(request(app).post('/api/v1/leave/types'), adminToken).send({ name: 'Casual', paid: true, annual_quota: quota });
    return res.body.data;
  }
  const req = (token, body) => authed(request(app).post('/api/v1/leave/requests'), token).send(body);

  test('overlapping pending/approved leave is rejected; AM + PM half-days on one date are allowed', async () => {
    const { adminToken, empToken } = await seed();
    const t = await paidType(adminToken, 10);
    expect((await req(empToken, { leave_type_id: t.id, from_date: '2026-10-20', to_date: '2026-10-22', reason: 'trip' })).status).toBe(201);
    expect((await req(empToken, { leave_type_id: t.id, from_date: '2026-10-22', to_date: '2026-10-23', reason: 'again' })).status).toBe(409);
    const am = await req(empToken, { leave_type_id: t.id, from_date: '2026-10-27', to_date: '2026-10-27', is_half_day: true, half_day_session: 'FIRST_HALF', reason: 'am' });
    const pm = await req(empToken, { leave_type_id: t.id, from_date: '2026-10-27', to_date: '2026-10-27', is_half_day: true, half_day_session: 'SECOND_HALF', reason: 'pm' });
    expect(am.status).toBe(201);
    expect(pm.status).toBe(201);
    const same = await req(empToken, { leave_type_id: t.id, from_date: '2026-10-27', to_date: '2026-10-27', is_half_day: true, half_day_session: 'FIRST_HALF', reason: 'dup' });
    expect(same.status).toBe(409);
  });

  test('paid leave cannot exceed the remaining balance (pending counts); unpaid is uncapped', async () => {
    const { adminToken, empToken } = await seed();
    const t = await paidType(adminToken, 2);
    expect((await req(empToken, { leave_type_id: t.id, from_date: '2026-11-02', to_date: '2026-11-03', reason: 'uses quota' })).status).toBe(201);
    const over = await req(empToken, { leave_type_id: t.id, from_date: '2026-11-10', to_date: '2026-11-10', reason: 'one more' });
    expect(over.status).toBe(422);
    expect(over.body.message).toContain('Not enough leave balance');

    const unpaid = (await authed(request(app).post('/api/v1/leave/types'), adminToken).send({ name: 'LWP', paid: false, annual_quota: 0 })).body.data;
    expect((await req(empToken, { leave_type_id: unpaid.id, from_date: '2026-11-16', to_date: '2026-11-20', reason: 'unpaid' })).status).toBe(201);
  });
});

describe('payroll uses each employee\'s own calendar', () => {
  test('an Ahmedabad employee and a location-less employee get different holiday days for the same month', async () => {
    const { org, adminToken, membership } = await seed();
    const other = await createUser({ role: 'recruiter' });
    const otherMembership = await createOrgMembership(other.id, org.id, { role: 'recruiter' });
    const location = await prisma.location.create({ data: { org_id: org.id, name: 'Ahmedabad' } });
    await makeCalendar(adminToken, { name: 'Ahmedabad Office', kind: 'internal', location_id: location.id }, [['2026-08-19', 'Local festival']]);

    for (const m of [membership, otherMembership]) {
      await prisma.orgMembership.update({ where: { id: m.id }, data: { joined_at: new Date('2026-01-01'), ...(m.id === membership.id ? { location_id: location.id } : {}) } });
      await authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken)
        .send({ org_membership_id: m.id, effective_from: '2026-01-01', ctc: 30000, components: { Basic: 30000 } });
    }
    const run = (await authed(request(app).post('/api/v1/payroll/runs'), adminToken).send({ period_month: 8, period_year: 2026 })).body.data;
    await authed(request(app).post(`/api/v1/payroll/runs/${run.id}/process`), adminToken);
    const slips = await prisma.payslip.findMany({ where: { payroll_run_id: run.id } });
    const holidays = Object.fromEntries(slips.map((s) => [s.org_membership_id, s.breakdown.holiday_days]));
    expect(holidays[membership.id]).toBe(1); // 2026-08-19 is a Wednesday on the Ahmedabad calendar
    expect(holidays[otherMembership.id]).toBe(0);
  });
});

describe('automated payroll draft', () => {
  test('opens the previous month as a DRAFT run per active org, idempotently, and never processes it', async () => {
    const { org } = await seed();
    const first = await payrollDraft.run(new Date('2026-10-01T03:00:00Z'));
    expect(first).toMatchObject({ period_month: 9, period_year: 2026, created: 1 });
    const again = await payrollDraft.run(new Date('2026-10-01T03:00:00Z'));
    expect(again.created).toBe(0);
    const runs = await prisma.payrollRun.findMany({ where: { org_id: org.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('draft');
    expect(await prisma.payslip.count()).toBe(0);
  });
});

describe('calendar employee alignment (Holiday Calendar → Manage calendars)', () => {
  test('lists assigned and inherited employees, and unassigning falls back to the inherited calendar', async () => {
    const { org, adminToken, membership, empToken } = await seed();
    const dept = await prisma.department.create({ data: { name: 'Ops', org_id: org.id } });
    const other = await createUser({ role: 'recruiter' });
    const otherMembership = await createOrgMembership(other.id, org.id, { role: 'recruiter', department_id: dept.id });

    const base = await makeCalendar(adminToken, { name: 'Base', is_default: true });
    const opsCal = await makeCalendar(adminToken, { name: 'Ops Calendar', department_id: dept.id });
    const usCal = await makeCalendar(adminToken, { name: 'US Calendar', kind: 'client' }, [['2026-07-04', 'Independence Day']]);

    const assign = await authed(request(app).post(`/api/v1/calendars/${usCal.id}/assign`), adminToken).send({ org_membership_id: membership.id });
    expect(assign.status).toBe(200);

    const us = await authed(request(app).get(`/api/v1/calendars/${usCal.id}/employees`), adminToken);
    expect(us.status).toBe(200);
    expect(us.body.data.map((e) => [e.id, e.source])).toEqual([[membership.id, 'assigned']]);

    const ops = await authed(request(app).get(`/api/v1/calendars/${opsCal.id}/employees`), adminToken);
    expect(ops.body.data.map((e) => [e.id, e.source])).toEqual([[otherMembership.id, 'department']]);

    const baseRes = await authed(request(app).get(`/api/v1/calendars/${base.id}/employees`), adminToken);
    expect(baseRes.body.data.map((e) => e.id)).not.toContain(membership.id);
    expect(baseRes.body.data.every((e) => e.source === 'default')).toBe(true);

    const mine = await authed(request(app).get('/api/v1/calendars/me?year=2026'), empToken);
    expect(mine.body.data.standard_calendar.name).toBe('US Calendar');

    expect((await authed(request(app).get(`/api/v1/calendars/${usCal.id}/employees`), empToken)).status).toBe(403);
    expect((await authed(request(app).delete(`/api/v1/calendars/${usCal.id}/assign/${membership.id}`), empToken)).status).toBe(403);

    const del = await authed(request(app).delete(`/api/v1/calendars/${usCal.id}/assign/${membership.id}`), adminToken);
    expect(del.status).toBe(200);
    expect((await authed(request(app).delete(`/api/v1/calendars/${usCal.id}/assign/${membership.id}`), adminToken)).status).toBe(404);

    const after = await authed(request(app).get('/api/v1/calendars/me?year=2026'), empToken);
    expect(after.body.data.standard_calendar.name).toBe('Base');
    const baseAfter = await authed(request(app).get(`/api/v1/calendars/${base.id}/employees`), adminToken);
    expect(baseAfter.body.data.map((e) => e.id)).toContain(membership.id);
  });
});

describe('IT staff follow a calendar per project; non-IT follow one calendar', () => {
  test('per_project flag, project-wise alignment and the admin member view', async () => {
    const { org, admin, adminToken, membership: nonItMembership, empToken, usClient, inClient } = await seed();
    const itDept = await prisma.department.create({ data: { name: 'IT', org_id: org.id } });
    const itUser = await createUser({ role: 'employee' });
    await prisma.user.update({ where: { id: itUser.id }, data: { department_id: itDept.id } });
    const itMembership = await createOrgMembership(itUser.id, org.id, { role: 'employee' });
    const itToken = (await loginAs(itUser)).access_token;

    const base = await makeCalendar(adminToken, { name: 'Ahmedabad', is_default: true });
    const usCal = await makeCalendar(adminToken, { name: 'US Calendar', kind: 'client' });
    const inCal = await makeCalendar(adminToken, { name: 'India Client Calendar', kind: 'client' });
    await prisma.projectCalendar.createMany({
      data: [
        { org_id: org.id, account_id: usClient.id, calendar_id: usCal.id },
        { org_id: org.id, account_id: inClient.id, calendar_id: inCal.id },
      ],
    });
    for (const m of [itMembership, nonItMembership]) {
      for (const p of [usClient, inClient]) {
        await prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: p.id, org_membership_id: m.id, created_by: admin.id } });
      }
    }

    const it = (await authed(request(app).get('/api/v1/calendars/me?year=2026'), itToken)).body.data;
    expect(it.per_project).toBe(true);
    expect(it.standard_calendar.name).toBe('Ahmedabad');
    expect(Object.fromEntries(it.projects.map((p) => [p.id, p.calendar.name]))).toEqual({ [usClient.id]: 'US Calendar', [inClient.id]: 'India Client Calendar' });

    const nonIt = (await authed(request(app).get('/api/v1/calendars/me?year=2026'), empToken)).body.data;
    expect(nonIt.per_project).toBe(false);
    expect(nonIt.standard_calendar.name).toBe('Ahmedabad');

    // US Calendar is aligned only to the IT employee, through the US project.
    const us = (await authed(request(app).get(`/api/v1/calendars/${usCal.id}/employees`), adminToken)).body.data;
    expect(us).toHaveLength(1);
    expect(us[0]).toMatchObject({ id: itMembership.id, source: 'project', per_project: true, projects: [{ id: usClient.id, name: 'US Client' }] });

    // Both follow Ahmedabad as their standard calendar; only IT carries projects.
    const ahm = (await authed(request(app).get(`/api/v1/calendars/${base.id}/employees`), adminToken)).body.data;
    const byId = Object.fromEntries(ahm.map((e) => [e.id, e]));
    expect(byId[itMembership.id]).toMatchObject({ source: 'default', projects: [] });
    expect(byId[nonItMembership.id]).toMatchObject({ source: 'default', per_project: false, projects: [] });

    const member = await authed(request(app).get(`/api/v1/calendars/members/${itMembership.id}?year=2026`), adminToken);
    expect(member.status).toBe(200);
    expect(member.body.data.per_project).toBe(true);
    expect(member.body.data.projects).toHaveLength(2);
    expect((await authed(request(app).get(`/api/v1/calendars/members/${itMembership.id}`), empToken)).status).toBe(403);
  });
});
