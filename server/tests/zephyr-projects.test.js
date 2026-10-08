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
  del: (path) => authed(request(app).delete(`/api/v1/zephyr${path}`), token),
});
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function projectWithParty(a, extra = {}) {
  const party = (await a.post('/parties', { name: `Client ${Math.random()}`, kind: 'client' })).body.data;
  const res = await a.post('/projects', { service_type: 'civil_construction', name: 'Tower A', kind: 'client', party_id: party.id, contract_value: 9000000, ...extra });
  return { party, project: res.body.data, res };
}

describe('zephyr projects CRUD', () => {
  test('codes run in sequence from the project prefix and lists show party, manager and totals', async () => {
    const { token, admin } = await setupZephyr();
    const a = api(token);
    const { party, res } = await projectWithParty(a, { manager_id: admin.id, start_date: day(0), end_date: day(90) });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: 'ZX-P-001', status: 'planned', contract_value: 9000000, progress: 0 });
    const second = await a.post('/projects', { service_type: 'civil_construction', name: 'Own villas', kind: 'self', budget: 4000000 });
    expect(second.body.data.code).toBe('ZX-P-002');
    const list = (await a.get('/projects')).body.data;
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.code === 'ZX-P-001')).toMatchObject({ party: { id: party.id }, manager: { id: admin.id } });
    expect((await a.get('/projects?kind=self')).body.data).toHaveLength(1);
    expect((await a.get('/projects?q=villas')).body.data).toHaveLength(1);
    expect((await a.get('/projects?status=open')).body.data).toHaveLength(2);
    const s = (await a.get('/projects/summary')).body.data;
    expect(s).toMatchObject({ total: 2, live_count: 2, live_contract_value: 9000000, live_budget: 4000000 });
  });

  test('validates party kind, manager, dates; edits are audited', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const vendor = (await a.post('/parties', { name: 'Only Vendor', kind: 'vendor' })).body.data;
    expect((await a.post('/projects', { service_type: 'civil_construction', name: 'X', kind: 'client', party_id: vendor.id })).status).toBe(422);
    expect((await a.post('/projects', { service_type: 'civil_construction', name: 'X', kind: 'self', party_id: vendor.id })).status).toBe(201);
    const staff = await addMember(org, 'staff');
    expect((await a.post('/projects', { service_type: 'civil_construction', name: 'Y', manager_id: staff.user.id })).status).toBe(422);
    expect((await a.post('/projects', { service_type: 'civil_construction', name: 'Y', start_date: day(5), end_date: day(1) })).status).toBe(422);
    const p = (await a.post('/projects', { service_type: 'civil_construction', name: 'Edit me' })).body.data;
    const edited = await a.patch(`/projects/${p.id}`, { status: 'active', location: 'Indore', progress_pct: 40 });
    expect(edited.body.data).toMatchObject({ status: 'active', location: 'Indore', progress: 40 });
    const audit = (await a.get('/audit?entity=project')).body.data.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['create', 'update']));
  });
});

describe('zephyr lead -> project conversion', () => {
  async function wonLead(a, extra = {}) {
    const lead = (await a.post('/leads', { service_type: 'civil_construction', name: 'Won deal', estimated_value: 7000000, location: 'Pune', ...extra })).body.data;
    await a.post(`/leads/${lead.id}/stage`, { stage: 'won' });
    return lead;
  }

  test('only a won lead converts, once, copying its data; the lead then cannot be reopened', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const party = (await a.post('/parties', { name: 'Buyer', kind: 'client' })).body.data;
    const open = (await a.post('/leads', { service_type: 'civil_construction', name: 'Not yet' })).body.data;
    expect((await a.post(`/projects/from-lead/${open.id}`)).status).toBe(409);

    const lead = await wonLead(a, { party_id: party.id });
    const res = await a.post(`/projects/from-lead/${lead.id}`, { start_date: day(7) });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: 'client', name: 'Won deal', contract_value: 7000000, location: 'Pune', lead_id: lead.id, service_type: 'civil_construction' });
    expect(res.body.data.party.id).toBe(party.id);
    expect((await a.post(`/projects/from-lead/${lead.id}`)).status).toBe(409);
    expect((await a.get(`/leads/${lead.id}`)).body.data.project_id).toBe(res.body.data.id);
    expect((await a.post(`/leads/${lead.id}/reopen`, { reason: 'try' })).status).toBe(409);
  });

  test('conversion carries service, assignees, dates, profit and details; the lead stays for history', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const emp = await prisma.zxPerson.create({ data: { org_id: org.id, name: 'Lead Emp', kind: 'employee' } });
    const con = await prisma.zxPerson.create({ data: { org_id: org.id, name: 'Lead Con', kind: 'contractor' } });
    const lead = await wonLead(a, {
      service_type: 'interior_design', assignee_id: emp.id, contractor_id: con.id, expected_start: day(3), expected_end: day(60),
      expected_profit: 900000, description: 'Flat renovation', details: [{ label: 'Floor', value: '12' }],
    });
    const res = await a.post(`/projects/from-lead/${lead.id}`);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      service_type: 'interior_design', status: 'planned', contract_value: 7000000, expected_profit: 900000, expected_profit_calc: 900000,
      description: 'Flat renovation', start_date: expect.stringContaining(day(3)), end_date: expect.stringContaining(day(60)),
    });
    expect(res.body.data.assignee.name).toBe('Lead Emp');
    expect(res.body.data.contractor.name).toBe('Lead Con');
    expect(res.body.data.details).toEqual({ lead_details: [{ label: 'Floor', value: '12' }] });
    const kept = (await a.get(`/leads/${lead.id}`)).body.data;
    expect(kept).toMatchObject({ stage: 'won', project_id: res.body.data.id, code: 'ZL-0001' });
  });

  test('another org cannot convert a lead it does not own', async () => {
    const a = await setupZephyr('zephyr-a');
    const b = await setupZephyr('zephyr-b');
    const lead = (await api(a.token).post('/leads', { service_type: 'civil_construction', name: 'A deal' })).body.data;
    await api(a.token).post(`/leads/${lead.id}/stage`, { stage: 'won' });
    expect((await api(b.token).post(`/projects/from-lead/${lead.id}`)).status).toBe(404);
  });
});

