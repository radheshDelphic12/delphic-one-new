// Contractor check-in (Delphic Global only): a plain in / out clock for contractors, no location, kept apart from attendance and the
// location check-in. Contractors only; the report and corrections are for HR / admins.
const { prisma, request, app, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE contractor_checkins, location_checkin_sessions, location_checkins');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const todayStr = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const api = (method, path, token) => authed(request(app)[method](`/api/v1/contractor-checkin${path}`), token);
const range = () => `from=${todayStr()}&to=${todayStr()}`;

async function seed() {
  const org = await createOrg();
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const admin = (await loginAs(adminUser)).access_token;
  const person = async (name, workerType) => {
    const user = await createUser({ role: 'recruiter', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: new Date('2020-01-01T00:00:00Z') });
    if (workerType) await prisma.orgMembership.update({ where: { id: membership.id }, data: { worker_type: workerType } });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  return { org, admin, person };
}

describe('contractor clock', () => {
  test('check in, check out and check in again, with no location stored', async () => {
    const ctx = await seed();
    const c = await ctx.person('Con Tractor', 'contractor');
    expect((await api('get', '/today', c.token)).body.data).toMatchObject({ eligible: true, currently_in: false, sessions: [] });

    const first = await api('post', '/check-in', c.token);
    expect(first.status).toBe(200);
    expect(first.body.data.currently_in).toBe(true);
    expect((await api('post', '/check-in', c.token)).status).toBe(409);

    const out = await api('post', '/check-out', c.token);
    expect(out.status).toBe(200);
    expect(out.body.data.currently_in).toBe(false);
    expect((await api('post', '/check-out', c.token)).status).toBe(409);

    const again = await api('post', '/check-in', c.token);
    expect(again.body.data.sessions).toHaveLength(2);

    const mine = await api('get', `/mine?${range()}`, c.token);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].sessions).toHaveLength(2);

    const row = await prisma.contractorCheckin.findFirst();
    expect(Object.keys(row).some((k) => /lat|lng|distance|photo/.test(k))).toBe(false);
  });

  test('only contractors can use it, and only in the master workspace', async () => {
    const ctx = await seed();
    const employee = await ctx.person('Full Timer', null);
    expect((await api('post', '/check-in', employee.token)).status).toBe(403);
    expect((await api('get', '/today', employee.token)).body.data.eligible).toBe(false);

    const other = await createOrg({ is_master_workspace: false });
    const user = await createUser({ role: 'recruiter' });
    const m = await createOrgMembership(user.id, other.id, { role: 'recruiter' });
    await prisma.orgMembership.update({ where: { id: m.id }, data: { worker_type: 'contractor' } });
    const token = (await loginAs(user)).access_token;
    expect((await api('get', '/today', token)).status).toBe(403);
  });

  test('does not touch attendance or the location check-in', async () => {
    const ctx = await seed();
    const c = await ctx.person('Con', 'contractor');
    await api('post', '/check-in', c.token);
    await api('post', '/check-out', c.token);
    expect(await prisma.attendanceRecord.count({ where: { org_membership_id: c.membership.id } })).toBe(0);
    expect(await prisma.locationCheckin.count()).toBe(0);
  });
});

describe('report and corrections', () => {
  test('HR sees every contractor; contractors cannot read the report', async () => {
    const ctx = await seed();
    const a = await ctx.person('Alpha Con', 'contractor');
    const b = await ctx.person('Beta Con', 'contractor');
    await api('post', '/check-in', a.token);
    await api('post', '/check-out', a.token);
    await api('post', '/check-in', b.token);

    expect((await api('get', `/report?${range()}`, a.token)).status).toBe(403);
    const report = await api('get', `/report?${range()}`, ctx.admin);
    expect(report.status).toBe(200);
    expect(report.body.data.rows.map((r) => r.name).sort()).toEqual(['Alpha Con', 'Beta Con']);
    expect(report.body.data.summary).toMatchObject({ contractors: 2, days: 2, still_in: 1 });

    const one = await api('get', `/report?${range()}&org_membership_id=${a.membership.id}`, ctx.admin);
    expect(one.body.data.rows).toHaveLength(1);
    const csv = await api('get', `/report.csv?${range()}`, ctx.admin);
    expect(csv.text).toContain('Alpha Con');
    expect((await api('get', '/people', ctx.admin)).body.data).toHaveLength(2);
  });

  test('an admin can fix or remove a session with a reason, and it is audited', async () => {
    const ctx = await seed();
    const c = await ctx.person('Con', 'contractor');
    await api('post', '/check-in', c.token);
    const session = await prisma.contractorCheckin.findFirst();

    expect((await api('patch', `/sessions/${session.id}`, c.token).send({ reason: 'self fix' })).status).toBe(403);
    expect((await api('patch', `/sessions/${session.id}`, ctx.admin).send({ out_at: new Date(session.in_at.getTime() - 60000).toISOString(), reason: 'bad' })).status).toBe(422);

    const fixed = await api('patch', `/sessions/${session.id}`, ctx.admin).send({ out_at: new Date(session.in_at.getTime() + 3600000).toISOString(), reason: 'Forgot to check out' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.edited).toBe(true);
    expect((await prisma.contractorCheckin.findFirst()).out_at).not.toBeNull();

    expect((await api('delete', `/sessions/${session.id}`, ctx.admin).send({})).status).toBe(422);
    expect((await api('delete', `/sessions/${session.id}`, ctx.admin).send({ reason: 'Test entry' })).status).toBe(200);
    expect(await prisma.contractorCheckin.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { entity_type: 'contractor_checkin' } })).toBe(2);
  });
});
