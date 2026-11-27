/** Reports > Missing contact details: clients / vendors whose POC has no phone or email (and extra contacts with gaps). */
const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

let org; let admin; let token;
beforeEach(async () => {
  await cleanDatabase();
  admin = await createUser({ role: 'admin' });
  ({ access_token: token } = await loginAs(admin));
  org = await prisma.org.findUnique({ where: { id: (await prisma.orgMembership.findFirst({ where: { person_id: admin.id } })).org_id } });
});
afterAll(async () => { await prisma.$disconnect(); });

test('lists accounts with a POC phone or email missing, most gaps first; complete ones and projects are left out', async () => {
  const mk = (data) => prisma.account.create({ data: { org_id: org.id, stage: 'active', owner_id: admin.id, origin_owner_id: admin.id, ...data } });
  await mk({ type: 'client', name: 'Complete Co', poc_name: 'A', poc_phone: '99', poc_email: 'a@x.test' });
  await mk({ type: 'client', name: 'No Phone Co', poc_name: 'B', poc_email: 'b@x.test' });
  await mk({ type: 'vendor', name: 'Nothing Vendor' });
  await mk({ type: 'client', name: 'Extra Gap Co', poc_name: 'C', poc_phone: '1', poc_email: 'c@x.test', additional_contacts: [{ name: 'Finance desk', phone: '2' }] });
  await mk({ type: 'client', name: 'A Project', is_project: true });
  const d = (await authed(request(app).get('/api/v1/reports/contact-gaps'), token)).body.data;
  const names = d.rows.map((r) => r.name);
  expect(names[0]).toBe('Nothing Vendor');
  expect(names).toEqual(expect.arrayContaining(['No Phone Co', 'Extra Gap Co']));
  expect(names).not.toContain('Complete Co');
  expect(names).not.toContain('A Project');
  expect(d.rows.find((r) => r.name === 'No Phone Co').missing).toEqual(['POC phone']);
  expect(d.rows.find((r) => r.name === 'Extra Gap Co').other_contacts_missing).toEqual([{ name: 'Finance desk', missing: ['email'] }]);
  expect(d.summary).toMatchObject({ clients_with_gaps: 2, vendors_with_gaps: 1, no_phone: 2, no_email: 1 });
  const vendors = (await authed(request(app).get('/api/v1/reports/contact-gaps'), token).query({ type: 'vendor' })).body.data;
  expect(vendors.rows.map((r) => r.name)).toEqual(['Nothing Vendor']);
});

test('rows carry the status and can be filtered by one or more statuses', async () => {
  const mk = (data) => prisma.account.create({ data: { org_id: org.id, owner_id: admin.id, origin_owner_id: admin.id, ...data } });
  await mk({ type: 'vendor', name: 'Active Vendor', stage: 'active' });
  await mk({ type: 'vendor', name: 'Lead Vendor', stage: 'lead' });
  await mk({ type: 'client', name: 'Dropped Client', stage: 'dropped' });
  const get = (q) => authed(request(app).get('/api/v1/reports/contact-gaps'), token).query(q).then((r) => r.body.data.rows);
  const all = await get({});
  expect(all.find((r) => r.name === 'Lead Vendor').stage).toBe('lead');
  expect((await get({ stage: 'active' })).map((r) => r.name)).toEqual(['Active Vendor']);
  expect((await get({ stage: 'lead,dropped' })).map((r) => r.name).sort()).toEqual(['Dropped Client', 'Lead Vendor']);
  expect((await get({ stage: 'nonsense' })).length).toBe(3);
});

test('skip moves an account to the Skipped list; bring back returns it', async () => {
  const a = await prisma.account.create({ data: { org_id: org.id, owner_id: admin.id, origin_owner_id: admin.id, type: 'vendor', name: 'Skip Me', stage: 'active' } });
  await prisma.account.create({ data: { org_id: org.id, owner_id: admin.id, origin_owner_id: admin.id, type: 'vendor', name: 'Keep Me', stage: 'active' } });
  const res = await authed(request(app).post(`/api/v1/reports/contact-gaps/${a.id}/skip`), token).send({ reason: 'Ask again in Jan' });
  expect(res.status).toBe(200);
  let d = (await authed(request(app).get('/api/v1/reports/contact-gaps'), token)).body.data;
  expect(d.rows.map((r) => r.name)).toEqual(['Keep Me']);
  expect(d.summary).toMatchObject({ vendors_with_gaps: 1, skipped: 1 });
  const skipped = (await authed(request(app).get('/api/v1/reports/contact-gaps'), token).query({ view: 'skipped' })).body.data.rows;
  expect(skipped).toHaveLength(1);
  expect(skipped[0]).toMatchObject({ name: 'Skip Me', skipped: { reason: 'Ask again in Jan', by: { id: admin.id } } });
  expect((await authed(request(app).delete(`/api/v1/reports/contact-gaps/${a.id}/skip`), token)).status).toBe(200);
  d = (await authed(request(app).get('/api/v1/reports/contact-gaps'), token)).body.data;
  expect(d.rows.map((r) => r.name).sort()).toEqual(['Keep Me', 'Skip Me']);
  expect(d.summary.skipped).toBe(0);
  const other = '00000000-0000-4000-8000-000000000000';
  expect((await authed(request(app).post(`/api/v1/reports/contact-gaps/${other}/skip`), token).send({})).status).toBe(404);
});
