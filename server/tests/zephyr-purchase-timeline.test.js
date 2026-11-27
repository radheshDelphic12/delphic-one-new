/** Zephyr > Properties > Purchase timeline: planned steps of buying a property, with planned and done dates, late steps, the usual steps. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

let ctx;
beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE zx_property_purchase_steps');
  const org = await createOrg({ name: 'Zephyr timeline', slug: 'zephyr-timeline' });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['zephyr'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  ctx = { org, adminToken: (await loginAs(admin)).access_token };
});
afterAll(async () => { await prisma.$disconnect(); });

const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/zephyr${path}`), token).send(body || {}),
  patch: (path, body) => authed(request(app).patch(`/api/v1/zephyr${path}`), token).send(body || {}),
  del: (path) => authed(request(app).delete(`/api/v1/zephyr${path}`), token),
  get: (path) => authed(request(app).get(`/api/v1/zephyr${path}`), token),
});
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test('steps with planned and done dates; a step past its date and not done is late; the usual steps are added once', async () => {
  const a = api(ctx.adminToken);
  const id = (await a.post('/properties', { name: 'Plot T', property_type: 'plot' })).body.data.id;
  let p = (await a.post(`/properties/${id}/purchase-steps`, { title: 'Token paid', planned_date: day(-10), done_date: day(-8), amount: 50000 })).body.data;
  p = (await a.post(`/properties/${id}/purchase-steps`, { title: 'Sale agreement', planned_date: day(-3) })).body.data;
  p = (await a.post(`/properties/${id}/purchase-steps`, { title: 'Registration', planned_date: day(20) })).body.data;
  const by = Object.fromEntries(p.purchase_steps.map((s) => [s.title, s]));
  expect(by['Token paid']).toMatchObject({ state: 'done', done_vs_plan_days: 2, amount: 50000 });
  expect(by['Sale agreement']).toMatchObject({ state: 'late', days_late: 3 });
  expect(by.Registration.state).toBe('upcoming');

  // mark the late one done; edit; remove
  p = (await a.patch(`/properties/${id}/purchase-steps/${by['Sale agreement'].id}`, { done_date: day(0) })).body.data;
  expect(p.purchase_steps.find((s) => s.title === 'Sale agreement').state).toBe('done');
  p = (await a.del(`/properties/${id}/purchase-steps/${by.Registration.id}`)).body.data;
  expect(p.purchase_steps).toHaveLength(2);

  // the usual steps: added once, existing names skipped
  p = (await a.post(`/properties/${id}/purchase-steps/defaults`)).body.data;
  const n = p.purchase_steps.length;
  expect(n).toBeGreaterThanOrEqual(7);
  p = (await a.post(`/properties/${id}/purchase-steps/defaults`)).body.data;
  expect(p.purchase_steps).toHaveLength(n);

  expect((await a.post(`/properties/${id}/purchase-steps`, { title: '' })).status).toBe(422);
  expect((await a.post('/properties/00000000-0000-4000-8000-000000000000/purchase-steps', { title: 'X' })).status).toBe(404);
  expect((await a.patch(`/properties/${id}/purchase-steps/00000000-0000-4000-8000-000000000000`, { title: 'X' })).status).toBe(404);
  // the property page carries the steps
  expect((await a.get(`/properties/${id}`)).body.data.purchase_steps.length).toBe(n);
});
