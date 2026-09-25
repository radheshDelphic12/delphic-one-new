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

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedOrgAdmin() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, access_token };
}

async function seedOrgEmployee(org, role = 'recruiter') {
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role });
  const { access_token } = await loginAs(user);
  return { user, membership, access_token };
}

describe('Phase 2 — new ERP routes require an active org membership', () => {
  test('a user with no OrgMembership gets 403, not a crash, on every new module', async () => {
    const user = await createUser({ role: 'recruiter' });
    const { access_token } = await loginAs(user);

    const endpoints = [
      () => authed(request(app).get('/api/v1/calendars'), access_token),
      () => authed(request(app).get('/api/v1/attendance/me'), access_token),
      () => authed(request(app).get('/api/v1/leave/types'), access_token),
    ];
    for (const call of endpoints) {
      const res = await call();
      expect(res.status).toBe(403);
    }
  });
});

describe('Phase 2 — calendars', () => {
  test('admin creates a calendar, adds a holiday, assigns it to an employee', async () => {
    const { org, access_token } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);

    const cal = await authed(request(app).post('/api/v1/calendars'), access_token).send({
      name: 'Delphic Standard',
      kind: 'internal',
      is_default: true,
    });
    expect(cal.status).toBe(201);

    const holiday = await authed(request(app).post(`/api/v1/calendars/${cal.body.data.id}/holidays`), access_token).send({
      date: '2026-10-02',
      label: 'Gandhi Jayanti',
    });
    expect(holiday.status).toBe(201);

    const dup = await authed(request(app).post(`/api/v1/calendars/${cal.body.data.id}/holidays`), access_token).send({
      date: '2026-10-02',
      label: 'Gandhi Jayanti (dup)',
    });
    expect(dup.status).toBe(409);

    const assign = await authed(request(app).post(`/api/v1/calendars/${cal.body.data.id}/assign`), access_token).send({
      org_membership_id: membership.id,
    });
    expect(assign.status).toBe(200);
    expect(assign.body.data.calendar_id).toBe(cal.body.data.id);

    const list = await authed(request(app).get('/api/v1/calendars'), access_token);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]._count.holidays).toBe(1);
  });

  test('a non-admin cannot create a calendar', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const res = await authed(request(app).post('/api/v1/calendars'), access_token).send({ name: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('Phase 2 — attendance', () => {
  test('check-in then check-out records both timestamps for today', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);

    const ci = await authed(request(app).post('/api/v1/attendance/check-in'), access_token);
    expect(ci.status).toBe(201);
    expect(ci.body.data.check_in_at).toBeTruthy();
    expect(ci.body.data.check_out_at).toBeNull();

    const dup = await authed(request(app).post('/api/v1/attendance/check-in'), access_token);
    expect(dup.status).toBe(409);

    const co = await authed(request(app).post('/api/v1/attendance/check-out'), access_token);
    expect(co.status).toBe(200);
    expect(co.body.data.check_out_at).toBeTruthy();

    const dupOut = await authed(request(app).post('/api/v1/attendance/check-out'), access_token);
    expect(dupOut.status).toBe(409);

    const mine = await authed(request(app).get('/api/v1/attendance/me'), access_token);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
  });

  test('check-out without a check-in is rejected', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const res = await authed(request(app).post('/api/v1/attendance/check-out'), access_token);
    expect(res.status).toBe(409);
  });

  test('admin can list the whole team and regularize a record', async () => {
    const { org, access_token: adminToken, admin } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    await authed(request(app).post('/api/v1/attendance/check-in'), empToken);

    const team = await authed(request(app).get('/api/v1/attendance'), adminToken);
    expect(team.status).toBe(200);
    expect(team.body.data).toHaveLength(1);
    expect(team.body.data[0].org_membership.person.id).not.toBe(admin.id);

    const record = team.body.data[0];
    const reg = await authed(request(app).post(`/api/v1/attendance/${record.id}/regularize`), adminToken).send({
      status: 'wfh',
      reason: 'Forgot to check out, confirmed WFH via Slack',
    });
    expect(reg.status).toBe(200);
    expect(reg.body.data.status).toBe('wfh');
    expect(reg.body.data.regularized_by).toBe(admin.id);
  });

  test('a non-admin cannot list the team', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const res = await authed(request(app).get('/api/v1/attendance'), access_token);
    expect(res.status).toBe(403);
  });
});

