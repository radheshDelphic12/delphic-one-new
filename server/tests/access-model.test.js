// Roles & permissions restructure: Super Admin / Admin as account-level flags, everyone else = default basic access + permission set
// + own grants. One central route table decides every API call for a company on the permission model; a company that has not
// moved is untouched.
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed, unique } = require('./helpers');
const { needFor, matchRule } = require('../src/lib/access/routeRules');
const guard = require('../src/lib/access/guard');
const { effectivePermissions, deriveLegacyRole, legacyPermissions, levelOf } = require('../src/lib/access/effective');
const { materializeSet, currentAccess, diffPermissions } = require('../src/lib/access/legacyMap');
const { ALL_KEYS, CATALOG } = require('../src/lib/permissions');

let org; let admin; let adminToken; let superAdmin; let superToken;

async function person(name, { role = 'employee', set = null, extra = {} } = {}) {
  const user = await createUser({ role, name, withOrg: false });
  const m = await createOrgMembership(user.id, org.id, { role, ...extra });
  if (set) await prisma.orgMembership.update({ where: { id: m.id }, data: { custom_role_id: set.id } });
  return { user, m, token: (await loginAs(user)).access_token };
}
const get = (p, t) => authed(request(app).get(`/api/v1${p}`), t);
const put = (p, t, b) => authed(request(app).put(`/api/v1${p}`), t).send(b || {});
const post = (p, t, b) => authed(request(app).post(`/api/v1${p}`), t).send(b || {});
const patch = (p, t, b) => authed(request(app).patch(`/api/v1${p}`), t).send(b || {});
const mkSet = (name, permissions, base_role = 'employee') => prisma.customRole.create({ data: { org_id: org.id, name, permissions, base_role } });

beforeEach(async () => {
  await cleanDatabase();
  org = await createOrg({ name: 'Delphic Global', slug: unique('dg-'), is_master_workspace: true });
  admin = await createUser({ role: 'admin', name: 'Paras Gulati', withOrg: false });
  await prisma.user.update({ where: { id: admin.id }, data: { is_superadmin: true } });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  superAdmin = await createUser({ role: 'admin', name: 'Paras Gulati', withOrg: false });
  await prisma.user.update({ where: { id: superAdmin.id }, data: { is_superadmin: true, is_group_superadmin: true } });
  await createOrgMembership(superAdmin.id, org.id, { role: 'admin' });
  await prisma.org.update({ where: { id: org.id }, data: { access_mode: 'permissions' } });
  adminToken = (await loginAs(admin)).access_token;
  superToken = (await loginAs(superAdmin)).access_token;
});
afterAll(async () => { await prisma.$disconnect(); });

