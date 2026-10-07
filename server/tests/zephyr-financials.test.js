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
  return { user, token: access_token };
}

const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/zephyr${path}`), token).send(body || {}),
  put: (path, body) => authed(request(app).put(`/api/v1/zephyr${path}`), token).send(body || {}),
  get: (path) => authed(request(app).get(`/api/v1/zephyr${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/zephyr${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/zephyr${path}`), token),
});
const addMonths = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
const thisMonth = () => new Date().toISOString().slice(0, 7);
const dateIn = (month, d = 1) => `${month}-${String(d).padStart(2, '0')}`;

async function seed(token) {
  const a = api(token);
  const cats = (await a.get('/categories')).body.data;
  const cat = (kind, name) => cats.find((c) => c.kind === kind && c.name === name).id;
  const p1 = (await a.post('/projects', { service_type: 'civil_construction', name: 'Tower A', kind: 'client', status: 'active' })).body.data;
  const p2 = (await a.post('/projects', { service_type: 'civil_construction', name: 'Villas', kind: 'self', status: 'active' })).body.data;
  const client = (await a.post('/parties', { name: 'Big Client', kind: 'client' })).body.data;
  const vendor = (await a.post('/parties', { name: 'Big Vendor', kind: 'vendor' })).body.data;
  const entry = (month, type, amount, extra = {}) =>
    a.post('/ledger', { entry_date: dateIn(month), type, category_id: cat(type, type === 'revenue' ? 'Project billing' : 'Materials'), amount, ...extra });
  return { a, cat, p1, p2, client, vendor, entry };
}

describe('zephyr overview', () => {
  test('summary, trend, by project, categories and salaries from approved slips', async () => {
    const { token } = await setupZephyr();
    const s = await seed(token);
    const { a } = s;
    const m = thisMonth();
    const prev = addMonths(m, -1);
    await s.entry(m, 'revenue', 500000, { project_id: s.p1.id, party_id: s.client.id, tax: 90000 });
    await s.entry(m, 'revenue', 100000);
    await s.entry(m, 'expense', 200000, { project_id: s.p1.id, party_id: s.vendor.id, tax: 36000 });
    await s.entry(m, 'expense', 50000, { project_id: s.p2.id });
    await s.entry(m, 'expense', 10000, { status: 'planned' });
    await s.entry(prev, 'revenue', 300000, { project_id: s.p2.id });

    // approved slip charged 50/50 to the two projects, plus a draft slip that must not count
    const emp = (await a.post('/people', { name: 'Eng', pay_basis: 'monthly', rate: 60000, joining_date: `${addMonths(m, -6)}-01` })).body.data;
    await a.post(`/people/${emp.id}/assignments`, { project_id: s.p1.id, allocation_pct: 50 });
    await a.post(`/people/${emp.id}/assignments`, { project_id: s.p2.id, allocation_pct: 50 });
    const drafter = (await a.post('/people', { name: 'Draft Dan', pay_basis: 'monthly', rate: 99999, joining_date: `${addMonths(m, -6)}-01` })).body.data;
    expect(drafter.id).toBeTruthy();
    await a.post('/salaries/generate', { month: m });
    const slips = (await a.get(`/salaries?month=${m}`)).body.data.records;
    await a.post(`/salaries/${slips.find((x) => x.person.id === emp.id).id}/approve`);

    const o = (await a.get('/overview?preset=month')).body.data;
    expect(o.summary).toMatchObject({ revenue: 600000, expense: 250000, salaries: 60000, profit: 290000, margin: 48.3, tax_collected: 90000, tax_paid: 36000 });
    expect(o.trend).toHaveLength(12);
    expect(o.trend[11]).toMatchObject({ month: m, revenue: 600000, expense: 250000, salaries: 60000, profit: 290000 });
    expect(o.trend[10]).toMatchObject({ month: prev, revenue: 300000, profit: 300000 });
    const byName = Object.fromEntries(o.by_project.map((p) => [p.name, p]));
    expect(byName['Tower A']).toMatchObject({ revenue: 500000, expense: 200000, salaries: 30000, profit: 270000 });
    expect(byName.Villas).toMatchObject({ revenue: 0, expense: 50000, salaries: 30000, profit: -80000 });
    expect(byName.Unallocated).toMatchObject({ revenue: 100000, expense: 0, profit: 100000 });
    expect(o.by_category.find((c) => c.type === 'revenue')).toMatchObject({ category: 'Project billing', amount: 600000 });

    const last = (await a.get('/overview?preset=last_month')).body.data.summary;
    expect(last).toMatchObject({ revenue: 300000, expense: 0 });
    const custom = (await a.get(`/overview?preset=custom&from=${dateIn(prev, 1)}&to=${dateIn(m, 28)}`)).body.data.summary;
    expect(custom.revenue).toBe(900000);
    expect((await a.get('/overview?preset=custom')).status).toBe(422);
    expect((await a.get('/overview?preset=custom&from=2026-05-02&to=2026-05-01')).status).toBe(422);

    const drill = (await a.get(`/overview/salaries?from=${dateIn(m, 1)}&to=${dateIn(m, 28)}&project_id=${s.p1.id}`)).body.data;
    expect(drill).toHaveLength(1);
    expect(drill[0]).toMatchObject({ amount: 30000, net: 60000 });
  });

  test('valuation = (profit x 240) + (asset value x 3) per month; asset value is admin-recorded and carries forward', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const s = await seed(token);
    const { a } = s;
    const m2 = addMonths(thisMonth(), -2);
    await s.entry(m2, 'revenue', 1000000);
    await s.entry(m2, 'expense', 400000);
    expect((await a.put('/financials/asset-values', { month: m2, asset_value: 2000000, notes: 'Equipment and stock' })).status).toBe(200);
    const vt = (await a.get(`/financials/valuation?from=${m2}&to=${addMonths(m2, 1)}`)).body.data;
    expect(vt.formula).toEqual({ profit: 240, asset_value: 3 });
    expect(vt.months[0]).toMatchObject({ month: m2, revenue: 1000000, profit: 600000, asset_value: 2000000, asset_value_carried: false, valuation: 600000 * 240 + 6000000 });
    expect(vt.months[1]).toMatchObject({ profit: 0, asset_value: 2000000, asset_value_carried: true, valuation: 6000000 });
    expect((await a.get(`/financials/valuation?from=${m2}&to=${m2}&state=closed`)).body.data.months[0].profit).toBe(0); // not closed yet
    expect((await a.get(`/financials/valuation?from=${thisMonth()}&to=${m2}`)).status).toBe(422);
    expect((await a.put('/financials/asset-values', { month: '2099-01', asset_value: 1 })).status).toBe(422);
    expect((await a.get('/overview')).body.data.valuation).toMatchObject({ month: thisMonth(), asset_value: 2000000, value: 6000000 });
    expect((await api(manager.token).get('/financials/valuation')).status).toBe(403);
    expect((await api(manager.token).put('/financials/asset-values', { month: m2, asset_value: 1 })).status).toBe(403);
    expect((await a.del(`/financials/asset-values/${m2}`)).status).toBe(200);
    expect((await a.get(`/financials/valuation?from=${m2}&to=${m2}`)).body.data.months[0].valuation).toBe(600000 * 240);
    expect((await a.del(`/financials/asset-values/${m2}`)).status).toBe(404);
  });

  test('a manager sees revenue, expense and profit per project but no salaries or valuation', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const staff = await addMember(org, 'staff');
    const s = await seed(token);
    await s.entry(thisMonth(), 'revenue', 1000, { project_id: s.p1.id });
    await s.entry(thisMonth(), 'expense', 400, { project_id: s.p1.id });
    const o = (await api(manager.token).get('/overview')).body.data;
    expect(o.summary).toMatchObject({ revenue: 1000, expense: 400, salaries: null, profit: 600 });
    expect(o.valuation).toBeNull();
    expect(o.by_project.every((p) => p.salaries === null)).toBe(true);
    expect((await api(manager.token).get(`/overview/salaries?from=${dateIn(thisMonth(), 1)}&to=${dateIn(thisMonth(), 28)}`)).status).toBe(403);
    expect((await api(staff.token).get('/overview')).status).toBe(403);
  });
});

describe('zephyr financials: plan vs actual', () => {
  test('plans upsert, company row beats project rows, variance and totals', async () => {
    const { token } = await setupZephyr();
    const s = await seed(token);
    const { a } = s;
    const m = thisMonth();
    await s.entry(m, 'revenue', 120000, { project_id: s.p1.id });
    await s.entry(m, 'expense', 70000, { project_id: s.p1.id });

    expect((await a.put('/financials/plans', { month: 'bad' })).status).toBe(422);
    expect((await a.put('/financials/plans', { month: m, project_id: '00000000-0000-4000-8000-000000000000', planned_revenue: 1 })).status).toBe(404);
    const first = await a.put('/financials/plans', { month: m, planned_revenue: 100000, planned_expense: 60000, planned_salaries: 10000 });
    expect(first.body.data).toMatchObject({ planned_revenue: 100000 });
    const again = await a.put('/financials/plans', { month: m, planned_revenue: 150000, planned_expense: 60000, planned_salaries: 10000, notes: 'revised' });
    expect(again.body.data.id).toBe(first.body.data.id);
    await a.put('/financials/plans', { month: m, project_id: s.p1.id, planned_revenue: 20000 });

    const pva = (await a.get(`/financials/plan-vs-actual?from=${m}&to=${m}`)).body.data;
    expect(pva.rows).toHaveLength(1);
    expect(pva.rows[0].planned).toMatchObject({ revenue: 150000, expense: 60000, salaries: 10000, profit: 80000 });
    expect(pva.rows[0].actual).toMatchObject({ revenue: 120000, expense: 70000, profit: 50000 });
    expect(pva.rows[0].variance).toMatchObject({ revenue: -30000, expense: 10000, profit: -30000 });
    expect(pva.rows[0]).toMatchObject({ has_plan: true, status: 'open' });
    expect(pva.totals.actual.revenue).toBe(120000);

    const forProject = (await a.get(`/financials/plan-vs-actual?from=${m}&to=${m}&project_id=${s.p1.id}`)).body.data;
    expect(forProject.rows[0].planned.revenue).toBe(20000);
    expect(forProject.rows[0].actual.revenue).toBe(120000);

    const plans = (await a.get('/financials/plans')).body.data;
    expect(plans).toHaveLength(2);
    expect((await a.del(`/financials/plans/${first.body.data.id}`)).status).toBe(200);
    expect((await a.get('/financials/plans')).body.data).toHaveLength(1);
    const audit = (await a.get('/audit?entity=plan')).body.data.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['create', 'update', 'delete']));
  });

  test('only admins use financials', async () => {
    const { org } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    for (const path of ['/financials/plans', '/financials/plan-vs-actual', '/financials/projection', '/financials/closes', '/financials/statement']) {
      expect((await api(manager.token).get(path)).status).toBe(403);
    }
    expect((await api(manager.token).put('/financials/plans', { month: thisMonth() })).status).toBe(403);
    expect((await api(manager.token).post('/financials/close', { month: addMonths(thisMonth(), -1) })).status).toBe(403);
  });
});

describe('zephyr financials: projection', () => {
  test('needs history; fits a trend over completed months and labels confidence', async () => {
    const { token } = await setupZephyr();
    const s = await seed(token);
    const { a } = s;
    let p = (await a.get('/financials/projection')).body.data;
    expect(p.confidence).toBe('insufficient');
    expect(p.series.revenue.points.every((x) => x.value === null)).toBe(true);

    // ten completed months, revenue rising 10k a month from 100k, expense flat 40k
    for (let i = 10; i >= 1; i -= 1) {
      const month = addMonths(thisMonth(), -i);
      await s.entry(month, 'revenue', 100000 + (10 - i) * 10000);
      await s.entry(month, 'expense', 40000);
    }
    p = (await a.get('/financials/projection')).body.data;
    expect(p.basis_months).toBe(10);
    expect(p.series.revenue.confidence).toBe('high');
    expect(p.series.revenue.r2).toBe(1);
    expect(p.series.revenue.points).toHaveLength(6);
    expect(p.series.revenue.points[0]).toMatchObject({ month: thisMonth(), value: 200000 });
    expect(p.series.revenue.points[5].value).toBe(250000);
    expect(p.series.expense.points[0].value).toBe(40000);
    expect(p.series.salaries.points[0].value).toBe(0);
    expect(p.series.profit.points[0].value).toBe(160000);
  });
});

describe('zephyr financials: month close', () => {
  test('close needs a finished month and no draft slips; later changes flag it stale; reopen needs a reason', async () => {
    const { token } = await setupZephyr();
    const s = await seed(token);
    const { a } = s;
    const prev = addMonths(thisMonth(), -1);
    await s.entry(prev, 'revenue', 100000, { project_id: s.p1.id });
    await s.entry(prev, 'expense', 30000, { project_id: s.p1.id });

    expect((await a.post('/financials/close', { month: thisMonth() })).status).toBe(422);
    expect((await a.post('/financials/close', { month: 'bad' })).status).toBe(422);

    const emp = (await a.post('/people', { name: 'Eng', pay_basis: 'monthly', rate: 20000, joining_date: `${addMonths(prev, -3)}-01` })).body.data;
    expect(emp.id).toBeTruthy();
    await a.post('/salaries/generate', { month: prev });
    expect((await a.post('/financials/close', { month: prev })).status).toBe(409);
    const slip = (await a.get(`/salaries?month=${prev}`)).body.data.records[0];
    await a.post(`/salaries/${slip.id}/approve`);

    const closed = await a.post('/financials/close', { month: prev });
    expect(closed.status).toBe(200);
    expect(closed.body.data.snapshot.summary).toMatchObject({ revenue: 100000, expense: 30000, salaries: 20000, profit: 50000 });
    expect((await a.post('/financials/close', { month: prev })).status).toBe(409);

    let row = (await a.get(`/financials/closes?from=${prev}&to=${prev}`)).body.data[0];
    expect(row).toMatchObject({ month: prev, status: 'closed', stale: false });

    // a closed month is locked: an entry dated inside it is refused, so the snapshot cannot drift
    const refused = await s.entry(prev, 'expense', 5000, { project_id: s.p1.id });
    expect(refused.status).toBe(409);
    row = (await a.get(`/financials/closes?from=${prev}&to=${prev}`)).body.data[0];
    expect(row).toMatchObject({ stale: false, status: 'closed' });
    expect(row.snapshot.summary.expense).toBe(30000);
    expect(row.live.expense).toBe(30000);
    const existing = (await a.get('/ledger?type=expense')).body.data[0];
    expect((await a.patch(`/ledger/${existing.id}`, { amount: 1 })).status).toBe(409);
    expect((await a.del(`/ledger/${existing.id}`)).status).toBe(409);
    const pva = (await a.get(`/financials/plan-vs-actual?from=${prev}&to=${prev}`)).body.data.rows[0];
    expect(pva).toMatchObject({ status: 'closed', stale: false });

    expect((await a.post('/financials/reopen', { month: prev })).status).toBe(422);
    expect((await a.post('/financials/reopen', { month: addMonths(prev, -1), reason: 'x' })).status).toBe(409);
    expect((await a.post('/financials/reopen', { month: prev, reason: 'Late bill added' })).status).toBe(200);
    row = (await a.get(`/financials/closes?from=${prev}&to=${prev}`)).body.data[0];
    expect(row).toMatchObject({ status: 'open', stale: false, reopen_reason: 'Late bill added', snapshot: null });

    const late = await s.entry(prev, 'expense', 5000, { project_id: s.p1.id });
    expect(late.status).toBe(201);
    const reclosed = await a.post('/financials/close', { month: prev });
    expect(reclosed.body.data.snapshot.summary.expense).toBe(35000);
    const audit = (await a.get('/audit?entity=period')).body.data.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['close', 'reopen']));
  });

  test('unapproving a slip in a closed month flags it stale too', async () => {
    const { token } = await setupZephyr();
    const s = await seed(token);
    const { a } = s;
    const prev = addMonths(thisMonth(), -1);
    await a.post('/people', { name: 'Eng', pay_basis: 'monthly', rate: 20000, joining_date: `${addMonths(prev, -3)}-01` });
    await a.post('/salaries/generate', { month: prev });
    const slip = (await a.get(`/salaries?month=${prev}`)).body.data.records[0];
    await a.post(`/salaries/${slip.id}/approve`);
    await a.post('/financials/close', { month: prev });
    await a.post(`/salaries/${slip.id}/unapprove`, { reason: 'wrong' });
    expect((await a.get(`/financials/closes?from=${prev}&to=${prev}`)).body.data[0].stale).toBe(true);
  });
});

describe('zephyr financials: statements and export', () => {
  test('P&L by month, project and party, and Excel / PDF downloads', async () => {
    const { token } = await setupZephyr();
    const s = await seed(token);
    const { a } = s;
    const m = thisMonth();
    await s.entry(m, 'revenue', 80000, { project_id: s.p1.id, party_id: s.client.id });
    await s.entry(m, 'expense', 30000, { project_id: s.p1.id, party_id: s.vendor.id });
    await s.entry(m, 'expense', 5000);

    const byMonth = (await a.get(`/financials/statement?group=month&from=${m}&to=${m}`)).body.data;
    expect(byMonth.rows).toEqual([{ name: m, revenue: 80000, expense: 35000, salaries: 0, profit: 45000 }]);
    expect(byMonth.totals).toMatchObject({ revenue: 80000, expense: 35000, profit: 45000 });

    const byProject = (await a.get(`/financials/statement?group=project&from=${m}&to=${m}`)).body.data;
    expect(byProject.rows.find((r) => r.name.includes('Tower A'))).toMatchObject({ revenue: 80000, expense: 30000, profit: 50000 });
    expect(byProject.rows.find((r) => r.name === 'Unallocated')).toMatchObject({ expense: 5000 });

    const byParty = (await a.get(`/financials/statement?group=party&from=${m}&to=${m}`)).body.data;
    expect(byParty.rows.find((r) => r.name === 'Big Client')).toMatchObject({ revenue: 80000 });
    expect(byParty.rows.find((r) => r.name === 'Big Vendor')).toMatchObject({ expense: 30000 });
    expect(byParty.totals.salaries).toBeNull();

    const xlsx = await authed(request(app).get(`/api/v1/zephyr/financials/statement?group=project&format=xlsx&from=${m}&to=${m}`), token).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect(xlsx.body.slice(0, 2).toString()).toBe('PK');
    const pdf = await authed(request(app).get(`/api/v1/zephyr/financials/statement?group=month&format=pdf&from=${m}&to=${m}`), token).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect((await a.get('/financials/statement?group=nope')).status).toBe(422);
  });

  test('another org sees none of the books', async () => {
    const a = await setupZephyr('zephyr-a');
    const b = await setupZephyr('zephyr-b');
    const s = await seed(a.token);
    await s.entry(thisMonth(), 'revenue', 12345);
    await s.a.put('/financials/plans', { month: thisMonth(), planned_revenue: 999 });
    const bb = api(b.token);
    expect((await bb.get('/overview')).body.data.summary.revenue).toBe(0);
    expect((await bb.get('/financials/plans')).body.data).toHaveLength(0);
    expect((await bb.get(`/financials/statement?group=month&from=${thisMonth()}&to=${thisMonth()}`)).body.data.totals.revenue).toBe(0);
    await s.entry(addMonths(thisMonth(), -1), 'revenue', 1);
    expect((await bb.post('/financials/close', { month: addMonths(thisMonth(), -1) })).status).toBe(200);
    const aClose = (await api(a.token).get(`/financials/closes?from=${addMonths(thisMonth(), -1)}&to=${addMonths(thisMonth(), -1)}`)).body.data[0];
    expect(aClose.status).toBe('open');
  });
});
