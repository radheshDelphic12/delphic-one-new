const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function setup(slug = 'gulati-co') {
  const org = await createOrg({ name: `Gulati ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['gulati'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}
async function addMember(org, accessRole, kind = 'employee') {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  const person = await prisma.gxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole, kind } });
  const { access_token } = await loginAs(user);
  return { user, person, token: access_token };
}
const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/gulati${path}`), token).send(body),
  get: (path) => authed(request(app).get(`/api/v1/gulati${path}`), token),
  put: (path, body) => authed(request(app).put(`/api/v1/gulati${path}`), token).send(body),
  patch: (path, body) => authed(request(app).patch(`/api/v1/gulati${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/gulati${path}`), token),
});
const D = '2026-03-10';
const LAKH = 100000;

async function party(a, kind, name) {
  const r = await a.post('/parties', { kind, name });
  expect(r.status).toBe(201);
  return r.body.data.id;
}

// A converted copper deal: order 100 MT, ABC client, XYZ vendor.
async function copperDeal(a, extra = {}) {
  const client = await party(a, 'client', 'ABC Industries');
  const vendor = await party(a, 'vendor', 'XYZ Metals');
  const lead = await a.post('/leads', { name: 'Copper for ABC', trading_type: 'copper_cathode', party_id: client, vendor_id: vendor, product: 'Copper Cathode', quantity: 100, unit: 'MT', expected_sale_amount: 100 * LAKH, expected_purchase_amount: 90 * LAKH, description: 'Grade A, delivery ex-warehouse', expected_start: '2026-03-01', expected_end: '2026-03-31' });
  expect(lead.status).toBe(201);
  const id = lead.body.data.id;
  for (const stage of ['in_discussion', 'negotiation', 'sourcing', 'won']) expect((await a.post(`/leads/${id}/stage`, { stage })).status).toBe(200);
  const deal = await a.post(`/leads/${id}/convert`, extra);
  expect(deal.status).toBe(201);
  return { leadId: id, deal: deal.body.data, client, vendor };
}

describe('gulati foundation, masters and isolation', () => {
  test('admin gets caps, masters are seeded and editable, other org is isolated', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const me = await a.get('/me');
    expect(me.body.data.role).toBe('admin');
    expect(me.body.data.caps).toEqual(expect.arrayContaining(['leads', 'deals', 'financials', 'override']));
    const types = (await a.get('/trading-types')).body.data;
    expect(types.map((t) => t.key)).toEqual(['copper_cathode', 'trading_deals']);
    const units = (await a.get('/units')).body.data;
    expect(units.map((u) => u.name)).toEqual(expect.arrayContaining(['Kg', 'MT', 'Ton', 'Piece']));
    // admin adds / renames / deactivates masters
    const t = await a.post('/trading-types', { label: 'Aluminium Ingots' });
    expect(t.status).toBe(201);
    expect(t.body.data.key).toBe('aluminium_ingots');
    expect((await a.patch('/trading-types/aluminium_ingots', { label: 'Aluminium', active: false })).body.data.active).toBe(false);
    const u = await a.post('/units', { name: 'Bundle' });
    expect((await a.patch(`/units/${u.body.data.id}`, { name: 'Bundles' })).body.data.name).toBe('Bundles');
    const c = await a.post('/categories', { kind: 'expense', name: 'Demurrage' });
    expect(c.status).toBe(201);
    expect((await a.post('/categories', { kind: 'expense', name: 'Demurrage' })).status).toBe(409);
    expect((await a.patch('/settings', { deal_prefix: 'GT', reason: 'new numbering' })).status).toBe(200);
    expect((await a.get('/audit')).body.data.length).toBeGreaterThan(3);

    // another Gulati org sees none of it
    const other = await setup('gulati-two');
    const b = api(other.token);
    await party(a, 'client', 'Secret Client');
    expect((await b.get('/parties')).body.data).toHaveLength(0);
    expect((await b.get('/trading-types')).body.data.map((x) => x.key)).toEqual(['copper_cathode', 'trading_deals']);
    expect(org.id).not.toBe(other.org.id);
  });

  test('a non-Gulati org is refused and a user without a role has no access', async () => {
    const org = await createOrg({ name: 'Plain', slug: 'plain-co' });
    const admin = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(admin.id, org.id, { role: 'admin' });
    const { access_token } = await loginAs(admin);
    expect((await api(access_token).get('/me')).status).toBe(403);
    const { org: g } = await setup('g3');
    const nobody = await createUser({ role: 'employee', withOrg: false });
    await createOrgMembership(nobody.id, g.id, { role: 'employee' });
    expect((await api((await loginAs(nobody)).access_token).get('/me')).status).toBe(403);
  });
});

