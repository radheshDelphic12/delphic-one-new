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

async function seedAccountAndRequirement(orgId, ownerId, salesOwnerId) {
  const account = await prisma.account.create({
    data: { type: 'client', name: 'Test Client Co', stage: 'active', owner_id: ownerId, org_id: orgId },
  });
  const requirement = await prisma.requirement.create({
    data: {
      account_id: account.id,
      title: 'Backend Engineer',
      req_type: 'recruitment',
      sales_owner_id: salesOwnerId,
      org_id: orgId,
    },
  });
  return { account, requirement };
}

describe('Phase 3 — new timesheets routes require an active org membership', () => {
  test('a user with no OrgMembership gets 403, not a crash', async () => {
    const user = await createUser({ role: 'recruiter' });
    const { access_token } = await loginAs(user);
    const res = await authed(request(app).get('/api/v1/timesheets/entries/me'), access_token);
    expect(res.status).toBe(403);
  });
});

describe('Phase 3 — logging hours, multi-project allocation', () => {
  test('an employee logs hours against a client account', async () => {
    const { org, admin } = await seedOrgAdmin();
    const { access_token, membership } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    const res = await authed(request(app).post('/api/v1/timesheets/entries'), access_token).send({
      date: '2026-09-10',
      account_id: account.id,
      hours: 8,
      notes: 'Sprint work',
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.data.hours)).toBe(8);
    expect(res.body.data.status).toBe('submitted');
    expect(res.body.data.org_membership_id).toBe(membership.id);
  });

  test('an employee splits one day across two projects (4h + 4h)', async () => {
    const { org, admin } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const { account: accountA } = await seedAccountAndRequirement(org.id, admin.id, admin.id);
    const accountB = await prisma.account.create({
      data: { type: 'client', name: 'Second Client', stage: 'active', owner_id: admin.id, org_id: org.id },
    });

    const a = await authed(request(app).post('/api/v1/timesheets/entries'), access_token).send({
      date: '2026-09-10',
      account_id: accountA.id,
      hours: 4,
    });
    const b = await authed(request(app).post('/api/v1/timesheets/entries'), access_token).send({
      date: '2026-09-10',
      account_id: accountB.id,
      hours: 4,
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const mine = await authed(request(app).get('/api/v1/timesheets/entries/me'), access_token);
    expect(mine.body.data).toHaveLength(2);
  });

  test('total hours logged for one day cannot exceed 24', async () => {
    const { org, admin } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    await authed(request(app).post('/api/v1/timesheets/entries'), access_token).send({
      date: '2026-09-10',
      account_id: account.id,
      hours: 20,
    });
    const overflow = await authed(request(app).post('/api/v1/timesheets/entries'), access_token).send({
      date: '2026-09-10',
      account_id: account.id,
      hours: 5,
    });
    expect(overflow.status).toBe(422);
  });

  test('a requirement must belong to the given account', async () => {
    const { org, admin } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const { account: accountA } = await seedAccountAndRequirement(org.id, admin.id, admin.id);
    const { requirement: reqB } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    const res = await authed(request(app).post('/api/v1/timesheets/entries'), access_token).send({
      date: '2026-09-10',
      account_id: accountA.id,
      requirement_id: reqB.id,
      hours: 4,
    });
    expect(res.status).toBe(404);
  });

  test('an account from a different org is rejected', async () => {
    const { org } = await seedOrgAdmin();
    const orgB = await createOrg({ name: 'Acconcy', slug: 'acconcy' });
    const otherAdmin = await createUser({ role: 'admin' });
    const { account: accountB } = await seedAccountAndRequirement(orgB.id, otherAdmin.id, otherAdmin.id);
    const { access_token } = await seedOrgEmployee(org);

    const res = await authed(request(app).post('/api/v1/timesheets/entries'), access_token).send({
      date: '2026-09-10',
      account_id: accountB.id,
      hours: 4,
    });
    expect(res.status).toBe(404);
  });
});

describe('Phase 3 — approval + editing', () => {
  test('owner can edit hours while still submitted; not after approval', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    const created = await authed(request(app).post('/api/v1/timesheets/entries'), empToken).send({
      date: '2026-09-10',
      account_id: account.id,
      hours: 6,
    });

    const edited = await authed(request(app).patch(`/api/v1/timesheets/entries/${created.body.data.id}`), empToken).send({
      hours: 7,
    });
    expect(edited.status).toBe(200);
    expect(Number(edited.body.data.hours)).toBe(7);

    const decision = await authed(
      request(app).post(`/api/v1/timesheets/entries/${created.body.data.id}/decision`),
      adminToken
    ).send({ status: 'approved' });
    expect(decision.status).toBe(200);

    const editAfter = await authed(request(app).patch(`/api/v1/timesheets/entries/${created.body.data.id}`), empToken).send({
      hours: 8,
    });
    expect(editAfter.status).toBe(409);
  });

  test('a non-admin cannot decide an entry', async () => {
    const { org, admin } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);
    const created = await authed(request(app).post('/api/v1/timesheets/entries'), access_token).send({
      date: '2026-09-10',
      account_id: account.id,
      hours: 6,
    });
    const res = await authed(request(app).post(`/api/v1/timesheets/entries/${created.body.data.id}/decision`), access_token).send({
      status: 'approved',
    });
    expect(res.status).toBe(403);
  });
});

