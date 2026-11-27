/** Cross-functional teams: made on the Group Dashboard (description, companies, members from several companies); an employee's teams set from their company. */
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

let group; let alpha; let beta; let superToken; let adminToken; let ann; let bob; let annAlpha;
beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE cross_functional_team_members, cross_functional_teams CASCADE');
  group = await prisma.orgGroup.create({ data: { name: 'Cross Group' } });
  alpha = await createOrg({ name: 'Alpha Co', slug: 'alpha-co', org_group_id: group.id });
  beta = await createOrg({ name: 'Beta Co', slug: 'beta-co', org_group_id: group.id });
  const sup = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: sup.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: sup.id, org_group_id: group.id } }).catch(() => null);
  await createOrgMembership(sup.id, alpha.id, { role: 'admin' });
  superToken = (await loginAs(sup)).access_token;
  adminToken = superToken;
  ann = await createUser({ role: 'employee', name: 'Ann Alpha', withOrg: false });
  annAlpha = await createOrgMembership(ann.id, alpha.id, { role: 'employee' });
  bob = await createUser({ role: 'employee', name: 'Bob Beta', withOrg: false });
  await createOrgMembership(bob.id, beta.id, { role: 'employee' });
});
afterAll(async () => { await prisma.$disconnect(); });

const g = (m, url) => authed(request(app)[m](`/api/v1/group-teams${url}`), superToken);

test('a team spanning two companies, members from both, edit and delete; members must be in the chosen companies', async () => {
  const created = await g('post', '').send({ name: 'Growth squad', description: 'Sales + tech', company_ids: [alpha.id, beta.id] });
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  const people = (await g('get', '/people')).body.data.map((p) => p.name);
  expect(people).toEqual(expect.arrayContaining(['Ann Alpha', 'Bob Beta']));
  const set = await g('put', `/${id}/members`).send({ members: [{ user_id: ann.id }, { user_id: bob.id }] });
  expect(set.status).toBe(200);
  expect(set.body.data.members.map((m) => [m.name, m.company])).toEqual([['Ann Alpha', 'Alpha Co'], ['Bob Beta', 'Beta Co']]);
  // a team only for Alpha cannot take Bob
  const alphaOnly = (await g('post', '').send({ name: 'Alpha ops', company_ids: [alpha.id] })).body.data;
  expect((await g('put', `/${alphaOnly.id}/members`).send({ members: [{ user_id: bob.id }] })).status).toBe(422);
  expect((await g('patch', `/${id}`).send({ description: 'Updated' })).body.data.description).toBe('Updated');
  const list = (await g('get', '')).body.data;
  expect(list.teams.map((t) => t.name)).toEqual(['Alpha ops', 'Growth squad']);
  expect(list.companies.map((c) => c.name)).toEqual(['Alpha Co', 'Beta Co']);
  expect((await g('delete', `/${alphaOnly.id}`)).status).toBe(200);
  expect((await g('get', '')).body.data.teams).toHaveLength(1);
});

test('from a company: the teams open to it, and an employee in several teams', async () => {
  const t1 = (await g('post', '').send({ name: 'Growth squad', company_ids: [alpha.id, beta.id] })).body.data;
  const t2 = (await g('post', '').send({ name: 'Everyone club', company_ids: [] })).body.data;
  await g('post', '').send({ name: 'Beta only', company_ids: [beta.id] });
  const c = (url) => authed(request(app).get(`/api/v1/cross-teams${url}`), adminToken);
  expect((await c('')).body.data.map((t) => t.name)).toEqual(['Everyone club', 'Growth squad']);
  const put = await authed(request(app).put(`/api/v1/cross-teams/people/${annAlpha.id}`), adminToken).send({ team_ids: [t1.id, t2.id] });
  expect(put.status).toBe(200);
  expect(put.body.data.teams.map((t) => t.name).sort()).toEqual(['Everyone club', 'Growth squad']);
  const betaOnly = (await g('get', '')).body.data.teams.find((t) => t.name === 'Beta only');
  expect((await authed(request(app).put(`/api/v1/cross-teams/people/${annAlpha.id}`), adminToken).send({ team_ids: [betaOnly.id] })).status).toBe(422);
  // a plain employee cannot use the group screen
  expect((await authed(request(app).get('/api/v1/group-teams'), (await loginAs(ann)).access_token)).status).toBe(403);
});
