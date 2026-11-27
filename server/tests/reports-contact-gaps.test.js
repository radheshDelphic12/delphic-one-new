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
