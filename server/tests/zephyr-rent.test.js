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
const thisMonth = () => day(0).slice(0, 7);
const monthOffset = (delta) => {
  const [y, m] = thisMonth().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};

// A property with two shops and a tenant; returns the ids.
async function world(a, org) {
  const property = (await a.post('/properties', { name: 'XYZ Complex', property_type: 'commercial_complex', purchase_cost: 8000000 })).body.data;
  await a.post(`/properties/${property.id}/units`, { name: 'Shop 3' });
  await a.post(`/properties/${property.id}/units`, { name: 'Shop 4' });
  const units = (await a.get(`/properties/${property.id}`)).body.data.units;
  const tenant = (await a.post('/tenants', { name: 'ABC Pvt Ltd', phone: '9800000000' })).body.data;
  const collector = await prisma.zxPerson.create({ data: { org_id: org.id, name: 'Collector Ravi', kind: 'employee' } });
  return { property, unit3: units.find((u) => u.name === 'Shop 3'), unit4: units.find((u) => u.name === 'Shop 4'), tenant, collector };
}

describe('zephyr tenants and leases (R4)', () => {
  test('a lease rents the unit, generates every due from its start month, and refuses overlaps', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const w = await world(a, org);
    expect((await a.post('/tenants', { name: 'abc pvt ltd' })).status).toBe(409);
    const lease = await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit3.id, start_date: `${monthOffset(-2)}-05`, monthly_rent: 60000, security_deposit: 120000, due_day: 1 });
    expect(lease.status).toBe(201);
    expect(lease.body.data.dues.map((d) => d.period).sort()).toEqual([monthOffset(-2), monthOffset(-1), thisMonth()]);
    expect(lease.body.data.dues.every((d) => d.amount === 60000)).toBe(true);
    expect((await a.get(`/properties/${w.property.id}`)).body.data.units.find((u) => u.id === w.unit3.id)).toMatchObject({ status: 'rented', tenant: { name: 'ABC Pvt Ltd', monthly_rent: 60000 } });
    expect((await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit3.id, start_date: day(-1), monthly_rent: 1000 })).status).toBe(409);
    expect((await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit4.id, start_date: day(5), end_date: day(1), monthly_rent: 1000 })).status).toBe(422);
    expect((await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit4.id, start_date: day(0), monthly_rent: 0 })).status).toBe(422);
    expect((await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit4.id, start_date: day(0), monthly_rent: 5000, due_day: 31 })).status).toBe(422);
    // the same tenant can hold a second lease on another unit
    expect((await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit4.id, start_date: day(0), monthly_rent: 45000, due_day: 10 })).status).toBe(201);
    expect((await a.get(`/tenants/${w.tenant.id}`)).body.data.leases).toHaveLength(2);
    expect((await a.del(`/tenants/${w.tenant.id}`)).status).toBe(409);
  });

  test('ending a lease frees the unit and drops dues that never fell due', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const w = await world(a, org);
    const lease = (await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit3.id, start_date: `${monthOffset(-1)}-01`, monthly_rent: 30000 })).body.data;
    const ended = await a.post(`/leases/${lease.id}/end`, { ended_on: `${monthOffset(-1)}-20`, reason: 'Tenant left' });
    expect(ended.body.data.status).toBe('ended');
    expect(ended.body.data.dues.map((d) => d.period)).toEqual([monthOffset(-1)]);
    expect((await a.get(`/properties/${w.property.id}`)).body.data.units.find((u) => u.id === w.unit3.id).status).toBe('vacant');
    expect((await a.patch(`/leases/${lease.id}`, { monthly_rent: 1 })).status).toBe(409);
    // the unit can be let again
    expect((await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit3.id, start_date: day(0), monthly_rent: 35000 })).status).toBe(201);
    expect((await a.get('/audit?entity=lease')).body.data.map((r) => r.action)).toEqual(expect.arrayContaining(['create', 'end']));
  });

  test('a new rent applies to unpaid dues from this month on and is audited', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const w = await world(a, org);
    const lease = (await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit3.id, start_date: `${monthOffset(-1)}-01`, monthly_rent: 50000 })).body.data;
    const updated = (await a.patch(`/leases/${lease.id}`, { monthly_rent: 55000 })).body.data;
    const byPeriod = Object.fromEntries(updated.dues.map((d) => [d.period, d.amount]));
    expect(byPeriod[monthOffset(-1)]).toBe(50000);
    expect(byPeriod[thisMonth()]).toBe(55000);
    expect((await a.get('/audit?entity=lease')).body.data.map((r) => r.action)).toContain('rent_change');
  });
});

