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
