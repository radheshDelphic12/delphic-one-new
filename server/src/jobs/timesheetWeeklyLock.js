const cron = require('node-cron');
const prisma = require('../config/db');
const logger = require('../config/logger');
const timesheetsService = require('../modules/timesheets/timesheets.service');

/**
 * Weekly timesheet auto-lock: the company works Monday-Friday, and at
 * Saturday 00:00 (IST) the week that just ended (Mon-Fri) locks for every
 * active org — no more entries or edits from employees OR admins through the
 * normal timesheet screen; corrections go through Timesheet Regularisation.
 *
 * Idempotent (already-locked days are left alone), so it is also run once on
 * startup: if the server was down over a Saturday midnight, the missed lock is
 * applied as soon as it comes back rather than waiting a week.
 */
async function run(now = new Date()) {
  const orgs = await prisma.org.findMany({ where: { status: 'active' }, select: { id: true } });
  let locked = 0;
  for (const org of orgs) {
    try {
      const result = await timesheetsService.lockCompletedWeek(org.id, now);
      locked += result.locked.length;
    } catch (err) {
      logger.error('timesheet_weekly_lock_org_failed', { org_id: org.id, err });
    }
  }
  logger.info('timesheet_weekly_lock_run', { orgs: orgs.length, days_locked: locked });
  return { orgs: orgs.length, days_locked: locked };
}

function schedule() {
  run().catch((err) => logger.error('timesheet_weekly_lock_startup_failed', { err }));
  // Saturday 00:00 IST.
  return cron.schedule('0 0 * * 6', () => {
    run().catch((err) => logger.error('timesheet_weekly_lock_tick_failed', { err }));
  }, { timezone: 'Asia/Kolkata' });
}

module.exports = { run, schedule };
