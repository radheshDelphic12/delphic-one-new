// The backfill migration marks only the job's own rows as `auto`, and rollback.sql puts them back.
const fs = require('fs');
const path = require('path');
const { prisma, cleanDatabase, createUser, createOrg, createOrgMembership, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const dir = path.join(__dirname, '../prisma/migrations/20261021100100_attendance_auto_backfill');
const sql = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
const d = (s) => new Date(`${s}T00:00:00.000Z`);

test('backfill touches only untouched auto_daily rows, never manual / regularised / real check-ins; rollback restores them', async () => {
  const org = await createOrg({ name: 'Delphic', slug: unique('d-') });
  const admin = await createUser({ role: 'admin' });
  const people = [];
  for (let i = 0; i < 5; i += 1) {
    const user = await createUser({ role: 'employee' });
    people.push(await createOrgMembership(user.id, org.id, { role: 'employee' }));
  }
  const row = (m, data) => prisma.attendanceRecord.create({ data: { org_id: org.id, org_membership_id: m.id, date: d('2026-10-05'), status: 'present', ...data } });
  const job = await row(people[0], { source: 'manual', regularized_reason: 'auto_daily' }); // what the job wrote before `auto` existed
  const regularised = await row(people[1], { source: 'manual', regularized_reason: 'auto_daily', regularized_by: admin.id }); // an admin edited it afterwards
  const manual = await row(people[2], { source: 'manual', regularized_reason: 'forgot to punch', regularized_by: admin.id });
  const checkin = await row(people[3], { source: 'web', check_in_at: new Date('2026-10-05T04:00:00Z') });
  const punched = await row(people[4], { source: 'manual', regularized_reason: 'auto_daily', check_in_at: new Date('2026-10-05T04:00:00Z') });

  await prisma.$executeRawUnsafe(sql('migration.sql'));
  const source = async (r) => (await prisma.attendanceRecord.findUnique({ where: { id: r.id } })).source;
  expect(await source(job)).toBe('auto');
  expect(await source(regularised)).toBe('manual');
  expect(await source(manual)).toBe('manual');
  expect(await source(checkin)).toBe('web');
  expect(await source(punched)).toBe('manual');
  expect((await prisma.attendanceRecord.findUnique({ where: { id: job.id } })).regularized_reason).toBe('auto_daily'); // the reason is kept

  await prisma.$executeRawUnsafe(sql('rollback.sql'));
  expect(await source(job)).toBe('manual');
});
