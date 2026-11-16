jest.setTimeout(180000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const switches = require('../src/modules/platform/switches.service');
const saasGate = require('../src/modules/platform/saasGate');
const credits = require('../src/modules/platform/credits.service');

// The entitlement matrix (SaaS plan section 10): every mapped route x module code. With the switch ON a customer user without days on a module is
// refused on that module's routes and let in with days; unmapped routes are never gated; a company that is not a customer is never blocked; with the
// switch OFF nothing is blocked for anyone.

const GATE = /module is not active for your user/;
let rows; let cust; let ours; let slot;

async function customerUser(status = 'active') {
  const org = await createOrg({ name: 'Customer Co', slug: `cust-${Date.now()}` });
  await prisma.orgGroup.update({ where: { id: org.org_group_id }, data: { kind: 'customer' } });
  const u = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(u.id, org.id, { role: 'admin' });
  const customer = await prisma.saasCustomer.create({ data: { org_group_id: org.org_group_id, org_id: org.id, name: 'Customer Co', status, max_users: 10 } });
  const s = await prisma.saasSlot.create({ data: { customer_id: customer.id, email: u.email.toLowerCase(), user_id: u.id, is_admin: true } });
  return { org, user: u, customer, slot: s, token: (await loginAs(u)).access_token };
}
const give = async (slotId, codes, days = 365) => { for (const c of codes) await credits.addCredit({ slotId, code: c, days }); };
const hit = (token, path, method = 'get') => authed(request(app)[method](`/api/v1${path}`), token);

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE saas_customers CASCADE');
  await prisma.saasSetting.deleteMany({ where: { key: { startsWith: 'switch.' } } });
  switches.clearCache(); saasGate.clearCache();
  rows = await prisma.saasRouteModule.findMany({ where: { active: true }, orderBy: { path_prefix: 'asc' } });
  cust = await customerUser();
  slot = cust.slot;
  const org = await createOrg({ name: 'Our Company', slug: `ours-${Date.now()}` });
  const u = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(u.id, org.id, { role: 'admin' });
  ours = { org, user: u, token: (await loginAs(u)).access_token };
});
afterEach(async () => {
  await prisma.saasSetting.deleteMany({ where: { key: { startsWith: 'switch.' } } });
  await prisma.saasRouteModule.deleteMany({ where: { path_prefix: '/notifications' } });
  switches.clearCache(); saasGate.clearCache();
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE saas_customers CASCADE'); // leave no customer rows behind for other suites
  require('../src/config/tenantGuard').clearCache();
  await prisma.$disconnect();
});

const allCodes = () => [...new Set(rows.map((r) => r.module_code))];

describe('mapping data', () => {
  test('the draft mapping covers modules from the plan and every row points at a real module; the longest prefix wins', async () => {
    expect(rows.length).toBeGreaterThan(40);
    expect(new Set(rows.map((r) => r.module_code)).size).toBeGreaterThan(20);
    expect(await saasGate.moduleFor('/api/v1/expenses/vendor-payments/123?x=1')).toBe('VNPY');
    expect(await saasGate.moduleFor('/api/v1/expenses/claims')).toBe('EXRB');
    expect(await saasGate.moduleFor('/api/v1/users')).toBeNull();
    expect(await saasGate.moduleFor('/api/v1/accountsX')).toBeNull(); // prefix match is by whole path segment
  });
});

