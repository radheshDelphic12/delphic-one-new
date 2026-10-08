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

async function addMember(org, accessRole, extra = {}) {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  const person = await prisma.zxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole, ...extra } });
  const { access_token } = await loginAs(user);
  return { user, person, token: access_token };
}

const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/zephyr${path}`), token).send(body || {}),
  get: (path) => authed(request(app).get(`/api/v1/zephyr${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/zephyr${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/zephyr${path}`), token),
});
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

async function makeProject(a, name = 'Tower A', extra = {}) {
  return (await a.post('/projects', { service_type: 'civil_construction', name, kind: 'client', ...extra })).body.data;
}
async function makePerson(a, body) {
  return (await a.post('/people', body)).body.data;
}

describe('zephyr roster', () => {
  test('admin sees pay, manager does not; manager cannot set access or pay', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const a = api(token);
    const p = await makePerson(a, { name: 'Ravi Kumar', kind: 'employee', designation: 'Site engineer', pay_basis: 'monthly', rate: 45000, joining_date: day(-100) });
    expect(p).toMatchObject({ pay_basis: 'monthly', rate: 45000, designation: 'Site engineer' });

    const asManager = (await api(manager.token).get('/people')).body.data.find((x) => x.id === p.id);
    expect(asManager.rate).toBeUndefined();
    expect(asManager.pay_basis).toBeUndefined();
    expect((await api(manager.token).get(`/people/${p.id}`)).body.data.rate).toBeUndefined();
    expect((await api(manager.token).get(`/people/${p.id}`)).body.data.salaries).toBeUndefined();

    expect((await api(manager.token).patch(`/people/${p.id}`, { rate: 90000 })).status).toBe(403);
    expect((await api(manager.token).patch(`/people/${p.id}`, { access_role: 'manager' })).status).toBe(403);
    expect((await api(manager.token).patch(`/people/${p.id}`, { designation: 'Senior engineer' })).body.data.designation).toBe('Senior engineer');
    expect((await api(manager.token).post('/people', { name: 'Helper', kind: 'contractor' })).status).toBe(201);
    expect((await api(manager.token).del(`/people/${p.id}`)).status).toBe(403);
  });

  test('validates pay, dates and contractor firm; filters the roster', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    expect((await a.post('/people', { name: 'X', pay_basis: 'monthly' })).status).toBe(422);
    expect((await a.post('/people', { name: 'X', rate: 100 })).status).toBe(422);
    expect((await a.post('/people', { name: 'X', joining_date: day(0), leaving_date: day(-5) })).status).toBe(422);
    const client = (await a.post('/parties', { name: 'A Client', kind: 'client' })).body.data;
    const vendor = (await a.post('/parties', { name: 'Patel Constructions', kind: 'vendor' })).body.data;
    expect((await a.post('/people', { name: 'C', kind: 'contractor', vendor_party_id: client.id })).status).toBe(422);
    expect((await a.post('/people', { name: 'E', kind: 'employee', vendor_party_id: vendor.id })).status).toBe(422);
    const c = (await a.post('/people', { name: 'Mason Ali', kind: 'contractor', vendor_party_id: vendor.id, pay_basis: 'daily', rate: 900 })).body.data;
    expect(c.vendor_party.name).toBe('Patel Constructions');
    await makePerson(a, { name: 'Active Emp', kind: 'employee' });
    await makePerson(a, { name: 'Gone Emp', kind: 'employee', active: false });
    expect((await a.get('/people?kind=contractor')).body.data).toHaveLength(1);
    expect((await a.get('/people?status=active')).body.data.map((x) => x.name).sort()).toEqual(['Active Emp', 'Mason Ali']);
    expect((await a.get('/people?q=gone')).body.data).toHaveLength(1);
  });
});

describe('zephyr assignments', () => {
  test('assign to a project, no double open assignment, 100% cap, dates, closed project', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const p1 = await makeProject(a, 'One');
    const p2 = await makeProject(a, 'Two');
    const p3 = await makeProject(a, 'Three');
    const person = await makePerson(a, { name: 'Site Lead' });

    expect((await a.post(`/people/${person.id}/assignments`, { project_id: p1.id, role: 'Supervisor', allocation_pct: 60 })).status).toBe(200);
    expect((await a.post(`/people/${person.id}/assignments`, { project_id: p1.id, allocation_pct: 10 })).status).toBe(409);
    expect((await a.post(`/people/${person.id}/assignments`, { project_id: p2.id, allocation_pct: 50 })).status).toBe(422);
    expect((await a.post(`/people/${person.id}/assignments`, { project_id: p2.id, allocation_pct: 40, from_date: day(5), to_date: day(1) })).status).toBe(422);
    expect((await a.post(`/people/${person.id}/assignments`, { project_id: p2.id, allocation_pct: 40 })).status).toBe(200);

    const detail = (await a.get(`/people/${person.id}`)).body.data;
    expect(detail.assignments).toHaveLength(2);
    expect((await a.get('/people')).body.data.find((x) => x.id === person.id).assignment_count).toBe(2);

    // lowering one frees room; a dated assignment after the open ones still counts as overlapping
    const first = detail.assignments.find((x) => x.project_id === p1.id);
    expect((await a.patch(`/people/${person.id}/assignments/${first.id}`, { allocation_pct: 30 })).status).toBe(200);
    expect((await a.post(`/people/${person.id}/assignments`, { project_id: p3.id, allocation_pct: 30 })).status).toBe(200);
    expect((await a.patch(`/people/${person.id}/assignments/${first.id}`, { allocation_pct: 90 })).status).toBe(422);

    const team = (await a.get(`/projects/${p1.id}`)).body.data.team;
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ role: 'Supervisor', allocation_pct: 30, person: { name: 'Site Lead' } });

    expect((await a.del(`/people/${person.id}/assignments/${first.id}`)).status).toBe(200);
    expect((await a.get(`/projects/${p1.id}`)).body.data.team).toHaveLength(0);
    await a.patch(`/projects/${p2.id}`, { status: 'cancelled' });
    const other = await makePerson(a, { name: 'Other' });
    expect((await a.post(`/people/${other.id}/assignments`, { project_id: p2.id })).status).toBe(409);
  });
});

describe('zephyr salaries', () => {
  test('generate drafts from fixed rates, skip unpaid people, and do not duplicate', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const monthly = await makePerson(a, { name: 'Monthly Mia', pay_basis: 'monthly', rate: 50000, joining_date: day(-400) });
    const daily = await makePerson(a, { name: 'Daily Dan', kind: 'contractor', pay_basis: 'daily', rate: 1000, joining_date: day(-400) });
    await makePerson(a, { name: 'No Pay' });
    await makePerson(a, { name: 'Future Joiner', pay_basis: 'monthly', rate: 10, joining_date: day(400) });
    await makePerson(a, { name: 'Left Long Ago', pay_basis: 'monthly', rate: 10, joining_date: day(-900), leaving_date: day(-800), active: false });

    const m = thisMonth();
    expect((await a.post('/salaries/generate', { month: 'bad' })).status).toBe(422);
    expect((await a.post('/salaries/generate', { month: m })).body.data).toMatchObject({ created: 2 });
    expect((await a.post('/salaries/generate', { month: m })).body.data).toMatchObject({ created: 0 });
    const list = (await a.get(`/salaries?month=${m}`)).body.data;
    expect(list.records).toHaveLength(2);
    const rm = list.records.find((r) => r.person.id === monthly.id);
    const rd = list.records.find((r) => r.person.id === daily.id);
    expect(rm).toMatchObject({ gross: 50000, net: 50000, status: 'draft', pay_basis: 'monthly' });
    expect(rd).toMatchObject({ gross: 0, days: 0, pay_basis: 'daily' });
    expect(list.totals).toMatchObject({ gross: 50000, draft: 2 });
  });

  test('daily slips compute from days; deductions are capped; approve/pay/unapprove rules', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    await makePerson(a, { name: 'Daily Dan', kind: 'contractor', pay_basis: 'daily', rate: 1000, joining_date: day(-400) });
    const m = thisMonth();
    await a.post('/salaries/generate', { month: m });
    const rec = (await a.get(`/salaries?month=${m}`)).body.data.records[0];

    expect((await a.post(`/salaries/${rec.id}/approve`)).status).toBe(422);
    expect((await a.patch(`/salaries/${rec.id}`, { days: 40 })).status).toBe(422);
    const upd = (await a.patch(`/salaries/${rec.id}`, { days: 22, deductions: 2000, notes: 'advance recovered' })).body.data;
    expect(upd).toMatchObject({ days: 22, gross: 22000, deductions: 2000, net: 20000, notes: 'advance recovered' });
    expect((await a.patch(`/salaries/${rec.id}`, { deductions: 99999 })).status).toBe(422);

    expect((await a.post(`/salaries/${rec.id}/approve`)).body.data.status).toBe('approved');
    expect((await a.patch(`/salaries/${rec.id}`, { days: 20 })).status).toBe(409);
    expect((await a.del(`/salaries/${rec.id}`)).status).toBe(409);
    expect((await a.post(`/salaries/${rec.id}/pay`, { paid_on: day(3) })).status).toBe(422);

    expect((await a.post(`/salaries/${rec.id}/unapprove`, {})).status).toBe(422);
    expect((await a.post(`/salaries/${rec.id}/unapprove`, { reason: 'wrong days' })).body.data.status).toBe('draft');
    await a.post(`/salaries/${rec.id}/approve`);
    const paid = (await a.post(`/salaries/${rec.id}/pay`, { paid_on: day(-1) })).body.data;
    expect(paid).toMatchObject({ status: 'paid' });
    // a paid slip is locked for ordinary work but an admin can reopen it, with a reason
    expect((await a.post(`/salaries/${rec.id}/unapprove`, {})).status).toBe(422);
    const reopened = (await a.post(`/salaries/${rec.id}/unapprove`, { reason: 'paid to the wrong account' })).body.data;
    expect(reopened).toMatchObject({ status: 'draft', paid_on: null });
    const audit = (await a.get('/audit?entity=salary')).body.data.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['generate', 'update', 'approve', 'unapprove', 'pay']));
  });

  test('a monthly slip rejects days; delete works on drafts; project split defaults from assignments and can be edited', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const p1 = await makeProject(a, 'One');
    const p2 = await makeProject(a, 'Two');
    const person = await makePerson(a, { name: 'Split Sam', pay_basis: 'monthly', rate: 50000, joining_date: day(-400) });
    await a.post(`/people/${person.id}/assignments`, { project_id: p1.id, allocation_pct: 60 });
    await a.post(`/people/${person.id}/assignments`, { project_id: p2.id, allocation_pct: 40 });
    const m = thisMonth();
    await a.post('/salaries/generate', { month: m });
    const rec = (await a.get(`/salaries?month=${m}`)).body.data.records[0];
    expect(rec.project_split).toEqual(expect.arrayContaining([{ project_id: p1.id, pct: 60, amount: 30000 }, { project_id: p2.id, pct: 40, amount: 20000 }]));
    expect((await a.patch(`/salaries/${rec.id}`, { days: 5 })).status).toBe(422);

    const withDeduction = (await a.patch(`/salaries/${rec.id}`, { deductions: 5000 })).body.data;
    expect(withDeduction.net).toBe(45000);
    expect(withDeduction.project_split.find((s) => s.project_id === p1.id).amount).toBe(27000);

    expect((await a.patch(`/salaries/${rec.id}`, { project_split: [{ project_id: p1.id, pct: 70 }] })).status).toBe(422);
    expect((await a.patch(`/salaries/${rec.id}`, { project_split: [{ project_id: p1.id, pct: 50 }, { project_id: p1.id, pct: 50 }] })).status).toBe(422);
    const edited = (await a.patch(`/salaries/${rec.id}`, { project_split: [{ project_id: p2.id, pct: 100 }] })).body.data;
    expect(edited.project_split).toEqual([{ project_id: p2.id, pct: 100, amount: 45000 }]);

    expect((await a.del(`/salaries/${rec.id}`)).status).toBe(200);
    expect((await a.get(`/salaries?month=${m}`)).body.data.records).toHaveLength(0);
  });

  test('only admins touch salaries', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const staff = await addMember(org, 'staff');
    await makePerson(api(token), { name: 'P', pay_basis: 'monthly', rate: 1, joining_date: day(-9) });
    await api(token).post('/salaries/generate', { month: thisMonth() });
    for (const who of [manager, staff]) {
      expect((await api(who.token).get(`/salaries?month=${thisMonth()}`)).status).toBe(403);
      expect((await api(who.token).post('/salaries/generate', { month: thisMonth() })).status).toBe(403);
    }
  });
});

describe('zephyr my work', () => {
  test('staff see their assignments with milestones and only approved or paid slips', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const staff = await addMember(org, 'staff', { pay_basis: 'monthly', rate: 30000, joining_date: new Date(`${day(-400)}T00:00:00Z`), designation: 'Foreman' });
    const other = await addMember(org, 'staff', { pay_basis: 'monthly', rate: 99999, joining_date: new Date(`${day(-400)}T00:00:00Z`) });
    const proj = await makeProject(a, 'Visible', { status: 'active', location: 'Pune' });
    const hidden = await makeProject(a, 'Not mine');
    await a.post(`/projects/${proj.id}/milestones`, { name: 'Excavation', weight: 1, percent_done: 50 });
    await a.post(`/people/${staff.person.id}/assignments`, { project_id: proj.id, role: 'Foreman' });
    await a.post(`/people/${other.person.id}/assignments`, { project_id: hidden.id });

    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    for (const month of [prev, thisMonth()]) await a.post('/salaries/generate', { month });
    const slips = (await a.get(`/salaries?month=${prev}`)).body.data.records;
    const mine = slips.find((r) => r.person.id === staff.person.id);
    await a.post(`/salaries/${mine.id}/approve`);

    const res = (await api(staff.token).get('/my-work')).body.data;
    expect(res.person).toMatchObject({ id: staff.person.id, designation: 'Foreman' });
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0]).toMatchObject({ role: 'Foreman', project: { name: 'Visible', progress: 50 } });
    expect(res.assignments[0].milestones[0]).toMatchObject({ name: 'Excavation', percent_done: 50 });
    expect(res.salaries).toHaveLength(1);
    expect(res.salaries[0]).toMatchObject({ month: prev, net: 30000, status: 'approved' });
    expect(JSON.stringify(res)).not.toMatch(/99999|Not mine/);

    expect((await api(staff.token).get('/people')).status).toBe(403);
    expect((await api(staff.token).get('/projects')).status).toBe(403);
    const adminView = (await a.get('/my-work')).body.data;
    expect(adminView).toMatchObject({ person: null, assignments: [], salaries: [] });
  });
});

describe('zephyr people isolation', () => {
  test('another org sees and changes none of it', async () => {
    const a = await setupZephyr('zephyr-a');
    const b = await setupZephyr('zephyr-b');
    const aa = api(a.token);
    const project = await makeProject(aa, 'A project');
    const person = await makePerson(aa, { name: 'A person', pay_basis: 'monthly', rate: 100, joining_date: day(-9) });
    await aa.post(`/people/${person.id}/assignments`, { project_id: project.id });
    await aa.post('/salaries/generate', { month: thisMonth() });
    const rec = (await aa.get(`/salaries?month=${thisMonth()}`)).body.data.records[0];

    const bb = api(b.token);
    expect((await bb.get('/people')).body.data).toHaveLength(0);
    expect((await bb.get(`/people/${person.id}`)).status).toBe(404);
    expect((await bb.patch(`/people/${person.id}`, { name: 'x' })).status).toBe(404);
    expect((await bb.post(`/people/${person.id}/assignments`, { project_id: project.id })).status).toBe(404);
    expect((await bb.get(`/salaries?month=${thisMonth()}`)).body.data.records).toHaveLength(0);
    expect((await bb.post(`/salaries/${rec.id}/approve`)).status).toBe(404);
    expect((await bb.patch(`/salaries/${rec.id}`, { deductions: 1 })).status).toBe(404);
    const bPerson = await makePerson(bb, { name: 'B person' });
    expect((await bb.post(`/people/${bPerson.id}/assignments`, { project_id: project.id })).status).toBe(404);
  });
});
