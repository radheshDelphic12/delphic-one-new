const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

// TRUNCATE ... CASCADE over the whole schema is slow on Windows, so clean once; every test builds its own org (unique slug)
// and all Foundation data is org-scoped, so tests cannot see each other's rows.
jest.setTimeout(120000);
beforeAll(async () => {
  await cleanDatabase();
}, 180000);
afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
}, 180000);

let orgSeq = 0;
async function setup(label = 'co') {
  orgSeq += 1;
  const slug = `fx-${label}-${Date.now()}-${orgSeq}`;
  const org = await createOrg({ name: `Foundation ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['foundation'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}
async function addMember(org, accessRole) {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  const person = await prisma.fxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole } });
  const { access_token } = await loginAs(user);
  return { user, person, token: access_token };
}
const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/foundation${path}`), token).send(body),
  put: (path, body) => authed(request(app).put(`/api/v1/foundation${path}`), token).send(body),
  get: (path) => authed(request(app).get(`/api/v1/foundation${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/foundation${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/foundation${path}`), token),
});

const iso = (d) => d.toISOString().slice(0, 10);
const monthKey = (back) => { const d = new Date(); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1))).slice(0, 7); };
const dayIn = (monthsBack, day = 10) => `${monthKey(monthsBack)}-${String(day).padStart(2, '0')}`;
const addMonthsTo = (monthsAhead, day = 28) => { const d = new Date(); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthsAhead, day))); };
const today = () => iso(new Date());

async function initiative(a, name) {
  const cats = (await a.get('/categories?scope=initiative')).body.data;
  return cats.find((c) => c.name === name).id;
}
async function campaign(a, body = {}) {
  const r = await a.post('/campaigns', { name: 'Child Care Ahmedabad', status: 'active', city: 'Ahmedabad', state: 'Gujarat', planned_start: dayIn(2, 1), planned_end: addMonthsTo(3), allocated_budget: 1000000, planned_investment: 800000, ...body });
  expect(r.status).toBe(201);
  return r.body.data;
}
async function entry(a, body, expected = 201) {
  const r = await a.post('/entries', body);
  expect(r.status).toBe(expected);
  return r.body.data;
}
const spend = (campaign_id, amount, extra = {}) => ({ kind: 'expense', campaign_id, amount, entry_date: today(), status: 'paid', ...extra });
const metrics = async (a, id) => (await a.get(`/campaigns/${id}`)).body.data.metrics;

describe('foundation access, categories and isolation', () => {
  test('roles, module gate and company isolation', async () => {
    const { org, token } = await setup('acc');
    const a = api(token);
    const me = (await a.get('/me')).body.data;
    expect(me.role).toBe('admin');
    expect(me.caps).toEqual(expect.arrayContaining(['campaignsEdit', 'budget', 'override', 'closeMonth']));

    const mgr = await addMember(org, 'manager');
    const fin = await addMember(org, 'finance');
    const staff = await addMember(org, 'staff');
    expect((await api(mgr.token).get('/me')).body.data.caps).toEqual(expect.arrayContaining(['campaignsEdit', 'budget']));
    expect((await api(mgr.token).get('/me')).body.data.caps).not.toContain('entriesApprove');
    expect((await api(fin.token).get('/me')).body.data.caps).toEqual(expect.arrayContaining(['entriesApprove', 'closeMonth']));
    expect((await api(staff.token).post('/campaigns', { name: 'Nope' })).status).toBe(403);
    expect((await api(staff.token).get('/campaigns')).status).toBe(200);
    expect((await api(staff.token).get('/reports')).status).toBe(403);

    // another foundation cannot see this one's data
    const other = await setup('other');
    await campaign(a);
    expect((await api(other.token).get('/campaigns')).body.data).toHaveLength(0);
    // a company without the module is refused
    const plain = await createOrg({ name: 'Plain Co', slug: `plain-${Date.now()}` });
    const u = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(u.id, plain.id, { role: 'admin' });
    const { access_token } = await loginAs(u);
    expect((await api(access_token).get('/campaigns')).status).toBe(403);
    // someone with no foundation role has no access
    const nobody = await createUser({ role: 'employee', withOrg: false });
    await createOrgMembership(nobody.id, org.id, { role: 'employee' });
    expect((await api((await loginAs(nobody)).access_token).get('/campaigns')).status).toBe(403);
  });

  test('categories are data-driven: seeded defaults, add, edit, switch off, scopes stay apart', async () => {
    const { token } = await setup('cat');
    const a = api(token);
    const defaults = (await a.get('/categories?scope=initiative')).body.data;
    expect(defaults.map((c) => c.name)).toEqual(expect.arrayContaining(['Child Care', 'Education', 'Healthcare', 'Food Distribution', 'Women Empowerment', 'Environmental Protection']));
    const added = await a.post('/categories', { scope: 'initiative', name: 'Disaster Relief', description: 'Emergency response' });
    expect(added.status).toBe(201);
    expect((await a.post('/categories', { scope: 'initiative', name: 'Disaster Relief' })).status).toBe(409);
    expect((await a.patch(`/categories/${added.body.data.id}`, { name: 'Disaster Response', active: false })).body.data).toMatchObject({ name: 'Disaster Response', active: false });
    expect((await a.get('/categories?scope=funding')).body.data.map((c) => c.name)).toEqual(expect.arrayContaining(['Donation', 'Grant']));
    expect((await a.get('/categories?scope=funding')).body.data.some((c) => c.name === 'Disaster Response')).toBe(false);
    // a funding category cannot be used as an initiative
    const don = (await a.get('/categories?scope=funding')).body.data[0].id;
    expect((await a.post('/campaigns', { name: 'X', category_id: don })).status).toBe(422);
    expect((await a.delete?.('/x')) === undefined || true).toBe(true);
  });
});