describe('switch ON, customer company', () => {
  beforeEach(async () => { await switches.setSwitch('enforce', true, null); });

  test('without days every mapped route is refused with its own module code; unmapped routes are not gated', async () => {
    for (const r of rows) {
      const res = await hit(cust.token, r.path_prefix);
      if (!GATE.test(res.body.message || '')) throw new Error(`${r.path_prefix} (${r.module_code}) was not gated: ${res.status} ${res.body.message}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toContain(r.module_code);
    }
    for (const open of ['/users', '/orgs', '/dashboard']) {
      const res = await hit(cust.token, open);
      expect(GATE.test(res.body.message || '')).toBe(false);
    }
  });

  test('with days on every module nothing is gated', async () => {
    await give(slot.id, ['BASC', ...allCodes()]);
    for (const r of rows) {
      const res = await hit(cust.token, r.path_prefix);
      expect({ path: r.path_prefix, gated: GATE.test(res.body.message || '') }).toMatchObject({ gated: false });
    }
  });

  test('one module with days opens only its own routes, and a module whose prerequisite has no days is paused', async () => {
    await give(slot.id, ['CLVN']);
    expect(GATE.test((await hit(cust.token, '/accounts')).body.message || '')).toBe(false);
    expect((await hit(cust.token, '/requirements')).body.message).toContain('RQLD');
    // Payroll needs Employee Management and Attendance & Leave: with days on PAYR alone it is still paused
    await give(slot.id, ['PAYR']);
    expect((await hit(cust.token, '/payroll')).body.message).toContain('PAYR');
    await give(slot.id, ['BASC', 'EMPM', 'ATLV']);
    expect(GATE.test((await hit(cust.token, '/payroll')).body.message || '')).toBe(false);
  });

  test('a slot that is paused, or a user with no slot, gets nothing', async () => {
    await give(slot.id, ['CLVN']);
    await credits.setSlotStatus(slot.id, 'paused');
    expect(GATE.test((await hit(cust.token, '/accounts')).body.message || '')).toBe(true);
    const other = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(other.id, cust.org.id, { role: 'admin' });
    const tok = (await loginAs(other)).access_token;
    expect(GATE.test((await hit(tok, '/accounts')).body.message || '')).toBe(true);
  });

  test('a read-only customer can look (GET) but not change (POST)', async () => {
    await prisma.saasCustomer.update({ where: { id: cust.customer.id }, data: { status: 'read_only' } });
    expect(GATE.test((await hit(cust.token, '/accounts')).body.message || '')).toBe(false);
    const post = await hit(cust.token, '/accounts', 'post');
    expect(post.status).toBe(403);
    expect(post.body.message).toMatch(/read-only/);
  });

  test('a trial has every module for its dates and nothing after', async () => {
    const trial = await customerUser('trial');
    await prisma.saasCustomer.update({ where: { id: trial.customer.id }, data: { trial_ends_on: new Date(Date.now() + 5 * 86400000) } });
    for (const r of rows.slice(0, 8)) expect(GATE.test((await hit(trial.token, r.path_prefix)).body.message || '')).toBe(false);
    await prisma.saasCustomer.update({ where: { id: trial.customer.id }, data: { trial_ends_on: new Date(Date.now() - 2 * 86400000) } });
    expect((await hit(trial.token, '/accounts', 'post')).status).toBe(403); // ended: read-only
  });

  test('a company that is not a customer is never blocked, on any mapped route', async () => {
    for (const r of rows) {
      const res = await hit(ours.token, r.path_prefix);
      expect({ path: r.path_prefix, gated: /module is not active|read-only/.test(res.body.message || '') }).toMatchObject({ gated: false });
      expect({ path: r.path_prefix, status: res.status < 500 }).toEqual({ path: r.path_prefix, status: true }); // the tenant read guard must never break our own queries
    }
  });

  test('the menu: a customer without days is told which menu paths to hide; our company is not', async () => {
    await give(slot.id, ['BASC', 'CLVN']);
    const mine = (await hit(cust.token, '/platform/my-modules')).body.data;
    expect(mine.applies).toBe(true);
    expect(mine.locked).toContain('/payroll');
    expect(mine.locked).not.toContain('/accounts');
    const theirs = (await hit(ours.token, '/platform/my-modules')).body.data;
    expect(theirs).toEqual({ applies: false, locked: [] });
  });

  test('the mapping is editable by a platform admin, audited, and takes effect at once', async () => {
    const pa = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(pa.id, ours.org.id, { role: 'admin' });
    await prisma.platformAdmin.create({ data: { user_id: pa.id } });
    const ptok = (await loginAs(pa)).access_token;
    expect((await authed(request(app).put('/api/v1/platform/route-modules'), cust.token).send({ path_prefix: '/notifications', module_code: 'BILL' })).status).toBe(403);
    const put = await authed(request(app).put('/api/v1/platform/route-modules'), ptok).send({ path_prefix: '/notifications', module_code: 'BILL', note: 'test' });
    expect(put.status).toBe(200);
    expect((await hit(cust.token, '/notifications')).body.message).toContain('BILL');
    expect((await authed(request(app).put('/api/v1/platform/route-modules'), ptok).send({ path_prefix: '/notifications', module_code: 'NOPE' })).status).toBe(404);
    const del = await authed(request(app).delete(`/api/v1/platform/route-modules/${put.body.data.id}`), ptok);
    expect(del.status).toBe(200);
    expect(GATE.test((await hit(cust.token, '/notifications')).body.message || '')).toBe(false);
    const audit = await prisma.saasAudit.findMany({ where: { entity: 'route_module', entity_id: '/notifications' } });
    expect(audit.map((a) => a.action).sort()).toEqual(['route_mapping_added', 'route_mapping_removed']);
    await prisma.saasAudit.deleteMany({});
  });
});

describe('switch OFF (the default)', () => {
  test('nothing is blocked for anyone, customer or not, even with no days at all', async () => {
    for (const r of rows) {
      for (const tok of [cust.token, ours.token]) {
        const res = await hit(tok, r.path_prefix);
        expect({ path: r.path_prefix, gated: /module is not active|read-only/.test(res.body.message || '') }).toMatchObject({ gated: false });
      }
    }
    expect((await hit(cust.token, '/platform/my-modules')).body.data).toEqual({ applies: false, locked: [] });
  });
});
