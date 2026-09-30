// Projects and client companies share the accounts table (type 'client');
// Account.is_project keeps them apart. The Accounts catalogue never lists,
// edits or deletes a project; Finance only edits projects — a catalogue client
// account shown in Finance is read-only there. Plus: assets can belong to a vendor.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  await prisma.user.update({ where: { id: admin.id }, data: { is_superadmin: true } });
  const token = (await loginAs(admin)).access_token;
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Default', is_default: true } });
  const client = await prisma.account.create({ data: { type: 'client', name: unique('Acme '), stage: 'active', owner_id: admin.id, org_id: org.id, industry: 'IT', poc_name: 'Asha' } });
  return { org, admin, token, client };
}

const addProject = (ctx, name) => authed(request(app).post('/api/v1/calendars/projects'), ctx.token).send({ name, service_category: 'managed_services', client_account_id: ctx.client.id });

describe('Add Project never creates a catalogue client account', () => {
  test('the project is flagged, hidden from Accounts, and cannot be edited or deleted there', async () => {
    const ctx = await seed();
    const created = await addProject(ctx, 'Devops');
    expect(created.status).toBe(201);
    const row = await prisma.account.findUnique({ where: { id: created.body.data.id } });
    expect(row.is_project).toBe(true);

    const list = await authed(request(app).get('/api/v1/accounts'), ctx.token).query({ type: 'client', limit: 100 });
    expect(list.status).toBe(200);
    const ids = list.body.data.map((a) => a.id);
    expect(ids).toContain(ctx.client.id);
    expect(ids).not.toContain(row.id);

    expect((await authed(request(app).patch(`/api/v1/accounts/${row.id}`), ctx.token).send({ industry: 'Retail' })).status).toBe(409);
    const del = await authed(request(app).post(`/api/v1/admin/account/${row.id}/delete`), ctx.token).send({ password: 'Password123!', reason: 'cleanup' });
    expect(del.status).toBe(409);
    expect(await prisma.account.findFirst({ where: { id: row.id, deleted_at: null } })).not.toBeNull();

    // The real client account is still editable in Accounts.
    expect((await authed(request(app).patch(`/api/v1/accounts/${ctx.client.id}`), ctx.token).send({ industry: 'Retail' })).status).toBe(200);

    // The project's client picker never offers a project.
    const options = await authed(request(app).get('/api/v1/calendars/projects/client-options'), ctx.token);
    expect(options.status).toBe(200);
    expect(options.body.data.map((o) => o.id)).toContain(ctx.client.id);
    expect(options.body.data.map((o) => o.id)).not.toContain(row.id);
  });
});

describe('Finance only edits projects, never the Accounts catalogue', () => {
  test('a plain catalogue client is not listed in Finance and is read-only there; a project is editable', async () => {
    const ctx = await seed();
    const project = (await addProject(ctx, 'Caylent')).body.data;

    // Creating/activating a client must not make it show up as a project.
    const profiles = (await authed(request(app).get('/api/v1/billing/projects'), ctx.token)).body.data;
    expect(profiles.find((p) => p.id === ctx.client.id)).toBeUndefined();
    expect(profiles.find((p) => p.id === project.id)).toMatchObject({ editable: true, is_project: true });

    const blocked = await authed(request(app).patch(`/api/v1/billing/projects/${ctx.client.id}`), ctx.token).send({ agreement_start_date: '2026-01-01' });
    expect(blocked.status).toBe(409);
    const untouched = await prisma.account.findUnique({ where: { id: ctx.client.id } });
    expect(untouched.agreement_start_date).toBeNull();

    const ok = await authed(request(app).patch(`/api/v1/billing/projects/${project.id}`), ctx.token).send({ agreement_start_date: '2026-01-01', billing: { rate_type: 'monthly', rate: 100000, currency: 'INR' } });
    expect(ok.status).toBe(200);
  });

  test('an older client row already billed as a project (predates is_project) is editable, and its account name is kept', async () => {
    const ctx = await seed();
    const girnar = await prisma.account.create({ data: { type: 'client', name: unique('Girnarsoft '), stage: 'active', owner_id: ctx.admin.id, org_id: ctx.org.id } });
    const legacy = await prisma.account.create({ data: { type: 'client', name: 'Circle', stage: 'active', owner_id: ctx.admin.id, org_id: ctx.org.id, industry: 'IT', service_category: 'managed_services', client_account_id: girnar.id } });
    await prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: legacy.id, rate_type: 'monthly', rate: 190000, currency: 'INR', effective_from: new Date('2026-09-01'), created_by: ctx.admin.id } });

    const profiles = (await authed(request(app).get('/api/v1/billing/projects'), ctx.token)).body.data;
    expect(profiles.find((p) => p.id === legacy.id)).toMatchObject({ editable: true, is_project: false });
    const one = await authed(request(app).get(`/api/v1/billing/projects/${legacy.id}`), ctx.token);
    expect(one.status).toBe(200);
    expect(one.body.data.editable).toBe(true);

    const res = await authed(request(app).patch(`/api/v1/billing/projects/${legacy.id}`), ctx.token).send({ project_name: 'Circle Phase 2', agreement_end_date: '2026-12-31' });
    expect(res.status).toBe(200);
    const after = await prisma.account.findUnique({ where: { id: legacy.id } });
    expect(after.name).toBe('Circle');
    expect(after.project_name).toBe('Circle Phase 2');
  });
});

describe('Assets can belong to a vendor', () => {
  test('Belongs to = vendor requires the vendor name', async () => {
    const ctx = await seed();
    const vendor = await prisma.account.create({ data: { type: 'vendor', name: unique('Rentals '), stage: 'active', owner_id: ctx.admin.id, org_id: ctx.org.id } });
    const post = (body) => authed(request(app).post('/api/v1/assets'), ctx.token).send({ asset_type: 'Windows Laptop', ...body });
    expect((await post({ belongs_to: 'vendor' })).status).toBe(422);
    const created = await post({ belongs_to: 'vendor', vendor_account_id: vendor.id });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ belongs_to: 'vendor', vendor_account_id: vendor.id });
    // Clearing the vendor while it still belongs to a vendor is refused.
    expect((await authed(request(app).patch(`/api/v1/assets/${created.body.data.id}`), ctx.token).send({ vendor_account_id: null })).status).toBe(422);
    expect((await authed(request(app).patch(`/api/v1/assets/${created.body.data.id}`), ctx.token).send({ belongs_to: 'delphic', vendor_account_id: null })).status).toBe(200);
  });
});
