jest.setTimeout(120000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

// SaaS plan section 21: one person who belongs to two groups (for example a consultant for us and for a customer). Sign-in, workspace choice, company
// switch, refresh, password change, invitations and user creation must never let one group's data leak into the other.

const PASSWORD = 'Password123!';
let ours; let theirs; let person; let acctOurs; let acctTheirs;

const decode = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString());
const names = (res) => (res.body.data?.items || res.body.data || []).map((a) => a.name);

beforeEach(async () => {
  await cleanDatabase();
  ours = await createOrg({ name: 'Our Company', slug: 'ours-co' });
  theirs = await createOrg({ name: 'Customer Company', slug: 'cust-co' });
  await prisma.orgGroup.update({ where: { id: theirs.org_group_id }, data: { kind: 'customer' } });
  person = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(person.id, ours.id, { role: 'admin' });
  await createOrgMembership(person.id, theirs.id, { role: 'admin' });
  const mk = (org, name) => prisma.account.create({ data: { org_id: org.id, type: 'client', name, stage: 'active', owner_id: person.id, origin_owner_id: person.id } });
  acctOurs = await mk(ours, 'OUR-ONLY Client');
  acctTheirs = await mk(theirs, 'THEIR-ONLY Client');
  // the customer company is registered as a SaaS customer, which is what switches the tenant read guard on
  await prisma.$executeRawUnsafe('TRUNCATE TABLE saas_customers CASCADE');
  await prisma.saasCustomer.create({ data: { org_group_id: theirs.org_group_id, org_id: theirs.id, name: 'Customer Company', status: 'active' } });
  require('../src/config/tenantGuard').clearCache();
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE saas_customers CASCADE'); // leave no customer rows behind for other suites
  require('../src/config/tenantGuard').clearCache();
  await prisma.$disconnect();
});

const login = (body) => request(app).post('/api/v1/auth/login').send({ email: person.email, password: PASSWORD, ...body });
const accounts = (token) => authed(request(app).get('/api/v1/accounts'), token);

describe('tenant read guard', () => {
  test('while no company is a customer it changes nothing: queries behave exactly as before', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE saas_customers CASCADE');
    require('../src/config/tenantGuard').clearCache();
    const tok = (await login({ org_slug: 'ours-co' })).body.data.access_token;
    expect(names(await accounts(tok)).sort()).toEqual(['OUR-ONLY Client', 'THEIR-ONLY Client']); // the old, unscoped reads
  });

  test('once a company is a customer, our companies stop seeing its rows and it sees only its own', async () => {
    const tokOurs = (await login({ org_slug: 'ours-co' })).body.data.access_token;
    const tokTheirs = (await login({ org_slug: 'cust-co' })).body.data.access_token;
    expect(names(await accounts(tokOurs))).toEqual(['OUR-ONLY Client']);
    expect(names(await accounts(tokTheirs))).toEqual(['THEIR-ONLY Client']);
    const cnt = await authed(request(app).get('/api/v1/accounts/stats'), tokOurs); // other account endpoints are guarded too (any status except a leak)
    expect(JSON.stringify(cnt.body)).not.toContain('THEIR-ONLY');
  });
});

