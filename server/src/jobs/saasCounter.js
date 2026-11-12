const cron = require('node-cron');
const logger = require('../config/logger');
const orgContext = require('../lib/orgContext');
const credits = require('../modules/platform/credits.service');
const switches = require('../modules/platform/switches.service');

/**
 * Every day just after midnight IST: take 1 credit day off every active slot module (SaaS launch plan, phase 2). Idempotent per day and it catches
 * up a missed day. Does nothing at all unless the "Daily credit counter" switch is on (platform screen; env SAAS_COUNTER_ENABLED is the initial fallback).
 */
async function run() {
  if (!(await switches.isOn('counter'))) return { skipped: true };
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