describe('levels and effective permissions', () => {
  test('Super Admin and Admin are account-level flags; everyone else is an employee, whatever the Role field says', () => {
    expect(levelOf({ is_group_superadmin: true }, 'employee')).toBe('super_admin');
    expect(levelOf({ is_superadmin: true }, 'admin')).toBe('admin');
    expect(levelOf({ is_superadmin: true }, 'sales')).toBe('employee');
    expect(levelOf({ is_superadmin: false }, 'admin')).toBe('employee');
  });

  test('an employee gets the default basic access, plus the set, plus grants, minus removals; Admin and Super Admin get everything', () => {
    const base = effectivePermissions({ level: 'employee' });
    expect(base.permissions).toEqual({});
    expect(base.basic).toEqual(expect.arrayContaining(['basic.home', 'basic.payslips', 'basic.timesheet']));
    const eff = effectivePermissions({
      level: 'employee', setPermissions: { 'people.view': 'team', 'accounts.view': true },
      grants: [{ key: 'people.view', scope: 'all', effect: 'grant' }, { key: 'accounts.view', scope: 'true', effect: 'deny' }, { key: 'basic.offices', scope: 'true', effect: 'deny' }],
    });
    expect(eff.permissions).toEqual({ 'people.view': 'all' }); // the wider scope wins; a removal takes a set item away
    expect(eff.basic).not.toContain('basic.offices');
    const all = effectivePermissions({ level: 'admin' });
    expect(Object.keys(all.permissions).sort()).toEqual([...ALL_KEYS].sort());
  });

  test('the plain role the older gates read is derived from the permissions, never chosen', () => {
    expect(deriveLegacyRole({ level: 'employee', permissions: {} })).toBe('employee');
    expect(deriveLegacyRole({ level: 'employee', permissions: { 'requirements.create': true } })).toBe('sales');
    expect(deriveLegacyRole({ level: 'employee', permissions: { 'profiles.create': true } })).toBe('recruiter');
    expect(deriveLegacyRole({ level: 'employee', permissions: { 'accounts.create': true } })).toBe('bda');
    expect(deriveLegacyRole({ level: 'employee', permissions: { 'payroll.view': true } })).toBe('admin');
    expect(deriveLegacyRole({ level: 'employee', permissions: { 'profiles.create': true, 'requirements.create': true } })).toBe('admin');
    expect(deriveLegacyRole({ level: 'super_admin', permissions: {} })).toBe('admin');
    // the older gates still ask for financials.* - they are derived from the finance modules and never shown in the editor
    const legacy = legacyPermissions({ 'payroll.view': true, 'billing.update': true });
    expect(legacy['financials.view']).toBe(true);
    expect(legacy['financials.update']).toBe(true);
    expect(legacyPermissions({ 'attendance.view': 'team' })['attendance.approve']).toBe(true);
  });

  test('the catalogue has the six categories and the Administration modules are marked admin-default', () => {
    expect(new Set(CATALOG.map((m) => m.category))).toEqual(new Set(['recruitment', 'people', 'time', 'finance', 'reports', 'administration']));
    expect(CATALOG.filter((m) => m.category === 'administration').every((m) => m.adminDefault)).toBe(true);
  });
});

describe('the route table', () => {
  test('every API route has an explicit rule (a route added later is closed to employees until it gets one)', () => {
    const out = [];
    function mount(l) {
      const src = l.regexp.source;
      if (src === '^\\/?(?=\\/|$)') return '';
      return src.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\\\//g, '/').replace(/\(\?:\(\[\^\/\]\+\?\)\)/g, ':p');
    }
    (function walk(stack, prefix) {
      for (const l of stack) {
        if (l.route) for (const m of Object.keys(l.route.methods)) out.push([m.toUpperCase(), `${prefix}${l.route.path}`]);
        else if (l.name === 'router' && l.handle.stack) walk(l.handle.stack, prefix + mount(l));
      }
    }(app._router.stack, ''));
    expect(out.length).toBeGreaterThan(500);
    const unmatched = out
      .filter(([, p]) => p.startsWith('/api/v1/'))
      .map(([m, p]) => [m, p.slice('/api/v1'.length).replace(/:[A-Za-z_]+/g, 'x').replace(/\/\/+/g, '/').replace(/\/$/, '') || '/'])
      .filter(([m, p]) => !matchRule(m, p))
      .map(([m, p]) => `${m} ${p}`);
    expect(unmatched).toEqual([]);
  });

  test('sensitive areas need their own permission, and a basic employee reaches none of them', () => {
    expect(needFor('GET', '/payroll/runs')).toBe('payroll.view');
    expect(needFor('GET', '/payroll/payslips/me')).toBe('basic.payslips');
    expect(needFor('GET', '/analytics/billing')).toBe('analytics.view');
    expect(needFor('GET', '/financials/monthly')).toBe('financials.view');
    expect(needFor('GET', '/expenses/claims')).toBe('finance.view');
    expect(needFor('POST', '/expenses/claims')).toBe('basic.expenses');
    expect(needFor('GET', '/reports/aging')).toBe('reports.view');
    expect(needFor('GET', '/something/new')).toBe('admin');
    const basic = { mode: 'permissions', level: 'employee', permissions: {}, basic: ['basic.home', 'basic.payslips'] };
    expect(guard.satisfies(basic, needFor('GET', '/payroll/runs'))).toBe(false);
    expect(guard.satisfies(basic, needFor('GET', '/payroll/payslips/me'))).toBe(true);
    expect(guard.satisfies({ ...basic, level: 'admin' }, needFor('GET', '/payroll/runs'))).toBe(true);
  });

  test('holding People does not make someone an admin in Payroll: the role the services see follows the module', () => {
    const hr = { role: 'admin', access: { mode: 'permissions', level: 'employee', permissions: { 'people.view': 'all', 'people.update': 'all', 'attendance.view': 'team' }, basic: [] } };
    expect(guard.roleForRequest(hr, ['people'])).toBe('admin');
    expect(guard.roleForRequest(hr, ['payroll'])).toBe('employee');
    expect(guard.roleForRequest(hr, ['attendance'])).toBe('employee'); // team scope only: treated as a manager, not an admin
    expect(guard.check(hr, 'GET', '/api/v1/payroll/payslips/abc')).toMatchObject({ ok: true, role: 'employee' });
    expect(guard.check({ role: 'admin' }, 'GET', '/api/v1/payroll/runs')).toEqual({ ok: true, role: 'admin' }); // a company not on permissions
  });
});

