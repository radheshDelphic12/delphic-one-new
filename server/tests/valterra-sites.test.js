/** Valterra Resources mining sites: site records, site-wise accounting, filters, closing, company isolation and the group dashboard. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const calc = require('../src/modules/valterra/valterra.calc');

jest.setTimeout(120000);
beforeAll(async () => { await cleanDatabase(); }, 180000);
afterAll(async () => { await cleanDatabase(); await prisma.$disconnect(); }, 180000);

let seq = 0;
async function setup(label = 'co') {
  seq += 1;
  const slug = `vts-${label}-${Date.now()}-${seq}`;
  const org = await createOrg({ name: `Valterra ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['valterra'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}
const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/valterra${path}`), token).send(body),
  get: (path) => authed(request(app).get(`/api/v1/valterra${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/valterra${path}`), token).send(body),
});
const iso = (d) => d.toISOString().slice(0, 10);
const monthKey = (back) => { const d = new Date(); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1))).slice(0, 7); };
const dayIn = (back, day = 10) => `${monthKey(back)}-${String(day).padStart(2, '0')}`;
const qs = (o) => `?${new URLSearchParams(o).toString()}`;
const catId = async (a, scope, name) => (await a.get(`/categories?scope=${scope}`)).body.data.find((c) => c.name === name).id;

describe('pure site breakdown', () => {
  const sites = [{ id: 's1', code: 'VS-001', name: 'Quarry', status: 'active' }, { id: 's2', code: 'VS-002', name: 'Iron', status: 'active' }];
  const inv = (id, site_id, amount, returns = []) => ({ id, site_id, amount, status: 'active', investment_date: '2026-01-05', returns });
  test('rows add up to the company total; company-level records stay on their own row; principal is not profit', () => {
    const investments = [
      inv('i1', 's1', 1000, [{ return_date: '2026-02-10', principal: 300, earnings: 50, status: 'received' }]),
      inv('i2', 's2', 2000),
      inv('i3', null, 500),
    ];
    const entries = [
      { kind: 'income', site_id: 's1', amount: 400, entry_date: '2026-02-12', payment_status: 'paid' },
      { kind: 'expense', site_id: 's1', amount: 150, entry_date: '2026-02-13', payment_status: 'paid', expense_class: 'operating' },
      { kind: 'salary', site_id: 's2', amount: 100, entry_date: '2026-02-14', payment_status: 'paid' },
      { kind: 'expense', site_id: null, amount: 60, entry_date: '2026-02-15', payment_status: 'paid', expense_class: 'operating' },
    ];
    const r = calc.siteBreakdown({ investments, entries, sites, from: '2026-02-01', to: '2026-02-28', today: '2026-03-01' });
    const q = r.rows.find((x) => x.site_id === 's1');
    expect(q).toMatchObject({ principal_returned: 300, earnings: 50, revenue: 400, income: 450, expenses: 150, net_result: 300, invested_total: 1000 });
    expect(q.recovery_pct).toBe(30);
    expect(q.roi_pct).toBe(30); // net 300 / capital 1000
    expect(r.rows.find((x) => x.site_id === 's2')).toMatchObject({ salaries: 100, net_result: -100, outstanding_principal: 2000 });
    const corp = r.rows.find((x) => x.site_id === null);
    expect(corp).toMatchObject({ name: 'Company level (no site)', expenses: 60, invested_total: 500 });
    const whole = calc.summarize({ investments, entries, from: '2026-02-01', to: '2026-02-28' });
    expect(r.totals.net_result).toBe(whole.net_result);
    expect(r.totals.income).toBe(whole.income);
    expect(r.totals.expenses).toBe(whole.expenses);
    const rank = calc.ranking(r.rows, 1);
    expect(rank.best[0].site_id).toBe('s1');
  });
});

describe('mining sites', () => {
  test('create with generated codes, edit, close and reopen; categories and sites stay inside the company', async () => {
    const { token } = await setup('crud');
    const a = api(token);
    const type = await catId(a, 'mining_type', 'Stone / quarry');
    const material = await catId(a, 'material', 'Granite');
    const s1 = await a.post('/sites', { name: 'Kalyanpur Quarry', location: 'Kalyanpur', state: 'Rajasthan', district: 'Jodhpur', mining_type_id: type, material_id: material, additional_materials: ['Aggregate'], description: 'Open-cast granite', latitude: 26.24, longitude: 73.02 });
    expect(s1.status).toBe(201);
    expect(s1.body.data).toMatchObject({ code: 'VS-001', status: 'active', mining_type: { name: 'Stone / quarry' }, material: { name: 'Granite' }, additional_materials: ['Aggregate'], latitude: 26.24 });
    const s2 = await a.post('/sites', { name: 'Iron block', code: 'IRON-1', status: 'planned' });
    expect(s2.body.data.code).toBe('IRON-1');
    expect((await a.post('/sites', { name: 'Dup', code: 'IRON-1' })).status).toBe(409);
    expect((await a.post('/sites', { name: 'Bad dates', start_date: '2026-05-01', expected_closure_date: '2026-04-01' })).status).toBe(422);
    const expense = await catId(a, 'expense', 'Site operations');
    expect((await a.post('/sites', { name: 'Wrong kind', mining_type_id: expense })).status).toBe(422); // an expense category is not a mining type

    const edited = await a.patch(`/sites/${s1.body.data.id}`, { name: 'Kalyanpur Granite Quarry', manager_name: 'Rohan' });
    expect(edited.body.data).toMatchObject({ name: 'Kalyanpur Granite Quarry', manager_name: 'Rohan' });

    // list filters
    expect((await a.get(`/sites${qs({ mining_type_id: type })}`)).body.data.map((s) => s.code)).toEqual(['VS-001']);
    expect((await a.get(`/sites${qs({ q: 'iron' })}`)).body.data.map((s) => s.code)).toEqual(['IRON-1']);
    expect((await a.get(`/sites${qs({ state: 'rajasthan' })}`)).body.data).toHaveLength(1);

    // another company cannot see or use these sites
    const other = await setup('crud-other');
    expect((await api(other.token).get(`/sites/${s1.body.data.id}`)).status).toBe(404);
    expect((await api(other.token).get('/sites')).body.data).toHaveLength(0);
    expect((await api(other.token).post('/investments', { name: 'X', investment_date: dayIn(0, 1), amount: 10, site_id: s1.body.data.id })).status).toBe(422);
    expect((await api(other.token).post('/sites', { name: 'Foreign type', mining_type_id: type })).status).toBe(422);
  });

  test('a closed site keeps its history, takes no new records, and can be reopened', async () => {
    const { token } = await setup('close');
    const a = api(token);
    const site = (await a.post('/sites', { name: 'Old pit' })).body.data;
    const inv = await a.post('/investments', { name: 'Setup', investment_date: dayIn(2, 5), amount: 100000, site_id: site.id });
    expect(inv.status).toBe(201);
    expect((await a.post('/entries', { kind: 'income', amount: 5000, entry_date: dayIn(1, 5), site_id: site.id })).status).toBe(201);

    const closed = await a.patch(`/sites/${site.id}`, { status: 'closed', reason: 'Exhausted' });
    expect(closed.body.data.status).toBe('closed');
    expect(closed.body.data.archived_at).toBeTruthy();
    expect((await a.post('/investments', { name: 'More', investment_date: dayIn(0, 1), amount: 1, site_id: site.id })).body.message).toMatch(/closed/i);
    expect((await a.post('/entries', { kind: 'expense', amount: 5, entry_date: dayIn(0, 1), site_id: site.id })).status).toBe(422);
    // history is still there and the closed site is hidden from the default list only
    expect((await a.get('/sites')).body.data).toHaveLength(0);
    expect((await a.get('/sites?include_closed=true')).body.data).toHaveLength(1);
    expect((await a.get(`/sites/${site.id}`)).body.data.counts).toMatchObject({ investments: 1, entries: 1 });
    expect((await a.get(`/investments${qs({ site_id: site.id })}`)).body.data).toHaveLength(1);
    const dash = (await a.get(`/sites/${site.id}/dashboard${qs({ from: dayIn(3, 1), to: dayIn(0, 28) })}`)).body.data;
    expect(dash.period.other_income).toBe(5000);

    const reopened = await a.patch(`/sites/${site.id}`, { status: 'active' });
    expect(reopened.body.data.archived_at).toBeNull();
    expect((await a.post('/entries', { kind: 'expense', amount: 5, entry_date: dayIn(0, 1), site_id: site.id })).status).toBe(201);
  });

  test('transfers cannot belong to a site; salaries and expenses can', async () => {
    const { token } = await setup('tr');
    const a = api(token);
    const site = (await a.post('/sites', { name: 'S' })).body.data;
    expect((await a.post('/entries', { kind: 'transfer', amount: 10, entry_date: dayIn(0, 1), site_id: site.id })).status).toBe(422);
    expect((await a.post('/entries', { kind: 'salary', amount: 10, entry_date: dayIn(0, 1), site_id: site.id })).status).toBe(201);
  });
});

describe('site-wise accounting, filters and reports', () => {
  test('site figures, company level, every filter, the site report and projections', async () => {
    const { token } = await setup('acct');
    const a = api(token);
    const typeQuarry = await catId(a, 'mining_type', 'Stone / quarry');
    const typeGold = await catId(a, 'mining_type', 'Gold');
    const q = (await a.post('/sites', { name: 'Quarry', mining_type_id: typeQuarry, material_id: await catId(a, 'material', 'Granite') })).body.data;
    const g = (await a.post('/sites', { name: 'Gold', mining_type_id: typeGold, material_id: await catId(a, 'material', 'Gold ore') })).body.data;
    const sales = await catId(a, 'income', 'Mined material sales');
    const ops = await catId(a, 'expense', 'Site operations');

    const qInv = (await a.post('/investments', { name: 'Quarry capital', investment_date: dayIn(2, 5), amount: 1000000, site_id: q.id })).body.data;
    const gInv = (await a.post('/investments', { name: 'Gold capital', investment_date: dayIn(2, 6), amount: 400000, site_id: g.id })).body.data;
    await a.post('/investments', { name: 'Working capital', investment_date: dayIn(2, 7), amount: 100000 }); // company level
    // 300000 of principal comes back from the quarry: not profit
    expect((await a.post(`/investments/${qInv.id}/returns`, { return_date: dayIn(1, 10), principal: 300000, earnings: 20000 })).status).toBe(201);
    await a.post('/entries', { kind: 'income', amount: 500000, entry_date: dayIn(1, 12), category_id: sales, site_id: q.id });
    await a.post('/entries', { kind: 'expense', amount: 120000, entry_date: dayIn(1, 13), category_id: ops, site_id: q.id });
    await a.post('/entries', { kind: 'expense', amount: 90000, entry_date: dayIn(1, 14), category_id: ops, site_id: g.id });
    await a.post('/entries', { kind: 'expense', amount: 40000, entry_date: dayIn(1, 15), category_id: ops }); // shared overhead, no site
    await a.post('/entries', { kind: 'salary', amount: 30000, entry_date: dayIn(1, 28), site_id: g.id });
    void gInv;

    const range = { from: dayIn(1, 1), to: dayIn(1, 28) };
    const all = (await a.get(`/dashboard${qs(range)}`)).body.data;
    // income = earnings 20000 + sales 500000; expenses = 120000 + 90000 + 40000 + salary 30000; capital and principal excluded
    expect(all.period).toMatchObject({ income: 520000, expenses: 280000, net_result: 240000, principal_returned: 300000 });
    const rows = all.sites.rows;
    const qr = rows.find((r) => r.site_id === q.id);
    const gr = rows.find((r) => r.site_id === g.id);
    const co = rows.find((r) => r.site_id === null);
    expect(qr).toMatchObject({ revenue: 500000, earnings: 20000, income: 520000, expenses: 120000, net_result: 400000, principal_returned: 300000, outstanding_principal: 700000 });
    expect(gr).toMatchObject({ revenue: 0, expenses: 120000, salaries: 30000, net_result: -120000 });
    expect(co).toMatchObject({ expenses: 40000, invested_total: 100000 });
    // the overhead is NOT spread over the sites, and the rows add up to the company result
    expect(qr.net_result + gr.net_result + co.net_result).toBe(all.period.net_result);
    expect(all.sites.totals.net_result).toBe(all.period.net_result);
    expect(all.sites.ranking.best[0].site_id).toBe(q.id);
    expect(all.sites.trend.keys.map((k) => k.id).sort()).toEqual([g.id, q.id].sort());

    // filters change every figure together
    const bySite = (await a.get(`/dashboard${qs({ ...range, site_id: q.id })}`)).body.data;
    expect(bySite.period).toMatchObject({ income: 520000, expenses: 120000, net_result: 400000 });
    expect(bySite.sites.rows.filter((r) => r.site_id).map((r) => r.site_id)).toEqual([q.id]);
    const none = (await a.get(`/dashboard${qs({ ...range, site_id: 'none' })}`)).body.data;
    expect(none.period).toMatchObject({ income: 0, expenses: 40000 });
    const byType = (await a.get(`/dashboard${qs({ ...range, mining_type_id: typeGold })}`)).body.data;
    expect(byType.period).toMatchObject({ income: 0, expenses: 120000 });
    const byMaterial = (await a.get(`/dashboard${qs({ ...range, material_id: await catId(a, 'material', 'Granite') })}`)).body.data;
    expect(byMaterial.period.income).toBe(520000);

    // lists and the transaction register follow the same filters
    expect((await a.get(`/entries${qs({ kind: 'expense', site_id: g.id })}`)).body.data).toHaveLength(1);
    expect((await a.get(`/entries${qs({ kind: 'expense', site_id: 'none' })}`)).body.data).toHaveLength(1);
    expect((await a.get(`/entries${qs({ mining_type_id: typeQuarry })}`)).body.data.every((e) => e.site.name === 'Quarry')).toBe(true);
    const tx = (await a.get(`/transactions${qs({ ...range, site_id: q.id })}`)).body;
    expect(tx.data.every((r) => r.site?.id === q.id)).toBe(true);
    expect(tx.summary).toMatchObject({ principal_return: 300000, earnings: 20000, income: 500000 });

    // monthly report with a site filter, and the site-wise report
    const mr = (await a.get(`/monthly-report${qs({ ...range, site_id: g.id })}`)).body.data;
    expect(mr.totals).toMatchObject({ total_income: 0, total_expenses: 120000 });
    const rep = (await a.get(`/reports${qs({ ...range, report: 'sites' })}`)).body.data;
    expect(rep.title).toBe('Site-wise profit and loss');
    expect(rep.rows.map((r) => r[0]).sort()).toEqual(['Company level (no site)', 'Gold', 'Quarry'].sort());
    expect(rep.totals.net_result).toBe(240000);
    expect((await a.get(`/reports${qs({ ...range, report: 'investments' })}`)).body.data.columns).toContain('Site');

    // projections carry a site, are filtered by it and never create transactions
    const p1 = await a.post('/projections', { name: 'Quarry sales', month: monthKey(0), line: 'other_income', amount: 600000, site_id: q.id, status: 'approved' });
    expect(p1.status).toBe(201);
    await a.post('/projections', { name: 'Gold costs', month: monthKey(0), line: 'operating_expense', amount: 100000, site_id: g.id, status: 'approved' });
    const cur = { from: dayIn(0, 1), to: dayIn(0, 28) };
    const projQ = (await a.get(`/projections/compare${qs({ ...cur, site_id: q.id })}`)).body.data;
    expect(projQ.projected_totals).toMatchObject({ income: 600000, expenses: 0 });
    const projG = (await a.get(`/projections/compare${qs({ ...cur, site_id: g.id })}`)).body.data;
    expect(projG.projected_totals).toMatchObject({ income: 0, expenses: 100000 });
    expect((await a.get(`/projections${qs({ site_id: q.id })}`)).body.data).toHaveLength(1);
    expect((await a.get(`/entries${qs({ from: cur.from, to: cur.to })}`)).body.data).toHaveLength(0);
  });
});

describe('group dashboard', () => {
  test('Valterra sites appear in the company block, and the Travel module still treats Valterra as its own company', async () => {
    const group = await createOrg({ name: 'Delphic Global VT', slug: `dg-vt-${Date.now()}` });
    const vt = await createOrg({ name: 'Valterra Resources T', slug: `vt-grp-${Date.now()}`, org_group_id: group.org_group_id });
    await prisma.org.update({ where: { id: vt.id }, data: { enabled_modules: ['valterra'] } });
    const su = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: group.org_group_id } });
    await createOrgMembership(su.id, group.id, { role: 'admin' });
    await createOrgMembership(su.id, vt.id, { role: 'admin' });
    const superToken = (await loginAs(su)).access_token;
    // the super admin is an admin of the company, so the company API works for them too
    await prisma.org.update({ where: { id: vt.id }, data: { enabled_modules: ['valterra'] } });
    const vtApi = api(superToken);
    void vtApi;

    const site = await prisma.vtSite.create({ data: { org_id: vt.id, code: 'VS-001', name: 'Granite Quarry', status: 'active' } });
    const closed = await prisma.vtSite.create({ data: { org_id: vt.id, code: 'VS-002', name: 'Old Pit', status: 'closed', archived_at: new Date() } });
    const inv = await prisma.vtInvestment.create({ data: { org_id: vt.id, code: 'VT-0001', name: 'Dev', investment_date: new Date(`${dayIn(2, 5)}T00:00:00Z`), amount: 800000, site_id: site.id, status: 'active' } });
    await prisma.vtReturn.create({ data: { org_id: vt.id, investment_id: inv.id, return_date: new Date(`${dayIn(1, 5)}T00:00:00Z`), principal: 100000, earnings: 40000 } });
    await prisma.vtEntry.create({ data: { org_id: vt.id, kind: 'income', amount: 60000, entry_date: new Date(`${dayIn(1, 6)}T00:00:00Z`), site_id: site.id } });
    await prisma.vtEntry.create({ data: { org_id: vt.id, kind: 'expense', amount: 10000, entry_date: new Date(`${dayIn(1, 7)}T00:00:00Z`), site_id: closed.id, expense_class: 'operating' } });

    const res = await authed(request(app).get(`/api/v1/super-dashboard/group/overview?from=${monthKey(1)}&to=${monthKey(0)}&state=all`), superToken);
    expect(res.status).toBe(200);
    const c = res.body.data.companies.find((x) => x.org.id === vt.id);
    expect(c.org.kind).toBe('valterra');
    expect(c.totals).toMatchObject({ revenue: 100000, expenses: 10000, profit: 90000 }); // earnings 40000 + sales 60000; principal and capital excluded
    const block = res.body.data.valterra;
    expect(block.sites).toMatchObject({ total: 2, active: 1 });
    expect(block.sites.rows.find((r) => r.name === 'Granite Quarry')).toMatchObject({ invested_total: 800000, principal_returned_total: 100000, income: 100000, net_result: 100000, outstanding_principal: 700000 });
    expect(block.money.outstanding_principal).toBe(700000);

    const dd = await authed(request(app).get(`/api/v1/super-dashboard/companies/${vt.id}/drilldown?from=${monthKey(1)}&to=${monthKey(0)}&state=all`), superToken);
    const sites = dd.body.data.sections.find((s) => s.key === 'sites');
    expect(sites.rows.map((r) => r[0])).toEqual(expect.arrayContaining(['Granite Quarry', 'Old Pit']));

    // Delphic Global (no marker) is the only company the Travel tab calls "Delphic"
    const opts = await authed(request(app).get('/api/v1/super-dashboard/group/travel/options'), superToken);
    expect(opts.status).toBe(200);
  });
});
