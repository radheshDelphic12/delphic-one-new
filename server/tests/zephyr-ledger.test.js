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
  const person = await prisma.zxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole } });
  const { access_token } = await loginAs(user);
  return { user, person, token: access_token };
}

const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/zephyr${path}`), token).send(body || {}),
  get: (path) => authed(request(app).get(`/api/v1/zephyr${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/zephyr${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/zephyr${path}`), token),
});
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function world(token) {
  const a = api(token);
  const cats = (await a.get('/categories')).body.data;
  const cat = (kind, name) => cats.find((c) => c.kind === kind && c.name === name).id;
  const client = (await a.post('/parties', { name: 'Skyline Builders', kind: 'client' })).body.data;
  const vendor = (await a.post('/parties', { name: 'Steel Supplier', kind: 'vendor' })).body.data;
  const project = (await a.post('/projects', { name: 'Tower A', kind: 'client', party_id: client.id, status: 'active', budget: 1000000, contract_value: 5000000 })).body.data;
  const other = (await a.post('/projects', { name: 'Tower B', kind: 'client', status: 'active' })).body.data;
  const ms = (await a.post(`/projects/${project.id}/milestones`, { name: 'Slab', billing_amount: 100000 })).body.data.milestones[0];
  const wo = (await a.post(`/projects/${project.id}/work-orders`, { vendor_id: vendor.id, scope: 'Rebar', value: 400000, status: 'issued' })).body.data.work_orders[0];
  return { a, cat, client, vendor, project, other, ms, wo };
}

describe('zephyr ledger entries', () => {
  test('create revenue and expense, planned vs actual, totals and filters', async () => {
    const { token } = await setupZephyr();
    const w = await world(token);
    const { a } = w;
    const rev = await a.post('/ledger', { entry_date: day(-3), type: 'revenue', category_id: w.cat('revenue', 'Project billing'), project_id: w.project.id, party_id: w.client.id, amount: 250000, tax: 45000, payment_mode: 'bank', reference: 'INV-1' });
    expect(rev.status).toBe(201);
    expect(rev.body.data).toMatchObject({ type: 'revenue', status: 'actual', amount: 250000, tax: 45000, category: { name: 'Project billing' }, project: { id: w.project.id }, party: { name: 'Skyline Builders' } });
    await a.post('/ledger', { entry_date: day(-2), type: 'expense', category_id: w.cat('expense', 'Materials'), project_id: w.project.id, party_id: w.vendor.id, amount: 80000, tax: 14400 });
    await a.post('/ledger', { entry_date: day(20), type: 'expense', category_id: w.cat('expense', 'Labour'), project_id: w.project.id, amount: 60000, status: 'planned' });

    const all = await a.get('/ledger');
    expect(all.body.data).toHaveLength(3);
    expect(all.body.totals).toEqual({ revenue: 250000, expense: 80000, planned_revenue: 0, planned_expense: 60000 });
    expect((await a.get('/ledger?type=revenue')).body.data).toHaveLength(1);
    expect((await a.get('/ledger?status=planned')).body.data).toHaveLength(1);
    expect((await a.get(`/ledger?party_id=${w.vendor.id}`)).body.data).toHaveLength(1);
    expect((await a.get('/ledger?q=inv-1')).body.data).toHaveLength(1);
    expect((await a.get(`/ledger?from=${day(-2)}&to=${day(0)}`)).body.data).toHaveLength(1);
    expect((await a.get(`/ledger?project_id=${w.other.id}`)).body.data).toHaveLength(0);
  });

  test('validates amounts, dates, categories and party kind', async () => {
    const { token } = await setupZephyr();
    const w = await world(token);
    const { a } = w;
    const base = { entry_date: day(-1), type: 'expense', category_id: w.cat('expense', 'Materials'), amount: 100 };
    expect((await a.post('/ledger', { ...base, amount: 0 })).status).toBe(422);
    expect((await a.post('/ledger', { ...base, amount: -5 })).status).toBe(422);
    expect((await a.post('/ledger', { ...base, entry_date: 'soon' })).status).toBe(422);
    expect((await a.post('/ledger', { ...base, entry_date: day(3) })).status).toBe(422);
    expect((await a.post('/ledger', { ...base, entry_date: day(3), status: 'planned' })).status).toBe(201);
    expect((await a.post('/ledger', { ...base, category_id: w.cat('revenue', 'Rental income') })).status).toBe(422);
    expect((await a.post('/ledger', { ...base, party_id: w.client.id })).status).toBe(422);
    expect((await a.post('/ledger', { ...base, type: 'revenue', category_id: w.cat('revenue', 'Rental income'), party_id: w.vendor.id })).status).toBe(422);
    expect((await a.post('/ledger', { ...base, project_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);

    // an inactive category cannot be used for new entries
    const cats = (await a.get('/categories?kind=expense')).body.data;
    await a.patch(`/categories/${cats[0].id}`, { active: false });
    expect((await a.post('/ledger', { ...base, category_id: cats[0].id })).status).toBe(422);
  });

  test('work order and milestone links derive the project and enforce the right type', async () => {
    const { token } = await setupZephyr();
    const w = await world(token);
    const { a } = w;
    const exp = await a.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: w.cat('expense', 'Subcontractor'), work_order_id: w.wo.id, amount: 90000 });
    expect(exp.status).toBe(201);
    expect(exp.body.data).toMatchObject({ project: { id: w.project.id }, party: { id: w.vendor.id }, work_order: { id: w.wo.id } });
    expect((await a.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: w.cat('expense', 'Subcontractor'), work_order_id: w.wo.id, project_id: w.other.id, amount: 1 })).status).toBe(422);
    expect((await a.post('/ledger', { entry_date: day(-1), type: 'revenue', category_id: w.cat('revenue', 'Project billing'), work_order_id: w.wo.id, amount: 1 })).status).toBe(422);

    const rev = await a.post('/ledger', { entry_date: day(-1), type: 'revenue', category_id: w.cat('revenue', 'Project billing'), milestone_id: w.ms.id, amount: 100000 });
    expect(rev.body.data).toMatchObject({ project: { id: w.project.id }, milestone: { id: w.ms.id } });
    expect((await a.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: w.cat('expense', 'Materials'), milestone_id: w.ms.id, amount: 1 })).status).toBe(422);
    expect((await a.post('/ledger', { entry_date: day(-1), type: 'revenue', category_id: w.cat('revenue', 'Project billing'), milestone_id: w.ms.id, project_id: w.other.id, amount: 1 })).status).toBe(422);
  });

  test('edit, change project drops stale links, audit, and soft delete (admin only)', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const w = await world(token);
    const { a } = w;
    const e = (await a.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: w.cat('expense', 'Subcontractor'), work_order_id: w.wo.id, amount: 5000 })).body.data;
    const edited = await a.patch(`/ledger/${e.id}`, { amount: 7500, description: 'Part payment' });
    expect(edited.body.data).toMatchObject({ amount: 7500, description: 'Part payment', work_order: { id: w.wo.id } });
    const moved = await a.patch(`/ledger/${e.id}`, { project_id: w.other.id });
    expect(moved.body.data).toMatchObject({ project: { id: w.other.id }, work_order: null });
    const audit = (await a.get('/audit?entity=ledger')).body.data.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['create', 'update']));

    expect((await api(manager.token).del(`/ledger/${e.id}`)).status).toBe(403);
    expect((await a.del(`/ledger/${e.id}`)).status).toBe(200);
    expect((await a.get(`/ledger/${e.id}`)).status).toBe(404);
    expect((await a.get('/ledger')).body.data).toHaveLength(0);
  });

  test('CSV import creates valid rows and reports the rest', async () => {
    const { token } = await setupZephyr();
    const w = await world(token);
    const { a } = w;
    const res = await a.post('/ledger/import', {
      rows: [
        { date: day(-5), type: 'expense', category: 'Materials', amount: '12000', tax: '2160', project: w.project.code, party: 'Steel Supplier', reference: 'B-1' },
        { date: day(-4), type: 'revenue', category: 'Project billing', amount: '50000', status: 'actual', project: w.project.code, party: 'Skyline Builders' },
        { date: day(-4), type: 'revenue', category: 'Nope', amount: '1' },
        { date: day(-4), type: 'income', category: 'Materials', amount: '1' },
        { date: day(-4), type: 'expense', category: 'Materials', amount: '1', project: 'ZX-P-999' },
        { date: day(-4), type: 'expense', category: 'Materials', amount: 'abc' },
        { date: day(9), type: 'expense', category: 'Materials', amount: '5' },
        { date: day(9), type: 'expense', category: 'Materials', amount: '5', status: 'planned' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(3);
    expect(res.body.data.skipped.map((s) => s.row)).toEqual([3, 4, 5, 6, 7]);
    expect((await a.get('/ledger')).body.data).toHaveLength(3);
  });
});

describe('zephyr ledger roles and isolation', () => {
  test('a manager records project expenses only and never sees revenue', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const staff = await addMember(org, 'staff');
    const w = await world(token);
    const m = api(manager.token);
    const rev = (await w.a.post('/ledger', { entry_date: day(-1), type: 'revenue', category_id: w.cat('revenue', 'Project billing'), project_id: w.project.id, amount: 999 })).body.data;
    const company = (await w.a.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: w.cat('expense', 'Office'), amount: 111 })).body.data;

    expect((await m.post('/ledger', { entry_date: day(-1), type: 'revenue', category_id: w.cat('revenue', 'Project billing'), project_id: w.project.id, amount: 5 })).status).toBe(403);
    expect((await m.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: w.cat('expense', 'Office'), amount: 5 })).status).toBe(403);
    const own = await m.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: w.cat('expense', 'Materials'), project_id: w.project.id, amount: 5 });
    expect(own.status).toBe(201);
    expect((await m.patch(`/ledger/${own.body.data.id}`, { amount: 6 })).status).toBe(200);
    expect((await m.patch(`/ledger/${own.body.data.id}`, { project_id: null })).status).toBe(403);

    const seen = (await m.get('/ledger')).body.data;
    expect(seen.map((x) => x.id)).toEqual([own.body.data.id]);
    expect((await m.get(`/ledger/${rev.id}`)).status).toBe(404);
    expect((await m.get(`/ledger/${company.id}`)).status).toBe(404);
    expect((await m.patch(`/ledger/${rev.id}`, { amount: 1 })).status).toBe(404);
    expect((await m.post('/ledger/import', { rows: [{ date: day(-1), type: 'expense', category: 'Materials', amount: '1' }] })).status).toBe(403);

    expect((await api(staff.token).get('/ledger')).status).toBe(403);
    expect((await api(staff.token).post('/ledger', {})).status).toBe(403);
  });

  test('another org sees and changes nothing', async () => {
    const a = await setupZephyr('zephyr-a');
    const b = await setupZephyr('zephyr-b');
    const w = await world(a.token);
    const e = (await w.a.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: w.cat('expense', 'Materials'), project_id: w.project.id, amount: 5 })).body.data;
    const bb = api(b.token);
    expect((await bb.get('/ledger')).body.data).toHaveLength(0);
    expect((await bb.get(`/ledger/${e.id}`)).status).toBe(404);
    expect((await bb.patch(`/ledger/${e.id}`, { amount: 1 })).status).toBe(404);
    expect((await bb.del(`/ledger/${e.id}`)).status).toBe(404);
    const bCats = (await bb.get('/categories')).body.data;
    // another company's project / category / party cannot be used
    expect((await bb.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: w.cat('expense', 'Materials'), amount: 5 })).status).toBe(422);
    expect((await bb.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: bCats.find((c) => c.kind === 'expense').id, project_id: w.project.id, amount: 5 })).status).toBe(422);
    expect((await bb.get(`/projects/${w.project.id}/money`)).status).toBe(404);
    expect((await bb.get(`/parties/${w.client.id}/statement`)).status).toBe(404);
  });
});

describe('zephyr project money and party statement', () => {
  test('project money: actuals, planned, categories, budget used; salaries only for admin', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const w = await world(token);
    const { a } = w;
    await a.post('/ledger', { entry_date: day(-5), type: 'revenue', category_id: w.cat('revenue', 'Project billing'), project_id: w.project.id, amount: 300000, tax: 54000 });
    await a.post('/ledger', { entry_date: day(-4), type: 'expense', category_id: w.cat('expense', 'Materials'), project_id: w.project.id, amount: 100000, tax: 18000 });
    await a.post('/ledger', { entry_date: day(-3), type: 'expense', category_id: w.cat('expense', 'Labour'), project_id: w.project.id, amount: 50000 });
    await a.post('/ledger', { entry_date: day(10), type: 'revenue', category_id: w.cat('revenue', 'Project billing'), project_id: w.project.id, amount: 200000, status: 'planned' });

    // an approved slip charged 100% to this project
    const person = (await a.post('/people', { name: 'Site Eng', pay_basis: 'monthly', rate: 40000, joining_date: day(-400) })).body.data;
    await a.post(`/people/${person.id}/assignments`, { project_id: w.project.id });
    const month = new Date().toISOString().slice(0, 7);
    await a.post('/salaries/generate', { month });
    const slip = (await a.get(`/salaries?month=${month}`)).body.data.records[0];
    await a.post(`/salaries/${slip.id}/approve`);

    const adminView = (await a.get(`/projects/${w.project.id}/money`)).body.data;
    expect(adminView).toMatchObject({ revenue: 300000, expense: 150000, salaries: 40000, profit: 110000, planned_revenue: 200000, tax_collected: 54000, tax_paid: 18000, contract_value: 5000000, budget: 1000000, budget_used_pct: 19 });
    expect(adminView.by_category[0]).toMatchObject({ type: 'revenue', category: 'Project billing', amount: 300000 });

    const managerView = (await api(manager.token).get(`/projects/${w.project.id}/money`)).body.data;
    expect(managerView.salaries).toBeNull();
    expect(managerView.profit).toBe(150000 * -1 + 300000);
  });

  test('party statement shows received, paid, expected and work orders', async () => {
    const { token } = await setupZephyr();
    const w = await world(token);
    const { a } = w;
    await a.post('/ledger', { entry_date: day(-2), type: 'expense', category_id: w.cat('expense', 'Subcontractor'), work_order_id: w.wo.id, amount: 120000 });
    await a.post('/ledger', { entry_date: day(8), type: 'expense', category_id: w.cat('expense', 'Subcontractor'), work_order_id: w.wo.id, amount: 80000, status: 'planned' });
    await a.post('/ledger', { entry_date: day(-1), type: 'revenue', category_id: w.cat('revenue', 'Project billing'), project_id: w.project.id, party_id: w.client.id, amount: 70000 });

    const vendor = (await a.get(`/parties/${w.vendor.id}/statement`)).body.data;
    expect(vendor).toMatchObject({ paid: 120000, expected_out: 80000, received: 0, work_order_value: 400000 });
    expect(vendor.work_orders[0]).toMatchObject({ value: 400000 });
    expect(vendor.entries).toHaveLength(2);
    const client = (await a.get(`/parties/${w.client.id}/statement`)).body.data;
    expect(client).toMatchObject({ received: 70000, paid: 0 });
  });

  test('ledger entry documents: manager can upload, staff cannot', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const staff = await addMember(org, 'staff');
    const w = await world(token);
    const e = (await w.a.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: w.cat('expense', 'Materials'), project_id: w.project.id, amount: 5 })).body.data;
    const up = await authed(request(app).post('/api/v1/zephyr/documents'), manager.token)
      .field('owner_type', 'entry').field('owner_id', e.id).field('title', 'Bill scan')
      .attach('file', Buffer.from('%PDF-1.4 x'), 'bill.pdf');
    expect(up.status).toBe(201);
    expect((await authed(request(app).get(up.body.data.file_url), manager.token)).status).toBe(200);
    expect((await authed(request(app).get(up.body.data.file_url), staff.token)).status).toBe(403);
  });
});
