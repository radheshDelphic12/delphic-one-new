const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

// SaaS launch, phase 1: every group says what it is (owner / customer / trial / demo); existing groups stay 'owner'.
let token; let ours; let theirs;

beforeEach(async () => {
  await cleanDatabase();
  ours = await createOrg({ name: 'Our Company' });
  const customerGroup = await prisma.orgGroup.create({ data: { name: 'A Customer', kind: 'customer' } });
  theirs = await createOrg({ name: 'Customer Company', org_group_id: customerGroup.id });
  const su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: ours.org_group_id } });
  await createOrgMembership(su.id, ours.id, { role: 'admin' });
  ({ access_token: token } = await loginAs(su));
});
afterAll(async () => { await prisma.$disconnect(); });

describe('group kind', () => {
  test('a group created the old way is an owner group', async () => {
    const g = await prisma.orgGroup.findUnique({ where: { id: ours.org_group_id } });
    expect(g.kind).toBe('owner');
  });

  test('only owner, customer, trial and demo are accepted by the database', async () => {
    for (const kind of ['owner', 'customer', 'trial', 'demo']) {
      await expect(prisma.orgGroup.create({ data: { name: `k-${kind}`, kind } })).resolves.toBeTruthy();
    }
    await expect(prisma.orgGroup.create({ data: { name: 'bad', kind: 'partner' } })).rejects.toThrow();
  });

  test('the Group Dashboard tags each company with its group kind and never lists a customer group\'s company', async () => {
    const res = await authed(request(app).get('/api/v1/super-dashboard/group/overview?from=2026-01&to=2026-03'), token);
    expect(res.status).toBe(200);
    const names = res.body.data.companies.map((c) => c.org.name);
    expect(names).toContain('Our Company');
    expect(names).not.toContain('Customer Company');
    expect(res.body.data.companies.find((c) => c.org.name === 'Our Company').org.group_kind).toBe('owner');
    expect(theirs.org_group_id).not.toBe(ours.org_group_id);
  });
});
