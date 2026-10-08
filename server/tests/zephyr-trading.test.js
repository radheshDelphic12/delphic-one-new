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

// Invested: 10,000,000 + 100,000 + 4,900,000 = 15,000,000
const PURCHASE = { name: 'Trading Plot', property_type: 'plot', purchase_date: day(-400), purchase_cost: 10000000, brokerage: 100000, construction_cost: 4900000 };

describe('zephyr property trading (R5)', () => {
  test('selling a whole property books realized revenue, cost and selling costs; appreciation stays unrealized until then', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const p = (await a.post('/properties', PURCHASE)).body.data;
    await a.post(`/properties/${p.id}/valuations`, { value: 20000000, as_of: day(-2) });
    // unrealized appreciation is not in the P&L
    expect((await a.get('/overview?preset=t12')).body.data.summary).toMatchObject({ revenue: 0, expense: 0, profit: 0 });
    expect((await a.get(`/properties/${p.id}`)).body.data).toMatchObject({ appreciation: 5000000, appreciation_pct: 33.33 });

    const buyer = (await a.post('/parties', { name: 'Buyer Co', kind: 'client' })).body.data;
    const sold = await a.post(`/properties/${p.id}/sales`, { sale_value: 20000000, sale_date: day(-1), selling_costs: 200000, buyer_party_id: buyer.id, notes: 'Cash deal' });
    expect(sold.status).toBe(201);
    expect(sold.body.data).toMatchObject({ sale_value: 20000000, cost_basis: 15000000, selling_costs: 200000, realized_profit: 4800000, holding_days: 399 });

    const entries = await prisma.zxLedgerEntry.findMany({ where: { source_type: 'property_sale' }, include: { category: true }, orderBy: { amount: 'desc' } });
    expect(entries.map((e) => [e.category.name, e.type, Number(e.amount)])).toEqual([
      ['Property sale', 'revenue', 20000000],
      ['Cost of property sold', 'expense', 15000000],
      ['Selling costs', 'expense', 200000],
    ]);
    expect(entries.every((e) => e.service_type === 'property_trading' && e.property_id === p.id)).toBe(true);
    expect((await a.get('/overview?preset=t12')).body.data.summary).toMatchObject({ revenue: 20000000, expense: 15200000, profit: 4800000 });
    expect((await a.get(`/properties/${p.id}`)).body.data.status).toBe('sold');
    expect((await a.post(`/properties/${p.id}/sales`, { sale_value: 1, sale_date: day(-1) })).status).toBe(409);

    const list = (await a.get('/sales')).body.data;
    expect(list.count).toBe(1);
    expect(list.totals).toMatchObject({ sale_value: 20000000, cost_basis: 15000000, realized_profit: 4800000 });
    expect(list.data[0]).toMatchObject({ property: { name: 'Trading Plot' }, buyer: { name: 'Buyer Co' } });
    expect((await a.get('/audit?entity=property_sale')).body.data.map((r) => r.action)).toEqual(['create']);
  });

  test('unit sales use the unit cost basis; the last unit sold sells the property', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const p = (await a.post('/properties', { ...PURCHASE, property_type: 'shops' })).body.data;
    for (const [name, area] of [['Shop 1', 100], ['Shop 2', 300]]) await a.post(`/properties/${p.id}/units`, { name, area_value: area });
    await a.post(`/properties/${p.id}/units`, { name: 'Shop 3', area_value: 600, allocated_cost: 9000000 });
    const units = (await a.get(`/properties/${p.id}`)).body.data.units;
    const unit = (name) => units.find((u) => u.name === name);

    // Shop 1: allocated by area share of 15,000,000 -> 100 / 1000 -> 1,500,000
    const one = await a.post(`/properties/${p.id}/sales`, { unit_id: unit('Shop 1').id, sale_value: 2500000, sale_date: day(-3), selling_costs: 50000 });
    expect(one.body.data).toMatchObject({ cost_basis: 1500000, realized_profit: 950000 });
    expect((await a.get(`/properties/${p.id}`)).body.data.status).toBe('active');
    expect((await a.post(`/properties/${p.id}/sales`, { unit_id: unit('Shop 1').id, sale_value: 1, sale_date: day(-1) })).status).toBe(409);
    // Shop 3 carries its own allocated cost
    const three = await a.post(`/properties/${p.id}/sales`, { unit_id: unit('Shop 3').id, sale_value: 8000000, sale_date: day(-2) });
    expect(three.body.data).toMatchObject({ cost_basis: 9000000, realized_profit: -1000000 });
    const last = await a.post(`/properties/${p.id}/sales`, { unit_id: unit('Shop 2').id, sale_value: 4500000, sale_date: day(-1) });
    expect(last.status).toBe(201);
    const after = (await a.get(`/properties/${p.id}`)).body.data;
    expect(after.status).toBe('sold');
    expect(after.units.every((u) => u.status === 'sold')).toBe(true);
    const events = after.events.filter((e) => e.kind === 'sale');
    expect(events).toHaveLength(3);
    expect((await a.get(`/sales?property_id=${p.id}`)).body.data.totals.sale_value).toBe(15000000);
  });

  test('rules: no future dates, no sale over an active lease, buyer must be a client, closed month, vendors', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const p = (await a.post('/properties', { ...PURCHASE, property_type: 'shops' })).body.data;
    await a.post(`/properties/${p.id}/units`, { name: 'Shop 1' });
    const unit = (await a.get(`/properties/${p.id}`)).body.data.units[0];
    const tenant = (await a.post('/tenants', { name: 'Tenant' })).body.data;
    await a.post('/leases', { tenant_id: tenant.id, unit_id: unit.id, start_date: day(-10), monthly_rent: 1000 });
    expect((await a.post(`/properties/${p.id}/sales`, { sale_value: 1000, sale_date: day(2) })).status).toBe(422);
    expect((await a.post(`/properties/${p.id}/sales`, { sale_value: 1000, sale_date: day(-1) })).status).toBe(409);
    expect((await a.post(`/properties/${p.id}/sales`, { unit_id: unit.id, sale_value: 1000, sale_date: day(-1) })).status).toBe(409);
    const lease = (await a.get('/leases?status=active')).body.data[0];
    await a.post(`/leases/${lease.id}/end`, { ended_on: day(-1) });
    const vendor = (await a.post('/parties', { name: 'Vendor Only', kind: 'vendor' })).body.data;
    expect((await a.post(`/properties/${p.id}/sales`, { unit_id: unit.id, sale_value: 1000, sale_date: day(-1), buyer_party_id: vendor.id })).status).toBe(422);
    expect((await a.post(`/properties/${p.id}/sales`, { unit_id: unit.id, sale_value: 1000, sale_date: day(-500) })).status).toBe(422);
    await prisma.zxPeriodClose.create({ data: { org_id: org.id, month: day(-1).slice(0, 7), status: 'closed', closed_at: new Date() } });
    expect((await a.post(`/properties/${p.id}/sales`, { unit_id: unit.id, sale_value: 1000, sale_date: day(-1) })).status).toBe(409);
  });

  test('an admin can reverse a sale: statuses return and the ledger rows are voided', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const p = (await a.post('/properties', PURCHASE)).body.data;
    const sale = (await a.post(`/properties/${p.id}/sales`, { sale_value: 18000000, sale_date: day(-1) })).body.data;
    const reversed = await a.del(`/properties/${p.id}/sales/${sale.id}?reason=Deal%20fell%20through`);
    expect(reversed.status).toBe(200);
    expect(await prisma.zxLedgerEntry.count({ where: { source_type: 'property_sale', deleted_at: null } })).toBe(0);
    expect((await a.get(`/properties/${p.id}`)).body.data.status).toBe('held');
    expect((await a.get('/overview?preset=t12')).body.data.summary).toMatchObject({ revenue: 0, profit: 0 });
    expect((await a.get('/sales')).body.data.count).toBe(0);
    expect((await a.get('/audit?entity=property_sale')).body.data.map((r) => r.action)).toEqual(expect.arrayContaining(['create', 'delete']));
    // and it can be sold again
    expect((await a.post(`/properties/${p.id}/sales`, { sale_value: 17000000, sale_date: day(-1) })).status).toBe(201);
  });

  test('trading is admin only; another company sees nothing', async () => {
    const x = await setupZephyr('zephyr-x');
    const y = await setupZephyr('zephyr-y');
    const manager = await addMember(x.org, 'manager');
    const p = (await api(x.token).post('/properties', PURCHASE)).body.data;
    expect((await api(manager.token).get('/sales')).status).toBe(403);
    expect((await api(manager.token).post(`/properties/${p.id}/sales`, { sale_value: 1, sale_date: day(-1) })).status).toBe(403);
    expect((await api(y.token).post(`/properties/${p.id}/sales`, { sale_value: 1, sale_date: day(-1) })).status).toBe(404);
    expect((await api(y.token).get('/sales')).body.data.count).toBe(0);
  });
});
