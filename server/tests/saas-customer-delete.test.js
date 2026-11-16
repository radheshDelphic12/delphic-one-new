jest.setTimeout(400000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const switches = require('../src/modules/platform/switches.service');
const credits = require('../src/modules/platform/credits.service');
const billing = require('../src/modules/platform/billing.service');
const saasGate = require('../src/modules/platform/saasGate');
const tenantGuard = require('../src/config/tenantGuard');

// Soft delete and restore of customers: NOTHING is ever physically removed. A delete hides the customer everywhere, deactivates only the users who belong
// to that customer alone, switches the customer's companies off, and keeps every row; a restore puts back exactly what the delete changed.

const D = '/api/v1/delphic-one';
let dox; let owner2; let superTok; let superUser; let adminTok; let platformTok; let salesTok; let groupId;
const call = (method, url, tok, body) => { const r = authed(request(app)[method](url), tok); return body === undefined ? r : r.send(body); };
const dget = (path, tok = superTok) => call('get', `${D}${path}`, tok);
const dpost = (path, body, tok = superTok) => call('post', `${D}${path}`, tok, body || {});

async function tableCounts() {
  const tables = (await prisma.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")).map((t) => t.table_name).filter((t) => t !== '_prisma_migrations');
  const rows = await prisma.$queryRawUnsafe(tables.map((t) => `SELECT '${t}' AS t, count(*)::int AS n FROM "${t}"`).join(' UNION ALL '));
  return Object.fromEntries(rows.map((r) => [r.t, r.n]));
}
// a fingerprint of the rows of the given companies, per table (tables that have an org_id column)
async function orgRowHashes(orgIds) {
  const tables = (await prisma.$queryRawUnsafe("SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id' ORDER BY 1")).map((t) => t.table_name);
  const rows = await prisma.$queryRawUnsafe(tables.map((t) => `SELECT '${t}' AS t, md5(coalesce(string_agg(x::text, ',' ORDER BY x::text), '')) AS h FROM "${t}" x WHERE org_id::text = ANY($1::text[])`).join(' UNION ALL '), orgIds);
  return Object.fromEntries(rows.map((r) => [r.t, r.h]));
}
const without = (h, ...tables) => Object.fromEntries(Object.entries(h).filter(([t]) => !tables.includes(t)));
const userRows = async (ids) => (await prisma.user.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } })).map((u) => `${u.id}:${u.active}`);

