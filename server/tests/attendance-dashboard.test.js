// Attendance Dashboard: attendance only (no project hours), reporting office with history, work type and
// office / home per day with an approval for a change away from the default, contractors left out.
const { prisma, request, app, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const org = await createOrg();
  const indore = await prisma.location.create({ data: { org_id: org.id, name: 'Indore' } });
  const gurugram = await prisma.location.create({ data: { org_id: org.id, name: 'Gurugram' } });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const admin = (await loginAs(adminUser)).access_token;
  const person = async (name, { workMode = null, workerType = null, managerId = null, locationId = indore.id } = {}) => {
    const user = await createUser({ role: 'recruiter', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: new Date('2020-01-01T00:00:00Z') });
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { work_mode: workMode, location_id: locationId, manager_id: managerId, ...(workerType ? { worker_type: workerType } : {}) } });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  return { org, indore, gurugram, admin, adminUser, person };
}
const get = (path, token) => authed(request(app).get(`/api/v1/attendance-dashboard${path}`), token);
const post = (path, token, body) => authed(request(app).post(`/api/v1/attendance-dashboard${path}`), token).send(body);

describe('attendance dashboard', () => {
  test('lists employees without contractors, and shows attendance + office + place per day, no project hours', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Abhi');
    await ctx.person('Vendor', { workerType: 'contractor' });
    await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, date: new Date('2026-11-03T00:00:00Z'), status: 'present' } });

    const list = await get('/people?year=2026&month=11', ctx.admin);
    expect(list.status).toBe(200);
    const names = list.body.data.people.map((p) => p.name);
    expect(names).toContain('Abhi');
    expect(names).not.toContain('Vendor');

    const cal = await get(`/calendar?year=2026&month=11&org_membership_id=${emp.membership.id}`, ctx.admin);
    expect(cal.status).toBe(200);
    const day = cal.body.data.days.find((d) => d.date === '2026-11-03');
    expect(day).toMatchObject({ attendance_status: 'present', work_type: 'onsite', work_place: 'office', place_status: 'approved' });
    expect(day.reporting_office.name).toBe('Indore');
    expect(day.entries).toBeUndefined();
    expect(day.logged).toBeUndefined();
    expect(Array.isArray(cal.body.data.leave_balances)).toBe(true);
  });

  test('employee list can be filtered by where each person stands: active, serving notice period, exited', async () => {
    const ctx = await seed();
    await ctx.person('Active One');
    const serving = await ctx.person('Serving Notice');
    const exited = await ctx.person('Gone Person');
    const lapsed = await ctx.person('Past Last Day'); // notice ended, the nightly exit job has not flipped the status yet
    const contractor = await ctx.person('Exited Contractor', { workerType: 'contractor' });
    const day = (offset) => new Date(Date.now() + offset * 86400000);
    await prisma.orgMembership.update({ where: { id: serving.membership.id }, data: { employment_status: 'notice_period', notice_end_date: day(10) } });
    await prisma.orgMembership.update({ where: { id: exited.membership.id }, data: { employment_status: 'terminated', left_at: day(-20) } });
    await prisma.orgMembership.update({ where: { id: lapsed.membership.id }, data: { employment_status: 'notice_period', notice_end_date: day(-3) } });
    await prisma.orgMembership.update({ where: { id: contractor.membership.id }, data: { employment_status: 'terminated', left_at: day(-20) } });
    const names = async (status) => (await get(`/people?year=2026&month=11${status ? `&status=${status}` : ''}`, ctx.admin)).body.data.people.map((p) => p.name).sort();

    // default: everyone still working, serving notice included, exited left out (as before)
    expect(await names()).toEqual(expect.arrayContaining(['Active One', 'Serving Notice']));
    expect(await names()).not.toContain('Gone Person');
    const current = await names('current');
    expect(current).not.toContain('Gone Person');
    expect(current).not.toContain('Past Last Day');
    expect(await names('active')).toContain('Active One');
    expect(await names('active')).not.toContain('Serving Notice');
    expect(await names('notice_period')).toEqual(['Serving Notice']);
    expect(await names('exited')).toEqual(['Gone Person', 'Past Last Day']);
    const everyone = await names('all');
    expect(everyone).toEqual(expect.arrayContaining(['Active One', 'Serving Notice', 'Gone Person', 'Past Last Day']));
    expect(everyone).not.toContain('Exited Contractor'); // contractors never appear

    const rows = (await get('/people?year=2026&month=11&status=all', ctx.admin)).body.data.people;
    const byName = Object.fromEntries(rows.map((p) => [p.name, p]));
    expect(byName['Serving Notice']).toMatchObject({ status: 'notice_period' });
    expect(byName['Serving Notice'].last_working_day).toBe(day(10).toISOString().slice(0, 10));
    expect(byName['Gone Person']).toMatchObject({ status: 'exited' });
    expect(byName['Active One']).toMatchObject({ status: 'active', last_working_day: null });
    expect((await get('/people?year=2026&month=11&status=bogus', ctx.admin)).status).toBeGreaterThanOrEqual(400);

    // an exited person's attendance can still be opened from the list
    const cal = await get(`/calendar?year=2026&month=10&org_membership_id=${exited.membership.id}`, ctx.admin);
    expect(cal.status).toBe(200);
  });

  test('reporting office changes from a date, earlier days keep the old office', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Mover');
    const set = await post('/offices', ctx.admin, { org_membership_id: emp.membership.id, location_id: ctx.gurugram.id, effective_from: '2026-11-01' });
    expect(set.status).toBe(201);
    const cal = await get(`/calendar?year=2026&month=10&org_membership_id=${emp.membership.id}`, ctx.admin);
    expect(cal.body.data.days.find((d) => d.date === '2026-10-31').reporting_office.name).toBe('Indore');
    const nov = await get(`/calendar?year=2026&month=11&org_membership_id=${emp.membership.id}`, ctx.admin);
    expect(nov.body.data.days.find((d) => d.date === '2026-11-02').reporting_office.name).toBe('Gurugram');
    // not an admin action for an employee
    expect((await post('/offices', emp.token, { org_membership_id: emp.membership.id, location_id: ctx.indore.id, effective_from: '2026-12-01' })).status).toBe(403);
  });

  test('work from home can be applied for a range of future days, up to 3 months ahead', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Planner');
    const ist = new Date(Date.now() + 330 * 60000);
    const today = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
    const ymdOf = (d) => d.toISOString().slice(0, 10);
    const plus = (days) => ymdOf(new Date(today.getTime() + days * 86400000));
    const plusMonths = (n, dd = 0) => ymdOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + n, today.getUTCDate() + dd)));

    const range = await post('/place', emp.token, { date: plus(1), to_date: plus(14), work_place: 'home' });
    expect(range.status).toBe(201);
    // the client relies on this flag to show the apply button to an employee on their own calendar
    expect((await get('/calendar?year=2026&month=11', emp.token)).body.data.member.is_self).toBe(true);
    expect((await get(`/calendar?year=2026&month=11&org_membership_id=${emp.membership.id}`, ctx.admin)).body.data.member.is_self).toBe(false);
    expect(range.body.data.count).toBeGreaterThan(5); // two weeks of working days, weekends skipped
    expect(range.body.data.count).toBeLessThanOrEqual(14);
    // the range's working days can fall in this month or the next (tomorrow may be a weekend at month end), so count both months
    const months = new Set([plus(1), plus(14)].map((ymd) => ymd.slice(0, 7)));
    let home = 0;
    for (const ym of months) {
      const cal = await get(`/calendar?year=${ym.slice(0, 4)}&month=${Number(ym.slice(5, 7))}`, emp.token);
      home += cal.body.data.days.filter((d) => d.requested_place === 'home').length;
    }
    expect(home).toBe(range.body.data.count);

    // exactly 3 months ahead is allowed; beyond it is refused
    expect((await post('/place', emp.token, { date: plusMonths(3), work_place: 'home' })).status).toBe(201);
    expect((await post('/place', emp.token, { date: plusMonths(3, 1), work_place: 'home' })).status).toBe(422);
    expect((await post('/place', emp.token, { date: plus(2), to_date: plusMonths(4), work_place: 'home' })).status).toBe(422);
    expect((await post('/place', emp.token, { date: plus(5), to_date: plus(3), work_place: 'home' })).status).toBe(422);
  });

  test('work from home on an onsite day needs the manager / admin to approve; remote is home by default', async () => {
    const ctx = await seed();
    const manager = await ctx.person('Boss');
    const emp = await ctx.person('Worker', { managerId: manager.membership.id });
    const remote = await ctx.person('Far', { workMode: 'remote' });

    const asked = await post('/place', emp.token, { date: '2026-11-10', work_place: 'home', reason: 'plumber' });
    expect(asked.status).toBe(201);
    expect(asked.body.data.row.status).toBe('pending');
    let cal = await get(`/calendar?year=2026&month=11&org_membership_id=${emp.membership.id}`, manager.token);
    let day = cal.body.data.days.find((d) => d.date === '2026-11-10');
    expect(day).toMatchObject({ work_place: 'office', place_status: 'pending', requested_place: 'home' });

    // a stranger cannot decide; the manager can
    const stranger = await ctx.person('Other');
    expect((await post(`/place/${asked.body.data.row.id}/decide`, stranger.token, { approve: true })).status).toBe(403);
    expect((await get('/place/pending', manager.token)).body.data).toHaveLength(1);
    expect((await post(`/place/${asked.body.data.row.id}/decide`, manager.token, { approve: true })).status).toBe(200);
    cal = await get(`/calendar?year=2026&month=11&org_membership_id=${emp.membership.id}`, emp.token);
    day = cal.body.data.days.find((d) => d.date === '2026-11-10');
    expect(day).toMatchObject({ work_place: 'home', place_status: 'approved' });

    // admin applying for someone is approved at once
    const byAdmin = await post('/place', ctx.admin, { org_membership_id: emp.membership.id, date: '2026-11-11', work_place: 'home' });
    expect(byAdmin.body.data.row.status).toBe('approved');

    // remote: home by default, asking for office is a change that needs approval; home is a no-op
    const farCal = await get(`/calendar?year=2026&month=11`, remote.token);
    expect(farCal.body.data.days[5]).toMatchObject({ work_type: 'remote', work_place: 'home' });
    expect((await post('/place', remote.token, { date: '2026-11-12', work_place: 'office' })).status).toBe(422);
    expect((await post('/place', remote.token, { date: '2026-11-12', work_place: 'home' })).body.data.reverted_to_default).toBe(true);

    // an employee cannot open or change someone else's
    expect((await get(`/calendar?year=2026&month=11&org_membership_id=${emp.membership.id}`, remote.token)).status).toBe(403);
    expect((await post('/place', remote.token, { org_membership_id: emp.membership.id, date: '2026-11-12', work_place: 'home' })).status).toBe(403);
  });

  test('project calendar: lists projects, shows hours + tasks + leave per day, hides unassigned projects from others', async () => {
    const ctx = await seed();
    const dev = await ctx.person('Dev');
    const other = await ctx.person('Outsider');
    const project = await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Acme Co', project_name: 'Acme Portal', type: 'client', stage: 'active', is_project: true, owner_id: ctx.adminUser.id, origin_owner_id: ctx.adminUser.id } });
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: project.id, org_membership_id: dev.membership.id, created_by: ctx.adminUser.id } });
    await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: dev.membership.id, account_id: project.id, date: new Date('2026-11-04T00:00:00Z'), hours: 6, module_name: 'Code Review', notes: 'PR 12', status: 'approved' } });
    const type = await prisma.leaveType.create({ data: { org_id: ctx.org.id, name: 'Sick Leave' } });
    await prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: dev.membership.id, leave_type_id: type.id, from_date: new Date('2026-11-09T00:00:00Z'), to_date: new Date('2026-11-09T00:00:00Z'), status: 'approved' } });

    const list = await get('/projects?year=2026&month=11', ctx.admin);
    expect(list.body.data.map((p) => p.name)).toContain('Acme Portal');
    // each project carries its contract status for the status filter (the same state Finance -> Projects shows)
    await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Held Co', project_name: 'Held Portal', type: 'client', stage: 'active', is_project: true, owner_id: ctx.adminUser.id, origin_owner_id: ctx.adminUser.id, contract_status: 'on_hold', agreement_start_date: new Date('2026-01-01T00:00:00Z') } });
    await prisma.account.update({ where: { id: project.id }, data: { agreement_start_date: new Date('2026-01-01T00:00:00Z') } });
    const withStatus = await get('/projects?year=2026&month=11', ctx.admin);
    const statusOf = (name) => withStatus.body.data.find((p) => p.name === name).status;
    expect(statusOf('Acme Portal')).toBe('running');
    expect(statusOf('Held Portal')).toBe('on_hold');

    const cal = await get(`/projects/${project.id}/calendar?year=2026&month=11`, dev.token);
    expect(cal.status).toBe(200);
    const d4 = cal.body.data.days.find((d) => d.date === '2026-11-04');
    expect(d4.hours).toBe(6);
    expect(d4.entries[0]).toMatchObject({ person: 'Dev', task: 'Code Review', notes: 'PR 12' });
    expect(cal.body.data.days.find((d) => d.date === '2026-11-09').on_leave[0]).toMatchObject({ person: 'Dev', leave: 'Sick Leave' });
    expect(cal.body.data.total_hours).toBe(6);

    expect((await get(`/projects/${project.id}/calendar?year=2026&month=11`, other.token)).status).toBe(403);
    expect((await get(`/projects/${project.id}/calendar?year=2026&month=11`, ctx.admin)).status).toBe(200);
  });
});

