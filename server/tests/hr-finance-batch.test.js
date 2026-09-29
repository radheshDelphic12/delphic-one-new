// Non-IT timesheets for admins, the department-gated meetings calendar,
// employee bank / emergency details + documents, project contract tracking,
// and the org-chart team fields.
const fs = require('fs');
const path = require('path');
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
  const adminMembership = await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const token = (await loginAs(admin)).access_token;
  return { org, admin, adminMembership, token };
}

async function employee(ctx, name, departmentId = null) {
  const user = await createUser({ role: 'employee', name });
  if (departmentId) await prisma.user.update({ where: { id: user.id }, data: { department_id: departmentId } });
  const membership = await createOrgMembership(user.id, ctx.org.id, { role: 'employee' });
  const token = (await loginAs(user)).access_token;
  return { user, membership, token };
}

describe('Admin — Non-IT timesheets', () => {
  test('exclude_department_id lists everyone outside IT (people with no department included) in both the overview and the entries', async () => {
    const ctx = await seed();
    const it = await prisma.department.create({ data: { name: 'IT', org_id: ctx.org.id } });
    const hr = await prisma.department.create({ data: { name: 'HR', org_id: ctx.org.id } });
    const dev = await employee(ctx, 'Dev In IT', it.id);
    const recruiter = await employee(ctx, 'Hina In HR', hr.id);
    const floater = await employee(ctx, 'No Department');
    for (const m of [dev, recruiter, floater]) {
      await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: m.membership.id, date: new Date('2026-09-10'), hours: 8, billable: false, status: 'submitted' } });
    }

    const overview = await authed(request(app).get(`/api/v1/timesheets/overview?exclude_department_id=${it.id}&month=9&year=2026`), ctx.token);
    expect(overview.status).toBe(200);
    const names = overview.body.data.members.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(['Hina In HR', 'No Department']));
    expect(names).not.toContain('Dev In IT');

    const entries = await authed(request(app).get(`/api/v1/timesheets/entries?exclude_department_id=${it.id}&from=2026-09-01&to=2026-09-30`), ctx.token);
    expect(entries.body.data.map((e) => e.org_membership.person.name).sort()).toEqual(['Hina In HR', 'No Department']);

    const itOnly = await authed(request(app).get(`/api/v1/timesheets/entries?department_id=${it.id}&from=2026-09-01&to=2026-09-30`), ctx.token);
    expect(itOnly.body.data.map((e) => e.org_membership.person.name)).toEqual(['Dev In IT']);
  });
});

describe('Meetings calendar — Sales, HR and Management only', () => {
  test('the calendar feed answers 403 outside those departments; admins always pass', async () => {
    const org = await prisma.org.findUnique({ where: { slug: 'test-org' } }) || await createOrg({ name: 'Test Org', slug: 'test-org' });
    const depts = {};
    for (const name of ['IT', 'Sales', 'HR', 'Management']) depts[name] = await prisma.department.create({ data: { name, org_id: org.id } });
    const url = '/api/v1/interviews?from=2026-09-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z';
    const asDept = async (role, dept) => {
      const user = await createUser({ role });
      if (dept) await prisma.user.update({ where: { id: user.id }, data: { department_id: depts[dept].id } });
      return (await authed(request(app).get(url), (await loginAs(user)).access_token)).status;
    };
    expect(await asDept('recruiter', 'IT')).toBe(403);
    expect(await asDept('employee', null)).toBe(403);
    expect(await asDept('sales', 'Sales')).toBe(200);
    expect(await asDept('recruiter', 'HR')).toBe(200);
    expect(await asDept('employee', 'Management')).toBe(200);
    expect(await asDept('admin', 'IT')).toBe(200);
  });
});

