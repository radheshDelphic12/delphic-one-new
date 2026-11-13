jest.setTimeout(300000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const switches = require('../src/modules/platform/switches.service');
const sessionRevocation = require('../src/lib/sessionRevocation');
const tenantGuard = require('../src/config/tenantGuard');
const saasGate = require('../src/modules/platform/saasGate');

// Admin password reset: Delphic One > Team (admin) and a customer's first admin (owner super admin). The new password is shown once; the old one stops
// working, earlier sessions end, an audit entry records who/whom/when and never the password.
const D = '/api/v1/delphic-one';
const PW = 'Password123!';
let dox; let other; let admin; let adminTok; let sales; let salesTok; let superUser; let superTok; let otherUser;
const call = (method, path, tok, body) => { const r = authed(request(app)[method](`${D}${path}`), tok); return body === undefined ? r : r.send(body); };
const login = (email, password) => request(app).post('/api/v1/auth/login').send({ email, password });

async function member(role, orgId = dox.id) {
  const u = await createUser({ role, withOrg: false });
  await createOrgMembership(u.id, orgId, { role });
  return { user: u, token: (await loginAs(u)).access_token };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dox_customers, dox_leads, dox_lead_notes, dox_invoices, dox_invoice_payments, invoice_followups, saas_customers, saas_customer_deletions, saas_audit CASCADE');
  await prisma.user.updateMany({ data: { sessions_valid_after: null } });
  dox = await createOrg({ name: 'Delphic One', slug: 'delphic-one' });
  await prisma.org.update({ where: { id: dox.id }, data: { enabled_modules: ['delphic_one'] } });
  other = await createOrg({ name: 'Some Other Co', slug: 'some-other' });
  ({ user: admin, token: adminTok } = await member('admin'));
  ({ user: sales, token: salesTok } = await member('sales'));
  ({ user: otherUser } = await member('employee', other.id));
  superUser = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: superUser.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: superUser.id, org_group_id: dox.org_group_id } });
  await createOrgMembership(superUser.id, dox.id, { role: 'admin' });
  superTok = (await loginAs(superUser)).access_token;
  sessionRevocation.clearCache(); tenantGuard.clearCache(); saasGate.clearCache();
});
afterEach(async () => {
  await prisma.saasSetting.deleteMany({ where: { key: { startsWith: 'switch.' } } });
  switches.clearCache(); sessionRevocation.clearCache(); saasGate.clearCache(); tenantGuard.clearCache();
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE saas_customers, saas_customer_deletions CASCADE');
  tenantGuard.clearCache();
  await prisma.$disconnect();
});

