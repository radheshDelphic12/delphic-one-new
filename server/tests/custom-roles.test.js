// Phase 7: custom roles. Permissions are enforced by the API (not only hidden in the UI); people without a custom role are untouched.
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed, unique } = require('./helpers');
const rolesService = require('../src/modules/roles/roles.service');

let org; let superToken; let superUser;

beforeEach(async () => {
  await cleanDatabase();
  org = await createOrg({ name: 'Delphic', slug: unique('d-'), is_master_workspace: true });
  superUser = await createUser({ role: 'admin', name: 'Super Boss', withOrg: false });
  await prisma.user.update({ where: { id: superUser.id }, data: { is_superadmin: true } });
  await createOrgMembership(superUser.id, org.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(superUser));
  await rolesService.installStarterRoles(org.id, superUser.id);
});
afterAll(async () => { await prisma.$disconnect(); });

async function personWith(roleName, name, plainRole = 'employee', extra = {}) {
  const user = await createUser({ role: plainRole, name, withOrg: false });
  const m = await createOrgMembership(user.id, org.id, { role: plainRole });
  if (extra.manager_id) await prisma.orgMembership.update({ where: { id: m.id }, data: { manager_id: extra.manager_id } });
  if (roleName) {
    const role = await prisma.customRole.findFirst({ where: { org_id: org.id, name: roleName } });
    await rolesService.assign(org.id, m.id, role.id);
  }
  return { user, m, token: (await loginAs(user)).access_token };
}
const post = (p, t, b) => authed(request(app).post(p), t).send(b || {});
const patch = (p, t, b) => authed(request(app).patch(p), t).send(b || {});
const mkAccount = (owner, data = {}) => prisma.account.create({ data: { type: 'client', name: unique('Acme '), stage: 'active', owner_id: owner.id, origin_owner_id: owner.id, org_id: org.id, ...data } });

describe('managing roles', () => {
  test('only a Super Admin manages roles; the catalogue and the ten starter roles exist; names are unique', async () => {
    const plain = await personWith(null, 'Plain', 'admin');
    expect((await authed(request(app).get('/api/v1/roles'), plain.token)).status).toBe(403);
    const list = (await authed(request(app).get('/api/v1/roles'), superToken)).body.data;
    expect(list.map((r) => r.name).sort()).toEqual(['Admin', 'BDE', 'HR', 'HR Admin', 'HR Super Admin', 'IT Employee', 'Sales', 'Sales Admin', 'Sales Super Admin', 'Super Admin']);
    expect((await authed(request(app).get('/api/v1/roles/catalog'), plain.token)).body.data.some((m) => m.module === 'financials')).toBe(true);
    expect((await post('/api/v1/roles', superToken, { name: 'bde', permissions: {} })).status).toBe(409);
    // installing again creates nothing and never overwrites an edit
    const bde = list.find((r) => r.name === 'BDE');
    await patch(`/api/v1/roles/${bde.id}`, superToken, { description: 'edited' });
    expect((await rolesService.installStarterRoles(org.id, superUser.id)).created).toEqual([]);
    expect((await prisma.customRole.findUnique({ where: { id: bde.id } })).description).toBe('edited');
  });

  test('a role is built by ticking permissions; unknown keys and bad scopes are dropped; a role in use cannot be deleted', async () => {
    const res = await post('/api/v1/roles', superToken, { name: 'Custom', base_role: 'sales', permissions: { 'accounts.update': 'team', 'accounts.create': true, 'made.up': true, 'financials.view': 'all' } });
    expect(res.status).toBe(201);
    expect(res.body.data.permissions).toEqual({ 'accounts.update': 'team', 'accounts.create': true, 'financials.view': true });
    const person = await personWith(null, 'Holder');
    expect((await post('/api/v1/roles/assign', superToken, { org_membership_id: person.m.id, role_id: res.body.data.id })).status).toBe(200);
    expect((await prisma.orgMembership.findUnique({ where: { id: person.m.id } })).role).toBe('sales'); // base role follows
    expect((await authed(request(app).delete(`/api/v1/roles/${res.body.data.id}`), superToken)).status).toBe(409);
    await post('/api/v1/roles/assign', superToken, { org_membership_id: person.m.id, role_id: null });
    expect((await authed(request(app).delete(`/api/v1/roles/${res.body.data.id}`), superToken)).status).toBe(200);
  });

  test('the mapping preview names who would get what and writes nothing; applying a confirmed mapping assigns', async () => {
    const dheeraj = await personWith(null, 'Dheeraj Kumar', 'bda');
    await personWith(null, 'Tanvi Shah', 'sales');
    await personWith(null, 'Paras Gulati', 'admin');
    await personWith(null, 'Paras Other', 'employee'); // makes "paras" ambiguous
    const preview = (await authed(request(app).get('/api/v1/roles/mapping-preview'), superToken)).body.data;
    const by = Object.fromEntries(preview.map((p) => [p.named, p]));
    expect(by.dheeraj).toMatchObject({ status: 'match', role: 'BDE', new_base_role: 'bda' });
    expect(by.dheeraj.candidates[0]).toMatchObject({ current_role: 'bda', base_role_changes: false });
    expect(by.tanvi.candidates[0].base_role_changes).toBe(false);
    expect(by.paras.status).toBe('ambiguous');
    expect(by.krupali.status).toBe('not_found');
    expect(await prisma.orgMembership.count({ where: { custom_role_id: { not: null } } })).toBe(0);
    const applied = (await post('/api/v1/roles/mapping-apply', superToken, { assignments: [{ org_membership_id: dheeraj.m.id, role_name: 'BDE' }] })).body.data;
    expect(applied[0].ok).toBe(true);
    expect((await prisma.orgMembership.findUnique({ where: { id: dheeraj.m.id }, include: { custom_role: true } })).custom_role.name).toBe('BDE');
  });
});

