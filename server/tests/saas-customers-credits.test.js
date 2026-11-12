jest.setTimeout(120000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const credits = require('../src/modules/platform/credits.service');
const entitlements = require('../src/modules/platform/entitlements.service');

// SaaS launch phases 1.5 and 2: provisioning a customer workspace (flagged), isolation between our group and customer groups, slots, credit days,
// the daily counter, entitlements (enforcement off by default).

const D = '/api/v1/delphic-one';
let org; let adminToken; let salesToken;
const post = (path, body, token = adminToken) => authed(request(app).post(`${D}${path}`), token).send(body || {});
const at = (iso) => new Date(`${iso}T06:00:00Z`);

async function member(role, orgId = org.id) {
  const u = await createUser({ role, withOrg: false });
  await createOrgMembership(u.id, orgId, { role });
  return { user: u, token: (await loginAs(u)).access_token };
}
async function doxCustomer(over = {}) {
  return prisma.doxCustomer.create({ data: { org_id: org.id, name: 'Acme Trading', contact_name: 'Asha', contact_email: `asha${Date.now()}${Math.floor(Math.random() * 1000)}@acme.example`, status: 'trial', ...over } });
}

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dox_customers, dox_leads, dox_lead_notes, dox_invoices, dox_invoice_payments, invoice_followups, saas_customers, saas_counter_runs CASCADE');
  delete process.env.SAAS_CUSTOMER_PROVISIONING;
  delete process.env.SAAS_ENFORCE_ENTITLEMENTS;
  org = await createOrg({ name: 'Delphic One', slug: 'delphic-one' });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['delphic_one'] } });
  ({ token: adminToken } = await member('admin'));
  ({ token: salesToken } = await member('sales'));
});
afterEach(async () => {
  await prisma.saasSetting.update({ where: { key: 'slot_move_days' }, data: { value: 7 } });
  await prisma.saasSetting.update({ where: { key: 'low_credit_alert_days' }, data: { value: 5 } });
});
afterAll(async () => { await prisma.$disconnect(); });

async function provisioned() {
  process.env.SAAS_CUSTOMER_PROVISIONING = 'true';
  const c = await doxCustomer();
  const res = await post(`/customers/${c.id}/provision`);
  expect(res.status).toBe(201);
  return { dox: c, ...res.body.data };
}