async function provision(name) {
  const c = await prisma.doxCustomer.create({ data: { org_id: dox.id, name, contact_name: 'Asha', contact_email: `${name.toLowerCase().replace(/\W+/g, '')}${Date.now()}@cust.example`, status: 'trial' } });
  const res = await dpost(`/customers/${c.id}/provision`);
  expect(res.status).toBe(201);
  const admin = await prisma.user.findFirst({ where: { email: res.body.data.admin_email } });
  const login = await request(app).post('/api/v1/auth/login').send({ email: res.body.data.admin_email, password: res.body.data.temp_password });
  expect(login.status).toBe(200);
  const orgId = res.body.data.org_id;
  // some data of the customer in several modules
  await prisma.account.create({ data: { org_id: orgId, type: 'client', name: `${name} Client`, stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
  await prisma.department.create({ data: { org_id: orgId, name: `Ops ${name}` } });
  const inv = await prisma.doxInvoice.create({ data: { org_id: dox.id, customer_id: c.id, number: `T/${name}/1`, invoice_date: new Date(), amount: 1000, gst_amount: 180, total: 1180, status: 'sent' } });
  await prisma.doxInvoicePayment.create({ data: { org_id: dox.id, invoice_id: inv.id, date: new Date(), amount: 100, mode: 'bank_transfer' } });
  await prisma.doxLead.create({ data: { org_id: dox.id, company_name: name, stage: 'won', customer_id: c.id } });
  return { dox: c, ...res.body.data, admin, token: login.body.data.access_token, refresh: login.body.data.refresh_token, orgId, invoice: inv };
}

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dox_customers, dox_leads, dox_lead_notes, dox_invoices, dox_invoice_payments, invoice_followups, saas_customers, saas_customer_deletions, saas_audit CASCADE');
  await switches.setSwitch('provisioning', true, null);
  dox = await createOrg({ name: 'Delphic One', slug: 'delphic-one' });
  groupId = dox.org_group_id;
  await prisma.org.update({ where: { id: dox.id }, data: { enabled_modules: ['delphic_one'] } });
  owner2 = await createOrg({ name: 'Owner Sister Co', slug: 'owner-sister', org_group_id: groupId });
  await prisma.account.create({ data: { org_id: owner2.id, type: 'client', name: 'Owner Sister Client', stage: 'active', owner_id: null } }).catch(() => {});
  superUser = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: superUser.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: superUser.id, org_group_id: groupId } });
  await createOrgMembership(superUser.id, dox.id, { role: 'admin' });
  superTok = (await loginAs(superUser)).access_token;
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, dox.id, { role: 'admin' });
  adminTok = (await loginAs(admin)).access_token;
  const sales = await createUser({ role: 'sales', withOrg: false });
  await createOrgMembership(sales.id, dox.id, { role: 'sales' });
  salesTok = (await loginAs(sales)).access_token;
  const pa = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(pa.id, dox.id, { role: 'admin' });
  await prisma.platformAdmin.create({ data: { user_id: pa.id } });
  platformTok = (await loginAs(pa)).access_token;
  tenantGuard.clearCache(); saasGate.clearCache();
});
afterEach(async () => {
  await prisma.saasSetting.deleteMany({ where: { key: { startsWith: 'switch.' } } });
  switches.clearCache(); saasGate.clearCache(); tenantGuard.clearCache();
  delete process.env.SAAS_ENFORCE_ENTITLEMENTS;
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE saas_customers, saas_customer_deletions CASCADE');
  tenantGuard.clearCache();
  await prisma.$disconnect();
});

async function softDelete(c, tok = superTok, name) {
  const pre = await dpost(`/customers/${c.dox.id}/delete-preview`, {}, tok);
  if (pre.status !== 200) return { pre };
  const res = await dpost(`/customers/${c.dox.id}/delete`, { confirm_name: name ?? pre.body.data.confirm_with, token: pre.body.data.token, reason: 'test' }, tok);
  return { pre, res };
}

