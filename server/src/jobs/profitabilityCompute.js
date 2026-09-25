const cron = require('node-cron');
const logger = require('../config/logger');
const profitabilityService = require('../modules/profitability/profitability.service');

// A day's DailyEmployeeProfitability depends on that day's timesheet
// approvals (and leave/attendance), which land throughout the day it
// describes — so the nightly run always computes *yesterday*, never today.
function yesterday(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
}

/**
 * One nightly tick — computes yesterday's profitability fact rows across
 * every active org (Org.status: 'active'; a no-op wherever none exist yet,
 * e.g. this repo's base recruitment app before Phase 0's tenancy scaffold
 * is backfilled). Safe to call directly from a test or a one-off `node -e`.
 */
async function run(now = new Date()) {
  const date = yesterday(now);
  const result = await profitabilityService.computeAllOrgsForDate(date);
  logger.info('profitability_compute_run', { date: date.toISOString().slice(0, 10), ...result });
  return result;
}

function schedule() {
  // Once daily, 02:00 UTC (~07:30 IST) — after any reasonable end-of-day
  // timesheet approval window, well before business hours.
  return cron.schedule('0 2 * * *', () => {
    run().catch((err) => logger.error('profitability_compute_tick_failed', { err }));
  });
}

module.exports = { run, schedule };
