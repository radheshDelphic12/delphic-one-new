const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedOrgAdmin(orgOverrides = { name: 'Delphic', slug: 'delphic' }) {
  const org = await createOrg(orgOverrides);
  const admin = await createUser({ role: 'admin' });
  const membership = await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, membership, token: access_token };
}

async function account(org, owner, name, type) {
  return prisma.account.create({
    data: { org_id: org.id, name, type, stage: 'active', owner_id: owner.id, origin_owner_id: owner.id },
  });
}

describe('People → Assets register', () => {
  test('admin issues a device, edits it, marks it returned, filters by status and deletes it', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    const employee = await createUser({ role: 'employee', name: 'Vipul Sharma' });
    const member = await createOrgMembership(employee.id, org.id, { role: 'employee' });
    const client = await account(org, admin, 'Devlabs', 'client');
    const vendor = await account(org, admin, 'Amarial Solution', 'vendor');

    const res = await authed(request(app).post('/api/v1/assets'), token).send({
      serial_number: 'C02G22PJMD6M',
      asset_type: 'Mac Book',
      belongs_to: 'delphic',
      org_membership_id: member.id,
      vendor_account_id: vendor.id,
      client_account_id: client.id,
      issue_date: '2026-04-14',
      device_details: 'Apple 2025 MacBook Air',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      serial_number: 'C02G22PJMD6M',
      asset_type: 'Mac Book',
      status: 'issued',
      issue_date: '2026-04-14',
      return_date: null,
      org_membership: { id: member.id, name: 'Vipul Sharma' },
      vendor_account: { name: 'Amarial Solution' },
      client_account: { name: 'Devlabs' },
    });
    const id = res.body.data.id;

    // A bare device with no serial / employee is allowed (the register has those).
    const bare = await authed(request(app).post('/api/v1/assets'), token).send({ asset_type: 'Windows Laptop', belongs_to: 'client' });
    expect(bare.status).toBe(201);

    const returned = await authed(request(app).patch(`/api/v1/assets/${id}`), token).send({ status: 'returned', return_date: '2026-09-28' });
    expect(returned.status).toBe(200);
    expect(returned.body.data).toMatchObject({ status: 'returned', return_date: '2026-09-28', serial_number: 'C02G22PJMD6M' });

    const cleared = await authed(request(app).patch(`/api/v1/assets/${id}`), token).send({ vendor_account_id: null, device_details: '' });
    expect(cleared.body.data).toMatchObject({ vendor_account: null, device_details: null });

    const issued = await authed(request(app).get('/api/v1/assets?status=issued'), token);
    expect(issued.body.data.map((a) => a.asset_type)).toEqual(['Windows Laptop']);
    const all = await authed(request(app).get('/api/v1/assets'), token);
    expect(all.body.data).toHaveLength(2);

    expect((await authed(request(app).delete(`/api/v1/assets/${id}`), token)).status).toBe(200);
    expect(await prisma.asset.count()).toBe(1);
  });

  test('dispatched status, several users (active or exited) and an office location, filtered and shown in the list', async () => {
    const { org, token } = await seedOrgAdmin();
    const [asha, ravi] = await Promise.all([createUser({ role: 'employee', name: 'Asha Active' }), createUser({ role: 'employee', name: 'Ravi Exited' })]);
    const ashaM = await createOrgMembership(asha.id, org.id, { role: 'employee' });
    const raviM = await createOrgMembership(ravi.id, org.id, { role: 'employee', employment_status: 'terminated' });
    const indore = await prisma.location.create({ data: { org_id: org.id, name: 'Indore Office' } });
    const gurgaon = await prisma.location.create({ data: { org_id: org.id, name: 'Gurgaon Office' } });

    const one = await authed(request(app).post('/api/v1/assets'), token).send({ asset_type: 'Mac Book', status: 'dispatched', used_by_ids: [ashaM.id, raviM.id], location_id: indore.id });
    expect(one.status).toBe(201);
    expect(one.body.data).toMatchObject({ status: 'dispatched', location: { id: indore.id, name: 'Indore Office' } });
    expect(one.body.data.used_by.map((u) => u.name).sort()).toEqual(['Asha Active', 'Ravi Exited']);
    const two = await authed(request(app).post('/api/v1/assets'), token).send({ asset_type: 'Monitor', used_by_ids: [ashaM.id], location_id: gurgaon.id });
    await authed(request(app).post('/api/v1/assets'), token).send({ asset_type: 'Cube' });

    const list = (query) => authed(request(app).get(`/api/v1/assets${query}`), token).then((r) => r.body.data.map((a) => a.asset_type).sort());
    expect(await list('?status=dispatched')).toEqual(['Mac Book']);
    expect(await list(`?location_id=${gurgaon.id}`)).toEqual(['Monitor']);
    expect(await list(`?used_by=${ashaM.id}`)).toEqual(['Mac Book', 'Monitor']);
    expect(await list(`?used_by=${raviM.id}`)).toEqual(['Mac Book']); // an exited employee can be a user and a filter
    expect(await list('')).toEqual(['Cube', 'Mac Book', 'Monitor']);

    // edit: change users and office, clear the office, move to returned
    const edited = await authed(request(app).patch(`/api/v1/assets/${two.body.data.id}`), token).send({ used_by_ids: [raviM.id], location_id: null, status: 'returned', return_date: '2026-11-12' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ status: 'returned', location: null, used_by: [{ id: raviM.id, name: 'Ravi Exited' }] });
    expect((await authed(request(app).patch(`/api/v1/assets/${two.body.data.id}`), token).send({ used_by_ids: [] })).body.data.used_by).toEqual([]);
    expect((await authed(request(app).get('/api/v1/assets?status=nope'), token)).status).toBe(422);
  });

  test('users and office must belong to this company', async () => {
    const { token } = await seedOrgAdmin();
    const other = await seedOrgAdmin({ name: 'Other', slug: 'other' });
    const foreignOffice = await prisma.location.create({ data: { org_id: other.org.id, name: 'Elsewhere' } });
    expect((await authed(request(app).post('/api/v1/assets'), token).send({ asset_type: 'Cube', location_id: foreignOffice.id })).status).toBe(422);
    expect((await authed(request(app).post('/api/v1/assets'), token).send({ asset_type: 'Cube', used_by_ids: [other.membership.id] })).status).toBe(422);
    expect((await authed(request(app).post('/api/v1/assets'), token).send({ asset_type: 'Cube', used_by_ids: ['not-a-uuid'] })).status).toBe(422);
    expect(await prisma.asset.count({ where: { org_id: other.org.id } })).toBe(0);
  });

  test('refuses another org\'s records, a client as vendor, and non-admins', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    const client = await account(org, admin, 'Devlabs', 'client');
    const other = await seedOrgAdmin({ name: 'Other', slug: 'other' });
    const otherVendor = await account(other.org, other.admin, 'Other Vendor', 'vendor');

    const bad = [
      { org_membership_id: other.membership.id },
      { vendor_account_id: otherVendor.id },
      { vendor_account_id: client.id },
    ];
    for (const link of bad) {
      const res = await authed(request(app).post('/api/v1/assets'), token).send({ asset_type: 'Cube', ...link });
      expect(res.status).toBe(422);
    }
    expect((await authed(request(app).post('/api/v1/assets'), token).send({})).status).toBe(422);

    const asset = (await authed(request(app).post('/api/v1/assets'), other.token).send({ asset_type: 'Cube' })).body.data;
    expect((await authed(request(app).patch(`/api/v1/assets/${asset.id}`), token).send({ status: 'returned' })).status).toBe(404);
    expect((await authed(request(app).get('/api/v1/assets'), token)).body.data).toHaveLength(0);

    const employee = await createUser({ role: 'employee' });
    await createOrgMembership(employee.id, org.id, { role: 'employee' });
    const { access_token } = await loginAs(employee);
    expect((await authed(request(app).get('/api/v1/assets'), access_token)).status).toBe(403);
  });
});
