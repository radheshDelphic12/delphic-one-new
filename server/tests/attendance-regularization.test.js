// Attendance regularization: an employee requests a correction for a day, an admin reviews it.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const base = '/api/v1/attendance/regularization-requests';
const d = (s) => new Date(`${s}T00:00:00.000Z`);

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('d-') });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const empUser = await createUser({ role: 'employee' });
  const membership = await createOrgMembership(empUser.id, org.id, { role: 'employee', joined_at: d('2026-01-01') });
  const token = (await loginAs(empUser)).access_token;
  const otherUser = await createUser({ role: 'employee' });
  await createOrgMembership(otherUser.id, org.id, { role: 'employee' });
  const otherToken = (await loginAs(otherUser)).access_token;
  return { org, adminUser, adminToken, membership, token, otherToken };
}

const ask = (ctx, body, token = ctx.token) => authed(request(app).post(base), token).send({ date: '2026-10-05', status: 'present', check_in_time: '09:30', check_out_time: '18:30', reason: 'forgot to punch', ...body });
const decide = (ctx, id, body) => authed(request(app).post(`${base}/${id}/decision`), ctx.adminToken).send(body);
const day = (ctx, date) => prisma.attendanceRecord.findFirst({ where: { org_membership_id: ctx.membership.id, date: d(date) } });

describe('raising a request', () => {
  test('an employee asks for a correction; it is pending and shows in their own list, not in the other person\'s', async () => {
    const ctx = await seed();
    const res = await ask(ctx, {});
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'pending', date: '2026-10-05', requested_status: 'present', check_in_time: '09:30' });
    expect((await authed(request(app).get(`${base}/mine`), ctx.token)).body.data).toHaveLength(1);
    expect((await authed(request(app).get(`${base}/mine`), ctx.otherToken)).body.data).toHaveLength(0);
  });

  test('refused: a future date, a second pending request for the same day, a check-out without a check-in, a locked month', async () => {
    const ctx = await seed();
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    expect((await ask(ctx, { date: future })).status).toBe(422);
    expect((await ask(ctx, { check_in_time: null })).status).toBe(422);
    expect((await ask(ctx, {})).status).toBe(201);
    expect((await ask(ctx, {})).status).toBe(409);
    await prisma.timesheetMonthLock.create({ data: { org_id: ctx.org.id, org_membership_id: ctx.membership.id, period_month: 9, period_year: 2026, locked_by: ctx.adminUser.id } });
    const locked = await ask(ctx, { date: '2026-09-10' });
    expect(locked.status).toBe(409);
    expect(locked.body.message).toMatch(/locked/i);
  });
});

describe('the admin review', () => {
  test('only an admin sees everyone\'s requests, with the day as it is now and the pending count', async () => {
    const ctx = await seed();
    await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: ctx.membership.id, date: d('2026-10-05'), status: 'absent', source: 'manual' } });
    await ask(ctx, {});
    expect((await authed(request(app).get(base), ctx.token)).status).toBe(403);
    const list = await authed(request(app).get(base).query({ status: 'pending' }), ctx.adminToken);
    expect(list.status).toBe(200);
    expect(list.body.pending).toBe(1);
    expect(list.body.data[0]).toMatchObject({ date: '2026-10-05', requested_status: 'present', current: { status: 'absent' } });
  });

  test('approving writes the day (manual, regularised by the admin) and cannot be done twice; an employee cannot decide', async () => {
    const ctx = await seed();
    const id = (await ask(ctx, {})).body.data.id;
    expect((await authed(request(app).post(`${base}/${id}/decision`), ctx.token).send({ status: 'approved' })).status).toBe(403);
    const res = await decide(ctx, id, { status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    const record = await day(ctx, '2026-10-05');
    expect(record).toMatchObject({ status: 'present', source: 'manual', regularized_by: ctx.adminUser.id });
    expect(record.regularized_reason).toContain('forgot to punch');
    expect(record.check_in_at).toBeTruthy();
    expect((await decide(ctx, id, { status: 'approved' })).status).toBe(409);
  });

  test('rejecting changes nothing on the day', async () => {
    const ctx = await seed();
    const id = (await ask(ctx, {})).body.data.id;
    const res = await decide(ctx, id, { status: 'rejected', decision_reason: 'no proof' });
    expect(res.body.data).toMatchObject({ status: 'rejected', decision_reason: 'no proof' });
    expect(await day(ctx, '2026-10-05')).toBeNull();
  });

  test('a request that cannot be applied (the person is on approved leave that day) stays pending with a clear reason', async () => {
    const ctx = await seed();
    const cl = await prisma.leaveType.create({ data: { org_id: ctx.org.id, name: 'Casual Leave', paid: true, annual_quota: 12 } }).catch(() => null);
    const type = cl || (await prisma.leaveType.findFirst({ where: { org_id: ctx.org.id } }));
    await prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: ctx.membership.id, leave_type_id: type.id, from_date: d('2026-10-05'), to_date: d('2026-10-05'), status: 'approved' } });
    const id = (await ask(ctx, {})).body.data.id;
    const res = await decide(ctx, id, { status: 'approved' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/leave/i);
    expect((await prisma.attendanceRegularizationRequest.findUnique({ where: { id } })).status).toBe('pending');
  });

  test('a month locked after the request was made blocks the approval', async () => {
    const ctx = await seed();
    const id = (await ask(ctx, {})).body.data.id;
    await prisma.timesheetMonthLock.create({ data: { org_id: ctx.org.id, org_membership_id: ctx.membership.id, period_month: 10, period_year: 2026, locked_by: ctx.adminUser.id } });
    expect((await decide(ctx, id, { status: 'approved' })).status).toBe(409);
    expect(await day(ctx, '2026-10-05')).toBeNull();
  });
});
