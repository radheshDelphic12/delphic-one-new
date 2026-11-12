/**
 * Live Analytics > Earnings & profit: revenue, salary earned so far, expenses and profit up to today, month by month. Admin only.
 */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

let adminToken;
let recruiterToken;

beforeEach(async () => {
  await cleanDatabase();
  const org = await createOrg({ name: 'Delphic Global' });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  adminToken = (await loginAs(admin)).access_token;
  const recruiter = await createUser({ role: 'recruiter', withOrg: false });
  await createOrgMembership(recruiter.id, org.id, { role: 'recruiter' });
  recruiterToken = (await loginAs(recruiter)).access_token;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const get = (query = {}, token = adminToken) => authed(request(app).get('/api/v1/analytics/earnings-profit'), token).query(query);

describe('earnings and profit up to today', () => {
  test('the current month by default, with the totals and the as-of date', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const d = res.body.data;
    const now = new Date().toLocaleDateString('en-CA');
    expect(d.from).toBe(now.slice(0, 7));
    expect(d.to).toBe(now.slice(0, 7));
    expect(d.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.months).toHaveLength(1);
    expect(d.months[0]).toMatchObject({ open: true, source: 'live', revenue: 0, salaries_to_date: 0, expenses: 0, profit_to_date: 0, profit_full_month: 0 });
    expect(d.totals).toMatchObject({ revenue: 0, profit_to_date: 0 });
    expect(Array.isArray(d.revenue_breakdown)).toBe(true);
    expect(Array.isArray(d.expense_breakdown)).toBe(true);
  });

  test('a range gives one row per month, a past month is not open, and the range is capped at 12 months', async () => {
    const res = await get({ from: '2026-07', to: '2026-09' });
    expect(res.status).toBe(200);
    expect(res.body.data.months.map((m) => `${m.period_year}-${m.period_month}`)).toEqual(['2026-7', '2026-8', '2026-9']);
    expect(res.body.data.months.every((m) => m.open === false)).toBe(true);
    expect((await get({ from: '2024-01', to: '2026-12' })).body.data.months).toHaveLength(12);
  });

  test('earnings by team: the same months, an empty list when nobody earned, admin only', async () => {
    const res = await authed(request(app).get('/api/v1/analytics/earnings-by-team'), adminToken).query({ from: '2026-07', to: '2026-08' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ from: '2026-07', to: '2026-08', teams: [], totals: { revenue: 0, cost: 0, margin: 0 } });
    expect(res.body.data.months.map((m) => m.key)).toEqual(['2026-07', '2026-08']);
    expect((await authed(request(app).get('/api/v1/analytics/earnings-by-team'), adminToken).query({ from: '2026/07' })).status).toBe(422);
    expect((await authed(request(app).get('/api/v1/analytics/earnings-by-team'), recruiterToken)).status).toBe(403);
  });

  test('a bad month is refused and only an admin can read it', async () => {
    expect((await get({ from: '2026/07' })).status).toBe(422);
    expect((await get({}, recruiterToken)).status).toBe(403);
  });
});