describe('enforcement on the API', () => {
  test('a basic employee: own things and the shared basics work, finance / reports / HR do not (the API says so, not only the menu)', async () => {
    const e = await person('Basic Joiner');
    const me = (await get('/users/me', e.token)).body.data;
    expect(me.access).toMatchObject({ mode: 'permissions', level: 'employee' });
    for (const p of ['/policies', '/orgs/memberships', '/orgs/locations', '/leave/types', '/attendance/me', '/payroll/payslips/me', '/timesheets/entries/me', '/dashboard/summary']) {
      const r = await get(p, e.token);
      expect([p, r.status < 400]).toEqual([p, true]);
    }
    for (const p of ['/payroll/runs', '/payroll/salary-structures', '/analytics/billing', '/financials/monthly', '/expenses/claims', '/reports/aging', '/reports/hr', '/billing/invoices', '/accounting/ledger-accounts', '/users', '/allocations/settings', '/attendance', '/change-log/entity', '/roles', '/access/people']) {
      const r = await get(p, e.token);
      expect([p, r.status]).toEqual([p, 403]);
    }
  });

  test('the people directory gives a basic employee the directory fields only; sensitive fields are removed from the response', async () => {
    const e = await person('Basic Joiner');
    const other = await person('Someone Else');
    await prisma.orgMembership.update({ where: { id: other.m.id }, data: { vendor_rate: 1234, vendor_rate_currency: 'INR' } });
    const list = (await get('/orgs/memberships', e.token)).body.data;
    const row = list.find((r) => r.id === other.m.id);
    expect(row.person.name).toBe('Someone Else');
    expect(row).not.toHaveProperty('vendor_rate');
    expect(row).not.toHaveProperty('role');
    expect(row.person).not.toHaveProperty('phone');
    const own = list.find((r) => r.id === e.m.id);
    expect(own).toHaveProperty('role'); // their own record is whole
    const adminList = (await get('/orgs/memberships', adminToken)).body.data;
    expect(adminList.find((r) => r.id === other.m.id)).toHaveProperty('vendor_rate');
    expect((await get(`/orgs/memberships/${other.m.id}/details`, e.token)).status).toBe(403);
  });

  test('a set gives access to its modules and nothing else: HR work without Finance, Payroll admin, Analytics or Financials', async () => {
    const hrLead = await mkSet('HR Lead', { 'people.view': 'all', 'people.update': 'all', 'leave.view': 'all', 'pipeline.view': true }, 'admin');
    const hr = await person('Diksha', { set: hrLead });
    const target = await person('Colleague');
    expect((await get(`/orgs/memberships/${target.m.id}/details`, hr.token)).status).toBe(200);
    expect((await get('/leave/balances/overview', hr.token)).status).toBe(200);
    for (const p of ['/payroll/runs', '/payroll/salary-structures', '/analytics/billing', '/financials/monthly', '/expenses/claims', '/billing/invoices', '/calculations/state', '/reports/aging']) {
      expect([p, (await get(p, hr.token)).status]).toEqual([p, 403]);
    }
  });

  test('the Admin and the Super Admin pass every route; the Leave Manager flag still opens leave approvals; /access/me tells the app what they hold', async () => {
    for (const t of [adminToken, superToken]) {
      expect((await get('/payroll/runs', t)).status).toBe(200);
      expect((await get('/access/people', t)).status).toBe(200);
      expect((await get('/expenses/claims', t)).status).toBe(200);
    }
    const lm = await person('Leave Manager');
    await prisma.orgMembership.update({ where: { id: lm.m.id }, data: { is_leave_manager: true } });
    const plain = await person('Plain');
    expect((await get('/leave/requests', lm.token)).status).toBe(200);
    expect((await get('/leave/requests', plain.token)).status).toBe(403);
    const mine = (await get('/access/me', plain.token)).body.data;
    expect(mine).toMatchObject({ mode: 'permissions', level: 'employee', permissions: {} });
    expect(mine.basic).toContain('basic.expenses');
    expect((await get('/access/me', superToken)).body.data.level).toBe('super_admin');
    expect((await get('/access/catalog', plain.token)).body.data.categories).toHaveLength(6);
  });

  test('a person with a company that has not moved is untouched', async () => {
    const legacyOrg = await createOrg({ name: 'Old Co', slug: unique('old-'), is_master_workspace: true });
    const user = await createUser({ role: 'recruiter', name: 'Old Recruiter', withOrg: false });
    await createOrgMembership(user.id, legacyOrg.id, { role: 'recruiter' });
    const t = (await loginAs(user)).access_token;
    expect((await get('/reports/recruiter-performance', t)).status).not.toBe(403); // allowed (the query is not valid: 422)
    expect((await get('/users/me', t)).body.data.access).toMatchObject({ mode: 'legacy', level: 'employee' });
    // the same role in the company that moved, with no set: no reports
    const moved = await person('Moved Recruiter', { role: 'recruiter' });
    expect((await get('/reports/recruiter-performance', moved.token)).status).toBe(403);
  });

  test('the role field is read-only in a company on permissions: a new joiner is an employee, Admin / Super values cannot be set', async () => {
    const created = await post('/users', adminToken, { name: 'New Joiner', email: `${unique('nj')}@test.local`, password: 'Password123!', role: 'admin' });
    expect(created.status).toBe(201);
    expect(created.body.data.role).toBe('employee');
    const e = await person('Target');
    expect((await patch(`/users/${e.user.id}`, adminToken, { role: 'admin' })).status).toBe(409);
    expect((await patch(`/users/${e.user.id}`, adminToken, { is_superadmin: true })).status).toBe(409);
    expect((await patch(`/users/${e.user.id}`, adminToken, { phone: '9999999999' })).status).toBe(200);
  });

  test('nobody but the Super Admin can change the Super Admin', async () => {
    const m = await prisma.orgMembership.findFirst({ where: { person_id: superAdmin.id, org_id: org.id } });
    expect((await patch(`/orgs/memberships/${m.id}`, adminToken, { work_mode: 'remote' })).status).toBe(403);
    expect((await patch(`/users/${superAdmin.id}`, adminToken, { active: false })).status).toBe(403);
    expect((await patch(`/orgs/memberships/${m.id}`, superToken, { work_mode: 'remote' })).status).toBe(200);
  });
});

