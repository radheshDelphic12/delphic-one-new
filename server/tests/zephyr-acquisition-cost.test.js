const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function setupZephyr() {
  const org = await createOrg({ name: 'Zephyr acq', slug: 'zephyr-acq' });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['zephyr'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, token: access_token };
}

const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/zephyr${path}`), token).send(body || {}),
  get: (path) => authed(request(app).get(`/api/v1/zephyr${path}`), token),
  del: (path) => authed(request(app).delete(`/api/v1/zephyr${path}`), token),
});
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

describe('property acquisition cost (investment booked as an expense)', () => {
  test('adding a cost posts an expense, raises the investment, and removing it reverses both', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const created = await a.post('/properties', { name: 'Plot A', property_type: 'plot', purchase_cost: 1000000 });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const added = await a.post(`/properties/${id}/acquisition-costs`, { cost_type: 'registration', amount: 150000, entry_date: day(-2), payment_mode: 'bank', reference: 'REG-1' });
    expect(added.status).toBe(201);
    const p = added.body.data;
    expect(p.acquisition_total).toBe(150000);
    expect(p.acquisition_costs).toHaveLength(1);
    expect(p.acquisition_costs[0]).toMatchObject({ cost_type: 'registration', amount: 150000, reference: 'REG-1' });
    expect(p.registration_cost).toBe(150000);

    const ledger = await prisma.zxLedgerEntry.findMany({ where: { org_id: org.id, property_id: id, deleted_at: null } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: 'expense', source_type: 'property_acquisition', service_type: 'registration' });
    expect(Number(ledger[0].amount)).toBe(150000);
    const cat = await prisma.zxCategory.findUnique({ where: { id: ledger[0].category_id } });
    expect(cat.name).toBe('Property acquisition (investment)');
    expect(cat.kind).toBe('expense');

    const removed = await a.del(`/properties/${id}/acquisition-costs/${p.acquisition_costs[0].id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data.acquisition_costs).toHaveLength(0);
    expect(removed.body.data.registration_cost).toBe(0);
    expect(await prisma.zxLedgerEntry.count({ where: { org_id: org.id, property_id: id, deleted_at: null } })).toBe(0);
  });

  test('bad input is refused: future date, zero amount, unknown type, unknown property', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const id = (await a.post('/properties', { name: 'Plot B', property_type: 'plot' })).body.data.id;
    expect((await a.post(`/properties/${id}/acquisition-costs`, { cost_type: 'other', amount: 10, entry_date: day(5) })).status).toBe(422);
    expect((await a.post(`/properties/${id}/acquisition-costs`, { cost_type: 'other', amount: 0, entry_date: day(-1) })).status).toBe(422);
    expect((await a.post(`/properties/${id}/acquisition-costs`, { cost_type: 'tax', amount: 5, entry_date: day(-1) })).status).toBe(422);
    expect((await a.post('/properties/00000000-0000-4000-8000-000000000000/acquisition-costs', { cost_type: 'other', amount: 5, entry_date: day(-1) })).status).toBe(404);
    expect((await a.del(`/properties/${id}/acquisition-costs/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
  });

  test('a closed month refuses the cost', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const id = (await a.post('/properties', { name: 'Plot C', property_type: 'plot' })).body.data.id;
    const month = day(-1).slice(0, 7);
    await prisma.zxPeriodClose.create({ data: { org_id: org.id, month, status: 'closed', closed_at: new Date() } });
    const res = await a.post(`/properties/${id}/acquisition-costs`, { cost_type: 'other', amount: 100, entry_date: `${month}-01` });
    expect(res.status).toBe(409);
    expect(await prisma.zxLedgerEntry.count({ where: { org_id: org.id, property_id: id } })).toBe(0);
  });
});
