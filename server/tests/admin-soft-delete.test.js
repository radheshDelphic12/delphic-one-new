const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createRequirement,
  createProfile,
  authed,
  unique,
  PASSWORD,
} = require('./helpers');

let superUser;
let superToken;
let adminToken;
let bda;
let sales;
let salesToken;
let recruiterToken;

beforeEach(async () => {
  await cleanDatabase();
  superUser = await createUser({ role: 'admin', is_superadmin: true, name: 'Root' });
  const admin = await createUser({ role: 'admin', is_superadmin: false });
  bda = await createUser({ role: 'bda' });
  sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  ({ access_token: superToken } = await loginAs(superUser));
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
});

afterAll(async () => {
  await prisma.$disconnect();
});

function makeAccount(overrides = {}) {
  return prisma.account.create({
    data: {
      type: 'vendor',
      name: unique('Vendor '),
      stage: 'active',
      owner_id: bda.id,
      origin_owner_id: bda.id,
      ...overrides,
    },
  });
}

const del = (type, id, token, body) =>
  authed(request(app).post(`/api/v1/admin/${type}/${id}/delete`), token).send(body);

describe('superadmin soft-delete', () => {
  test('superadmin + correct password soft-deletes an account and audits it', async () => {
    const account = await makeAccount();

    const res = await del('account', account.id, superToken, { password: PASSWORD, reason: 'Duplicate vendor entry' });
    expect(res.status).toBe(200);

    // Hidden from the list + detail endpoints.
    const list = await authed(request(app).get('/api/v1/accounts'), superToken);
    expect(list.body.data.some((a) => a.id === account.id)).toBe(false);
    const detail = await authed(request(app).get(`/api/v1/accounts/${account.id}`), superToken);
    expect(detail.status).toBe(404);

    // Row retained, stamped.
    const row = await prisma.account.findFirst({ where: { id: account.id, deleted_at: { not: null } } });
    expect(row).not.toBeNull();
    expect(row.deleted_by).toBe(superUser.id);
    expect(row.delete_reason).toBe('Duplicate vendor entry');

    // Audit trail with a snapshot.
    const audit = await prisma.auditLog.findMany({ where: { entity_type: 'account', entity_id: account.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('soft_delete');
    expect(audit[0].snapshot.name).toBe(row.name);
  });

  test('wrong password is rejected and leaves the row intact', async () => {
    const account = await makeAccount();
    const res = await del('account', account.id, superToken, { password: 'not-my-password', reason: 'oops' });
    expect(res.status).toBe(401);

    const still = await authed(request(app).get(`/api/v1/accounts/${account.id}`), superToken);
    expect(still.status).toBe(200);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  test('a non-superadmin admin cannot delete', async () => {
    const account = await makeAccount();
    const res = await del('account', account.id, adminToken, { password: PASSWORD, reason: 'nope' });
    expect(res.status).toBe(403);
  });

  test('reason is required', async () => {
    const account = await makeAccount();
    const res = await del('account', account.id, superToken, { password: PASSWORD });
    expect(res.status).toBe(422);
  });

  test('deleting an already-deleted record returns 409', async () => {
    const account = await makeAccount();
    await del('account', account.id, superToken, { password: PASSWORD, reason: 'first' });
    const again = await del('account', account.id, superToken, { password: PASSWORD, reason: 'second' });
    expect(again.status).toBe(409);
  });

  test('restore brings the record back and adds a second audit row', async () => {
    const account = await makeAccount();
    await del('account', account.id, superToken, { password: PASSWORD, reason: 'dup' });

    const res = await authed(request(app).post(`/api/v1/admin/account/${account.id}/restore`), superToken).send({
      reason: 'brought back',
    });
    expect(res.status).toBe(200);

    const detail = await authed(request(app).get(`/api/v1/accounts/${account.id}`), superToken);
    expect(detail.status).toBe(200);

    const audit = await prisma.auditLog.findMany({
      where: { entity_type: 'account', entity_id: account.id },
      orderBy: { created_at: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(['soft_delete', 'restore']);

    const restoreOnLive = await authed(request(app).post(`/api/v1/admin/account/${account.id}/restore`), superToken).send({
      reason: 'again',
    });
    expect(restoreOnLive.status).toBe(409);
  });

  test('response carries live-dependency counts', async () => {
    const account = await prisma.account.create({
      data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: sales.id, origin_owner_id: sales.id },
    });
    await createRequirement(salesToken, account.id);

    const res = await del('account', account.id, superToken, { password: PASSWORD, reason: 'merge' });
    expect(res.status).toBe(200);
    expect(res.body.data.dependency.requirements).toBe(1);
  });

  test('a soft-deleted submission drops out of the submissions list and count', async () => {
    const account = await prisma.account.create({
      data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: sales.id, origin_owner_id: sales.id },
    });
    const requirement = await createRequirement(salesToken, account.id);
    const profile = await createProfile(recruiterToken);
    const seat = await prisma.requirementSeat.findFirst({ where: { requirement_id: requirement.id } });
    const submission = await prisma.submission.create({
      data: { requirement_seat_id: seat.id, profile_id: profile.id, submitted_by: sales.id },
    });

    const before = await authed(request(app).get('/api/v1/submissions'), superToken);
    expect(before.body.data.some((s) => s.id === submission.id)).toBe(true);

    const res = await del('submission', submission.id, superToken, { password: PASSWORD, reason: 'test dup' });
    expect(res.status).toBe(200);

    const after = await authed(request(app).get('/api/v1/submissions'), superToken);
    expect(after.body.data.some((s) => s.id === submission.id)).toBe(false);
  });

  test('unknown entity_type is rejected', async () => {
    const account = await makeAccount();
    const res = await del('widget', account.id, superToken, { password: PASSWORD, reason: 'x' });
    expect(res.status).toBe(422);
  });

  test('GET /admin/deleted lists deleted rows with the deleter name; /admin/audit shows both actions', async () => {
    const account = await makeAccount({ name: 'Dupe Co' });
    await del('account', account.id, superToken, { password: PASSWORD, reason: 'dupe' });
    await authed(request(app).post(`/api/v1/admin/account/${account.id}/restore`), superToken).send({ reason: 'undo' });
    await del('account', account.id, superToken, { password: PASSWORD, reason: 'dupe again' });

    const deleted = await authed(request(app).get('/api/v1/admin/deleted'), superToken);
    expect(deleted.status).toBe(200);
    const entry = deleted.body.data.find((r) => r.entity_id === account.id);
    expect(entry).toMatchObject({ entity_type: 'account', name: 'Dupe Co', deleted_by_name: 'Root', delete_reason: 'dupe again' });

    const audit = await authed(request(app).get('/api/v1/admin/audit'), superToken);
    expect(audit.status).toBe(200);
    const forAccount = audit.body.data.filter((r) => r.entity_id === account.id);
    expect(forAccount.map((r) => r.action)).toEqual(['soft_delete', 'restore', 'soft_delete']);
    expect(forAccount[0].actor_name).toBe('Root');
    expect(forAccount[0].name).toBe('Dupe Co');
  });

  test('/admin/deleted and /admin/audit are superadmin-only', async () => {
    const a = await authed(request(app).get('/api/v1/admin/deleted'), adminToken);
    const b = await authed(request(app).get('/api/v1/admin/audit'), adminToken);
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
  });

  test('a deletion shows up in the dashboard recent activity feed', async () => {
    const account = await makeAccount({ name: 'Feed Co' });
    await del('account', account.id, superToken, { password: PASSWORD, reason: 'cleanup' });

    const dash = await authed(request(app).get('/api/v1/dashboard/summary'), superToken);
    expect(dash.status).toBe(200);
    const hit = (dash.body.data.recent_activity || []).find(
      (e) => e.entity_id === account.id && /deleted account/.test(e.action)
    );
    expect(hit).toBeTruthy();
    expect(hit.action).toContain('cleanup');
  });
});