describe('Delphic One > Team > Reset password', () => {
  test('only the Delphic One admin role may', async () => {
    expect((await call('post', `/team/${sales.id}/reset-password`, salesTok, {})).status).toBe(403);
    expect((await call('post', `/team/${sales.id}/reset-password`, adminTok, {})).status).toBe(200);
    // a person of another company is not even a Delphic One workspace member
    const otherAdmin = await member('admin', other.id);
    expect((await call('post', `/team/${sales.id}/reset-password`, otherAdmin.token, {})).status).toBe(403);
  });

  test('a strong password is generated and shown once; the old one stops, the new one works, and earlier sessions end', async () => {
    const oldAccess = salesTok;
    const oldRefresh = (await login(sales.email, PW)).body.data.refresh_token;
    await sleep(1100); // tokens are dated to the second: the reset must come after the old sessions
    const res = await call('post', `/team/${sales.id}/reset-password`, adminTok, {});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email: sales.email, shown_once: true });
    const pw = res.body.data.password;
    expect(pw).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
    expect(pw).toMatch(/[a-z]/); expect(pw).toMatch(/[A-Z]/); expect(pw).toMatch(/[0-9]/);
    expect((await login(sales.email, PW)).status).toBe(401); // the old password
    const fresh = await login(sales.email, pw);
    expect(fresh.status).toBe(200);
    // sessions: the old access token, and the old refresh token, no longer work; the new ones do
    const stale = await call('get', '/me', oldAccess);
    expect(stale.status).toBe(401);
    expect(stale.body.message).toMatch(/session has ended/);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refresh_token: oldRefresh })).status).toBeGreaterThanOrEqual(400);
    expect((await call('get', '/me', fresh.body.data.access_token)).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refresh_token: fresh.body.data.refresh_token })).status).toBe(200);
    // the password is stored only as a hash, and the reset changed nobody else
    const row = await prisma.user.findUnique({ where: { id: sales.id } });
    expect(row.password_hash).not.toContain(pw);
    expect((await login(admin.email, PW)).status).toBe(200);
    expect((await call('get', '/me', adminTok)).status).toBe(200);
  });

  test('an admin can type a password (at least 8 characters); a short one is refused', async () => {
    expect((await call('post', `/team/${sales.id}/reset-password`, adminTok, { password: 'short' })).status).toBe(422);
    expect((await login(sales.email, PW)).status).toBe(200); // nothing changed
    const res = await call('post', `/team/${sales.id}/reset-password`, adminTok, { password: 'My-Chosen-Pass-9' });
    expect(res.status).toBe(200);
    expect(res.body.data.password).toBe('My-Chosen-Pass-9');
    expect((await login(sales.email, 'My-Chosen-Pass-9')).status).toBe(200);
  });

  test('refused for yourself (use Settings), a super admin, someone who also works in another company, and anyone outside the Delphic One company', async () => {
    const self = await call('post', `/team/${admin.id}/reset-password`, adminTok, {});
    expect(self.status).toBe(409);
    expect(self.body.message).toMatch(/Settings/);
    expect((await login(admin.email, PW)).status).toBe(200);
    expect((await call('post', `/team/${superUser.id}/reset-password`, adminTok, {})).status).toBe(409);
    const both = await member('sales');
    await createOrgMembership(both.user.id, other.id, { role: 'employee' });
    const shared = await call('post', `/team/${both.user.id}/reset-password`, adminTok, {});
    expect(shared.status).toBe(409);
    expect(shared.body.message).toMatch(/another company/);
    expect((await login(both.user.email, PW)).status).toBe(200); // untouched
    expect((await call('post', `/team/${otherUser.id}/reset-password`, adminTok, {})).status).toBe(404);
    expect((await login(otherUser.email, PW)).status).toBe(200);
    // a platform admin is protected as well
    const pa = await member('sales');
    await prisma.platformAdmin.create({ data: { user_id: pa.user.id } });
    expect((await call('post', `/team/${pa.user.id}/reset-password`, adminTok, {})).status).toBe(409);
  });

  test('the audit entry says who, whom and when, and never holds the password', async () => {
    const res = await call('post', `/team/${sales.id}/reset-password`, adminTok, {});
    const pw = res.body.data.password;
    const rows = await prisma.saasAudit.findMany({ where: { action: 'password_reset' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: admin.id, entity: 'user', entity_id: sales.id });
    expect(rows[0].after).toMatchObject({ scope: 'delphic_one_team', email: sales.email });
    expect(rows[0].created_at).toBeTruthy();
    const everything = JSON.stringify(await prisma.saasAudit.findMany()) + JSON.stringify(await prisma.changeLog.findMany().catch(() => []));
    expect(everything).not.toContain(pw);
    expect(everything).not.toMatch(/password_hash|\$2[aby]\$/);
    // the list shown on the platform audit screen is the same
    const pa = await member('admin');
    await prisma.platformAdmin.create({ data: { user_id: pa.user.id } });
    const shown = JSON.stringify((await authed(request(app).get('/api/v1/platform/audit'), pa.token).catch(() => ({ body: {} }))).body);
    expect(shown).not.toContain(pw);
  });
});