describe('gulati parties and leads', () => {
  test('party CRUD, duplicate names, kind rules', async () => {
    const { token } = await setup();
    const a = api(token);
    const id = await party(a, 'vendor', 'XYZ Metals');
    expect((await a.post('/parties', { kind: 'client', name: 'xyz metals' })).status).toBe(409);
    expect((await a.patch(`/parties/${id}`, { vendor_category: 'Copper', city: 'Mumbai' })).body.data.vendor_category).toBe('Copper');
    expect((await a.get('/parties?tab=vendor')).body.data).toHaveLength(1);
    expect((await a.get('/parties?tab=client')).body.data).toHaveLength(0);
    // a vendor-only party cannot be the lead client
    const bad = await a.post('/leads', { name: 'X', trading_type: 'trading_deals', party_id: id });
    expect(bad.status).toBe(422);
    expect((await a.del(`/parties/${id}`)).status).toBe(200);
  });

  test('lead stages, margin, drop reason, closed lock, admin edit and reopen', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const mgr = api((await addMember(org, 'manager')).token);
    const lead = await mgr.post('/leads', { name: 'Deal A', trading_type: 'trading_deals', expected_sale_amount: 500000, expected_purchase_amount: 450000, description: 'x'.repeat(5000) });
    expect(lead.status).toBe(201);
    const d = lead.body.data;
    expect(d.code).toBe('GL-0001');
    expect(d.expected_margin).toBe(50000);
    expect((await mgr.post('/leads', { name: 'Bad', trading_type: 'nope' })).status).toBe(422);
    expect((await mgr.post(`/leads/${d.id}/stage`, { stage: 'dropped' })).status).toBe(422);
    expect((await mgr.post(`/leads/${d.id}/stage`, { stage: 'sourcing' })).status).toBe(200);
    expect((await mgr.post(`/leads/${d.id}/stage`, { stage: 'dropped', lost_reason: 'price' })).status).toBe(200);
    // closed: manager cannot edit or reopen, admin can
    expect((await mgr.patch(`/leads/${d.id}`, { name: 'Renamed' })).status).toBe(409);
    expect((await mgr.post(`/leads/${d.id}/reopen`, { reason: 'x' })).status).toBe(403);
    expect((await a.patch(`/leads/${d.id}`, { name: 'Renamed by admin' })).body.data.name).toBe('Renamed by admin');
    expect((await a.post(`/leads/${d.id}/reopen`, { stage: 'negotiation', reason: 'client is back' })).body.data.stage).toBe('negotiation');
    // not won: cannot convert
    expect((await mgr.post(`/leads/${d.id}/convert`, {})).status).toBe(409);
    // pipeline summary: trading type x stage
    const s = (await mgr.get('/leads/summary')).body.data;
    expect(s.total).toBe(1);
    expect(s.by_trading_type.trading_deals.by_stage.negotiation).toBe(1);
    expect(s.by_stage.negotiation.count).toBe(1);
    // activities + follow ups
    const act = await mgr.post(`/leads/${d.id}/activities`, { kind: 'call', summary: 'Called client', follow_up_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) });
    expect(act.status).toBe(201);
    expect((await mgr.get('/leads/follow-ups')).body.data).toHaveLength(1);
    expect((await mgr.patch(`/leads/${d.id}/activities/${act.body.data.id}`, { follow_up_done: true })).status).toBe(200);
  });
});