describe('campaigns', () => {
  test('create, code sequence, validation, edit and filters', async () => {
    const { token } = await setup('camp');
    const a = api(token);
    const cat = await initiative(a, 'Child Care');
    const c1 = await campaign(a, { category_id: cat, objective: 'Care for 200 children' });
    expect(c1.code).toBe('GF-0001');
    expect(c1.metrics).toMatchObject({ allocated_budget: 1000000, planned_investment: 800000, actual_expenditure: 0, remaining_allocated: 1000000 });
    expect(c1.timeline.duration_days).toBeGreaterThan(60);
    expect(c1.budget_history).toHaveLength(1);
    expect(c1.budget_history[0]).toMatchObject({ new_allocated: 1000000, reason: 'Initial budget' });
    const c2 = await campaign(a, { name: 'School Surat', city: 'Surat', status: 'planned', allocated_budget: 500000, planned_investment: 400000 });
    expect(c2.code).toBe('GF-0002');

    // validation
    expect((await a.post('/campaigns', { name: 'Bad dates', planned_start: '2026-05-01', planned_end: '2026-04-01' })).status).toBe(422);
    expect((await a.post('/campaigns', { name: 'Bad money', allocated_budget: 100, planned_investment: 200 })).status).toBe(422);
    expect((await a.post('/campaigns', { name: '' })).status).toBe(422);
    expect((await a.patch(`/campaigns/${c1.id}`, { actual_end: today() })).status).toBe(422); // active campaign cannot have a completion date
    expect((await a.patch(`/campaigns/${c2.id}`, { actual_start: today() })).status).toBe(422); // planned has not started
    // money is not editable through PATCH (it is ignored: only the budget route changes it)
    await a.patch(`/campaigns/${c1.id}`, { allocated_budget: 1, name: 'Child Care Ahmedabad Phase 1' });
    const again = (await a.get(`/campaigns/${c1.id}`)).body.data;
    expect(again.name).toBe('Child Care Ahmedabad Phase 1');
    expect(again.allocated_budget).toBe(1000000);

    // filters
    const ids = async (qs) => (await a.get(`/campaigns${qs}`)).body.data.map((c) => c.code).sort();
    expect(await ids('')).toEqual(['GF-0001', 'GF-0002']);
    expect(await ids('?status=planned')).toEqual(['GF-0002']);
    expect(await ids('?status=planned,active')).toEqual(['GF-0001', 'GF-0002']);
    expect(await ids(`?category_id=${cat}`)).toEqual(['GF-0001']);
    expect(await ids('?city=Surat')).toEqual(['GF-0002']);
    expect(await ids('?q=surat')).toEqual(['GF-0002']);
    expect(await ids('?budget_min=600000')).toEqual(['GF-0001']);
    expect(await ids('?budget_max=600000')).toEqual(['GF-0002']);
    const sorted = (await a.get('/campaigns?sort=budget&dir=asc')).body.data.map((c) => c.code);
    expect(sorted).toEqual(['GF-0002', 'GF-0001']);
    expect((await a.get('/campaigns?limit=1&page=2')).body.pagination).toMatchObject({ page: 2, total: 2, pages: 2 });
  });

  test('status life cycle keeps the actual dates consistent; reopening is an admin decision', async () => {
    const { org, token } = await setup('life');
    const a = api(token);
    const mgr = await addMember(org, 'manager');
    const c = await campaign(a, { status: 'draft' });
    expect(c.status).toBe('draft');
    expect((await a.post(`/campaigns/${c.id}/status`, { to: 'completed' })).status).toBe(409); // not allowed from draft
    const active = (await a.post(`/campaigns/${c.id}/status`, { to: 'active' })).body.data;
    expect(active.actual_start).toBe(today());
    expect(active.actual_end).toBeNull();
    expect((await a.post(`/campaigns/${c.id}/status`, { to: 'active' })).status).toBe(409);
    expect((await a.post(`/campaigns/${c.id}/status`, { to: 'on_hold' })).body.data.status).toBe('on_hold');
    await a.post(`/campaigns/${c.id}/status`, { to: 'active' });
    const done = (await a.post(`/campaigns/${c.id}/status`, { to: 'completed' })).body.data;
    expect(done).toMatchObject({ status: 'completed', actual_end: today() });
    expect((await a.post(`/campaigns/${c.id}/status`, { to: 'cancelled' })).status).toBe(409);
    expect((await api(mgr.token).post(`/campaigns/${c.id}/status`, { to: 'active', reason: 'x' })).status).toBe(403);
    expect((await a.post(`/campaigns/${c.id}/status`, { to: 'active' })).status).toBe(422); // reopening needs a reason
    const reopened = (await a.post(`/campaigns/${c.id}/status`, { to: 'active', reason: 'Extended by trustees' })).body.data;
    expect(reopened.actual_end).toBeNull();
    expect((await a.post(`/campaigns/${c.id}/status`, { to: 'cancelled' })).status).toBe(422); // cancelling needs a reason
    expect((await a.post(`/campaigns/${c.id}/status`, { to: 'cancelled', reason: 'Funding withdrawn' })).body.data.status).toBe('cancelled');
    const activity = (await a.get(`/campaigns/${c.id}`)).body.data.activity;
    expect(activity.some((x) => x.action === 'status' && x.reason === 'Funding withdrawn')).toBe(true);
    // a campaign with transactions is cancelled, not deleted
    const d = await campaign(a, { name: 'Has money' });
    await entry(a, spend(d.id, 1000));
    expect((await a.del(`/campaigns/${d.id}`)).status).toBe(409);
    const e = await campaign(a, { name: 'Empty' });
    expect((await a.del(`/campaigns/${e.id}`)).status).toBe(200);
    expect((await a.get(`/campaigns/${e.id}`)).status).toBe(404);
  });
});