describe('Phase 2 — leave', () => {
  async function seedLeaveType(adminToken) {
    const res = await authed(request(app).post('/api/v1/leave/types'), adminToken).send({
      name: 'Earned Leave',
      paid: true,
      annual_quota: 18,
    });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  test('employee requests leave, admin approves it, balance is updated', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken, membership } = await seedOrgEmployee(org);
    const leaveType = await seedLeaveType(adminToken);

    const request1 = await authed(request(app).post('/api/v1/leave/requests'), empToken).send({
      leave_type_id: leaveType.id,
      from_date: '2026-10-10',
      to_date: '2026-10-12',
      reason: 'Family function',
    });
    expect(request1.status).toBe(201);
    expect(request1.body.data.status).toBe('pending');

    const mine = await authed(request(app).get('/api/v1/leave/requests/me'), empToken);
    expect(mine.body.data).toHaveLength(1);

    const team = await authed(request(app).get('/api/v1/leave/requests'), adminToken).query({ status: 'pending' });
    expect(team.body.data).toHaveLength(1);

    const decision = await authed(
      request(app).post(`/api/v1/leave/requests/${request1.body.data.id}/decision`),
      adminToken
    ).send({ status: 'approved' });
    expect(decision.status).toBe(200);
    expect(decision.body.data.status).toBe('approved');

    // Balances are computed live from approved requests (Phase 3): Oct 10-12
    // 2026 inclusive is 3 days, still ahead of today, so it shows as upcoming.
    const balances = await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), empToken);
    const balance = balances.body.data.find((item) => item.leave_type_id === leaveType.id);
    expect(balance).toMatchObject({ allocated: 18, used: 0, upcoming: 3, pending: 0, remaining: 15 });
    expect(membership.id).toBeTruthy();

    const reDecide = await authed(
      request(app).post(`/api/v1/leave/requests/${request1.body.data.id}/decision`),
      adminToken
    ).send({ status: 'approved' });
    expect(reDecide.status).toBe(409);
  });

  test('half-day leave persists its session and consumes half a balance day', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken, membership } = await seedOrgEmployee(org);
    const leaveType = await seedLeaveType(adminToken);

    const missingSession = await authed(request(app).post('/api/v1/leave/requests'), empToken).send({
      leave_type_id: leaveType.id,
      from_date: '2026-12-01',
      to_date: '2026-12-01',
      is_half_day: true,
    });
    expect(missingSession.status).toBe(422);

    const created = await authed(request(app).post('/api/v1/leave/requests'), empToken).send({
      leave_type_id: leaveType.id,
      from_date: '2026-12-01',
      to_date: '2026-12-01',
      is_half_day: true,
      half_day_session: 'SECOND_HALF',
      reason: 'Personal appointment',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.is_half_day).toBe(true);
    expect(created.body.data.half_day_session).toBe('SECOND_HALF');

    const decision = await authed(
      request(app).post(`/api/v1/leave/requests/${created.body.data.id}/decision`),
      adminToken
    ).send({ status: 'approved' });
    expect(decision.status).toBe(200);

    const balances = await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), empToken);
    const balance = balances.body.data.find((item) => item.leave_type_id === leaveType.id);
    expect(balance.used + balance.upcoming).toBe(0.5); // half a day, whichever side of today it falls
    expect(balance.remaining).toBe(17.5);
    expect(membership.id).toBeTruthy();
  });

  test('employee can read a leave balance breakdown for the current year', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken, membership } = await seedOrgEmployee(org);
    const leaveType = await seedLeaveType(adminToken);

    // An admin-set entitlement of 10, and 3 approved days already taken in January.
    await prisma.leaveBalance.create({
      data: { org_membership_id: membership.id, leave_type_id: leaveType.id, year: 2026, allocated: 10 },
    });
    await prisma.leaveRequest.create({
      data: {
        org_id: org.id,
        org_membership_id: membership.id,
        leave_type_id: leaveType.id,
        from_date: new Date('2026-01-12'),
        to_date: new Date('2026-01-14'),
        status: 'approved',
      },
    });

    const response = await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), empToken);
    expect(response.status).toBe(200);
    const balance = response.body.data.find((item) => item.leave_type_id === leaveType.id);
    expect(balance).toMatchObject({
      leave_type_name: 'Earned Leave',
      code: 'EL',
      allocated: 10,
      used: 3,
      upcoming: 0,
      remaining: 7,
      customised: true,
    });
  });

  test('employee can cancel their own pending request but not after it is decided', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const leaveType = await seedLeaveType(adminToken);

    const created = await authed(request(app).post('/api/v1/leave/requests'), empToken).send({
      leave_type_id: leaveType.id,
      from_date: '2026-11-01',
      to_date: '2026-11-01',
    });

    const cancelled = await authed(
      request(app).post(`/api/v1/leave/requests/${created.body.data.id}/cancel`),
      empToken
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('cancelled');

    const cancelAgain = await authed(
      request(app).post(`/api/v1/leave/requests/${created.body.data.id}/cancel`),
      empToken
    );
    expect(cancelAgain.status).toBe(409);
  });

  test('from_date after to_date is rejected by validation', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const leaveType = await seedLeaveType(adminToken);

    const res = await authed(request(app).post('/api/v1/leave/requests'), empToken).send({
      leave_type_id: leaveType.id,
      from_date: '2026-11-05',
      to_date: '2026-11-01',
    });
    expect(res.status).toBe(422);
  });
});
