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

const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/zephyr${path}`), token).send(body || {}),
  get: (path) => authed(request(app).get(`/api/v1/zephyr${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/zephyr${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/zephyr${path}`), token),
});
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function world(a) {
  const cats = (await a.get('/categories')).body.data;
  const cat = (kind, name) => cats.find((c) => c.kind === kind && c.name === name).id;
  const civil = (await a.post('/projects', { name: 'Villas', service_type: 'civil_construction', status: 'active', contract_value: 1000000 })).body.data;
  const interior = (await a.post('/projects', { name: 'Flat', service_type: 'interior_design', status: 'active' })).body.data;
  const property = (await a.post('/properties', { name: 'XYZ Complex', purchase_cost: 5000000 })).body.data;
  await a.post(`/properties/${property.id}/units`, { name: 'Shop 1' });
  const unit = (await a.get(`/properties/${property.id}`)).body.data.units[0];
  const client = (await a.post('/parties', { name: 'Client One', kind: 'client' })).body.data;
  const vendor = (await a.post('/parties', { name: 'Vendor One', kind: 'vendor' })).body.data;
  const entry = (body) => a.post('/ledger', { entry_date: day(-1), status: 'actual', ...body });
  return { cat, civil, interior, property, unit, client, vendor, entry };
}

describe('zephyr ledger dimensions (R7)', () => {
  test('entries carry service, property and unit; a project lends its service; bad links are refused', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const w = await world(a);
    const onProject = await w.entry({ type: 'expense', category_id: w.cat('expense', 'Materials'), project_id: w.civil.id, amount: 1000 });
    expect(onProject.body.data).toMatchObject({ service_type: 'civil_construction', property_id: null });
    const onProperty = await w.entry({ type: 'expense', category_id: w.cat('expense', 'Office'), property_id: w.property.id, unit_id: w.unit.id, amount: 2000, description: 'Repairs' });
    expect(onProperty.status).toBe(201);
    expect(onProperty.body.data).toMatchObject({ property_id: w.property.id, unit_id: w.unit.id });
    expect((await w.entry({ type: 'expense', category_id: w.cat('expense', 'Office'), unit_id: w.unit.id, amount: 1 })).status).toBe(422);
    expect((await w.entry({ type: 'expense', category_id: w.cat('expense', 'Office'), property_id: '3f1d8c74-3c1b-4c0e-9a55-0b8f9a4d9f11', amount: 1 })).status).toBe(422);
    const other = (await a.post('/properties', { name: 'Other' })).body.data;
    expect((await w.entry({ type: 'expense', category_id: w.cat('expense', 'Office'), property_id: other.id, unit_id: w.unit.id, amount: 1 })).status).toBe(422);
    expect((await w.entry({ type: 'expense', category_id: w.cat('expense', 'Office'), service_type: 'banking', amount: 1 })).status).toBe(422);

    expect((await a.get(`/ledger?property_id=${w.property.id}`)).body.data).toHaveLength(1);
    expect((await a.get('/ledger?service_type=civil_construction')).body.data).toHaveLength(1);
    expect((await a.get(`/ledger?unit_id=${w.unit.id}`)).body.data).toHaveLength(1);
    // a property filter is not a project filter
    expect((await a.get(`/ledger?project_id=${w.civil.id}&property_id=${w.property.id}`)).body.data).toHaveLength(0);
  });

  test('P&L by service, property and client / vendor; filters; appreciation stays outside the P&L', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const w = await world(a);
    await w.entry({ type: 'revenue', category_id: w.cat('revenue', 'Project billing'), project_id: w.civil.id, party_id: w.client.id, amount: 500000 });
    await w.entry({ type: 'expense', category_id: w.cat('expense', 'Materials'), project_id: w.civil.id, party_id: w.vendor.id, amount: 300000 });
    await w.entry({ type: 'revenue', category_id: w.cat('revenue', 'Project billing'), project_id: w.interior.id, amount: 100000 });
    await w.entry({ type: 'revenue', category_id: w.cat('revenue', 'Rental income'), property_id: w.property.id, service_type: 'property_management', amount: 60000 });
    await w.entry({ type: 'expense', category_id: w.cat('expense', 'Office'), property_id: w.property.id, service_type: 'property_management', amount: 10000 });
    await a.post(`/properties/${w.property.id}/valuations`, { value: 9000000, as_of: day(-1) });

    const o = (await a.get('/overview?preset=t12')).body.data;
    expect(o.summary).toMatchObject({ revenue: 660000, expense: 310000, profit: 350000 });
    const svc = Object.fromEntries(o.by_service.map((r) => [r.name, r]));
    expect(svc['Civil Construction']).toMatchObject({ revenue: 500000, expense: 300000, profit: 200000 });
    expect(svc['Interior Design']).toMatchObject({ revenue: 100000, expense: 0 });
    expect(svc['Property Management']).toMatchObject({ revenue: 60000, expense: 10000, profit: 50000 });
    expect(o.by_property.find((r) => r.name === 'ZP-001 XYZ Complex')).toMatchObject({ revenue: 60000, expense: 10000, profit: 50000 });
    expect(o.by_party.find((r) => r.name === 'Client One').revenue).toBe(500000);
    // the unrealized figure sits next to the P&L, not inside it
    expect(o.unrealized).toMatchObject({ valuation: 9000000, total_invested: 5000000, appreciation: 4000000 });

    const civil = (await a.get('/overview?preset=t12&service_type=civil_construction')).body.data;
    expect(civil.summary).toMatchObject({ revenue: 500000, expense: 300000, profit: 200000 });
    expect(civil.unrealized).toBeNull();
    const prop = (await a.get(`/overview?preset=t12&property_id=${w.property.id}`)).body.data;
    expect(prop.summary).toMatchObject({ revenue: 60000, expense: 10000 });
    expect((await a.get(`/overview?preset=t12&party_id=${w.vendor.id}`)).body.data.summary).toMatchObject({ revenue: 0, expense: 300000 });

    // statement by service / property, including the Excel download
    const st = (await a.get('/financials/statement?group=service')).body.data;
    expect(st.rows.map((r) => r.name)).toEqual(expect.arrayContaining(['Civil Construction', 'Property Management']));
    expect(st.totals.revenue).toBe(660000);
    const stp = (await a.get('/financials/statement?group=property')).body.data;
    expect(stp.rows.find((r) => r.name.includes('XYZ'))).toMatchObject({ revenue: 60000 });
    const xlsx = await authed(request(app).get('/api/v1/zephyr/financials/statement?group=service&format=xlsx'), token);
    expect(xlsx.status).toBe(200);
  });

  test('a manager sees the P&L without property finance', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const a = api(token);
    const w = await world(a);
    await w.entry({ type: 'expense', category_id: w.cat('expense', 'Materials'), project_id: w.civil.id, amount: 1000 });
    const o = (await api(manager.token).get('/overview?preset=t12')).body.data;
    expect(o.by_property).toEqual([]);
    expect(o.unrealized).toBeNull();
    expect(o.summary.salaries).toBeNull();
  });
});

describe('zephyr period lock (R7)', () => {
  test('a closed month refuses entries, edits, deletes and imports; rent receipts are system entries', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const w = await world(a);
    const e = await w.entry({ type: 'expense', category_id: w.cat('expense', 'Materials'), project_id: w.civil.id, amount: 1000, entry_date: day(-45) });
    expect(e.status).toBe(201);
    await prisma.zxPeriodClose.create({ data: { org_id: org.id, month: day(-45).slice(0, 7), status: 'closed', closed_at: new Date() } });
    expect((await w.entry({ type: 'expense', category_id: w.cat('expense', 'Materials'), amount: 5, entry_date: day(-45) })).status).toBe(409);
    expect((await a.patch(`/ledger/${e.body.data.id}`, { amount: 5 })).status).toBe(409);
    expect((await a.patch(`/ledger/${e.body.data.id}`, { entry_date: day(-1) })).status).toBe(409);
    expect((await a.del(`/ledger/${e.body.data.id}`)).status).toBe(409);
    // a planned entry in the closed month is only a plan, so it is allowed
    expect((await w.entry({ type: 'expense', category_id: w.cat('expense', 'Materials'), amount: 5, entry_date: day(-45), status: 'planned' })).status).toBe(201);
    const imp = await a.post('/ledger/import', { rows: [{ date: day(-45), type: 'expense', category: 'Materials', amount: '10' }] });
    expect(imp.body.data.created).toBe(0);
    expect(imp.body.data.skipped[0].reason).toMatch(/closed/);
    await prisma.zxPeriodClose.updateMany({ where: { org_id: org.id }, data: { status: 'open' } });
    expect((await a.patch(`/ledger/${e.body.data.id}`, { amount: 5 })).status).toBe(200);

    // an entry made by a rent receipt can only be changed through the rent
    const tenant = (await a.post('/tenants', { name: 'T' })).body.data;
    await a.post('/leases', { tenant_id: tenant.id, unit_id: w.unit.id, start_date: `${day(0).slice(0, 7)}-01`, monthly_rent: 100 });
    const due = (await a.get('/rent/dues')).body.data[0];
    await a.post(`/rent/dues/${due.id}/payments`, { amount: 100, paid_on: day(0), method: 'cash' });
    const sys = await prisma.zxLedgerEntry.findFirst({ where: { source_type: 'rent_payment' } });
    expect((await a.patch(`/ledger/${sys.id}`, { amount: 1 })).status).toBe(409);
    expect((await a.del(`/ledger/${sys.id}`)).status).toBe(409);
  });
});

describe('zephyr group expenses (R7)', () => {
  test('one shared cost splits across projects and properties; the parts add up; delete voids all', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const w = await world(a);
    const base = { entry_date: day(-1), category_id: w.cat('expense', 'Site overheads'), party_id: w.vendor.id, description: 'Shared security' };
    const equal = await a.post('/ledger/group-expenses', { ...base, amount: 100000, allocations: [{ project_id: w.civil.id, share: 1 }, { project_id: w.interior.id, share: 1 }, { property_id: w.property.id, share: 1 }] });
    expect(equal.status).toBe(201);
    const parts = equal.body.data.entries.map((x) => x.amount);
    expect(parts).toEqual([33333.33, 33333.33, 33333.34]);
    expect(parts.reduce((x, y) => x + y, 0)).toBeCloseTo(100000, 2);
    expect(equal.body.data.entries.every((x) => x.source_type === 'group_expense')).toBe(true);
    expect(equal.body.data.entries[0].service_type).toBe('civil_construction');

    const pct = await a.post('/ledger/group-expenses', { ...base, amount: 50000, basis: 'percent', allocations: [{ project_id: w.civil.id, share: 70 }, { property_id: w.property.id, share: 30 }] });
    expect(pct.body.data.entries.map((x) => x.amount)).toEqual([35000, 15000]);
    expect((await a.post('/ledger/group-expenses', { ...base, amount: 50000, basis: 'percent', allocations: [{ project_id: w.civil.id, share: 70 }, { property_id: w.property.id, share: 20 }] })).status).toBe(422);
    const fixed = await a.post('/ledger/group-expenses', { ...base, amount: 1000, basis: 'amount', allocations: [{ project_id: w.civil.id, share: 400 }, { project_id: w.interior.id, share: 600 }] });
    expect(fixed.body.data.entries.map((x) => x.amount)).toEqual([400, 600]);
    expect((await a.post('/ledger/group-expenses', { ...base, amount: 1000, basis: 'amount', allocations: [{ project_id: w.civil.id, share: 400 }, { project_id: w.interior.id, share: 500 }] })).status).toBe(422);
    expect((await a.post('/ledger/group-expenses', { ...base, amount: 10, allocations: [{ project_id: w.civil.id, share: 1 }] })).status).toBe(422);
    expect((await a.post('/ledger/group-expenses', { ...base, amount: 10, allocations: [{ share: 1 }, { project_id: w.civil.id, share: 1 }] })).status).toBe(422);

    expect((await a.get('/overview?preset=t12')).body.data.summary.expense).toBe(151000);
    const groups = (await a.get('/ledger/group-expenses')).body.data;
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.group_id === equal.body.data.group_id)).toMatchObject({ amount: 100000, parts: expect.any(Array) });

    expect((await a.del(`/ledger/group-expenses/${equal.body.data.group_id}`)).status).toBe(200);
    expect((await a.get('/overview?preset=t12')).body.data.summary.expense).toBe(51000);
    expect((await a.del(`/ledger/group-expenses/${equal.body.data.group_id}`)).status).toBe(404);
    expect((await a.get('/audit?entity=ledger')).body.data.map((r) => r.action)).toEqual(expect.arrayContaining(['group_expense', 'group_expense_delete']));
  });

  test('group expenses are admin work, locked by a closed month, and per company', async () => {
    const x = await setupZephyr('zephyr-x');
    const y = await setupZephyr('zephyr-y');
    const manager = await addMember(x.org, 'manager');
    const a = api(x.token);
    const w = await world(a);
    const body = { entry_date: day(-1), category_id: w.cat('expense', 'Office'), amount: 100, allocations: [{ project_id: w.civil.id, share: 1 }, { project_id: w.interior.id, share: 1 }] };
    expect((await api(manager.token).post('/ledger/group-expenses', body)).status).toBe(403);
    expect((await api(y.token).post('/ledger/group-expenses', body)).status).toBe(422);
    const made = await a.post('/ledger/group-expenses', body);
    expect((await api(y.token).del(`/ledger/group-expenses/${made.body.data.group_id}`)).status).toBe(404);
    await prisma.zxPeriodClose.create({ data: { org_id: x.org.id, month: day(-1).slice(0, 7), status: 'closed', closed_at: new Date() } });
    expect((await a.post('/ledger/group-expenses', body)).status).toBe(409);
    expect((await a.del(`/ledger/group-expenses/${made.body.data.group_id}`)).status).toBe(409);
  });
});

describe('zephyr consulting commission (R6)', () => {
  test('the commission is computed, then booked once as consulting revenue', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const client = (await a.post('/parties', { name: 'Buyer', kind: 'client' })).body.data;
    const p = (await a.post('/projects', {
      name: 'Mumbai flat', service_type: 'real_estate_consulting', party_id: client.id,
      details: { property_value: 30000000, commission_pct: 1, deal_date: day(-10), closing_date: day(-3) },
    })).body.data;
    expect(p.details.commission_amount).toBe(300000);
    const booked = await a.post(`/projects/${p.id}/book-commission`);
    expect(booked.status).toBe(201);
    const row = await prisma.zxLedgerEntry.findFirst({ where: { source_type: 'consulting_commission' }, include: { category: true } });
    expect(row).toMatchObject({ type: 'revenue', service_type: 'real_estate_consulting', project_id: p.id });
    expect(Number(row.amount)).toBe(300000);
    expect(row.category.name).toBe('Consulting commission');
    expect(row.entry_date.toISOString().slice(0, 10)).toBe(day(-3));
    expect((await a.post(`/projects/${p.id}/book-commission`)).status).toBe(409);
    expect((await a.get('/overview?preset=t12')).body.data.by_service.find((s) => s.name === 'Real Estate Consulting').revenue).toBe(300000);
    expect((await a.patch(`/ledger/${row.id}`, { amount: 1 })).status).toBe(409);

    // not before the details are filled, not for other services, not into a closed month
    const empty = (await a.post('/projects', { name: 'No numbers', service_type: 'real_estate_consulting' })).body.data;
    expect((await a.post(`/projects/${empty.id}/book-commission`)).status).toBe(422);
    const civil = (await a.post('/projects', { name: 'Civil', service_type: 'civil_construction' })).body.data;
    expect((await a.post(`/projects/${civil.id}/book-commission`)).status).toBe(409);
    const later = (await a.post('/projects', { name: 'Later', service_type: 'real_estate_consulting', details: { property_value: 1000000, commission_pct: 2, closing_date: day(-60) } })).body.data;
    await prisma.zxPeriodClose.create({ data: { org_id: org.id, month: day(-60).slice(0, 7), status: 'closed', closed_at: new Date() } });
    expect((await a.post(`/projects/${later.id}/book-commission`)).status).toBe(409);
  });
});
