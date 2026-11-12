const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const groupTravel = require('../src/modules/superDashboard/groupTravel.service');

const base = '/api/v1/super-dashboard';
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => iso(new Date(Date.now() + n * 86400000));

let group;
let a;
let b;
let client;
let superToken;
let adminToken;
let traveller;

beforeEach(async () => {
  await cleanDatabase();
  a = await createOrg({ name: 'Alpha Global' });
  group = { id: a.org_group_id };
  b = await createOrg({ name: 'Beta Trading', org_group_id: group.id });
  await prisma.org.update({ where: { id: b.id }, data: { enabled_modules: ['gulati'] } });
  const su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: group.id } });
  await createOrgMembership(su.id, a.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(su));
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, a.id, { role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  traveller = await createUser({ role: 'sales', withOrg: false });
  await createOrgMembership(traveller.id, b.id, { role: 'sales' });
  client = await prisma.account.create({ data: { type: 'client', name: 'Acme Client', stage: 'active', owner_id: su.id, origin_owner_id: su.id, org_id: a.id } });
});
afterAll(async () => { await prisma.$disconnect(); });

const post = (path, body, t = superToken) => authed(request(app).post(`${base}${path}`), t).send(body);
const patch = (path, body, t = superToken) => authed(request(app).patch(`${base}${path}`), t).send(body);
const get = (path, t = superToken) => authed(request(app).get(`${base}${path}`), t);
const del = (path, t = superToken) => authed(request(app).delete(`${base}${path}`), t);

