/** Novarex: the numbers behind the valuation, the graphs and the filters add up (independent arithmetic, no shared code). */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

jest.setTimeout(180000);
beforeAll(async () => { await cleanDatabase(); }, 180000);
afterAll(async () => { await cleanDatabase(); await prisma.$disconnect(); }, 180000);

let seq = 0;
async function setup() {
  seq += 1;
  const slug = `vti-${Date.now()}-${seq}`;
  const org = await createOrg({ name: `Novarex ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['novarex'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  return { org, token: (await loginAs(admin)).access_token };
}
const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/novarex${path}`), token).send(body),
  get: (path) => authed(request(app).get(`/api/v1/novarex${path}`), token),
});
const iso = (d) => d.toISOString().slice(0, 10);
const monthKey = (back) => { const d = new Date(); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1))).slice(0, 7); };
const dayIn = (back, day = 10) => `${monthKey(back)}-${String(day).padStart(2, '0')}`;
const monthEnd = (back) => iso(new Date(Date.UTC(Number(monthKey(back).slice(0, 4)), Number(monthKey(back).slice(5)), 0)));
const qs = (o) => `?${new URLSearchParams(o).toString()}`;
const sumKeys = (row) => Math.round(Object.entries(row).filter(([k]) => k !== 'month').reduce((s, [, v]) => s + Number(v), 0) * 100) / 100;