describe('provisioning a customer workspace', () => {
  test('is off by default: nothing is created', async () => {
    const c = await doxCustomer();
    expect((await post(`/customers/${c.id}/provision`)).status).toBe(404);
    expect(await prisma.saasCustomer.count()).toBe(0);
    expect(await prisma.orgGroup.count({ where: { kind: 'trial' } })).toBe(0);
  });

  test('the workspace screen only offers the button to Delphic One admins, and only when the switch is on', async () => {
    const me = (token) => authed(request(app).get(`${D}/me`), token);
    expect((await me(adminToken)).body.data.provisioning).toBe(false);
    process.env.SAAS_CUSTOMER_PROVISIONING = 'true';
    expect((await me(adminToken)).body.data.provisioning).toBe(true);
    expect((await me(salesToken)).body.data.provisioning).toBe(false);
  });

  test('when on: a new trial group with one clean company, a first admin, an admin slot, 15 days and 2 users', async () => {
    const r = await provisioned();
    const group = await prisma.orgGroup.findUnique({ where: { id: r.org_group_id } });
    expect(group.kind).toBe('trial');
    expect(r.org_group_id).not.toBe(org.org_group_id); // never inside our own group
    const newOrg = await prisma.org.findUnique({ where: { id: r.org_id } });
    expect(newOrg.org_group_id).toBe(r.org_group_id);
    expect(newOrg.is_master_workspace).toBe(false);
    expect(newOrg.enabled_modules).toEqual([]);
    expect(await prisma.account.count({ where: { org_id: r.org_id } })).toBe(0); // nothing copied from our companies
    const membership = await prisma.orgMembership.findFirst({ where: { org_id: r.org_id } });
    expect(membership.role).toBe('admin');
    const customer = await prisma.saasCustomer.findUnique({ where: { id: r.customer_id }, include: { slots: true } });
    expect(customer.status).toBe('trial');
    expect(customer.max_users).toBe(2);
    expect(customer.slots).toHaveLength(1);
    expect(customer.slots[0].is_admin).toBe(true);
    const days = Math.round((customer.trial_ends_on - customer.trial_starts_on) / 86400000);
    expect(days).toBe(15);
    expect(r.temp_password).toBeTruthy();
    // the first admin can sign in with the one-time password
    const login = await request(app).post('/api/v1/auth/login').send({ email: r.admin_email, password: r.temp_password });
    expect(login.status).toBe(200);
  });

  test('refuses a second workspace, a missing email, an email that already has a login, and a sales login', async () => {
    const r = await provisioned();
    expect((await post(`/customers/${r.dox.id}/provision`)).status).toBe(409);
    const noEmail = await doxCustomer({ contact_email: null });
    expect((await post(`/customers/${noEmail.id}/provision`)).status).toBe(422);
    const clash = await doxCustomer({ contact_email: r.admin_email });
    expect((await post(`/customers/${clash.id}/provision`)).status).toBe(409);
    const another = await doxCustomer();
    expect((await post(`/customers/${another.id}/provision`, {}, salesToken)).status).toBe(403);
  });

  test('the trial length and users follow the platform settings', async () => {
    await prisma.saasSetting.update({ where: { key: 'trial_days' }, data: { value: 20 } });
    await prisma.saasSetting.update({ where: { key: 'trial_users' }, data: { value: 3 } });
    try {
      const r = await provisioned();
      expect(r.max_users).toBe(3);
      const c = await prisma.saasCustomer.findUnique({ where: { id: r.customer_id } });
      expect(Math.round((c.trial_ends_on - c.trial_starts_on) / 86400000)).toBe(20);
    } finally {
      await prisma.saasSetting.update({ where: { key: 'trial_days' }, data: { value: 15 } });
      await prisma.saasSetting.update({ where: { key: 'trial_users' }, data: { value: 2 } });
    }
  });
});

describe('our group and customer groups never see each other', () => {
  test('the owner Group Dashboard never lists the customer company, and the customer admin cannot read our data', async () => {
    const r = await provisioned();
    const su = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: org.org_group_id } });
    await createOrgMembership(su.id, org.id, { role: 'admin' });
    const suToken = (await loginAs(su)).access_token;
    const ours = await authed(request(app).get('/api/v1/super-dashboard/group/overview?from=2026-01&to=2026-03'), suToken);
    expect(ours.status).toBe(200);
    expect(ours.body.data.companies.map((c) => c.org.id)).not.toContain(r.org_id);
    expect(await prisma.org.count({ where: { org_group_id: org.org_group_id, id: r.org_id } })).toBe(0);

    // the customer's own admin: not a group super admin, and the Delphic One workspace is closed to them
    const login = await request(app).post('/api/v1/auth/login').send({ email: r.admin_email, password: r.temp_password });
    const custToken = login.body.data.access_token;
    expect((await authed(request(app).get(`${D}/customers`), custToken)).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/super-dashboard/group/overview'), custToken)).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/platform/modules'), custToken)).status).toBe(403);
  });
});