describe('group travel', () => {
  test('only a group superadmin may use it', async () => {
    expect((await get('/group/travel', adminToken)).status).toBe(403);
    expect((await post('/group/travel', { title: 'x', destination: 'Mumbai', start_date: inDays(3), end_date: inDays(4) }, adminToken)).status).toBe(403);
    expect((await get('/group/travel')).status).toBe(200);
  });

  test('a trip has travellers from any company, one total budget and validates its dates and company', async () => {
    const bad = await post('/group/travel', { title: 'Mumbai', destination: 'Mumbai', start_date: inDays(5), end_date: inDays(3) });
    expect(bad.status).toBe(422);
    const outsider = await createOrg({ name: 'Other Group Co' });
    expect((await post('/group/travel', { title: 'Mumbai', destination: 'Mumbai', start_date: inDays(3), end_date: inDays(4), org_id: outsider.id })).status).toBe(422);

    const res = await post('/group/travel', {
      title: 'Mumbai client visits', destination: 'Mumbai', origin: 'Indore', start_date: inDays(3), end_date: inDays(5), budget: 45000, org_id: a.id,
      travellers: undefined, travelers: [{ user_id: traveller.id, name: traveller.name, org_id: b.id }, { name: 'Guest advisor' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ destination: 'Mumbai', budget: 45000, days: 3, state: 'planned', actual_spent: null, over_budget: false });
    expect(res.body.data.travelers.map((t) => t.name).sort()).toEqual(['Guest advisor', traveller.name].sort());

    const id = res.body.data.id;
    const edited = await patch(`/group/travel/${id}`, { budget: 30000, actual_spent: 36000, travelers: [{ name: 'Solo' }] });
    expect(edited.body.data).toMatchObject({ budget: 30000, actual_spent: 36000, over_budget: true, remaining_budget: -6000 });
    expect(edited.body.data.travelers).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entity_type: 'group_travel', entity_id: id } })).toBeGreaterThanOrEqual(2);
  });

  test('upcoming / past views and the month filter; a finished trip still marked planned asks to be closed', async () => {
    await post('/group/travel', { title: 'Soon', destination: 'Pune', start_date: inDays(2), end_date: inDays(3), budget: 1000 });
    await post('/group/travel', { title: 'Now', destination: 'Delhi', start_date: inDays(-1), end_date: inDays(1), budget: 2000 });
    await post('/group/travel', { title: 'Stale', destination: 'Goa', start_date: inDays(-9), end_date: inDays(-8), budget: 500 });
    const up = (await get('/group/travel?view=upcoming')).body.data;
    expect(up.trips.map((t) => t.title)).toEqual(['Now', 'Soon']);
    expect(up.summary).toMatchObject({ trips: 2, ongoing: 1, budget: 3000 });
    const past = (await get('/group/travel?view=past')).body.data;
    expect(past.trips.map((t) => t.title)).toEqual(['Stale']);
    expect(past.trips[0].state).toBe('overdue_close');
    expect(past.summary.needs_closing).toBe(1);
    const all = (await get('/group/travel?view=all')).body.data;
    expect(all.trips).toHaveLength(3);
    await del(`/group/travel/${past.trips[0].id}`);
    expect((await get('/group/travel?view=all')).body.data.trips).toHaveLength(2);
  });

  test('meetings link to a trip, a new one is created on the calendar, the calendar gets a Travel tag; unlinking keeps the meeting', async () => {
    const trip = (await post('/group/travel', { title: 'Mumbai', destination: 'Mumbai', start_date: inDays(3), end_date: inDays(5), budget: 5000, travelers: [{ user_id: traveller.id, name: traveller.name }] })).body.data;

    const opts = (await get('/group/travel/options')).body.data;
    expect(opts.companies.map((c) => c.name).sort()).toEqual(['Alpha Global', 'Beta Trading']);
    expect(opts.clients.map((c) => [c.name, c.org_name])).toEqual([['Acme Client', 'Alpha Global']]);
    expect(opts.people.some((p) => p.user_id === traveller.id && p.org_name === 'Beta Trading')).toBe(true);

    const made = await post(`/group/travel/${trip.id}/meetings/new`, { account_id: client.id, title: 'Quarterly review', scheduled_at: new Date(Date.now() + 4 * 86400000).toISOString(), location: 'Andheri office' });
    expect(made.status).toBe(201);
    expect(made.body.data.meetings).toHaveLength(1);
    expect(made.body.data.meetings[0]).toMatchObject({ title: 'Quarterly review', account_name: 'Acme Client', mode: 'offline', location: 'Andheri office' });
    const meeting = await prisma.clientMeeting.findFirst({ where: { title: 'Quarterly review' }, include: { attendees: true } });
    expect(meeting.attendees.map((x) => x.user_id)).toEqual([traveller.id]);

    // it can be picked from the list of meetings too, and linking twice is harmless
    const key = made.body.data.meetings[0].key;
    expect((await get('/group/travel/options')).body.data.meetings.map((m) => m.key)).toContain(key);
    expect((await post(`/group/travel/${trip.id}/meetings`, { meeting_key: key })).status).toBe(201);
    expect((await get('/group/travel')).body.data.trips[0].meetings).toHaveLength(1);
    expect((await post(`/group/travel/${trip.id}/meetings`, { meeting_key: 'cm-00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await post(`/group/travel/${trip.id}/meetings`, { meeting_key: 'nonsense' })).status).toBe(422);

    // the calendar tag
    const tags = await groupTravel.tagsFor([key]);
    expect(tags.get(key)).toMatchObject({ id: trip.id, destination: 'Mumbai' });

    // unlink: the meeting itself stays on the calendar
    const un = await del(`/group/travel/${trip.id}/meetings/${key}`);
    expect(un.body.data.meetings).toHaveLength(0);
    expect(await prisma.clientMeeting.count({ where: { title: 'Quarterly review' } })).toBe(1);
    expect((await groupTravel.tagsFor([key])).size).toBe(0);
  });

  test('a meeting can be made for a client of ANY group company and lands on that company calendar; a client outside the group is refused; a cancelled trip carries no tag', async () => {
    const trip = (await post('/group/travel', { title: 'T', destination: 'Pune', start_date: inDays(3), end_date: inDays(4) })).body.data;
    const betaClient = await prisma.account.create({ data: { type: 'client', name: 'Beta client', stage: 'active', owner_id: (await createUser({ role: 'admin', withOrg: false })).id, origin_owner_id: (await createUser({ role: 'admin', withOrg: false })).id, org_id: b.id } });
    const optsNow = (await get('/group/travel/options')).body.data;
    expect(optsNow.clients.map((c) => [c.name, c.org_name]).sort()).toEqual([['Acme Client', 'Alpha Global'], ['Beta client', 'Beta Trading']]);
    const forBeta = await post(`/group/travel/${trip.id}/meetings/new`, { org_id: b.id, account_id: betaClient.id, title: 'Beta visit', scheduled_at: new Date(Date.now() + 86400000).toISOString() });
    expect(forBeta.status).toBe(201);
    expect(await prisma.clientMeeting.findFirst({ where: { title: 'Beta visit' } })).toMatchObject({ org_id: b.id, account_id: betaClient.id });
    // the link list holds the meetings of EVERY group company, each tagged with its company; another group's meetings are not offered or linkable
    const stray = await createOrg({ name: 'Other Group Co' });
    const strayClient = await prisma.account.create({ data: { type: 'client', name: 'Stray client', stage: 'active', owner_id: (await createUser({ role: 'admin', withOrg: false })).id, origin_owner_id: (await createUser({ role: 'admin', withOrg: false })).id, org_id: stray.id } });
    const strayMeeting = await prisma.clientMeeting.create({ data: { account_id: strayClient.id, org_id: stray.id, title: 'Stray meeting', mode: 'offline', scheduled_at: new Date(Date.now() + 86400000), duration_minutes: 60, created_by: strayClient.owner_id } });
    const listed = (await get('/group/travel/options')).body.data.meetings;
    expect(listed.find((m) => m.title === 'Beta visit')).toMatchObject({ org_id: b.id, org_name: 'Beta Trading', account_name: 'Beta client' });
    expect(listed.map((m) => m.title)).not.toContain('Stray meeting');
    expect((await post(`/group/travel/${trip.id}/meetings`, { meeting_key: `cm-${strayMeeting.id}` })).status).toBe(404);
    const linkedBeta = await post(`/group/travel/${trip.id}/meetings`, { meeting_key: listed.find((m) => m.title === 'Beta visit').key });
    expect(linkedBeta.body.data.meetings.find((m) => m.title === 'Beta visit')).toMatchObject({ org_name: 'Beta Trading' });
    // the company has to match the client
    expect((await post(`/group/travel/${trip.id}/meetings/new`, { org_id: a.id, account_id: betaClient.id, title: 'x', scheduled_at: new Date(Date.now() + 86400000).toISOString() })).status).toBe(422);
    // a client of a company outside the group
    const stranger = await createOrg({ name: 'Stranger Co' });
    const outside = await prisma.account.create({ data: { type: 'client', name: 'Outside client', stage: 'active', owner_id: (await createUser({ role: 'admin', withOrg: false })).id, origin_owner_id: (await createUser({ role: 'admin', withOrg: false })).id, org_id: stranger.id } });
    expect((await post(`/group/travel/${trip.id}/meetings/new`, { account_id: outside.id, title: 'x', scheduled_at: new Date(Date.now() + 86400000).toISOString() })).status).toBe(422);
    const made = await post(`/group/travel/${trip.id}/meetings/new`, { account_id: client.id, title: 'ok', scheduled_at: new Date(Date.now() + 86400000).toISOString() });
    const key = made.body.data.meetings[0].key;
    expect((await groupTravel.tagsFor([key])).size).toBe(1);
    await patch(`/group/travel/${trip.id}`, { status: 'cancelled' });
    expect((await groupTravel.tagsFor([key])).size).toBe(0);
  });

  test('a trip is on the calendar (one event per day) for the group superadmin only, and is fetched by id', async () => {
    const trip = (await post('/group/travel', { title: 'Mumbai', destination: 'Mumbai', start_date: inDays(2), end_date: inDays(4), budget: 7000, travelers: [{ name: 'Guest' }] })).body.data;
    expect((await get(`/group/travel/${trip.id}`)).body.data).toMatchObject({ id: trip.id, budget: 7000, days: 3 });
    expect((await get('/group/travel/options')).status).toBe(200);
    expect((await get(`/group/travel/${trip.id}`, adminToken)).status).toBe(403);

    const feed = (token, q = '') => authed(request(app).get(`/api/v1/interviews?from=${new Date().toISOString()}&to=${new Date(Date.now() + 10 * 86400000).toISOString()}${q}`), token);
    const mine = (await feed(superToken)).body.data.filter((e) => e.kind === 'trip');
    expect(mine).toHaveLength(3);
    expect(mine[0]).toMatchObject({ trip_id: trip.id, days: 3, day_number: 1, status: 'scheduled', meeting_location: 'Mumbai' });
    expect(mine[0].trip.budget).toBe(7000);
    expect((await feed(adminToken)).body.data.filter((e) => e.kind === 'trip')).toHaveLength(0);

    // managing it from the calendar side: the trip record is the same one
    await patch(`/group/travel/${trip.id}`, { status: 'cancelled' });
    expect((await feed(superToken)).body.data.filter((e) => e.kind === 'trip').every((e) => e.status === 'cancelled')).toBe(true);
  });
});
