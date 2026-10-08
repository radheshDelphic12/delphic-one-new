const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

// TRUNCATE ... CASCADE over the whole schema is slow on Windows, so clean once; every test builds its own org (unique slug)
// and all Acconcy data is org-scoped, so tests cannot see each other's rows.
jest.setTimeout(120000);
beforeAll(async () => {
  await cleanDatabase();
}, 180000);
// Leave the shared database empty: later suites in the same run may count global rows (users, orgs).
afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
}, 180000);

let orgSeq = 0;
async function setup(label = 'co') {
  orgSeq += 1;
  const slug = `ax-${label}-${Date.now()}-${orgSeq}`;
  const org = await createOrg({ name: `Acconcy ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['acconcy'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}
async function addMember(org, accessRole, kind = 'employee') {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  const person = await prisma.axPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole, kind } });
  const { access_token } = await loginAs(user);
  return { user, person, token: access_token };
}
const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/acconcy${path}`), token).send(body),
  get: (path) => authed(request(app).get(`/api/v1/acconcy${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/acconcy${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/acconcy${path}`), token),
});
const ids = (res) => res.body.data.map((x) => x.id).sort();
const sortIds = (arr) => arr.map((x) => x.id).sort();

async function party(a, kind, name) {
  const r = await a.post('/parties', { kind, name });
  expect(r.status).toBe(201);
  return r.body.data.id;
}
async function person(a, name, kind = 'employee', extra = {}) {
  const r = await a.post('/people', { name, kind, ...extra });
  expect(r.status).toBe(201);
  return r.body.data.id;
}
async function category(a, kind, name) {
  const cats = (await a.get(`/categories?kind=${kind}`)).body.data;
  return cats.find((c) => c.name === name).id;
}
async function entry(a, body) {
  const r = await a.post('/ledger', body);
  expect(r.status).toBe(201);
  return r.body.data.id;
}
const SERVICES = ['gold_silver', 'financial_consulting', 'venture_capital', 'corporate_finance', 'transaction_advisory', 'valuation'];

describe('acconcy foundation, masters and isolation', () => {
  test('admin gets caps and six service types, masters are seeded and editable, other org is isolated', async () => {
    const { token } = await setup();
    const a = api(token);
    const me = await a.get('/me');
    expect(me.body.data.role).toBe('admin');
    expect(me.body.data.caps).toEqual(expect.arrayContaining(['leads', 'deals', 'investments', 'valuation', 'salaries', 'closeMonth']));
    expect(me.body.data.service_types.map((s) => s.key)).toEqual(SERVICES);
    const cats = (await a.get('/categories')).body.data;
    expect(cats.map((c) => c.name)).toEqual(expect.arrayContaining(['Consulting fees', 'Professional fees', 'Realised investment gain']));
    expect((await a.post('/categories', { kind: 'expense', name: 'Demurrage' })).status).toBe(201);
    expect((await a.post('/categories', { kind: 'expense', name: 'Demurrage' })).status).toBe(409);
    const settings = (await a.get('/settings')).body.data;
    expect(settings.profit_multiplier).toBe(240);
    expect(settings.asset_multiplier).toBe(3);
    expect((await a.patch('/settings', { deal_prefix: 'DX', reason: 'numbering' })).status).toBe(200);
    expect((await a.get('/audit')).body.data.length).toBeGreaterThan(1);

    const other = await setup('acconcy-two');
    const b = api(other.token);
    await party(a, 'client', 'Secret Client');
    expect((await b.get('/parties')).body.data).toHaveLength(0);
  });

  test('a non-Acconcy org is refused and a user without a role has no access', async () => {
    const org = await createOrg({ name: 'Plain', slug: `plain-co-${Date.now()}` });
    const admin = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(admin.id, org.id, { role: 'admin' });
    const { access_token } = await loginAs(admin);
    expect((await api(access_token).get('/me')).status).toBe(403);

    const { org: ax } = await setup('acconcy-x');
    const stranger = await createUser({ role: 'employee', withOrg: false });
    await createOrgMembership(stranger.id, ax.id, { role: 'employee' });
    const t = (await loginAs(stranger)).access_token;
    expect((await api(t).get('/leads')).status).toBe(403);
  });
});

