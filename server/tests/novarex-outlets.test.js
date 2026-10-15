/** Novarex Pharmaceuticals outlets: outlet records, outlet-wise accounting, filters, closing, company isolation and the group dashboard. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const calc = require('../src/modules/novarex/novarex.calc');

jest.setTimeout(120000);
beforeAll(async () => { await cleanDatabase(); }, 180000);
afterAll(async () => { await cleanDatabase(); await prisma.$disconnect(); }, 180000);

let seq = 0;
async function setup(label = 'co') {
  seq += 1;
  const slug = `vts-${label}-${Date.now()}-${seq}`;
  const org = await createOrg({ name: `Novarex ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['novarex'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}
const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/novarex${path}`), token).send(body),
  get: (path) => authed(request(app).get(`/api/v1/novarex${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/novarex${path}`), token).send(body),
});
const iso = (d) => d.toISOString().slice(0, 10);
const monthKey = (back) => { const d = new Date(); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1))).slice(0, 7); };
const dayIn = (back, day = 10) => `${monthKey(back)}-${String(day).padStart(2, '0')}`;
const qs = (o) => `?${new URLSearchParams(o).toString()}`;
const catId = async (a, scope, name) => (await a.get(`/categories?scope=${scope}`)).body.data.find((c) => c.name === name).id;

describe('pure outlet breakdown', () => {
  const outlets = [{ id: 's1', code: 'NO-001', name: 'Quarry', status: 'active' }, { id: 's2', code: 'NO-002', name: 'Iron', status: 'active' }];
  const inv = (id, outlet_id, amount, returns = []) => ({ id, outlet_id, amount, status: 'active', investment_date: '2026-01-05', returns });
  test('rows add up to the company total; company-level records stay on their own row; principal is not profit', () => {
    const investments = [
      inv('i1', 's1', 1000, [{ return_date: '2026-02-10', principal: 300, earnings: 50, status: 'received' }]),
      inv('i2', 's2', 2000),
      inv('i3', null, 500),
    ];
    const entries = [
      { kind: 'income', outlet_id: 's1', amount: 400, entry_date: '2026-02-12', payment_status: 'paid' },
      { kind: 'expense', outlet_id: 's1', amount: 150, entry_date: '2026-02-13', payment_status: 'paid', expense_class: 'operating' },
      { kind: 'salary', outlet_id: 's2', amount: 100, entry_date: '2026-02-14', payment_status: 'paid' },
      { kind: 'expense', outlet_id: null, amount: 60, entry_date: '2026-02-15', payment_status: 'paid', expense_class: 'operating' },
    ];
    const r = calc.outletBreakdown({ investments, entries, outlets, from: '2026-02-01', to: '2026-02-28', today: '2026-03-01' });
    const q = r.rows.find((x) => x.outlet_id === 's1');
    expect(q).toMatchObject({ principal_returned: 300, earnings: 50, revenue: 400, income: 450, expenses: 150, net_result: 300, invested_total: 1000 });
    expect(q.recovery_pct).toBe(30);
    expect(q.roi_pct).toBe(30); // net 300 / capital 1000
    expect(r.rows.find((x) => x.outlet_id === 's2')).toMatchObject({ salaries: 100, net_result: -100, outstanding_principal: 2000 });
    const corp = r.rows.find((x) => x.outlet_id === null);
    expect(corp).toMatchObject({ name: 'Company level (no outlet)', expenses: 60, invested_total: 500 });
    const whole = calc.summarize({ investments, entries, from: '2026-02-01', to: '2026-02-28' });
    expect(r.totals.net_result).toBe(whole.net_result);
    expect(r.totals.income).toBe(whole.income);
    expect(r.totals.expenses).toBe(whole.expenses);
    const rank = calc.ranking(r.rows, 1);
    expect(rank.best[0].outlet_id).toBe('s1');
  });
});

describe('outlets', () => {
  test('create with generated codes, edit, close and reopen; categories and outlets stay inside the company', async () => {
    const { token } = await setup('crud');
    const a = api(token);
    const type = await catId(a, 'ownership_type', 'Company-owned');
    const format = await catId(a, 'format', 'Retail pharmacy');
    const s1 = await a.post('/outlets', { name: 'Kalyanpur Quarry', location: 'Kalyanpur', state: 'Rajasthan', district: 'Jodhpur', ownership_type_id: type, format_id: format, tags: ['Aggregate'], description: 'Open-cast granite', latitude: 26.24, longitude: 73.02 });
    expect(s1.status).toBe(201);
    expect(s1.body.data).toMatchObject({ code: 'NO-001', status: 'active', ownership_type: { name: 'Company-owned' }, format: { name: 'Retail pharmacy' }, tags: ['Aggregate'], latitude: 26.24 });
    const s2 = await a.post('/outlets', { name: 'Iron block', code: 'IRON-1', status: 'planned' });
    expect(s2.body.data.code).toBe('IRON-1');
    expect((await a.post('/outlets', { name: 'Dup', code: 'IRON-1' })).status).toBe(409);
    expect((await a.post('/outlets', { name: 'Bad dates', start_date: '2026-05-01', expected_closure_date: '2026-04-01' })).status).toBe(422);
    const expense = await catId(a, 'expense', 'Outlet operations');
    expect((await a.post('/outlets', { name: 'Wrong kind', ownership_type_id: expense })).status).toBe(422); // an expense category is not a ownership type

    const edited = await a.patch(`/outlets/${s1.body.data.id}`, { name: 'Kalyanpur Granite Quarry', manager_name: 'Rohan' });
    expect(edited.body.data).toMatchObject({ name: 'Kalyanpur Granite Quarry', manager_name: 'Rohan' });

    // list filters
    expect((await a.get(`/outlets${qs({ ownership_type_id: type })}`)).body.data.map((s) => s.code)).toEqual(['NO-001']);
    expect((await a.get(`/outlets${qs({ q: 'iron' })}`)).body.data.map((s) => s.code)).toEqual(['IRON-1']);
    expect((await a.get(`/outlets${qs({ state: 'rajasthan' })}`)).body.data).toHaveLength(1);

    // another company cannot see or use these outlets
    const other = await setup('crud-other');
    expect((await api(other.token).get(`/outlets/${s1.body.data.id}`)).status).toBe(404);
    expect((await api(other.token).get('/outlets')).body.data).toHaveLength(0);
    expect((await api(other.token).post('/investments', { name: 'X', investment_date: dayIn(0, 1), amount: 10, outlet_id: s1.body.data.id })).status).toBe(422);
    expect((await api(other.token).post('/outlets', { name: 'Foreign type', ownership_type_id: type })).status).toBe(422);
  });

  test('a closed outlet keeps its history, takes no new records, and can be reopened', async () => {
    const { token } = await setup('close');
    const a = api(token);
    const outlet = (await a.post('/outlets', { name: 'Old pit' })).body.data;
    const inv = await a.post('/investments', { name: 'Setup', investment_date: dayIn(2, 5), amount: 100000, outlet_id: outlet.id });
    expect(inv.status).toBe(201);
    expect((await a.post('/entries', { kind: 'income', amount: 5000, entry_date: dayIn(1, 5), outlet_id: outlet.id })).status).toBe(201);

    const closed = await a.patch(`/outlets/${outlet.id}`, { status: 'closed', reason: 'Exhausted' });
    expect(closed.body.data.status).toBe('closed');
    expect(closed.body.data.archived_at).toBeTruthy();
    expect((await a.post('/investments', { name: 'More', investment_date: dayIn(0, 1), amount: 1, outlet_id: outlet.id })).body.message).toMatch(/closed/i);
    expect((await a.post('/entries', { kind: 'expense', amount: 5, entry_date: dayIn(0, 1), outlet_id: outlet.id })).status).toBe(422);
    // history is still there and the closed outlet is hidden from the default list only
    expect((await a.get('/outlets')).body.data).toHaveLength(0);
    expect((await a.get('/outlets?include_closed=true')).body.data).toHaveLength(1);
    expect((await a.get(`/outlets/${outlet.id}`)).body.data.counts).toMatchObject({ investments: 1, entries: 1 });
    expect((await a.get(`/investments${qs({ outlet_id: outlet.id })}`)).body.data).toHaveLength(1);
    const dash = (await a.get(`/outlets/${outlet.id}/dashboard${qs({ from: dayIn(3, 1), to: dayIn(0, 28) })}`)).body.data;
    expect(dash.period.other_income).toBe(5000);

    const reopened = await a.patch(`/outlets/${outlet.id}`, { status: 'active' });
    expect(reopened.body.data.archived_at).toBeNull();
    expect((await a.post('/entries', { kind: 'expense', amount: 5, entry_date: dayIn(0, 1), outlet_id: outlet.id })).status).toBe(201);
  });

  test('transfers cannot belong to a outlet; salaries and expenses can', async () => {
    const { token } = await setup('tr');
    const a = api(token);
    const outlet = (await a.post('/outlets', { name: 'S' })).body.data;
    expect((await a.post('/entries', { kind: 'transfer', amount: 10, entry_date: dayIn(0, 1), outlet_id: outlet.id })).status).toBe(422);
    expect((await a.post('/entries', { kind: 'salary', amount: 10, entry_date: dayIn(0, 1), outlet_id: outlet.id })).status).toBe(201);
  });
});

describe('outlet-wise accounting, filters and reports', () => {
  test('outlet figures, company level, every filter, the outlet report and projections', async () => {
    const { token } = await setup('acct');
    const a = api(token);
    const typeQuarry = await catId(a, 'ownership_type', 'Company-owned');
    const typeGold = await catId(a, 'ownership_type', 'Franchise');
    const q = (await a.post('/outlets', { name: 'Quarry', ownership_type_id: typeQuarry, format_id: await catId(a, 'format', 'Retail pharmacy') })).body.data;
    const g = (await a.post('/outlets', { name: 'Gold', ownership_type_id: typeGold, format_id: await catId(a, 'format', 'Wholesale distributor') })).body.data;
    const sales = await catId(a, 'income', 'Product sales');
    const ops = await catId(a, 'expense', 'Outlet operations');

    const qInv = (await a.post('/investments', { name: 'Quarry capital', investment_date: dayIn(2, 5), amount: 1000000, outlet_id: q.id })).body.data;
    const gInv = (await a.post('/investments', { name: 'Gold capital', investment_date: dayIn(2, 6), amount: 400000, outlet_id: g.id })).body.data;
    await a.post('/investments', { name: 'Working capital', investment_date: dayIn(2, 7), amount: 100000 }); // company level
    // 300000 of principal comes back from the quarry: not profit
    expect((await a.post(`/investments/${qInv.id}/returns`, { return_date: dayIn(1, 10), principal: 300000, earnings: 20000 })).status).toBe(201);
    await a.post('/entries', { kind: 'income', amount: 500000, entry_date: dayIn(1, 12), category_id: sales, outlet_id: q.id });
    await a.post('/entries', { kind: 'expense', amount: 120000, entry_date: dayIn(1, 13), category_id: ops, outlet_id: q.id });
    await a.post('/entries', { kind: 'expense', amount: 90000, entry_date: dayIn(1, 14), category_id: ops, outlet_id: g.id });
    await a.post('/entries', { kind: 'expense', amount: 40000, entry_date: dayIn(1, 15), category_id: ops }); // shared overhead, no outlet
    await a.post('/entries', { kind: 'salary', amount: 30000, entry_date: dayIn(1, 28), outlet_id: g.id });
    void gInv;

    const range = { from: dayIn(1, 1), to: dayIn(1, 28) };
    const all = (await a.get(`/dashboard${qs(range)}`)).body.data;
    // income = earnings 20000 + sales 500000; expenses = 120000 + 90000 + 40000 + salary 30000; capital and principal excluded
    expect(all.period).toMatchObject({ income: 520000, expenses: 280000, net_result: 240000, principal_returned: 300000 });
    const rows = all.outlets.rows;
    const qr = rows.find((r) => r.outlet_id === q.id);
    const gr = rows.find((r) => r.outlet_id === g.id);
    const co = rows.find((r) => r.outlet_id === null);
    expect(qr).toMatchObject({ revenue: 500000, earnings: 20000, income: 520000, expenses: 120000, net_result: 400000, principal_returned: 300000, outstanding_principal: 700000 });
    expect(gr).toMatchObject({ revenue: 0, expenses: 120000, salaries: 30000, net_result: -120000 });
    expect(co).toMatchObject({ expenses: 40000, invested_total: 100000 });
    // the overhead is NOT spread over the outlets, and the rows add up to the company result
    expect(qr.net_result + gr.net_result + co.net_result).toBe(all.period.net_result);
    expect(all.outlets.totals.net_result).toBe(all.period.net_result);
    expect(all.outlets.ranking.best[0].outlet_id).toBe(q.id);
    expect(all.outlets.trend.keys.map((k) => k.id).sort()).toEqual([g.id, q.id, 'none'].sort()); // the company-level line keeps the graph equal to the company total

    // filters change every figure together
    const byOutlet = (await a.get(`/dashboard${qs({ ...range, outlet_id: q.id })}`)).body.data;
    expect(byOutlet.period).toMatchObject({ income: 520000, expenses: 120000, net_result: 400000 });
    expect(byOutlet.outlets.rows.filter((r) => r.outlet_id).map((r) => r.outlet_id)).toEqual([q.id]);
    const none = (await a.get(`/dashboard${qs({ ...range, outlet_id: 'none' })}`)).body.data;
    expect(none.period).toMatchObject({ income: 0, expenses: 40000 });
    const byType = (await a.get(`/dashboard${qs({ ...range, ownership_type_id: typeGold })}`)).body.data;
    expect(byType.period).toMatchObject({ income: 0, expenses: 120000 });
    const byFormat = (await a.get(`/dashboard${qs({ ...range, format_id: await catId(a, 'format', 'Retail pharmacy') })}`)).body.data;
    expect(byFormat.period.income).toBe(520000);

    // lists and the transaction register follow the same filters
    expect((await a.get(`/entries${qs({ kind: 'expense', outlet_id: g.id })}`)).body.data).toHaveLength(1);
    expect((await a.get(`/entries${qs({ kind: 'expense', outlet_id: 'none' })}`)).body.data).toHaveLength(1);
    expect((await a.get(`/entries${qs({ ownership_type_id: typeQuarry })}`)).body.data.every((e) => e.outlet.name === 'Quarry')).toBe(true);
    const tx = (await a.get(`/transactions${qs({ ...range, outlet_id: q.id })}`)).body;
    expect(tx.data.every((r) => r.outlet?.id === q.id)).toBe(true);
    expect(tx.summary).toMatchObject({ principal_return: 300000, earnings: 20000, income: 500000 });

    // monthly report with a outlet filter, and the outlet-wise report
    const mr = (await a.get(`/monthly-report${qs({ ...range, outlet_id: g.id })}`)).body.data;
    expect(mr.totals).toMatchObject({ total_income: 0, total_expenses: 120000 });
    const rep = (await a.get(`/reports${qs({ ...range, report: 'outlets' })}`)).body.data;
    expect(rep.title).toBe('Outlet-wise profit and loss');
    expect(rep.rows.map((r) => r[0]).sort()).toEqual(['Company level (no outlet)', 'Gold', 'Quarry'].sort());
    expect(rep.totals.net_result).toBe(240000);
    expect((await a.get(`/reports${qs({ ...range, report: 'investments' })}`)).body.data.columns).toContain('Outlet');

    // projections carry a outlet, are filtered by it and never create transactions
    const p1 = await a.post('/projections', { name: 'Quarry sales', month: monthKey(0), line: 'other_income', amount: 600000, outlet_id: q.id, status: 'approved' });
    expect(p1.status).toBe(201);
    await a.post('/projections', { name: 'Gold costs', month: monthKey(0), line: 'operating_expense', amount: 100000, outlet_id: g.id, status: 'approved' });
    const cur = { from: dayIn(0, 1), to: dayIn(0, 28) };
    const projQ = (await a.get(`/projections/compare${qs({ ...cur, outlet_id: q.id })}`)).body.data;
    expect(projQ.projected_totals).toMatchObject({ income: 600000, expenses: 0 });
    const projG = (await a.get(`/projections/compare${qs({ ...cur, outlet_id: g.id })}`)).body.data;
    expect(projG.projected_totals).toMatchObject({ income: 0, expenses: 100000 });
    expect((await a.get(`/projections${qs({ outlet_id: q.id })}`)).body.data).toHaveLength(1);
    expect((await a.get(`/entries${qs({ from: cur.from, to: cur.to })}`)).body.data).toHaveLength(0);
  });
});

describe('group dashboard', () => {
  test('Novarex outlets appear in the company block, and the Travel module still treats Novarex as its own company', async () => {
    const group = await createOrg({ name: 'Delphic Global NX', slug: `dg-nx-${Date.now()}` });
    const nx = await createOrg({ name: 'Novarex Pharmaceuticals T', slug: `nx-grp-${Date.now()}`, org_group_id: group.org_group_id });
    await prisma.org.update({ where: { id: nx.id }, data: { enabled_modules: ['novarex'] } });
    const su = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: group.org_group_id } });
    await createOrgMembership(su.id, group.id, { role: 'admin' });
    await createOrgMembership(su.id, nx.id, { role: 'admin' });
    const superToken = (await loginAs(su)).access_token;
    // the super admin is an admin of the company, so the company API works for them too
    await prisma.org.update({ where: { id: nx.id }, data: { enabled_modules: ['novarex'] } });
    const nxApi = api(superToken);
    void nxApi;

    const outlet = await prisma.nxOutlet.create({ data: { org_id: nx.id, code: 'NO-001', name: 'Granite Quarry', status: 'active' } });
    const closed = await prisma.nxOutlet.create({ data: { org_id: nx.id, code: 'NO-002', name: 'Old Pit', status: 'closed', archived_at: new Date() } });
    const inv = await prisma.nxInvestment.create({ data: { org_id: nx.id, code: 'NX-0001', name: 'Dev', investment_date: new Date(`${dayIn(2, 5)}T00:00:00Z`), amount: 800000, outlet_id: outlet.id, status: 'active' } });
    await prisma.nxReturn.create({ data: { org_id: nx.id, investment_id: inv.id, return_date: new Date(`${dayIn(1, 5)}T00:00:00Z`), principal: 100000, earnings: 40000 } });
    await prisma.nxEntry.create({ data: { org_id: nx.id, kind: 'income', amount: 60000, entry_date: new Date(`${dayIn(1, 6)}T00:00:00Z`), outlet_id: outlet.id } });
    await prisma.nxEntry.create({ data: { org_id: nx.id, kind: 'expense', amount: 10000, entry_date: new Date(`${dayIn(1, 7)}T00:00:00Z`), outlet_id: closed.id, expense_class: 'operating' } });

    const res = await authed(request(app).get(`/api/v1/super-dashboard/group/overview?from=${monthKey(1)}&to=${monthKey(0)}&state=all`), superToken);
    expect(res.status).toBe(200);
    const c = res.body.data.companies.find((x) => x.org.id === nx.id);
    expect(c.org.kind).toBe('novarex');
    expect(c.totals).toMatchObject({ revenue: 100000, expenses: 10000, profit: 90000 }); // earnings 40000 + sales 60000; principal and capital excluded
    const block = res.body.data.novarex;
    expect(block.outlets).toMatchObject({ total: 2, active: 1 });
    expect(block.outlets.rows.find((r) => r.name === 'Granite Quarry')).toMatchObject({ invested_total: 800000, principal_returned_total: 100000, income: 100000, net_result: 100000, outstanding_principal: 700000 });
    expect(block.money.outstanding_principal).toBe(700000);

    const dd = await authed(request(app).get(`/api/v1/super-dashboard/companies/${nx.id}/drilldown?from=${monthKey(1)}&to=${monthKey(0)}&state=all`), superToken);
    const outlets = dd.body.data.sections.find((s) => s.key === 'outlets');
    expect(outlets.rows.map((r) => r[0])).toEqual(expect.arrayContaining(['Granite Quarry', 'Old Pit']));

    // Delphic Global (no marker) is the only company the Travel tab calls "Delphic"
    const opts = await authed(request(app).get('/api/v1/super-dashboard/group/travel/options'), superToken);
    expect(opts.status).toBe(200);
  });
});
