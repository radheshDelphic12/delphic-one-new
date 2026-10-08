// Project Team project list: admin sees every project, others the projects they were allocated to in the month.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => { await cleanDatabase(); });
afterAll(async () => { await prisma.$disconnect(); });

test('admin lists every project; a member lists projects allocated in that month (ended ones included)', async () => {
  const org = await createOrg();
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const dev = await createUser({ role: 'recruiter', name: 'Asha' });
  const membership = await createOrgMembership(dev.id, org.id, { role: 'recruiter' });
  const devToken = (await loginAs(dev)).access_token;
  const mk = (name) => prisma.account.create({ data: { org_id: org.id, type: 'client', name, stage: 'active', is_project: true, owner_id: adminUser.id, origin_owner_id: adminUser.id } });
  const [a, b, c] = [await mk('Alpha'), await mk('Beta'), await mk('Gamma')];
  const assign = (acc, extra) => prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: acc.id, org_membership_id: membership.id, created_by: adminUser.id, ...extra } });
  await assign(a, { start_date: new Date('2026-09-01') }); // open-ended
  await assign(b, { start_date: new Date('2026-09-01'), end_date: new Date('2026-09-30') }); // ended in Sept
  const list = (token, month) => authed(request(app).get('/api/v1/timesheets/project-team/projects'), token).query({ year: 2026, month });

  expect((await list(adminToken, 9)).body.data.map((p) => p.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  expect((await list(devToken, 9)).body.data.map((p) => p.name)).toEqual(['Alpha', 'Beta']);
  expect((await list(devToken, 10)).body.data.map((p) => p.name)).toEqual(['Alpha']); // Beta ended 30 Sep
  expect(c.id).toBeTruthy();
});
