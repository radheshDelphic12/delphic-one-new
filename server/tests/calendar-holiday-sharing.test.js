// A holiday shared with every calendar of the company shows for everyone, whichever office calendar they follow.
const { prisma, cleanDatabase, createUser, createOrg, createOrgMembership, unique } = require('./helpers');
const calendars = require('../src/modules/calendars/calendars.service');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const d = (s) => new Date(`${s}T00:00:00.000Z`);

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('d-') });
  const mk = async (name, extra = {}) => (await calendars.create(org.id, { name, kind: 'internal', ...extra })).calendar;
  const ahmedabad = await mk('Ahmedabad', { is_default: true });
  const indore = await mk('Indore');
  const gurugram = await mk('Gurugram');
  const user = await createUser({ role: 'employee' });
  const member = await createOrgMembership(user.id, org.id, { role: 'employee' });
  await prisma.employeeCalendar.create({ data: { org_membership_id: member.id, calendar_id: indore.id, account_id: null } });
  return { org, ahmedabad, indore, gurugram, member };
}

const holidaysOf = async (ctx, from, to) => (await calendars.companyHolidaysByMember(ctx.org.id, [ctx.member.id], d(from), d(to))).get(ctx.member.id);
const rowsOn = (date) => prisma.calendarHoliday.findMany({ where: { date: d(date) } });

test('a holiday added only to one calendar is missing for someone on another calendar (why Diwali showed in one place only)', async () => {
  const ctx = await seed();
  await calendars.addHoliday(ctx.org.id, ctx.ahmedabad.id, { date: d('2026-11-08'), label: 'Diwali' });
  expect((await holidaysOf(ctx, '2026-11-01', '2026-11-30')).size).toBe(0); // Indore calendar has nothing
});

test('"applies to all" puts a copy on every other calendar, so the employee on Indore sees it', async () => {
  const ctx = await seed();
  const res = await calendars.addHoliday(ctx.org.id, ctx.ahmedabad.id, { date: d('2026-11-08'), label: 'Diwali', applies_to_all: true });
  expect(res.copied).toBe(2);
  expect(res.holiday.applies_to_all).toBe(true);
  expect([...(await holidaysOf(ctx, '2026-11-01', '2026-11-30')).entries()]).toEqual([['2026-11-08', 'Diwali']]);
  expect(await rowsOn('2026-11-08')).toHaveLength(3);
});

test('sharing an existing holiday, then renaming, moving and deleting it follows through to the copies', async () => {
  const ctx = await seed();
  const { holiday } = await calendars.addHoliday(ctx.org.id, ctx.ahmedabad.id, { date: d('2026-11-08'), label: 'Diwali' });
  const shared = await calendars.shareHoliday(ctx.org.id, ctx.ahmedabad.id, holiday.id, true);
  expect(shared).toMatchObject({ copied: 2, kept: 0 });

  await calendars.updateHoliday(ctx.org.id, ctx.ahmedabad.id, holiday.id, { label: 'Diwali (Lakshmi Puja)', date: d('2026-11-09') });
  expect([...(await holidaysOf(ctx, '2026-11-01', '2026-11-30')).entries()]).toEqual([['2026-11-09', 'Diwali (Lakshmi Puja)']]);

  await calendars.removeHoliday(ctx.org.id, ctx.ahmedabad.id, holiday.id);
  expect(await prisma.calendarHoliday.count()).toBe(0);
});

test('a calendar that already has something on that date keeps it; a copy cannot be re-shared; un-sharing removes only the copies', async () => {
  const ctx = await seed();
  await calendars.addHoliday(ctx.org.id, ctx.indore.id, { date: d('2026-11-08'), label: 'Indore own Diwali' });
  await calendars.addHoliday(ctx.org.id, ctx.gurugram.id, { date: d('2026-11-08'), label: 'Gurugram working day', is_working_day: true });
  const { holiday } = await calendars.addHoliday(ctx.org.id, ctx.ahmedabad.id, { date: d('2026-11-08'), label: 'Diwali' });
  const shared = await calendars.shareHoliday(ctx.org.id, ctx.ahmedabad.id, holiday.id, true);
  expect(shared).toMatchObject({ copied: 0, kept: 2 });
  expect((await holidaysOf(ctx, '2026-11-01', '2026-11-30')).get('2026-11-08')).toBe('Indore own Diwali');

  const other = (await calendars.addHoliday(ctx.org.id, ctx.ahmedabad.id, { date: d('2026-12-25'), label: 'Christmas', applies_to_all: true })).holiday;
  const copy = await prisma.calendarHoliday.findFirst({ where: { copy_of_id: other.id } });
  expect(await calendars.shareHoliday(ctx.org.id, copy.calendar_id, copy.id, true)).toEqual({ error: 'is_a_copy' });
  await calendars.shareHoliday(ctx.org.id, ctx.ahmedabad.id, other.id, false);
  expect(await rowsOn('2026-12-25')).toHaveLength(1);
});

test('a calendar created later starts with the shared holidays; a working-day exception cannot be shared', async () => {
  const ctx = await seed();
  await calendars.addHoliday(ctx.org.id, ctx.ahmedabad.id, { date: d('2026-11-08'), label: 'Diwali', applies_to_all: true });
  const bangalore = (await calendars.create(ctx.org.id, { name: 'Bangalore', kind: 'internal' })).calendar;
  expect(await prisma.calendarHoliday.count({ where: { calendar_id: bangalore.id } })).toBe(1);
  const workDay = (await calendars.addHoliday(ctx.org.id, ctx.ahmedabad.id, { date: d('2026-11-14'), label: 'Saturday working', is_working_day: true })).holiday;
  expect(await calendars.shareHoliday(ctx.org.id, ctx.ahmedabad.id, workDay.id, true)).toEqual({ error: 'working_day_not_shareable' });
});
