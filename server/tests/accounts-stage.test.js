const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

let bdaToken;

beforeEach(async () => {
  await cleanDatabase();
  const bda = await createUser({ role: 'bda' });
  ({ access_token: bdaToken } = await loginAs(bda));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createAccount() {
  const res = await authed(request(app).post('/api/v1/accounts'), bdaToken).send({ type: 'client', name: 'Acme Corp' });
  return res.body.data;
}

describe('account stage machine', () => {
  test('new accounts start as lead', async () => {
    const account = await createAccount();
    expect(account.stage).toBe('lead');
    expect(account.is_locked).toBe(false);
  });

  test('cannot skip straight from lead to active', async () => {
    const account = await createAccount();
    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({ to_stage: 'active' });
    expect(res.status).toBe(400);
  });

  test('meeting_scheduled requires meeting_mode and meeting_date', async () => {
    const account = await createAccount();
    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
    });
    expect(res.status).toBe(400);
  });

  test('offline meeting requires meeting_location', async () => {
    const account = await createAccount();
    const missing = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'offline',
      meeting_date: new Date().toISOString(),
    });
    expect(missing.status).toBe(400);

    const withLocation = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'offline',
      meeting_date: new Date().toISOString(),
      meeting_location: 'Client HQ, Block A',
    });
    expect(withLocation.status).toBe(200);
    expect(withLocation.body.data.meeting_location).toBe('Client HQ, Block A');
  });

  test('online meeting does not require meeting_location; meeting attendees are recorded', async () => {
    const account = await createAccount();
    const sales1 = await createUser({ role: 'sales' });
    const sales2 = await createUser({ role: 'sales' });

    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
      meeting_attendee_ids: [sales1.id, sales2.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.meeting_attendees).toHaveLength(2);
    expect(res.body.data.meeting_attendees.map((a) => a.id).sort()).toEqual([sales1.id, sales2.id].sort());
  });

  test('dropping requires a reason', async () => {
    const account = await createAccount();
    // lead cannot drop — move to meeting_scheduled first so the reason rule is what we hit
    await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
    });
    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({ to_stage: 'dropped' });
    expect(res.status).toBe(400);
  });

  test('full valid path lead -> meeting_scheduled -> active, then history records every step', async () => {
    const account = await createAccount();

    const toMeeting = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
    });
    expect(toMeeting.status).toBe(200);
    expect(toMeeting.body.data.stage).toBe('meeting_scheduled');

    const toActive = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'active',
    });
    expect(toActive.status).toBe(200);
    expect(toActive.body.data.stage).toBe('active');

    const history = await authed(request(app).get(`/api/v1/accounts/${account.id}/history`), bdaToken);
    expect(history.status).toBe(200);
    expect(history.body.data.map((h) => h.to_stage)).toEqual(['meeting_scheduled', 'active']);
  });

  test('rescheduled loops back to meeting_scheduled', async () => {
    const account = await createAccount();
    const toOfflineMeeting = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'offline',
      meeting_date: new Date().toISOString(),
      meeting_location: 'Client office, Sector 5',
    });
    expect(toOfflineMeeting.status).toBe(200);

    // reason is optional for 'rescheduled' per accounts.validation.js — only 'dropped' requires one
    const reschedule = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'rescheduled',
    });
    expect(reschedule.status).toBe(200);
    expect(reschedule.body.data.stage).toBe('rescheduled');

    // looping back to meeting_scheduled still requires the meeting fields
    const missingFields = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
    });
    expect(missingFields.status).toBe(400);

    const withFields = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
    });
    expect(withFields.status).toBe(200);
  });

  test('dropped account cannot transition anywhere else, even with a reason', async () => {
    const account = await createAccount();
    await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
    });
    const drop = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'dropped',
      reason: 'not interested',
    });
    expect(drop.status).toBe(200);
    expect(drop.body.data.is_locked).toBe(true);

    const tryAgain = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
    });
    // locked check runs before transition validity → 403, not 400
    expect(tryAgain.status).toBe(403);
  });
});

describe('lead classification (client/vendor undecided at creation)', () => {
  test('a lead can be created without a type, then classified', async () => {
    const create = await authed(request(app).post('/api/v1/accounts'), bdaToken).send({
      name: 'Undecided Co',
      location: 'Pune, India',
      linkedin_url: 'https://linkedin.com/company/undecided-co',
    });
    expect(create.status).toBe(201);
    expect(create.body.data.type).toBeNull();

    const classify = await authed(request(app).post(`/api/v1/accounts/${create.body.data.id}/classify`), bdaToken).send({
      type: 'vendor',
    });
    expect(classify.status).toBe(200);
    expect(classify.body.data.type).toBe('vendor');
    expect(classify.body.data.classified_at).toBeTruthy();

    const history = await authed(request(app).get(`/api/v1/accounts/${create.body.data.id}/history`), bdaToken);
    expect(history.body.data.map((h) => h.to_stage)).toContain('vendor');

    const again = await authed(request(app).post(`/api/v1/accounts/${create.body.data.id}/classify`), bdaToken).send({
      type: 'client',
    });
    expect(again.status).toBe(400);
  });
});