describe('Reset admin password of a customer workspace', () => {
  async function provision(name) {
    await switches.setSwitch('provisioning', true, null);
    const c = await prisma.doxCustomer.create({ data: { org_id: dox.id, name, contact_name: 'Asha', contact_email: `${name.toLowerCase().replace(/\W+/g, '')}${Date.now()}@cust.example`, status: 'trial' } });
    const res = await call('post', `/customers/${c.id}/provision`, superTok, {});
    expect(res.status).toBe(201);
    return { dox: c, ...res.body.data };
  }

  test('an owner super admin resets it: old password stops, the new one works, the admin\'s sessions end, nobody else changes', async () => {
    const c = await provision('Acme Reset');
    const first = await login(c.admin_email, c.temp_password);
    expect(first.status).toBe(200);
    const other2 = await provision('Other Reset');
    const otherLogin = await login(other2.admin_email, other2.temp_password);
    await sleep(1100);
    const res = await call('post', `/customers/${c.dox.id}/reset-admin-password`, superTok, {});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email: c.admin_email, customer: 'Acme Reset', shown_once: true });
    const pw = res.body.data.password;
    expect((await login(c.admin_email, c.temp_password)).status).toBe(401);
    const fresh = await login(c.admin_email, pw);
    expect(fresh.status).toBe(200);
    expect((await authed(request(app).get('/api/v1/platform/my-setup'), first.body.data.access_token)).status).toBe(401); // old session ended
    expect((await authed(request(app).get('/api/v1/platform/my-setup'), fresh.body.data.access_token)).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refresh_token: first.body.data.refresh_token })).status).toBeGreaterThanOrEqual(400);
    expect((await authed(request(app).get('/api/v1/platform/my-setup'), otherLogin.body.data.access_token)).status).toBe(200); // the other customer is untouched
    const audit = await prisma.saasAudit.findMany({ where: { action: 'password_reset' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: superUser.id });
    expect(audit[0].after).toMatchObject({ scope: 'customer_admin', customer: 'Acme Reset', email: c.admin_email });
    expect(JSON.stringify(await prisma.saasAudit.findMany())).not.toContain(pw);
  });

  test('the same from Platform > Customers; a typed password works; a short one is refused', async () => {
    const c = await provision('Platform Reset');
    expect((await authed(request(app).post(`/api/v1/platform/customers/${c.customer_id}/reset-admin-password`), superTok).send({ password: 'x' })).status).toBe(422);
    const res = await authed(request(app).post(`/api/v1/platform/customers/${c.customer_id}/reset-admin-password`), superTok).send({ password: 'Typed-By-Owner-1' });
    expect(res.status).toBe(200);
    expect((await login(c.admin_email, 'Typed-By-Owner-1')).status).toBe(200);
  });

  test('only an owner super admin: a Delphic One admin, sales, a platform admin and a customer-group super admin are refused', async () => {
    const c = await provision('Guarded Co');
    const pa = await member('admin');
    await prisma.platformAdmin.create({ data: { user_id: pa.user.id } });
    for (const tok of [adminTok, salesTok, pa.token]) {
      expect((await call('post', `/customers/${c.dox.id}/reset-admin-password`, tok, {})).status).toBe(403);
      expect((await authed(request(app).post(`/api/v1/platform/customers/${c.customer_id}/reset-admin-password`), tok).send({})).status).toBe(403);
    }
    const custSuper = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: custSuper.id }, data: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: custSuper.id, org_group_id: c.org_group_id } });
    await createOrgMembership(custSuper.id, dox.id, { role: 'admin' });
    expect((await call('post', `/customers/${c.dox.id}/reset-admin-password`, (await loginAs(custSuper)).access_token, {})).status).toBe(403);
    expect((await login(c.admin_email, c.temp_password)).status).toBe(200); // never changed
    expect(await prisma.saasAudit.count({ where: { action: 'password_reset' } })).toBe(0);
  });

  test('refused for a deleted customer (until restored), a customer with no workspace, and an admin who also works elsewhere', async () => {
    const c = await provision('Soft Gone');
    const pre = await call('post', `/customers/${c.dox.id}/delete-preview`, superTok, {});
    await call('post', `/customers/${c.dox.id}/delete`, superTok, { confirm_name: 'Soft Gone', token: pre.body.data.token });
    const deleted = await call('post', `/customers/${c.dox.id}/reset-admin-password`, superTok, {});
    expect(deleted.status).toBe(409);
    expect(deleted.body.message).toMatch(/deleted/);
    const rpre = await call('post', `/customers/${c.dox.id}/restore-preview`, superTok, {});
    await call('post', `/customers/${c.dox.id}/restore`, superTok, { confirm_name: 'Soft Gone', token: rpre.body.data.token });
    expect((await call('post', `/customers/${c.dox.id}/reset-admin-password`, superTok, {})).status).toBe(200); // back, so allowed

    const paper = await prisma.doxCustomer.create({ data: { org_id: dox.id, name: 'Paper Only', status: 'active' } });
    const none = await call('post', `/customers/${paper.id}/reset-admin-password`, superTok, {});
    expect(none.status).toBe(409);
    expect(none.body.message).toMatch(/no workspace/);

    const d = await provision('Shared Admin Co');
    const adminUser = await prisma.user.findFirst({ where: { email: d.admin_email } });
    await createOrgMembership(adminUser.id, other.id, { role: 'employee' }); // the admin also works in another company
    const shared = await call('post', `/customers/${d.dox.id}/reset-admin-password`, superTok, {});
    expect(shared.status).toBe(409);
    expect((await login(d.admin_email, d.temp_password)).status).toBe(200);
  });

  test('the customer list says which customers have a workspace (for the button)', async () => {
    const c = await provision('Listed Co');
    await prisma.doxCustomer.create({ data: { org_id: dox.id, name: 'No Workspace Co', status: 'active' } });
    const rows = (await call('get', '/customers', superTok)).body.data;
    expect(rows.find((r) => r.name === 'Listed Co').has_workspace).toBe(true);
    expect(rows.find((r) => r.name === 'No Workspace Co').has_workspace).toBe(false);
    expect(c.customer_id).toBeTruthy();
  });
});
