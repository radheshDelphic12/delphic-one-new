const cron = require('node-cron');
const logger = require('../config/logger');
const orgContext = require('../lib/orgContext');
const bench = require('../modules/bench/bench.service');

/** Every morning (00:30 IST): bench countdown notifications (30, 15, 7, 3, 1 days and the last day). Idempotent per day. */
async function run() {
  const result = await orgContext.runAs('Nightly job: bench countdown', () => bench.notifyCountdowns());
  if (result.sent) logger.info('bench_countdown_sent', result);
  return result;
}

function schedule() {
  return cron.schedule('30 0 * * *', () => {
    run().catch((err) => logger.error('bench_countdown_tick_failed', { err }));
  }, { timezone: 'Asia/Kolkata' });
}

module.exports = { run, schedule };