describe('acconcy leads: six services, stages, filters, pipeline and conversion', () => {
  async function seedLeads(a) {
    const c1 = await party(a, 'client', 'Alpha Capital');
    const c2 = await party(a, 'client', 'Beta Holdings');
    const e1 = await person(a, 'Employee One');
    const e2 = await person(a, 'Employee Two');
    const specs = [
      ['L1', 'gold_silver', c1, e1, 'Mumbai', 'Referral', 'new'],
      ['L2', 'financial_consulting', c1, e1, 'Mumbai', 'Website', 'in_discussion'],
      ['L3', 'financial_consulting', c2, e2, 'Delhi', 'Referral', 'qualification'],
      ['L4', 'venture_capital', c2, e2, 'Delhi', 'Event', 'proposal'],
      ['L5', 'corporate_finance', c1, e2, 'Pune', 'Website', 'negotiation'],
      ['L6', 'transaction_advisory', c2, e1, 'Pune', 'Referral', 'won'],
      ['L7', 'valuation', c1, e1, 'Mumbai', 'Event', 'on_hold'],
    ];
    const made = {};
    for (const [name, service_type, party_id, assignee_id, location, source, stage] of specs) {
      const r = await a.post('/leads', { name, service_type, party_id, assignee_id, location, source, expected_amount: 1000000, description: `${name} details` });
      expect(r.status).toBe(201);
      made[name] = r.body.data.id;
      if (stage !== 'new') {
        const chain = stage === 'on_hold' ? ['on_hold'] : ['in_discussion', 'qualification', 'proposal', 'negotiation', 'won'].slice(0, ['in_discussion', 'qualification', 'proposal', 'negotiation', 'won'].indexOf(stage) + 1);
        for (const s of chain) expect((await a.post(`/leads/${r.body.data.id}/stage`, { stage: s })).status).toBe(200);
      }
    }
    return { made, c1, c2, e1, e2 };
  }

  test('create validates the service, description is free text and nothing financial is mandatory', async () => {
    const { token } = await setup();
    const a = api(token);
    const ok = await a.post('/leads', { name: 'Minimal', service_type: 'valuation' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.code).toMatch(/^AL-0001$/);
    expect((await a.post('/leads', { name: 'Bad', service_type: 'astrology' })).status).toBe(422);
    expect((await a.post('/leads', { service_type: 'valuation' })).status).toBe(422);
    const long = await a.post('/leads', { name: 'Long', service_type: 'venture_capital', description: 'x'.repeat(15000), expected_amount: 5000000, expected_revenue: 500000, expected_profit: 200000, expected_start: '2026-04-01', expected_end: '2026-03-01' });
    expect(long.status).toBe(422);
  });

  test('every lead filter returns exactly the matching rows, alone and combined', async () => {
    const { token } = await setup();
    const a = api(token);
    const { made, c1, e1 } = await seedLeads(a);
    const all = (await a.get('/leads')).body.data;
    expect(all).toHaveLength(7);

    const expectSet = async (query, names) => {
      const r = await a.get(`/leads${query}`);
      expect(r.status).toBe(200);
      expect(ids(r)).toEqual(names.map((n) => made[n]).sort());
    };
    await expectSet('?service_type=financial_consulting', ['L2', 'L3']);
    await expectSet('?service_type=gold_silver', ['L1']);
    await expectSet(`?party_id=${c1}`, ['L1', 'L2', 'L5', 'L7']);
    await expectSet(`?assignee_id=${e1}`, ['L1', 'L2', 'L6', 'L7']);
    await expectSet('?location=Mumbai', ['L1', 'L2', 'L7']);
    await expectSet('?location=pune', ['L5', 'L6']);
    await expectSet('?source=Referral', ['L1', 'L3', 'L6']);
    await expectSet('?stage=proposal', ['L4']);
    await expectSet('?stage=won', ['L6']);
    await expectSet('?stage=open', ['L1', 'L2', 'L3', 'L4', 'L5', 'L7']);
    await expectSet('?stage=closed', ['L6']);
    await expectSet('?q=L5', ['L5']);
    await expectSet(`?service_type=financial_consulting&party_id=${c1}`, ['L2']);
    await expectSet(`?assignee_id=${e1}&location=Mumbai&source=Website`, ['L2']);
    await expectSet('?service_type=valuation&stage=won', []);
    const today = new Date().toISOString().slice(0, 10);
    await expectSet(`?from=${today}&to=${today}`, ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
    await expectSet('?from=2000-01-01&to=2000-12-31', []);
    expect((await a.get('/leads?service_type=bogus')).status).toBe(422);
    expect((await a.get('/leads?stage=bogus')).status).toBe(422);
  });

  test('pipeline summary counts agree with the list under the same filters', async () => {
    const { token } = await setup();
    const a = api(token);
    const { c1 } = await seedLeads(a);
    const s = (await a.get('/leads/summary')).body.data;
    expect(s.total).toBe(7);
    expect(s.by_stage.new.count).toBe(1);
    expect(s.by_stage.qualification.count).toBe(1);
    expect(s.by_stage.proposal.count).toBe(1);
    expect(s.by_stage.won.count).toBe(1);
    expect(s.by_service_type.financial_consulting.total).toBe(2);
    expect(s.by_service_type.financial_consulting.by_stage.in_discussion).toBe(1);
    expect(s.by_service_type.financial_consulting.by_stage.qualification).toBe(1);
    expect(Object.keys(s.by_service_type)).toEqual(SERVICES);

    const filtered = (await a.get(`/leads/summary?party_id=${c1}`)).body.data;
    const list = (await a.get(`/leads?party_id=${c1}`)).body.data;
    expect(filtered.total).toBe(list.length);
    const byService = {};
    list.forEach((l) => { byService[l.service_type] = (byService[l.service_type] || 0) + 1; });
    for (const k of SERVICES) expect(filtered.by_service_type[k].total).toBe(byService[k] || 0);

    const narrow = (await a.get('/leads/summary?service_type=venture_capital')).body.data;
    expect(narrow.total).toBe(1);
    expect(narrow.by_service_type.valuation.total).toBe(0);
  });

  test('dropping needs a reason, finished leads are locked until an admin reopens, delete is soft', async () => {
    const { token } = await setup();
    const a = api(token);
    const id = (await a.post('/leads', { name: 'Drop me', service_type: 'corporate_finance' })).body.data.id;
    expect((await a.post(`/leads/${id}/stage`, { stage: 'dropped' })).status).toBe(422);
    expect((await a.post(`/leads/${id}/stage`, { stage: 'dropped', lost_reason: 'Went elsewhere' })).status).toBe(200);
    expect((await a.post(`/leads/${id}/stage`, { stage: 'new' })).status).toBe(409);
    const reopened = await a.post(`/leads/${id}/reopen`, { stage: 'negotiation', reason: 'Client came back' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.stage).toBe('negotiation');
    expect((await a.del(`/leads/${id}`)).status).toBe(200);
    expect((await a.get(`/leads/${id}`)).status).toBe(404);
  });

  test('won lead converts once into a deal that carries the lead forward; the lead stays', async () => {
    const { token } = await setup();
    const a = api(token);
    const client = await party(a, 'client', 'Carry Client');
    const emp = await person(a, 'Carry Employee');
    const con = await person(a, 'Carry Contractor', 'contractor');
    const lead = await a.post('/leads', {
      name: 'Carry lead', service_type: 'transaction_advisory', party_id: client, assignee_id: emp, contractor_id: con, expected_amount: 1000000,
      expected_start: '2026-05-01', expected_end: '2026-08-31', description: 'Buy-side advisory for a mid-size deal', notes: 'Key contact: CFO', location: 'Mumbai',
    });
    const id = lead.body.data.id;
    expect((await a.post(`/leads/${id}/convert`, {})).status).toBe(409);
    for (const s of ['in_discussion', 'qualification', 'proposal', 'negotiation', 'won']) await a.post(`/leads/${id}/stage`, { stage: s });
    const conv = await a.post(`/leads/${id}/convert`, {});
    expect(conv.status).toBe(201);
    const d = conv.body.data;
    expect(d.lead_id).toBe(id);
    expect(d.party_id).toBe(client);
    expect(d.service_type).toBe('transaction_advisory');
    expect(d.assignee_id).toBe(emp);
    expect(d.contractor_id).toBe(con);
    expect(d.deal_amount).toBe(1000000);
    expect(d.description).toBe('Buy-side advisory for a mid-size deal');
    expect(d.notes).toBe('Key contact: CFO');
    expect(d.start_date.slice(0, 10)).toBe('2026-05-01');
    expect(d.expected_end.slice(0, 10)).toBe('2026-08-31');
    expect(d.code).toBe('AD-0001');
    expect((await a.post(`/leads/${id}/convert`, {})).status).toBe(409);
    const back = (await a.get(`/leads/${id}`)).body.data;
    expect(back.deal.id).toBe(d.id);
    expect(back.stage).toBe('won');
  });
});

describe('acconcy deals, revenue, expenses and computed profit', () => {
  async function seedDeals(a) {
    const c1 = await party(a, 'client', 'Deal Client One');
    const c2 = await party(a, 'client', 'Deal Client Two');
    const v1 = await party(a, 'vendor', 'Vendor One');
    const e1 = await person(a, 'Deal Employee');
    const mk = async (name, service_type, party_id, extra = {}) => {
      const r = await a.post('/deals', { name, service_type, party_id, deal_amount: 500000, ...extra });
      expect(r.status).toBe(201);
      return r.body.data.id;
    };
    const d1 = await mk('D1', 'financial_consulting', c1, { vendor_id: v1, assignee_id: e1, location: 'Mumbai', start_date: '2026-02-01' });
    const d2 = await mk('D2', 'transaction_advisory', c2, { location: 'Delhi', start_date: '2019-06-01', expected_end: '2020-01-01' });
    const d3 = await mk('D3', 'valuation', c1, { start_date: '2026-03-15' });
    return { c1, c2, v1, e1, d1, d2, d3 };
  }

  test('profit is computed from linked revenue and expense entries, never typed', async () => {
    const { token } = await setup();
    const a = api(token);
    const { d1, c1, v1 } = await seedDeals(a);
    const rev = await category(a, 'revenue', 'Consulting fees');
    const exp = await category(a, 'expense', 'Professional fees');
    await entry(a, { entry_date: '2026-03-10', type: 'revenue', category_id: rev, deal_id: d1, party_id: c1, amount: 1000000 });
    await entry(a, { entry_date: '2026-03-12', type: 'expense', category_id: exp, deal_id: d1, vendor_id: v1, amount: 300000 });
    const deal = (await a.get(`/deals/${d1}`)).body.data;
    expect(deal.summary.revenue).toBe(1000000);
    expect(deal.summary.expense).toBe(300000);
    expect(deal.summary.profit).toBe(700000);
    expect(deal.summary.margin_pct).toBe(70);
    expect(deal.entries).toHaveLength(2);
    // editing the typed deal amount does not move profit
    const upd = await a.patch(`/deals/${d1}`, { deal_amount: 9000000 });
    expect(upd.body.data.summary.profit).toBe(700000);
    expect(upd.body.data.deal_amount).toBe(9000000);
    const audit = (await a.get('/audit?entity=deal')).body.data;
    expect(audit.some((x) => x.action === 'update' && x.after.deal_amount === 9000000)).toBe(true);
  });

  test('every deal filter returns exactly the matching rows', async () => {
    const { token } = await setup();
    const a = api(token);
    const { c1, c2, v1, e1, d1, d2, d3 } = await seedDeals(a);
    const expectSet = async (query, want) => {
      const r = await a.get(`/deals${query}`);
      expect(r.status).toBe(200);
      expect(ids(r)).toEqual([...want].sort());
    };
    await expectSet('', [d1, d2, d3]);
    await expectSet('?service_type=financial_consulting', [d1]);
    await expectSet(`?party_id=${c1}`, [d1, d3]);
    await expectSet(`?party_id=${c2}`, [d2]);
    await expectSet(`?vendor_id=${v1}`, [d1]);
    await expectSet(`?assignee_id=${e1}`, [d1]);
    await expectSet('?location=Delhi', [d2]);
    await expectSet('?from=2026-03-01&to=2026-03-31', [d3]);
    await expectSet('?from=2026-03-10', [d3]);
    await expectSet('?from=2019-01-01&to=2019-12-31', [d2]);
    await expectSet('?flag=delayed', [d2]);
    await expectSet('?q=D3', [d3]);
    await expectSet('?status=planned', [d1, d2, d3]);
    await expectSet('?status=open', [d1, d2, d3]);
    await expectSet('?status=completed', []);
    await expectSet(`?service_type=valuation&party_id=${c1}`, [d3]);
    await expectSet(`?service_type=valuation&party_id=${c2}`, []);
    expect((await a.post(`/deals/${d1}/status`, { status: 'active' })).status).toBe(200);
    await expectSet('?status=active', [d1]);
    await expectSet('?status=open', [d1, d2, d3]);
    expect((await a.post(`/deals/${d1}/status`, { status: 'completed' })).status).toBe(200);
    await expectSet('?status=done', [d1]);
    await expectSet('?status=active', []);
    await expectSet('?status=open', [d2, d3]);
  });

  test('loss-making flag, status rules and locking of finished deals', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const { d1, d2 } = await seedDeals(a);
    const exp = await category(a, 'expense', 'Travel');
    await entry(a, { entry_date: '2026-03-10', type: 'expense', category_id: exp, deal_id: d2, amount: 1000 });
    expect(ids(await a.get('/deals?flag=loss_making'))).toEqual([d2]);
    expect((await a.post(`/deals/${d1}/status`, { status: 'cancelled' })).status).toBe(422);
    expect((await a.post(`/deals/${d1}/status`, { status: 'cancelled', reason: 'Client withdrew' })).status).toBe(200);
    expect((await a.post(`/deals/${d1}/status`, { status: 'cancelled', reason: 'again' })).status).toBe(409);

    const mgr = await addMember(org, 'manager');
    const m = api(mgr.token);
    expect((await m.patch(`/deals/${d1}`, { notes: 'late edit' })).status).toBe(409);
    expect((await a.patch(`/deals/${d1}`, { notes: 'admin edit', reason: 'correction' })).status).toBe(200);
  });

  test('every ledger filter returns exactly the matching entries and totals equal the rows', async () => {
    const { token } = await setup();
    const a = api(token);
    const { d1, d2, c1, v1 } = await seedDeals(a);
    const rev = await category(a, 'revenue', 'Consulting fees');
    const rev2 = await category(a, 'revenue', 'Advisory fees');
    const exp = await category(a, 'expense', 'Professional fees');
    const e1 = await entry(a, { entry_date: '2026-03-10', type: 'revenue', category_id: rev, deal_id: d1, party_id: c1, amount: 1000 });
    const e2 = await entry(a, { entry_date: '2026-03-20', type: 'expense', category_id: exp, deal_id: d1, vendor_id: v1, amount: 200 });
    const e3 = await entry(a, { entry_date: '2026-04-05', type: 'revenue', category_id: rev2, deal_id: d2, amount: 3000, reference: 'INV-77' });
    const e4 = await entry(a, { entry_date: '2026-04-06', type: 'expense', category_id: exp, amount: 50, description: 'Office stationery' });
    const check = async (query, want, totals) => {
      const r = await a.get(`/ledger${query}`);
      expect(r.status).toBe(200);
      expect(ids(r)).toEqual([...want].sort());
      const sum = (t) => r.body.data.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0);
      expect(r.body.totals.revenue).toBe(sum('revenue'));
      expect(r.body.totals.expense).toBe(sum('expense'));
      if (totals) expect(r.body.totals).toEqual(totals);
    };
    await check('', [e1, e2, e3, e4], { revenue: 4000, expense: 250 });
    await check('?type=revenue', [e1, e3], { revenue: 4000, expense: 0 });
    await check(`?deal_id=${d1}`, [e1, e2], { revenue: 1000, expense: 200 });
    await check('?scope=company', [e4]);
    await check('?scope=deal', [e1, e2, e3]);
    await check(`?category_id=${rev2}`, [e3]);
    await check(`?party_id=${c1}`, [e1]);
    await check(`?vendor_id=${v1}`, [e2]);
    await check('?service_type=transaction_advisory', [e3]);
    await check('?service_type=financial_consulting', [e1, e2]);
    await check('?from=2026-04-01&to=2026-04-30', [e3, e4]);
    await check('?from=2026-03-15', [e2, e3, e4]);
    await check('?q=INV-77', [e3]);
    await check('?q=stationery', [e4]);
    await check(`?type=expense&deal_id=${d1}`, [e2]);
    await check('?type=revenue&service_type=financial_consulting&from=2026-03-01&to=2026-03-31', [e1]);
    // category / type mismatch is refused
    expect((await a.post('/ledger', { entry_date: '2026-03-10', type: 'revenue', category_id: exp, amount: 1 })).status).toBe(422);
    expect((await a.post('/ledger', { entry_date: '2026-03-10', type: 'expense', category_id: exp, amount: 0 })).status).toBe(422);
  });
});

describe('acconcy investments: performance, realisation and the revenue boundary', () => {
  test('gold, silver and venture records calculate gain / loss; unrealised never reaches P&L', async () => {
    const { token } = await setup();
    const a = api(token);
    const gold = await a.post('/investments', { name: '10 kg gold bars', type: 'gold', investment_date: '2026-02-10', amount: 2500000, quantity: 10, unit: 'kg', purchase_price: 250000, current_price: 280000, current_value: 2800000, purity: '24K' });
    expect(gold.status).toBe(201);
    expect(gold.body.data.service_type).toBe('gold_silver');
    expect(gold.body.data.code).toBe('AI-0001');
    expect(gold.body.data.performance.gain_loss).toBe(300000);
    expect(gold.body.data.performance.gain_loss_pct).toBe(12);
    expect(gold.body.data.performance.metal_profit).toBe(300000);
    const silver = await a.post('/investments', { name: 'Silver coins', type: 'silver', investment_date: '2026-02-12', amount: 100000, current_value: 90000 });
    expect(silver.body.data.performance.gain_loss).toBe(-10000);
    const vc = await a.post('/investments', { name: 'Startup X', type: 'venture', startup_name: 'Startup X Pvt Ltd', equity_pct: 5.5, investment_date: '2026-03-01', amount: 1000000, current_value: 1500000 });
    expect(vc.body.data.service_type).toBe('venture_capital');
    expect(vc.body.data.equity_pct).toBe(5.5);

    const list = await a.get('/investments');
    expect(list.body.totals.invested).toBe(3600000);
    expect(list.body.totals.current_value).toBe(4390000);
    expect(list.body.totals.unrealised_gain).toBe(790000);
    expect(list.body.totals.realised_gain).toBe(0);
    expect(list.body.by_type.gold.invested).toBe(2500000);

    // unrealised appreciation is not revenue
    const pnl = (await a.get('/finance/pnl')).body.data;
    expect(pnl.totals.revenue).toBe(0);
    expect(pnl.totals.net_profit).toBe(0);
    const ledger = await a.get('/ledger');
    expect(ledger.body.data).toHaveLength(0);
  });

  test('every investment filter returns exactly the matching rows', async () => {
    const { token } = await setup();
    const a = api(token);
    const mk = async (body) => (await a.post('/investments', body)).body.data.id;
    const g = await mk({ name: 'Gold A', type: 'gold', investment_date: '2026-02-10', amount: 100 });
    const s = await mk({ name: 'Silver B', type: 'silver', investment_date: '2026-03-10', amount: 100 });
    const v = await mk({ name: 'Venture C', type: 'venture', investment_date: '2026-04-10', amount: 100 });
    const o = await mk({ name: 'Other D', type: 'other', service_type: 'corporate_finance', investment_date: '2026-05-10', amount: 100 });
    const deal = (await a.post('/deals', { name: 'Inv deal', service_type: 'venture_capital' })).body.data.id;
    const linked = await mk({ name: 'Linked E', type: 'venture', deal_id: deal, investment_date: '2026-06-10', amount: 100 });
    const check = async (q, want) => expect(ids(await a.get(`/investments${q}`))).toEqual([...want].sort());
    await check('', [g, s, v, o, linked]);
    await check('?type=gold', [g]);
    await check('?type=venture', [v, linked]);
    await check('?service_type=gold_silver', [g, s]);
    await check('?service_type=corporate_finance', [o]);
    await check(`?deal_id=${deal}`, [linked]);
    await check('?from=2026-03-01&to=2026-04-30', [s, v]);
    await check('?q=silver', [s]);
    await check('?status=active', [g, s, v, o, linked]);
    await check('?status=realised', []);
    await check('?type=venture&from=2026-05-01', [linked]);
    expect((await a.post('/investments', { name: 'Bad deal', type: 'gold', investment_date: '2026-02-10', amount: 1, deal_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
  });

  test('realising posts only the gain to revenue, partial then full, with reversal', async () => {
    const { token } = await setup();
    const a = api(token);
    const deal = (await a.post('/deals', { name: 'Gold deal', service_type: 'gold_silver' })).body.data.id;
    const inv = (await a.post('/investments', { name: 'Gold lot', type: 'gold', deal_id: deal, investment_date: '2026-02-10', amount: 1000, current_value: 1300 })).body.data.id;
    // partial: sell 40 of cost for 55
    const p1 = await a.post(`/investments/${inv}/realise`, { realised_date: '2026-03-05', amount_received: 55, cost_released: 40, remaining_value: 780 });
    expect(p1.status).toBe(200);
    expect(p1.body.data.status).toBe('partly_realised');
    expect(p1.body.data.performance.realised_gain).toBe(15);
    expect(p1.body.data.performance.remaining_cost).toBe(960);
    expect(p1.body.data.performance.unrealised_gain).toBe(-180);
    const led = (await a.get('/ledger?scope=deal')).body.data;
    expect(led).toHaveLength(1);
    expect(led[0].type).toBe('revenue');
    expect(led[0].amount).toBe(15);
    expect(led[0].source_type).toBe('investment_realisation');
    expect(led[0].category_name).toBe('Realised investment gain');
    // the posted row is protected
    expect((await a.patch(`/ledger/${led[0].id}`, { amount: 99 })).status).toBe(409);
    expect((await a.del(`/ledger/${led[0].id}`)).status).toBe(409);
    // deal profit now reflects only the realised gain
    expect((await a.get(`/deals/${deal}`)).body.data.summary.profit).toBe(15);
    expect((await a.get('/finance/pnl')).body.data.totals.net_profit).toBe(15);
    // over-release is refused
    expect((await a.post(`/investments/${inv}/realise`, { realised_date: '2026-03-06', amount_received: 10, cost_released: 5000 })).status).toBe(422);
    // full exit at a loss: an expense row
    const p2 = await a.post(`/investments/${inv}/realise`, { realised_date: '2026-03-20', amount_received: 900, full: true });
    expect(p2.body.data.status).toBe('realised');
    expect(p2.body.data.current_value).toBe(0);
    expect(p2.body.data.performance.realised_gain).toBe(-45);
    const led2 = (await a.get('/ledger?scope=deal')).body.data;
    expect(led2.find((x) => x.type === 'expense').amount).toBe(60);
    expect((await a.post(`/investments/${inv}/realise`, { realised_date: '2026-03-21', amount_received: 1 })).status).toBe(409);
    // undo the last realisation
    const rid = p2.body.data.realisations[1].id;
    const undone = await a.del(`/investments/${inv}/realisations/${rid}`);
    expect(undone.status).toBe(200);
    expect(undone.body.data.status).toBe('partly_realised');
    expect((await a.get('/ledger?scope=deal')).body.data).toHaveLength(1);
  });
});

describe('acconcy salaries and the company P&L with its filters', () => {
  async function seedBooks(a) {
    const c1 = await party(a, 'client', 'PL Client One');
    const c2 = await party(a, 'client', 'PL Client Two');
    const v1 = await party(a, 'vendor', 'PL Vendor');
    const emp = await person(a, 'Salaried Employee', 'employee', { monthly_salary: 50000 });
    const con = await person(a, 'Retainer Contractor', 'contractor', { monthly_salary: 20000 });
    const mk = async (name, service_type, party_id, extra = {}) => (await a.post('/deals', { name, service_type, party_id, ...extra })).body.data.id;
    const d1 = await mk('PL1', 'financial_consulting', c1, { vendor_id: v1, assignee_id: emp });
    const d2 = await mk('PL2', 'valuation', c2);
    const rev = await category(a, 'revenue', 'Consulting fees');
    const exp = await category(a, 'expense', 'Professional fees');
    await entry(a, { entry_date: '2026-03-10', type: 'revenue', category_id: rev, deal_id: d1, party_id: c1, amount: 500000 });
    await entry(a, { entry_date: '2026-03-15', type: 'expense', category_id: exp, deal_id: d1, vendor_id: v1, amount: 100000 });
    await entry(a, { entry_date: '2026-03-20', type: 'revenue', category_id: rev, deal_id: d2, party_id: c2, amount: 300000 });
    await entry(a, { entry_date: '2026-04-02', type: 'revenue', category_id: rev, deal_id: d2, party_id: c2, amount: 200000 });
    await entry(a, { entry_date: '2026-03-25', type: 'revenue', category_id: rev, amount: 10000, description: 'Interest' });
    await entry(a, { entry_date: '2026-03-26', type: 'expense', category_id: exp, amount: 5000, description: 'Rent' });
    return { c1, c2, v1, emp, con, d1, d2 };
  }

  test('salary sheet: generate, edit, approve, pay; only approved rows count', async () => {
    const { token } = await setup();
    const a = api(token);
    const { emp, con } = await seedBooks(a);
    const gen = await a.post('/salaries/generate', { month: '2026-03' });
    expect(gen.body.data).toEqual({ created: 2, skipped: 0 });
    expect((await a.post('/salaries/generate', { month: '2026-03' })).body.data).toEqual({ created: 0, skipped: 2 });
    let list = await a.get('/salaries?month=2026-03');
    expect(list.body.data).toHaveLength(2);
    expect(list.body.totals.draft).toBe(70000);
    expect(list.body.totals.approved_paid).toBe(0);
    // draft salary is not in the P&L
    expect((await a.get('/finance/pnl?month=2026-03')).body.data.totals.salaries).toBe(0);
    const empRow = list.body.data.find((r) => r.person_id === emp);
    expect((await a.patch(`/salaries/${empRow.id}`, { deductions: 5000 })).body.data.net).toBe(45000);
    expect((await a.patch(`/salaries/${empRow.id}`, { deductions: 999999 })).status).toBe(422);
    expect((await a.post(`/salaries/${empRow.id}/pay`, {})).status).toBe(409);
    for (const r of list.body.data) expect((await a.post(`/salaries/${r.id}/approve`)).status).toBe(200);
    const pnl = (await a.get('/finance/pnl?month=2026-03')).body.data.totals;
    expect(pnl.salaries).toBe(45000);
    expect(pnl.contractor_costs).toBe(20000);
    expect((await a.post(`/salaries/${empRow.id}/pay`, { paid_on: '2026-03-31' })).body.data.status).toBe('paid');
    list = await a.get(`/salaries?month=2026-03&person_id=${con}`);
    expect(list.body.data).toHaveLength(1);
    expect((await a.get('/salaries?kind=contractor')).body.data).toHaveLength(1);
    expect((await a.get('/salaries?status=paid')).body.data).toHaveLength(1);
    expect((await a.get('/salaries?from=2026-03&to=2026-04')).body.data).toHaveLength(2);
    // a person who left before the month gets no row
    await a.patch(`/people/${con}`, { leaving_date: '2026-02-15' });
    expect((await a.post('/salaries/generate', { month: '2026-04' })).body.data.created).toBe(1);
  });

  test('P&L = revenue - deal expenses - operating expenses - salaries - contractor costs', async () => {
    const { token } = await setup();
    const a = api(token);
    await seedBooks(a);
    const g = await a.post('/salaries/generate', { month: '2026-03' });
    expect(g.status).toBe(200);
    for (const r of (await a.get('/salaries?month=2026-03')).body.data) await a.post(`/salaries/${r.id}/approve`);
    const t = (await a.get('/finance/pnl?month=2026-03')).body.data.totals;
    expect(t.revenue).toBe(810000);
    expect(t.deal_revenue).toBe(800000);
    expect(t.other_revenue).toBe(10000);
    expect(t.deal_expenses).toBe(100000);
    expect(t.operational_expenses).toBe(5000);
    expect(t.salaries).toBe(50000);
    expect(t.contractor_costs).toBe(20000);
    expect(t.expenses).toBe(175000);
    expect(t.net_profit).toBe(635000);
    expect(t.margin_pct).toBe(78.4);
  });

  test('every finance filter returns exactly the matching figures', async () => {
    const { token } = await setup();
    const a = api(token);
    const { c1, c2, v1, emp, d1, d2 } = await seedBooks(a);
    await a.post('/salaries/generate', { month: '2026-03' });
    for (const r of (await a.get('/salaries?month=2026-03')).body.data) await a.post(`/salaries/${r.id}/approve`);
    const pnl = async (q) => (await a.get(`/finance/pnl${q}`)).body.data;

    expect((await pnl('?month=2026-03')).totals.revenue).toBe(810000);
    expect((await pnl('?month=2026-04')).totals.revenue).toBe(200000);
    expect((await pnl('?year=2026')).totals.revenue).toBe(1010000);
    expect((await pnl('?year=2025')).totals.revenue).toBe(0);
    expect((await pnl('?from=2026-03-11&to=2026-03-31')).totals.revenue).toBe(310000);
    const byMonth = (await pnl('?year=2026')).by_month;
    expect(byMonth.map((m) => m.month)).toEqual(['2026-03', '2026-04']);
    expect(byMonth.reduce((s, m) => s + m.revenue, 0)).toBe(1010000);

    const svc = await pnl('?service_type=financial_consulting');
    expect(svc.totals.revenue).toBe(500000);
    expect(svc.totals.expenses).toBe(100000);
    expect(svc.totals.net_profit).toBe(400000);
    expect(svc.totals.salaries).toBe(0);
    expect(svc.company_level_included).toBe(false);
    expect((await pnl('?service_type=valuation')).totals.revenue).toBe(500000);
    expect((await pnl(`?party_id=${c1}`)).totals.revenue).toBe(500000);
    expect((await pnl(`?party_id=${c2}`)).totals.revenue).toBe(500000);
    expect((await pnl(`?vendor_id=${v1}`)).totals.expenses).toBe(100000);
    expect((await pnl(`?vendor_id=${v1}`)).totals.revenue).toBe(500000);
    expect((await pnl(`?deal_id=${d2}`)).totals.revenue).toBe(500000);
    expect((await pnl(`?deal_id=${d1}&month=2026-04`)).totals.revenue).toBe(0);
    const emp1 = await pnl(`?assignee_id=${emp}`);
    expect(emp1.totals.revenue).toBe(500000);
    expect(emp1.totals.salaries).toBe(50000);
    expect((await pnl(`?service_type=valuation&party_id=${c1}`)).totals.revenue).toBe(0);
    expect((await pnl('?service_type=valuation&month=2026-04')).totals.revenue).toBe(200000);
    expect((await pnl('')).by_service.map((s) => s.key).sort()).toEqual(['financial_consulting', 'valuation']);

    const rep = (await a.get('/finance/service-report')).body.data;
    expect(rep.map((r) => r.key)).toEqual(SERVICES);
    const fc = rep.find((r) => r.key === 'financial_consulting');
    expect([fc.revenue, fc.expenses, fc.profit, fc.deals]).toEqual([500000, 100000, 400000, 1]);
    expect(rep.find((r) => r.key === 'corporate_finance').revenue).toBe(0);
    const one = (await a.get('/finance/service-report?service_type=valuation')).body.data;
    expect(one).toHaveLength(1);
    expect(one[0].revenue).toBe(500000);
    expect((await a.get('/finance/pnl?service_type=bogus')).status).toBe(422);
  });

  test('service-wise report adds the investment block per service', async () => {
    const { token } = await setup();
    const a = api(token);
    await a.post('/investments', { name: 'Gold', type: 'gold', investment_date: '2026-02-10', amount: 1000, current_value: 1200 });
    await a.post('/investments', { name: 'VC', type: 'venture', investment_date: '2026-03-10', amount: 2000, current_value: 1800 });
    const rep = (await a.get('/finance/service-report')).body.data;
    const gs = rep.find((r) => r.key === 'gold_silver');
    expect([gs.investment.invested, gs.investment.current_value, gs.investment.gain_loss]).toEqual([1000, 1200, 200]);
    const vc = rep.find((r) => r.key === 'venture_capital');
    expect([vc.investment.invested, vc.investment.gain_loss]).toEqual([2000, -200]);
    const ir = (await a.get('/finance/investments?from=2026-03-01')).body.data;
    expect(ir.totals.invested).toBe(2000);
    expect(ir.by_type.find((t) => t.type === 'venture').count).toBe(1);
  });
});

describe('acconcy valuation: (profit x 240) + (asset value x 3), configurable and auditable', () => {
  const month = new Date().toISOString().slice(0, 7);

  async function profitInMonth(a, amount) {
    const rev = await category(a, 'revenue', 'Consulting fees');
    await entry(a, { entry_date: `${month}-01`, type: 'revenue', category_id: rev, amount });
  }

  test('current valuation uses live profit and asset records with the default multipliers', async () => {
    const { token } = await setup();
    const a = api(token);
    await profitInMonth(a, 100000);
    const asset = await a.post('/assets', { name: 'Office', category: 'property', value: 5000000, as_of_date: `${month}-01` });
    expect(asset.status).toBe(201);
    const v = (await a.get(`/finance/valuation?from=${month}&to=${month}`)).body.data;
    expect(v.formula).toEqual({ profit: 240, asset_value: 3, include_investments: true });
    expect(v.current.profit).toBe(100000);
    expect(v.current.asset_value).toBe(5000000);
    expect(v.current.profit_component).toBe(24000000);
    expect(v.current.asset_component).toBe(15000000);
    expect(v.current.total).toBe(39000000);
    expect((await a.get('/finance/overview')).body.data.valuation.total).toBe(39000000);
    // valuation is not part of P&L or revenue
    const t = (await a.get('/finance/pnl')).body.data.totals;
    expect(t.revenue).toBe(100000);
    expect(t.net_profit).toBe(100000);
  });

  test('investments count as assets by default and can be switched off; multipliers are configurable and audited', async () => {
    const { token } = await setup();
    const a = api(token);
    await profitInMonth(a, 1000);
    await a.post('/investments', { name: 'Gold', type: 'gold', investment_date: `${month}-01`, amount: 4000, current_value: 5000 });
    const cur = async () => (await a.get(`/finance/valuation?from=${month}&to=${month}`)).body.data.current;
    expect((await cur()).asset_value).toBe(5000);
    expect((await cur()).total).toBe(1000 * 240 + 5000 * 3);
    await a.patch('/settings', { include_investments_in_assets: false, reason: 'exclude' });
    expect((await cur()).asset_value).toBe(0);
    expect((await cur()).total).toBe(240000);
    await a.patch('/settings', { include_investments_in_assets: true, profit_multiplier: 100, asset_multiplier: 5, reason: 'new policy' });
    const c = await cur();
    expect([c.profit_multiplier, c.asset_multiplier, c.total]).toEqual([100, 5, 1000 * 100 + 5000 * 5]);
    const audit = (await a.get('/audit?entity=setting')).body.data;
    expect(audit.some((x) => x.before.profit_multiplier === 240 && x.after.profit_multiplier === 100)).toBe(true);
  });

  test('zero profit, zero assets and negative profit', async () => {
    const { token } = await setup();
    const a = api(token);
    const get = async () => (await a.get(`/finance/valuation?from=${month}&to=${month}`)).body.data.current;
    expect((await get()).total).toBe(0);
    await a.post('/assets', { name: 'Cash', category: 'cash_bank', value: 1000, as_of_date: `${month}-01` });
    expect((await get()).total).toBe(3000);
    const exp = await category(a, 'expense', 'Office');
    await entry(a, { entry_date: `${month}-02`, type: 'expense', category_id: exp, amount: 10 });
    expect((await get()).total).toBe(-2400 + 3000);
  });

  test('history keeps the multipliers used at the time; previous and change are reported', async () => {
    const { token } = await setup();
    const a = api(token);
    await profitInMonth(a, 1000);
    const first = await a.post('/finance/valuation/record', { month, notes: 'first' });
    expect(first.status).toBe(201);
    expect(first.body.data.total).toBe(240000);
    await a.patch('/settings', { profit_multiplier: 10, reason: 'change' });
    const second = await a.post('/finance/valuation/record', { month });
    expect(second.body.data.total).toBe(10000);
    const hist = (await a.get('/finance/valuation/history')).body.data;
    expect(hist).toHaveLength(2);
    expect(hist.map((h) => h.profit_multiplier).sort((x, y) => x - y)).toEqual([10, 240]);
    expect(hist.find((h) => h.profit_multiplier === 240).total).toBe(240000);
    const future = new Date(); future.setUTCMonth(future.getUTCMonth() + 2);
    expect((await a.post('/finance/valuation/record', { month: future.toISOString().slice(0, 7) })).status).toBe(422);
    const t = (await a.get('/finance/valuation')).body.data;
    expect(t.months).toHaveLength(12);
    expect(t.previous).toBeTruthy();
    expect(t.change).toBe(t.current.total - t.previous.total);
    expect(t.history).toHaveLength(2);
    expect((await a.get('/finance/valuation?from=2030-01&to=2026-01')).status).toBe(422);
  });
});

describe('acconcy month locking covers revenue, expenses, salaries, investments and assets', () => {
  test('a closed month rejects non-admin edits; admin needs a reason; reopen restores editing', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const finance = await addMember(org, 'finance');
    const f = api(finance.token);
    const emp = await person(a, 'Locked Employee', 'employee', { monthly_salary: 1000 });
    const rev = await category(a, 'revenue', 'Consulting fees');
    const e1 = await entry(a, { entry_date: '2026-03-10', type: 'revenue', category_id: rev, amount: 5000 });
    await a.post('/salaries/generate', { month: '2026-03' });
    const salary = (await a.get('/salaries?month=2026-03')).body.data[0];
    await a.post(`/salaries/${salary.id}/approve`);
    const inv = (await a.post('/investments', { name: 'Locked gold', type: 'gold', investment_date: '2026-03-05', amount: 100 })).body.data.id;
    const asset = (await a.post('/assets', { name: 'Locked asset', category: 'other', value: 10, as_of_date: '2026-03-01' })).body.data.id;

    const closed = await f.post('/finance/periods/2026-03/close', { note: 'March done' });
    expect(closed.status).toBe(200);
    expect((await f.post('/finance/periods/2026-03/close', {})).status).toBe(409);
    // closing recorded a valuation history row
    expect((await a.get('/finance/valuation/history')).body.data.some((h) => h.source === 'month_close' && h.month === '2026-03')).toBe(true);

    // finance (non-admin) is blocked everywhere
    expect((await f.post('/ledger', { entry_date: '2026-03-12', type: 'revenue', category_id: rev, amount: 1 })).status).toBe(409);
    expect((await f.patch(`/ledger/${e1}`, { amount: 9 })).status).toBe(409);
    expect((await f.del(`/ledger/${e1}`)).status).toBe(409);
    expect((await f.patch(`/salaries/${salary.id}`, { gross: 5 })).status).toBe(409);
    expect((await f.post('/salaries/generate', { month: '2026-03' })).status).toBe(409);
    expect((await f.patch(`/investments/${inv}`, { amount: 500 })).status).toBe(409);
    expect((await f.post(`/investments/${inv}/realise`, { realised_date: '2026-03-20', amount_received: 150, full: true })).status).toBe(409);
    expect((await f.post('/investments', { name: 'Late', type: 'gold', investment_date: '2026-03-18', amount: 5 })).status).toBe(409);
    expect((await f.patch(`/assets/${asset}`, { value: 99 })).status).toBe(409);
    // other months stay open
    expect((await f.post('/ledger', { entry_date: '2026-04-12', type: 'revenue', category_id: rev, amount: 1 })).status).toBe(201);

    // admin needs a reason, then it works and the close is flagged stale
    expect((await a.patch(`/ledger/${e1}`, { amount: 6000 })).status).toBe(422);
    expect((await a.patch(`/ledger/${e1}`, { amount: 6000, reason: 'Invoice corrected' })).status).toBe(200);
    const periods = (await a.get('/finance/periods')).body.data;
    expect(periods.find((p) => p.month === '2026-03').stale).toBe(true);
    expect(periods.find((p) => p.month === '2026-03').snapshot.revenue).toBe(5000);

    // reopen needs a reason; then finance can edit again
    expect((await f.post('/finance/periods/2026-03/reopen', {})).status).toBe(422);
    expect((await f.post('/finance/periods/2026-03/reopen', { reason: 'Late invoice' })).status).toBe(200);
    expect((await f.patch(`/ledger/${e1}`, { amount: 7000 })).status).toBe(200);
    expect((await f.post('/finance/periods/2026-03/reopen', { reason: 'again' })).status).toBe(409);
    expect(emp).toBeTruthy();
  });
});

describe('acconcy permissions', () => {
  test('manager, finance, staff and contractor see only what their role allows', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const mgr = await addMember(org, 'manager');
    const fin = await addMember(org, 'finance');
    const staff = await addMember(org, 'staff');
    const con = await addMember(org, 'contractor', 'contractor');
    const m = api(mgr.token);
    const f = api(fin.token);
    const s = api(staff.token);
    const c = api(con.token);

    // manager: leads / deals / ledger yes; investments, salaries, valuation, settings, financials no
    expect((await m.post('/leads', { name: 'M lead', service_type: 'valuation' })).status).toBe(201);
    expect((await m.get('/ledger')).status).toBe(200);
    expect((await m.get('/investments')).status).toBe(403);
    expect((await m.get('/salaries')).status).toBe(403);
    expect((await m.get('/finance/valuation')).status).toBe(403);
    expect((await m.get('/finance/periods')).status).toBe(403);
    expect((await m.patch('/settings', { profit_multiplier: 1 })).status).toBe(403);
    expect((await m.get('/dashboard')).status).toBe(200);
    expect((await m.get('/dashboard')).body.data.financial.valuation).toBeUndefined();

    // finance: money yes, leads no, settings no
    expect((await f.get('/investments')).status).toBe(200);
    expect((await f.get('/salaries')).status).toBe(200);
    expect((await f.get('/finance/valuation')).status).toBe(200);
    expect((await f.get('/leads')).status).toBe(403);
    expect((await f.get('/settings')).status).toBe(403);
    expect((await f.del('/investments/00000000-0000-4000-8000-000000000000')).status).toBe(403);

    // staff and contractor: assigned work only
    for (const x of [s, c]) {
      expect((await x.get('/leads')).status).toBe(403);
      expect((await x.get('/deals')).status).toBe(403);
      expect((await x.get('/ledger')).status).toBe(403);
      expect((await x.get('/investments')).status).toBe(403);
      expect((await x.get('/finance/pnl')).status).toBe(403);
      expect((await x.get('/my-work')).status).toBe(200);
    }
    // assigned work is visible without money figures
    const lead = await a.post('/leads', { name: 'Assigned', service_type: 'financial_consulting', assignee_id: staff.person.id, expected_amount: 999 });
    expect(lead.status).toBe(201);
    const mine = (await s.get('/my-work')).body.data;
    expect(mine.leads.map((l) => l.name)).toEqual(['Assigned']);
    expect(mine.leads[0].expected_amount).toBeUndefined();
    expect((await c.get('/my-work')).body.data.leads).toHaveLength(0);
  });

  test('pay figures are hidden from people without the salaries capability', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const emp = await person(a, 'Paid Person', 'employee', { monthly_salary: 12345 });
    const mgr = await addMember(org, 'manager');
    const fin = await addMember(org, 'finance');
    expect((await a.get('/people')).body.data.find((p) => p.id === emp).monthly_salary).toBe(12345);
    expect((await api(fin.token).get('/people')).body.data.find((p) => p.id === emp).monthly_salary).toBe(12345);
    expect((await api(mgr.token).get('/people')).body.data.find((p) => p.id === emp).monthly_salary).toBeUndefined();
    // only an admin can set it
    expect((await api(mgr.token).post('/people', { name: 'X', kind: 'employee', monthly_salary: 5 })).status).toBe(403);
  });

  test('dashboard blocks reflect the data and respect the service filter', async () => {
    const { token } = await setup();
    const a = api(token);
    const rev = await category(a, 'revenue', 'Consulting fees');
    const d1 = (await a.post('/deals', { name: 'Dash1', service_type: 'financial_consulting', deal_amount: 100 })).body.data.id;
    await a.post('/deals', { name: 'Dash2', service_type: 'valuation', deal_amount: 50 });
    await a.post('/leads', { name: 'Dash lead', service_type: 'financial_consulting' });
    await entry(a, { entry_date: new Date().toISOString().slice(0, 10), type: 'revenue', category_id: rev, deal_id: d1, amount: 70 });
    const d = (await a.get('/dashboard')).body.data;
    expect(d.pipeline.total).toBe(1);
    expect(d.deals.active).toBe(2);
    expect(d.deals.total_value).toBe(150);
    expect(d.deals.by_service.find((x) => x.key === 'valuation').count).toBe(1);
    expect(d.financial.revenue).toBe(70);
    expect(d.financial.investments.invested).toBe(0);
    const only = (await a.get('/dashboard?service_type=valuation')).body.data;
    expect(only.pipeline.total).toBe(0);
    expect(only.deals.active).toBe(1);
    expect(only.deals.total_value).toBe(50);
    expect(only.financial.revenue).toBe(0);
  });

  test('lead and deal reports aggregate under the same filters', async () => {
    const { token } = await setup();
    const a = api(token);
    const c1 = await party(a, 'client', 'Rep Client');
    const l1 = (await a.post('/leads', { name: 'R1', service_type: 'valuation', party_id: c1 })).body.data.id;
    await a.post('/leads', { name: 'R2', service_type: 'valuation' });
    for (const s of ['in_discussion', 'qualification', 'proposal', 'negotiation', 'won']) await a.post(`/leads/${l1}/stage`, { stage: s });
    await a.post(`/leads/${l1}/convert`, {});
    const lr = (await a.get('/reports/leads')).body.data;
    expect(lr.total).toBe(2);
    expect(lr.won).toBe(1);
    expect(lr.converted).toBe(1);
    expect(lr.conversion_pct).toBe(100);
    expect(lr.by_service.find((x) => x.key === 'valuation').total).toBe(2);
    expect((await a.get('/reports/leads?service_type=gold_silver')).body.data.total).toBe(0);
    const dr = (await a.get('/reports/deals')).body.data;
    expect(dr.totals.deals).toBe(1);
    expect(dr.by_client[0].label).toBe('Rep Client');
    expect((await a.get('/reports/deals?service_type=gold_silver')).body.data.totals.deals).toBe(0);
  });
});

describe('acconcy documents and parties', () => {
  test('clients and vendors are one directory with tabs, statement and soft delete', async () => {
    const { token } = await setup();
    const a = api(token);
    const c = await party(a, 'client', 'Docs Client');
    await party(a, 'vendor', 'Docs Vendor');
    await party(a, 'both', 'Docs Both');
    expect((await a.post('/parties', { kind: 'client', name: 'docs client' })).status).toBe(409);
    expect((await a.get('/parties?tab=client')).body.data).toHaveLength(2);
    expect((await a.get('/parties?tab=vendor')).body.data).toHaveLength(2);
    expect((await a.get('/parties?q=both')).body.data).toHaveLength(1);
    const st = await a.get(`/parties/${c}/statement`);
    expect(st.status).toBe(200);
    expect(st.body.data.deals).toEqual([]);
    expect((await a.del(`/parties/${c}`)).status).toBe(200);
    expect(sortIds((await a.get('/parties?tab=client')).body.data)).toHaveLength(1);
  });
});

describe('acconcy in the super admin group dashboard', () => {
  test('appears with live profit and the same valuation formula; its asset value is not set from the group view', async () => {
    const { token, org } = await setup('grp');
    const a = api(token);
    const month = new Date().toISOString().slice(0, 7);
    const rev = await category(a, 'revenue', 'Consulting fees');
    await entry(a, { entry_date: `${month}-01`, type: 'revenue', category_id: rev, amount: 1000 });
    await a.post('/assets', { name: 'Cash', category: 'cash_bank', value: 500, as_of_date: `${month}-01` });
    const superUser = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: superUser.id }, data: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: superUser.id, org_group_id: org.org_group_id } });
    await createOrgMembership(superUser.id, org.id, { role: 'admin' });
    const st = (await loginAs(superUser)).access_token;
    const res = await authed(request(app).get(`/api/v1/super-dashboard/group/overview?from=${month}&to=${month}&state=all`), st);
    expect(res.status).toBe(200);
    const c = res.body.data.companies.find((x) => x.org.id === org.id);
    expect(c.org.kind).toBe('acconcy');
    const m = c.months[0];
    expect(m.profit).toBe(1000);
    expect(m.asset_value).toBe(500);
    expect(m.valuation).toBe(1000 * 240 + 500 * 3);
    const put = await authed(request(app).put(`/api/v1/super-dashboard/companies/${org.id}/asset-values`), st).send({ month, asset_value: 1 });
    expect(put.status).toBe(422);
  });
});