describe('enforced on the API', () => {
  test('BDE adds accounts and schedules meetings, but cannot edit or touch requirements and profiles', async () => {
    const bde = await personWith('BDE', 'Dheeraj', 'bda');
    expect((await post('/api/v1/accounts', bde.token, { name: 'New Co', type: 'client' })).status).toBe(201);
    const acct = await mkAccount(superUser);
    expect((await patch(`/api/v1/accounts/${acct.id}`, bde.token, { industry: 'X' })).status).toBe(403);
    expect((await post(`/api/v1/accounts/${acct.id}/meetings`, bde.token, { title: 'Intro', scheduled_at: new Date(Date.now() + 86400000).toISOString(), mode: 'online' })).status).not.toBe(403);
    expect((await post('/api/v1/requirements', bde.token, { account_id: acct.id, title: 'R', req_type: 'recruitment', seats_total: 1 })).status).toBe(403);
    expect((await post('/api/v1/profiles', bde.token, { name: 'P' })).status).toBe(403);
  });

  test('a plain BDA (no custom role) keeps editing any account, exactly as before', async () => {
    const plain = await personWith(null, 'Old Style', 'bda');
    const acct = await mkAccount(superUser);
    expect((await patch(`/api/v1/accounts/${acct.id}`, plain.token, { industry: 'Steel' })).status).toBe(200);
  });

  test('scopes: Sales Admin edits their team\'s accounts only; Sales Super Admin edits anyone\'s; a plain Sales role edits only its own', async () => {
    const admin = await personWith('Sales Admin', 'Tanvi', 'sales');
    const report = await personWith(null, 'Report', 'bda', { manager_id: admin.m.id });
    const stranger = await personWith(null, 'Stranger', 'bda');
    const teamAcct = await mkAccount(report.user);
    const otherAcct = await mkAccount(stranger.user);
    expect((await patch(`/api/v1/accounts/${teamAcct.id}`, admin.token, { industry: 'A' })).status).toBe(200);
    expect((await patch(`/api/v1/accounts/${otherAcct.id}`, admin.token, { industry: 'B' })).status).toBe(403);
    const boss = await personWith('Sales Super Admin', 'Biswajit', 'sales');
    expect((await patch(`/api/v1/accounts/${otherAcct.id}`, boss.token, { industry: 'C' })).status).toBe(200);
    const sales = await personWith('Sales', 'Chahak', 'sales');
    const mine = await mkAccount(sales.user);
    expect((await patch(`/api/v1/accounts/${mine.id}`, sales.token, { industry: 'D' })).status).toBe(403); // Sales has no account edit
  });

  test('requirements: Sales creates, edits only their own; only Sales Super Admin deletes anyone\'s', async () => {
    const owner = await personWith('Sales', 'Chahak', 'sales');
    const acct = await mkAccount(superUser);
    const created = await post('/api/v1/requirements', owner.token, { account_id: acct.id, title: 'Java Dev', req_type: 'recruitment', seats_total: 1 });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect((await patch(`/api/v1/requirements/${id}`, owner.token, { title: 'Java Developer' })).status).toBe(200);
    const other = await personWith('Sales', 'Other Sales', 'sales');
    expect((await patch(`/api/v1/requirements/${id}`, other.token, { title: 'Hijack' })).status).toBe(403);
    expect((await authed(request(app).delete(`/api/v1/requirements/${id}`), owner.token).send({ reason: 'x' })).status).toBe(403);
    const boss = await personWith('Sales Super Admin', 'Biswajit', 'sales');
    expect((await patch(`/api/v1/requirements/${id}`, boss.token, { title: 'By boss' })).status).toBe(200);
  });

  test('HR adds profiles, edits only their own; HR Admin edits their team\'s', async () => {
    const hr = await personWith('HR', 'Krupali', 'recruiter');
    const made = await post('/api/v1/profiles', hr.token, { name: unique('Cand '), total_experience_years: 3, primary_skills: ['Node.js'], source: 'direct' });
    expect(made.status).toBe(201);
    const id = made.body.data.id;
    expect((await patch(`/api/v1/profiles/${id}`, hr.token, { recruiter_notes: 'ok' })).status).toBe(200);
    const hr2 = await personWith('HR', 'Another HR', 'recruiter');
    expect((await patch(`/api/v1/profiles/${id}`, hr2.token, { recruiter_notes: 'no' })).status).toBe(403);
    const head = await personWith('HR Admin', 'Prashant', 'recruiter');
    await prisma.orgMembership.update({ where: { id: hr.m.id }, data: { manager_id: head.m.id } });
    expect((await patch(`/api/v1/profiles/${id}`, head.token, { recruiter_notes: 'team ok' })).status).toBe(200);
  });

  test('financials, allocations and timesheet checks follow the permissions; a plain admin is unchanged', async () => {
    const superAdmin = await personWith('Super Admin', 'Paras', 'admin');
    expect((await authed(request(app).get('/api/v1/financials/monthly'), superAdmin.token)).status).toBe(200);
    expect((await authed(request(app).get('/api/v1/allocations/settings'), superAdmin.token)).status).toBe(200);
    const admin = await personWith('Admin', 'Check Only', 'admin');
    expect((await authed(request(app).get('/api/v1/financials/monthly'), admin.token)).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/allocations/settings'), admin.token)).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/timesheets/entries'), admin.token)).status).toBe(200);
    expect((await authed(request(app).get('/api/v1/attendance'), admin.token)).status).toBe(200);
    const employee = await personWith('IT Employee', 'Abhishek', 'employee');
    expect((await authed(request(app).get('/api/v1/timesheets/entries'), employee.token)).status).toBe(403);
    // a plain admin keeps everything
    const plainAdmin = await personWith(null, 'Plain Admin', 'admin');
    expect((await authed(request(app).get('/api/v1/financials/monthly'), plainAdmin.token)).status).toBe(200);
    expect((await authed(request(app).get('/api/v1/allocations/settings'), plainAdmin.token)).status).toBe(200);
  });

  test('"Receive increment reminders": only holders of that permission (and Super Admin users) see and get them', async () => {
    const holder = await personWith('Super Admin', 'Paras', 'admin');
    const admin = await personWith('Admin', 'Check Only', 'admin');
    expect((await authed(request(app).get('/api/v1/payroll/increment-reminders'), holder.token)).status).toBe(200);
    expect((await authed(request(app).get('/api/v1/payroll/increment-reminders'), admin.token)).status).toBe(403);
  });

  test('/users/me carries the permissions and role name for the app; delete follows the delete permission', async () => {
    const boss = await personWith('Sales Super Admin', 'Biswajit', 'sales');
    const me = (await authed(request(app).get('/api/v1/users/me'), boss.token)).body.data;
    expect(me.custom_role.name).toBe('Sales Super Admin');
    expect(me.permissions['accounts.delete']).toBe('all');
    const acct = await mkAccount(superUser);
    const del = await post(`/api/v1/admin/account/${acct.id}/delete`, boss.token, { password: 'wrong-password', reason: 'cleanup of test data' });
    expect(del.status).toBe(401); // allowed through the permission gate, stopped by the password check
    const sales = await personWith('Sales', 'Chahak', 'sales');
    expect((await post(`/api/v1/admin/account/${acct.id}/delete`, sales.token, { password: 'x', reason: 'cleanup of test data' })).status).toBe(403);
  });
});
