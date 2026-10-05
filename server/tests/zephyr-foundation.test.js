const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function setupZephyr(slug = 'zephyr-co') {
  const org = await createOrg({ name: 'Zephyr Co', slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['zephyr'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}

// A non-admin login in the Zephyr org, linked to a ZxPerson with the given access role.
async function addMember(org, accessRole) {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  if (accessRole) await prisma.zxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole } });
  const { access_token } = await loginAs(user);
  return { user, token: access_token };
}

describe('zephyr access', () => {
  test('module must be enabled for the org', async () => {
    const org = await createOrg({ name: 'Other', slug: 'other-co' });
    const admin = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(admin.id, org.id, { role: 'admin' });
    const { access_token } = await loginAs(admin);
    expect((await authed(request(app).get('/api/v1/zephyr/me'), access_token)).status).toBe(403);
  });

  test('admin, manager and staff resolve to the right role and capabilities', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const staff = await addMember(org, 'staff');

    const a = (await authed(request(app).get('/api/v1/zephyr/me'), token)).body.data;
    expect(a.role).toBe('admin');
    expect(a.caps).toContain('financials');

    const m = (await authed(request(app).get('/api/v1/zephyr/me'), manager.token)).body.data;
    expect(m.role).toBe('manager');
    expect(m.caps).toContain('leads');
    expect(m.caps).not.toContain('financials');
    expect(m.caps).not.toContain('salaries');

    const s = (await authed(request(app).get('/api/v1/zephyr/me'), staff.token)).body.data;
    expect(s.role).toBe('staff');
    expect(s.caps).toEqual(['myWork']);
  });

  test('a member with no Zephyr person row or access_role none is refused', async () => {
    const { org } = await setupZephyr();
    const stray = await addMember(org, null);
    const none = await addMember(org, 'none');
    expect((await authed(request(app).get('/api/v1/zephyr/me'), stray.token)).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/zephyr/me'), none.token)).status).toBe(403);
  });

  test('settings and audit are admin-only; managers keep the roster but not access or pay', async () => {
    const { org } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    expect((await authed(request(app).get('/api/v1/zephyr/settings'), manager.token)).status).toBe(403);
    // managers may keep the roster, but not grant logins or set pay
    expect((await authed(request(app).post('/api/v1/zephyr/people'), manager.token).send({ name: 'X', access_role: 'staff' })).status).toBe(403);
    expect((await authed(request(app).post('/api/v1/zephyr/people'), manager.token).send({ name: 'X' })).status).toBe(201);
    expect((await authed(request(app).get('/api/v1/zephyr/audit'), manager.token)).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/zephyr/people'), manager.token)).status).toBe(200);
  });
});

describe('zephyr settings and categories', () => {
  test('settings default lazily and an admin edit is audited', async () => {
    const { token } = await setupZephyr();
    const initial = (await authed(request(app).get('/api/v1/zephyr/settings'), token)).body.data;
    expect(initial).toMatchObject({ currency: 'INR', valuation_method: 'revenue_multiple', valuation_multiple: 3 });

    const bad = await authed(request(app).patch('/api/v1/zephyr/settings'), token).send({ valuation_method: 'manual' });
    expect(bad.status).toBe(422);

    const res = await authed(request(app).patch('/api/v1/zephyr/settings'), token).send({ valuation_method: 'manual', valuation_manual: 5000000, reason: 'board value' });
    expect(res.status).toBe(200);
    expect(res.body.data.valuation_manual).toBe(5000000);

    const audit = (await authed(request(app).get('/api/v1/zephyr/audit?entity=setting'), token)).body.data;
    expect(audit).toHaveLength(1);
    expect(audit[0].reason).toBe('board value');
  });

  test('default categories are seeded once and admin can add, rename and remove', async () => {
    const { token } = await setupZephyr();
    const list = (await authed(request(app).get('/api/v1/zephyr/categories?kind=expense'), token)).body.data;
    expect(list.map((c) => c.name)).toContain('Materials');

    const created = await authed(request(app).post('/api/v1/zephyr/categories'), token).send({ kind: 'expense', name: 'Fuel' });
    expect(created.status).toBe(201);
    expect((await authed(request(app).post('/api/v1/zephyr/categories'), token).send({ kind: 'expense', name: 'Fuel' })).status).toBe(409);

    const renamed = await authed(request(app).patch(`/api/v1/zephyr/categories/${created.body.data.id}`), token).send({ name: 'Diesel' });
    expect(renamed.body.data.name).toBe('Diesel');

    expect((await authed(request(app).delete(`/api/v1/zephyr/categories/${created.body.data.id}`), token)).status).toBe(200);
    const after = (await authed(request(app).get('/api/v1/zephyr/categories?kind=expense'), token)).body.data;
    expect(after.map((c) => c.name)).not.toContain('Diesel');
  });
});

describe('zephyr people', () => {
  test('admin creates a person, links a login, and the link drives the role', async () => {
    const { org, token } = await setupZephyr();
    const user = await createUser({ role: 'employee', withOrg: false });
    await createOrgMembership(user.id, org.id, { role: 'employee' });
    const login = await loginAs(user);

    const person = (await authed(request(app).post('/api/v1/zephyr/people'), token).send({ name: 'Site Lead', user_id: user.id, access_role: 'manager' })).body.data;
    expect(person.user_email).toBe(user.email);
    expect((await authed(request(app).get('/api/v1/zephyr/me'), login.access_token)).body.data.role).toBe('manager');

    const dup = await authed(request(app).post('/api/v1/zephyr/people'), token).send({ name: 'Again', user_id: user.id, access_role: 'staff' });
    expect(dup.status).toBe(409);

    await authed(request(app).patch(`/api/v1/zephyr/people/${person.id}`), token).send({ access_role: 'none' });
    expect((await authed(request(app).get('/api/v1/zephyr/me'), login.access_token)).status).toBe(403);
  });

  test('a user outside the org cannot be linked', async () => {
    const { token } = await setupZephyr();
    const outsider = await createUser({ role: 'employee', withOrg: false });
    const res = await authed(request(app).post('/api/v1/zephyr/people'), token).send({ name: 'Out', user_id: outsider.id, access_role: 'staff' });
    expect(res.status).toBe(422);
  });
});

describe('zephyr isolation', () => {
  test('a second Zephyr org cannot read or change the first org rows', async () => {
    const a = await setupZephyr('zephyr-a');
    const b = await setupZephyr('zephyr-b');
    const person = (await authed(request(app).post('/api/v1/zephyr/people'), a.token).send({ name: 'Only A', access_role: 'staff' })).body.data;
    const cat = (await authed(request(app).post('/api/v1/zephyr/categories'), a.token).send({ kind: 'revenue', name: 'A only' })).body.data;

    const peopleB = (await authed(request(app).get('/api/v1/zephyr/people'), b.token)).body.data;
    expect(peopleB).toHaveLength(0);
    expect((await authed(request(app).patch(`/api/v1/zephyr/people/${person.id}`), b.token).send({ name: 'hack' })).status).toBe(404);
    expect((await authed(request(app).delete(`/api/v1/zephyr/categories/${cat.id}`), b.token)).status).toBe(404);
    const catsB = (await authed(request(app).get('/api/v1/zephyr/categories'), b.token)).body.data;
    expect(catsB.map((c) => c.name)).not.toContain('A only');
  });

  test('a Delphic-style org without the module gets nothing from the zephyr API', async () => {
    const org = await createOrg({ name: 'Delphic-like', slug: 'delphic-like' });
    const user = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(user.id, org.id, { role: 'admin' });
    const { access_token } = await loginAs(user);
    expect((await authed(request(app).get('/api/v1/zephyr/people'), access_token)).status).toBe(403);
  });
});