describe('granting permissions (Settings > Permissions)', () => {
  test('the Admin grants, previews and removes; the effect is immediate for an open session; every change is in the change log', async () => {
    const e = await person('Joiner');
    expect((await get('/payroll/runs', e.token)).status).toBe(403);

    const previewRes = await post(`/access/people/${e.m.id}/preview`, adminToken, { grants: { 'payroll.view': true, 'people.view': 'team' } });
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.data.diff.granted.map((g) => g.key).sort()).toEqual(['payroll.view', 'people.view']);
    expect(previewRes.body.data.saved).toBe(false);
    expect(await prisma.permissionGrant.count()).toBe(0); // a preview writes nothing

    const saved = await put(`/access/people/${e.m.id}`, adminToken, { grants: { 'payroll.view': true, 'people.view': 'team' } });
    expect(saved.status).toBe(200);
    expect(saved.body.data.saved).toBe(true);
    expect((await get('/payroll/runs', e.token)).status).toBe(200); // same token, next request
    expect((await get('/expenses/claims', e.token)).status).toBe(403); // payroll is not finance

    const logs = await prisma.changeLog.findMany({ where: { entity_type: 'permission_grant' } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.every((l) => l.actor_id === admin.id && l.created_at)).toBe(true);
    expect(logs.map((l) => l.entity_label).join(' ')).toMatch(/Joiner/);

    const detail = (await get(`/access/people/${e.m.id}`, adminToken)).body.data;
    expect(detail.grants).toEqual(expect.arrayContaining([{ key: 'payroll.view', value: true }, { key: 'people.view', value: 'team' }]));
    expect((await put(`/access/people/${e.m.id}`, adminToken, { grants: {} })).status).toBe(200);
    expect((await get('/payroll/runs', e.token)).status).toBe(403);
    expect(await prisma.permissionGrant.count()).toBe(0);
  });

  test('Email > Send alone opens the vendor email screens, and removing it closes them', async () => {
    const e = await person('Mailer');
    expect((await get('/vendor-email/log', e.token)).status).toBe(403);
    expect((await put(`/access/people/${e.m.id}`, adminToken, { grants: { 'email.send': true } })).status).toBe(200);
    expect((await get('/vendor-email/log', e.token)).status).toBe(200);
    expect((await put(`/access/people/${e.m.id}`, adminToken, { grants: {} })).status).toBe(200);
    expect((await get('/vendor-email/log', e.token)).status).toBe(403);
  });

  test('a default basic item can be taken from one person, and given back', async () => {
    const e = await person('Joiner');
    const other = await person('Other');
    expect((await get('/orgs/locations', e.token)).status).toBe(200);
    expect((await put(`/access/people/${e.m.id}`, adminToken, { removed: ['basic.offices'] })).status).toBe(200);
    expect((await get('/orgs/locations', e.token)).status).toBe(403);
    expect((await get('/orgs/locations', other.token)).status).toBe(200); // only that person
    expect((await get('/users/me', e.token)).body.data.access.basic).not.toContain('basic.offices');
    expect((await put(`/access/people/${e.m.id}`, adminToken, { removed: [] })).status).toBe(200);
    expect((await get('/orgs/locations', e.token)).status).toBe(200);
  });

  test('a permission set can be assigned to a person; the plain role is derived and never asked for', async () => {
    const made = await post('/roles', adminToken, { name: 'Sales Team', permissions: { 'requirements.view': true, 'requirements.create': true, 'pipeline.view': true } });
    expect(made.status).toBe(201);
    expect(made.body.data.base_role).toBe('sales'); // derived from the ticks
    const e = await person('Seller');
    expect((await put(`/access/people/${e.m.id}`, adminToken, { set_id: made.body.data.id })).status).toBe(200);
    expect((await get('/pipeline/board', e.token)).status).toBe(200);
    expect((await get('/reports/aging', e.token)).status).toBe(403);
  });

  test('only the Super Admin and the Admin can grant; employees never can, even holding a permission themselves', async () => {
    const everything = Object.fromEntries(ALL_KEYS.map((k) => [k, true]));
    const boss = await mkSet('Everything', everything, 'admin');
    const holder = await person('Holds Everything', { set: boss });
    const target = await person('Target');
    expect((await get('/access/people', holder.token)).status).toBe(403);
    expect((await put(`/access/people/${target.m.id}`, holder.token, { grants: { 'payroll.view': true } })).status).toBe(403);
    expect((await post('/roles', holder.token, { name: 'Sneaky', permissions: {} })).status).toBe(403);
    expect((await put(`/access/people/${target.m.id}`, superToken, { grants: { 'payroll.view': true } })).status).toBe(200);
  });

  test('the Super Admin and the Admin cannot be edited here, and bad keys or scopes are ignored', async () => {
    const adminM = await prisma.orgMembership.findFirst({ where: { person_id: admin.id, org_id: org.id } });
    const superM = await prisma.orgMembership.findFirst({ where: { person_id: superAdmin.id, org_id: org.id } });
    expect((await put(`/access/people/${adminM.id}`, adminToken, { grants: { 'payroll.view': true } })).status).toBe(422);
    expect((await put(`/access/people/${superM.id}`, adminToken, { grants: { 'payroll.view': true } })).status).toBe(422);
    const e = await person('Joiner');
    const res = await put(`/access/people/${e.m.id}`, adminToken, { grants: { 'made.up': true, 'people.view': 'galaxy', 'accounts.update': 'own' }, removed: ['not.a.key'] });
    expect(res.status).toBe(200);
    const detail = (await get(`/access/people/${e.m.id}`, adminToken)).body.data;
    expect(detail.grants).toEqual([{ key: 'accounts.update', value: 'own' }]);
  });

  test('before a company moves, the editor refuses (nothing would take effect)', async () => {
    await prisma.org.update({ where: { id: org.id }, data: { access_mode: 'legacy' } });
    const e = await person('Joiner');
    const t = (await loginAs(admin)).access_token;
    expect((await put(`/access/people/${e.m.id}`, t, { grants: { 'payroll.view': true } })).status).toBe(409);
  });
});