describe('soft delete of a customer with a workspace', () => {
  test('hides it everywhere, changes no row count, touches no owner row except the customer record, and a restore puts back exactly the same state', async () => {
    const baselineSummary = (await dget('/summary')).body.data;
    const ownerOrgs = [dox.id, owner2.id];
    const c1 = await provision('Alpha Traders');
    const c2 = await provision('Beta Mills');
    // c1 is a paying customer with credit days and an order; c2 stays a trial
    await prisma.saasCustomer.update({ where: { id: c1.customer_id }, data: { status: 'active' } });
    const slot = await prisma.saasSlot.findFirst({ where: { customer_id: c1.customer_id } });
    await credits.addCredit({ slotId: slot.id, code: 'CLVN', days: 20 });
    const order = (await billing.createOrder(c1.customer_id, { lines: [{ slot_id: slot.id, code: 'PRJM' }] })).order;
    const extra = await createUser({ role: 'employee', withOrg: false });
    await createOrgMembership(extra.id, c1.orgId, { role: 'employee' });

    const before = await tableCounts();
    const ownerBefore = await orgRowHashes(ownerOrgs);
    const c1Before = await orgRowHashes([c1.orgId]);
    const c2Before = await orgRowHashes([c2.orgId]);
    const usersBefore = await userRows([c1.admin.id, extra.id]);
    const groupBefore = (await dget('/summary')).body.data;
    const dashBefore = (await call('get', '/api/v1/super-dashboard/group/overview?from=2026-01&to=2026-03', superTok)).body.data;
    const guardBefore = (await call('get', '/api/v1/accounts', superTok)).body.data.map((a) => a.name).sort();

    // dry run: counts and the users, nothing changes
    const pre = await dpost(`/customers/${c1.dox.id}/delete-preview`);
    expect(pre.status).toBe(200);
    expect(pre.body.data).toMatchObject({ name: 'Alpha Traders', workspace: true, kept: true, confirm_with: 'Alpha Traders' });
    expect(pre.body.data.users.map((u) => u.email).sort()).toEqual([c1.admin.email, extra.email].sort());
    expect(pre.body.data.counts).toMatchObject({ users: 2, companies: 1, dox_invoices: 1, dox_invoice_payments: 1, linked_leads: 1 });
    expect(pre.body.data.counts.company_rows.accounts).toBe(1);
    expect(pre.body.data.will.join(' ')).toMatch(/kept in the database/);
    expect((await prisma.saasCustomer.findUnique({ where: { id: c1.customer_id } })).status).toBe('active'); // dry run changed nothing

    const { res } = await softDelete(c1);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ done: true, soft: true });

    // nothing was physically removed: every table has the same number of rows, except the audit trail and the deletion record, which gained one
    const after = await tableCounts();
    for (const t of Object.keys(before)) {
      if (['saas_audit', 'saas_customer_deletions'].includes(t)) expect(after[t]).toBeGreaterThanOrEqual(before[t]);
      else expect({ t, n: after[t] }).toEqual({ t, n: before[t] });
    }
    expect(after.saas_customer_deletions).toBe(before.saas_customer_deletions + 1);
    // owner rows are byte-identical; the only owner row that changed is the customer record itself (marked deleted)
    const ownerAfter = await orgRowHashes(ownerOrgs);
    const changed = Object.keys(ownerBefore).filter((t) => ownerBefore[t] !== ownerAfter[t]);
    expect(changed).toEqual(['dox_customers']);
    // the customer's own rows are untouched too; the other customer is untouched
    // (the customer record saas_customers is the one row of theirs that is marked)
    expect(without(await orgRowHashes([c1.orgId]), 'saas_customers')).toEqual(without(c1Before, 'saas_customers'));
    expect(await orgRowHashes([c2.orgId])).toEqual(c2Before);
    expect((await prisma.user.findUnique({ where: { id: c2.admin.id } })).active).toBe(true);
    expect((await prisma.org.findUnique({ where: { id: c2.orgId } })).status).toBe('active');

    // what changed: customer status, company status, exactly the two users
    expect((await prisma.saasCustomer.findUnique({ where: { id: c1.customer_id } })).status).toBe('deleted');
    expect((await prisma.org.findUnique({ where: { id: c1.orgId } })).status).toBe('inactive');
    expect((await prisma.user.findMany({ where: { id: { in: [c1.admin.id, extra.id] } } })).every((u) => u.active === false)).toBe(true);

    // gone from every list and total
    expect((await dget('/customers')).body.data.map((c) => c.name)).toEqual(['Beta Mills']);
    expect((await dget('/customers?status=trial')).body.data.map((c) => c.name)).toEqual(['Beta Mills']);
    const inv = (await dget('/invoices')).body.data;
    expect(inv.rows.map((r) => r.number)).toEqual(['T/Beta Mills/1']);
    expect((await dget(`/invoices?customer_id=${c1.dox.id}`)).body.data.rows).toEqual([]);
    const summary = (await dget('/summary')).body.data;
    expect(summary.customers.total).toBe(1);
    expect(summary.receivables.outstanding).toBe(1080); // only Beta's 1180 - 100
    expect((await dget('/leads')).body.data.find((l) => l.company_name === 'Alpha Traders')).toMatchObject({ customer_id: null, customer_deleted: true });
    expect((await call('get', '/api/v1/platform/customers', platformTok)).body.data.map((c) => c.name)).toEqual(['Beta Mills']);
    expect((await call('get', '/api/v1/platform/orders', platformTok)).body.data).toEqual([]);
    expect((await call('post', `/api/v1/platform/orders/${order.id}/payments`, platformTok, { amount: order.total, idempotency_key: 'late-payment-0001' })).status).toBe(409);
    expect((await call('post', `/api/v1/platform/customers/${c1.customer_id}/quote`, platformTok, { lines: [{ slot_id: slot.id, code: 'CLVN' }] })).status).toBe(404);
    // the Deleted view is for super admins only and shows it
    expect((await dget('/customers?status=deleted')).body.data.map((c) => c.name)).toEqual(['Alpha Traders']);
    expect((await dget('/customers?status=deleted', adminTok)).status).toBe(403);

    // no credit burning, no trial lifecycle, no module access
    await switches.setSwitch('counter', true, null);
    await credits.runDailyCounter(new Date(Date.now() + 86400000));
    expect((await prisma.saasSlotCredit.findFirst({ where: { slot_id: slot.id, module_code: 'CLVN' } })).days_left).toBe(20);
    await prisma.saasCustomer.update({ where: { id: c1.customer_id }, data: { trial_ends_on: new Date('2020-01-01') } });
    const life = await credits.runTrialLifecycle();
    expect([...life.made_read_only, ...life.suspended]).not.toContain(c1.customer_id);
    expect((await prisma.saasCustomer.findUnique({ where: { id: c1.customer_id } })).status).toBe('deleted');
    await prisma.saasCustomer.update({ where: { id: c1.customer_id }, data: { trial_ends_on: null } });
    const ent = await require('../src/modules/platform/entitlements.service').entitlementsFor({ id: c1.admin.id, email: c1.admin.email }, c1.orgId);
    expect(ent.modules).toEqual([]);

    // the deleted customer's people cannot get in: not by signing in, not by refresh, and the token they already had stops at once
    expect((await request(app).post('/api/v1/auth/login').send({ email: c1.admin.email, password: c1.temp_password })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refresh_token: c1.refresh })).status).toBeGreaterThanOrEqual(400);
    const stale = await authed(request(app).get('/api/v1/accounts'), c1.token);
    expect(stale.status).toBe(403);
    expect(stale.body.message).toMatch(/deleted/);
    // the other customer still works
    expect((await authed(request(app).get('/api/v1/accounts'), c2.token)).status).toBeLessThan(500);
    expect((await authed(request(app).get('/api/v1/platform/my-setup'), c2.token)).body.data.applies).toBe(true);

    // owner reports are exactly what they were before the customer existed (summary) / before the delete (group dashboard, our accounts)
    expect(summary.customers.users).toBeDefined();
    expect((await call('get', '/api/v1/super-dashboard/group/overview?from=2026-01&to=2026-03', superTok)).body.data).toEqual(dashBefore);
    expect((await call('get', '/api/v1/accounts', superTok)).body.data.map((a) => a.name).sort()).toEqual(guardBefore);
    expect(groupBefore.leads.total).toBe(2); // sanity: the baseline had both customers' leads
    expect(baselineSummary.customers.total).toBe(0);

    // the guard stays on while any deleted customer exists, so its rows still never reach our reports: delete the other customer too
    const del2 = await softDelete(c2);
    expect(del2.res.status).toBe(200);
    expect(await prisma.saasCustomer.count()).toBe(2); // rows kept
    tenantGuard.clearCache();
    expect((await call('get', '/api/v1/accounts', superTok)).body.data.map((a) => a.name).sort()).toEqual(guardBefore); // no customer account leaks into ours
    expect((await dget('/customers')).body.data).toEqual([]);

    // the deleted customer's login stays reserved, and says so
    const reuse = await prisma.doxCustomer.create({ data: { org_id: dox.id, name: 'Alpha Again', contact_email: c1.admin.email, status: 'trial' } });
    const again = await dpost(`/customers/${reuse.id}/provision`);
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/deleted customer/i);

    // RESTORE c1: same state as before
    const rpre = await dpost(`/customers/${c1.dox.id}/restore-preview`);
    expect(rpre.status).toBe(200);
    expect(rpre.body.data.users).toHaveLength(2);
    expect((await dpost(`/customers/${c1.dox.id}/restore`, { confirm_name: 'wrong', token: rpre.body.data.token })).status).toBe(422);
    const rres = await dpost(`/customers/${c1.dox.id}/restore`, { confirm_name: 'Alpha Traders', token: rpre.body.data.token });
    expect(rres.status).toBe(200);
    expect(await userRows([c1.admin.id, extra.id])).toEqual(usersBefore); // c2 stays deleted, only c1 came back
    expect((await prisma.user.findMany({ where: { id: { in: [c1.admin.id, extra.id] } } })).every((u) => u.active === true)).toBe(true);
    expect((await prisma.org.findUnique({ where: { id: c1.orgId } })).status).toBe('active');
    expect((await prisma.saasCustomer.findUnique({ where: { id: c1.customer_id } })).status).toBe('active'); // back to what it was
    expect((await dget('/customers')).body.data.map((c) => c.name)).toEqual(['Alpha Again', 'Alpha Traders']);
    expect((await dget('/invoices')).body.data.rows.map((r) => r.number)).toEqual(['T/Alpha Traders/1']);
    expect((await request(app).post('/api/v1/auth/login').send({ email: c1.admin.email, password: c1.temp_password })).status).toBe(200);
    expect(without(await orgRowHashes([c1.orgId]), 'saas_customers')).toEqual(without(c1Before, 'saas_customers'));
    expect(without(await orgRowHashes(ownerOrgs), 'dox_customers')).toEqual(without(ownerBefore, 'dox_customers')); // owner rows identical again (the customer record only differs by its edit time)
    const back = await prisma.doxCustomer.findUnique({ where: { id: c1.dox.id } });
    expect(back).toMatchObject({ deleted_at: null, deleted_by: null, deleted_reason: null, status: 'trial' });
    const restoredCounts = await tableCounts();
    // (tables this test itself added to meanwhile: the audit trail, the deletion record, a switch row, a counter run, the extra customer used for the reserved-email check)
    const touched = ['saas_audit', 'saas_customer_deletions', 'saas_settings', 'saas_counter_runs', 'dox_customers'];
    for (const t of Object.keys(before)) if (!touched.includes(t)) expect({ t, n: restoredCounts[t] }).toEqual({ t, n: before[t] });
    expect(restoredCounts.dox_customers).toBe(before.dox_customers + 1);
    const rec = await prisma.saasCustomerDeletion.findFirst({ where: { saas_customer_id: c1.customer_id } });
    expect(rec.restored_at).toBeTruthy();
    const audit = await prisma.saasAudit.findMany({ where: { entity: 'customer', entity_id: 'Alpha Traders' }, orderBy: { created_at: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['customer_deleted', 'customer_restored']);
    expect(audit[0].after).toMatchObject({ soft: true, users: 2, companies: 1 });
  });
});

