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
  return { token: access_token };
}

const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/zephyr${path}`), token).send(body || {}),
  get: (path) => authed(request(app).get(`/api/v1/zephyr${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/zephyr${path}`), token).send(body),
  put: (path, body) => authed(request(app).put(`/api/v1/zephyr${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/zephyr${path}`), token),
});
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const thisMonth = () => day(0).slice(0, 7);
const prevMonth = () => {
  const [y, m] = thisMonth().split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

describe('zephyr admin can edit what it records (valuations, timeline, prefixes)', () => {
  test('a valuation and a manual timeline note can be edited; system notes cannot', async () => {
    const { token, org } = await setupZephyr();
    const a = api(token);
    const p = (await a.post('/properties', { name: 'Edit Plot', purchase_cost: 1000000 })).body.data;
    const v1 = (await a.post(`/properties/${p.id}/valuations`, { value: 1200000, as_of: day(-10) })).body.data.valuations[0];
    expect((await a.get(`/properties/${p.id}`)).body.data.valuation).toBe(1200000);

    const edited = await a.patch(`/properties/${p.id}/valuations/${v1.id}`, { value: 1500000, notes: 'corrected' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.valuation).toBe(1500000);
    expect(edited.body.data.valuations[0]).toMatchObject({ value: 1500000, notes: 'corrected' });
    expect((await a.patch(`/properties/${p.id}/valuations/${v1.id}`, { as_of: day(3) })).status).toBe(422);
    expect((await a.patch(`/properties/${p.id}/valuations/3f1d8c74-3c1b-4c0e-9a55-0b8f9a4d9f11`, { value: 1 })).status).toBe(404);
    // an unrealized valuation never reaches the P&L
    expect((await a.get('/overview?preset=t12')).body.data.summary).toMatchObject({ revenue: 0, expense: 0 });

    const note = (await a.post(`/properties/${p.id}/events`, { kind: 'note', event_date: day(-1), title: 'Site visit' })).body.data.events.find((e) => e.title === 'Site visit');
    const renamed = await a.patch(`/properties/${p.id}/events/${note.id}`, { title: 'Site visit (done)', notes: 'with broker' });
    expect(renamed.body.data.events.find((e) => e.id === note.id)).toMatchObject({ title: 'Site visit (done)', notes: 'with broker' });
    const system = await prisma.zxPropertyEvent.findFirst({ where: { org_id: org.id, property_id: p.id, kind: 'valuation' } });
    await prisma.zxPropertyEvent.update({ where: { id: system.id }, data: { source_type: 'valuation', source_id: v1.id } });
    expect((await a.patch(`/properties/${p.id}/events/${system.id}`, { title: 'x' })).status).toBe(409);
    expect((await a.del(`/properties/${p.id}/events/${system.id}`)).status).toBe(409);
    expect((await a.del(`/properties/${p.id}/events/${note.id}`)).status).toBe(200);
    expect((await a.get(`/properties/${p.id}`)).body.data.events.find((e) => e.id === note.id)).toBeUndefined();
    expect((await a.get('/audit?entity=property_valuation')).body.data.map((r) => r.action)).toContain('update');
  });

  test('the lead, property and task code prefixes are editable and apply to new records', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    expect((await a.get('/settings')).body.data).toMatchObject({ lead_prefix: 'ZL', property_prefix: 'ZP', task_prefix: 'ZT' });
    const saved = await a.patch('/settings', { lead_prefix: 'LD', property_prefix: 'PR', task_prefix: 'TK', reason: 'new numbering' });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ lead_prefix: 'LD', property_prefix: 'PR', task_prefix: 'TK' });
    expect((await a.post('/leads', { name: 'Prefix lead', service_type: 'civil_construction' })).body.data.code).toMatch(/^LD-/);
    expect((await a.post('/properties', { name: 'Prefix plot' })).body.data.code).toMatch(/^PR-/);
    expect((await a.patch('/settings', { lead_prefix: '' })).status).toBe(422);
  });
});

describe('zephyr admin can edit rent payments, sales and shared expenses', () => {
  test('editing a rent payment moves the due and the ledger together; the money rules still hold', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const p = (await a.post('/properties', { name: 'Rent House', property_type: 'commercial_complex' })).body.data;
    await a.post(`/properties/${p.id}/units`, { name: 'Shop 9' });
    const unit = (await a.get(`/properties/${p.id}`)).body.data.units[0];
    const tenant = (await a.post('/tenants', { name: 'Edit Tenant' })).body.data;
    await a.post('/leases', { tenant_id: tenant.id, unit_id: unit.id, start_date: `${prevMonth()}-01`, monthly_rent: 60000, due_day: 1 });
    const due = (await a.get(`/rent/dues?month=${prevMonth()}`)).body.data[0];
    const paid = await a.post(`/rent/dues/${due.id}/payments`, { amount: 20000, paid_on: day(-1), method: 'cash' });
    expect(paid.body.data).toMatchObject({ paid_amount: 20000, balance: 40000 });
    const paymentId = (await a.get(`/rent/payments?property_id=${p.id}`)).body.data[0].id;

    const edited = await a.patch(`/rent/payments/${paymentId}`, { amount: 35000, method: 'upi', reference: 'UPI-9' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ paid_amount: 35000, balance: 25000 });
    const live = await prisma.zxRentPayment.findMany({ where: { rent_due_id: due.id, deleted_at: null } });
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ method: 'upi', reference: 'UPI-9' });
    const entries = await prisma.zxLedgerEntry.findMany({ where: { source_type: 'rent_payment', deleted_at: null } });
    expect(entries.map((e) => Number(e.amount))).toEqual([35000]);

    const newId = live[0].id;
    expect((await a.patch(`/rent/payments/${newId}`, { amount: 70000 })).status).toBe(422);
    expect((await a.patch(`/rent/payments/${newId}`, { paid_on: day(5) })).status).toBe(422);
    expect((await a.patch('/rent/payments/3f1d8c74-3c1b-4c0e-9a55-0b8f9a4d9f11', { amount: 1 })).status).toBe(404);
    // a failed edit leaves the original payment in place
    expect((await prisma.zxRentPayment.count({ where: { rent_due_id: due.id, deleted_at: null } }))).toBe(1);
    expect((await a.get('/overview?preset=t12')).body.data.summary.revenue).toBe(35000);
  });

  test('editing a sale rebuilds the realized profit and the ledger; a shared expense can be re-split', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const plot = (await a.post('/properties', { name: 'Sale Plot', purchase_date: day(-300), purchase_cost: 1000000 })).body.data;
    const sold = await a.post(`/properties/${plot.id}/sales`, { sale_value: 1500000, sale_date: day(-2), selling_costs: 10000 });
    expect(sold.body.data).toMatchObject({ realized_profit: 490000 });
    const saleId = sold.body.data.id;

    const edited = await a.patch(`/properties/${plot.id}/sales/${saleId}`, { sale_value: 1800000, selling_costs: 30000, notes: 'revised' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ sale_value: 1800000, selling_costs: 30000, realized_profit: 770000 });
    const sales = (await a.get('/sales')).body.data;
    expect(sales.rows || sales.sales || sales).toBeTruthy();
    expect((await a.get('/overview?preset=t12')).body.data.summary).toMatchObject({ revenue: 1800000, expense: 1030000, profit: 770000 });
    expect((await prisma.zxPropertySale.count({ where: { property_id: plot.id, deleted_at: null } }))).toBe(1);
    expect((await a.get(`/properties/${plot.id}`)).body.data.status).toBe('sold');
    expect((await a.patch(`/properties/${plot.id}/sales/${saleId}`, { sale_value: 5 })).status).toBe(404);
    const newSale = await prisma.zxPropertySale.findFirst({ where: { property_id: plot.id, deleted_at: null } });
    expect((await a.patch(`/properties/${plot.id}/sales/${newSale.id}`, { sale_date: day(4) })).status).toBe(422);

    const cats = (await a.get('/categories')).body.data;
    const office = cats.find((c) => c.kind === 'expense' && c.name === 'Office').id;
    const civil = (await a.post('/projects', { name: 'P1', service_type: 'civil_construction', status: 'active' })).body.data;
    const interior = (await a.post('/projects', { name: 'P2', service_type: 'interior_design', status: 'active' })).body.data;
    const group = await a.post('/ledger/group-expenses', { entry_date: day(-1), category_id: office, amount: 1000, allocations: [{ project_id: civil.id, share: 1 }, { project_id: interior.id, share: 1 }] });
    const gid = group.body.data.group_id;
    const re = await a.put(`/ledger/group-expenses/${gid}`, { entry_date: day(-1), category_id: office, amount: 2000, basis: 'percent', allocations: [{ project_id: civil.id, share: 75 }, { project_id: interior.id, share: 25 }] });
    expect(re.status).toBe(200);
    expect(re.body.data.entries.map((e) => e.amount)).toEqual([1500, 500]);
    const groups = (await a.get('/ledger/group-expenses')).body.data;
    expect(groups).toHaveLength(1);
    expect(groups[0].amount).toBe(2000);
    expect((await a.put(`/ledger/group-expenses/${gid}`, { entry_date: day(-1), category_id: office, amount: 10, allocations: [{ project_id: civil.id, share: 1 }, { project_id: interior.id, share: 1 }] })).status).toBe(404);
    // a bad split leaves the current one untouched
    const keep = groups[0].group_id;
    expect((await a.put(`/ledger/group-expenses/${keep}`, { entry_date: day(-1), category_id: office, amount: 100, basis: 'percent', allocations: [{ project_id: civil.id, share: 10 }, { project_id: interior.id, share: 10 }] })).status).toBe(422);
    expect((await a.get('/ledger/group-expenses')).body.data[0].amount).toBe(2000);
  });

  test('managers cannot edit sales, payments or shared expenses of the finance side', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const a = api(token);
    const plot = (await a.post('/properties', { name: 'Guard Plot', purchase_cost: 100000 })).body.data;
    const sold = await a.post(`/properties/${plot.id}/sales`, { sale_value: 200000, sale_date: day(-1) });
    const m = api(manager.token);
    expect((await m.patch(`/properties/${plot.id}/sales/${sold.body.data.id}`, { sale_value: 1 })).status).toBe(403);
    expect((await m.patch(`/properties/${plot.id}/valuations/3f1d8c74-3c1b-4c0e-9a55-0b8f9a4d9f11`, { value: 1 })).status).toBe(403);
    expect((await m.put('/ledger/group-expenses/3f1d8c74-3c1b-4c0e-9a55-0b8f9a4d9f11', {})).status).toBe(403);
  });
});

describe('zephyr admin manages company users', () => {
  test('edit profile, deactivate and reactivate; guards and access', async () => {
    const { token, org, admin } = await setupZephyr('zx-users');
    const a = api(token);
    const staff = await addMember(org, 'staff');
    const target = await prisma.user.findFirst({ where: { org_memberships: { some: { org_id: org.id } }, NOT: { id: admin.id } } });

    const list = await a.get('/users');
    expect(list.status).toBe(200);
    expect(list.body.data.map((u) => u.id)).toEqual(expect.arrayContaining([admin.id, target.id]));

    const edited = await a.patch(`/users/${target.id}`, { name: 'Renamed User', phone: '99999' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ name: 'Renamed User', phone: '99999' });
    expect((await prisma.zxPerson.findFirst({ where: { user_id: target.id } })).name).toBe('Renamed User');
    expect((await a.patch(`/users/${target.id}`, { email: admin.email })).status).toBe(409);

    const off = await a.post(`/users/${target.id}/status`, { active: false, reason: 'left' });
    expect(off.body.data.active).toBe(false);
    expect((await prisma.zxPerson.findFirst({ where: { user_id: target.id } })).active).toBe(false);
    expect((await a.get('/users?status=inactive')).body.data).toHaveLength(1);
    expect((await authed(request(app).get('/api/v1/zephyr/me'), staff.token)).status).toBeGreaterThanOrEqual(401);

    expect((await a.post(`/users/${target.id}/status`, { active: true })).body.data.active).toBe(true);
    expect((await a.post(`/users/${admin.id}/status`, { active: false })).status).toBe(422);
    expect((await api(staff.token).get('/users')).status).toBe(403);

    const made = await a.post('/users', { name: 'New Finance', email: 'newfin@zx.test', password: 'password123', access_role: 'finance' });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ email: 'newfin@zx.test', active: true, zephyr_person: { access_role: 'finance' } });
    expect((await a.post('/users', { name: 'Dup', email: 'newfin@zx.test', password: 'password123' })).status).toBe(409);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'newfin@zx.test', password: 'password123' });
    expect(login.status).toBe(200);
    expect((await api(staff.token).post('/users', { name: 'X', email: 'x@zx.test', password: 'password123' })).status).toBe(403);
  });
});

describe('zephyr admin can correct a lead activity log', () => {
  test('an activity can be edited, its follow-up moved or cleared, and removed; closed leads stay frozen', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const lead = (await a.post('/leads', { name: 'Log lead', service_type: 'civil_construction' })).body.data;
    const made = await a.post(`/leads/${lead.id}/activities`, { kind: 'call', summary: 'First call', follow_up_date: day(3) });
    expect(made.status).toBe(201);
    const id = made.body.data.id;

    const edited = await a.patch(`/leads/${lead.id}/activities/${id}`, { summary: 'First call (spoke to owner)', kind: 'meeting', follow_up_date: day(6) });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ summary: 'First call (spoke to owner)', kind: 'meeting' });
    expect(String(edited.body.data.follow_up_date).slice(0, 10)).toBe(day(6));
    // only the follow-up flag changes when only that is sent (the old behaviour)
    const done = await a.patch(`/leads/${lead.id}/activities/${id}`, { follow_up_done: true });
    expect(done.body.data).toMatchObject({ follow_up_done: true, summary: 'First call (spoke to owner)' });
    const cleared = await a.patch(`/leads/${lead.id}/activities/${id}`, { follow_up_date: null });
    expect(cleared.body.data).toMatchObject({ follow_up_date: null, follow_up_done: false });
    expect((await a.patch(`/leads/${lead.id}/activities/${id}`, { summary: '' })).status).toBe(422);
    expect((await a.patch(`/leads/${lead.id}/activities/3f1d8c74-3c1b-4c0e-9a55-0b8f9a4d9f11`, { summary: 'x' })).status).toBe(404);

    expect((await a.del(`/leads/${lead.id}/activities/${id}`)).status).toBe(200);
    expect((await a.get(`/leads/${lead.id}/activities`)).body.data.filter((x) => x.id === id)).toHaveLength(0);
    expect((await a.del(`/leads/${lead.id}/activities/${id}`)).status).toBe(404);

    const keep = (await a.post(`/leads/${lead.id}/activities`, { kind: 'note', summary: 'Kept note' })).body.data.id;
    await a.post(`/leads/${lead.id}/stage`, { stage: 'dropped', lost_reason: 'budget' });
    expect((await a.patch(`/leads/${lead.id}/activities/${keep}`, { summary: 'changed' })).status).toBe(409);
    expect((await a.del(`/leads/${lead.id}/activities/${keep}`)).status).toBe(409);
  });
});

describe('zephyr admin company branding', () => {
  test('logo, name and timezone can be changed; bad logos and non-admins are refused', async () => {
    const { token, org } = await setupZephyr('zx-brand');
    const a = api(token);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    const saved = await a.patch('/company', { name: 'Zephyr Renamed', logo_url: png, timezone: 'Asia/Dubai' });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ name: 'Zephyr Renamed', logo_url: png, timezone: 'Asia/Dubai' });
    expect((await a.patch('/company', { logo_url: 'https://evil.test/x.png' })).status).toBe(422);
    expect((await a.patch('/company', { timezone: 'Not/AZone' })).status).toBe(422);
    expect((await a.patch('/company', { logo_url: null })).body.data.logo_url).toBeNull();

    const staff = await addMember(org, 'staff');
    expect((await api(staff.token).patch('/company', { name: 'X' })).status).toBe(403);
  });
});

describe('zephyr admin can add services', () => {
  test('a new service is usable on leads and projects; unknown keys and non-admins are refused', async () => {
    const { token, org } = await setupZephyr('zx-services');
    const a = api(token);
    const made = await a.post('/service-types', { label: 'Architecture' });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ key: 'custom_architecture', label: 'Architecture', active: true });
    expect((await a.post('/service-types', { label: 'architecture' })).status).toBe(409);
    expect((await a.get('/service-types')).body.data.map((s) => s.key)).toContain('custom_architecture');

    const lead = await a.post('/leads', { name: 'Plan a villa', service_type: 'custom_architecture' });
    expect(lead.status).toBe(201);
    expect((await a.get('/leads/summary')).body.data.by_service.custom_architecture.count).toBe(1);
    expect((await a.post('/projects', { name: 'Villa', service_type: 'custom_architecture', status: 'active' })).status).toBe(201);
    expect((await a.get('/projects/summary')).body.data.by_service.custom_architecture.total).toBe(1);
    expect((await a.post('/leads', { name: 'Bad', service_type: 'custom_nope' })).status).toBe(422);

    expect((await a.patch('/service-types/custom_architecture', { label: 'Architecture & Planning' })).body.data.label).toBe('Architecture & Planning');
    const staff = await addMember(org, 'staff');
    expect((await api(staff.token).post('/service-types', { label: 'X' })).status).toBe(403);
  });
});