describe('zephyr rent dues, overdue and payments (R4)', () => {
  test('overdue is computed from the due date; payments post rental income to the ledger', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const w = await world(a, org);
    await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit3.id, start_date: `${monthOffset(-1)}-01`, monthly_rent: 60000, due_day: 1 });
    const prev = (await a.get(`/rent/dues?month=${monthOffset(-1)}`)).body.data;
    expect(prev).toHaveLength(1);
    expect(prev[0]).toMatchObject({ status: 'overdue', balance: 60000, tenant: { name: 'ABC Pvt Ltd' }, property: { name: 'XYZ Complex' }, unit: { name: 'Shop 3' } });
    const overdue = (await a.get('/rent/overdue')).body.data;
    expect(overdue.map((d) => d.period)).toContain(monthOffset(-1));
    expect(overdue[0].days_overdue).toBeGreaterThan(0);

    // partial payment: still overdue (a balance is past due) and flagged partially paid
    const first = await a.post(`/rent/dues/${prev[0].id}/payments`, { amount: 20000, paid_on: day(-1), method: 'upi', reference: 'UPI-1', collected_by_person_id: w.collector.id });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ paid_amount: 20000, balance: 40000, status: 'overdue', partially_paid: true });
    expect((await a.post(`/rent/dues/${prev[0].id}/payments`, { amount: 50000, paid_on: day(0), method: 'cash' })).status).toBe(422);
    expect((await a.post(`/rent/dues/${prev[0].id}/payments`, { amount: 100, paid_on: day(2), method: 'cash' })).status).toBe(422);
    expect((await a.post(`/rent/dues/${prev[0].id}/payments`, { amount: 100, paid_on: day(0), method: 'barter' })).status).toBe(422);
    expect((await a.post(`/rent/dues/${prev[0].id}/payments`, { amount: 100, paid_on: day(0), method: 'cash', collected_by_person_id: '3f1d8c74-3c1b-4c0e-9a55-0b8f9a4d9f11' })).status).toBe(422);
    const second = await a.post(`/rent/dues/${prev[0].id}/payments`, { amount: 40000, paid_on: day(0), method: 'cash' });
    expect(second.body.data).toMatchObject({ paid_amount: 60000, balance: 0, status: 'paid' });

    const entries = await prisma.zxLedgerEntry.findMany({ where: { source_type: 'rent_payment' }, include: { category: true } });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: 'revenue', status: 'actual', property_id: w.property.id, unit_id: w.unit3.id, service_type: 'property_management' });
    expect(entries[0].category.name).toBe('Rental income');
    expect(entries.map((e) => Number(e.amount)).sort((x, y) => x - y)).toEqual([20000, 40000]);
    const payments = (await a.get(`/rent/payments?property_id=${w.property.id}`)).body.data;
    expect(payments.map((p) => p.method).sort()).toEqual(['cash', 'upi']);
    expect(payments.find((p) => p.method === 'upi')).toMatchObject({ reference: 'UPI-1', collected_by: { name: 'Collector Ravi' }, tenant: { name: 'ABC Pvt Ltd' } });

    // the same money shows up in the overview as revenue
    const overview = (await a.get('/overview?preset=t12')).body.data;
    expect(overview.summary.revenue).toBe(60000);
    // and in the property timeline
    expect((await a.get(`/properties/${w.property.id}`)).body.data.events.filter((e) => e.kind === 'rent').length).toBeGreaterThanOrEqual(3);
  });

  test('deleting a payment reverses the due and the ledger entry', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const w = await world(a, org);
    await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit3.id, start_date: `${thisMonth()}-01`, monthly_rent: 10000 });
    const due = (await a.get(`/rent/dues?month=${thisMonth()}`)).body.data[0];
    await a.post(`/rent/dues/${due.id}/payments`, { amount: 10000, paid_on: day(0), method: 'bank_transfer' });
    const paymentId = (await a.get('/rent/payments')).body.data[0].id;
    const reversed = await a.del(`/rent/payments/${paymentId}`);
    expect(reversed.body.data).toMatchObject({ paid_amount: 0, balance: 10000 });
    expect(await prisma.zxLedgerEntry.count({ where: { source_type: 'rent_payment', deleted_at: null } })).toBe(0);
    expect((await a.get('/rent/payments')).body.data).toHaveLength(0);
    expect((await a.get('/audit?entity=rent_payment')).body.data.map((r) => r.action)).toEqual(expect.arrayContaining(['create', 'delete']));
  });

  test('waiving needs a reason; a closed month locks payments, reversals and edits', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const w = await world(a, org);
    await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit3.id, start_date: `${monthOffset(-1)}-01`, monthly_rent: 20000 });
    const dues = (await a.get(`/rent/dues?month=${monthOffset(-1)}`)).body.data;
    expect((await a.patch(`/rent/dues/${dues[0].id}`, { waived: true })).status).toBe(422);
    const waived = await a.patch(`/rent/dues/${dues[0].id}`, { waived: true, waived_reason: 'Rent holiday agreed' });
    expect(waived.body.data).toMatchObject({ status: 'waived', balance: 0 });
    expect((await a.post(`/rent/dues/${dues[0].id}/payments`, { amount: 100, paid_on: day(0), method: 'cash' })).status).toBe(409);
    await a.patch(`/rent/dues/${dues[0].id}`, { waived: false });
    expect((await a.get(`/rent/dues?month=${monthOffset(-1)}`)).body.data[0].status).toBe('overdue');

    const pay = await a.post(`/rent/dues/${dues[0].id}/payments`, { amount: 5000, paid_on: day(0), method: 'cash' });
    expect(pay.status).toBe(201);
    // close the month the payment falls in
    await prisma.zxPeriodClose.create({ data: { org_id: org.id, month: thisMonth(), status: 'closed', closed_at: new Date() } });
    const paymentId = (await a.get('/rent/payments')).body.data[0].id;
    expect((await a.del(`/rent/payments/${paymentId}`)).status).toBe(409);
    expect((await a.post(`/rent/dues/${dues[0].id}/payments`, { amount: 100, paid_on: day(0), method: 'cash' })).status).toBe(409);
    await prisma.zxPeriodClose.create({ data: { org_id: org.id, month: monthOffset(-1), status: 'closed', closed_at: new Date() } });
    expect((await a.patch(`/rent/dues/${dues[0].id}`, { amount: 21000 })).status).toBe(409);
    // reopening unlocks it again
    await prisma.zxPeriodClose.updateMany({ where: { org_id: org.id }, data: { status: 'open' } });
    expect((await a.patch(`/rent/dues/${dues[0].id}`, { amount: 21000 })).status).toBe(200);
    expect((await a.patch(`/rent/dues/${dues[0].id}`, { amount: 1000 })).status).toBe(422);
  });

  test('summary totals and property cash flow: rent 60,000 against an EMI of 50,000 is positive', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const w = await world(a, org);
    await a.post(`/properties/${w.property.id}/loans`, { lender: 'SBI', loan_amount: 4000000, outstanding_amount: 3800000, emi_amount: 50000, emi_frequency: 'monthly' });
    await a.post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit3.id, start_date: `${thisMonth()}-01`, monthly_rent: 60000, due_day: 1 });
    const due = (await a.get(`/rent/dues?month=${thisMonth()}`)).body.data[0];
    let cash = (await a.get(`/properties/${w.property.id}`)).body.data.cash_flow;
    expect(cash).toMatchObject({ income: 0, financing: 50000, net: -50000, status: 'negative' });
    await a.post(`/rent/dues/${due.id}/payments`, { amount: 60000, paid_on: day(0), method: 'cheque' });
    // an operating expense on the property comes out of the cash flow too
    const cats = (await a.get('/categories')).body.data;
    await a.post('/ledger', { entry_date: day(0), type: 'expense', category_id: cats.find((c) => c.name === 'Office').id, amount: 2000, description: 'Repairs' });
    await prisma.zxLedgerEntry.updateMany({ where: { amount: 2000 }, data: { property_id: w.property.id } });
    cash = (await a.get(`/properties/${w.property.id}`)).body.data.cash_flow;
    expect(cash).toMatchObject({ income: 60000, expenses: 2000, financing: 50000, net: 8000, status: 'positive' });
    const summary = (await a.get(`/rent/summary?month=${thisMonth()}`)).body.data;
    expect(summary).toMatchObject({ total_due: 60000, collected: 60000, pending: 0, overdue: 0 });
    expect(summary.by_property[0]).toMatchObject({ name: 'XYZ Complex', total_due: 60000, collected: 60000 });
  });
});

