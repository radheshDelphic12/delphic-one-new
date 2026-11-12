const cron = require('node-cron');
const prisma = require('../config/db');
const logger = require('../config/logger');
const { todayIst } = require('../lib/istDate');
const orgContext = require('../lib/orgContext');
const { ensureFnf } = require('../lib/fnf');

/**
 * Exits people whose notice has run out. A membership "Serving notice" (notice_period)
 * becomes "Exited" (terminated) the day AFTER its last working day, with left_at set to
 * that last working day (the same thing the profile does when an admin exits someone by hand).
 *
 * Why a job and not a read-time derivation: employment_status and left_at feed payroll,
 * attendance, leave, the org chart and every `WORKING_STATUSES` query. Deriving the status
 * only when the directory is read would leave all of those still treating the person as
 * working. Idempotent, so it also runs once at start-up to catch a missed night.
 */
async function run(today = todayIst()) {
  return orgContext.runAs('Nightly job: last working day', () => exitDue(today));
}

async function exitDue(today) {
  const due = await prisma.orgMembership.findMany({
    where: { employment_status: 'notice_period', notice_end_date: { lt: today } },
    select: { id: true, org_id: true, notice_end_date: true, left_at: true },
  });
  for (const m of due) {
    const leftAt = m.left_at || m.notice_end_date;
    await prisma.orgMembership.update({
      where: { id: m.id },
      data: { employment_status: 'terminated', left_at: leftAt },
    });
    // the exit starts the full and final settlement (Pending)
    await ensureFnf(prisma, m.org_id, m.id, leftAt);
  }
  if (due.length) logger.info('lwd_exit_done', { count: due.length });
  return { exited: due.length };
}

function schedule() {
  run().catch((err) => logger.error('lwd_exit_startup_failed', { err }));
  // Every night at 00:10 IST (the new day has begun, so yesterday's LWD is past).
  return cron.schedule('10 0 * * *', () => {
    run().catch((err) => logger.error('lwd_exit_tick_failed', { err }));
  }, { timezone: 'Asia/Kolkata' });
}

module.exports = { run, schedule };