describe('gulati lead to deal and deal finance', () => {
  test('conversion carries everything forward, keeps the lead, and happens once', async () => {
    const { token } = await setup();
    const a = api(token);
    const { leadId, deal, client, vendor } = await copperDeal(a);
    expect(deal.code).toBe('GD-0001');
    expect(deal).toMatchObject({ trading_type: 'copper_cathode', party_id: client, vendor_id: vendor, product: 'Copper Cathode', ordered_quantity: 100, unit: 'MT', description: 'Grade A, delivery ex-warehouse', status: 'planned', expected_sale_amount: 100 * LAKH });
    expect(deal.lead.id).toBe(leadId);
    expect(deal.summary.duration_days).toBe(30);
    const lead = (await a.get(`/leads/${leadId}`)).body.data;
    expect(lead.deal.id).toBe(deal.id);
    expect(lead.stage).toBe('won');
    expect((await a.post(`/leads/${leadId}/convert`, {})).status).toBe(409);
  });

  test('gross and net profit: 1 Cr sale, 90 L purchase, 2 L expenses', async () => {
    const { token } = await setup();
    const a = api(token);
    const { deal } = await copperDeal(a);
    const p = await a.post(`/deals/${deal.id}/purchases`, { vendor_id: deal.vendor_id, purchase_date: D, quantity: 100, rate: 90 * 1000, reference: 'PO-1' });
    expect(p.status).toBe(201);
    const s = await a.post(`/deals/${deal.id}/sales`, { client_id: deal.party_id, sale_date: D, quantity: 100, rate: 100 * 1000 });
    expect(s.status).toBe(201);
    const cats = (await a.get('/categories?kind=expense')).body.data;
    const cat = (name) => cats.find((c) => c.name === name).id;
    for (const [n, amt] of [['Transportation', LAKH], ['Brokerage', 50000], ['Other expense', 50000]]) {
      expect((await a.post('/ledger', { entry_date: D, type: 'expense', category_id: cat(n), deal_id: deal.id, amount: amt })).status).toBe(201);
    }
    const sum = (await a.get(`/deals/${deal.id}`)).body.data.summary;
    expect(sum).toMatchObject({ purchase_cost: 90 * LAKH, sales_revenue: 100 * LAKH, gross_profit: 10 * LAKH, deal_expenses: 2 * LAKH, net_profit: 8 * LAKH, gross_margin_pct: 10, net_margin_pct: 8 });
    // P&L and reports
    const pnl = (await a.get('/finance/pnl')).body.data;
    expect(pnl.totals).toMatchObject({ sales_revenue: 100 * LAKH, purchase_cost: 90 * LAKH, gross_profit: 10 * LAKH, deal_expenses: 2 * LAKH, net_profit: 8 * LAKH });
    expect(pnl.by_month).toHaveLength(1);
    expect(pnl.by_trading_type.find((t) => t.key === 'copper_cathode').net_profit).toBe(8 * LAKH);
    expect((await a.get('/finance/pnl?trading_type=trading_deals')).body.data.totals.sales_revenue).toBe(0);
    expect((await a.get(`/finance/pnl?deal_id=${deal.id}&month=2026-03`)).body.data.totals.net_profit).toBe(8 * LAKH);
    expect((await a.get('/finance/pnl?month=2026-04')).body.data.totals.net_profit).toBe(0);
    const rep = (await a.get('/finance/trading-report')).body.data.find((t) => t.key === 'copper_cathode');
    expect(rep).toMatchObject({ deals: 1, purchase_qty: 100, sales_qty: 100, purchase_cost: 90 * LAKH, sales_revenue: 100 * LAKH, gross_profit: 10 * LAKH, deal_expenses: 2 * LAKH, net_profit: 8 * LAKH });
    // company-level cost lowers company net only
    await a.post('/ledger', { entry_date: D, type: 'expense', category_id: cat('Office'), amount: 10000 });
    const ov = (await a.get('/finance/overview')).body.data;
    expect(ov.net_profit).toBe(8 * LAKH - 10000);
    expect(ov.valuation).toBeTruthy();
    // Valuation = (net profit x 240) + (asset value x 3), month by month; asset value carries forward.
    expect((await a.put('/finance/asset-values', { month: '2026-03', asset_value: 1000000, notes: 'Stock + equipment' })).status).toBe(200);
    const vt = (await a.get('/finance/valuation?from=2026-03&to=2026-04')).body.data;
    expect(vt.formula).toEqual({ profit: 240, asset_value: 3 });
    const net = 8 * LAKH - 10000;
    expect(vt.months[0]).toMatchObject({ month: '2026-03', profit: net, asset_value: 1000000, asset_value_carried: false, valuation: net * 240 + 3000000 });
    expect(vt.months[1]).toMatchObject({ month: '2026-04', profit: 0, asset_value: 1000000, asset_value_carried: true, valuation: 3000000 });
    expect((await a.get('/finance/valuation?from=2026-03&to=2026-04&state=closed')).body.data.months[0].profit).toBe(0); // not closed yet
    expect((await a.get('/finance/valuation?from=2026-05&to=2026-04')).status).toBe(422);
    expect((await a.put('/finance/asset-values', { month: '2099-01', asset_value: 1 })).status).toBe(422);
    expect((await a.del('/finance/asset-values/2026-03')).status).toBe(200);
    expect((await a.get('/finance/valuation?from=2026-03&to=2026-03')).body.data.months[0].valuation).toBe(net * 240);
  });

  test('partial sourcing and supply track ordered / sourced / supplied / remaining', async () => {
    const { token } = await setup();
    const a = api(token);
    const { deal } = await copperDeal(a);
    await a.post(`/deals/${deal.id}/purchases`, { vendor_id: deal.vendor_id, purchase_date: D, quantity: 40, rate: 90000 });
    await a.post(`/deals/${deal.id}/sales`, { client_id: deal.party_id, sale_date: D, quantity: 30, rate: 100000 });
    const q = (await a.get(`/deals/${deal.id}`)).body.data.summary.quantities;
    expect(q).toEqual({ ordered: 100, sourced: 40, supplied: 30, remaining_to_source: 60, remaining_to_supply: 70 });
    // supplying beyond the order is blocked; admin can override only with a reason
    const body = { client_id: deal.party_id, sale_date: D, quantity: 80, rate: 100000 };
    expect((await a.post(`/deals/${deal.id}/sales`, body)).status).toBe(422);
    expect((await a.post(`/deals/${deal.id}/sales`, { ...body, reason: 'client agreed extra lot' })).status).toBe(201);
    expect((await a.get('/deals?flag=pending_sourcing')).body.data).toHaveLength(1);
  });

  test('payables and receivables, over-payment guard, status payment state', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const { deal } = await copperDeal(a);
    const p = (await a.post(`/deals/${deal.id}/purchases`, { vendor_id: deal.vendor_id, purchase_date: D, quantity: 10, rate: 1000 })).body.data.id;
    const s = (await a.post(`/deals/${deal.id}/sales`, { client_id: deal.party_id, sale_date: D, quantity: 10, rate: 1200 })).body.data.id;
    const fin = api((await addMember(org, 'finance')).token);
    expect((await fin.post(`/deals/${deal.id}/purchases/${p}/payments`, { amount: 4000, paid_date: D })).status).toBe(201);
    expect((await fin.post(`/deals/${deal.id}/sales/${s}/payments`, { amount: 12000, paid_date: D })).status).toBe(201);
    expect((await fin.post(`/deals/${deal.id}/purchases/${p}/payments`, { amount: 7000, paid_date: D })).status).toBe(422);
    const d = (await a.get(`/deals/${deal.id}`)).body.data;
    expect(d.summary).toMatchObject({ paid_to_vendor: 4000, vendor_outstanding: 6000, received_from_client: 12000, client_outstanding: 0 });
    expect(d.purchases[0].payment_status).toBe('partial');
    expect(d.sales[0].payment_status).toBe('paid');
    const ov = (await a.get('/finance/overview')).body.data;
    expect(ov).toMatchObject({ payables: 6000, receivables: 0 });
    expect((await a.get('/deals?flag=vendor_due')).body.data).toHaveLength(1);
  });

  test('status flow: completion sets the end date, cancel needs a reason, completed deals are locked, admin can edit', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const mgr = api((await addMember(org, 'manager')).token);
    const { deal } = await copperDeal(a);
    expect((await mgr.post(`/deals/${deal.id}/status`, { status: 'cancelled' })).status).toBe(422);
    const done = await mgr.post(`/deals/${deal.id}/status`, { status: 'completed', actual_end: '2026-03-25' });
    expect(done.body.data.actual_end.slice(0, 10)).toBe('2026-03-25');
    expect(done.body.data.summary.duration_days).toBe(24);
    expect((await mgr.patch(`/deals/${deal.id}`, { notes: 'late note' })).status).toBe(409);
    expect((await mgr.post(`/deals/${deal.id}/purchases`, { purchase_date: D, amount: 10 })).status).toBe(409);
    expect((await a.patch(`/deals/${deal.id}`, { notes: 'admin note' })).body.data.notes).toBe('admin note');
    const re = await a.post(`/deals/${deal.id}/status`, { status: 'sourcing', reason: 'client reopened' });
    expect(re.body.data.status).toBe('sourcing');
    expect(re.body.data.actual_end).toBeNull();
  });

  test('delayed deals are flagged', async () => {
    const { token } = await setup();
    const a = api(token);
    const { deal } = await copperDeal(a);
    expect(deal.summary.delayed).toBe(true); // expected end 2026-03-31 is in the past
    expect((await a.get('/deals?flag=delayed')).body.data).toHaveLength(1);
    await a.post(`/deals/${deal.id}/status`, { status: 'completed' });
    expect((await a.get('/deals?flag=delayed')).body.data).toHaveLength(0);
  });
});

