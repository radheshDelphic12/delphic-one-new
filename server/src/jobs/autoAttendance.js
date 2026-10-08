const cron = require('node-cron');
const prisma = require('../config/db');
const logger = require('../config/logger');
const autoAttendance = require('../modules/attendance/autoAttendance.service');

/**
 * Daily attendance: every 10 minutes, mark TODAY (IST) present for applicable employees whose
 * working-hour start time has passed (working day, no leave / holiday, no record yet). Never marks
 * a future date. Idempotent, so it also runs once on startup to catch up after downtime.
 */
async function run(now = new Date()) {
  const orgs = await prisma.org.findMany({ where: { status: 'active' }, select: { id: true } });
  let created = 0;
  for (const org of orgs) {
    try {
      created += (await autoAttendance.runDaily(org.id, now)).created;
    } catch (err) {
      logger.error('auto_attendance_org_failed', { org_id: org.id, err });
    }
  }
  if (created) logger.info('auto_attendance_run', { orgs: orgs.length, marked_present: created });
  return { orgs: orgs.length, created };
}

function schedule() {
  run().catch((err) => logger.error('auto_attendance_startup_failed', { err }));
  return cron.schedule('*/10 * * * *', () => {
    run().catch((err) => logger.error('auto_attendance_tick_failed', { err }));
  }, { timezone: 'Asia/Kolkata' });
}

module.exports = { run, schedule };
