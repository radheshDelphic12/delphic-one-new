/**
 * People > Directory: who is working at a client site today (an approved / active deployment under Group Travel > Deployments, at the
 * client's office or hybrid, not remote; dates covering today).
 */
const { app, prisma, request, cleanDatabase, createUser, createOrgMembership, loginAs, authed } = require('./helpers');

let org;
let adminToken;
beforeEach(async () => {
  await cleanDatabase();
  const admin = await createUser({ role: 'admin', name: 'Admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  org = await prisma.org.findUnique({ where: { id: (await prisma.orgMembership.findFirst({ where: { person_id: admin.id } })).org_id } });
});
afterAll(async () => { await prisma.$disconnect(); });

const day = (offset) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + offset));

async function deploy(userIds, { status = 'active', arrangement = 'client_office', personArrangement = 'inherit', start = -5, end = 30, code } = {}) {
  const groupId = org.org_group_id || (await prisma.orgGroup.create({ data: { name: 'G' } })).id;
  const d = await prisma.groupDeployment.create({
    data: { org_group_id: groupId, org_id: org.id, code: code || `D-${Math.random().toString(36).slice(2, 7)}`, title: 'Onsite support', client_name: 'Acme Bank', client_location: 'Mumbai BKC', start_date: day(start), expected_end_date: day(end), working_arrangement: arrangement, status },
  });
  for (const id of userIds) await prisma.groupDeploymentPerson.create({ data: { deployment_id: d.id, user_id: id, name: 'P', arrangement: personArrangement } });
  return d;
}

test('the directory says who is at a client site today and where', async () => {
  const mk = async (name) => { const u = await createUser({ role: 'employee', name, withOrg: false }); await createOrgMembership(u.id, org.id, { role: 'employee' }); return u; };
  const onsite = await mk('Onsite Person');
  const remote = await mk('Remote Person');
  const draft = await mk('Draft Person');
  const ended = await mk('Ended Person');
  const office = await mk('Office Person');
  await deploy([onsite.id]);
  await deploy([remote.id], { personArrangement: 'remote' });
  await deploy([draft.id], { status: 'draft' });
  await deploy([ended.id], { start: -40, end: -2 });

  const rows = (await authed(request(app).get('/api/v1/orgs/memberships'), adminToken)).body.data;
  const by = Object.fromEntries(rows.map((r) => [r.person.name, r]));
  expect(by['Onsite Person'].client_site).toMatchObject({ client_name: 'Acme Bank', location: 'Mumbai BKC', arrangement: 'client_office' });
  expect(by['Remote Person'].client_site).toBeNull();
  expect(by['Draft Person'].client_site).toBeNull();
  expect(by['Ended Person'].client_site).toBeNull();
  expect(by['Office Person'].client_site).toBeNull();
});
