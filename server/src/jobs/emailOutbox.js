const cron = require('node-cron');
const logger = require('../config/logger');
const outbox = require('../lib/email/outbox');

/** Drains the email outbox every minute. Safe to run with no SMTP configured (rows become `skipped`). */
function schedule() {
  let running = false;
  return cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const result = await outbox.processQueue();
      if (result.sent || result.failed) logger.info('email_outbox_tick', result);
    } catch (err) {
      logger.error('email_outbox_tick_failed', { err });
    } finally {
      running = false;
    }
  });
}

module.exports = { schedule };
