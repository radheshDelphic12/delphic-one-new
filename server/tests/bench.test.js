// Phase 5: bench dates, countdown, the bench list, and who may apply for an internal job.
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed, unique } = require('./helpers');
const bench = require('../src/modules/bench/bench.service');

const d = (s) => new Date(`${s}T00:00:00.000Z`);
let org; let adminToken;

beforeEach(async () => {
  await cleanDatabase();
  org = await createOrg({ name: 'Delphic', slug: unique('d-') });
  const admin = await createUser({ role: 'admin', name: 'Admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
});
afterAll(async () => { await prisma.$disconnect(); });

async function person(name, status) {
  const user = await createUser({ role: 'employee', name, withOrg: false });
  const m = await createOrgMembership(user.id, org.id, { role: 'employee', employment_status: status });
  return { user, m };
}
const patch = (id, body) => authed(request(app).patch(`/api/v1/orgs/memberships/${id}`), adminToken).send(body);

async function allocate(m, from = '2026-01-01', to = null) {
  const owner = await prisma.user.findFirst({ where: { id: { not: m.person_id } } });
  const account = await prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: owner.id, origin_owner_id: owner.id, org_id: org.id } });
  return prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: account.id, org_membership_id: m.id, start_date: d(from), end_date: to ? d(to) : null, created_by: owner.id } });
}

describe('bench period', () => {
  test('start date fills the end date 30 days later; an explicit end is kept; end before start is refused; clearing the start clears both', async () => {
    const { m } = await person('Bench One', 'active');
    const res = await patch(m.id, { bench_start_date: '2026-10-01' });
    expect(res.status).toBe(200);
    expect(res.body.data.bench_end_date.slice(0, 10)).toBe('2026-10-31');
    expect((await patch(m.id, { bench_end_date: '2026-10-20' })).body.data.bench_end_date.slice(0, 10)).toBe('2026-10-20');
    expect((await patch(m.id, { bench_end_date: '2026-09-01' })).status).toBe(422);
    const moved = await patch(m.id, { bench_start_date: '2026-11-01' });
    expect(moved.body.data.bench_end_date.slice(0, 10)).toBe('2026-12-01'); // a new start restarts the 30 days
    const cleared = await patch(m.id, { bench_start_date: null });
    expect(cleared.body.data.bench_end_date).toBeNull();
    expect((await patch(m.id, { bench_end_date: '2026-12-01' })).status).toBe(422); // an end needs a start
  });

  test('the bench list: only people inside their dates and with no project today; days left counted', async () => {
    const today = d('2026-10-20');
    const a = await person('On Bench', 'active');
    const b = await person('Has Project', 'active');
    const c = await person('Bench Over', 'active');
    const e = await person('Not Started', 'active');
    const f = await person('Left', 'terminated');
    const set = (m, s, en) => prisma.orgMembership.update({ where: { id: m.id }, data: { bench_start_date: d(s), bench_end_date: d(en) } });
    await set(a.m, '2026-10-10', '2026-11-09');
    await set(b.m, '2026-10-10', '2026-11-09');
    await set(c.m, '2026-09-01', '2026-10-01');
    await set(e.m, '2026-10-25', '2026-11-24');
    await set(f.m, '2026-10-10', '2026-11-09');
    await allocate(b.m);
    const list = await bench.onBench(org.id, { today });
    expect(list.map((x) => [x.name, x.days_left])).toEqual([['On Bench', 20]]);
    // a project that ended before today does not count; one that starts later does not either
    const g = await person('Old Project', 'active');
    await set(g.m, '2026-10-10', '2026-10-30');
    await allocate(g.m, '2026-01-01', '2026-10-05');
    await allocate(g.m, '2026-11-01');
    expect((await bench.onBench(org.id, { today })).map((x) => x.name)).toEqual(['Old Project', 'On Bench']);
    // API: admins only
    expect((await authed(request(app).get('/api/v1/orgs/bench'), adminToken)).status).toBe(200);
    const empToken = (await loginAs(a.user)).access_token;
    expect((await authed(request(app).get('/api/v1/orgs/bench'), empToken)).status).toBe(403);
  });

  test('countdown notifications go to the person and the admins on 30, 15, 7, 3, 1 days and the last day, once a day', async () => {
    const today = d('2026-10-20');
    const a = await person('Seven Left', 'active');
    const b = await person('Eight Left', 'active');
    await prisma.orgMembership.update({ where: { id: a.m.id }, data: { bench_start_date: d('2026-10-01'), bench_end_date: d('2026-10-27') } });
    await prisma.orgMembership.update({ where: { id: b.m.id }, data: { bench_start_date: d('2026-10-01'), bench_end_date: d('2026-10-28') } });
    expect((await bench.notifyCountdowns({ today })).sent).toBe(1);
    expect((await bench.notifyCountdowns({ today })).sent).toBe(0);
    const notes = await prisma.notification.findMany({ where: { type: 'bench_countdown' } });
    expect(notes.some((n) => n.user_id === a.user.id && /7 days left/.test(n.body))).toBe(true);
    expect(notes.some((n) => /Eight Left/.test(n.body))).toBe(false);
  });
});

describe('internal jobs: apply myself', () => {
  test('allowed on the bench or in notice, refused otherwise and once a project starts; the rule never touches refer', async () => {
    const today = d('2026-10-20');
    const plain = await person('Plain', 'active');
    const notice = await person('Notice', 'notice_period');
    const benched = await person('Benched', 'active');
    const busy = await person('Busy Benched', 'active');
    await prisma.orgMembership.update({ where: { id: benched.m.id }, data: { bench_start_date: d('2026-10-15'), bench_end_date: d('2026-11-14') } });
    await prisma.orgMembership.update({ where: { id: busy.m.id }, data: { bench_start_date: d('2026-10-15'), bench_end_date: d('2026-11-14') } });
    await allocate(busy.m);
    const can = (x) => bench.canApplyInternally(org.id, x.m.id, { today });
    expect(await can(plain)).toBe(false);
    expect(await can(notice)).toBe(true);
    expect(await can(benched)).toBe(true);
    expect(await can(busy)).toBe(false);
    expect(await bench.canApplyInternally(org.id, null, { today })).toBe(false);
  });
});