describe('slots and credit days', () => {
  let customer; let adminSlot; let userSlot;
  beforeEach(async () => {
    const r = await provisioned();
    await prisma.saasCustomer.update({ where: { id: r.customer_id }, data: { status: 'active', max_users: 10 } });
    customer = r.customer_id;
    adminSlot = (await prisma.saasSlot.findFirst({ where: { customer_id: customer, is_admin: true } })).id;
    userSlot = (await credits.createSlot(customer, { email: 'Worker@Acme.example' })).slot.id;
  });

  test('credits go up with a ledger row, never below zero', async () => {
    expect((await credits.addCredit({ slotId: userSlot, code: 'ATLV', days: 30 })).balance).toBe(30);
    expect((await credits.addCredit({ slotId: userSlot, code: 'ATLV', days: -10, reason: 'correction' })).balance).toBe(20);
    expect((await credits.addCredit({ slotId: userSlot, code: 'ATLV', days: -50 })).error).toBe('below_zero');
    expect((await credits.addCredit({ slotId: userSlot, code: 'NOPE', days: 1 })).error).toBe('module_not_found');
    expect(await prisma.saasCreditLedger.count({ where: { slot_id: userSlot, module_code: 'ATLV' } })).toBe(2);
  });

  test('the daily counter burns one day, twice in a day changes nothing, a missed day is caught up', async () => {
    await credits.addCredit({ slotId: userSlot, code: 'ATLV', days: 10 });
    await credits.addCredit({ slotId: adminSlot, code: 'EMPM', days: 10 });
    const days = async (slot, code) => (await prisma.saasSlotCredit.findUnique({ where: { slot_id_module_code: { slot_id: slot, module_code: code } } })).days_left;

    const first = await credits.runDailyCounter(at('2026-12-01'));
    expect(first.touched).toBe(2);
    expect(await days(userSlot, 'ATLV')).toBe(9);
    const again = await credits.runDailyCounter(at('2026-12-01'));
    expect(again.ran_days).toBe(0);
    expect(await days(userSlot, 'ATLV')).toBe(9); // double run: nothing

    const caughtUp = await credits.runDailyCounter(at('2026-12-04')); // 2nd, 3rd and 4th were missed
    expect(caughtUp.ran_days).toBe(3);
    expect(await days(userSlot, 'ATLV')).toBe(6);
    expect(await days(adminSlot, 'EMPM')).toBe(6);
  });

  test('never below 0, and an alert is raised once when days are low', async () => {
    await credits.addCredit({ slotId: adminSlot, code: 'EMPM', days: 2 });
    const run1 = await credits.runDailyCounter(at('2026-12-01'));
    expect(run1.alerts).toHaveLength(1); // 1 day left <= 5
    const run2 = await credits.runDailyCounter(at('2026-12-02'));
    expect(run2.alerts).toHaveLength(0); // alerted once already
    await credits.runDailyCounter(at('2026-12-03'));
    await credits.runDailyCounter(at('2026-12-04'));
    expect((await prisma.saasSlotCredit.findUnique({ where: { slot_id_module_code: { slot_id: adminSlot, module_code: 'EMPM' } } })).days_left).toBe(0);
    // a top-up above the alert level re-arms the alert
    await credits.addCredit({ slotId: adminSlot, code: 'EMPM', days: 30 });
    expect((await prisma.saasSlotCredit.findUnique({ where: { slot_id_module_code: { slot_id: adminSlot, module_code: 'EMPM' } } })).alerted_at).toBeNull();
  });

  test('unassigned and paused slots do not burn, the admin slot always does, trial customers do not burn', async () => {
    const empty = (await credits.createSlot(customer, {})).slot.id;
    const paused = (await credits.createSlot(customer, { email: 'p@acme.example' })).slot.id;
    for (const s of [empty, paused, adminSlot]) await credits.addCredit({ slotId: s, code: 'ATLV', days: 10 });
    await credits.setSlotStatus(paused, 'paused');
    await credits.runDailyCounter(at('2026-12-01'));
    const left = async (s) => (await prisma.saasSlotCredit.findUnique({ where: { slot_id_module_code: { slot_id: s, module_code: 'ATLV' } } })).days_left;
    expect(await left(empty)).toBe(10);
    expect(await left(paused)).toBe(10);
    expect(await left(adminSlot)).toBe(9);
    await prisma.saasCustomer.update({ where: { id: customer }, data: { status: 'trial' } });
    await credits.runDailyCounter(at('2026-12-02'));
    expect(await left(adminSlot)).toBe(9);
  });

  test('a slot moves to another email at most once in 7 days; the admin slot cannot move; a trial has a user limit', async () => {
    expect((await credits.moveSlot(userSlot, 'new@acme.example', null, at('2026-12-01'))).ok).toBe(true);
    const slot = await prisma.saasSlot.findUnique({ where: { id: userSlot } });
    expect(slot.email).toBe('new@acme.example');
    expect((await credits.moveSlot(userSlot, 'again@acme.example', null, at('2026-12-03'))).error).toBe('too_soon');
    expect((await credits.moveSlot(userSlot, 'again@acme.example', null, at('2026-12-09'))).ok).toBe(true);
    expect((await credits.moveSlot(adminSlot, 'x@acme.example')).error).toBe('admin_slot');
    await prisma.saasCustomer.update({ where: { id: customer }, data: { status: 'trial', max_users: 2 } });
    expect((await credits.createSlot(customer, { email: 'third@acme.example' })).error).toBe('over_trial_users');
  });
});

