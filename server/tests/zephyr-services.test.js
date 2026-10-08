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
  get: (path) => authed(request(app).get(`/api/v1/zephyr${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/zephyr${path}`), token).send(body),
});
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const KEYS = ['civil_construction', 'interior_design', 'property_management', 'property_trading', 'real_estate_consulting'];

describe('zephyr service types (R0)', () => {
  test('the five services are seeded per company; an admin renames them, a manager cannot', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const a = api(token);
    const list = (await a.get('/service-types')).body.data;
    expect(list.map((s) => s.key)).toEqual(KEYS);
    expect(list.map((s) => s.label)).toEqual(['Civil Construction', 'Interior Design', 'Property Management', 'Property Trading', 'Real Estate Consulting']);
    expect((await api(manager.token).get('/service-types')).status).toBe(200);

    const renamed = await a.patch('/service-types/interior_design', { label: 'Interiors', active: false });
    expect(renamed.body.data).toMatchObject({ key: 'interior_design', label: 'Interiors', active: false });
    expect((await a.patch('/service-types/banking', { label: 'x' })).status).toBe(404);
    expect((await a.patch('/service-types/interior_design', { label: '' })).status).toBe(422);
    expect((await api(manager.token).patch('/service-types/interior_design', { label: 'Hack' })).status).toBe(403);
    const audit = (await a.get('/audit?entity=service_type')).body.data;
    expect(audit.map((r) => r.action)).toEqual(['update']);
  });

  test('another company has its own labels', async () => {
    const x = await setupZephyr('zephyr-x');
    const y = await setupZephyr('zephyr-y');
    await api(x.token).patch('/service-types/civil_construction', { label: 'Builds' });
    const other = (await api(y.token).get('/service-types')).body.data.find((s) => s.key === 'civil_construction');
    expect(other.label).toBe('Civil Construction');
  });
});

describe('zephyr clients and vendors (R0)', () => {
  test('clients keep interested services, vendors a category; hold is a status; both are filterable', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const client = await a.post('/parties', { name: 'Mehta Family', kind: 'client', company_name: 'Mehta Holdings', state: 'Maharashtra', country: 'India', interested_services: ['civil_construction', 'property_trading'], status: 'hold' });
    expect(client.status).toBe(201);
    expect(client.body.data).toMatchObject({ company_name: 'Mehta Holdings', state: 'Maharashtra', status: 'hold', interested_services: ['civil_construction', 'property_trading'] });
    await a.post('/parties', { name: 'Ready Mix Co', kind: 'vendor', vendor_category: 'Material supplier', materials_services: 'RMC, cement' });
    await a.post('/parties', { name: 'Labour Co', kind: 'vendor', vendor_category: 'Labour contractor' });
    expect((await a.post('/parties', { name: 'Bad', interested_services: ['banking'] })).status).toBe(422);

    expect((await a.get('/parties?service=property_trading')).body.data).toHaveLength(1);
    expect((await a.get('/parties?service=interior_design')).body.data).toHaveLength(0);
    expect((await a.get('/parties?vendor_category=material supplier')).body.data).toHaveLength(1);
    expect((await a.get('/parties?status=hold')).body.data).toHaveLength(1);
    expect((await a.get('/parties?q=holdings')).body.data).toHaveLength(1);
    const res = await a.get('/parties');
    expect(res.body.summary.vendor_categories).toEqual(['Labour contractor', 'Material supplier']);
  });
});

describe('zephyr lead pipeline by stage and service (R1)', () => {
  test('summary counts per stage and per service; list filters by service, location and date', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const mk = async (name, service_type, extra = {}) => (await a.post('/leads', { name, service_type, ...extra })).body.data;
    const l1 = await mk('Villas', 'civil_construction', { city: 'Gurugram', estimated_value: 1000 });
    await mk('Flat', 'interior_design', { location: 'Indore', estimated_value: 500 });
    const l3 = await mk('Brokerage', 'real_estate_consulting', { estimated_value: 300 });
    await a.post(`/leads/${l1.id}/stage`, { stage: 'in_discussion' });
    await a.post(`/leads/${l3.id}/stage`, { stage: 'won' });

    const s = (await a.get('/leads/summary')).body.data;
    expect(s.by_stage).toMatchObject({ new: { count: 1, value: 500 }, in_discussion: { count: 1, value: 1000 }, won: { count: 1, value: 300 }, dropped: { count: 0 } });
    expect(s.by_service.civil_construction).toMatchObject({ count: 1, open: 1, won: 0 });
    expect(s.by_service.real_estate_consulting).toMatchObject({ count: 1, open: 0, won: 1 });
    expect(s.by_service.property_trading).toMatchObject({ count: 0 });

    expect((await a.get('/leads?service_type=interior_design')).body.data.map((l) => l.name)).toEqual(['Flat']);
    expect((await a.get('/leads?location=gurug')).body.data.map((l) => l.name)).toEqual(['Villas']);
    expect((await a.get('/leads?location=indore')).body.data.map((l) => l.name)).toEqual(['Flat']);
    expect((await a.get(`/leads?from=${day(1)}`)).body.data).toHaveLength(0);
    expect((await a.get(`/leads?from=${day(-1)}&to=${day(1)}`)).body.data).toHaveLength(3);
    expect((await a.get('/leads?q=zl-0002')).body.data.map((l) => l.name)).toEqual(['Flat']);
  });

  test('a lead cannot be won without a service type (older rows) and conversion needs it too', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const lead = await prisma.zxLead.create({ data: { org_id: org.id, name: 'Legacy', stage: 'new' } });
    expect((await a.post(`/leads/${lead.id}/stage`, { stage: 'won' })).status).toBe(422);
    await prisma.zxLead.update({ where: { id: lead.id }, data: { stage: 'won' } });
    expect((await a.post(`/projects/from-lead/${lead.id}`)).status).toBe(422);
  });
});