describe('zephyr rent access and isolation (R4)', () => {
  test('manager records rent; staff cannot; another company sees nothing', async () => {
    const x = await setupZephyr('zephyr-x');
    const y = await setupZephyr('zephyr-y');
    const manager = await addMember(x.org, 'manager');
    const staff = await addMember(x.org, 'staff');
    const w = await world(api(x.token), x.org);
    const lease = (await api(manager.token).post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit3.id, start_date: `${thisMonth()}-01`, monthly_rent: 9000 })).body.data;
    const due = (await api(manager.token).get(`/rent/dues?month=${thisMonth()}`)).body.data[0];
    expect((await api(manager.token).post(`/rent/dues/${due.id}/payments`, { amount: 9000, paid_on: day(0), method: 'cash', collected_by_person_id: manager.person.id })).status).toBe(201);
    expect((await api(manager.token).del(`/tenants/${w.tenant.id}`)).status).toBe(403);
    for (const path of ['/tenants', '/leases', '/rent/dues', '/rent/summary', '/rent/overdue', '/rent/payments']) expect((await api(staff.token).get(path)).status).toBe(403);
    expect((await api(staff.token).post('/tenants', { name: 'x' })).status).toBe(403);

    expect((await api(y.token).get('/tenants')).body.data).toHaveLength(0);
    expect((await api(y.token).get('/rent/dues')).body.data).toHaveLength(0);
    expect((await api(y.token).get(`/leases/${lease.id}`)).status).toBe(404);
    expect((await api(y.token).post(`/rent/dues/${due.id}/payments`, { amount: 1, paid_on: day(0), method: 'cash' })).status).toBe(404);
    expect((await api(y.token).post('/leases', { tenant_id: w.tenant.id, unit_id: w.unit4.id, start_date: day(0), monthly_rent: 1 })).status).toBe(404);
  });
});
