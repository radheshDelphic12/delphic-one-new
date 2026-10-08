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

async function addMember(org, accessRole, kind = 'employee') {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  const person = await prisma.zxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole, kind } });
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

describe('zephyr operational tasks (R8)', () => {
  test('create, list with overdue, summary, filters and audit', async () => {
    const { org, token } = await setupZephyr();
    const a = api(token);
    const worker = await prisma.zxPerson.create({ data: { org_id: org.id, name: 'Contractor X', kind: 'contractor' } });
    const property = (await a.post('/properties', { name: 'XYZ Complex' })).body.data;
    const created = await a.post('/tasks', { title: 'Collect October rent from Shop 4', task_type: 'collect_rent', person_id: worker.id, property_id: property.id, due_date: day(-2), amount: 50000, priority: 'high' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: 'ZT-0001', status: 'pending', overdue: true, amount: 50000, person: { name: 'Contractor X' }, property: { name: 'XYZ Complex' } });
    await a.post('/tasks', { title: 'Inspect plot', task_type: 'inspect', due_date: day(5) });
    expect((await a.post('/tasks', { title: 'Third' })).body.data.code).toBe('ZT-0003');

    expect((await a.get('/tasks?status=overdue')).body.data.map((t) => t.title)).toEqual(['Collect October rent from Shop 4']);
    expect((await a.get('/tasks?status=open')).body.data).toHaveLength(3);
    expect((await a.get(`/tasks?person_id=${worker.id}`)).body.data).toHaveLength(1);
    expect((await a.get(`/tasks?property_id=${property.id}`)).body.data).toHaveLength(1);
    expect((await a.get('/tasks?task_type=inspect')).body.data).toHaveLength(1);
    expect((await a.get('/tasks?q=october')).body.data).toHaveLength(1);
    expect((await a.get('/tasks/summary')).body.data).toMatchObject({ pending: 3, overdue: 1, open_amount: 50000 });
    expect((await a.patch(`/tasks/${created.body.data.id}`, { priority: 'low', due_date: day(3) })).body.data).toMatchObject({ priority: 'low', overdue: false });
    expect((await a.get('/audit?entity=task')).body.data.map((r) => r.action)).toEqual(expect.arrayContaining(['create', 'update']));
  });

  test('validation: roster person, linked records, unit needs property', async () => {
    const x = await setupZephyr('zephyr-x');
    const y = await setupZephyr('zephyr-y');
    const a = api(x.token);
    const foreign = await prisma.zxPerson.create({ data: { org_id: y.org.id, name: 'Foreign', kind: 'employee' } });
    const inactive = await prisma.zxPerson.create({ data: { org_id: x.org.id, name: 'Gone', kind: 'employee', active: false } });
    expect((await a.post('/tasks', { title: 't', person_id: foreign.id })).status).toBe(422);
    expect((await a.post('/tasks', { title: 't', person_id: inactive.id })).status).toBe(422);
    expect((await a.post('/tasks', { title: 't', project_id: '3f1d8c74-3c1b-4c0e-9a55-0b8f9a4d9f11' })).status).toBe(422);
    expect((await a.post('/tasks', { title: 't', unit_id: '3f1d8c74-3c1b-4c0e-9a55-0b8f9a4d9f11' })).status).toBe(422);
    expect((await a.post('/tasks', { title: '' })).status).toBe(422);
    expect((await a.post('/tasks', { title: 't', task_type: 'dance' })).status).toBe(422);
  });

  test('the assignee works their own tasks only; completing locks the task; an admin can reopen it', async () => {
    const { org, token } = await setupZephyr();
    const staff = await addMember(org, 'staff');
    const other = await addMember(org, 'staff');
    const a = api(token);
    const mine = (await a.post('/tasks', { title: 'Visit site', person_id: staff.person.id, task_type: 'visit_property' })).body.data;
    const notMine = (await a.post('/tasks', { title: 'Their task', person_id: other.person.id })).body.data;
    const s = api(staff.token);
    expect((await s.get('/tasks')).body.data.map((t) => t.title)).toEqual(['Visit site']);
    expect((await s.get(`/tasks/${notMine.id}`)).status).toBe(404);
    expect((await s.post(`/tasks/${notMine.id}/status`, { status: 'in_progress' })).status).toBe(404);
    expect((await s.get('/tasks/summary')).body.data.pending).toBe(1);
    expect((await s.post('/tasks', { title: 'self made' })).status).toBe(403);
    expect((await s.patch(`/tasks/${mine.id}`, { title: 'x' })).status).toBe(403);
    expect((await s.del(`/tasks/${mine.id}`)).status).toBe(403);
    expect((await s.post(`/tasks/${mine.id}/status`, { status: 'cancelled' })).status).toBe(403);
    expect((await s.post(`/tasks/${mine.id}/status`, { status: 'completed' })).status).toBe(422);
    expect((await s.post(`/tasks/${mine.id}/status`, { status: 'in_progress', notes: 'On my way' })).body.data).toMatchObject({ status: 'in_progress', notes: 'On my way' });
    expect((await s.post(`/tasks/${mine.id}/complete`, { completed_on: day(2) })).status).toBe(422);
    const done = await s.post(`/tasks/${mine.id}/complete`, { notes: 'Done, photos uploaded' });
    expect(done.body.data).toMatchObject({ status: 'completed', completed_on: day(0), overdue: false });
    expect((await s.post(`/tasks/${mine.id}/status`, { status: 'pending' })).status).toBe(409);
    expect((await a.patch(`/tasks/${mine.id}`, { title: 'late edit' })).status).toBe(409);
    expect((await s.post(`/tasks/${mine.id}/reopen`, { reason: 'x' })).status).toBe(403);
    expect((await a.post(`/tasks/${mine.id}/reopen`, {})).status).toBe(422);
    expect((await a.post(`/tasks/${mine.id}/reopen`, { reason: 'Photos were missing' })).body.data).toMatchObject({ status: 'pending', completed_on: null });
    expect((await a.get('/audit?entity=task')).body.data.map((r) => r.action)).toEqual(expect.arrayContaining(['status', 'complete', 'reopen']));
    expect((await a.del(`/tasks/${notMine.id}`)).status).toBe(200);
  });

  test('a manager runs tasks for everyone; another company sees nothing', async () => {
    const x = await setupZephyr('zephyr-x');
    const y = await setupZephyr('zephyr-y');
    const manager = await addMember(x.org, 'manager');
    const task = (await api(manager.token).post('/tasks', { title: 'By manager', person_id: manager.person.id })).body.data;
    expect((await api(manager.token).get('/tasks')).body.data).toHaveLength(1);
    expect((await api(manager.token).post(`/tasks/${task.id}/status`, { status: 'cancelled' })).body.data.status).toBe('cancelled');
    expect((await api(manager.token).del(`/tasks/${task.id}`)).status).toBe(403);
    expect((await api(y.token).get('/tasks')).body.data).toHaveLength(0);
    expect((await api(y.token).get(`/tasks/${task.id}`)).status).toBe(404);
    expect((await api(y.token).patch(`/tasks/${task.id}`, { title: 'hack' })).status).toBe(404);
    expect((await api(y.token).post(`/tasks/${task.id}/complete`, {})).status).toBe(404);
  });

  test('collecting rent: completing the task books the payment to the rent, credited to the collector', async () => {
    const { org, token } = await setupZephyr();
    const collector = await addMember(org, 'staff', 'contractor');
    const a = api(token);
    const property = (await a.post('/properties', { name: 'XYZ Complex' })).body.data;
    await a.post(`/properties/${property.id}/units`, { name: 'Shop 4' });
    const unit = (await a.get(`/properties/${property.id}`)).body.data.units[0];
    const tenant = (await a.post('/tenants', { name: 'Shop Tenant' })).body.data;
    await a.post('/leases', { tenant_id: tenant.id, unit_id: unit.id, start_date: `${day(0).slice(0, 7)}-01`, monthly_rent: 50000 });
    const due = (await a.get('/rent/dues')).body.data[0];

    const task = (await a.post('/tasks', { title: 'Collect rent from Shop 4', task_type: 'collect_rent', person_id: collector.person.id, rent_due_id: due.id })).body.data;
    expect(task).toMatchObject({ amount: 50000, property: { name: 'XYZ Complex' }, unit: { name: 'Shop 4' } });
    expect((await a.post('/tasks', { title: 'bad', rent_due_id: due.id, property_id: (await a.post('/properties', { name: 'Other' })).body.data.id })).status).toBe(422);

    const s = api(collector.token);
    expect((await s.post(`/tasks/${task.id}/complete`, { payment: { amount: 99999, paid_on: day(0), method: 'cash' } })).status).toBe(422);
    const done = await s.post(`/tasks/${task.id}/complete`, { payment: { amount: 50000, paid_on: day(0), method: 'cash', reference: 'RCPT-1' } });
    expect(done.body.data.status).toBe('completed');
    const payments = (await a.get('/rent/payments')).body.data;
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amount: 50000, method: 'cash', reference: 'RCPT-1', collected_by: { name: collector.person.name } });
    expect((await a.get('/rent/dues')).body.data[0]).toMatchObject({ status: 'paid', balance: 0 });
    // a task that is not tied to a rent due cannot record a payment
    const plain = (await a.post('/tasks', { title: 'Plain', person_id: collector.person.id })).body.data;
    expect((await s.post(`/tasks/${plain.id}/complete`, { payment: { amount: 1, paid_on: day(0), method: 'cash' } })).status).toBe(422);
  });
});
