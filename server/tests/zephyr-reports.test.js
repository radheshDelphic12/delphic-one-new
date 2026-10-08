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
});
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// A small but complete business: all five services have something in them.
async function business(a) {
  const cats = (await a.get('/categories')).body.data;
  const cat = (kind, name) => cats.find((c) => c.kind === kind && c.name === name).id;
  const entry = (b) => a.post('/ledger', { entry_date: day(-2), status: 'actual', ...b });

  const civil = (await a.post('/projects', { name: 'Villas', service_type: 'civil_construction', status: 'active', contract_value: 10000000, budget: 8000000 })).body.data;
  await entry({ type: 'revenue', category_id: cat('revenue', 'Project billing'), project_id: civil.id, amount: 4000000 });
  await entry({ type: 'expense', category_id: cat('expense', 'Materials'), project_id: civil.id, amount: 3000000 });
  const interior = (await a.post('/projects', { name: 'Flat', service_type: 'interior_design', status: 'completed', contract_value: 500000 })).body.data;
  await entry({ type: 'revenue', category_id: cat('revenue', 'Project billing'), project_id: interior.id, amount: 500000 });

  const property = (await a.post('/properties', { name: 'XYZ Complex', purchase_cost: 8000000, purchase_date: day(-200) })).body.data;
  for (const name of ['Shop 1', 'Shop 2', 'Shop 3', 'Shop 4']) await a.post(`/properties/${property.id}/units`, { name });
  const units = (await a.get(`/properties/${property.id}`)).body.data.units;
  const tenant = (await a.post('/tenants', { name: 'Tenant A' })).body.data;
  await a.post('/leases', { tenant_id: tenant.id, unit_id: units[0].id, start_date: `${day(0).slice(0, 7)}-01`, monthly_rent: 60000 });
  await a.post('/leases', { tenant_id: tenant.id, unit_id: units[1].id, start_date: `${day(0).slice(0, 7)}-01`, monthly_rent: 40000 });
  for (const due of (await a.get('/rent/dues')).body.data) await a.post(`/rent/dues/${due.id}/payments`, { amount: due.amount, paid_on: day(0), method: 'upi' });
  await entry({ type: 'expense', category_id: cat('expense', 'Office'), property_id: property.id, service_type: 'property_management', amount: 15000 });
  await a.post(`/properties/${property.id}/loans`, { lender: 'SBI', loan_amount: 3000000, outstanding_amount: 2900000, emi_amount: 30000 });

  const trading = (await a.post('/properties', { name: 'Plot 9', purchase_cost: 2000000, purchase_date: day(-120) })).body.data;
  await a.post(`/properties/${trading.id}/sales`, { sale_value: 2600000, sale_date: day(-3), selling_costs: 20000 });

  const buyer = (await a.post('/parties', { name: 'Buyer', kind: 'client' })).body.data;
  const consult = (await a.post('/projects', { name: 'Mumbai flat', service_type: 'real_estate_consulting', party_id: buyer.id, status: 'completed', details: { property_value: 30000000, commission_pct: 1, closing_date: day(-4) } })).body.data;
  await a.post(`/projects/${consult.id}/book-commission`);
  await entry({ type: 'expense', category_id: cat('expense', 'Other expense'), project_id: consult.id, amount: 25000 });
  const lead = (await a.post('/leads', { name: 'Brokerage lead', service_type: 'real_estate_consulting' })).body.data;
  await a.post(`/leads/${lead.id}/stage`, { stage: 'won' });
  await a.post('/leads', { name: 'Another', service_type: 'real_estate_consulting' });
  return { civil, property, trading, consult };
}

