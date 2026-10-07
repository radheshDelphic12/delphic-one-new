// Fixed-bid projects: the rate is the one-time contract total, billed through several
// invoices capped at that total; locking a month (the existing lock) makes its invoices
// financially effective. Monthly projects are unaffected. Financial Trends: revenue,
// profit and valuation = (sub-company profit x 240) + (asset value x 3).
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const api = (path) => `/api/v1${path}`;
const SEP = { period_month: 9, period_year: 2026 };
const OCT = { period_month: 10, period_year: 2026 };

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Calendar', is_default: true } });
  const client = await prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: adminUser.id, org_id: org.id, industry: 'IT' } });
  return { org, adminUser, adminToken, client };
}

async function addProject(ctx, name, { category, rate_type, rate }) {
  const res = await authed(request(app).post(api('/calendars/projects')), ctx.adminToken).send({ name, service_category: category, client_account_id: ctx.client.id });
  expect(res.status).toBe(201);
  const patch = await authed(request(app).patch(api(`/billing/projects/${res.body.data.id}`)), ctx.adminToken).send({
    agreement_start_date: '2026-01-01',
    billing: { rate_type, rate, currency: 'INR' },
  });
  expect(patch.status).toBe(200);
  return patch.body.data;
}

const invoice = (ctx, accountId, period, amount, extra = {}) =>
  authed(request(app).post(api('/billing/invoices')), ctx.adminToken).send({ client_account_id: accountId, ...period, ...(amount !== undefined ? { amount } : {}), ...extra });
const lock = (ctx, accountId, period) => authed(request(app).post(api('/calculations/lock')), ctx.adminToken).send({ kind: 'billing', scope_key: accountId, ...period });
const profile = async (ctx, accountId) => (await authed(request(app).get(api(`/billing/projects/${accountId}`)), ctx.adminToken)).body.data;
const records = async (ctx, period, state = 'locked') => (await authed(request(app).get(api('/calculations/financials/records')), ctx.adminToken).query({ period_year: period.period_year, from_month: period.period_month, to_month: period.period_month, state })).body.data;

describe('Fixed-bid billing', () => {
  test('rate is a one-time contract value; several invoices capped at the total; lock makes them financial', async () => {
    const ctx = await seed();
    const project = await addProject(ctx, 'Fixed Co', { category: 'project', rate_type: 'one_time', rate: 500000 });
    expect(project).toMatchObject({ billing_type: 'one_time', rate: 500000, monthly_amount_inr: null });
    expect(project.fixed_bid).toMatchObject({ total: 500000, invoiced: 0, billed: 0, balance: 500000, remaining_to_invoice: 500000 });

    // September: a 1L invoice. A draft invoice is not financial yet.
    const first = await invoice(ctx, project.id, SEP, 100000, { invoice_number: 'F-001' });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ amount: 100000 });
    expect((await records(ctx, SEP)).totals.revenue).toBe(0);
    expect((await profile(ctx, project.id)).fixed_bid).toMatchObject({ invoiced: 100000, billed: 0, balance: 500000, remaining_to_invoice: 400000 });

    // Lock September -> it is Financials revenue for September, and the balance falls.
    expect((await lock(ctx, project.id, SEP)).status).toBe(200);
    const sep = await records(ctx, SEP);
    expect(sep.totals.revenue).toBe(100000);
    expect(sep.categories[0].children.find((c) => c.key === 'fixed_price').amount).toBe(100000);
    expect(sep.categories[0].children.find((c) => c.key === 'managed_services').amount).toBe(0);
    expect((await profile(ctx, project.id)).fixed_bid).toMatchObject({ billed: 100000, balance: 400000, remaining_to_invoice: 400000 });

    // A locked month takes no more invoices; the remaining balance is not revenue anywhere.
    expect((await invoice(ctx, project.id, SEP, 10000, { invoice_number: 'F-LATE' })).status).toBe(423);
    expect((await records(ctx, OCT)).totals.revenue).toBe(0);

    // October: 2L, then over the remaining balance is rejected, exactly the remainder is fine.
    expect((await invoice(ctx, project.id, OCT, 200000, { invoice_number: 'F-002' })).status).toBe(201);
    expect((await lock(ctx, project.id, OCT)).status).toBe(200);
    expect((await records(ctx, OCT)).totals.revenue).toBe(200000);
    expect((await profile(ctx, project.id)).fixed_bid).toMatchObject({ billed: 300000, balance: 200000 });

    const NOV = { period_month: 11, period_year: 2026 };
    const tooMuch = await invoice(ctx, project.id, NOV, 200001, { invoice_number: 'F-BIG' });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.message || tooMuch.body.error).toMatch(/200000/);
    expect((await invoice(ctx, project.id, NOV, 200000, { invoice_number: 'F-003' })).status).toBe(201);
    // Fully invoiced: nothing more, even a cent.
    expect((await invoice(ctx, project.id, NOV, 0.01, { invoice_number: 'F-CENT' })).status).toBe(422);
    expect((await profile(ctx, project.id)).fixed_bid).toMatchObject({ invoiced: 500000, remaining_to_invoice: 0 });
  });

  test('several invoices in one month; an edit cannot push past the contract; balances are per project', async () => {
    const ctx = await seed();
    const a = await addProject(ctx, 'Project A', { category: 'project', rate_type: 'one_time', rate: 400000 });
    const b = await addProject(ctx, 'Project B', { category: 'project', rate_type: 'one_time', rate: 100000 });
    const one = await invoice(ctx, a.id, SEP, 100000, { invoice_number: 'A-1' });
    const two = await invoice(ctx, a.id, SEP, 150000, { invoice_number: 'A-2' });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(one.body.data.id).not.toBe(two.body.data.id);
    expect((await profile(ctx, a.id)).fixed_bid.remaining_to_invoice).toBe(150000);
    expect((await profile(ctx, b.id)).fixed_bid).toMatchObject({ invoiced: 0, remaining_to_invoice: 100000 });

    const over = await authed(request(app).patch(api(`/billing/invoices/${two.body.data.id}`)), ctx.adminToken).send({ amount: 300001 });
    expect(over.status).toBe(422);
    const within = await authed(request(app).patch(api(`/billing/invoices/${two.body.data.id}`)), ctx.adminToken).send({ amount: 300000 });
    expect(within.status).toBe(200);

    // Locking the month finalizes both of the month's invoices together.
    expect((await lock(ctx, a.id, SEP)).status).toBe(200);
    expect((await records(ctx, SEP)).totals.revenue).toBe(400000);
    expect((await authed(request(app).delete(api(`/billing/invoices/${one.body.data.id}`)), ctx.adminToken)).status).toBe(423);
  });

  test('monthly projects keep monthly billing: no fixed-bid balance, one invoice per month', async () => {
    const ctx = await seed();
    const monthly = await addProject(ctx, 'Managed Co', { category: 'managed_services', rate_type: 'monthly', rate: 400000 });
    expect(monthly).toMatchObject({ billing_type: 'monthly', rate: 400000, fixed_bid: null });
    expect(monthly.monthly_amount_inr).toBe(400000);
    const first = await invoice(ctx, monthly.id, { period_month: 8, period_year: 2026 }, undefined, { invoice_number: 'M-1' });
    expect(first.status).toBe(201);
    expect(first.body.data.amount).toBe(400000);
    const again = await invoice(ctx, monthly.id, { period_month: 8, period_year: 2026 }, undefined, { invoice_number: 'M-1' });
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(await prisma.clientInvoice.count({ where: { client_account_id: monthly.id } })).toBe(1);
  });
});

