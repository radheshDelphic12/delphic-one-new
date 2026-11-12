// A person serving notice becomes Exited (terminated) the day after their last working day.
const { prisma, cleanDatabase, createUser, createOrg, createOrgMembership, unique } = require('./helpers');
const lwdExit = require('../src/jobs/lwdExit');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const day = (s) => new Date(`${s}T00:00:00.000Z`);

async function member(org, lwd, status = 'notice_period') {
  const user = await createUser({ role: 'employee', name: unique('P') });
  const m = await createOrgMembership(user.id, org.id, { role: 'employee' });
  await prisma.orgMembership.update({ where: { id: m.id }, data: { employment_status: status, notice_start_date: day('2026-08-18'), notice_end_date: lwd ? day(lwd) : null } });
  return m;
}

test('exits only those whose last working day is before today; the LWD itself is still serving notice', async () => {
  const org = await createOrg({ name: 'Delphic', slug: unique('d-') });
  const past = await member(org, '2026-10-15');
  const onLwd = await member(org, '2026-10-16');
  const future = await member(org, '2026-11-30');
  const active = await member(org, '2026-10-01', 'active'); // not serving notice: untouched
  const res = await lwdExit.run(day('2026-10-16'));
  expect(res.exited).toBe(1);
  const get = (m) => prisma.orgMembership.findUnique({ where: { id: m.id } });
  expect(await get(past)).toMatchObject({ employment_status: 'terminated' });
  expect((await get(past)).left_at.toISOString().slice(0, 10)).toBe('2026-10-15');
  expect((await get(onLwd)).employment_status).toBe('notice_period');
  expect((await get(future)).employment_status).toBe('notice_period');
  expect((await get(active)).employment_status).toBe('active');
  // the next day the LWD person exits too, and running again changes nothing
  expect((await lwdExit.run(day('2026-10-17'))).exited).toBe(1);
  expect((await lwdExit.run(day('2026-10-17'))).exited).toBe(0);
});

describe('an exited employee can no longer sign in', () => {
  const { app, request, PASSWORD } = require('./helpers');
  const signIn = (u) => request(app).post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD });

  test('login and refresh are refused once every membership is Exited, with no manual disabling; working and multi-company people are unaffected', async () => {
    const org = await createOrg({ name: 'Delphic', slug: unique('d-') });
    const org2 = await createOrg({ name: 'Other', slug: unique('o-') });
    const user = await createUser({ role: 'employee', name: unique('P') });
    const m = await createOrgMembership(user.id, org.id, { role: 'employee' });
    await prisma.orgMembership.update({ where: { id: m.id }, data: { employment_status: 'notice_period', notice_end_date: day('2026-10-15') } });

    const before = await signIn(user); // serving notice still works until the last working day has passed
    expect(before.status).toBe(200);
    await lwdExit.run(day('2026-10-16'));

    const after = await signIn(user);
    expect(after.status).toBe(403);
    expect(after.body.message || after.body.error || JSON.stringify(after.body)).toMatch(/employment has ended/i);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refresh_token: before.body.data.refresh_token })).status).toBe(401);

    // still working in another company: can sign in
    const m2 = await createOrgMembership(user.id, org2.id, { role: 'employee' });
    expect(m2).toBeTruthy();
    expect((await signIn(user)).status).toBe(200);
  });
});