describe('soft delete of a customer without a workspace', () => {
  test('the Delphic One record is hidden with its invoices and totals, nothing is removed, and it can be restored', async () => {
    const baseline = (await dget('/summary')).body.data;
    const c = await prisma.doxCustomer.create({ data: { org_id: dox.id, name: 'Paper Only Co', contact_email: 'p@paper.example', status: 'active', monthly_value: 500 } });
    const inv = await prisma.doxInvoice.create({ data: { org_id: dox.id, customer_id: c.id, number: 'T/PAPER/1', invoice_date: new Date(), amount: 100, gst_amount: 18, total: 118, status: 'sent' } });
    const before = await tableCounts();
    const pre = await dpost(`/customers/${c.id}/delete-preview`);
    expect(pre.body.data).toMatchObject({ workspace: false, counts: { dox_invoices: 1 } });
    const done = await dpost(`/customers/${c.id}/delete`, { confirm_name: 'Paper Only Co', token: pre.body.data.token });
    expect(done.status).toBe(200);
    const after = await tableCounts();
    for (const t of Object.keys(before)) if (!['saas_audit', 'saas_customer_deletions'].includes(t)) expect({ t, n: after[t] }).toEqual({ t, n: before[t] });
    expect(await prisma.doxInvoice.count({ where: { id: inv.id } })).toBe(1); // kept
    expect((await dget('/customers')).body.data).toEqual([]);
    expect((await dget('/summary')).body.data).toEqual(baseline); // as if it never existed
    expect((await dget('/customers?status=deleted')).body.data.map((x) => x.name)).toEqual(['Paper Only Co']);
    expect((await dpost(`/customers/${c.id}/delete-preview`)).status).toBe(409); // already deleted
    const rpre = await dpost(`/customers/${c.id}/restore-preview`);
    expect((await dpost(`/customers/${c.id}/restore`, { confirm_name: 'Paper Only Co', token: rpre.body.data.token })).status).toBe(200);
    expect((await dget('/customers')).body.data.map((x) => x.name)).toEqual(['Paper Only Co']);
    expect((await dget('/invoices')).body.data.rows).toHaveLength(1);
  });
});

