/**
 * Multi-company ERP — default office locations + holiday calendars.
 *
 * Creates the client brief's default locations (Ahmedabad, Indore, Gurgaon),
 * one office calendar per location, and an India + a US *client* calendar so
 * project-calendar mapping can be exercised end to end. Sample holidays only
 * (fixed-date public holidays) — HR edits them under People > HR Settings.
 *
 * Idempotent and non-destructive: only creates what's missing, never deletes
 * or overwrites, so it's safe to re-run and safe against a shared DB.
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/erp/seed-locations-calendars.js            # org slug "delphic"
 *   ORG_SLUG=other node prisma/erp/seed-locations-calendars.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ORG_SLUG || 'delphic';
const YEAR = Number(process.env.HOLIDAY_YEAR || 2026);

const LOCATIONS = [
  { name: 'Ahmedabad', city: 'Ahmedabad', country: 'India' },
  { name: 'Indore', city: 'Indore', country: 'India' },
  { name: 'Gurgaon', city: 'Gurgaon', country: 'India' },
];

const INDIA_HOLIDAYS = [
  ['01-26', 'Republic Day'],
  ['08-15', 'Independence Day'],
  ['10-02', 'Gandhi Jayanti'],
  ['12-25', 'Christmas'],
];

// 2026 US federal holidays (July 4 falls on a Saturday, observed Friday Jul 3).
const US_HOLIDAYS_2026 = [
  ['2026-01-01', "New Year's Day"],
  ['2026-01-19', 'Martin Luther King Jr. Day'],
  ['2026-02-16', "Presidents' Day"],
  ['2026-05-25', 'Memorial Day'],
  ['2026-06-19', 'Juneteenth'],
  ['2026-07-03', 'Independence Day (observed)'],
  ['2026-09-07', 'Labor Day'],
  ['2026-11-26', 'Thanksgiving'],
  ['2026-12-25', 'Christmas Day'],
];

async function ensureCalendar(orgId, { name, kind, location_id = null }, holidays) {
  let calendar = await prisma.calendar.findFirst({ where: { org_id: orgId, name } });
  if (!calendar) {
    calendar = await prisma.calendar.create({ data: { org_id: orgId, name, kind, location_id } });
    console.log(`  + calendar "${name}"`);
  }
  let added = 0;
  for (const [date, label] of holidays) {
    const day = new Date(`${date}T00:00:00.000Z`);
    const exists = await prisma.calendarHoliday.findUnique({ where: { calendar_id_date: { calendar_id: calendar.id, date: day } } });
    if (!exists) {
      await prisma.calendarHoliday.create({ data: { calendar_id: calendar.id, date: day, label } });
      added += 1;
    }
  }
  if (added) console.log(`    + ${added} holiday(s) on "${name}"`);
}

async function main() {
  const org = await prisma.org.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Org "${ORG_SLUG}" not found. Run the phase-0 backfill first.`);
  console.log(`Seeding locations + calendars for org "${org.name}"`);

  const indiaHolidays = INDIA_HOLIDAYS.map(([md, label]) => [`${YEAR}-${md}`, label]);

  for (const loc of LOCATIONS) {
    let location = await prisma.location.findUnique({ where: { org_id_name: { org_id: org.id, name: loc.name } } });
    if (!location) {
      location = await prisma.location.create({ data: { org_id: org.id, ...loc } });
      console.log(`  + location "${loc.name}"`);
    }
    await ensureCalendar(org.id, { name: `${loc.name} Office`, kind: 'internal', location_id: location.id }, indiaHolidays);
  }

  await ensureCalendar(org.id, { name: 'India Client Calendar', kind: 'client' }, indiaHolidays);
  await ensureCalendar(org.id, { name: 'US Client Calendar', kind: 'client' }, US_HOLIDAYS_2026);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