describe('moving a company: backup, preview, approval, apply, restore, clean-up', () => {
  beforeEach(async () => {
    await prisma.org.update({ where: { id: org.id }, data: { access_mode: 'legacy' } });
    superToken = (await loginAs(superAdmin)).access_token;
  });

  async function legacyPeople() {
    const bda = await person('Bda Person', { role: 'bda' });
    const sales = await person('Sales Person', { role: 'sales' });
    const it = await person('IT Person');
    const plainAdmin = await person('Plain Admin', { role: 'admin' });
    const diksha = await person('Diksha Yadav', { role: 'admin', extra: { employee_code: 'E0001' } });
    await prisma.user.update({ where: { id: diksha.user.id }, data: { is_superadmin: true } });
    const custom = await mkSet('Mixed', { 'accounts.view': true, 'financials.view': true }, 'sales');
    const mixed = await person('Mixed Person', { role: 'sales', set: custom });
    return { bda, sales, it, plainAdmin, diksha, mixed };
  }

  test('only the Super Admin can see the migration; the preview proposes per person, flags every drop, and writes nothing', async () => {
    const p = await legacyPeople();
    expect((await get('/access/migration/preview', adminToken)).status).toBe(403);
    expect((await get('/access/migration/preview', p.it.token)).status).toBe(403);
    const before = await prisma.orgMembership.findMany({ select: { id: true, role: true, custom_role_id: true } });
    const res = await get('/access/migration/preview', superToken);
    expect(res.status).toBe(200);
    const plan = res.body.data;
    expect(plan.org.access_mode).toBe('legacy');
    expect(plan.admin.status).toBe('match');
    expect(plan.admin.proposed.name).toBe('Paras Gulati');
    const byName = Object.fromEntries(plan.people.map((r) => [r.name, r]));
    expect(byName['Paras Gulati'] && plan.people.filter((r) => r.name === 'Paras Gulati')).toHaveLength(2);
    expect(plan.people.find((r) => r.proposed.level === 'super_admin')).toBeTruthy();
    expect(byName['Diksha Yadav'].proposed.set.name).toBe('HR Lead');
    expect(byName['Diksha Yadav'].flags).toEqual(expect.arrayContaining(['access_down', 'was_admin']));
    expect(byName['Diksha Yadav'].diff.lost).toEqual(expect.arrayContaining(['payroll.view', 'financials.view', 'analytics.view']));
    expect(byName['IT Person'].proposed.set).toBeNull();
    expect(byName['IT Person'].flags).toEqual([]);
    expect(byName['Bda Person'].proposed.set.name).toBe('Legacy BDA');
    expect(byName['Bda Person'].flags).toEqual([]); // the same access, no drop
    expect(byName['Mixed Person'].proposed.set.name).toBe('Mixed');
    expect(plan.summary.access_down).toBeGreaterThanOrEqual(1);
    expect(await prisma.orgMembership.findMany({ select: { id: true, role: true, custom_role_id: true } })).toEqual(before);
    expect((await prisma.org.findUnique({ where: { id: org.id } })).access_mode).toBe('legacy');
  });

  test('applying needs a fresh backup and the exact previewed plan; then the company is on permissions, the old roles are kept read-only, and restore puts everything back', async () => {
    const p = await legacyPeople();
    const plan = (await get('/access/migration/preview', superToken)).body.data;
    const adminId = plan.admin.proposed.org_membership_id;
    const body = { plan_hash: plan.plan_hash, admin_membership_id: adminId, assignments: [] };

    expect((await post('/access/migration/apply', superToken, body)).status).toBe(409); // no backup yet
    expect((await post('/access/migration/backup', superToken, { note: 'before' })).status).toBe(201);
    expect((await post('/access/migration/apply', superToken, { ...body, plan_hash: 'a'.repeat(64) })).status).toBe(409); // not the plan that was reviewed
    expect((await post('/access/migration/apply', adminToken, body)).status).toBe(403);

    const applied = await post('/access/migration/apply', superToken, body);
    expect(applied.status).toBe(200);
    expect((await prisma.org.findUnique({ where: { id: org.id } })).access_mode).toBe('permissions');

    // Diksha: no longer Admin, HR set, nothing in finance; the Admin is still the Admin
    const diksha = await prisma.orgMembership.findUnique({ where: { id: p.diksha.m.id }, include: { custom_role: true, person: true } });
    expect(diksha.custom_role.name).toBe('HR Lead');
    expect(diksha.person.is_superadmin).toBe(false);
    expect(diksha.legacy_role).toBe('admin');
    expect(diksha.legacy_was_superadmin).toBe(true);
    expect(diksha.legacy_locked_until.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
    const dToken = (await loginAs(p.diksha.user)).access_token;
    expect((await get(`/orgs/memberships/${p.it.m.id}/details`, dToken)).status).toBe(200);
    expect((await get('/payroll/runs', dToken)).status).toBe(403);
    expect((await get('/payroll/runs', adminToken)).status).toBe(200);
    // the IT person is on basic access only, and the BDA still has their screens
    const itToken = (await loginAs(p.it.user)).access_token;
    expect((await get('/payroll/runs', itToken)).status).toBe(403);
    expect((await get('/payroll/payslips/me', itToken)).status).toBe(200);
    const bdaToken = (await loginAs(p.bda.user)).access_token;
    expect((await get('/accounts', bdaToken)).status).toBe(200);
    expect((await get('/pipeline/board', bdaToken)).status).toBe(200);
    // the mixed custom role kept both its ticks: accounts and the whole finance family
    const mixedToken = (await loginAs(p.mixed.user)).access_token;
    expect((await get('/payroll/runs', mixedToken)).status).toBe(200);
    expect((await get('/accounts', mixedToken)).status).toBe(200);
    // the plain Admin value cannot be set again, and a second apply is refused
    expect((await post('/access/migration/apply', superToken, body)).status).toBe(409);
    expect((await get('/access/migration/cleanup', superToken)).body.data).toMatchObject({ applied: true, window_open: true, ready: false });
    expect((await post('/access/migration/cleanup', superToken)).status).toBe(409); // the 30 days are not over

    // restore: everything as the backup recorded it
    const restored = await post('/access/migration/restore', superToken);
    expect(restored.status).toBe(200);
    expect((await prisma.org.findUnique({ where: { id: org.id } })).access_mode).toBe('legacy');
    const d2 = await prisma.orgMembership.findUnique({ where: { id: p.diksha.m.id }, include: { person: true } });
    expect(d2.role).toBe('admin');
    expect(d2.person.is_superadmin).toBe(true);
    expect(d2.custom_role_id).toBeNull();
    expect(d2.legacy_locked_until).toBeNull();
    expect(await prisma.customRole.count({ where: { name: 'HR Lead' } })).toBe(0);
    expect((await prisma.customRole.findFirst({ where: { name: 'Mixed' } })).permissions).toEqual({ 'accounts.view': true, 'financials.view': true });
  });

  test('after the 30 days the clean-up ends the restore window and takes the Admin value off everyone who is not the Admin', async () => {
    const p = await legacyPeople();
    const plan = (await get('/access/migration/preview', superToken)).body.data;
    await post('/access/migration/backup', superToken, {});
    expect((await post('/access/migration/apply', superToken, { plan_hash: plan.plan_hash, admin_membership_id: plan.admin.proposed.org_membership_id, assignments: [{ org_membership_id: p.plainAdmin.m.id, set_name: null }] })).status).toBe(200);
    await prisma.orgMembership.updateMany({ where: { org_id: org.id }, data: { legacy_locked_until: new Date(Date.now() - 1000) } });
    expect((await get('/access/migration/cleanup', superToken)).body.data.ready).toBe(true);
    expect((await post('/access/migration/restore', superToken)).status).toBe(409); // window closed
    const done = await post('/access/migration/cleanup', superToken);
    expect(done.status).toBe(200);
    const plain = await prisma.orgMembership.findUnique({ where: { id: p.plainAdmin.m.id } });
    expect(plain.role).toBe('employee');
    expect(plain.legacy_role).toBeNull();
    const adminM = await prisma.orgMembership.findFirst({ where: { person_id: admin.id, org_id: org.id } });
    expect(adminM.role).toBe('admin');
  });

  test('the status lists every company with its Admin account, so a missing one is visible', async () => {
    await createOrg({ name: 'Zephyr', slug: unique('z-'), org_group_id: org.org_group_id });
    const rows = (await get('/access/migration/status', superToken)).body.data;
    const dg = rows.find((r) => r.name === 'Delphic Global');
    expect(dg).toMatchObject({ access_mode: 'legacy', admin_status: 'one' });
    expect(rows.find((r) => r.name === 'Zephyr')).toMatchObject({ admin_status: 'none' });
  });
});

describe('what the legacy map says each plain role could do', () => {
  test('a custom role keeps what its ticks decided and what its base role gave; a plain admin had everything but deleted records', () => {
    const mixed = materializeSet({ baseRole: 'sales', ticks: { 'accounts.view': true, 'financials.view': true } });
    expect(mixed['reports.view']).toBe(true); // from the base role
    expect(mixed['requirements.create']).toBeUndefined(); // gated: the ticks decided, and it has none
    expect(mixed['payroll.view']).toBe(true); // the old financials.view tick opened every finance screen
    expect(mixed['analytics.view']).toBe(true);
    const plainAdmin = currentAccess({ role: 'admin' });
    expect(plainAdmin['payroll.view']).toBe(true);
    expect(plainAdmin['deleted_records.view']).toBeUndefined();
    const diff = diffPermissions(plainAdmin, { 'people.view': 'team' });
    expect(diff.lost).toContain('payroll.view');
    expect(diff.narrowed).toContain('people.view');
  });
});
