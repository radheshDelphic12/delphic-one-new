// Reports > HR reports has its own permission (reports.hr). Holding Reports > View is not enough; a company admin still passes.
const fs = require('fs');
const path = require('path');
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed, unique } = require('./helpers');
const { ALL_KEYS } = require('../src/lib/permissions');

let org; let adminToken;
const RANGE = 'date_from=2026-10-01&date_to=2026-10-31';
const get = (p, t) => authed(request(app).get(`/api/v1${p}`), t);

async function person(name, permissions) {
  const user = await createUser({ role: 'employee', name, withOrg: false });
  const m = await createOrgMembership(user.id, org.id, { role: 'employee' });
  const set = await prisma.customRole.create({ data: { org_id: org.id, name: `${name} set`, permissions, base_role: 'employee' } });
  await prisma.orgMembership.update({ where: { id: m.id }, data: { custom_role_id: set.id } });
  return (await loginAs(user)).access_token;
}

beforeEach(async () => {
  await cleanDatabase();
  org = await createOrg({ name: 'Delphic Global', slug: unique('dg-'), is_master_workspace: true });
  const admin = await createUser({ role: 'admin', name: 'Paras Gulati', withOrg: false });
  await prisma.user.update({ where: { id: admin.id }, data: { is_superadmin: true } });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  await prisma.org.update({ where: { id: org.id }, data: { access_mode: 'permissions' } });
  adminToken = (await loginAs(admin)).access_token;
});
afterAll(async () => { await prisma.$disconnect(); });

describe('HR reports permission', () => {
  test('reports.hr is in the permission catalogue, so an admin can tick it for a person', () => {
    expect(ALL_KEYS).toContain('reports.hr');
  });

  test('Reports > View alone does not open the HR report, the report list, its export or its drill-down', async () => {
    const t = await person('Viewer', { 'reports.view': true, 'reports.export': true });
    expect((await get(`/reports/hr?${RANGE}`, t)).status).toBe(403);
    expect((await get(`/reports/export?report=hr&type=xlsx&${RANGE}`, t)).status).toBe(403);
    expect((await get(`/reports/drilldown?report=hr&table=sourcing&${RANGE}`, t)).status).toBe(403);
    // the other open reports stay open to them
    expect((await get(`/reports/joinings?${RANGE}`, t)).status).toBe(200);
  });

  test('with Reports > HR reports the person opens the HR report, exports it and drills into it', async () => {
    const t = await person('Garv Gulati', { 'reports.view': true, 'reports.export': true, 'reports.hr': true });
    expect((await get(`/reports/hr?${RANGE}`, t)).status).toBe(200);
    expect((await get(`/reports/export?report=hr&type=xlsx&${RANGE}`, t)).status).toBe(200);
    const drill = await get(`/reports/drilldown?report=hr&table=sourcing&${RANGE}`, t);
    expect(drill.status).not.toBe(403);
  });

  test('the migration gives Garv the HR permission (only him), can be run twice, and does nothing where he does not exist', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261026130000_grant_hr_reports_garv/migration.sql'), 'utf8');
    const run = () => prisma.$executeRawUnsafe(sql);
    await run(); // nobody called Garv yet: no rows, no error
    expect(await prisma.permissionGrant.count()).toBe(0);

    const garv = await createUser({ role: 'employee', name: 'Garv Gulati', withOrg: false });
    const gm = await createOrgMembership(garv.id, org.id, { role: 'employee' });
    const set = await prisma.customRole.create({ data: { org_id: org.id, name: 'Reports set', permissions: { 'reports.view': true, 'reports.export': true }, base_role: 'employee' } });
    await prisma.orgMembership.update({ where: { id: gm.id }, data: { custom_role_id: set.id } });
    const other = await person('Someone Else', { 'reports.view': true, 'reports.export': true });
    const token = (await loginAs(garv)).access_token;
    await prisma.user.update({ where: { id: garv.id }, data: { email: 'garv@delphic.in' } });
    expect((await get(`/reports/hr?${RANGE}`, token)).status).toBe(403); // before the migration

    await run();
    await run();
    const grants = await prisma.permissionGrant.findMany();
    expect(grants.map((g) => [g.org_membership_id, g.key, g.effect])).toEqual([[gm.id, 'reports.hr', 'grant']]);
    expect((await get(`/reports/hr?${RANGE}`, token)).status).toBe(200);
    expect((await get(`/reports/hr?${RANGE}`, other)).status).toBe(403);
  });

  test('the company admin still opens the HR report', async () => {
    expect((await get(`/reports/hr?${RANGE}`, adminToken)).status).toBe(200);
  });
});