describe('acconcy financial trends - locked / unlocked / all', () => {
  test('state filters closed vs open months and returns revenue next to profit and valuation', async () => {
    const { token } = await setup();
    const a = api(token);
    const rev = await category(a, 'revenue', 'Consulting fees');
    await entry(a, { entry_date: '2026-03-10', type: 'revenue', category_id: rev, amount: 5000 });
    await entry(a, { entry_date: '2026-04-10', type: 'revenue', category_id: rev, amount: 700 });
    expect((await a.post('/finance/periods/2026-03/close', {})).status).toBe(200);
    const q = (state) => a.get(`/finance/valuation?from=2026-03&to=2026-04&state=${state}`).then((r) => r.body.data.months);

    const all = await q('all');
    expect(all.map((m) => m.revenue)).toEqual([5000, 700]);
    const locked = await q('locked');
    expect(locked.map((m) => m.revenue)).toEqual([5000, 0]);
    expect(locked[0].total).toBe(all[0].total);
    expect(locked[1].profit).toBe(0);
    const unlocked = await q('unlocked');
    expect(unlocked.map((m) => m.revenue)).toEqual([0, 700]);
    expect(unlocked[0].closed).toBe(true);
    expect((await a.get('/finance/valuation?state=bogus')).status).toBe(422);
  });
});
