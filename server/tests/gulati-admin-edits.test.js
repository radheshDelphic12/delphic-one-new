const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function setup(slug = 'gulati-edit') {
  const org = await createOrg({ name: `Gulati ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['gulati'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  return { org, admin, token: (await loginAs(admin)).access_token };
}
async function addMember(org, accessRole) {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  await prisma.gxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole } });
  return { user, token: (await loginAs(user)).access_token };
}
const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/gulati${path}`), token).send(body),
  get: (path) => authed(request(app).get(`/api/v1/gulati${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/gulati${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/gulati${path}`), token),
});
const D = '2026-03-10';

async function dealWithLines(a) {
  const client = (await a.post('/parties', { kind: 'client', name: 'ABC' })).body.data.id;
  const vendor = (await a.post('/parties', { kind: 'vendor', name: 'XYZ' })).body.data.id;
  const deal = (await a.post('/deals', { name: 'Deal', trading_type: 'copper_cathode', party_id: client, vendor_id: vendor, ordered_quantity: 10, unit: 'MT' })).body.data;
  const purchase = (await a.post(`/deals/${deal.id}/purchases`, { vendor_id: vendor, purchase_date: D, quantity: 10, rate: 1000 })).body.data.id;
  const sale = (await a.post(`/deals/${deal.id}/sales`, { client_id: client, sale_date: D, quantity: 10, rate: 1200 })).body.data.id;
  return { client, vendor, deal, purchase, sale };
}

describe('gulati: every record is editable by an admin', () => {
  test('lines can be edited, repriced and removed, and totals follow', async () => {
    const { token } = await setup();
    const a = api(token);
    const { deal, purchase, sale } = await dealWithLines(a);
    expect((await a.patch(`/deals/${deal.id}/purchases/${purchase}`, { rate: 1100 })).status).toBe(200);
    // amount override: an explicit figure wins over qty x rate and is audited
    expect((await a.patch(`/deals/${deal.id}/sales/${sale}`, { amount: 12500, reason: 'negotiated lump sum' })).status).toBe(200);
    let s = (await a.get(`/deals/${deal.id}`)).body.data.summary;
    expect(s).toMatchObject({ purchase_cost: 11000, sales_revenue: 12500, gross_profit: 1500 });
    expect((await a.del(`/deals/${deal.id}/sales/${sale}`)).status).toBe(200);
    s = (await a.get(`/deals/${deal.id}`)).body.data.summary;
    expect(s.sales_revenue).toBe(0);
    const audit = (await a.get('/audit?entity=purchase')).body.data;
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(['create', 'update']));
    expect((await a.get('/audit?entity=sale')).body.data.some((x) => x.reason === 'negotiated lump sum')).toBe(true);
  });

  test('payments can be edited and deleted; admin can override an over-payment with a reason', async () => {
    const { token } = await setup();
    const a = api(token);
    const { deal, purchase } = await dealWithLines(a);
    const pay = (await a.post(`/deals/${deal.id}/purchases/${purchase}/payments`, { amount: 4000, paid_date: D })).body.data.id;
    expect((await a.patch(`/deals/${deal.id}/payments/${pay}`, { amount: 6000 })).status).toBe(200);
    expect((await a.get(`/deals/${deal.id}`)).body.data.summary.paid_to_vendor).toBe(6000);
    // 10,000 purchase: another 5,000 is over the amount; admin needs a reason, then it goes through
    expect((await a.post(`/deals/${deal.id}/purchases/${purchase}/payments`, { amount: 5000, paid_date: D })).status).toBe(422);
    expect((await a.post(`/deals/${deal.id}/purchases/${purchase}/payments`, { amount: 5000, paid_date: D, reason: 'advance for next lot' })).status).toBe(201);
    expect((await a.get(`/deals/${deal.id}`)).body.data.summary.vendor_outstanding).toBe(-1000);
    expect((await a.del(`/deals/${deal.id}/payments/${pay}`)).status).toBe(200);
    expect((await a.get(`/deals/${deal.id}`)).body.data.summary.paid_to_vendor).toBe(5000);
  });

  test('admin edits and removes lines inside a closed month with a reason; the close is flagged stale', async () => {
    const { token } = await setup();
    const a = api(token);
    const { deal, purchase } = await dealWithLines(a);
    expect((await a.post('/finance/periods/2026-03/close', {})).status).toBe(200);
    expect((await a.patch(`/deals/${deal.id}/purchases/${purchase}`, { rate: 900 })).status).toBe(422);
    expect((await a.patch(`/deals/${deal.id}/purchases/${purchase}`, { rate: 900, reason: 'rate corrected' })).status).toBe(200);
    expect((await a.del(`/deals/${deal.id}/purchases/${purchase}?reason=duplicate`)).status).toBe(200);
    const march = (await a.get('/finance/periods')).body.data.find((p) => p.month === '2026-03');
    expect(march.stale).toBe(true);
  });

  test('logins created by the admin get working roles; settings and masters are admin only', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const made = await a.post('/users', { name: 'New Manager', email: 'mgr@gulati.test', password: 'Password123!', access_role: 'manager' });
    expect(made.status).toBe(201);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'mgr@gulati.test', password: 'Password123!' });
    expect(login.status).toBe(200);
    const m = api(login.body.data.access_token);
    expect((await m.get('/me')).body.data.role).toBe('manager');
    expect((await m.post('/leads', { name: 'By manager', trading_type: 'trading_deals' })).status).toBe(201);
    expect((await m.get('/settings')).status).toBe(403);
    expect((await m.post('/units', { name: 'Bag' })).status).toBe(403);
    expect((await m.post('/trading-types', { label: 'Zinc' })).status).toBe(403);
    expect((await m.get('/users')).status).toBe(403);
    // admin can change the role through the roster and deactivate the login
    const person = (await a.get('/people')).body.data.find((p) => p.email === 'mgr@gulati.test');
    expect((await a.patch(`/people/${person.id}`, { access_role: 'finance' })).body.data.access_role).toBe('finance');
    expect((await m.get('/leads')).status).toBe(403);
    expect((await m.get('/finance/pnl')).status).toBe(200);
    const users = (await a.get('/users')).body.data;
    const u = users.find((x) => x.email === 'mgr@gulati.test');
    expect((await a.post(`/users/${u.id}/status`, { active: false })).status).toBe(200);
    expect(org.id).toBeTruthy();
  });

  test('trading types added by the admin work on leads and deals; a switched-off type is kept on old records', async () => {
    const { token } = await setup();
    const a = api(token);
    expect((await a.post('/trading-types', { label: 'Zinc Ingots' })).status).toBe(201);
    const lead = await a.post('/leads', { name: 'Zinc lead', trading_type: 'zinc_ingots', quantity: 5, unit: 'MT' });
    expect(lead.status).toBe(201);
    expect((await a.patch('/trading-types/zinc_ingots', { active: false })).body.data.active).toBe(false);
    expect((await a.get(`/leads/${lead.body.data.id}`)).body.data.trading_type).toBe('zinc_ingots');
    const types = (await a.get('/finance/trading-report')).body.data;
    expect(types.find((t) => t.key === 'zinc_ingots').label).toBe('Zinc Ingots');
  });
});

