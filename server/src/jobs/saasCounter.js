const cron = require('node-cron');
const logger = require('../config/logger');
const orgContext = require('../lib/orgContext');
const credits = require('../modules/platform/credits.service');

/**
 * Every day just after midnight IST: take 1 credit day off every active slot module (SaaS launch plan, phase 2). Idempotent per day and it catches
 * up a missed day. Does nothing at all unless SAAS_COUNTER_ENABLED=true, so it is inert for the product as it is today.
 */
async function run() {
  if (process.env.SAAS_COUNTER_ENABLED !== 'true') return { skipped: true };
  const result = await orgContext.runAs('Nightly job: SaaS credit counter', () => credits.runDailyCounter());
  if (result.ran_days) logger.info('saas_counter_ran', { ran_days: result.ran_days, touched: result.touched, alerts: result.alerts.length });
  return result;
}

function schedule() {
  return cron.schedule('5 0 * * *', () => {
    run().catch((err) => logger.error('saas_counter_tick_failed', { err }));
  }, { timezone: 'Asia/Kolkata' });
}

module.exports = { run, schedule };
