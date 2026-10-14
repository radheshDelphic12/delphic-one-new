const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const groupInsights = require('../src/modules/superDashboard/groupInsights.service');

let token;
let plainToken;
const orgs = {};

beforeEach(async () => {
  await cleanDatabase();
  groupInsights.clearCache();
  orgs.delphic = await createOrg({ name: 'Delphic Global' });
  const gid = orgs.delphic.org_group_id;
  for (const [key, name] of [['gulati', 'Gulati Industries'], ['zephyr', 'Zephyr Infra'], ['acconcy', 'Acconcy Finance']]) {
    orgs[key] = await createOrg({ name, org_group_id: gid });
    await prisma.org.update({ where: { id: orgs[key].id }, data: { enabled_modules: [key] } });
  }
  const su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: gid } });
  await createOrgMembership(su.id, orgs.delphic.id, { role: 'admin' });
  ({ access_token: token } = await loginAs(su));
  const plain = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(plain.id, orgs.delphic.id, { role: 'admin' });
  ({ access_token: plainToken } = await loginAs(plain));
});
afterAll(async () => { await prisma.$disconnect(); });

const overview = (t = token) => authed(request(app).get('/api/v1/super-dashboard/group/overview?from=2026-01&to=2026-03'), t);

describe('group company insights', () => {
  test('Delphic Global, Gulati Industries, Zephyr and Acconcy each get an insight in one shape; superadmin only', async () => {
    expect((await overview(plainToken)).status).toBe(403);
    const res = await overview();
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.companies.map((c) => [c.org.name, c.insight]));
    for (const [name, kind] of [['Delphic Global', 'delphic'], ['Gulati Industries', 'gulati'], ['Zephyr Infra', 'zephyr'], ['Acconcy Finance', 'acconcy']]) {
      const i = byName[name];
      expect(i).toBeTruthy();
      expect(i.error).toBeUndefined();
      expect(i).toMatchObject({ kind, org_name: name });
      expect(i.kpis.length).toBeGreaterThanOrEqual(5);
      expect(i.kpis.every((k) => k.label && 'value' in k && ['count', 'money', 'pct'].includes(k.format))).toBe(true);
    }
  });

  test('Delphic insight counts open requirements, active clients and stuck requirements', async () => {
    const owner = await createUser({ role: 'sales', withOrg: false });
    const client = await prisma.account.create({ data: { type: 'client', name: 'Acme', stage: 'active', org_id: orgs.delphic.id, owner_id: owner.id } });
    await prisma.requirement.create({ data: { title: 'Java dev', account_id: client.id, org_id: orgs.delphic.id, status: 'open', req_type: 'recruitment', sales_owner_id: owner.id } });
    const res = await overview();
    const i = res.body.data.companies.find((c) => c.org.name === 'Delphic Global').insight;
    expect(i.kpis.find((k) => k.label === 'Open requirements').value).toBe(1);
    expect(i.kpis.find((k) => k.label === 'Active clients').value).toBe(1);
    expect(i.top.rows[0]).toMatchObject({ name: 'Acme', open: 1 });
  });
});
