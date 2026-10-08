const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const calc = require('../src/modules/zephyr/property.calc');

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

describe('property formulas', () => {
  test('total investment, appreciation, trading profit, financing, cash flow and commission', () => {
    const p = { purchase_cost: 10000000, brokerage: 100000, documentation_cost: 50000, registration_cost: 150000, construction_cost: 5000000, renovation_cost: 0, other_cost: 0 };
    expect(calc.totalInvestment(p)).toBe(15300000);
    expect(calc.totalInvestment({ purchase_cost: '10000000', construction_cost: '5000000' })).toBe(15000000);
    expect(calc.appreciation(15000000, 20000000)).toEqual({ amount: 5000000, pct: 33.33 });
    expect(calc.appreciation(15000000, null)).toEqual({ amount: null, pct: null });
    expect(calc.appreciation(0, 100)).toEqual({ amount: 100, pct: null });
    expect(calc.appreciation(20000000, 15000000).amount).toBe(-5000000);
    expect(calc.tradingProfit(20000000, 15000000, 200000)).toBe(4800000);
    expect(calc.monthlyFinancing({ emi_amount: 50000, emi_frequency: 'monthly', status: 'active' })).toBe(50000);
    expect(calc.monthlyFinancing({ emi_amount: 150000, emi_frequency: 'quarterly', status: 'active' })).toBe(50000);
    expect(calc.monthlyFinancing({ emi_amount: 600000, emi_frequency: 'yearly', status: 'active' })).toBe(50000);
    expect(calc.monthlyFinancing({ emi_amount: 50000, emi_frequency: 'monthly', status: 'closed' })).toBe(0);
    expect(calc.cashFlow({ income: 60000, expenses: 0, financing: 50000 })).toEqual({ income: 60000, expenses: 0, financing: 50000, net: 10000, status: 'positive' });
    expect(calc.cashFlow({ income: 40000, expenses: 5000, financing: 50000 }).status).toBe('negative');
    expect(calc.commission(30000000, 1)).toBe(300000);
    expect(calc.commission(null, 1)).toBeNull();
  });

  test('unit cost basis: own allocation, else by area, else equal shares', () => {
    const units = [{ area_value: 100 }, { area_value: 300 }];
    expect(calc.unitCostBasis({ area_value: 100 }, units, 400)).toBe(100);
    expect(calc.unitCostBasis({ area_value: 100, allocated_cost: 55 }, units, 400)).toBe(55);
    expect(calc.unitCostBasis({ area_value: null }, [{}, {}, {}, {}], 400)).toBe(100);
  });
});

