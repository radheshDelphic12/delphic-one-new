const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

let bda;
let bdaToken;

beforeEach(async () => {
  await cleanDatabase();
  bda = await createUser({ role: 'bda' });
  ({ access_token: bdaToken } = await loginAs(bda));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createAccount() {
  const res = await authed(request(app).post('/api/v1/accounts'), bdaToken).send({ type: 'client', name: 'Acme Corp' });
  return res.body.data;
}

async function scheduleMeeting(accountId, attendeeIds = []) {
  const res = await authed(request(app).post(`/api/v1/accounts/${accountId}/stage`), bdaToken).send({
    to_stage: 'meeting_scheduled',
    meeting_mode: 'online',
    meeting_date: new Date('2026-09-01T10:00:00Z').toISOString(),
    meeting_attendee_ids: attendeeIds,
  });
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('meeting attendees are not role-restricted', () => {
  test('a recruiter, a BDA and an admin can all be added as attendees', async () => {
    const recruiter = await createUser({ role: 'recruiter' });
    const otherBda = await createUser({ role: 'bda' });
    const admin = await createUser({ role: 'admin' });
    const account = await createAccount();

    const scheduled = await scheduleMeeting(account.id, [recruiter.id, otherBda.id, admin.id]);
    expect(scheduled.meeting_attendees).toHaveLength(3);
    expect(scheduled.meeting_attendees.map((a) => a.id).sort()).toEqual(
      [recruiter.id, otherBda.id, admin.id].sort()
    );
  });
});

describe('POST /accounts/:id/meeting — edit meeting details without a stage change', () => {
  test('updates date/location/notes/attendees and leaves the stage untouched', async () => {
    const sales1 = await createUser({ role: 'sales' });
    const sales2 = await createUser({ role: 'sales' });
    const account = await createAccount();
    await scheduleMeeting(account.id, [sales1.id]);

    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/meeting`), bdaToken).send({
      meeting_mode: 'offline',
      meeting_date: new Date('2026-09-05T12:00:00Z').toISOString(),
      meeting_location: 'New office, Sector 9',
      meeting_notes: 'Rescheduled at client request',
      meeting_attendee_ids: [sales2.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe('meeting_scheduled'); // unchanged
    expect(res.body.data.meeting_mode).toBe('offline');
    expect(res.body.data.meeting_location).toBe('New office, Sector 9');
    expect(res.body.data.meeting_notes).toBe('Rescheduled at client request');
    expect(res.body.data.meeting_attendees.map((a) => a.id)).toEqual([sales2.id]);

    const history = await authed(request(app).get(`/api/v1/accounts/${account.id}/history`), bdaToken);
    const last = history.body.data[history.body.data.length - 1];
    expect(last.reason).toBe('Meeting details updated');
    expect(last.from_stage).toBe('meeting_scheduled');
    expect(last.to_stage).toBe('meeting_scheduled');
  });

  test('still editable after the account moves past meeting_scheduled', async () => {
    const sales1 = await createUser({ role: 'sales' });
    const account = await createAccount();
    await scheduleMeeting(account.id, [sales1.id]);
    const activated = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'active',
    });
    expect(activated.status).toBe(200);

    const sales2 = await createUser({ role: 'sales' });
    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/meeting`), bdaToken).send({
      meeting_mode: 'online',
      meeting_date: new Date('2026-09-01T10:00:00Z').toISOString(),
      meeting_attendee_ids: [sales1.id, sales2.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe('active');
    expect(res.body.data.meeting_attendees).toHaveLength(2);
  });

  test('offline mode requires a location', async () => {
    const account = await createAccount();
    await scheduleMeeting(account.id);
    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/meeting`), bdaToken).send({
      meeting_mode: 'offline',
      meeting_date: new Date().toISOString(),
    });
    expect(res.status).toBe(400);
  });

  test('a recruiter cannot edit meeting details (bda/admin only)', async () => {
    const recruiter = await createUser({ role: 'recruiter' });
    const { access_token: recruiterToken } = await loginAs(recruiter);
    const account = await createAccount();
    await scheduleMeeting(account.id);

    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/meeting`), recruiterToken).send({
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
    });
    expect(res.status).toBe(403);
  });

  test('a locked account cannot have its meeting edited', async () => {
    const account = await createAccount();
    await scheduleMeeting(account.id);
    const dropped = await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({
      to_stage: 'dropped',
      reason: 'client went quiet',
    });
    expect(dropped.status).toBe(200);
    expect(dropped.body.data.is_locked).toBe(true);

    const res = await authed(request(app).post(`/api/v1/accounts/${account.id}/meeting`), bdaToken).send({
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
    });
    expect(res.status).toBe(403);
  });
});