describe('gulati month lock and admin overrides', () => {
  test('closed month blocks employees; admin needs a reason; reopen restores editing; audit written', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const mgr = api((await addMember(org, 'manager')).token);
    const { deal } = await copperDeal(a);
    const sale = (await a.post(`/deals/${deal.id}/sales`, { client_id: deal.party_id, sale_date: D, quantity: 1, rate: 1000 })).body.data.id;
    const cats = (await a.get('/categories?kind=expense')).body.data;
    const exp = { entry_date: D, type: 'expense', category_id: cats[0].id, deal_id: deal.id, amount: 500 };

    expect((await mgr.post('/finance/periods/2026-03/close', {})).status).toBe(403);
    const fin = api((await addMember(org, 'finance')).token);
    expect((await fin.post('/finance/periods/2099-01/close', {})).status).toBe(422);
    const closed = await fin.post('/finance/periods/2026-03/close', {});
    expect(closed.status).toBe(200);
    expect(closed.body.data.snapshot.sales_revenue).toBe(1000);
    expect((await fin.post('/finance/periods/2026-03/close', {})).status).toBe(409);

    // revenue, purchase, expense and sale edits are all refused for non-admins
    expect((await mgr.post('/ledger', exp)).status).toBe(409);
    expect((await mgr.patch(`/deals/${deal.id}/sales/${sale}`, { rate: 2000 })).status).toBe(409);
    expect((await mgr.post(`/deals/${deal.id}/purchases`, { purchase_date: D, amount: 5 })).status).toBe(409);
    expect((await mgr.del(`/deals/${deal.id}/sales/${sale}`)).status).toBe(409);
    // admin: reason required, then allowed and the close is flagged stale
    expect((await a.post('/ledger', exp)).status).toBe(422);
    expect((await a.post('/ledger', { ...exp, reason: 'late invoice' })).status).toBe(201);
    const periods = (await a.get('/finance/periods')).body.data;
    const march = periods.find((p) => p.month === '2026-03');
    expect(march).toMatchObject({ status: 'closed', stale: true });
    // reopen with a reason; employees can edit again
    expect((await fin.post('/finance/periods/2026-03/reopen', {})).status).toBe(422);
    expect((await fin.post('/finance/periods/2026-03/reopen', { reason: 'fix' })).status).toBe(200);
    expect((await mgr.post('/ledger', exp)).status).toBe(201);
    const audit = (await a.get('/audit?entity=period')).body.data.map((x) => x.action);
    expect(audit).toEqual(expect.arrayContaining(['close', 'reopen']));
  });
});