describe('zephyr service-wise reports (R9)', () => {
  test('every service reports its own figures', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    await business(a);
    const res = await a.get('/reports/services?preset=fy');
    expect(res.status).toBe(200);
    const s = res.body.data.services;

    expect(s.civil_construction).toMatchObject({ label: 'Civil Construction', projects: 1, live: 1, contract_value: 10000000, revenue: 4000000, cost: 3000000, profit: 1000000, margin_pct: 25 });
    expect(s.interior_design).toMatchObject({ projects: 1, completed: 1, revenue: 500000, cost: 0, profit: 500000, margin_pct: 100 });
    const { from, to } = res.body.data.range;
    const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) + 1;
    expect(s.property_management).toMatchObject({ properties: 1, units: 4, occupied: 2, occupancy_pct: 50, rent_collected: 100000, expenses: 15000, financing: 30000 * months, cash_flow: 100000 - 15000 - 30000 * months });
    expect(s.property_trading).toMatchObject({ properties: 2, sales: 1, sold_value: 2600000, cost_basis: 2000000, selling_costs: 20000, realized_profit: 580000 });
    expect(s.property_trading.total_investment).toBe(10000000);
    expect(s.property_trading.avg_holding_days).toBe(117);
    expect(s.real_estate_consulting).toMatchObject({ leads: 2, won_leads: 1, projects: 1, closed_deals: 1, property_value: 30000000, avg_commission_pct: 1, revenue: 300000, expenses: 25000, profit: 275000 });
  });

  test('the P&L by service and the service report agree', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    await business(a);
    const o = (await a.get('/overview?preset=fy')).body.data;
    const r = (await a.get('/reports/services?preset=fy')).body.data.services;
    const row = (name) => o.by_service.find((x) => x.name === name);
    expect(row('Civil Construction').profit).toBe(r.civil_construction.profit);
    expect(row('Real Estate Consulting').profit).toBe(r.real_estate_consulting.profit);
    expect(row('Property Trading').profit).toBe(r.property_trading.realized_profit);
    // realized trading profit is in the P&L, unrealized appreciation is not
    expect(o.summary.profit).toBe(o.by_service.reduce((x, y) => x + y.profit, 0));
  });

  test('a manager gets no trading or property finance in the report', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    await business(api(token));
    const s = (await api(manager.token).get('/reports/services?preset=fy')).body.data.services;
    expect(s.property_trading).toBeUndefined();
    expect(s.property_management).not.toHaveProperty('cash_flow');
    expect(s.civil_construction.salaries).toBeNull();
    expect((await api((await addMember(org, 'staff')).token).get('/reports/services')).status).toBe(403);
  });
});

describe('zephyr dashboard (R9)', () => {
  test('the admin sees every block', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    await business(a);
    const d = (await a.get('/dashboard')).body.data;
    expect(d.leads).toMatchObject({ total: 2, won_value: 0 });
    expect(d.leads.by_service.real_estate_consulting).toMatchObject({ count: 2, won: 1 });
    expect(d.projects).toMatchObject({ total: 3, by_service: expect.any(Object) });
    expect(d.properties).toMatchObject({ properties: 2, units: 4, occupied: 2, monthly_emi: 30000 });
    expect(d.properties.total_invested).toBe(8000000);
    expect(d.rent).toMatchObject({ total_due: 100000, collected: 100000, pending: 0, overdue: 0 });
    expect(d.finance.fy).toMatchObject({ revenue: expect.any(Number) });
    expect(d.finance.by_service.length).toBeGreaterThanOrEqual(4);
    expect(d.tasks).toMatchObject({ pending: 0 });
  });

  test('each role gets only its own blocks', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const staff = await addMember(org, 'staff');
    const finance = await addMember(org, 'finance');
    await business(api(token));
    await api(token).post('/tasks', { title: 'Visit', person_id: staff.person.id });

    const m = (await api(manager.token).get('/dashboard')).body.data;
    expect(m.leads).not.toBeNull();
    expect(m.properties).not.toHaveProperty('total_invested');
    expect(m.finance.fy.salaries).toBeNull();
    expect(m.finance.by_property).toEqual([]);

    const s = (await api(staff.token).get('/dashboard')).body.data;
    expect(s.leads).toBeNull();
    expect(s.projects).toBeNull();
    expect(s.finance).toBeNull();
    expect(s.rent).toBeNull();
    expect(s.tasks).toMatchObject({ pending: 1 });

    const f = (await api(finance.token).get('/dashboard')).body.data;
    expect(f.leads).toBeNull();
    expect(f.projects).toBeNull();
    expect(f.properties.total_invested).toBe(8000000);
    expect(f.rent.collected).toBe(100000);
    expect(f.finance.by_property.length).toBeGreaterThan(0);
    expect(f.finance.fy.salaries).toBeNull();
  });

  test('another company has its own numbers', async () => {
    const x = await setupZephyr('zephyr-x');
    const y = await setupZephyr('zephyr-y');
    await business(api(x.token));
    const d = (await api(y.token).get('/dashboard')).body.data;
    expect(d.leads.total).toBe(0);
    expect(d.properties.properties).toBe(0);
    expect(d.finance.fy.revenue).toBe(0);
  });
});