describe('Phase 3 — daily lock + regularization tickets', () => {
  test('admin locks a day; further entries and edits on that day are frozen', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    const entry = await authed(request(app).post('/api/v1/timesheets/entries'), empToken).send({
      date: '2026-09-10',
      account_id: account.id,
      hours: 6,
    });

    const lock = await authed(request(app).post('/api/v1/timesheets/locks'), adminToken).send({ date: '2026-09-10' });
    expect(lock.status).toBe(201);

    const dupLock = await authed(request(app).post('/api/v1/timesheets/locks'), adminToken).send({ date: '2026-09-10' });
    expect(dupLock.status).toBe(409);

    const newEntry = await authed(request(app).post('/api/v1/timesheets/entries'), empToken).send({
      date: '2026-09-10',
      account_id: account.id,
      hours: 2,
    });
    expect(newEntry.status).toBe(409);

    const editAttempt = await authed(request(app).patch(`/api/v1/timesheets/entries/${entry.body.data.id}`), empToken).send({
      hours: 7,
    });
    expect(editAttempt.status).toBe(409);
  });

  test('a regularization ticket is required (and only valid) for a locked day, and approving it applies the change', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    const entry = await authed(request(app).post('/api/v1/timesheets/entries'), empToken).send({
      date: '2026-09-10',
      account_id: account.id,
      hours: 6,
    });

    // Before the day is locked, a ticket is rejected — just edit directly.
    const tooEarly = await authed(
      request(app).post(`/api/v1/timesheets/entries/${entry.body.data.id}/regularization-tickets`),
      empToken
    ).send({ requested_change: { hours: 7 }, reason: 'Forgot 1h' });
    expect(tooEarly.status).toBe(422);

    await authed(request(app).post('/api/v1/timesheets/locks'), adminToken).send({ date: '2026-09-10' });

    const ticket = await authed(
      request(app).post(`/api/v1/timesheets/entries/${entry.body.data.id}/regularization-tickets`),
      empToken
    ).send({ requested_change: { hours: 7, notes: 'Corrected' }, reason: 'Forgot 1h of client call' });
    expect(ticket.status).toBe(201);
    expect(ticket.body.data.status).toBe('pending');

    const list = await authed(request(app).get('/api/v1/timesheets/regularization-tickets'), adminToken);
    expect(list.body.data).toHaveLength(1);

    const decision = await authed(
      request(app).post(`/api/v1/timesheets/regularization-tickets/${ticket.body.data.id}/decision`),
      adminToken
    ).send({ status: 'approved', decision_reason: 'Verified with client' });
    expect(decision.status).toBe(200);

    const entryAfter = await prisma.timesheetEntry.findUnique({ where: { id: entry.body.data.id } });
    expect(Number(entryAfter.hours)).toBe(7);
    expect(entryAfter.notes).toBe('Corrected');

    const reDecide = await authed(
      request(app).post(`/api/v1/timesheets/regularization-tickets/${ticket.body.data.id}/decision`),
      adminToken
    ).send({ status: 'approved' });
    expect(reDecide.status).toBe(409);
  });

  test('a rejected ticket does not change the entry', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    const entry = await authed(request(app).post('/api/v1/timesheets/entries'), empToken).send({
      date: '2026-09-10',
      account_id: account.id,
      hours: 6,
    });
    await authed(request(app).post('/api/v1/timesheets/locks'), adminToken).send({ date: '2026-09-10' });
    const ticket = await authed(
      request(app).post(`/api/v1/timesheets/entries/${entry.body.data.id}/regularization-tickets`),
      empToken
    ).send({ requested_change: { hours: 20 }, reason: 'Trying to overreport' });

    await authed(request(app).post(`/api/v1/timesheets/regularization-tickets/${ticket.body.data.id}/decision`), adminToken).send({
      status: 'rejected',
      decision_reason: 'Not credible',
    });

    const entryAfter = await prisma.timesheetEntry.findUnique({ where: { id: entry.body.data.id } });
    expect(Number(entryAfter.hours)).toBe(6);
  });

  test('a non-admin cannot lock a day', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const res = await authed(request(app).post('/api/v1/timesheets/locks'), access_token).send({ date: '2026-09-10' });
    expect(res.status).toBe(403);
  });
});

describe('Phase 3 — admin team view', () => {
  test('admin lists every entry across employees for the org', async () => {
    const { org, admin, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const { account } = await seedAccountAndRequirement(org.id, admin.id, admin.id);

    await authed(request(app).post('/api/v1/timesheets/entries'), empToken).send({
      date: '2026-09-10',
      account_id: account.id,
      hours: 5,
    });

    const team = await authed(request(app).get('/api/v1/timesheets/entries'), adminToken);
    expect(team.status).toBe(200);
    expect(team.body.data).toHaveLength(1);
    expect(team.body.data[0].org_membership.person.id).not.toBe(admin.id);
  });

  test('a non-admin cannot list the team view', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const res = await authed(request(app).get('/api/v1/timesheets/entries'), access_token);
    expect(res.status).toBe(403);
  });
});