describe('one person in two groups', () => {
  test('sign-in with a chosen workspace gets that workspace only; a workspace the person is not in is refused', async () => {
    const a = await login({ org_slug: 'ours-co' });
    const b = await login({ org_slug: 'cust-co' });
    expect(a.status).toBe(200);
    expect(decode(a.body.data.access_token).org_id).toBe(ours.id);
    expect(decode(b.body.data.access_token).org_id).toBe(theirs.id);
    const stranger = await createOrg({ name: 'Someone Else', slug: 'else-co' });
    expect(stranger.id).toBeTruthy();
    expect((await login({ org_slug: 'else-co' })).status).toBeGreaterThanOrEqual(400);
  });

  test('each workspace shows only its own records, in both directions, and a record id from the other one is not found', async () => {
    const tokOurs = (await login({ org_slug: 'ours-co' })).body.data.access_token;
    const tokTheirs = (await login({ org_slug: 'cust-co' })).body.data.access_token;
    const o = await accounts(tokOurs);
    const t = await accounts(tokTheirs);
    expect(names(o)).toContain('OUR-ONLY Client');
    expect(names(o)).not.toContain('THEIR-ONLY Client');
    expect(names(t)).toContain('THEIR-ONLY Client');
    expect(names(t)).not.toContain('OUR-ONLY Client');
    expect((await authed(request(app).get(`/api/v1/accounts/${acctTheirs.id}`), tokOurs)).status).toBe(404);
    expect((await authed(request(app).get(`/api/v1/accounts/${acctOurs.id}`), tokTheirs)).status).toBe(404);
    expect((await authed(request(app).patch(`/api/v1/accounts/${acctOurs.id}`), tokTheirs).send({ name: 'hijack' })).status).toBeGreaterThanOrEqual(400);
    expect((await prisma.account.findUnique({ where: { id: acctOurs.id } })).name).toBe('OUR-ONLY Client');
  });

  test('switching company moves the whole session, and refresh stays in the company that was chosen', async () => {
    const first = (await login({ org_slug: 'ours-co' })).body.data;
    const sw = await authed(request(app).post('/api/v1/auth/switch-org'), first.access_token).send({ org_id: theirs.id });
    expect(sw.status).toBe(200);
    const tok = sw.body.data.access_token;
    expect(decode(tok).org_id).toBe(theirs.id);
    expect(names(await accounts(tok))).toEqual(['THEIR-ONLY Client']);
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: sw.body.data.refresh_token });
    expect(refreshed.status).toBe(200);
    expect(decode(refreshed.body.data.access_token).org_id).toBe(theirs.id);
  });

  test('a group super admin of our group cannot step into a customer company they are not a member of, and sign-in adds no membership there', async () => {
    const su = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: ours.org_group_id } });
    await createOrgMembership(su.id, ours.id, { role: 'admin' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: su.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await prisma.orgMembership.count({ where: { person_id: su.id, org_id: theirs.id } })).toBe(0);
    const sw = await authed(request(app).post('/api/v1/auth/switch-org'), res.body.data.access_token).send({ org_id: theirs.id });
    expect(sw.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.orgMembership.count({ where: { person_id: su.id, org_id: theirs.id } })).toBe(0);
    // and the customer's own admin cannot see or switch into ours
    const custAdmin = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(custAdmin.id, theirs.id, { role: 'admin' });
    const ct = (await loginAs(custAdmin)).access_token;
    expect((await authed(request(app).post('/api/v1/auth/switch-org'), ct).send({ org_id: ours.id })).status).toBeGreaterThanOrEqual(400);
  });

  test('the password belongs to the person, so a change applies in both workspaces (and the old one stops working in both)', async () => {
    const tok = (await login({ org_slug: 'cust-co' })).body.data.access_token;
    const ch = await authed(request(app).post('/api/v1/auth/change-password'), tok).send({ current_password: PASSWORD, new_password: 'NewPassword456!' });
    expect(ch.status).toBe(200);
    expect((await login({ org_slug: 'ours-co' })).status).toBe(401);
    expect((await login({ org_slug: 'ours-co', password: 'NewPassword456!' })).status).toBe(200);
    expect((await login({ org_slug: 'cust-co', password: 'NewPassword456!' })).status).toBe(200);
  });

  test('creating a user with an email that already has a login is refused, and the message does not say which company it belongs to', async () => {
    const tok = (await login({ org_slug: 'cust-co' })).body.data.access_token;
    const other = await createUser({ role: 'employee', withOrg: false });
    await createOrgMembership(other.id, ours.id, { role: 'employee' });
    const res = await authed(request(app).post('/api/v1/users'), tok).send({ name: 'Dup', email: other.email, password: 'Password123!', role: 'employee' });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toMatch(/Our Company|ours-co|Customer Company|cust-co/);
    expect(await prisma.orgMembership.count({ where: { person_id: other.id, org_id: theirs.id } })).toBe(0); // not attached
  });

  test('a user list and calendar invites reach only people of the same company', async () => {
    const mine = await createUser({ role: 'employee', withOrg: false });
    await createOrgMembership(mine.id, ours.id, { role: 'employee' });
    const tokTheirs = (await login({ org_slug: 'cust-co' })).body.data.access_token;
    const list = await authed(request(app).get('/api/v1/users'), tokTheirs);
    expect(JSON.stringify(list.body)).not.toContain(mine.email);
    const inv = await authed(request(app).post('/api/v1/invites'), tokTheirs).send({ title: 'Sync', start: '2027-01-05T10:00:00Z', end: '2027-01-05T11:00:00Z', attendee_user_ids: [mine.id] });
    expect(inv.status).toBe(422);
  });

  test('creating a customer workspace never attaches an existing login to it', async () => {
    const dox = await createOrg({ name: 'Delphic One', slug: 'delphic-one' });
    await prisma.org.update({ where: { id: dox.id }, data: { enabled_modules: ['delphic_one'] } });
    const admin = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(admin.id, dox.id, { role: 'admin' });
    const tok = (await loginAs(admin)).access_token;
    await prisma.$executeRawUnsafe('TRUNCATE TABLE dox_customers, saas_customers CASCADE');
    const switches = require('../src/modules/platform/switches.service');
    await switches.setSwitch('provisioning', true, null);
    try {
      const c = await prisma.doxCustomer.create({ data: { org_id: dox.id, name: 'Has Login', contact_email: person.email, status: 'trial' } });
      const res = await authed(request(app).post(`/api/v1/delphic-one/customers/${c.id}/provision`), tok).send({});
      expect(res.status).toBe(409);
      expect(await prisma.saasCustomer.count()).toBe(0);
    } finally {
      await prisma.saasSetting.deleteMany({ where: { key: { startsWith: 'switch.' } } });
      switches.clearCache();
    }
  });
});
