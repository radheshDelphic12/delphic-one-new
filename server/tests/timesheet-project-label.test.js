// Timesheets show a project by its project name. Older client rows were
// renamed into projects in Finance (name = the client, e.g. "Nlineaxis";
// project_name = "Objective Eye"); every timesheet screen must show the latter.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

test('entries, the IT log and pending approvals show the project name, not the account name', async () => {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(admin)).access_token;
  const dev = await createUser({ role: 'employee', name: 'Joshi Rushi' });
  const devMembership = await createOrgMembership(dev.id, org.id, { role: 'employee' });
  const devToken = (await loginAs(dev)).access_token;

  const legacy = await prisma.account.create({
    data: { org_id: org.id, name: 'Nlineaxis', project_name: 'Objective Eye', type: 'client', stage: 'active', owner_id: admin.id },
  });
  const plain = await prisma.account.create({ data: { org_id: org.id, name: 'Tankpros', type: 'client', stage: 'active', is_project: true, owner_id: admin.id } });
  for (const account of [legacy, plain]) {
    await prisma.timesheetEntry.create({
      data: { org_id: org.id, org_membership_id: devMembership.id, account_id: account.id, date: new Date('2026-09-29'), hours: 1, billable: true, status: 'submitted' },
    });
  }

  const team = await authed(request(app).get('/api/v1/timesheets/entries?from=2026-09-01&to=2026-09-30'), adminToken);
  expect(team.body.data.map((e) => e.account.name).sort()).toEqual(['Objective Eye', 'Tankpros']);
  expect(team.body.data[0].account).not.toHaveProperty('project_name');

  const mine = await authed(request(app).get('/api/v1/timesheets/entries/me'), devToken);
  expect(mine.body.data.map((e) => e.account.name).sort()).toEqual(['Objective Eye', 'Tankpros']);

  const log = await authed(request(app).get(`/api/v1/timesheets/my-log?month=9&year=2026&org_membership_id=${devMembership.id}`), adminToken);
  expect(log.status).toBe(200);
  expect(log.body.data.flatMap((d) => d.entries.map((e) => e.account.name)).sort()).toEqual(['Objective Eye', 'Tankpros']);

  const pending = await authed(request(app).get('/api/v1/timesheets/approvals/pending'), adminToken);
  expect(pending.body.data.entries.map((e) => e.account.name).sort()).toEqual(['Objective Eye', 'Tankpros']);

  const overview = await authed(request(app).get('/api/v1/timesheets/overview?month=9&year=2026'), adminToken);
  const joshi = overview.body.data.members.find((m) => m.name === 'Joshi Rushi');
  expect(joshi.allocation.map((a) => a.name).sort()).toEqual(['Objective Eye', 'Tankpros']);
});
