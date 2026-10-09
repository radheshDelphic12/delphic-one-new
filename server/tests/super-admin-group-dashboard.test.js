const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const { bucketOf } = require('../src/modules/superDashboard/groupFinance.service');

let group;
let delphic;
let gulati;
let zephyr;
let outsider; // a company of ANOTHER holding group
let superToken;
let adminToken; // plain company admin of `delphic`
const thisMonth = new Date().toISOString().slice(0, 7);
const base = '/api/v1/super-dashboard';

beforeEach(async () => {
  await cleanDatabase();
  delphic = await createOrg({ name: 'Alpha Global' });
  group = { id: delphic.org_group_id };
  gulati = await createOrg({ name: 'Beta Trading', org_group_id: group.id });
  zephyr = await createOrg({ name: 'Gamma Infra', org_group_id: group.id });
  await prisma.org.update({ where: { id: gulati.id }, data: { enabled_modules: ['gulati'] } });
  await prisma.org.update({ where: { id: zephyr.id }, data: { enabled_modules: ['zephyr'] } });
  outsider = await createOrg({ name: 'Other Group Co' });

  const superUser = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: superUser.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: superUser.id, org_group_id: group.id } });
  await createOrgMembership(superUser.id, delphic.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(superUser));

  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, delphic.id, { role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
});

afterAll(async () => {
  await prisma.$disconnect();
});

const put = (orgId, body) => authed(request(app).put(`${base}/companies/${orgId}/asset-values`), superToken).send(body);
const projection = (qs = '') => authed(request(app).get(`${base}/group/projection${qs}`), superToken);
const overview = async (qs = '') => { const r = await authed(request(app).get(`${base}/group/overview${qs}`), superToken); if (r.status >= 500) console.log(r.status, JSON.stringify(r.body)); return r; };

