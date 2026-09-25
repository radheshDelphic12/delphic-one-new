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
const timesheetsService = require('../src/modules/timesheets/timesheets.service');
const weeklyLockJob = require('../src/jobs/timesheetWeeklyLock');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function person(org, { role = 'employee', dept, managerMembership } = {}) {
  const user = await createUser({ role });
  if (dept) await prisma.user.update({ where: { id: user.id }, data: { department_id: dept.id } });
  const membership = await createOrgMembership(user.id, org.id, { role });
  if (managerMembership) {
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { manager_id: managerMembership.id } });
  }
  const { access_token } = await loginAs(user);
  return { user, membership, token: access_token };
}

async function project(org, ownerId, ...members) {
  const account = await createActiveClientAccount(ownerId);
  await prisma.account.update({ where: { id: account.id }, data: { org_id: org.id } });
  for (const m of members) {
    await prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: account.id, org_membership_id: m.id, created_by: ownerId } });
  }
  return account;
}

async function approvedLeave(org, membership, from, to, extra = {}) {
  const type = (await prisma.leaveType.findFirst({ where: { org_id: org.id } })) || (await prisma.leaveType.create({ data: { org_id: org.id, name: 'Casual', paid: true, annual_quota: 12 } }));
  return prisma.leaveRequest.create({
    data: { org_id: org.id, org_membership_id: membership.id, leave_type_id: type.id, from_date: new Date(from), to_date: new Date(to), status: 'approved', ...extra },
  });
}

const log = (token, body) => authed(request(app).post('/api/v1/timesheets/entries'), token).send(body);

describe('non-IT vs IT timesheet fields', () => {
  test('a non-IT employee logs just Date/Hours/Notes with no project — stored as non-billable general time', async () => {
    const org = await createOrg();
    const emp = await person(org);
    const res = await log(emp.token, { date: '2026-09-15', hours: 6, notes: 'Team meetings' });
    expect(res.status).toBe(201);
    expect(res.body.data.account_id).toBeNull();
    expect(res.body.data.billable).toBe(false);
  });

  test('an IT employee must pick a project, and only one assigned to them; /my-projects lists exactly those', async () => {
    const org = await createOrg();
    const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
    const dev = await person(org, { dept });
    const mine = await project(org, dev.user.id, dev.membership);
    const notMine = await project(org, dev.user.id);

    expect((await log(dev.token, { date: '2026-09-15', hours: 4 })).status).toBe(422);
    const forbidden = await log(dev.token, { date: '2026-09-15', hours: 4, account_id: notMine.id });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.message).toContain("isn't assigned");
    expect((await log(dev.token, { date: '2026-09-15', hours: 4, account_id: mine.id })).status).toBe(201);

    const list = await authed(request(app).get('/api/v1/timesheets/my-projects'), dev.token);
    expect(list.body.data.map((a) => a.id)).toEqual([mine.id]);
  });
});

describe('Approved Leave Day = no attendance, no timesheet, no project hours', () => {
  test('timesheet logging is blocked on an approved full-day leave, but not on pending leave, half-day leave, or other dates', async () => {
    const org = await createOrg();
    const emp = await person(org);
    await approvedLeave(org, emp.membership, '2026-09-15', '2026-09-16');
    await approvedLeave(org, emp.membership, '2026-09-17', '2026-09-17', { is_half_day: true, half_day_session: 'FIRST_HALF' });
    await approvedLeave(org, emp.membership, '2026-09-18', '2026-09-18', { status: 'pending' });

    const blocked = await log(emp.token, { date: '2026-09-16', hours: 4 });
    expect(blocked.status).toBe(422);
    expect(blocked.body.message).toContain('leave');
    expect((await log(emp.token, { date: '2026-09-17', hours: 4 })).status).toBe(201); // half-day
    expect((await log(emp.token, { date: '2026-09-18', hours: 4 })).status).toBe(201); // only pending
    expect((await log(emp.token, { date: '2026-09-21', hours: 4 })).status).toBe(201);
  });

  test('day-status reports a leave day; check-in and check-out are refused on one', async () => {
    const org = await createOrg();
    const emp = await person(org);
    const today = new Date(`${new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)}T00:00:00.000Z`);
    await approvedLeave(org, emp.membership, today.toISOString().slice(0, 10), today.toISOString().slice(0, 10));

    const status = await authed(request(app).get('/api/v1/leave/day-status').query({ date: today.toISOString().slice(0, 10) }), emp.token);
    expect(status.body.data).toMatchObject({ is_leave_day: true });
    const other = await authed(request(app).get('/api/v1/leave/day-status').query({ date: '2026-01-05' }), emp.token);
    expect(other.body.data.is_leave_day).toBe(false);

    expect((await authed(request(app).post('/api/v1/attendance/check-in'), emp.token)).status).toBe(422);
    expect((await authed(request(app).post('/api/v1/attendance/check-out'), emp.token)).status).toBe(422);
  });
});

