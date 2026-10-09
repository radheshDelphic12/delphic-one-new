/** Extra meetings with an ACTIVE client / vendor: tracked without touching the stage, shown on the calendar. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createActiveClientAccount, authed, unique } = require('./helpers');

const DAY = 24 * 60 * 60 * 1000;
let admin;
let adminToken;
let bdaToken;
let salesToken;
let recruiterToken;
let client;
let vendor;
let lead;

beforeAll(async () => {
  await cleanDatabase();
  admin = await createUser({ role: 'admin' });
  const bda = await createUser({ role: 'bda' });
  const sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: bdaToken } = await loginAs(bda));
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  client = await createActiveClientAccount(bda.id);
  vendor = await prisma.account.create({ data: { type: 'vendor', name: unique('Vendor '), stage: 'active', owner_id: bda.id, origin_owner_id: bda.id } });
  lead = await prisma.account.create({ data: { type: 'client', name: unique('Lead '), stage: 'lead', owner_id: bda.id, origin_owner_id: bda.id } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const at = (days) => new Date(Date.now() + days * DAY).toISOString();
const post = (token, account, body) => authed(request(app).post(`/api/v1/accounts/${account.id}/meetings`), token).send(body);

describe('client / vendor follow-up meetings', () => {
  test('schedule, list, edit, complete and delete without changing the account stage', async () => {
    const created = await post(bdaToken, client, { title: 'Quarterly review', mode: 'online', scheduled_at: at(2), link: 'https://meet.example/abc', attendee_ids: [admin.id] });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ title: 'Quarterly review', mode: 'online', status: 'scheduled', duration_minutes: 60 });
    expect(created.body.data.attendees.map((a) => a.id)).toEqual([admin.id]);
    const id = created.body.data.id;

    const list = await authed(request(app).get(`/api/v1/accounts/${client.id}/meetings`), salesToken);
    expect(list.status).toBe(200);
    expect(list.body.data.map((m) => m.id)).toEqual([id]);

    const edited = await authed(request(app).patch(`/api/v1/accounts/${client.id}/meetings/${id}`), adminToken).send({ title: 'Quarterly review (moved)', mode: 'offline', location: 'Client HQ', attendee_ids: [] });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ title: 'Quarterly review (moved)', mode: 'offline', location: 'Client HQ', link: null });
    expect(edited.body.data.attendees).toEqual([]);

    const done = await authed(request(app).patch(`/api/v1/accounts/${client.id}/meetings/${id}`), bdaToken).send({ status: 'completed' });
    expect(done.body.data.status).toBe('completed');

    expect((await prisma.account.findUnique({ where: { id: client.id } })).stage).toBe('active');
    expect(await prisma.stageHistory.count({ where: { entity_id: client.id } })).toBe(0);

    expect((await authed(request(app).delete(`/api/v1/accounts/${client.id}/meetings/${id}`), bdaToken)).status).toBe(200);
    expect((await authed(request(app).get(`/api/v1/accounts/${client.id}/meetings`), bdaToken)).body.data).toEqual([]);
  });

  test('works for active vendors; only active accounts; offline needs a location; validation', async () => {
    expect((await post(adminToken, vendor, { title: 'Rate card', scheduled_at: at(1) })).status).toBe(201);
    const notActive = await post(adminToken, lead, { title: 'Too early', scheduled_at: at(1) });
    expect(notActive.status).toBe(409);
    expect((await post(adminToken, client, { title: 'Site visit', mode: 'offline', scheduled_at: at(1) })).status).toBe(400);
    expect((await post(adminToken, client, { title: '', scheduled_at: at(1) })).status).toBe(422);
    expect((await post(adminToken, { id: '00000000-0000-4000-8000-000000000000' }, { title: 'x', scheduled_at: at(1) })).status).toBe(404);
  });

  test('only admin and BDA may schedule or change them', async () => {
    expect((await post(salesToken, client, { title: 'Nope', scheduled_at: at(1) })).status).toBe(403);
    expect((await post(recruiterToken, client, { title: 'Nope', scheduled_at: at(1) })).status).toBe(403);
    const m = (await post(bdaToken, client, { title: 'Mine', scheduled_at: at(3) })).body.data;
    expect((await authed(request(app).patch(`/api/v1/accounts/${client.id}/meetings/${m.id}`), salesToken).send({ title: 'Hijack' })).status).toBe(403);
    expect((await authed(request(app).delete(`/api/v1/accounts/${client.id}/meetings/${m.id}`), salesToken)).status).toBe(403);
  });

  test('they appear on the calendar feed, with status and the cancelled filter', async () => {
    const m = (await post(adminToken, client, { title: 'Calendar check', scheduled_at: at(5), duration_minutes: 30, link: 'https://meet.example/cal' })).body.data;
    const feed = (params = {}) => authed(request(app).get('/api/v1/interviews').query({ from: at(-1), to: at(30), ...params }), adminToken);
    const event = (await feed()).body.data.find((e) => e.id === `cm-${m.id}`);
    expect(event).toMatchObject({ kind: 'client_meeting', account_id: client.id, status: 'scheduled', duration_minutes: 30, meeting_link: 'https://meet.example/cal', audience: 'external' });
    expect(event.round_type_label).toContain('Calendar check');

    await authed(request(app).patch(`/api/v1/accounts/${client.id}/meetings/${m.id}`), adminToken).send({ status: 'cancelled' });
    expect((await feed()).body.data.find((e) => e.id === `cm-${m.id}`).status).toBe('cancelled');
    expect((await feed({ status: 'scheduled' })).body.data.find((e) => e.id === `cm-${m.id}`)).toBeUndefined();
    expect((await feed({ audience: 'internal' })).body.data.find((e) => e.id === `cm-${m.id}`)).toBeUndefined();
  });
});
