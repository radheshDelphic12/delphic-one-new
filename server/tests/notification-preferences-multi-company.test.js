// A person who is an admin in one company and only an employee in another (a group admin) must be able to switch off, from ANY company,
// every notification they can receive. The page used to list only the types of the role they hold in the company they were in (5 of 20 as an
// employee) while the sender treats them as the admin they are, so the hidden types kept coming after they had turned everything off.
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const { notify } = require('../src/lib/notifications/dispatch');
const { NOTIFICATION_TYPES, eventsForRole } = require('../src/lib/notifications/eventCatalog');

beforeEach(async () => { await cleanDatabase(); });
afterAll(async () => { await prisma.$disconnect(); });

async function groupAdmin() {
  const home = await createOrg({ name: 'Home Co' });
  const other = await createOrg({ name: 'Other Co' });
  const user = await createUser({ role: 'admin', name: 'Group Admin', withOrg: false });
  await createOrgMembership(user.id, home.id, { role: 'admin' });
  await createOrgMembership(user.id, other.id, { role: 'employee' });
  const homeToken = (await loginAs(user)).access_token;
  const sw = await authed(request(app).post('/api/v1/auth/switch-org'), homeToken).send({ org_id: other.id });
  expect(sw.status).toBe(200);
  return { user, homeToken, otherToken: sw.body.data.access_token };
}
const prefs = (t) => authed(request(app).get('/api/v1/notifications/preferences'), t);
const put = (t, items) => authed(request(app).put('/api/v1/notifications/preferences'), t).send({ items });

describe('notification preferences in every company', () => {
  test('the list is the same from every company: every type the person can actually receive', async () => {
    const { homeToken, otherToken } = await groupAdmin();
    const home = (await prefs(homeToken)).body.data.map((p) => p.type).sort();
    const other = (await prefs(otherToken)).body.data.map((p) => p.type).sort();
    expect(home).toEqual([...NOTIFICATION_TYPES].sort());
    expect(other).toEqual(home);
    expect(eventsForRole('employee').length).toBeLessThan(NOTIFICATION_TYPES.length); // the old, smaller list
  });

  test('switching everything off from the other company stops every notification and email', async () => {
    const { user, otherToken } = await groupAdmin();
    const hidden = NOTIFICATION_TYPES.find((t) => !eventsForRole('employee').includes(t));
    const ctx = { title: 'T', requirement_title: 'Req', account_name: 'Acme', actor_name: 'X', orgId: null };
    await notify(prisma, { type: hidden, recipientIds: [user.id], context: ctx });
    expect(await prisma.notification.count({ where: { user_id: user.id, type: hidden } })).toBe(1); // control: it is delivered by default

    const all = (await prefs(otherToken)).body.data.map((p) => ({ type: p.type, in_app: false, email: false }));
    const res = await put(otherToken, all);
    expect(res.status).toBe(200);
    expect(res.body.data.every((p) => p.in_app === false && p.email === false)).toBe(true);

    await notify(prisma, { type: hidden, recipientIds: [user.id], context: ctx });
    expect(await prisma.notification.count({ where: { user_id: user.id, type: hidden } })).toBe(1); // no new one
    expect(await prisma.emailOutbox.count({ where: { to_email: user.email } })).toBe(0);
  });
});
