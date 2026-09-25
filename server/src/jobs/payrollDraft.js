const cron = require('node-cron');
const prisma = require('../config/db');
const logger = require('../config/logger');
const payrollService = require('../modules/payroll/payroll.service');

/**
 * Opens a DRAFT payroll run for the month that just ended, for every active
 * org. Deliberately stops at draft: processing generates payslips from
 * attendance/leave and can't be re-run, so an admin still reviews the month
 * (regularizations, leave decisions) and presses Process themselves.
 * Idempotent — an existing run for the period is left alone.
 */
async function run(now = new Date()) {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const period_month = prev.getUTCMonth() + 1;
  const period_year = prev.getUTCFullYear();

  const orgs = await prisma.org.findMany({ where: { status: 'active' }, select: { id: true } });
  let created = 0;
  for (const org of orgs) {
    const result = await payrollService.createRun(org.id, { period_month, period_year });
    if (!result.error) created += 1;
  }
  logger.info('payroll_draft_run', { period_month, period_year, orgs: orgs.length, created });
  return { period_month, period_year, orgs: orgs.length, created };
}

function schedule() {
  // 03:00 UTC on the 1st (~08:30 IST) — the month has fully closed everywhere.
  return cron.schedule('0 3 1 * *', () => {
    run().catch((err) => logger.error('payroll_draft_tick_failed', { err }));
  });
}

module.exports = { run, schedule };
