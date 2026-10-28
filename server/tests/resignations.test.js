// Resignation requests: employee submits, the reporting manager records the retention call, HR approves (or rejects),
// and starting the F&F is a separate HR action. The employee never changes employment_status directly.
const { prisma, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, app, request, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const api = (token) => ({
  get: (url) => request(app).get(`/api/v1/resignations${url}`).set('Authorization', `Bearer ${token}`),
  post: (url, body) => request(app).post(`/api/v1/resignations${url}`).set('Authorization', `Bearer ${token}`).send(body || {}),
  put: (url, body) => request(app).put(`/api/v1/resignations${url}`).set('Authorization', `Bearer ${token}`).send(body || {}),
});

async function setup() {
  const org = await createOrg({ name: 'Delphic', slug: unique('d-') });
  const admin = await createUser({ role: 'admin', name: unique('Admin'), withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const mgr = await createUser({ role: 'employee', name: unique('Mgr'), withOrg: false });
  const mgrM = await createOrgMembership(mgr.id, org.id, { role: 'employee' });
  const emp = await createUser({ role: 'employee', name: unique('Emp'), withOrg: false });
  const empM = await createOrgMembership(emp.id, org.id, { role: 'employee' });
  await prisma.orgMembership.update({ where: { id: empM.id }, data: { manager_id: mgrM.id } });
  const other = await createUser({ role: 'employee', name: unique('Other'), withOrg: false });
  await createOrgMembership(other.id, org.id, { role: 'employee' });
  return {
    org, empM,
    adminT: api((await loginAs(admin)).access_token),
    mgrT: api((await loginAs(mgr)).access_token),
    empT: api((await loginAs(emp)).access_token),
    otherT: api((await loginAs(other)).access_token),
  };
}

test('full flow: submit, manager retention call, HR approves with an LWD, then moves to F&F', async () => {
  const { empM, adminT, mgrT, empT } = await setup();
  const submitted = await empT.post('/', { reason: 'Better offer', reason_category: 'better_opportunity', proposed_lwd: day(30) });
  expect(submitted.status).toBe(201);
  const id = submitted.body.data.id;
  expect(submitted.body.data).toMatchObject({ status: 'submitted', meeting_done: false });

  // the employee still works as before until HR approves
  expect((await prisma.orgMembership.findUnique({ where: { id: empM.id } })).employment_status).toBe('active');

  // the manager sees it; HR cannot approve before the manager has recorded the call
  expect((await mgrT.get('/team')).body.data).toHaveLength(1);
  const early = await adminT.post(`/${id}/approve`, { approved_lwd: day(35) });
  expect(early.status).toBe(409);

  const review = await mgrT.put(`/${id}/manager-review`, { meeting_done: true, manager_notes: 'Wants a hike we cannot give', manager_outcome: 'not_retained' });
  expect(review.status).toBe(200);
  expect(review.body.data).toMatchObject({ meeting_done: true, manager_outcome: 'not_retained', status: 'manager_approved' });

  const approved = await adminT.post(`/${id}/approve`, { approved_lwd: day(35) });
  expect(approved.status).toBe(200);
  expect(approved.body.data).toMatchObject({ status: 'approved', approved_lwd: day(35) });
  const m = await prisma.orgMembership.findUnique({ where: { id: empM.id } });
  expect(m.employment_status).toBe('notice_period');
  expect(m.notice_end_date.toISOString().slice(0, 10)).toBe(day(35));

  // F&F is not started by approving; HR starts it, once
  expect(await prisma.fnfRecord.count({ where: { org_membership_id: empM.id } })).toBe(0);
  expect((await adminT.post(`/${id}/start-fnf`)).status).toBe(200);
  const fnf = await prisma.fnfRecord.findUnique({ where: { org_membership_id: empM.id } });
  expect(fnf.start_date.toISOString().slice(0, 10)).toBe(day(35));
  expect((await adminT.post(`/${id}/start-fnf`)).status).toBe(409);
});

test('guards: one open request, past LWD, own record only, manager only for their reports', async () => {
  const { adminT, mgrT, empT, otherT } = await setup();
  expect((await empT.post('/', { reason: 'Personal', proposed_lwd: day(-2) })).status).toBe(422);
  const first = await empT.post('/', { reason: 'Personal', proposed_lwd: day(20) });
  expect(first.status).toBe(201);
  expect((await empT.post('/', { reason: 'Again', proposed_lwd: day(20) })).status).toBe(409);
  const id = first.body.data.id;

  expect((await otherT.post(`/${id}/withdraw`)).status).toBe(404);
  expect((await otherT.put(`/${id}/manager-review`, { meeting_done: true })).status).toBe(403);
  expect((await empT.get('/')).status).toBe(403); // HR list
  expect((await empT.post(`/${id}/approve`, { approved_lwd: day(25) })).status).toBe(403);
  expect((await mgrT.post(`/${id}/approve`, { approved_lwd: day(25) })).status).toBe(403);
  expect((await mgrT.put(`/${id}/manager-review`, { meeting_done: false, manager_outcome: 'retained' })).status).toBe(422);

  expect((await empT.post(`/${id}/withdraw`)).status).toBe(200);
  expect((await adminT.post(`/${id}/approve`, { approved_lwd: day(25) })).status).toBe(409); // closed
  expect((await empT.post('/', { reason: 'Second try', proposed_lwd: day(20) })).status).toBe(201);
});

test('the proposed last working day is optional; HR sets it on approval', async () => {
  const { empM, adminT, empT } = await setup();
  const res = await empT.post('/', { reason: 'Moving on' });
  expect(res.status).toBe(201);
  expect(res.body.data.proposed_lwd).toBeNull();
  const approved = await adminT.post(`/${res.body.data.id}/approve`, { approved_lwd: day(30), skip_manager_step: true });
  expect(approved.status).toBe(200);
  expect((await prisma.orgMembership.findUnique({ where: { id: empM.id } })).notice_end_date.toISOString().slice(0, 10)).toBe(day(30));
});

test('manager marks the employee as retained: request closes, employee stays active', async () => {
  const { empM, mgrT, empT } = await setup();
  const id = (await empT.post('/', { reason: 'Unhappy', proposed_lwd: day(20) })).body.data.id;
  const res = await mgrT.put(`/${id}/manager-review`, { meeting_done: true, manager_outcome: 'retained', manager_notes: 'Agreed a role change' });
  expect(res.body.data.status).toBe('retained');
  expect((await prisma.orgMembership.findUnique({ where: { id: empM.id } })).employment_status).toBe('active');
});

test('HR can reject with remarks, approve without the manager step, and the company can switch the feature off', async () => {
  const { adminT, empT } = await setup();
  const a = (await empT.post('/', { reason: 'Move abroad', proposed_lwd: day(20) })).body.data.id;
  expect((await adminT.post(`/${a}/reject`, {})).status).toBe(422); // remarks needed
  const rejected = await adminT.post(`/${a}/reject`, { remarks: 'Please discuss with your manager first' });
  expect(rejected.body.data).toMatchObject({ status: 'rejected' });

  const b = (await empT.post('/', { reason: 'Move abroad', proposed_lwd: day(20) })).body.data.id;
  expect((await adminT.post(`/${b}/approve`, { approved_lwd: day(40), skip_manager_step: true })).status).toBe(200);

  expect((await adminT.put('/settings', { resignation_enabled: false })).status).toBe(200);
  expect((await empT.get('/settings')).body.data.resignation_enabled).toBe(false);
});

test('settings can only be changed by an admin; disabled blocks new requests', async () => {
  const { adminT, empT, mgrT } = await setup();
  expect((await empT.put('/settings', { resignation_notice_days: 60 })).status).toBe(403);
  expect((await adminT.put('/settings', { resignation_notice_days: 60, resignation_enabled: false })).body.data.resignation_notice_days).toBe(60);
  expect((await mgrT.post('/', { reason: 'Leaving', proposed_lwd: day(70) })).status).toBe(403);
});