describe('gulati roles, tasks and my work', () => {
  test('finance sees money but not leads; staff and contractor see only assigned work', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const fin = api((await addMember(org, 'finance')).token);
    const staff = await addMember(org, 'staff');
    const contractor = await addMember(org, 'contractor', 'contractor');
    const s = api(staff.token);
    const c = api(contractor.token);
    expect((await fin.get('/leads')).status).toBe(403);
    expect((await fin.get('/finance/pnl')).status).toBe(200);
    expect((await fin.get('/deals')).status).toBe(200);
    expect((await fin.post('/deals', { name: 'x', trading_type: 'trading_deals' })).status).toBe(403);
    expect((await s.get('/finance/pnl')).status).toBe(403);
    expect((await s.get('/deals')).status).toBe(403);
    expect((await c.get('/leads')).status).toBe(403);
    expect((await s.get('/settings')).status).toBe(403);

    const client = await party(a, 'client', 'ABC');
    const deal = (await a.post('/deals', { name: 'Assigned deal', trading_type: 'trading_deals', party_id: client, assignee_id: staff.person.id, expected_sale_amount: 1000 })).body.data;
    await a.post('/deals', { name: 'Not mine', trading_type: 'trading_deals' });
    const task = await a.post('/tasks', { title: 'Confirm vendor material availability', task_type: 'vendor_sourcing', deal_id: deal.id, assignee_id: staff.person.id, due_date: '2026-10-10', priority: 'high' });
    expect(task.status).toBe(201);
    expect(task.body.data.code).toBe('GT-0001');
    await a.post('/tasks', { title: 'Other task', contractor_id: contractor.person.id });

    const mine = (await s.get('/my-work')).body.data;
    expect(mine.deals).toHaveLength(1);
    expect(mine.deals[0].expected_sale_amount).toBeUndefined();
    expect(mine.tasks).toHaveLength(1);
    expect((await c.get('/my-work')).body.data.tasks).toHaveLength(1);
    // own status only
    expect((await s.patch(`/tasks/${task.body.data.id}`, { title: 'hijack' })).status).toBe(403);
    const done = await s.patch(`/tasks/${task.body.data.id}`, { status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.data.completed_on).toBeTruthy();
    expect((await c.patch(`/tasks/${task.body.data.id}`, { status: 'done' })).status).toBe(404);
    expect((await s.post('/tasks', { title: 'self made' })).status).toBe(403);
  });

  test('dashboard blocks, with money only for those who may see it', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const { deal } = await copperDeal(a);
    await a.post(`/deals/${deal.id}/sales`, { client_id: deal.party_id, sale_date: D, quantity: 1, rate: 5000 });
    const dash = (await a.get('/dashboard')).body.data;
    expect(dash.pipeline.won).toBe(1);
    expect(dash.active_trading.active_deals).toBe(1);
    expect(dash.financial.sales_revenue).toBe(5000);
    expect(dash.performance.highest_value_deal.name).toBe('Copper for ABC');
    expect(dash.performance.most_active_client.name).toBe('ABC Industries');
    const mgr = (await api((await addMember(org, 'manager')).token).get('/dashboard')).body.data;
    expect(mgr.financial.valuation).toBeUndefined();
    expect((await api((await addMember(org, 'staff')).token).get('/dashboard')).status).toBe(403);
  });
});
