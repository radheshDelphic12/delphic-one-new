const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createOrg,
  createOrgMembership,
  createActiveClientAccount,
  authed,
} = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedAdmin(org) {
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { admin, token: access_token };
}

async function seedItEmployee(org, dept) {
  const user = await createUser({ role: 'employee' });
  await prisma.user.update({ where: { id: user.id }, data: { department_id: dept.id } });
  const membership = await createOrgMembership(user.id, org.id, { role: 'employee' });
  const { access_token } = await loginAs(user);
  return { user, membership, token: access_token };
}

async function seedProject(org, ownerId, ...members) {
  const account = await createActiveClientAccount(ownerId);
  await prisma.account.update({ where: { id: account.id }, data: { org_id: org.id } });
  // IT staff may only log against projects they're allocated to.
  for (const membership of members) {
    await prisma.projectMemberAssignment.create({
      data: { org_id: org.id, account_id: account.id, org_membership_id: membership.id, created_by: ownerId },
    });
  }
  return account;
}

describe('holiday logging is allowed and flagged as overtime, not blocked', () => {
  test('a project holiday no longer rejects the entry — it saves, flagged with the holiday label', async () => {
    const org = await createOrg();
    const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
    const { membership, token } = await seedItEmployee(org, dept);
    const project = await seedProject(org, membership.person_id, membership);

    const calendar = await prisma.calendar.create({ data: { org_id: org.id, name: 'Org Default', is_default: true } });
    await prisma.calendarHoliday.create({ data: { calendar_id: calendar.id, date: new Date('2026-10-02'), label: 'Gandhi Jayanti' } });

    const onHoliday = await authed(request(app).post('/api/v1/timesheets/entries'), token).send({
      date: '2026-10-02', account_id: project.id, hours: 4,
    });
    expect(onHoliday.status).toBe(201);
    expect(onHoliday.body.data.is_holiday_overtime).toBe(true);
    expect(onHoliday.body.data.holiday_label).toContain('Gandhi Jayanti');

    const ordinaryDay = await authed(request(app).post('/api/v1/timesheets/entries'), token).send({
      date: '2026-10-05', account_id: project.id, hours: 4,
    });
    expect(ordinaryDay.status).toBe(201);
    expect(ordinaryDay.body.data.is_holiday_overtime).toBe(false);
    expect(ordinaryDay.body.data.holiday_label).toBeNull();
  });
});

describe('admin task assignment — 1-click "Assigned Items" source', () => {
  test('admin assigns a task; the assignee sees it under /tasks/mine and can move its status; a stranger cannot', async () => {
    const org = await createOrg();
    const { admin, token: adminToken } = await seedAdmin(org);
    const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
    const { membership, token: assigneeToken } = await seedItEmployee(org, dept);
    const stranger = await seedItEmployee(org, dept);
    const project = await seedProject(org, admin.id);

    const create = await authed(request(app).post('/api/v1/tasks'), adminToken).send({
      account_id: project.id,
      assignee_membership_id: membership.id,
      title: 'Fix login bug',
    });
    expect(create.status).toBe(201);
    expect(create.body.data.status).toBe('pending');
    const taskId = create.body.data.id;

    const mine = await authed(request(app).get('/api/v1/tasks/mine'), assigneeToken);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].id).toBe(taskId);

    const moved = await authed(request(app).patch(`/api/v1/tasks/${taskId}`), assigneeToken).send({ status: 'in_progress' });
    expect(moved.status).toBe(200);
    expect(moved.body.data.status).toBe('in_progress');

    const blocked = await authed(request(app).patch(`/api/v1/tasks/${taskId}`), stranger.token).send({ status: 'completed' });
    expect(blocked.status).toBe(403);

    const teamList = await authed(request(app).get('/api/v1/tasks'), adminToken);
    expect(teamList.status).toBe(200);
    expect(teamList.body.data).toHaveLength(1);
    expect(teamList.body.data[0].status).toBe('in_progress');
  });

  test('a non-admin cannot create or list the team-wide task board', async () => {
    const org = await createOrg();
    const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
    const { membership, token } = await seedItEmployee(org, dept);
    const project = await seedProject(org, membership.person_id);

    const create = await authed(request(app).post('/api/v1/tasks'), token).send({
      account_id: project.id, assignee_membership_id: membership.id, title: 'Nope',
    });
    expect(create.status).toBe(403);

    const list = await authed(request(app).get('/api/v1/tasks'), token);
    expect(list.status).toBe(403);
  });
});

describe('admin monitoring hub — team overview and drill-down', () => {
  test('overview counts logged-today, missing-today, and pending approvals correctly', async () => {
    const org = await createOrg();
    const { token: adminToken } = await seedAdmin(org);
    const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
    const a = await seedItEmployee(org, dept);
    await seedItEmployee(org, dept); // logs nothing today — should count as missing.
    const project = await seedProject(org, a.membership.person_id, a.membership);

    await authed(request(app).post('/api/v1/timesheets/entries'), a.token).send({
      date: new Date().toISOString().slice(0, 10), account_id: project.id, hours: 3,
    });

    const overview = await authed(request(app).get('/api/v1/timesheets/overview').query({ department_id: dept.id }), adminToken);
    expect(overview.status).toBe(200);
    expect(overview.body.data.summary.total_members).toBe(2);
    expect(overview.body.data.summary.logged_today).toBe(1);
    expect(overview.body.data.summary.missing_today).toBe(1);
    expect(overview.body.data.summary.pending_approvals).toBe(1);

    const aRow = overview.body.data.members.find((m) => m.org_membership_id === a.membership.id);
    expect(aRow.logged_today).toBe(true);
    expect(aRow.allocation[0]).toMatchObject({ name: project.name, hours: 3, pct: 100 });
  });

  test('an admin can drill into a specific member\'s monthly log via org_membership_id; a non-admin cannot pull someone else\'s', async () => {
    const org = await createOrg();
    const { token: adminToken } = await seedAdmin(org);
    const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
    const a = await seedItEmployee(org, dept);
    const b = await seedItEmployee(org, dept);
    const project = await seedProject(org, a.membership.person_id, a.membership);

    await authed(request(app).post('/api/v1/timesheets/entries'), a.token).send({
      date: '2026-07-01', account_id: project.id, hours: 5,
    });

    const drillDown = await authed(
      request(app).get('/api/v1/timesheets/my-log').query({ month: 7, year: 2026, org_membership_id: a.membership.id }),
      adminToken
    );
    expect(drillDown.status).toBe(200);
    expect(drillDown.body.data).toHaveLength(1);
    expect(drillDown.body.data[0].total_hours).toBe(5);

    // b asking for a's data by id gets b's own (empty) log instead — never a's.
    const selfOnly = await authed(
      request(app).get('/api/v1/timesheets/my-log').query({ month: 7, year: 2026, org_membership_id: a.membership.id }),
      b.token
    );
    expect(selfOnly.status).toBe(200);
    expect(selfOnly.body.data).toHaveLength(0);
  });
});
