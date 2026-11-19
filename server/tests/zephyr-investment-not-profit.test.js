const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function setupZephyr() {
  const org = await createOrg({ name: 'Zephyr inv', slug: 'zephyr-inv' });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['zephyr'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, token: access_token };
}

const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/zephyr${path}`), token).send(body || {}),
  get: (path) => authed(request(app).get(`/api/v1/zephyr${path}`), token),
});
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

describe('Zephyr: money put into a property is an investment, not profit or loss', () => {
  test('an acquisition cost leaves profit alone and shows as a separate invested figure', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const created = await a.post('/properties', { name: 'Plot B', property_type: 'plot', purchase_cost: 1000000 });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const from = day(-30);
    const to = day(0);

    const before = await a.get(`/overview?from=${from}&to=${to}`);
    expect(before.status).toBe(200);
    expect(before.body.data.summary.profit).toBe(0);

    const added = await a.post(`/properties/${id}/acquisition-costs`, { cost_type: 'registration', amount: 150000, entry_date: day(-2) });
    expect(added.status).toBe(201);
    // the property's own total invested still counts it
    expect(added.body.data.acquisition_total).toBe(150000);

    const after = await a.get(`/overview?from=${from}&to=${to}`);
    expect(after.status).toBe(200);
    const s = after.body.data.summary;
    expect(s.expense).toBe(0);
    expect(s.profit).toBe(0);
    expect(s.invested).toBe(150000);
    // and the investment is not a category of the P&L either
    expect(after.body.data.by_category.some((c) => /acquisition/i.test(c.name || c.category || ''))).toBe(false);

    // the ledger still lists the row, but its revenue / expense totals leave it out
    const ledger = await a.get('/ledger');
    expect(ledger.status).toBe(200);
    expect(ledger.body.data).toHaveLength(1);
    expect(ledger.body.totals.expense).toBe(0);
    expect(ledger.body.totals.invested).toBe(150000);
  });

  test('a normal expense still reduces profit while an acquisition does not', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const created = await a.post('/properties', { name: 'Plot C', property_type: 'plot', purchase_cost: 500000 });
    const id = created.body.data.id;
    await a.post(`/properties/${id}/acquisition-costs`, { cost_type: 'brokerage', amount: 40000, entry_date: day(-3) });
    const cat = await prisma.zxCategory.findFirst({ where: { org_id: org.id, kind: 'expense', deleted_at: null, NOT: { name: 'Property acquisition (investment)' } } })
      || await prisma.zxCategory.create({ data: { org_id: org.id, kind: 'expense', name: 'Office', sort_order: 0 } });
    const spend = await a.post('/ledger', { entry_date: day(-1), type: 'expense', category_id: cat.id, amount: 7000 });
    expect(spend.status).toBe(201);

    const res = await a.get(`/overview?from=${day(-30)}&to=${day(0)}`);
    expect(res.body.data.summary.expense).toBe(7000);
    expect(res.body.data.summary.profit).toBe(-7000);
    expect(res.body.data.summary.invested).toBe(40000);
  });
});