describe('zephyr projects: common fields and service sections (R2)', () => {
  test('civil project: estimated cost, phases, expected profit and actuals from the ledger', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const emp = await prisma.zxPerson.create({ data: { org_id: org.id, name: 'PM', kind: 'employee' } });
    const res = await a.post('/projects', {
      name: '10 villas', service_type: 'civil_construction', contract_value: 10000000, budget: 8000000, agreement_ref: 'AGR-77', assignee_id: emp.id,
      description: 'M3M villas', details: { site: 'M3M Golf Estate', units_count: 10, phases: [{ name: 'Foundation', status: 'done' }, { name: 'Structure' }], junk: 'dropped' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ service_type: 'civil_construction', agreement_ref: 'AGR-77', expected_profit: null, expected_profit_calc: 2000000, assignee: { name: 'PM' } });
    expect(res.body.data.details).toEqual({ site: 'M3M Golf Estate', units_count: 10, phases: [{ name: 'Foundation', status: 'done' }, { name: 'Structure', status: 'pending' }] });

    const cats = (await a.get('/categories')).body.data;
    const cat = (kind, name) => cats.find((c) => c.kind === kind && c.name === name).id;
    const id = res.body.data.id;
    await a.post('/ledger', { entry_date: day(-2), type: 'revenue', category_id: cat('revenue', 'Project billing'), project_id: id, amount: 3000000 });
    await a.post('/ledger', { entry_date: day(-2), type: 'expense', category_id: cat('expense', 'Materials'), project_id: id, amount: 1800000 });
    await a.post('/ledger', { entry_date: day(10), type: 'expense', category_id: cat('expense', 'Materials'), project_id: id, amount: 999, status: 'planned' });
    const got = (await a.get(`/projects/${id}`)).body.data;
    expect(got).toMatchObject({ actual_revenue: 3000000, actual_cost: 1800000, actual_profit: 1200000 });
    const summary = (await a.get('/projects/summary')).body.data;
    expect(summary.by_service.civil_construction).toMatchObject({ total: 1, live: 1, contract_value: 10000000, revenue: 3000000, cost: 1800000 });
  });

  test('consulting project computes the commission from value x percent', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const res = await a.post('/projects', {
      name: 'Mumbai purchase', service_type: 'real_estate_consulting',
      details: { desired_property_type: 'Apartment', required_location: 'Mumbai', client_budget: 30000000, property_value: 30000000, commission_pct: 1, deal_date: day(-5), closing_date: day(-1) },
    });
    expect(res.body.data.details).toMatchObject({ property_value: 30000000, commission_pct: 1, commission_amount: 300000 });
    const edited = await a.patch(`/projects/${res.body.data.id}`, { details: { property_value: 25000000, commission_pct: 1.5, deal_date: day(-5), closing_date: day(-1) } });
    expect(edited.body.data.details.commission_amount).toBe(375000);
    expect((await a.patch(`/projects/${res.body.data.id}`, { details: { deal_date: day(-1), closing_date: day(-5) } })).status).toBe(422);
    expect((await a.patch(`/projects/${res.body.data.id}`, { details: { commission_pct: 150 } })).status).toBe(422);
    // changing the service starts a fresh section
    const moved = await a.patch(`/projects/${res.body.data.id}`, { service_type: 'interior_design' });
    expect(moved.body.data.details).toBeNull();
  });

  test('statuses: planned default, completed sets the actual end, closed locks like completed; filters work', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const p = (await a.post('/projects', { name: 'Flat reno', service_type: 'interior_design', location: 'Indore', start_date: day(2) })).body.data;
    expect(p.status).toBe('planned');
    expect((await a.post('/projects', { name: 'x', service_type: 'interior_design', status: 'planning' })).status).toBe(422);
    const done = await a.patch(`/projects/${p.id}`, { status: 'completed' });
    expect(done.body.data.actual_end.slice(0, 10)).toBe(day(0));
    expect((await a.post(`/projects/${p.id}/milestones`, { name: 'late' })).status).toBe(409);

    const q = (await a.post('/projects', { name: 'Closed one', service_type: 'civil_construction', status: 'closed' })).body.data;
    expect((await a.post(`/projects/${q.id}/milestones`, { name: 'late' })).status).toBe(409);
    expect((await a.get('/projects?service_type=interior_design')).body.data).toHaveLength(1);
    expect((await a.get('/projects?location=indo')).body.data).toHaveLength(1);
    expect((await a.get(`/projects?from=${day(1)}&to=${day(5)}`)).body.data).toHaveLength(1);
    expect((await a.get('/projects?status=open')).body.data).toHaveLength(0);
    expect((await a.post('/projects', { name: 'no service' })).status).toBe(422);
  });

  test('assignees must be matching roster people of the same company', async () => {
    const x = await setupZephyr('zephyr-x');
    const y = await setupZephyr('zephyr-y');
    const con = await prisma.zxPerson.create({ data: { org_id: x.org.id, name: 'Con', kind: 'contractor' } });
    const foreign = await prisma.zxPerson.create({ data: { org_id: y.org.id, name: 'Foreign', kind: 'employee' } });
    const a = api(x.token);
    expect((await a.post('/projects', { name: 'p', service_type: 'civil_construction', assignee_id: con.id })).status).toBe(422);
    expect((await a.post('/projects', { name: 'p', service_type: 'civil_construction', assignee_id: foreign.id })).status).toBe(422);
    expect((await a.post('/projects', { name: 'p', service_type: 'civil_construction', contractor_id: con.id })).status).toBe(201);
  });
});