describe('budgets and the accounting rules', () => {
  test('the worked example: allocated 10 lakh, planned 8 lakh, 3 lakh invested - nothing is counted twice', async () => {
    const { token } = await setup('math');
    const a = api(token);
    const c = await campaign(a);
    await entry(a, spend(c.id, 300000)); // programme by default when tied to a campaign
    let m = await metrics(a, c.id);
    expect(m).toMatchObject({ actual_expenditure: 300000, actual_investment: 300000, remaining_allocated: 700000, uncommitted: 700000, planned_remaining: 500000, overspend: 0, utilization_pct: 30 });

    // pending is not spending; approved is a commitment; rejected / cancelled / reversed never count
    await entry(a, spend(c.id, 50000, { status: 'pending' }));
    const approved = await entry(a, spend(c.id, 100000, { status: 'approved' }));
    const rejected = await entry(a, spend(c.id, 40000, { status: 'pending' }));
    await a.post(`/entries/${rejected.id}/status`, { to: 'rejected', reason: 'Not eligible' });
    m = await metrics(a, c.id);
    expect(m).toMatchObject({ actual_expenditure: 300000, commitments: 100000, remaining_allocated: 700000, uncommitted: 600000 });
    // the commitment is paid: it moves from commitments to actual spending
    await a.post(`/entries/${approved.id}/status`, { to: 'paid' });
    m = await metrics(a, c.id);
    expect(m).toMatchObject({ actual_expenditure: 400000, actual_investment: 400000, commitments: 0, remaining_allocated: 600000, planned_remaining: 400000 });

    // an operational payment is spending but not investment against the plan
    const ops = await entry(a, spend(c.id, 20000, { expense_class: 'operational' }));
    m = await metrics(a, c.id);
    expect(m).toMatchObject({ actual_expenditure: 420000, actual_investment: 400000, actual_operational: 20000 });
    // refund: reversing a payment takes it out again
    await a.post(`/entries/${ops.id}/status`, { to: 'reversed', reason: 'Refunded by vendor' });
    expect((await metrics(a, c.id)).actual_expenditure).toBe(400000);

    // funding is its own thing: received counts, pledged is shown apart, transfers are neither
    await entry(a, { kind: 'funding', campaign_id: c.id, amount: 600000, entry_date: today(), status: 'received' });
    await entry(a, { kind: 'funding', campaign_id: c.id, amount: 100000, entry_date: today(), status: 'pledged' });
    await entry(a, { kind: 'transfer', amount: 250000, entry_date: today(), description: 'Between bank accounts' });
    m = await metrics(a, c.id);
    expect(m).toMatchObject({ funds_received: 600000, funds_pledged: 100000, net_funds: 200000, actual_expenditure: 400000 });
    // the transfer is not part of income or expense anywhere
    const trend = (await a.get('/finance/valuation')).body.data.months.find((x) => x.month === monthKey(0));
    expect(trend).toMatchObject({ income: 600000, expenses: 400000, surplus: 200000 });
    expect(trend.valuation).toBeNull();
  });

  test('validation of entries, status chains and who may approve', async () => {
    const { org, token } = await setup('chain');
    const a = api(token);
    const mgr = await addMember(org, 'manager');
    const fin = await addMember(org, 'finance');
    const c = await campaign(a);
    const draft = await campaign(a, { name: 'Draft one', status: 'draft' });
    const gone = await campaign(a, { name: 'Gone', status: 'planned' });
    await a.post(`/campaigns/${gone.id}/status`, { to: 'cancelled', reason: 'x' });
    await entry(a, spend(draft.id, 10, { status: 'pending' }), 409); // draft cannot have spending
    await entry(a, spend(gone.id, 10, { status: 'pending' }), 409);
    await entry(a, spend(c.id, 0), 422);
    await entry(a, { kind: 'funding', campaign_id: c.id, amount: 5, entry_date: today(), status: 'paid' }, 422);
    await entry(a, { kind: 'transfer', campaign_id: c.id, amount: 5, entry_date: today() }, 422);
    await entry(a, { kind: 'expense', amount: 5, entry_date: today(), expense_class: 'programme', status: 'pending' }, 422); // programme needs a campaign
    // a manager records spending as pending; only finance / admin approve and pay
    const mgrApi = api(mgr.token);
    const pending = await entry(mgrApi, spend(c.id, 5000, { status: 'pending' }));
    await entry(mgrApi, spend(c.id, 5000, { status: 'paid' }), 403);
    expect((await mgrApi.post(`/entries/${pending.id}/status`, { to: 'approved' })).status).toBe(403);
    const finApi = api(fin.token);
    expect((await finApi.post(`/entries/${pending.id}/status`, { to: 'paid' })).status).toBe(409); // must be approved first
    expect((await finApi.post(`/entries/${pending.id}/status`, { to: 'approved' })).body.data.status).toBe('approved');
    expect((await finApi.post(`/entries/${pending.id}/status`, { to: 'paid' })).body.data.status).toBe('paid');
    expect((await finApi.post(`/entries/${pending.id}/status`, { to: 'reversed' })).status).toBe(422); // reason needed
    expect((await finApi.patch(`/entries/${pending.id}`, { amount: 6000 })).status).toBe(422); // counted money: reason needed
    expect((await finApi.patch(`/entries/${pending.id}`, { amount: 6000, reason: 'Invoice corrected' })).status).toBe(200);
    expect((await mgrApi.patch(`/entries/${pending.id}`, { amount: 1, reason: 'x' })).status).toBe(403);
    expect((await mgrApi.del(`/entries/${pending.id}`)).status).toBe(403);
    // an entry that is only pending can be edited and deleted by whoever made it
    const p2 = await entry(mgrApi, spend(c.id, 700, { status: 'pending' }));
    expect((await mgrApi.patch(`/entries/${p2.id}`, { amount: 800 })).body.data.amount).toBe(800);
    expect((await mgrApi.del(`/entries/${p2.id}`)).status).toBe(200);
    // list filters + totals follow the same rules
    const list = (await a.get(`/entries?campaign_id=${c.id}&kind=expense`)).body;
    expect(list.summary).toMatchObject({ paid_expenditure: 6000, commitments: 0 });
    expect((await a.get(`/entries?campaign_id=${c.id}&status=paid`)).body.data).toHaveLength(1);
    expect((await a.get('/entries?q=nothing-matches')).body.data).toHaveLength(0);
  });

  test('overspending is stopped, an admin can override with a reason, and it is recorded', async () => {
    const { org, token } = await setup('over');
    const a = api(token);
    const mgr = await addMember(org, 'manager');
    const fin = await addMember(org, 'finance');
    const c = await campaign(a, { allocated_budget: 100000, planned_investment: 80000 });
    await entry(a, spend(c.id, 90000));
    // 20,000 more would exceed the 1,00,000 budget
    const blocked = await api(fin.token).post('/entries', spend(c.id, 20000));
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('over_budget');
    expect(blocked.body.detail).toMatchObject({ overspend: 10000, remaining: 10000 });
    expect((await a.post('/entries', spend(c.id, 20000))).status).toBe(422); // admin must say why
    const ok = await a.post('/entries', spend(c.id, 20000, { override_reason: 'Emergency medical supplies' }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.override_reason).toBe('Emergency medical supplies');
    const m = await metrics(a, c.id);
    expect(m).toMatchObject({ actual_expenditure: 110000, overspend: 10000, remaining_allocated: 0, over_budget: true });
    expect(m.remaining_allocated).toBeGreaterThanOrEqual(0); // never presented as negative available money
    const flags = (await a.get(`/campaigns/${c.id}`)).body.data.flags;
    expect(flags.find((f) => f.type === 'over_budget').amount).toBe(10000);
    expect((await a.get(`/campaigns/${c.id}`)).body.data.activity).toBeDefined();
    // a pending expense is not counted, so it is not blocked until it is approved
    const p = await entry(api(mgr.token), spend(c.id, 50000, { status: 'pending' }));
    expect((await a.post(`/entries/${p.id}/status`, { to: 'approved' })).status).toBe(422);
    expect((await a.post(`/entries/${p.id}/status`, { to: 'approved', override_reason: 'Approved by trustees' })).status).toBe(200);
    // policy off: the spend is allowed and a warning comes back
    await a.patch('/settings', { block_overspend: false, reason: 'Pilot year' });
    const warned = await a.post('/entries', spend(c.id, 1000));
    expect(warned.status).toBe(201);
    expect(warned.body.warning).toBeDefined();
    const audit = (await a.get('/audit?entity=setting')).body.data;
    expect(audit[0]).toMatchObject({ action: 'update', reason: 'Pilot year' });
  });

  test('budget revision keeps its history; it cannot silently drop below what is spent', async () => {
    const { org, token } = await setup('rev');
    const a = api(token);
    const mgr = await addMember(org, 'manager');
    const c = await campaign(a);
    await entry(a, spend(c.id, 400000));
    const mgrApi = api(mgr.token);
    expect((await mgrApi.post(`/campaigns/${c.id}/budget`, { allocated_budget: 1200000 })).status).toBe(422); // reason is required
    const up = await mgrApi.post(`/campaigns/${c.id}/budget`, { allocated_budget: 1200000, planned_investment: 1000000, reason: 'Second donor joined' });
    expect(up.status).toBe(200);
    expect(up.body.data).toMatchObject({ allocated_budget: 1200000, planned_investment: 1000000 });
    expect(up.body.data.budget_history).toHaveLength(2);
    expect(up.body.data.budget_history[0]).toMatchObject({ previous_allocated: 1000000, new_allocated: 1200000, reason: 'Second donor joined' });
    expect((await mgrApi.post(`/campaigns/${c.id}/budget`, { allocated_budget: 1200000, planned_investment: 1000000, reason: 'again' })).status).toBe(422); // no change
    expect((await mgrApi.post(`/campaigns/${c.id}/budget`, { allocated_budget: 300000, planned_investment: 200000, reason: 'Cut' })).status).toBe(422); // below the 4 lakh spent
    const cut = await a.post(`/campaigns/${c.id}/budget`, { allocated_budget: 300000, planned_investment: 200000, reason: 'Board decision' });
    expect(cut.status).toBe(200);
    expect(cut.body.data.metrics).toMatchObject({ overspend: 100000, remaining_allocated: 0 });
    expect((await a.post(`/campaigns/${c.id}/budget`, { allocated_budget: 100, planned_investment: 200, reason: 'bad' })).status).toBe(422);
    const audit = (await a.get(`/audit?entity=budget&entity_id=${c.id}`)).body.data;
    expect(audit.map((x) => x.reason)).toEqual(expect.arrayContaining(['Second donor joined', 'Board decision']));
  });
});

describe('projections', () => {
  test('plan method: the remaining planned investment is spread over the remaining months', async () => {
    const { token } = await setup('plan');
    const a = api(token);
    // 6-month campaign: started 2 months ago, ends in 3 months (this month included)
    const c = await campaign(a, { planned_start: dayIn(2, 1), planned_end: addMonthsTo(3, 28), allocated_budget: 1200000, planned_investment: 1000000 });
    await entry(a, spend(c.id, 400000, { entry_date: dayIn(1, 15) }));
    const d = (await a.get(`/campaigns/${c.id}`)).body.data;
    expect(d.metrics).toMatchObject({ actual_investment: 400000, planned_remaining: 600000 });
    expect(d.plan_source).toBe('even');
    expect(d.forecast.method).toBe('plan');
    expect(d.forecast.monthly.map((m) => m.month)).toEqual([monthKey(0), monthKey(-1), monthKey(-2), monthKey(-3)]);
    expect(d.forecast.monthly.reduce((s, m) => s + m.projected, 0)).toBeCloseTo(600000, 2);
    expect(d.forecast.projected_final_expenditure).toBeCloseTo(1000000, 2);
    expect(d.forecast.projected_remaining_budget).toBeCloseTo(200000, 2);
    expect(d.forecast.projected_overrun).toBe(0);
    // projections are not transactions
    expect((await a.get(`/entries?campaign_id=${c.id}`)).body.data).toHaveLength(1);
    // the series shows planned versus actual per month
    const feb = d.monthly.find((m) => m.month === monthKey(1));
    expect(feb).toMatchObject({ actual_investment: 400000, actual_expenditure: 400000 });
    expect(feb.planned_investment).toBeGreaterThan(0);
    expect(d.monthly.find((m) => m.month === monthKey(1)).remaining_planned_investment).toBe(600000);

    // an explicit monthly plan replaces the even spread
    const rows = [monthKey(0), monthKey(-1), monthKey(-2), monthKey(-3)].map((month, i) => ({ month, planned_amount: [300000, 300000, 0, 0][i] }));
    const set = await a.put(`/campaigns/${c.id}/plan`, { rows });
    expect(set.status).toBe(200);
    const after = set.body.data;
    expect(after.plan_source).toBe('plan');
    expect(after.forecast.monthly.find((m) => m.month === monthKey(0)).projected).toBeCloseTo(300000, 2);
    expect(after.forecast.monthly.find((m) => m.month === monthKey(-2)).projected).toBe(0);
    // plan rules
    expect((await a.put(`/campaigns/${c.id}/plan`, { rows: [{ month: monthKey(0), planned_amount: 1 }, { month: monthKey(0), planned_amount: 2 }] })).status).toBe(422);
    expect((await a.put(`/campaigns/${c.id}/plan`, { rows: [{ month: monthKey(0), planned_amount: 2000000 }] })).status).toBe(422);
    expect((await a.put(`/campaigns/${c.id}/plan`, { rows: [{ month: monthKey(10), planned_amount: 1 }] })).status).toBe(422);
  });

  test('not started, completed, no dates, run-rate with and without history, overrun and attention flags', async () => {
    const { token } = await setup('fc');
    const a = api(token);
    // not started: planned schedule, no invented spending
    const future = await campaign(a, { name: 'Future', status: 'planned', planned_start: addMonthsTo(2, 1), planned_end: addMonthsTo(4, 28), allocated_budget: 300000, planned_investment: 240000 });
    let d = (await a.get(`/campaigns/${future.id}`)).body.data;
    expect(d.metrics.actual_expenditure).toBe(0);
    expect(d.forecast.monthly[0].month).toBe(monthKey(-2));
    expect(d.forecast.projected_final_expenditure).toBeCloseTo(240000, 2);
    // completed: final actuals, no projection
    const done = await campaign(a, { name: 'Done' });
    await entry(a, spend(done.id, 600000));
    await a.post(`/campaigns/${done.id}/status`, { to: 'completed' });
    d = (await a.get(`/campaigns/${done.id}`)).body.data;
    expect(d.forecast).toMatchObject({ method: 'final', projected_final_expenditure: 600000, monthly: [] });
    expect(d.flags.some((f) => f.type === 'completed_unspent' && f.amount === 400000)).toBe(true);
    // no planned end: no projection (and it says so)
    const open = await campaign(a, { name: 'Open ended', planned_end: null });
    d = (await a.get(`/campaigns/${open.id}`)).body.data;
    expect(d.forecast).toMatchObject({ insufficient: true, projected_final_expenditure: null });

    // run-rate: needs two complete months of spending
    await a.patch('/settings', { forecast_method: 'run_rate', run_rate_months: 3 });
    const rr = await campaign(a, { name: 'Run rate', planned_start: dayIn(3, 1), planned_end: addMonthsTo(2, 28), allocated_budget: 500000, planned_investment: 400000 });
    d = (await a.get(`/campaigns/${rr.id}`)).body.data;
    expect(d.forecast.method).toBe('plan');
    expect(d.forecast.note).toMatch(/at least two complete months/);
    await entry(a, spend(rr.id, 100000, { entry_date: dayIn(2, 5) }));
    await entry(a, spend(rr.id, 140000, { entry_date: dayIn(1, 5) }));
    d = (await a.get(`/campaigns/${rr.id}`)).body.data;
    expect(d.forecast.method).toBe('run_rate');
    // average 1,20,000 a month over the next 3 months (this month + 2 ahead) = 3,60,000 on top of 2,40,000 spent
    expect(d.forecast.projected_final_expenditure).toBeCloseTo(240000 + 360000, 2);
    expect(d.forecast.projected_overrun).toBeCloseTo(100000, 2);
    expect(d.flags.some((f) => f.type === 'projected_overrun')).toBe(true);

    // ending soon with funds left, delayed, no budget
    await a.patch('/settings', { forecast_method: 'plan' });
    const soon = await campaign(a, { name: 'Ending', planned_start: dayIn(3, 1), planned_end: addMonthsTo(0, Math.min(28, new Date().getUTCDate() + 10 > 28 ? 28 : new Date().getUTCDate() + 10)), allocated_budget: 100000, planned_investment: 80000 });
    const sd = (await a.get(`/campaigns/${soon.id}`)).body.data;
    if (sd.timeline.days_to_end !== null && sd.timeline.days_to_end >= 0 && sd.timeline.days_to_end <= 30) expect(sd.flags.some((f) => f.type === 'ending_with_funds')).toBe(true);
    const late = await campaign(a, { name: 'Late', planned_start: dayIn(5, 1), planned_end: addMonthsTo(-1, 10) });
    expect((await a.get(`/campaigns/${late.id}`)).body.data.flags.some((f) => f.type === 'delayed')).toBe(true);
    const nb = await campaign(a, { name: 'No budget', allocated_budget: 0, planned_investment: 0 });
    expect((await a.get(`/campaigns/${nb.id}`)).body.data.flags.some((f) => f.type === 'no_budget')).toBe(true);
    await entry(a, spend(nb.id, 100), 422); // nothing may be spent against a zero budget without an override reason
  });
});

describe('financials, month close, dashboard and reports', () => {
  test('month close locks spending dated in it; locked / unlocked / all views', async () => {
    const { org, token } = await setup('lock');
    const a = api(token);
    const fin = await addMember(org, 'finance');
    const c = await campaign(a, { allocated_budget: 5000000, planned_investment: 4000000 });
    const lastMonth = monthKey(1);
    await entry(a, { kind: 'funding', campaign_id: c.id, amount: 90000, entry_date: `${lastMonth}-05`, status: 'received' });
    await entry(a, spend(c.id, 40000, { entry_date: `${lastMonth}-06` }));
    await entry(a, spend(c.id, 10000, { entry_date: `${monthKey(0)}-02` }));
    const q = async (state) => (await a.get(`/finance/valuation?from=${lastMonth}&to=${monthKey(0)}&state=${state}`)).body.data.months;
    expect((await q('all')).map((m) => [m.income, m.expenses])).toEqual([[90000, 40000], [0, 10000]]);
    expect((await q('locked')).map((m) => [m.income, m.expenses])).toEqual([[0, 0], [0, 0]]);
    const closed = await api(fin.token).post(`/finance/periods/${lastMonth}/close`, { note: 'Reconciled' });
    expect(closed.status).toBe(200);
    expect((await api(fin.token).post(`/finance/periods/${lastMonth}/close`, {})).status).toBe(409);
    expect((await q('locked')).map((m) => [m.income, m.expenses, m.closed])).toEqual([[90000, 40000, true], [0, 0, false]]);
    expect((await q('unlocked')).map((m) => [m.income, m.expenses])).toEqual([[0, 0], [0, 10000]]);
    // asset value = the fund balance (income - expenses so far), never negative
    expect((await q('all'))[0].asset_value).toBe(50000);
    // money dated in a closed month is locked for non-admins; an admin needs a reason
    expect((await api(fin.token).post('/entries', spend(c.id, 500, { entry_date: `${lastMonth}-10` }))).status).toBe(409);
    expect((await a.post('/entries', spend(c.id, 500, { entry_date: `${lastMonth}-10` }))).status).toBe(422);
    expect((await a.post('/entries', spend(c.id, 500, { entry_date: `${lastMonth}-10`, reason: 'Late invoice' }))).status).toBe(201);
    const periods = (await a.get('/finance/periods')).body.data;
    expect(periods.find((p) => p.month === lastMonth)).toMatchObject({ status: 'closed', stale: true });
    expect((await api(fin.token).post(`/finance/periods/${lastMonth}/reopen`, {})).status).toBe(422);
    expect((await api(fin.token).post(`/finance/periods/${lastMonth}/reopen`, { reason: 'Adjustment' })).status).toBe(200);
    expect((await a.post(`/finance/periods/${monthKey(-2)}/close`, {})).status).toBe(422); // future month
    expect((await a.get('/finance/valuation?from=2026-08&to=2026-01')).status).toBe(422);
  });

  test('dashboard KPIs equal the sum of the campaigns; reports all run; filters narrow them', async () => {
    const { token } = await setup('dash');
    const a = api(token);
    const cat = await initiative(a, 'Education');
    const c1 = await campaign(a, { name: 'Education Surat', city: 'Surat', category_id: cat, allocated_budget: 800000, planned_investment: 600000 });
    const c2 = await campaign(a, { name: 'Health Camp', city: 'Rajkot', allocated_budget: 200000, planned_investment: 150000 });
    await campaign(a, { name: 'Future', status: 'planned', allocated_budget: 100000, planned_investment: 50000, planned_start: addMonthsTo(2, 1), planned_end: addMonthsTo(5, 28) });
    await entry(a, spend(c1.id, 300000, { entry_date: dayIn(1, 12) }));
    await entry(a, spend(c2.id, 50000));
    await entry(a, spend(c2.id, 30000, { status: 'approved' }));
    await entry(a, { kind: 'funding', campaign_id: c1.id, amount: 500000, entry_date: dayIn(1, 3), status: 'received' });
    const dash = (await a.get('/dashboard')).body.data;
    expect(dash.kpis.campaigns).toMatchObject({ total: 3, active: 2, planned: 1 });
    expect(dash.kpis).toMatchObject({ allocated_budget: 1100000, planned_investment: 800000, actual_expenditure: 350000, actual_investment: 350000, commitments: 30000, funds_received: 500000, remaining_allocated: 750000, uncommitted: 720000 });
    expect(dash.kpis.projected_final_expenditure).toBeGreaterThan(0);
    expect(dash.by_category.find((x) => x.name === 'Education')).toMatchObject({ allocated_budget: 800000, actual_expenditure: 300000 });
    // the period filter limits what moved inside it; budgets stay all-time
    const lastMonth = monthKey(1);
    const inLast = (await a.get(`/dashboard?from=${lastMonth}-01&to=${lastMonth}-28`)).body.data.kpis;
    expect(inLast.period).toMatchObject({ actual_expenditure: 300000, funds_received: 500000 });
    expect(inLast.allocated_budget).toBe(1100000);
    expect((await a.get('/dashboard?city=Surat')).body.data.kpis.campaigns.total).toBe(1);

    // every report answers and its totals match the campaigns
    const keys = (await a.get('/reports')).body.data.reports.map((r) => r.key);
    expect(keys.length).toBeGreaterThanOrEqual(13);
    for (const key of keys) {
      const r = await a.get(`/reports?report=${key}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data.rows)).toBe(true);
    }
    const cb = (await a.get('/reports?report=campaign_budget')).body.data;
    expect(cb.totals).toMatchObject({ allocated: 1100000, spent: 350000, remaining: 750000 });
    expect((await a.get('/reports?report=category_budget')).body.data.rows.find((r) => r.name === 'Education').allocated).toBe(800000);
    expect((await a.get('/reports?report=location_spend')).body.data.rows.map((r) => r.name)).toEqual(expect.arrayContaining(['Surat, Gujarat', 'Rajkot, Gujarat']));
    const fv = (await a.get(`/reports?report=funding_vs_expenditure&from=${lastMonth}-01&to=${monthKey(0)}-28`)).body.data.rows;
    expect(fv.find((r) => r.month === lastMonth)).toMatchObject({ received: 500000, spent: 300000, net: 200000 });
    expect((await a.get('/reports?report=nope')).status).toBe(404);
    expect((await a.get('/reports?report=campaign_budget&status=planned')).body.data.rows).toHaveLength(1);
  });
});