describe('valuation, graphs and filters', () => {
  test('valuation = profit x 240 + principal still invested x 3 for every month; graphs add up to the company figures', async () => {
    const { token } = await setup();
    const a = api(token);
    const outlet = async (name) => (await a.post('/outlets', { name })).body.data;
    const q = await outlet('Quarry');
    const g = await outlet('Gold');
    const qInv = (await a.post('/investments', { name: 'Q', investment_date: dayIn(3, 5), amount: 1000000, outlet_id: q.id })).body.data;
    await a.post('/investments', { name: 'G', investment_date: dayIn(2, 6), amount: 400000, outlet_id: g.id });
    await a.post('/investments', { name: 'Corp', investment_date: dayIn(2, 7), amount: 100000 });
    await a.post(`/investments/${qInv.id}/returns`, { return_date: dayIn(2, 10), principal: 200000, earnings: 10000 });
    await a.post(`/investments/${qInv.id}/returns`, { return_date: dayIn(1, 10), principal: 100000, earnings: 25000 });
    await a.post('/entries', { kind: 'income', amount: 300000, entry_date: dayIn(2, 12), outlet_id: q.id });
    await a.post('/entries', { kind: 'income', amount: 450000, entry_date: dayIn(1, 12), outlet_id: q.id });
    await a.post('/entries', { kind: 'expense', amount: 90000, entry_date: dayIn(2, 13), outlet_id: g.id });
    await a.post('/entries', { kind: 'expense', amount: 120000, entry_date: dayIn(1, 13), outlet_id: q.id });
    await a.post('/entries', { kind: 'expense', amount: 30000, entry_date: dayIn(1, 14) }); // company level
    await a.post('/entries', { kind: 'salary', amount: 20000, entry_date: dayIn(1, 28), outlet_id: g.id });
    await a.post('/entries', { kind: 'expense', amount: 5000, entry_date: dayIn(1, 15), payment_status: 'unpaid', due_date: dayIn(0, 5) }); // unpaid is still an expense
    await a.post('/entries', { kind: 'transfer', amount: 999999, entry_date: dayIn(1, 16) }); // never counted

    // expected, month by month, with plain arithmetic
    const expected = {
      [monthKey(3)]: { income: 0, expenses: 0, outstanding: 1000000 },
      [monthKey(2)]: { income: 10000 + 300000, expenses: 90000, outstanding: 800000 + 400000 + 100000 },
      [monthKey(1)]: { income: 25000 + 450000, expenses: 120000 + 30000 + 20000 + 5000, outstanding: 700000 + 400000 + 100000 },
      [monthKey(0)]: { income: 0, expenses: 0, outstanding: 1200000 },
    };
    const val = (await a.get(`/finance/valuation${qs({ from: monthKey(3), to: monthKey(0), state: 'all' })}`)).body.data;
    expect(val.months.map((m) => m.month)).toEqual(Object.keys(expected));
    for (const m of val.months) {
      const e = expected[m.month];
      const profit = e.income - e.expenses;
      expect(m).toMatchObject({ income: e.income, expenses: e.expenses, profit, asset_value: e.outstanding, profit_x: profit * 240, asset_value_x: e.outstanding * 3, valuation: profit * 240 + e.outstanding * 3 });
    }

    // the dashboard trend equals the same months, and the per-outlet lines add up to it for every month and metric
    const d = (await a.get(`/dashboard${qs({ from: dayIn(0, 1), to: monthEnd(0) })}`)).body.data;
    for (const t of d.trend.filter((x) => expected[x.month])) {
      expect(t.income).toBe(expected[t.month].income);
      expect(t.expenses).toBe(expected[t.month].expenses);
    }
    const lines = d.outlets.trend.keys.map((k) => k.id);
    expect(lines).toEqual(expect.arrayContaining([q.id, g.id, 'none']));
    for (const [metric, key] of [['investment', 'investment_added'], ['revenue', 'income'], ['expenses', 'expenses'], ['net', 'net_result']]) {
      for (const row of d.outlets.trend[metric]) expect(sumKeys(row)).toBe(d.trend.find((t) => t.month === row.month)[key]);
    }
  });

  test('more than eight outlets collapse into "Other outlets" and the lines still add up', async () => {
    const { token } = await setup();
    const a = api(token);
    for (let i = 1; i <= 10; i += 1) {
      const s = (await a.post('/outlets', { name: `Pit ${i}` })).body.data;
      await a.post('/investments', { name: `Cap ${i}`, investment_date: dayIn(1, 5), amount: 100000 * i, outlet_id: s.id });
      await a.post('/entries', { kind: 'income', amount: 10000 * i, entry_date: dayIn(1, 9), outlet_id: s.id });
    }
    const d = (await a.get(`/dashboard${qs({ from: dayIn(1, 1), to: monthEnd(0) })}`)).body.data;
    expect(d.outlets.trend.keys).toHaveLength(8);
    expect(d.outlets.trend.keys.map((k) => k.name)).toContain('Other outlets (3)');
    for (const row of d.outlets.trend.investment) expect(sumKeys(row)).toBe(d.trend.find((t) => t.month === row.month).investment_added);
    expect(d.outlets.total).toBe(10);
    expect(d.outlets.totals.invested_total).toBe(5500000);
  });

  test('filters narrow every number together; the company cash balance and projected returns behave', async () => {
    const { token } = await setup();
    const a = api(token);
    expect((await authed(request(app).patch('/api/v1/novarex/settings'), token).send({ opening_balance: 1000000, opening_date: dayIn(4, 1) })).status).toBe(200);
    const s1 = (await a.post('/outlets', { name: 'One' })).body.data;
    const s2 = (await a.post('/outlets', { name: 'Two' })).body.data;
    await a.post('/entries', { kind: 'income', amount: 70000, entry_date: dayIn(1, 9), outlet_id: s1.id });
    await a.post('/entries', { kind: 'income', amount: 30000, entry_date: dayIn(1, 9), outlet_id: s2.id });
    await a.post('/projections', { name: 'Return plan', month: monthKey(0), line: 'principal_recovery', amount: 250000, outlet_id: s1.id, status: 'approved' });
    await a.post('/projections', { name: 'Earnings plan', month: monthKey(0), line: 'investment_earnings', amount: 40000, outlet_id: s2.id, status: 'approved' });
    await a.post('/projections', { name: 'Archived', month: monthKey(0), line: 'principal_recovery', amount: 999, status: 'archived' });
    const range = { from: dayIn(1, 1), to: monthEnd(1) };

    const all = (await a.get(`/dashboard${qs(range)}`)).body.data;
    const one = (await a.get(`/dashboard${qs({ ...range, outlet_id: s1.id })}`)).body.data;
    const two = (await a.get(`/dashboard${qs({ ...range, outlet_id: s2.id })}`)).body.data;
    expect([all.period.income, one.period.income, two.period.income]).toEqual([100000, 70000, 30000]);
    expect(one.period.income + two.period.income).toBe(all.period.income);
    expect(one.trend.find((t) => t.month === monthKey(1)).income).toBe(70000);
    expect(one.outlets.rows.filter((r) => r.outlet_id)).toHaveLength(1);

    // the cash balance belongs to the company, so a outlet view does not pretend to have one
    expect(all.cash_balance).toBe(1100000);
    expect(one.cash_balance).toBeNull();
    expect(one.cash_balance_company_only).toBe(true);

    // projected future returns = planned principal recovery + planned earnings (a plan; archived plans and money already received excluded)
    expect(all.projected_future).toMatchObject({ principal_recovery: 250000, earnings: 40000, returns: 290000 });
    expect(one.projected_future).toMatchObject({ principal_recovery: 250000, earnings: 0, returns: 250000 });
    expect(two.projected_future.returns).toBe(40000);
    // projections never became transactions
    expect((await a.get(`/entries${qs({ from: dayIn(0, 1), to: monthEnd(0) })}`)).body.data).toHaveLength(0);
  });
});
