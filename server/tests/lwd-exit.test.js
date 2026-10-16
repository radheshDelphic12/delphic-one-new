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