describe('zephyr finance role (R9)', () => {
  test('finance books money and shared costs, sees property finance and rent, but not people, leads or settings', async () => {
    const { org, token } = await setupZephyr();
    const finance = await addMember(org, 'finance');
    const a = api(token);
    const f = api(finance.token);
    const w = await business(a);
    const cats = (await f.get('/categories')).body.data;
    expect(cats.length).toBeGreaterThan(0);
    const cat = (kind, name) => cats.find((c) => c.kind === kind && c.name === name).id;

    // full ledger (revenue and company-level), unlike a manager
    const rev = await f.post('/ledger', { entry_date: day(-1), type: 'revenue', category_id: cat('revenue', 'Other income'), amount: 1234 });
    expect(rev.status).toBe(201);
    expect((await f.get('/ledger?type=revenue')).body.data.length).toBeGreaterThan(0);
    const group = await f.post('/ledger/group-expenses', { entry_date: day(-1), category_id: cat('expense', 'Site overheads'), amount: 1000, allocations: [{ project_id: w.civil.id, share: 1 }, { property_id: w.property.id, share: 1 }] });
    expect(group.status).toBe(201);
    // property finance and rent
    const prop = (await f.get(`/properties/${w.property.id}`)).body.data;
    expect(prop.total_invested).toBe(8000000);
    expect((await f.post(`/properties/${w.property.id}/valuations`, { value: 9000000, as_of: day(-1) })).status).toBe(201);
    expect((await f.get('/rent/summary')).status).toBe(200);
    expect((await f.get('/overview?preset=fy')).status).toBe(200);
    expect((await f.get('/overview?preset=fy')).body.data.summary.salaries).toBeNull();

    // but not the rest of the business
    for (const path of ['/leads', '/people', '/salaries?month=2026-01', '/settings', '/financials/closes', '/audit', '/sales']) expect([403, 404]).toContain((await f.get(path)).status);
    expect((await f.post('/leads', { name: 'x', service_type: 'civil_construction' })).status).toBe(403);
    expect((await f.post('/financials/close', { month: '2020-01' })).status).toBe(403);
    expect((await f.post(`/properties/${w.property.id}/sales`, { sale_value: 1, sale_date: day(-1) })).status).toBe(403);
    expect((await f.post('/ledger/import', { rows: [{ date: day(-1), type: 'expense', category: 'Materials', amount: '1' }] })).status).toBe(403);
  });

  test('an admin can give a person the finance role from the roster', async () => {
    const { org, token } = await setupZephyr();
    const user = await createUser({ role: 'employee', withOrg: false });
    await createOrgMembership(user.id, org.id, { role: 'employee' });
    const person = (await api(token).post('/people', { name: 'Accountant', user_id: user.id, access_role: 'finance' })).body.data;
    expect(person.access_role).toBe('finance');
    const { access_token } = await loginAs(user);
    const me = (await api(access_token).get('/me')).body.data;
    expect(me.role).toBe('finance');
    expect(me.caps).toEqual(expect.arrayContaining(['propertyFinance', 'rent', 'ledger']));
    expect(me.caps).not.toContain('leads');
  });
});
