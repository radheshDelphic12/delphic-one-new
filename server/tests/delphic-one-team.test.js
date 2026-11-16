jest.setTimeout(180000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

// Delphic One > Team: the owner's own sales/admin team, added and managed inside the Delphic One company only, through the same user service as People > Users.
const D = '/api/v1/delphic-one';
let dox; let other; let admin; let adminTok; let salesTok; let sales; let superUser; let otherUser;
const call = (method, path, tok, body) => { const r = authed(request(app)[method](`${D}${path}`), tok); return body === undefined ? r : r.send(body); };

async function member(role, orgId = dox.id) {
  const u = await createUser({ role, withOrg: false });
  await createOrgMembership(u.id, orgId, { role });
  return { user: u, token: (await loginAs(u)).access_token };
}

beforeEach(async () => {
  await cleanDatabase();
  dox = await createOrg({ name: 'Delphic One', slug: 'delphic-one' });
  await prisma.org.update({ where: { id: dox.id }, data: { enabled_modules: ['delphic_one'] } });
  other = await createOrg({ name: 'Some Other Co', slug: 'some-other' });
  ({ user: admin, token: adminTok } = await member('admin'));
  ({ user: sales, token: salesTok } = await member('sales'));
  ({ user: otherUser } = await member('employee', other.id));
  superUser = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: superUser.id }, data: { is_group_superadmin: true } });
  await createOrgMembership(superUser.id, dox.id, { role: 'admin' });
});
afterAll(async () => { await prisma.$disconnect(); });

describe('who can open the Team', () => {
  test('only the Delphic One admin has the team capability', async () => {
    expect((await call('get', '/me', adminTok)).body.data.caps).toContain('team');
    expect((await call('get', '/me', salesTok)).body.data.caps).not.toContain('team');
    expect((await call('get', '/team', salesTok)).status).toBe(403);
    expect((await call('post', '/team', salesTok, { name: 'X Y', email: 'x@y.example', role: 'sales' })).status).toBe(403);
    expect((await call('patch', `/team/${sales.id}`, salesTok, { role: 'admin' })).status).toBe(403);
    expect((await call('get', '/team', adminTok)).status).toBe(200);
  });
});

describe('list, add, change, switch off', () => {
  test('lists only the members of the Delphic One company, with role and status; people who cannot be edited are marked', async () => {
    const res = await call('get', '/team', adminTok);
    const rows = res.body.data.members;
    expect(res.body.data.roles).toEqual(['admin', 'sales', 'bda']);
    expect(rows.map((r) => r.email).sort()).toEqual([admin.email, sales.email, superUser.email].sort());
    expect(rows.some((r) => r.email === otherUser.email)).toBe(false); // another company's people never appear
    expect(rows.find((r) => r.email === sales.email)).toMatchObject({ role: 'sales', active: true, can_edit: true });
    expect(rows.find((r) => r.email === superUser.email)).toMatchObject({ protected: true, can_edit: false });
  });

  test('adding a person creates a login with a one-time password and the chosen role; they can sign in and see only what that role may', async () => {
    const res = await call('post', '/team', adminTok, { name: 'Neha Verma', email: 'Neha@Delphic.example', role: 'bda', phone: '9876543210' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Neha Verma', email: 'neha@delphic.example', role: 'bda' });
    expect(res.body.data.temp_password).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
    const membership = await prisma.orgMembership.findFirst({ where: { org_id: dox.id, person: { email: 'neha@delphic.example' } } });
    expect(membership.role).toBe('bda');
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'neha@delphic.example', password: res.body.data.temp_password });
    expect(login.status).toBe(200);
    const tok = login.body.data.access_token;
    const me = (await call('get', '/me', tok)).body.data;
    expect(me.role).toBe('bda');
    expect(me.caps).not.toContain('team');
    expect((await call('get', '/customers', tok)).status).toBe(200);
    expect((await call('get', '/team', tok)).status).toBe(403);
    expect((await call('get', '/team', adminTok)).body.data.members.map((m) => m.email)).toContain('neha@delphic.example');
  });

  test('a password can be given; roles outside admin, sales and bda, bad emails and an email that already has a login (here or elsewhere) are refused', async () => {
    const given = await call('post', '/team', adminTok, { name: 'Given Pw', email: 'given@delphic.example', role: 'sales', password: 'Chosen-Pass-1' });
    expect(given.status).toBe(201);
    expect(given.body.data.temp_password).toBeNull();
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'given@delphic.example', password: 'Chosen-Pass-1' })).status).toBe(200);
    expect((await call('post', '/team', adminTok, { name: 'Emp', email: 'emp@delphic.example', role: 'employee' })).status).toBe(422);
    expect((await call('post', '/team', adminTok, { name: 'Bad', email: 'not-an-email', role: 'sales' })).status).toBe(422);
    const dup = await call('post', '/team', adminTok, { name: 'Dup', email: sales.email.toUpperCase(), role: 'sales' });
    expect(dup.status).toBe(409);
    const elsewhere = await call('post', '/team', adminTok, { name: 'Elsewhere', email: otherUser.email, role: 'sales' });
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body.message).toMatch(/already has a login/);
    expect(await prisma.orgMembership.count({ where: { person_id: otherUser.id, org_id: dox.id } })).toBe(0); // never attached
  });

  test('change a role, deactivate (cannot sign in any more) and reactivate', async () => {
    expect((await call('patch', `/team/${sales.id}`, adminTok, { role: 'bda' })).status).toBe(200);
    expect((await prisma.orgMembership.findFirst({ where: { org_id: dox.id, person_id: sales.id } })).role).toBe('bda');
    expect((await call('get', '/me', salesTok)).body.data.role).toBe('bda'); // the live role follows
    expect((await call('patch', `/team/${sales.id}`, adminTok, { active: false })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({ email: sales.email, password: 'Password123!' })).status).toBe(401);
    expect((await call('get', '/team', adminTok)).body.data.members.find((m) => m.id === sales.id)).toMatchObject({ active: false });
    expect((await call('patch', `/team/${sales.id}`, adminTok, { active: true })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({ email: sales.email, password: 'Password123!' })).status).toBe(200);
    expect((await call('patch', `/team/${sales.id}`, adminTok, {})).status).toBe(422);
    expect((await call('patch', `/team/${sales.id}`, adminTok, { role: 'employee' })).status).toBe(422);
  });
});