describe('Employee bank + emergency details', () => {
  test('the employee updates their own from the portal; an admin can too; nobody else sees them, and the open membership read never carries them', async () => {
    const ctx = await seed();
    const me = await employee(ctx, 'Asha Employee');
    const colleague = await employee(ctx, 'Nosy Colleague');

    const empty = await authed(request(app).get('/api/v1/orgs/me/details'), me.token);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toMatchObject({ id: me.membership.id, bank_account_number: null, emergency_contact_name: null });

    const saved = await authed(request(app).put('/api/v1/orgs/me/details'), me.token).send({
      bank_account_holder: 'Asha Employee',
      bank_name: 'HDFC Bank',
      bank_account_number: '50100123456789',
      bank_ifsc: 'hdfc0001234',
      emergency_contact_name: 'Ravi',
      emergency_contact_relation: 'Brother',
      emergency_contact_phone: '+91 98765 43210',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ bank_ifsc: 'HDFC0001234', emergency_contact_phone: '+91 98765 43210' });
    expect(saved.body.data.personal_details_updated_at).toBeTruthy();

    expect((await authed(request(app).put('/api/v1/orgs/me/details'), me.token).send({ bank_ifsc: 'bad code!' })).status).toBe(422);
    expect((await authed(request(app).put('/api/v1/orgs/me/details'), me.token).send({ emergency_contact_email: 'nope' })).status).toBe(422);

    // A blank clears one field and leaves the rest alone.
    const cleared = await authed(request(app).put('/api/v1/orgs/me/details'), me.token).send({ bank_branch: '', emergency_contact_relation: '' });
    expect(cleared.body.data).toMatchObject({ emergency_contact_relation: null, bank_name: 'HDFC Bank' });

    const detailsUrl = `/api/v1/orgs/memberships/${me.membership.id}/details`;
    expect((await authed(request(app).get(detailsUrl), colleague.token)).status).toBe(403);
    expect((await authed(request(app).put(detailsUrl), colleague.token).send({ bank_name: 'Hacked' })).status).toBe(403);
    expect((await authed(request(app).get(detailsUrl), me.token)).status).toBe(200);
    const byAdmin = await authed(request(app).put(detailsUrl), ctx.token).send({ bank_branch: 'Indore' });
    expect(byAdmin.body.data).toMatchObject({ bank_branch: 'Indore', bank_account_number: '50100123456789' });

    const openRead = await authed(request(app).get(`/api/v1/orgs/memberships/${me.membership.id}`), colleague.token);
    expect(openRead.status).toBe(200);
    expect(openRead.body.data).not.toHaveProperty('bank_account_number');
    expect(openRead.body.data).not.toHaveProperty('emergency_contact_phone');
  });

  test('employee documents: the employee and admins upload and read them; a colleague cannot', async () => {
    const ctx = await seed();
    const me = await employee(ctx, 'Asha Employee');
    const colleague = await employee(ctx, 'Nosy Colleague');
    const tmp = path.join(__dirname, 'tmp-employee-doc.pdf');
    fs.writeFileSync(tmp, 'x');
    const upload = (token, label) => authed(request(app).post('/api/v1/documents'), token)
      .field('entity_type', 'org_membership')
      .field('entity_id', me.membership.id)
      .field('label', label)
      .attach('file', tmp, 'doc.pdf');
    try {
      expect((await upload(me.token, 'PAN card')).status).toBe(201);
      expect((await upload(ctx.token, 'Offer letter')).status).toBe(201);
      expect((await upload(colleague.token, 'Sneaky')).status).toBe(404);

      const list = (token) => authed(request(app).get(`/api/v1/documents?entity_type=org_membership&entity_id=${me.membership.id}`), token);
      expect((await list(me.token)).body.data.map((d) => d.label).sort()).toEqual(['Offer letter', 'PAN card']);
      expect((await list(ctx.token)).body.data).toHaveLength(2);
      expect((await list(colleague.token)).status).toBe(404);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});

describe('Finance → Projects — contract tracking', () => {
  const day = (offset) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  test('not started / running / about to end / completed follow the dates; on hold and completed can be set by hand', async () => {
    const ctx = await seed();
    const make = async (name) => prisma.account.create({ data: { org_id: ctx.org.id, name, type: 'client', stage: 'active', service_category: 'project', owner_id: ctx.admin.id } });
    const patch = (id, body) => authed(request(app).patch(`/api/v1/billing/projects/${id}`), ctx.token).send(body);
    const state = async (id) => (await authed(request(app).get(`/api/v1/billing/projects/${id}`), ctx.token)).body.data.contract;

    const p = await make('Tankpros');
    expect(await state(p.id)).toMatchObject({ state: 'not_started' });
    await patch(p.id, { agreement_start_date: day(10) });
    expect(await state(p.id)).toMatchObject({ state: 'not_started' });
    await patch(p.id, { agreement_start_date: day(-100), agreement_end_date: day(200) });
    expect(await state(p.id)).toMatchObject({ state: 'running', days_left: 200 });
    await patch(p.id, { agreement_end_date: day(12) });
    expect(await state(p.id)).toMatchObject({ state: 'about_to_end', days_left: 12 });
    await patch(p.id, { agreement_end_date: day(-1) });
    expect(await state(p.id)).toMatchObject({ state: 'completed' });

    await patch(p.id, { agreement_end_date: null, contract_status: 'on_hold' });
    const held = (await authed(request(app).get(`/api/v1/billing/projects/${p.id}`), ctx.token)).body.data;
    expect(held).toMatchObject({ contract_status: 'on_hold', agreement_end_date: null, contract: { state: 'on_hold' } });
    await patch(p.id, { contract_status: null });
    expect(await state(p.id)).toMatchObject({ state: 'running', days_left: null });

    const bad = await patch(p.id, { agreement_end_date: day(-200) });
    expect(bad.status).toBe(422);
    expect((await patch(p.id, { contract_status: 'cancelled' })).status).toBe(422);

    const list = await authed(request(app).get('/api/v1/billing/projects'), ctx.token);
    expect(list.body.data.find((r) => r.id === p.id).contract.state).toBe('running');
  });
});

describe('Org chart — team reports-to, open positions and order', () => {
  test('teams store and return them, sorted by order, and the chart carries them', async () => {
    const ctx = await seed();
    const vipul = await employee(ctx, 'Vipul Sharma');
    const create = (body) => authed(request(app).post('/api/v1/teams'), ctx.token).send(body);
    const apex = await create({ name: 'Apex Predators', manager_membership_id: vipul.membership.id, open_positions: 2, sort_order: 2 });
    expect(apex.status).toBe(201);
    expect(apex.body.data).toMatchObject({ open_positions: 2, sort_order: 2, manager: { person: { name: 'Vipul Sharma' } } });
    await create({ name: 'Framework Forge', sort_order: 1 });
    await create({ name: 'Growth Force' });

    const other = await seed();
    expect((await create({ name: 'Bad', manager_membership_id: (await employee(other, 'Elsewhere')).membership.id })).status).toBe(404);

    const edited = await authed(request(app).patch(`/api/v1/teams/${apex.body.data.id}`), ctx.token).send({ open_positions: 1 });
    expect(edited.body.data.open_positions).toBe(1);

    const teams = await authed(request(app).get('/api/v1/teams'), ctx.token);
    expect(teams.body.data.map((t) => t.name)).toEqual(['Growth Force', 'Framework Forge', 'Apex Predators']);

    const chart = await authed(request(app).get('/api/v1/org-chart'), ctx.token);
    expect(chart.body.data.teams.find((t) => t.name === 'Apex Predators')).toMatchObject({ manager_membership_id: vipul.membership.id, open_positions: 1, sort_order: 2 });
  });
});

describe('Project P&L — vendor invoice file', () => {
  test('an invoice file uploads (the document type used to be missing and answered 500)', async () => {
    const ctx = await seed();
    const project = await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Tankpros', type: 'client', stage: 'active', owner_id: ctx.admin.id } });
    const vendor = await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Amarial Solution', type: 'vendor', stage: 'active', owner_id: ctx.admin.id } });
    const invoice = await authed(request(app).post(`/api/v1/billing/projects/${project.id}/vendor-invoices`), ctx.token).send({ vendor_account_id: vendor.id, period_month: 9, period_year: 2026, amount: 45000 });
    expect(invoice.status).toBe(201);
    const tmp = path.join(__dirname, 'tmp-vendor-invoice.pdf');
    fs.writeFileSync(tmp, 'x');
    try {
      const res = await authed(request(app).post('/api/v1/documents'), ctx.token)
        .field('entity_type', 'project_vendor_invoice')
        .field('entity_id', invoice.body.data.id)
        .field('label', 'INV-001')
        .attach('file', tmp, 'inv.pdf');
      expect(res.status).toBe(201);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});