describe('super admin group dashboard', () => {
  test('only a group superadmin can read it; a company admin is refused', async () => {
    expect((await authed(request(app).get(`${base}/group/overview`), adminToken)).status).toBe(403);
    expect((await authed(request(app).get(`${base}/companies/${delphic.id}/asset-values`), adminToken)).status).toBe(403);
    expect((await authed(request(app).put(`${base}/companies/${delphic.id}/asset-values`), adminToken).send({ month: thisMonth, asset_value: 1 })).status).toBe(403);
    expect((await request(app).get(`${base}/group/overview`)).status).toBe(401);
    expect((await overview()).status).toBe(200);
  });

  test('lists every company of the group dynamically and never another group', async () => {
    const res = await overview();
    const names = res.body.data.companies.map((c) => c.org.name).sort();
    expect(names).toEqual(['Alpha Global', 'Beta Trading', 'Gamma Infra']);
    expect(res.body.data.totals.active_companies).toBe(3);
    // a fourth company in the group shows up with no code change
    await createOrg({ name: 'Delta New Co', org_group_id: group.id });
    expect((await overview()).body.data.companies.map((c) => c.org.name)).toContain('Delta New Co');
    // asking for a foreign company by id is ignored, not honoured
    const foreign = await overview(`?org_ids=${outsider.id}`);
    expect(foreign.body.data.companies).toHaveLength(0);
  });

  test('valuation = profit x 240 + asset value x 3 for each kind of company', async () => {
    for (const org of [delphic, gulati, zephyr]) {
      const r = await put(org.id, { month: thisMonth, asset_value: 5000000 });
      expect(r.status).toBe(200);
    }
    const res = await overview(`?from=${thisMonth}&to=${thisMonth}&state=all`);
    for (const c of res.body.data.companies) {
      expect(c.valuation.current).toBe(c.totals.profit * 240 + 5000000 * 3);
      expect(c.valuation.asset_component).toBe(15000000);
      expect(c.assets).toBe(5000000);
    }
    expect(res.body.data.totals.valuation).toBe(res.body.data.companies.reduce((s, c) => s + c.valuation.current, 0));
  });

  test('locked figures of a closed month feed profit and valuation (Gulati snapshot)', async () => {
    await prisma.gxPeriodClose.create({ data: { org_id: gulati.id, month: '2026-08', status: 'closed', snapshot: { net_profit: 1000, sales_revenue: 5000 }, closed_at: new Date() } });
    await put(gulati.id, { month: '2026-08', asset_value: 2000 });
    const res = await overview('?from=2026-08&to=2026-08&state=locked');
    const c = res.body.data.companies.find((x) => x.org.id === gulati.id);
    expect(c.totals).toMatchObject({ revenue: 5000, profit: 1000, expenses: 4000 });
    expect(c.valuation.current).toBe(1000 * 240 + 2000 * 3);
    expect(c.valuation.profit_component).toBe(240000);
    // other companies have nothing locked: zero profit, valuation from assets only
    const z = res.body.data.companies.find((x) => x.org.id === zephyr.id);
    expect(z.totals.profit).toBe(0);
  });

  test('asset value history is kept, a revision is audited with the previous value, duplicates update the same month', async () => {
    await put(zephyr.id, { month: '2026-08', asset_value: 100 });
    await put(zephyr.id, { month: '2026-09', asset_value: 200 });
    const revised = await put(zephyr.id, { month: '2026-09', asset_value: 250, notes: 'revalued' });
    expect(revised.body.data.previous).toBe(200);
    const list = await authed(request(app).get(`${base}/companies/${zephyr.id}/asset-values`), superToken);
    expect(list.body.data.map((r) => [r.month, r.asset_value])).toEqual([['2026-09', 250], ['2026-08', 100]]);
    const audit = await prisma.auditLog.findMany({ where: { org_id: zephyr.id, entity_type: 'asset_value' }, orderBy: { created_at: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['asset_value_create', 'asset_value_create', 'asset_value_update']);
    expect(audit[2].snapshot).toMatchObject({ previous: 200, new: 250, month: '2026-09' });
    // earlier month carried forward into a later month without its own figure
    const res = await overview('?from=2026-10&to=2026-10');
    expect(res.body.data.companies.find((c) => c.org.id === zephyr.id).months[0]).toMatchObject({ asset_value: 250, asset_value_carried: true });
  });

  test('asset value rules: future month, negative and foreign company are refused', async () => {
    const future = new Date();
    future.setUTCMonth(future.getUTCMonth() + 2);
    expect((await put(delphic.id, { month: future.toISOString().slice(0, 7), asset_value: 1 })).status).toBe(422);
    expect((await put(delphic.id, { month: thisMonth, asset_value: -5 })).status).toBe(422);
    expect((await put(outsider.id, { month: thisMonth, asset_value: 5 })).status).toBe(404);
    expect((await authed(request(app).get(`${base}/companies/${outsider.id}/asset-values`), superToken)).status).toBe(404);
  });

  test('zero asset and zero profit give zero valuation; growth is null when there is no previous value', async () => {
    const res = await overview(`?from=${thisMonth}&to=${thisMonth}`);
    for (const c of res.body.data.companies) {
      expect(c.valuation.current).toBe(0);
      expect(c.valuation.growth_pct).toBeNull();
    }
    await put(delphic.id, { month: '2026-01', asset_value: 100 });
    await put(delphic.id, { month: '2026-02', asset_value: 150 });
    const g = (await overview('?from=2026-01&to=2026-02')).body.data.companies.find((c) => c.org.id === delphic.id).valuation;
    expect(g).toMatchObject({ current: 450, previous: 300, change: 150, growth_pct: 50 });
  });

  test('quarter and year granularity use the Indian financial year', async () => {
    expect(bucketOf('2026-04', 'quarter')).toEqual({ key: '2026-1', label: 'FY2026-27 Q1' });
    expect(bucketOf('2026-03', 'quarter')).toEqual({ key: '2025-4', label: 'FY2025-26 Q4' });
    expect(bucketOf('2026-12', 'year').label).toBe('FY2026-27');
    await put(gulati.id, { month: '2026-04', asset_value: 10 });
    await put(gulati.id, { month: '2026-06', asset_value: 30 });
    const res = await overview('?from=2026-04&to=2026-06&granularity=quarter&org_ids=' + gulati.id);
    const c = res.body.data.companies[0];
    expect(c.series).toHaveLength(1);
    expect(c.series[0]).toMatchObject({ label: 'FY2026-27 Q1', asset_value: 30, valuation: 90 }); // point in time = last month
    expect((await overview('?granularity=daily')).status).toBe(422);
  });

  test('alerts use configurable thresholds and real data only', async () => {
    await prisma.gxPeriodClose.createMany({
      data: [
        { org_id: gulati.id, month: '2026-01', status: 'closed', snapshot: { net_profit: 1000, sales_revenue: 10000 }, closed_at: new Date() },
        { org_id: gulati.id, month: '2026-02', status: 'closed', snapshot: { net_profit: 500, sales_revenue: 6000 }, closed_at: new Date() },
      ],
    });
    const alerts = (await overview('?from=2026-01&to=2026-02&state=locked')).body.data.alerts.filter((a) => a.org_id === gulati.id).map((a) => a.type);
    expect(alerts).toEqual(expect.arrayContaining(['revenue_drop', 'profit_drop', 'valuation_drop']));
    const relaxed = (await overview('?from=2026-01&to=2026-02&state=locked&revenue_drop_pct=90&profit_drop_pct=90')).body.data.alerts.filter((a) => a.org_id === gulati.id).map((a) => a.type);
    expect(relaxed).not.toContain('revenue_drop');
    expect(relaxed).not.toContain('profit_drop');
  });

  test('contribution shares add up and rankings are ordered', async () => {
    await prisma.gxPeriodClose.create({ data: { org_id: gulati.id, month: '2026-03', status: 'closed', snapshot: { net_profit: 300, sales_revenue: 900 }, closed_at: new Date() } });
    await prisma.zxPeriodClose.create({ data: { org_id: zephyr.id, month: '2026-03', status: 'closed', snapshot: { summary: { profit: 100, revenue: 300 } }, closed_at: new Date() } });
    const d = (await overview('?from=2026-03&to=2026-03&state=locked')).body.data;
    expect(d.contribution.profit.find((r) => r.org_id === gulati.id).share_pct).toBe(75);
    expect(d.contribution.profit.find((r) => r.org_id === zephyr.id).share_pct).toBe(25);
    expect(d.rankings.revenue[0].org_id).toBe(gulati.id);
    expect(d.totals.profit).toBe(400);
    expect(d.totals.revenue).toBe(1200);
  });

  test('switching company: a superadmin gets an admin membership in their own group only', async () => {
    const memberships = await authed(request(app).get('/api/v1/orgs/me/memberships'), superToken);
    expect(memberships.body.data.map((m) => m.org.name).sort()).toEqual(['Alpha Global', 'Beta Trading', 'Gamma Infra']);
    const sw = await authed(request(app).post('/api/v1/auth/switch-org'), superToken).send({ org_id: zephyr.id });
    expect(sw.status).toBe(200);
    expect(sw.body.data.active_org.id).toBe(zephyr.id);
    const m = await prisma.orgMembership.findFirst({ where: { org_id: zephyr.id, role: 'admin' } });
    expect(m).not.toBeNull();
    const other = await authed(request(app).post('/api/v1/auth/switch-org'), superToken).send({ org_id: outsider.id });
    expect(other.status).toBe(403);
    // a plain company admin cannot hop into a sibling company
    const hop = await authed(request(app).post('/api/v1/auth/switch-org'), adminToken).send({ org_id: gulati.id });
    expect(hop.status).toBe(403);
  });

  test('group activity lists recent changes of group companies only', async () => {
    await put(gulati.id, { month: thisMonth, asset_value: 9 });
    await prisma.auditLog.create({ data: { org_id: outsider.id, actor_id: (await prisma.user.findFirst()).id, action: 'x', entity_type: 'y', entity_id: outsider.id, reason: 'foreign', snapshot: {} } });
    const res = await authed(request(app).get(`${base}/group/activity`), superToken);
    expect(res.status).toBe(200);
    expect(res.body.data.some((r) => r.action === 'asset_value_create' && r.company.name === 'Beta Trading')).toBe(true);
    expect(res.body.data.some((r) => r.detail === 'foreign')).toBe(false);
  });

  test('drill-down returns each company own breakdown, only inside the group', async () => {
    const q = '?from=2026-01&to=2026-03';
    for (const [org, key] of [[delphic, 'categories'], [gulati, 'deals'], [zephyr, 'projects']]) {
      const res = await authed(request(app).get(`${base}/companies/${org.id}/drilldown${q}`), superToken);
      expect(res.status).toBe(200);
      expect(res.body.data.sections[0].key).toBe(key);
      expect(Array.isArray(res.body.data.sections[0].rows)).toBe(true);
    }
    expect((await authed(request(app).get(`${base}/companies/${outsider.id}/drilldown${q}`), superToken)).status).toBe(404);
    expect((await authed(request(app).get(`${base}/companies/${gulati.id}/drilldown?from=2026-05&to=2026-01`), superToken)).status).toBe(422);
    expect((await authed(request(app).get(`${base}/companies/${gulati.id}/drilldown${q}`), adminToken)).status).toBe(403);
  });

  test('a company that is coming soon is listed but never counted, and cannot be opened', async () => {
    const soon = await createOrg({ name: 'Omega Finance', org_group_id: group.id });
    await prisma.org.update({ where: { id: soon.id }, data: { enabled_modules: ['coming_soon'] } });
    await put(gulati.id, { month: thisMonth, asset_value: 1000 });
    const d = (await overview(`?from=${thisMonth}&to=${thisMonth}`)).body.data;
    const row = d.companies.find((c) => c.org.id === soon.id);
    expect(row).toMatchObject({ coming_soon: true, has_data: false, valuation: null });
    expect(d.totals.active_companies).toBe(3);
    expect(d.totals.coming_soon_companies).toBe(1);
    expect(d.alerts.some((a) => a.org_id === soon.id)).toBe(false);
    expect(d.rankings.revenue.some((r) => r.org_id === soon.id)).toBe(false);
    const sw = await authed(request(app).post('/api/v1/auth/switch-org'), superToken).send({ org_id: soon.id });
    expect(sw.status).toBe(409);
    // the superadmin can flip it, and the company's other module markers survive
    const off = await authed(request(app).patch(`/api/v1/orgs/${gulati.id}/settings`), superToken).send({ coming_soon: true });
    expect(off.status).toBe(200);
    expect(off.body.data.enabled_modules.sort()).toEqual(['coming_soon', 'gulati']);
    const on = await authed(request(app).patch(`/api/v1/orgs/${gulati.id}/settings`), superToken).send({ coming_soon: false, enabled_modules: ['trading'] });
    expect(on.body.data.enabled_modules.sort()).toEqual(['gulati', 'trading']);
  });

  test('group cards carry the change against the previous period of the same length', async () => {
    await put(zephyr.id, { month: '2026-01', asset_value: 100 });
    await put(zephyr.id, { month: '2026-03', asset_value: 200 });
    const d = (await overview('?from=2026-03&to=2026-03')).body.data;
    expect(d.totals.previous.assets).toBeGreaterThanOrEqual(100);
    expect(d.totals.change_pct).toHaveProperty('valuation');
  });

  test('recent activity covers only the last 7 days', async () => {
    const actor = await prisma.user.findFirst();
    await prisma.auditLog.create({ data: { org_id: gulati.id, actor_id: actor.id, action: 'old', entity_type: 'x', entity_id: gulati.id, reason: 'ten days ago', snapshot: {}, created_at: new Date(Date.now() - 10 * 86400000) } });
    await prisma.auditLog.create({ data: { org_id: gulati.id, actor_id: actor.id, action: 'fresh', entity_type: 'x', entity_id: gulati.id, reason: 'today', snapshot: {} } });
    const rows = (await authed(request(app).get(`${base}/group/activity`), superToken)).body.data;
    expect(rows.some((r) => r.detail === 'today')).toBe(true);
    expect(rows.some((r) => r.detail === 'ten days ago')).toBe(false);
  });

  test('projection continues from the chosen end month, month by month, with the same valuation formula', async () => {
    // four closed Gulati months with a steady rise: revenue 1000, 2000, 3000, 4000 (costs 500 each month)
    for (const [i, m] of ['2026-05', '2026-06', '2026-07', '2026-08'].entries()) {
      await prisma.gxPeriodClose.create({ data: { org_id: gulati.id, month: m, status: 'closed', snapshot: { sales_revenue: 1000 * (i + 1), net_profit: 1000 * (i + 1) - 500 }, closed_at: new Date() } });
    }
    await put(gulati.id, { month: '2026-08', asset_value: 10000 });
    const res = await projection('?from=2026-05&to=2026-08&horizon=3&state=locked');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.projected_months).toEqual(['2026-09', '2026-10', '2026-11']);
    const g = d.companies.find((c) => c.org.id === gulati.id);
    expect(g.history.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);
    expect(g.history.map((m) => m.revenue)).toEqual([1000, 2000, 3000, 4000]);
    expect(g.projected.map((m) => m.revenue)).toEqual([5000, 6000, 7000]);
    expect(g.projected.map((m) => m.expenses)).toEqual([500, 500, 500]);
    for (const m of g.projected) expect(m.valuation).toBe(m.profit * 240 + 10000 * 3);
    expect(g.totals.projected_revenue).toBe(18000);
    expect(g.confidence).toBe('medium');
    // group totals add the live companies together, per month
    expect(d.group.projected.map((m) => m.month)).toEqual(d.projected_months);
    expect(d.group.totals.projected_revenue).toBe(d.companies.reduce((a2, c) => a2 + (c.totals?.projected_revenue || 0), 0));
    // a different end month moves the whole projection
    const earlier = (await projection('?from=2026-05&to=2026-07&horizon=2&state=locked')).body.data;
    expect(earlier.projected_months).toEqual(['2026-08', '2026-09']);
    expect(earlier.companies.find((c) => c.org.id === gulati.id).projected.map((m) => m.revenue)).toEqual([4000, 5000]);
  });

  test('projection filters: company subset, coming soon left out, bad ranges refused, company admin refused', async () => {
    const only = (await projection(`?org_ids=${gulati.id}&horizon=1`)).body.data;
    expect(only.companies.map((c) => c.org.id)).toEqual([gulati.id]);
    await prisma.org.update({ where: { id: zephyr.id }, data: { enabled_modules: ['zephyr', 'coming_soon'] } });
    const all = (await projection('')).body.data;
    expect(all.companies.find((c) => c.org.id === zephyr.id)).toMatchObject({ coming_soon: true, history: [], projected: [] });
    expect((await projection('?from=2026-08&to=2026-05')).status).toBeGreaterThanOrEqual(400);
    expect((await projection('?horizon=99')).status).toBeGreaterThanOrEqual(400);
    expect((await authed(request(app).get(`${base}/group/projection`), adminToken)).status).toBe(403);
  });

  test('every period filter of the group overview returns exactly its own months', async () => {
    const months = async (qs) => (await overview(qs)).body.data.companies[0].months.map((m) => m.month);
    expect(await months('?from=2026-04&to=2026-06')).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(await months('?from=2026-06&to=2026-06')).toEqual(['2026-06']);
    expect(await months('?from=2025-04&to=2026-03&granularity=quarter')).toHaveLength(12);
    const q = (await overview('?from=2025-04&to=2026-03&granularity=quarter')).body.data.companies[0].series;
    expect(q.map((r) => r.label)).toEqual(['FY2025-26 Q1', 'FY2025-26 Q2', 'FY2025-26 Q3', 'FY2025-26 Q4']);
    const y = (await overview('?from=2024-04&to=2026-03&granularity=year')).body.data.companies[0].series;
    expect(y.map((r) => r.label)).toEqual(['FY2024-25', 'FY2025-26']);
    expect((await overview('?from=2026-06&to=2026-04')).status).toBeGreaterThanOrEqual(400);
  });
});