describe('gulati: documents, isolation and permissions', () => {
  test('documents upload, list and are role-gated by owner type', async () => {
    const { token, org } = await setup();
    const a = api(token);
    const { deal } = await dealWithLines(a);
    const up = await authed(request(app).post('/api/v1/gulati/documents'), token)
      .field('owner_type', 'deal')
      .field('owner_id', deal.id)
      .field('category', 'purchase_order')
      .field('title', 'PO from XYZ')
      .attach('file', Buffer.from('a,b\n1,2\n'), 'po.csv');
    expect(up.status).toBe(201);
    expect((await a.get(`/documents?owner_type=deal&owner_id=${deal.id}`)).body.data).toHaveLength(1);
    const staff = api((await addMember(org, 'staff')).token);
    expect((await staff.get(`/documents?owner_type=deal&owner_id=${deal.id}`)).status).toBe(403);
    expect((await a.patch(`/documents/${up.body.data.id}`, { title: 'PO from XYZ (signed)' })).body.data.title).toBe('PO from XYZ (signed)');
    expect((await a.del(`/documents/${up.body.data.id}`)).status).toBe(200);
    expect((await a.get(`/documents?owner_type=deal&owner_id=${deal.id}`)).body.data).toHaveLength(0);
  });

  test('another Gulati company cannot read or change this company records', async () => {
    const one = await setup('company-one');
    const two = await setup('company-two');
    const a = api(one.token);
    const b = api(two.token);
    const { deal, client, purchase } = await dealWithLines(a);
    expect((await b.get(`/deals/${deal.id}`)).status).toBe(404);
    expect((await b.patch(`/deals/${deal.id}`, { notes: 'x' })).status).toBe(404);
    expect((await b.post(`/deals/${deal.id}/purchases/${purchase}/payments`, { amount: 1, paid_date: D })).status).toBe(404);
    expect((await b.get(`/parties/${client}`)).status).toBe(404);
    expect((await b.get('/deals')).body.data).toHaveLength(0);
    expect((await b.get('/finance/pnl')).body.data.totals.sales_revenue).toBe(0);
    // a deal cannot be linked to another company's client
    expect((await b.post('/deals', { name: 'Cross', trading_type: 'trading_deals', party_id: client })).status).toBe(422);
  });

  test('zephyr-only and plain orgs cannot reach gulati; employees cannot change masters', async () => {
    const { org, token } = await setup();
    const emp = await addMember(org, 'manager');
    expect((await api(emp.token).post('/categories', { kind: 'expense', name: 'X' })).status).toBe(403);
    expect((await api(token).get('/me')).status).toBe(200);
    await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['zephyr'] } });
    expect((await api(token).get('/me')).status).toBe(403);
  });
});