describe('monthly register', () => {
  test('hours logged on a project by a contractor or an exited person still show in the project view, so a project matches its Project Calendar', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Reg Employee');
    const contractor = await ctx.person('Reg Contractor', { workerType: 'contractor' });
    const project = await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Circle', is_project: true, stage: 'active', type: 'client', owner_id: ctx.adminUser.id, origin_owner_id: ctx.adminUser.id } });
    const day = (s) => new Date(`${s}T00:00:00Z`);
    const log = (m, date, hours) => prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: m.membership.id, account_id: project.id, date: day(date), hours, billable: true, status: 'approved' } });
    await log(emp, '2026-09-01', 6);
    await log(contractor, '2026-09-01', 8);
    await log(contractor, '2026-09-02', 8);
    await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: contractor.membership.id, account_id: project.id, date: day('2026-09-03'), hours: 5, billable: true, status: 'rejected' } });

    const res = await get('/register?year=2026&month=9', ctx.admin);
    expect(res.status).toBe(200);
    // the attendance table still leaves the contractor out
    const names = res.body.data.people.map((p) => p.name);
    expect(names).toContain('Reg Employee');
    expect(names).not.toContain('Reg Contractor');
    // the project view gets the contractor's hours too (rejected ones stay out)
    const extra = res.body.data.project_people.find((p) => p.name === 'Reg Contractor');
    expect(extra).toBeTruthy();
    const hoursOf = (d) => extra.days.find((x) => x.date === d).projects.map((x) => `${x.project}:${x.hours}`);
    expect(hoursOf('2026-09-01')).toEqual(['Circle:8']);
    expect(hoursOf('2026-09-02')).toEqual(['Circle:8']);
    expect(hoursOf('2026-09-03')).toEqual([]);
    expect(res.body.data.project_people.find((p) => p.name === 'Reg Employee')).toBeUndefined();
  });

  test('one response holds every employee x every day with codes, per-person totals and project hours; contractors and future absences stay out', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Reg Employee');
    await ctx.person('Reg Contractor', { workerType: 'contractor' });
    const day = (s) => new Date(`${s}T00:00:00Z`);
    const att = (date, status) => prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, date: day(date), status } });
    await att('2026-09-01', 'present');
    await att('2026-09-02', 'wfh');
    await att('2026-09-03', 'half_day');
    await att('2026-09-04', 'absent');
    const type = await prisma.leaveType.create({ data: { org_id: ctx.org.id, name: 'Casual Leave' } });
    await prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, leave_type_id: type.id, from_date: day('2026-09-07'), to_date: day('2026-09-07'), status: 'approved' } });
    await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, date: day('2026-09-01'), hours: 6, status: 'approved' } });

    const res = await get('/register?year=2026&month=9', ctx.admin);
    expect(res.status).toBe(200);
    expect(res.body.data.days).toHaveLength(30);
    expect(res.body.data.people.map((p) => p.name)).not.toContain('Reg Contractor');
    const row = res.body.data.people.find((p) => p.name === 'Reg Employee');
    const code = (d) => row.days.find((x) => x.date === `2026-09-${d}`).code;
    expect(code('01')).toBe('P');
    expect(code('02')).toBe('WFH');
    expect(code('03')).toBe('HD');
    expect(code('04')).toBe('A');
    expect(code('05')).toBe('WO'); // Saturday
    expect(code('07')).toBe('CL');
    expect(code('08')).toBe('A'); // a past working day with nothing recorded
    expect(row.totals).toMatchObject({ present: 2.5, wfh: 1, half_day: 1, leave: 1, absent: expect.any(Number), hours: 6 });
    expect(row.days.find((d) => d.date === '2026-09-01').hours).toBe(6);

    // an admin can change or remove a day from the register: each day carries its attendance record id
    const dayOf = (date) => row.days.find((d) => d.date === date);
    expect(dayOf('2026-09-01')).toMatchObject({ recorded_status: 'present' });
    expect(typeof dayOf('2026-09-01').record_id).toBe('string');
    expect(dayOf('2026-09-08').record_id).toBeNull();
    const codeOn = async (date) => (await get('/register?year=2026&month=9', ctx.admin)).body.data.people.find((p) => p.name === 'Reg Employee').days.find((d) => d.date === date);
    const marked = await authed(request(app).post('/api/v1/attendance/manual'), ctx.admin).send({ org_membership_id: emp.membership.id, date: '2026-09-08', status: 'present', reason: 'Edited from the register' });
    expect([200, 201]).toContain(marked.status);
    const after = await codeOn('2026-09-08');
    expect(after).toMatchObject({ code: 'P', recorded_status: 'present' });
    const removed = await authed(request(app).delete(`/api/v1/attendance/${after.record_id}`), ctx.admin).send({ reason: 'Wrong day, removing' });
    expect(removed.status).toBe(200);
    expect(await codeOn('2026-09-08')).toMatchObject({ code: 'A', record_id: null });

    const future = await get('/register?year=2026&month=12', ctx.admin);
    expect(future.body.data.people[0].days.find((d) => d.date === '2026-12-02').code).toBe(''); // future working day stays blank
    expect(future.body.data.people[0].totals.absent).toBe(0);
  });
});