describe('approval routing to the reporting manager', () => {
  test('the manager is notified, can approve a report; a peer, the employee themself, and a bare rejection are refused; the employee sees the reason', async () => {
    const org = await createOrg();
    const manager = await person(org);
    const emp = await person(org, { managerMembership: manager.membership });
    const peer = await person(org);

    const entry = (await log(emp.token, { date: '2026-09-15', hours: 5, notes: 'Work' })).body.data;
    const ping = await prisma.notification.findMany({ where: { user_id: manager.user.id, type: 'timesheet_submitted' } });
    expect(ping).toHaveLength(1);
    // a second row the same day does not ping again
    await log(emp.token, { date: '2026-09-15', hours: 1 });
    expect(await prisma.notification.count({ where: { user_id: manager.user.id, type: 'timesheet_submitted' } })).toBe(1);

    const decide = (token, body, id = entry.id) => authed(request(app).post(`/api/v1/timesheets/entries/${id}/decision`), token).send(body);
    expect((await decide(peer.token, { status: 'approved' })).status).toBe(403);
    expect((await decide(emp.token, { status: 'approved' })).status).toBe(403);
    expect((await decide(manager.token, { status: 'rejected' })).status).toBe(422); // reason required

    const rejected = await decide(manager.token, { status: 'rejected', reason: 'Wrong project hours' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({ status: 'rejected', decision_reason: 'Wrong project hours' });
    expect(await prisma.notification.count({ where: { user_id: emp.user.id, type: 'timesheet_entry_decided' } })).toBe(1);

    const mine = await authed(request(app).get('/api/v1/timesheets/entries/me'), emp.token);
    expect(mine.body.data.find((e) => e.id === entry.id).decision_reason).toBe('Wrong project hours');
  });

  test('approvals scope + pending inbox: a manager sees only their reports; an admin sees everyone; a non-manager is not an approver', async () => {
    const org = await createOrg();
    const admin = await person(org, { role: 'admin' });
    const manager = await person(org);
    const report = await person(org, { managerMembership: manager.membership });
    const stranger = await person(org);
    await log(report.token, { date: '2026-09-15', hours: 3 });
    await log(stranger.token, { date: '2026-09-15', hours: 2 });

    const scope = await authed(request(app).get('/api/v1/timesheets/approvals/scope'), manager.token);
    expect(scope.body.data).toMatchObject({ is_approver: true, direct_reports: 1 });
    expect((await authed(request(app).get('/api/v1/timesheets/approvals/scope'), stranger.token)).body.data.is_approver).toBe(false);

    const managerInbox = await authed(request(app).get('/api/v1/timesheets/approvals/pending'), manager.token);
    expect(managerInbox.body.data.entries).toHaveLength(1);
    const adminInbox = await authed(request(app).get('/api/v1/timesheets/approvals/pending'), admin.token);
    expect(adminInbox.body.data.entries).toHaveLength(2);
  });
});

describe('weekly auto-lock (Saturday 00:00, Mon-Fri)', () => {
  test('the completed week is computed in IST: nothing before Saturday 00:00, the whole Mon-Fri week from it', () => {
    const days = (iso) => timesheetsService.lastCompletedWeekDays(new Date(iso)).map((d) => d.toISOString().slice(0, 10));
    // Thursday 24 Sep 2026 -> the week that ended Sat 19 Sep is the last completed one.
    expect(days('2026-09-24T10:00:00Z')).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
    // Friday 25 Sep 23:59 IST: this week is NOT locked yet.
    expect(days('2026-09-25T18:29:00Z')).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
    // Saturday 26 Sep 00:00 IST: it locks.
    expect(days('2026-09-25T18:30:00Z')).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
  });

  test('the job locks Mon-Fri once (idempotent); afterwards neither an employee NOR an admin can log on those days', async () => {
    const org = await createOrg();
    const admin = await person(org, { role: 'admin' });
    const emp = await person(org);
    expect((await log(emp.token, { date: '2026-09-22', hours: 4 })).status).toBe(201); // before the lock

    const now = new Date('2026-09-25T18:30:00Z');
    const first = await weeklyLockJob.run(now);
    expect(first.days_locked).toBe(5);
    expect((await weeklyLockJob.run(now)).days_locked).toBe(0);
    expect(await prisma.timesheetLock.count({ where: { org_id: org.id, is_auto: true } })).toBe(5);

    const blockedEmployee = await log(emp.token, { date: '2026-09-23', hours: 4 });
    expect(blockedEmployee.status).toBe(409);
    expect(blockedEmployee.body.message).toContain('Regularisation');
    expect((await log(admin.token, { date: '2026-09-23', hours: 4 })).status).toBe(409);
    // The weekend and the new week stay open.
    expect((await log(emp.token, { date: '2026-09-28', hours: 4 })).status).toBe(201);
  });
});

describe('Timesheet Regularisation', () => {
  async function lockedWeek(org) {
    await timesheetsService.lockCompletedWeek(org.id, new Date('2026-09-25T18:30:00Z')); // locks 21-25 Sep
  }

  test('the request only makes sense on a locked day; it is validated and de-duplicated', async () => {
    const org = await createOrg();
    const emp = await person(org);
    const request_ = (body) => authed(request(app).post('/api/v1/timesheets/regularization-requests'), emp.token).send(body);

    expect((await request_({ date: '2026-09-22', hours: 6, reason: 'forgot' })).status).toBe(422); // not locked
    await lockedWeek(org);
    expect((await request_({ date: '2099-01-01', hours: 6, reason: 'future' })).status).toBe(422);
    const ok = await request_({ date: '2026-09-22', hours: 6, reason: 'Missed the deadline' });
    expect(ok.status).toBe(201);
    expect((await request_({ date: '2026-09-22', hours: 7, reason: 'again' })).status).toBe(409);
  });

  test('approval by the reporting manager creates the entry on the locked day; the manager was notified and the employee is told', async () => {
    const org = await createOrg();
    const manager = await person(org);
    const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
    const dev = await person(org, { dept, managerMembership: manager.membership });
    const proj = await project(org, dev.user.id, dev.membership);
    await lockedWeek(org);

    // IT must name an assigned project.
    const noProject = await authed(request(app).post('/api/v1/timesheets/regularization-requests'), dev.token).send({ date: '2026-09-22', hours: 6, reason: 'x' });
    expect(noProject.status).toBe(422);

    const req = (await authed(request(app).post('/api/v1/timesheets/regularization-requests'), dev.token)
      .send({ date: '2026-09-22', account_id: proj.id, hours: 6, reason: 'Missed the deadline' })).body.data;
    expect(await prisma.notification.count({ where: { user_id: manager.user.id, type: 'timesheet_regularization_requested' } })).toBe(1);

    const decide = (token, body) => authed(request(app).post(`/api/v1/timesheets/regularization-tickets/${req.id}/decision`), token).send(body);
    const outsider = await person(org);
    expect((await decide(outsider.token, { status: 'approved' })).status).toBe(403);
    expect((await decide(manager.token, { status: 'rejected' })).status).toBe(422); // reason required

    const approved = await decide(manager.token, { status: 'approved' });
    expect(approved.status).toBe(200);
    const entries = await prisma.timesheetEntry.findMany({ where: { org_membership_id: dev.membership.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: 'approved', account_id: proj.id });
    expect(Number(entries[0].hours)).toBe(6);
    expect(await prisma.notification.count({ where: { user_id: dev.user.id, type: 'timesheet_regularization_decided' } })).toBe(1);

    const mine = await authed(request(app).get('/api/v1/timesheets/regularization-requests/mine'), dev.token);
    expect(mine.body.data[0].status).toBe('approved');
  });

  test('a rejected request creates nothing; a request on an approved leave day is refused', async () => {
    const org = await createOrg();
    const manager = await person(org);
    const emp = await person(org, { managerMembership: manager.membership });
    await approvedLeave(org, emp.membership, '2026-09-23', '2026-09-23');
    await lockedWeek(org);

    const onLeave = await authed(request(app).post('/api/v1/timesheets/regularization-requests'), emp.token).send({ date: '2026-09-23', hours: 6, reason: 'x' });
    expect(onLeave.status).toBe(422);

    const req = (await authed(request(app).post('/api/v1/timesheets/regularization-requests'), emp.token).send({ date: '2026-09-22', hours: 6, reason: 'x' })).body.data;
    const rejected = await authed(request(app).post(`/api/v1/timesheets/regularization-tickets/${req.id}/decision`), manager.token)
      .send({ status: 'rejected', decision_reason: 'Not justified' });
    expect(rejected.status).toBe(200);
    expect(await prisma.timesheetEntry.count({ where: { org_membership_id: emp.membership.id } })).toBe(0);
  });
});