describe('zephyr milestones', () => {
  test('progress is the weighted average; status follows percent; completing needs all done', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const { project } = await projectWithParty(a, { status: 'active' });
    const m1 = (await a.post(`/projects/${project.id}/milestones`, { name: 'Foundation', weight: 3, due_date: day(-3), billing_amount: 1000000 })).body.data.milestones[0];
    await a.post(`/projects/${project.id}/milestones`, { name: 'Structure', weight: 1, due_date: day(30), billing_amount: 2000000 });
    let p = (await a.patch(`/projects/${project.id}/milestones/${m1.id}`, { percent_done: 100 })).body.data;
    expect(p.progress).toBe(75);
    expect(p.milestones[0]).toMatchObject({ status: 'done', percent_done: 100 });
    expect(p.milestones[1].status).toBe('pending');
    expect(p.milestones_overdue).toBe(0);

    expect((await a.patch(`/projects/${project.id}`, { status: 'completed' })).status).toBe(422);
    p = (await a.patch(`/projects/${project.id}/milestones/${p.milestones[1].id}`, { percent_done: 40 })).body.data;
    expect(p.milestones[1].status).toBe('in_progress');
    expect(p.progress).toBe(85);
  });

  test('billing needs a done milestone, a billed milestone cannot be deleted, overdue is counted', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const { project } = await projectWithParty(a);
    const added = (await a.post(`/projects/${project.id}/milestones`, { name: 'Slab', due_date: day(-2), billing_amount: 500000 })).body.data;
    expect(added.milestones_overdue).toBe(1);
    const mid = added.milestones[0].id;
    expect((await a.patch(`/projects/${project.id}/milestones/${mid}`, { billed: true })).status).toBe(422);
    const done = (await a.patch(`/projects/${project.id}/milestones/${mid}`, { percent_done: 100, billed: true })).body.data;
    expect(done).toMatchObject({ billing_planned: 500000, billing_billed: 500000, milestones_overdue: 0 });
    expect((await a.del(`/projects/${project.id}/milestones/${mid}`)).status).toBe(409);
    expect((await a.patch(`/projects/${project.id}`, { status: 'completed' })).body.data.status).toBe('completed');
    expect((await a.post(`/projects/${project.id}/milestones`, { name: 'Late add' })).status).toBe(409);
  });

  test('manual progress applies only while there are no milestones', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const { project } = await projectWithParty(a, { progress_pct: 30 });
    expect(project.progress).toBe(30);
    const m = (await a.post(`/projects/${project.id}/milestones`, { name: 'Only one' })).body.data;
    expect(m.progress).toBe(0);
    const removed = (await a.del(`/projects/${project.id}/milestones/${m.milestones[0].id}`)).body.data;
    expect(removed.progress).toBe(30);
  });
});