describe('refusals', () => {
  test('only a super admin of the owner group: a Delphic One admin, sales, and a platform admin are all refused, and a super admin of a customer group is not enough', async () => {
    const c = await provision('Gamma Works');
    for (const tok of [adminTok, salesTok, platformTok]) {
      expect((await dpost(`/customers/${c.dox.id}/delete-preview`, {}, tok)).status).toBe(403);
      expect((await dpost(`/customers/${c.dox.id}/delete`, { confirm_name: 'Gamma Works', token: 'x.y' }, tok)).status).toBe(403);
      expect((await call('post', `/api/v1/platform/customers/${c.customer_id}/delete-preview`, tok, {})).status).toBe(403);
    }
    expect((await dget('/me', adminTok)).body.data.can_delete_customers).toBe(false);
    expect((await dget('/me', superTok)).body.data.can_delete_customers).toBe(true);
    // a group super admin of a CUSTOMER group (not an owner group) cannot do it either
    const custSuper = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: custSuper.id }, data: { is_group_superadmin: true } });
    const grp = await prisma.orgGroup.findFirst({ where: { id: c.org_group_id } });
    await prisma.orgGroupMembership.create({ data: { user_id: custSuper.id, org_group_id: grp.id } });
    await createOrgMembership(custSuper.id, dox.id, { role: 'admin' });
    const tok = (await loginAs(custSuper)).access_token;
    expect((await dpost(`/customers/${c.dox.id}/delete-preview`, {}, tok)).status).toBe(403);
    expect((await prisma.saasCustomer.findUnique({ where: { id: c.customer_id } })).status).toBe('trial'); // nothing changed
  });

  test('the platform route works for the owner super admin even when not on the platform-admin list', async () => {
    const c = await provision('Delta Foods');
    const pre = await call('post', `/api/v1/platform/customers/${c.customer_id}/delete-preview`, superTok, {});
    expect(pre.status).toBe(200);
    const done = await call('post', `/api/v1/platform/customers/${c.customer_id}/delete`, superTok, { confirm_name: 'Delta Foods', token: pre.body.data.token });
    expect(done.status).toBe(200);
    expect((await prisma.saasCustomer.findUnique({ where: { id: c.customer_id } })).status).toBe('deleted');
    expect((await call('get', '/api/v1/platform/access', superTok)).body.data.can_delete_customers).toBe(true);
  });

  test('a wrong company name, or a stale preview, changes nothing', async () => {
    const c = await provision('Epsilon Labs');
    const pre = await dpost(`/customers/${c.dox.id}/delete-preview`);
    expect((await dpost(`/customers/${c.dox.id}/delete`, { confirm_name: 'epsilon labs', token: pre.body.data.token })).status).toBe(422); // exact, case-sensitive
    expect((await dpost(`/customers/${c.dox.id}/delete`, { confirm_name: 'Epsilon Labs', token: 'nonsense' })).status).toBe(409);
    // something it counted changes after the preview: a new invoice
    await prisma.doxInvoice.create({ data: { org_id: dox.id, customer_id: c.dox.id, number: 'T/EPS/2', invoice_date: new Date(), amount: 10, gst_amount: 0, total: 10, status: 'sent' } });
    const stale = await dpost(`/customers/${c.dox.id}/delete`, { confirm_name: 'Epsilon Labs', token: pre.body.data.token });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toMatch(/out of date/);
    expect((await prisma.saasCustomer.findUnique({ where: { id: c.customer_id } })).status).toBe('trial');
    expect((await prisma.user.findUnique({ where: { id: c.admin.id } })).active).toBe(true);
    expect(await prisma.saasCustomerDeletion.count()).toBe(0);
  });

  test('a user who also belongs to another company, a group super admin or a platform admin blocks the delete and is never touched', async () => {
    const c = await provision('Zeta Steel');
    const shared = await createUser({ role: 'employee', withOrg: false });
    await createOrgMembership(shared.id, c.orgId, { role: 'employee' });
    await createOrgMembership(shared.id, owner2.id, { role: 'employee' }); // also works in our group
    const refused = await dpost(`/customers/${c.dox.id}/delete-preview`);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain(shared.email);
    expect(refused.body.data.users[0].reasons.join(' ')).toMatch(/another company/);
    expect((await prisma.user.findUnique({ where: { id: shared.id } })).active).toBe(true);
    await prisma.orgMembership.deleteMany({ where: { person_id: shared.id, org_id: owner2.id } });
    // a platform admin inside the customer group blocks it as well
    await prisma.platformAdmin.create({ data: { user_id: shared.id } });
    expect((await dpost(`/customers/${c.dox.id}/delete-preview`)).body.data.users[0].reasons.join(' ')).toMatch(/platform admin/);
    await prisma.platformAdmin.deleteMany({ where: { user_id: shared.id } });
    await prisma.user.update({ where: { id: shared.id }, data: { is_group_superadmin: true } });
    expect((await dpost(`/customers/${c.dox.id}/delete-preview`)).body.data.users[0].reasons.join(' ')).toMatch(/group super admin/);
    await prisma.user.update({ where: { id: shared.id }, data: { is_group_superadmin: false } });
    expect((await dpost(`/customers/${c.dox.id}/delete-preview`)).status).toBe(200); // clean again
  });

  test('a target that is in an owner group can never be deleted, whatever its customer row says', async () => {
    const c = await prisma.doxCustomer.create({ data: { org_id: dox.id, name: 'Impostor', contact_email: 'i@x.example', status: 'trial' } });
    const sc = await prisma.saasCustomer.create({ data: { dox_customer_id: c.id, org_group_id: groupId, org_id: owner2.id, name: 'Impostor', status: 'trial' } });
    const pre = await dpost(`/customers/${c.id}/delete-preview`);
    expect(pre.status).toBe(409);
    expect(pre.body.message).toMatch(/own group/);
    expect((await call('post', `/api/v1/platform/customers/${sc.id}/delete-preview`, superTok, {})).status).toBe(409);
    expect((await prisma.org.findUnique({ where: { id: owner2.id } })).status).toBe('active');
    // the company of the Delphic One workspace itself
    await prisma.saasCustomer.update({ where: { id: sc.id }, data: { org_id: dox.id } }).catch(() => {});
    expect((await dpost(`/customers/${c.id}/delete-preview`)).status).toBe(409);
  });
});