describe('zephyr properties (R3)', () => {
  test('create, derive investment and appreciation, edit, and keep a timeline', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const res = await a.post('/properties', {
      name: 'XYZ Complex', property_type: 'commercial_complex', city: 'Indore', state: 'MP', area_value: 12000, current_use: 'Rental', purchase_date: day(-300),
      purchase_cost: 10000000, brokerage: 100000, registration_cost: 150000, construction_cost: 5000000,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: 'ZP-001', status: 'active', total_invested: 15250000, valuation: null, appreciation: null });
    const id = res.body.data.id;
    expect((await a.post('/properties', { name: 'Plot 7', property_type: 'plot' })).body.data.code).toBe('ZP-002');

    const valued = await a.post(`/properties/${id}/valuations`, { value: 20000000, as_of: day(-5), notes: 'Broker opinion' });
    expect(valued.status).toBe(201);
    expect(valued.body.data).toMatchObject({ valuation: 20000000, appreciation: 4750000, appreciation_pct: 31.15 });
    await a.post(`/properties/${id}/valuations`, { value: 22000000, as_of: day(-1) });
    const latest = (await a.get(`/properties/${id}`)).body.data;
    expect(latest).toMatchObject({ valuation: 22000000, appreciation: 6750000 });
    expect(latest.valuations).toHaveLength(2);
    // an older valuation entered later does not replace the newest one
    await a.post(`/properties/${id}/valuations`, { value: 18000000, as_of: day(-100) });
    expect((await a.get(`/properties/${id}`)).body.data.valuation).toBe(22000000);
    expect((await a.post(`/properties/${id}/valuations`, { value: 1, as_of: day(3) })).status).toBe(422);

    const edited = await a.patch(`/properties/${id}`, { renovation_cost: 500000, status: 'under_renovation' });
    expect(edited.body.data).toMatchObject({ total_invested: 15750000, status: 'under_renovation', appreciation: 6250000 });
    const kinds = edited.body.data.events.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['purchase', 'valuation', 'status']));

    const note = await a.post(`/properties/${id}/events`, { kind: 'construction', event_date: day(-20), title: 'Construction completed', amount: 5000000 });
    expect(note.body.data.events.some((e) => e.title === 'Construction completed')).toBe(true);
    const audit = (await a.get('/audit?entity=property')).body.data.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['create', 'update_costs']));
  });

  test('valuation never touches the ledger or P&L', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const p = (await a.post('/properties', { name: 'Hold', purchase_cost: 1000000 })).body.data;
    await a.post(`/properties/${p.id}/valuations`, { value: 3000000, as_of: day(-1) });
    expect(await prisma.zxLedgerEntry.count()).toBe(0);
    const overview = (await a.get('/overview?preset=t12')).body.data;
    expect(overview.summary).toMatchObject({ revenue: 0, expense: 0, profit: 0 });
  });

  test('units: duplicates refused, status rules, sold and rented only via their flows', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const p = (await a.post('/properties', { name: 'Shops', property_type: 'shops' })).body.data;
    const add = (body) => a.post(`/properties/${p.id}/units`, body);
    expect((await add({ name: 'Shop 1', floor: 'Ground', area_value: 400 })).status).toBe(201);
    expect((await add({ name: 'shop 1', floor: 'Ground' })).status).toBe(409);
    expect((await add({ name: 'Shop 1', floor: 'First' })).status).toBe(201);
    expect((await add({ name: 'Shop 2', status: 'sold' })).status).toBe(409);
    const detail = (await a.get(`/properties/${p.id}`)).body.data;
    expect(detail.units).toHaveLength(2);
    const unit = detail.units[0];
    expect((await a.patch(`/properties/${p.id}/units/${unit.id}`, { status: 'rented' })).status).toBe(409);
    expect((await a.patch(`/properties/${p.id}/units/${unit.id}`, { status: 'under_renovation', notes: 'Painting' })).body.data.units.find((u) => u.id === unit.id)).toMatchObject({ status: 'under_renovation', notes: 'Painting' });
    expect((await a.del(`/properties/${p.id}/units/${unit.id}`)).body.data.units).toHaveLength(1);
    const list = (await a.get('/properties')).body.data;
    expect(list[0].units).toMatchObject({ total: 1, available: 1 });
  });

  test('loans track monthly financing; valuation and costs are finance-only', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const a = api(token);
    const m = api(manager.token);
    const p = (await a.post('/properties', { name: 'Financed', purchase_cost: 5000000 })).body.data;
    const loan = await a.post(`/properties/${p.id}/loans`, { lender: 'SBI', loan_amount: 3000000, outstanding_amount: 2800000, emi_amount: 150000, emi_frequency: 'quarterly', interest_rate: 8.5, start_date: day(-200), end_date: day(1000) });
    expect(loan.status).toBe(201);
    expect(loan.body.data).toMatchObject({ outstanding_loan: 2800000, monthly_financing: 50000 });
    expect((await a.post(`/properties/${p.id}/loans`, { lender: 'x', start_date: day(5), end_date: day(1) })).status).toBe(422);
    const loanId = loan.body.data.loans[0].id;
    expect((await a.patch(`/properties/${p.id}/loans/${loanId}`, { status: 'closed' })).body.data).toMatchObject({ outstanding_loan: 0, monthly_financing: 0 });
    const summary = (await a.get('/properties/summary')).body.data;
    expect(summary).toMatchObject({ properties: 1, total_invested: 5000000, monthly_emi: 0 });

    // a manager manages the property but sees no money
    const seen = (await m.get(`/properties/${p.id}`)).body.data;
    expect(seen.name).toBe('Financed');
    for (const key of ['purchase_cost', 'total_invested', 'valuation', 'loans', 'valuations', 'cash_flow']) expect(seen).not.toHaveProperty(key);
    expect((await m.get('/properties/summary')).body.data).not.toHaveProperty('total_invested');
    expect((await m.post('/properties', { name: 'By manager', purchase_cost: 5 })).status).toBe(403);
    expect((await m.post('/properties', { name: 'By manager' })).status).toBe(201);
    expect((await m.patch(`/properties/${p.id}`, { construction_cost: 1 })).status).toBe(403);
    expect((await m.patch(`/properties/${p.id}`, { current_use: 'Rental' })).status).toBe(200);
    expect((await m.post(`/properties/${p.id}/valuations`, { value: 1, as_of: day(-1) })).status).toBe(403);
    expect((await m.post(`/properties/${p.id}/loans`, { lender: 'x' })).status).toBe(403);
    expect((await m.del(`/properties/${p.id}`)).status).toBe(403);
  });

  test('filters: type, city, status, current use, valuation range, tenant and search', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const p1 = (await a.post('/properties', { name: 'Alpha', property_type: 'house', city: 'Pune', current_use: 'Self use' })).body.data;
    await a.post('/properties', { name: 'Beta', property_type: 'plot', city: 'Indore', status: 'held' });
    await a.post(`/properties/${p1.id}/valuations`, { value: 5000000, as_of: day(-1) });
    expect((await a.get('/properties?property_type=plot')).body.data.map((p) => p.name)).toEqual(['Beta']);
    expect((await a.get('/properties?city=pun')).body.data.map((p) => p.name)).toEqual(['Alpha']);
    expect((await a.get('/properties?status=held')).body.data.map((p) => p.name)).toEqual(['Beta']);
    expect((await a.get('/properties?current_use=self')).body.data).toHaveLength(1);
    expect((await a.get('/properties?min_valuation=4000000')).body.data.map((p) => p.name)).toEqual(['Alpha']);
    expect((await a.get('/properties?max_valuation=100')).body.data).toHaveLength(0);
    expect((await a.get('/properties?q=zp-002')).body.data.map((p) => p.name)).toEqual(['Beta']);
  });

  test('another company sees and changes nothing; staff have no access', async () => {
    const x = await setupZephyr('zephyr-x');
    const y = await setupZephyr('zephyr-y');
    const staff = await addMember(x.org, 'staff');
    const p = (await api(x.token).post('/properties', { name: 'Only X' })).body.data;
    expect((await api(y.token).get('/properties')).body.data).toHaveLength(0);
    expect((await api(y.token).get(`/properties/${p.id}`)).status).toBe(404);
    expect((await api(y.token).patch(`/properties/${p.id}`, { name: 'hack' })).status).toBe(404);
    expect((await api(y.token).post(`/properties/${p.id}/units`, { name: 'u' })).status).toBe(404);
    expect((await api(y.token).del(`/properties/${p.id}`)).status).toBe(404);
    expect((await api(staff.token).get('/properties')).status).toBe(403);
    // the property is a valid document owner for its own company only
    const up = (token) => authed(request(app).post('/api/v1/zephyr/documents'), token).field('owner_type', 'property').field('owner_id', p.id).field('title', 'Sale deed').field('category', 'sale_deed').attach('file', Buffer.from('%PDF-1.4 x'), 'deed.pdf');
    expect((await up(x.token)).status).toBe(201);
    expect((await up(y.token)).status).toBe(404);
  });
});
