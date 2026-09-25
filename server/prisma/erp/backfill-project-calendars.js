/**
 * Project <-> Calendar — one-time backfill.
 *
 * Every project must follow a calendar. Projects created before that rule
 * (active client accounts with no ProjectCalendar row) are mapped to the
 * default calendar — "Ahmedabad Calendar", else the Ahmedabad office calendar,
 * else the org default — so the mapping is real data, not a display fallback.
 * Idempotent and non-destructive: never touches a project that already has a
 * mapping, never deletes anything.
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/erp/backfill-project-calendars.js
 */
const { PrismaClient } = require('@prisma/client');
const { defaultCalendar } = require('../../src/modules/calendars/calendars.service');

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.org.findMany({ select: { id: true, name: true } });
  for (const org of orgs) {
    const calendar = await defaultCalendar(org.id, prisma);
    const unmapped = await prisma.account.findMany({
      where: { org_id: org.id, type: 'client', stage: 'active', project_calendar: null },
      select: { id: true, name: true },
    });
    if (!unmapped.length) continue;
    if (!calendar) {
      console.log(`  ! ${org.name}: ${unmapped.length} project(s) unmapped but the org has no calendar yet — skipped`);
      continue;
    }
    for (const project of unmapped) {
      await prisma.projectCalendar.create({ data: { org_id: org.id, account_id: project.id, calendar_id: calendar.id } });
      console.log(`  + ${org.name}: "${project.name}" -> ${calendar.name}`);
    }
  }
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
