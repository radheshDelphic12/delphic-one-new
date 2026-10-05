const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function setupZephyr(slug = 'zephyr-co') {
  const org = await createOrg({ name: `Zephyr ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['zephyr'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}

async function addMember(org, accessRole) {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  await prisma.zxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole } });
  const { access_token } = await loginAs(user);
  return { user, token: access_token };
}

const post = (token, body) => authed(request(app).post('/api/v1/zephyr/parties'), token).send(body);

describe('zephyr parties CRUD', () => {
  test('create, read, edit, deactivate and filter by tab', async () => {
    const { token } = await setupZephyr();
    const client = await post(token, { name: 'Skyline Builders', kind: 'client', city: 'Pune', gstin: '27aabcu9603r1zx', pan: 'abcde1234f' });
    expect(client.status).toBe(201);
    expect(client.body.data).toMatchObject({ kind: 'client', status: 'active', gstin: '27AABCU9603R1ZX', pan: 'ABCDE1234F' });
    await post(token, { name: 'Ready Mix Co', kind: 'vendor' });
    await post(token, { name: 'Both Ways Ltd', kind: 'both' });

    const all = (await authed(request(app).get('/api/v1/zephyr/parties'), token)).body;
    expect(all.data).toHaveLength(3);
    expect(all.summary).toMatchObject({ clients: 2, vendors: 2 });
    const clients = (await authed(request(app).get('/api/v1/zephyr/parties?tab=client'), token)).body.data.map((p) => p.name);
    expect(clients.sort()).toEqual(['Both Ways Ltd', 'Skyline Builders']);
    const vendors = (await authed(request(app).get('/api/v1/zephyr/parties?tab=vendor'), token)).body.data.map((p) => p.name);
    expect(vendors.sort()).toEqual(['Both Ways Ltd', 'Ready Mix Co']);
    expect((await authed(request(app).get('/api/v1/zephyr/parties?q=pune'), token)).body.data).toHaveLength(1);

    const edited = await authed(request(app).patch(`/api/v1/zephyr/parties/${client.body.data.id}`), token).send({ payment_terms: 'Net 30', status: 'inactive', phone: '' });
    expect(edited.body.data).toMatchObject({ payment_terms: 'Net 30', status: 'inactive', phone: null });
    expect((await authed(request(app).get('/api/v1/zephyr/parties?status=active'), token)).body.data).toHaveLength(2);
    expect((await authed(request(app).get(`/api/v1/zephyr/parties/${client.body.data.id}`), token)).status).toBe(200);
  });

  test('rejects duplicate names, bad GSTIN/PAN and a missing name; audits changes', async () => {
    const { token } = await setupZephyr();
    await post(token, { name: 'Acme Infra' });
    expect((await post(token, { name: '  acme infra ' })).status).toBe(409);
    expect((await post(token, { name: 'X', gstin: '123' })).status).toBe(422);
    expect((await post(token, { name: 'Y', pan: 'bad' })).status).toBe(422);
    expect((await post(token, { name: '' })).status).toBe(422);
    const audit = (await authed(request(app).get('/api/v1/zephyr/audit?entity=party'), token)).body.data;
    expect(audit.map((a) => a.action)).toEqual(['create']);
  });

  test('renaming into an existing name is refused', async () => {
    const { token } = await setupZephyr();
    await post(token, { name: 'One' });
    const two = (await post(token, { name: 'Two' })).body.data;
    expect((await authed(request(app).patch(`/api/v1/zephyr/parties/${two.id}`), token).send({ name: 'ONE' })).status).toBe(409);
  });
});

describe('zephyr parties access', () => {
  test('manager can edit but not delete; staff cannot reach the directory', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const staff = await addMember(org, 'staff');
    const party = (await post(manager.token, { name: 'By Manager', kind: 'vendor' })).body.data;
    expect((await authed(request(app).patch(`/api/v1/zephyr/parties/${party.id}`), manager.token).send({ city: 'Indore' })).status).toBe(200);
    expect((await authed(request(app).delete(`/api/v1/zephyr/parties/${party.id}`), manager.token)).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/zephyr/parties'), staff.token)).status).toBe(403);
    expect((await post(staff.token, { name: 'Nope' })).status).toBe(403);

    expect((await authed(request(app).delete(`/api/v1/zephyr/parties/${party.id}`), token)).status).toBe(200);
    expect((await authed(request(app).get(`/api/v1/zephyr/parties/${party.id}`), token)).status).toBe(404);
    expect((await authed(request(app).get('/api/v1/zephyr/parties'), token)).body.data).toHaveLength(0);
    // a deleted name can be reused
    expect((await post(token, { name: 'By Manager' })).status).toBe(201);
  });

  test('another Zephyr org cannot see or change the first org parties', async () => {
    const a = await setupZephyr('zephyr-a');
    const b = await setupZephyr('zephyr-b');
    const party = (await post(a.token, { name: 'Only A' })).body.data;
    expect((await authed(request(app).get('/api/v1/zephyr/parties'), b.token)).body.data).toHaveLength(0);
    expect((await authed(request(app).get(`/api/v1/zephyr/parties/${party.id}`), b.token)).status).toBe(404);
    expect((await authed(request(app).patch(`/api/v1/zephyr/parties/${party.id}`), b.token).send({ name: 'hack' })).status).toBe(404);
    expect((await authed(request(app).delete(`/api/v1/zephyr/parties/${party.id}`), b.token)).status).toBe(404);
    // the same name is free in another org
    expect((await post(b.token, { name: 'Only A' })).status).toBe(201);
  });
});

describe('zephyr parties CSV import', () => {
  test('creates valid rows and reports skipped ones with a reason', async () => {
    const { token } = await setupZephyr();
    await post(token, { name: 'Existing Co' });
    const res = await authed(request(app).post('/api/v1/zephyr/parties/import'), token).send({
      rows: [
        { name: 'New Client', kind: 'Client', city: 'Delhi' },
        { name: 'Existing Co' },
        { name: 'new client' },
        { name: 'Bad Kind', kind: 'banana' },
        { name: 'Bad GST', gstin: 'xyz' },
        { name: '' },
        { name: 'Vendor One', kind: 'vendor', status: 'inactive' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(2);
    expect(res.body.data.skipped.map((s) => s.row)).toEqual([2, 3, 4, 5, 6]);
    expect(res.body.data.skipped[0].reason).toMatch(/already exists/);
    expect((await authed(request(app).get('/api/v1/zephyr/parties'), token)).body.data).toHaveLength(3);
  });
});

describe('zephyr party documents', () => {
  const upload = (token, partyId, extra = {}, file = ['%PDF-1.4 test', 'agreement.pdf']) => {
    let req = authed(request(app).post('/api/v1/zephyr/documents'), token)
      .field('owner_type', 'party')
      .field('owner_id', partyId)
      .field('title', extra.title ?? 'Master agreement');
    for (const [k, v] of Object.entries(extra)) if (k !== 'title') req = req.field(k, v);
    return file ? req.attach('file', Buffer.from(file[0]), file[1]) : req;
  };

  test('upload, list with expiry, download, flag expiring on the list, and delete', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const staff = await addMember(org, 'staff');
    const party = (await post(token, { name: 'Doc Co' })).body.data;
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

    const up = await upload(token, party.id, { category: 'license', ref_no: 'LIC-42', expiry_date: soon });
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ category: 'license', ref_no: 'LIC-42', owner_type: 'party', file_name: 'agreement.pdf' });

    const docs = (await authed(request(app).get(`/api/v1/zephyr/documents?owner_type=party&owner_id=${party.id}`), manager.token)).body.data;
    expect(docs).toHaveLength(1);
    expect(docs[0].expiry_date.slice(0, 10)).toBe(soon);

    const listed = (await authed(request(app).get('/api/v1/zephyr/parties'), token)).body.data;
    expect(listed[0].docs_attention).toBe(1);

    const file = await authed(request(app).get(up.body.data.file_url), manager.token);
    expect(file.status).toBe(200);
    expect(String(file.headers['content-disposition'])).toMatch(/agreement\.pdf/);
    expect((await authed(request(app).get(up.body.data.file_url), staff.token)).status).toBe(403);

    // an admin / manager can fix a document's details without re-uploading it
    const fixed = await authed(request(app).patch(`/api/v1/zephyr/documents/${up.body.data.id}`), manager.token).send({ title: 'Master agreement v2', ref_no: 'AGR-9', expiry_date: '' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data).toMatchObject({ title: 'Master agreement v2', ref_no: 'AGR-9', expiry_date: null });
    expect((await authed(request(app).patch(`/api/v1/zephyr/documents/${up.body.data.id}`), manager.token).send({ issue_date: '2026-05-01', expiry_date: '2026-04-01' })).status).toBe(422);
    expect((await authed(request(app).patch(`/api/v1/zephyr/documents/${up.body.data.id}`), staff.token).send({ title: 'x' })).status).toBe(403);
    expect((await authed(request(app).delete(`/api/v1/zephyr/documents/${up.body.data.id}`), staff.token)).status).toBe(403);
    expect((await authed(request(app).delete(`/api/v1/zephyr/documents/${up.body.data.id}`), manager.token)).status).toBe(200);
    expect((await authed(request(app).get(`/api/v1/zephyr/documents?owner_type=party&owner_id=${party.id}`), token)).body.data).toHaveLength(0);
  });

  test('rejects bad uploads: no file, wrong type, expiry before issue, staff, and a foreign owner', async () => {
    const { org, token } = await setupZephyr();
    const other = await setupZephyr('zephyr-other');
    const staff = await addMember(org, 'staff');
    const party = (await post(token, { name: 'Strict Co' })).body.data;
    const foreign = (await post(other.token, { name: 'Foreign Co' })).body.data;

    expect((await upload(token, party.id, {}, null)).status).toBe(422);
    expect((await upload(token, party.id, {}, ['MZ', 'virus.exe'])).status).toBe(422);
    expect((await upload(token, party.id, { issue_date: '2026-05-01', expiry_date: '2026-04-01' })).status).toBe(422);
    expect((await upload(staff.token, party.id)).status).toBe(403);
    expect((await upload(token, foreign.id)).status).toBe(404);
    expect((await authed(request(app).get(`/api/v1/zephyr/documents?owner_type=party&owner_id=${foreign.id}`), token)).status).toBe(404);
  });

  test('another org cannot download or delete the file', async () => {
    const a = await setupZephyr('zephyr-a');
    const b = await setupZephyr('zephyr-b');
    const party = (await post(a.token, { name: 'Private Co' })).body.data;
    const up = await upload(a.token, party.id);
    expect((await authed(request(app).get(up.body.data.file_url), b.token)).status).toBe(403);
    expect((await authed(request(app).delete(`/api/v1/zephyr/documents/${up.body.data.id}`), b.token)).status).toBe(404);
  });
});