describe('zephyr work orders', () => {
  test('vendor work orders: numbering, vendor rules, billing cap, cancel rule, totals', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const { project, party } = await projectWithParty(a, { status: 'active' });
    const vendor = (await a.post('/parties', { name: 'Steel Supplier', kind: 'vendor' })).body.data;
    const both = (await a.post('/parties', { name: 'Both Ltd', kind: 'both' })).body.data;
    const inactive = (await a.post('/parties', { name: 'Gone Vendor', kind: 'vendor', status: 'inactive' })).body.data;

    expect((await a.post(`/projects/${project.id}/work-orders`, { vendor_id: party.id, scope: 'x', value: 100 })).status).toBe(422);
    expect((await a.post(`/projects/${project.id}/work-orders`, { vendor_id: inactive.id, scope: 'x', value: 100 })).status).toBe(422);
    expect((await a.post(`/projects/${project.id}/work-orders`, { vendor_id: vendor.id, scope: 'x', value: 100, billed_to_date: 200 })).status).toBe(422);

    let p = (await a.post(`/projects/${project.id}/work-orders`, { vendor_id: vendor.id, scope: 'Supply rebar', value: 800000, status: 'issued' })).body.data;
    p = (await a.post(`/projects/${project.id}/work-orders`, { vendor_id: both.id, scope: 'Plastering', value: 200000 })).body.data;
    expect(p.work_orders.map((w) => w.wo_number)).toEqual(['ZX-P-001-WO1', 'ZX-P-001-WO2']);
    expect(p).toMatchObject({ wo_count: 2, wo_value: 1000000, wo_billed: 0 });

    const wo = p.work_orders[0];
    p = (await a.patch(`/projects/${project.id}/work-orders/${wo.id}`, { billed_to_date: 300000, status: 'in_progress' })).body.data;
    expect(p.wo_billed).toBe(300000);
    expect((await a.patch(`/projects/${project.id}/work-orders/${wo.id}`, { billed_to_date: 900000 })).status).toBe(422);
    expect((await a.patch(`/projects/${project.id}/work-orders/${wo.id}`, { value: 250000 })).status).toBe(422);
    expect((await a.patch(`/projects/${project.id}/work-orders/${wo.id}`, { status: 'cancelled' })).status).toBe(409);
    expect((await a.del(`/projects/${project.id}/work-orders/${wo.id}`)).status).toBe(409);

    const second = p.work_orders[1];
    p = (await a.patch(`/projects/${project.id}/work-orders/${second.id}`, { status: 'cancelled' })).body.data;
    expect(p).toMatchObject({ wo_count: 1, wo_value: 800000 });
    expect((await a.get('/projects/summary')).body.data.committed_cost).toBe(800000);
  });
});

describe('zephyr projects access and isolation', () => {
  test('manager edits but cannot delete; staff has no access; admin deletes', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const staff = await addMember(org, 'staff');
    const p = (await api(manager.token).post('/projects', { service_type: 'civil_construction', name: 'By manager', manager_id: manager.user.id })).body.data;
    expect((await api(manager.token).patch(`/projects/${p.id}`, { status: 'active' })).status).toBe(200);
    expect((await api(manager.token).del(`/projects/${p.id}`)).status).toBe(403);
    expect((await api(staff.token).get('/projects')).status).toBe(403);
    expect((await api(staff.token).post('/projects', { service_type: 'civil_construction', name: 'no' })).status).toBe(403);
    expect((await api(token).del(`/projects/${p.id}`)).status).toBe(200);
    expect((await api(token).get(`/projects/${p.id}`)).status).toBe(404);
  });

  test('another org sees and changes nothing, including children', async () => {
    const a = await setupZephyr('zephyr-a');
    const b = await setupZephyr('zephyr-b');
    const { project } = await projectWithParty(api(a.token));
    const m = (await api(a.token).post(`/projects/${project.id}/milestones`, { name: 'M' })).body.data.milestones[0];
    const bb = api(b.token);
    expect((await bb.get('/projects')).body.data).toHaveLength(0);
    expect((await bb.get(`/projects/${project.id}`)).status).toBe(404);
    expect((await bb.patch(`/projects/${project.id}`, { name: 'hack' })).status).toBe(404);
    expect((await bb.patch(`/projects/${project.id}/milestones/${m.id}`, { percent_done: 100 })).status).toBe(404);
    expect((await bb.post(`/projects/${project.id}/milestones`, { name: 'x' })).status).toBe(404);
    expect((await bb.del(`/projects/${project.id}`)).status).toBe(404);
    expect((await bb.get('/projects/summary')).body.data.total).toBe(0);
  });

  test('project documents upload and download for a manager, not for staff', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const staff = await addMember(org, 'staff');
    const { project } = await projectWithParty(api(token));
    const up = await authed(request(app).post('/api/v1/zephyr/documents'), token)
      .field('owner_type', 'project').field('owner_id', project.id).field('title', 'Site plan')
      .attach('file', Buffer.from('%PDF-1.4 x'), 'plan.pdf');
    expect(up.status).toBe(201);
    expect((await authed(request(app).get(up.body.data.file_url), manager.token)).status).toBe(200);
    expect((await authed(request(app).get(up.body.data.file_url), staff.token)).status).toBe(403);
    expect((await api(staff.token).get(`/documents?owner_type=project&owner_id=${project.id}`)).status).toBe(403);
  });
});
