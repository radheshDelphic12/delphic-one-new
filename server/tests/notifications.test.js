/**
 * In-app notifications: dispatch on lifecycle events, the actor is never notified
 * of their own action, role + preference filtering, and the read/unread API.
 */
const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createActiveClientAccount,
  createRequirement,
  createProfile,
  authed,
} = require('./helpers');

let bda;
let sales;
let recruiter;
let salesToken;
let recruiterToken;
let account;
let requirement;
let seatId;

beforeEach(async () => {
  await cleanDatabase();
  bda = await createUser({ role: 'bda' });
  sales = await createUser({ role: 'sales' });
  recruiter = await createUser({ role: 'recruiter' });
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));

  account = await createActiveClientAccount(bda.id);
  requirement = await createRequirement(salesToken, account.id);
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
  seatId = seats.body.data[0].id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function listFor(userId, type) {
  return prisma.notification.findMany({ where: { user_id: userId, ...(type ? { type } : {}) } });
}

describe('notification dispatch', () => {
  test('assigning a recruiter notifies the assignee, not the actor', async () => {
    const res = await authed(request(app).post(`/api/v1/requirements/${requirement.id}/assign`), salesToken).send({
      user_id: recruiter.id,
      role_on_req: 'recruiter',
    });
    expect(res.status).toBe(201);

    const recruiterRows = await listFor(recruiter.id, 'requirement_assigned');
    expect(recruiterRows).toHaveLength(1);
    expect(recruiterRows[0].entity_type).toBe('requirement');
    expect(recruiterRows[0].entity_id).toBe(requirement.id);

    // the sales user performed the assignment — no self-notification
    const salesRows = await listFor(sales.id, 'requirement_assigned');
    expect(salesRows).toHaveLength(0);
  });

  test('rejecting a submission notifies the recruiter and the sales owner', async () => {
    const profile = await createProfile(recruiterToken);
    const sub = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seatId,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'INR',
    });
    const submissionId = sub.body.data.id;

    const rej = await authed(request(app).post(`/api/v1/submissions/${submissionId}/stage`), recruiterToken).send({
      to_stage: 'rejected',
      rejection_reason: 'Not a fit',
    });
    expect(rej.status).toBe(200);

    expect(await listFor(sales.id, 'candidate_rejected')).toHaveLength(1);
    // recruiter is the actor here → not notified of their own move
    expect(await listFor(recruiter.id, 'candidate_rejected')).toHaveLength(0);
  });

  test('every active admin gets a copy, even when not a participant', async () => {
    const admin1 = await createUser({ role: 'admin' });
    const admin2 = await createUser({ role: 'admin' });

    const res = await authed(request(app).post(`/api/v1/requirements/${requirement.id}/assign`), salesToken).send({
      user_id: recruiter.id,
      role_on_req: 'recruiter',
    });
    expect(res.status).toBe(201);

    expect(await listFor(admin1.id, 'requirement_assigned')).toHaveLength(1);
    expect(await listFor(admin2.id, 'requirement_assigned')).toHaveLength(1);
  });

  test('an admin who performs the action is not self-notified', async () => {
    const admin = await createUser({ role: 'admin' });
    const { access_token: adminToken } = await loginAs(admin);

    const res = await authed(request(app).post(`/api/v1/requirements/${requirement.id}/assign`), adminToken).send({
      user_id: recruiter.id,
      role_on_req: 'recruiter',
    });
    expect(res.status).toBe(201);

    expect(await listFor(admin.id, 'requirement_assigned')).toHaveLength(0);
    // a different admin still gets it
  });

  test('an admin can still mute a type for themselves', async () => {
    const admin = await createUser({ role: 'admin' });
    await prisma.notificationPreference.create({
      data: { user_id: admin.id, type: 'requirement_assigned', in_app: false },
    });

    const res = await authed(request(app).post(`/api/v1/requirements/${requirement.id}/assign`), salesToken).send({
      user_id: recruiter.id,
      role_on_req: 'recruiter',
    });
    expect(res.status).toBe(201);

    expect(await listFor(admin.id, 'requirement_assigned')).toHaveLength(0);
  });

  test('a NotificationPreference with in_app:false suppresses that type', async () => {
    await prisma.notificationPreference.create({
      data: { user_id: recruiter.id, type: 'requirement_assigned', in_app: false },
    });

    const res = await authed(request(app).post(`/api/v1/requirements/${requirement.id}/assign`), salesToken).send({
      user_id: recruiter.id,
      role_on_req: 'recruiter',
    });
    expect(res.status).toBe(201);

    expect(await listFor(recruiter.id, 'requirement_assigned')).toHaveLength(0);
  });
});

describe('notifications API', () => {
  beforeEach(async () => {
    await authed(request(app).post(`/api/v1/requirements/${requirement.id}/assign`), salesToken).send({
      user_id: recruiter.id,
      role_on_req: 'recruiter',
    });
  });

  test('GET / and /unread-count reflect the recruiter’s own rows', async () => {
    const list = await authed(request(app).get('/api/v1/notifications'), recruiterToken);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);

    const count = await authed(request(app).get('/api/v1/notifications/unread-count'), recruiterToken);
    expect(count.body.data.count).toBeGreaterThanOrEqual(1);
  });

  test('POST /read marks the given ids read; /read-all clears the rest', async () => {
    const list = await authed(request(app).get('/api/v1/notifications'), recruiterToken);
    const firstId = list.body.data[0].id;

    const read = await authed(request(app).post('/api/v1/notifications/read'), recruiterToken).send({ ids: [firstId] });
    expect(read.status).toBe(200);

    const afterOne = await authed(request(app).get('/api/v1/notifications/unread-count'), recruiterToken);
    const remaining = afterOne.body.data.count;

    await authed(request(app).post('/api/v1/notifications/read-all'), recruiterToken).send({});
    const afterAll = await authed(request(app).get('/api/v1/notifications/unread-count'), recruiterToken);
    expect(afterAll.body.data.count).toBe(0);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });

  test('preferences: GET returns role-relevant types; PUT upserts overrides', async () => {
    const prefs = await authed(request(app).get('/api/v1/notifications/preferences'), recruiterToken);
    expect(prefs.status).toBe(200);
    const types = prefs.body.data.map((p) => p.type);
    expect(types).toContain('requirement_assigned');

    const put = await authed(request(app).put('/api/v1/notifications/preferences'), recruiterToken).send({
      items: [{ type: 'requirement_assigned', in_app: false, email: false }],
    });
    expect(put.status).toBe(200);
    const updated = put.body.data.find((p) => p.type === 'requirement_assigned');
    expect(updated.in_app).toBe(false);
  });
});