describe('entitlements', () => {
  test('the dependency rule: a module whose prerequisite ran out is paused too', () => {
    const deps = [{ module_code: 'PAYR', needs_code: 'EMPM', requirement_group: 1 }, { module_code: 'PAYR', needs_code: 'ATLV', requirement_group: 2 }, { module_code: 'INAS', needs_code: 'CLHR', requirement_group: 1 }, { module_code: 'INAS', needs_code: 'INHR', requirement_group: 1 }];
    expect([...entitlements.effectiveModules(['PAYR', 'EMPM', 'ATLV'], deps)].sort()).toEqual(['ATLV', 'EMPM', 'PAYR']);
    expect([...entitlements.effectiveModules(['PAYR', 'EMPM'], deps)]).toEqual(['EMPM']); // ATLV ran out
    expect([...entitlements.effectiveModules(['INAS', 'INHR'], deps)].sort()).toEqual(['INAS', 'INHR']); // any-of
    expect([...entitlements.effectiveModules(['INAS'], deps)]).toEqual([]);
  });

  test('our own companies are never subject to it; a customer is, and only when enforcement is on', async () => {
    const r = await provisioned();
    const admin = await prisma.user.findFirst({ where: { email: r.admin_email } });
    const ours = await member('admin');
    expect((await entitlements.entitlementsFor(ours.user, org.id)).applies).toBe(false);
    const trial = await entitlements.entitlementsFor(admin, r.org_id);
    expect(trial).toMatchObject({ applies: true, status: 'trial' });
    expect(trial.modules).toContain('PAYR'); // a trial has every module

    await prisma.saasCustomer.update({ where: { id: r.customer_id }, data: { status: 'active' } });
    const slot = await prisma.saasSlot.findFirst({ where: { customer_id: r.customer_id } });
    await credits.addCredit({ slotId: slot.id, code: 'EMPM', days: 5 });
    const active = await entitlements.entitlementsFor(admin, r.org_id);
    expect(active.modules).toEqual([]); // EMPM needs BASC, which has no days
    await credits.addCredit({ slotId: slot.id, code: 'BASC', days: 5 });
    expect((await entitlements.entitlementsFor(admin, r.org_id)).modules.sort()).toEqual(['BASC', 'EMPM']);

    // the guard: a no-op unless SAAS_ENFORCE_ENTITLEMENTS=true
    const run = async (user, orgId, code) => {
      const guard = entitlements.requireModuleCode(code);
      let outcome = 'next';
      await guard({ user: { ...user, org_id: orgId } }, { status: () => ({ json: () => { outcome = 'blocked'; } }) }, () => { outcome = 'next'; });
      return outcome;
    };
    expect(await run(admin, r.org_id, 'PAYR')).toBe('next'); // enforcement off: everything passes
    process.env.SAAS_ENFORCE_ENTITLEMENTS = 'true';
    expect(await run(admin, r.org_id, 'PAYR')).toBe('blocked');
    expect(await run(admin, r.org_id, 'EMPM')).toBe('next');
    expect(await run(ours.user, org.id, 'PAYR')).toBe('next'); // our own company: never enforced
  });
});
