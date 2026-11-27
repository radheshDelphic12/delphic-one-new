/** Group Dashboard > Directory: contacts across companies, status / source / follow-ups, and the pipeline of new people (add or skip). */
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

let group; let alpha; let beta; let token; let sup;
beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE group_directory_followups, group_directory_contacts, group_directory_skips CASCADE');
  group = await prisma.orgGroup.create({ data: { name: 'Dir Group' } });
  alpha = await createOrg({ name: 'Alpha Co', slug: 'alpha-dir', org_group_id: group.id });
  beta = await createOrg({ name: 'Beta Co', slug: 'beta-dir', org_group_id: group.id });
  sup = await createUser({ role: 'admin', withOrg: false, name: 'Group Admin' });
  await prisma.user.update({ where: { id: sup.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: sup.id, org_group_id: group.id } }).catch(() => null);
  await createOrgMembership(sup.id, alpha.id, { role: 'admin' });
  token = (await loginAs(sup)).access_token;
});
afterAll(async () => { await prisma.$disconnect(); });

const d = (m, url = '') => authed(request(app)[m](`/api/v1/group-directory${url}`), token);

test('a contact in two companies with status, source and follow-ups; duplicates refused; filters', async () => {
  const c = await d('post').send({ name: 'Priya Network', email: 'Priya@Example.com', phone: '+91 98765 43210', organisation: 'Acme', kind: 'client', company_ids: [alpha.id, beta.id], source: 'event', next_followup_date: '2020-01-01' });
  expect(c.status).toBe(201);
  expect(c.body.data).toMatchObject({ email: 'priya@example.com', status: 'fresh', source: 'event', followup_due: true });
  expect(c.body.data.companies.map((x) => x.name)).toEqual(['Alpha Co', 'Beta Co']);
  expect((await d('post').send({ name: 'Same Person', email: 'priya@example.com' })).status).toBe(409);
  expect((await d('post').send({ name: 'Same Phone', phone: '9876543210' })).status).toBe(409);

  const f = await d('post', `/${c.body.data.id}/followups`).send({ note: 'Met at the expo, wants a demo', contacted_on: '2026-11-20', next_followup_date: '2099-01-10' });
  expect(f.status).toBe(201);
  expect(f.body.data).toMatchObject({ status: 'in_connect', last_connected_on: '2026-11-20', next_followup_date: '2099-01-10', followup_due: false });
  expect(f.body.data.followups[0].note).toMatch(/expo/);

  await d('post').send({ name: 'Old Contact', status: 'left', source: 'linkedin' });
  const list = (await d('get').query({ status: 'in_connect' })).body.data;
  expect(list.contacts.map((x) => x.name)).toEqual(['Priya Network']);
  expect(list.counts).toMatchObject({ in_connect: 1, left: 1, fresh: 0 });
  expect((await d('get').query({ company_id: beta.id })).body.data.contacts).toHaveLength(1);
  expect((await d('get').query({ q: 'acme' })).body.data.contacts).toHaveLength(1);
  const upd = await d('patch', `/${c.body.data.id}`).send({ status: 'left' });
  expect(upd.body.data.status).toBe('left');
  expect((await d('delete', `/${c.body.data.id}`)).status).toBe(200);
  expect((await d('get')).body.data.contacts.map((x) => x.name)).toEqual(['Old Contact']);
});

test('the pipeline lists new people from every company once; add puts them in the directory, skip hides them for good', async () => {
  const mkAccount = (org, data) => prisma.account.create({ data: { org_id: org.id, stage: 'active', owner_id: sup.id, origin_owner_id: sup.id, ...data } });
  await mkAccount(alpha, { type: 'client', name: 'Client X', poc_name: 'Ravi Client', poc_email: 'ravi@x.example', poc_phone: '9000000001' });
  // the same person is the vendor contact in the other company
  await mkAccount(beta, { type: 'vendor', name: 'Vendor Y', poc_name: 'Ravi K', poc_email: 'RAVI@x.example' });
  const emp = await createUser({ role: 'employee', name: 'Esha Employee', withOrg: false });
  await createOrgMembership(emp.id, beta.id, { role: 'employee' });

  let p = (await d('get', '/pipeline')).body.data;
  const ravi = p.candidates.find((x) => x.email && x.email.toLowerCase() === 'ravi@x.example');
  expect(ravi.companies.map((x) => x.name).sort()).toEqual(['Alpha Co', 'Beta Co']);
  const esha = p.candidates.find((x) => x.name === 'Esha Employee');
  expect(esha).toMatchObject({ kind: 'employee' });

  const added = await d('post', '/pipeline/add').send({ keys: [ravi.key], source: 'reference' });
  expect(added.status).toBe(201);
  expect((await d('post', '/pipeline/skip').send({ keys: esha.keys })).status).toBe(200);
  p = (await d('get', '/pipeline')).body.data;
  expect(p.candidates.find((x) => (x.email || '').toLowerCase() === 'ravi@x.example')).toBeUndefined();
  expect(p.candidates.find((x) => x.name === 'Esha Employee')).toBeUndefined();
  const dir = (await d('get')).body.data.contacts;
  const added_ = dir.find((x) => x.email === 'ravi@x.example');
  expect(added_).toMatchObject({ status: 'fresh', source: 'reference' });
  expect(added_.companies.map((x) => x.name).sort()).toEqual(['Alpha Co', 'Beta Co']);
  // a plain employee cannot open the group directory
  expect((await authed(request(app).get('/api/v1/group-directory'), (await loginAs(emp)).access_token)).status).toBe(403);
});

test('pipeline rows carry the client / vendor status; a skipped person waits in the Skipped list and can be brought back', async () => {
  await prisma.account.create({ data: { org_id: alpha.id, stage: 'dropped', owner_id: sup.id, origin_owner_id: sup.id, type: 'vendor', name: 'Vendor Z', poc_name: 'Zara Vendor', poc_email: 'zara@z.example' } });
  let p = (await d('get', '/pipeline')).body.data;
  const zara = p.candidates.find((x) => x.name === 'Zara Vendor');
  expect(zara).toMatchObject({ kind: 'vendor', stage: 'dropped' });
  expect((await d('post', '/pipeline/skip').send({ keys: zara.keys })).status).toBe(200);
  p = (await d('get', '/pipeline')).body.data;
  expect(p.candidates.find((x) => x.name === 'Zara Vendor')).toBeUndefined();
  expect(p.skipped).toBe(1);
  const sk = (await d('get', '/pipeline').query({ view: 'skipped' })).body.data;
  expect(sk.candidates.map((x) => x.name)).toEqual(['Zara Vendor']);
  expect(sk.candidates[0].skipped.by).toMatchObject({ id: sup.id });
  expect((await d('post', '/pipeline/unskip').send({ keys: zara.keys })).body.data).toEqual({ restored: 1 });
  p = (await d('get', '/pipeline')).body.data;
  expect(p.candidates.find((x) => x.name === 'Zara Vendor')).toBeTruthy();
  expect(p.skipped).toBe(0);
});