describe('guard rails', () => {
  test('never touches another company, a person who works in two companies, or a super admin', async () => {
    expect((await call('patch', `/team/${otherUser.id}`, adminTok, { active: false })).status).toBe(404);
    expect((await prisma.user.findUnique({ where: { id: otherUser.id } })).active).toBe(true);
    const both = await member('sales');
    await createOrgMembership(both.user.id, other.id, { role: 'employee' });
    const shared = await call('patch', `/team/${both.user.id}`, adminTok, { active: false });
    expect(shared.status).toBe(409);
    expect(shared.body.message).toMatch(/another company/);
    expect((await prisma.user.findUnique({ where: { id: both.user.id } })).active).toBe(true);
    expect((await call('patch', `/team/${superUser.id}`, adminTok, { active: false })).status).toBe(409);
    expect((await prisma.user.findUnique({ where: { id: superUser.id } })).active).toBe(true);
  });

  test('you cannot lock yourself out, and the last active admin cannot be demoted or switched off', async () => {
    expect((await call('patch', `/team/${admin.id}`, adminTok, { active: false })).status).toBe(409);
    expect((await call('patch', `/team/${admin.id}`, adminTok, { role: 'sales' })).status).toBe(409);
    // a second admin: the first can then be changed by the second, but never the last one
    const second = await call('post', '/team', adminTok, { name: 'Second Admin', email: 'second@delphic.example', role: 'admin', password: 'Second-Pass-1' });
    const secondTok = (await request(app).post('/api/v1/auth/login').send({ email: 'second@delphic.example', password: 'Second-Pass-1' })).body.data.access_token;
    expect((await call('patch', `/team/${admin.id}`, secondTok, { role: 'sales' })).status).toBe(200);
    expect((await call('patch', `/team/${second.body.data.id}`, secondTok, { role: 'sales' })).status).toBe(409); // self
    const third = await member('admin'); // an admin that is not in the way: the original one is now sales, the second is the only active admin besides third
    expect(third.user.id).toBeTruthy();
    expect((await call('patch', `/team/${third.user.id}`, secondTok, { active: false })).status).toBe(200); // another admin (second) still active
    expect((await call('patch', `/team/${second.body.data.id}`, adminTok, { active: false })).status).toBeGreaterThanOrEqual(403); // the old admin is only sales now
  });

  test('a person added here is not visible to other companies and a new person works only in this company', async () => {
    const res = await call('post', '/team', adminTok, { name: 'Only Here', email: 'onlyhere@delphic.example', role: 'sales' });
    expect(res.status).toBe(201);
    expect(await prisma.orgMembership.count({ where: { person_id: res.body.data.id } })).toBe(1);
    const otherAdmin = await member('admin', other.id);
    const list = await authed(request(app).get('/api/v1/users'), otherAdmin.token);
    expect(JSON.stringify(list.body)).not.toContain('onlyhere@delphic.example');
    expect((await authed(request(app).get(`${D}/team`), otherAdmin.token)).status).toBe(403); // not the Delphic One workspace
  });
});
