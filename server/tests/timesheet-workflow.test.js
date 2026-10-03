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
const { todayIst } = require('../src/lib/istDate');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const projectByToken = new Map();
const actorByToken = new Map();

async function person(org, { role = 'employee', dept, managerMembership } = {}) {
  const user = await createUser({ role });
  if (dept) await prisma.user.update({ where: { id: user.id }, data: { department_id: dept.id } });
  const membership = await createOrgMembership(user.id, org.id, { role });
  if (managerMembership) {
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { manager_id: managerMembership.id } });
  }
  const { access_token } = await loginAs(user);
  actorByToken.set(access_token, { org, user, membership });
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

const log = async (token, body) => {
  const { noProject, ...rest } = body;
  let account_id = rest.account_id;
  if (!noProject && !account_id) {
    if (!projectByToken.has(token)) {
      const actor = actorByToken.get(token);
      const account = await project(actor.org, actor.user.id, actor.membership);
      projectByToken.set(token, account.id);
    }
    account_id = projectByToken.get(token);
  }
  return authed(request(app).post('/api/v1/timesheets/entries'), token).send({ ...rest, ...(account_id ? { account_id } : {}) });
};

describe('non-IT vs IT timesheet fields', () => {
  test('a non-IT employee cannot log a timesheet with no project', async () => {
    const org = await createOrg();
    const emp = await person(org);
    const res = await log(emp.token, { date: '2026-09-15', hours: 6, notes: 'Team meetings', noProject: true });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('project');
  });

  test('an IT employee must pick a project, and only one assigned to them; /my-projects lists exactly those', async () => {
    const org = await createOrg();
    const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
    const dev = await person(org, { dept });
    const mine = await project(org, dev.user.id, dev.membership);
    const notMine = await project(org, dev.user.id);

    expect((await log(dev.token, { date: '2026-09-15', hours: 4, noProject: true })).status).toBe(422);
    const forbidden = await log(dev.token, { date: '2026-09-15', hours: 4, account_id: notMine.id });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.message).toContain("aren't allocated to that project");
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

describe('weekly auto-lock (Sunday 00:00, Sunday -> Saturday week)', () => {
  const week = (from) => Array.from({ length: 7 }, (_, i) => new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10));

  test('the completed week is computed in IST: nothing before Sunday 00:00, the whole Sun-Sat week from it', () => {
    const days = (iso) => timesheetsService.lastCompletedWeekDays(new Date(iso)).map((d) => d.toISOString().slice(0, 10));
    // Thursday 24 Sep 2026 -> the week Sun 13 - Sat 19 Sep is the last completed one.
    expect(days('2026-09-24T10:00:00Z')).toEqual(week('2026-09-13'));
    // Saturday 26 Sep 23:59 IST: this week is NOT locked yet.
    expect(days('2026-09-26T18:29:00Z')).toEqual(week('2026-09-13'));
    // Sunday 27 Sep 00:00 IST: Sun 20 - Sat 26 locks, weekend included.
    expect(days('2026-09-26T18:30:00Z')).toEqual(week('2026-09-20'));
  });

  test('the job locks the Sun-Sat week once (idempotent); afterwards neither an employee NOR an admin can log on those days', async () => {
    const org = await createOrg();
    const admin = await person(org, { role: 'admin' });
    const emp = await person(org);
    expect((await log(emp.token, { date: '2026-09-22', hours: 4 })).status).toBe(201); // before the lock

    const now = new Date('2026-09-26T18:30:00Z');
    const first = await weeklyLockJob.run(now);
    expect(first.days_locked).toBe(7);
    expect((await weeklyLockJob.run(now)).days_locked).toBe(0);
    expect(await prisma.timesheetLock.count({ where: { org_id: org.id, is_auto: true } })).toBe(7);

    const blockedEmployee = await log(emp.token, { date: '2026-09-23', hours: 4 });
    expect(blockedEmployee.status).toBe(409);
    expect(blockedEmployee.body.message).toContain('Regularisation');
    expect((await log(admin.token, { date: '2026-09-23', hours: 4 })).status).toBe(409);
    // The locked week's weekend is closed too; the new week stays open.
    expect((await log(emp.token, { date: '2026-09-26', hours: 4 })).status).toBe(409);
    expect((await log(emp.token, { date: '2026-09-28', hours: 4 })).status).toBe(201);
  });
});

describe('developer filing window', () => {
  test('an IT developer can log a locked day in last month through the 5th; an older locked month stays closed', async () => {
    const org = await createOrg();
    const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
    const dev = await person(org, { dept });
    const today = todayIst();
    const lastMonthDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15));
    const olderDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 10));
    await prisma.timesheetLock.create({ data: { org_id: org.id, date: lastMonthDay, is_auto: true } });
    await prisma.timesheetLock.create({ data: { org_id: org.id, date: olderDay, is_auto: true } });

    const last = await log(dev.token, { date: lastMonthDay.toISOString().slice(0, 10), hours: 4 });
    if (today.getUTCDate() <= 5) expect(last.status).toBe(201);
    else expect(last.status).toBe(409);

    const older = await log(dev.token, { date: olderDay.toISOString().slice(0, 10), hours: 4 });
    expect(older.status).toBe(409);
  });
});

describe('Timesheet Regularisation', () => {
  async function lockedWeek(org) {
    await timesheetsService.lockCompletedWeek(org.id, new Date('2026-09-26T18:30:00Z')); // locks Sun 20 - Sat 26 Sep
  }

  test('the request only makes sense on a locked day; it is validated and de-duplicated', async () => {
    const org = await createOrg();
    const emp = await person(org);
    const request_ = (body) => authed(request(app).post('/api/v1/timesheets/regularization-requests'), emp.token).send(body);

    expect((await request_({ date: '2026-09-22', hours: 6, reason: 'forgot' })).status).toBe(422); // not locked
    await lockedWeek(org);
    expect((await request_({ date: '2099-01-01', hours: 6, reason: 'future' })).status).toBe(422);
    const proj = await project(org, emp.user.id, emp.membership);
    const ok = await request_({ date: '2026-09-22', account_id: proj.id, hours: 6, reason: 'Missed the deadline' });
    expect(ok.status).toBe(201);
    expect((await request_({ date: '2026-09-22', account_id: proj.id, hours: 7, reason: 'again' })).status).toBe(409);
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

    const proj = await project(org, emp.user.id, emp.membership);
    const req = (await authed(request(app).post('/api/v1/timesheets/regularization-requests'), emp.token).send({ date: '2026-09-22', account_id: proj.id, hours: 6, reason: 'x' })).body.data;
    const rejected = await authed(request(app).post(`/api/v1/timesheets/regularization-tickets/${req.id}/decision`), manager.token)
      .send({ status: 'rejected', decision_reason: 'Not justified' });
    expect(rejected.status).toBe(200);
    expect(await prisma.timesheetEntry.count({ where: { org_membership_id: emp.membership.id } })).toBe(0);
  });
});