describe('Financial trends', () => {
  test('revenue, profit and valuation = sub-company profit x 240 + asset value x 3, month on month', async () => {
    const ctx = await seed();
    const fixed = await addProject(ctx, 'Fixed Co', { category: 'project', rate_type: 'one_time', rate: 500000 });
    await invoice(ctx, fixed.id, SEP, 100000, { invoice_number: 'T-1' });
    await lock(ctx, fixed.id, SEP);

    // A sub-company in the same group with a profit of 1,000 in September 2026.
    const sub = await createOrg({ org_group_id: ctx.org.org_group_id, name: 'Sub Co', is_master_workspace: false });
    const subAdmin = await createUser({ role: 'admin' });
    const project = await prisma.selfProject.create({ data: { org_id: sub.id, name: 'Site', created_by: subAdmin.id } });
    await prisma.projectFinanceEntry.create({ data: { org_id: sub.id, project_id: project.id, entry_type: 'revenue', amount: 1000, entry_date: new Date('2026-09-15'), created_by: subAdmin.id } });

    const put = await authed(request(app).put(api('/financials/asset-values')), ctx.adminToken).send({ period_month: 8, period_year: 2026, asset_value: 5000 });
    expect(put.status).toBe(200);

    // Use "now" = Oct 2026 so the window ends in a known month.
    const financials = require('../src/modules/financials/financials.service');
    const result = await financials.trends(ctx.org.id, { months: 3, state: 'locked' }, new Date('2026-10-20T00:00:00Z'));
    expect(result.months.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    const [aug, sep, oct] = result.months;
    expect(aug).toMatchObject({ revenue: 0, sub_company_profit: 0, asset_value: 5000, asset_value_carried: false, valuation: 15000 });
    expect(sep).toMatchObject({ revenue: 100000, profit: 100000, sub_company_profit: 1000, asset_value: 5000, asset_value_carried: true, valuation: 1000 * 240 + 5000 * 3 });
    expect(oct).toMatchObject({ revenue: 0, sub_company_profit: 0, valuation: 15000 });
    expect(financials.valuationOf(2, 3)).toBe(489);

    // And over HTTP.
    const http = await authed(request(app).get(api('/financials/trends')), ctx.adminToken).query({ months: 3 });
    expect(http.status).toBe(200);
    expect(http.body.data.months).toHaveLength(3);
  });
});
