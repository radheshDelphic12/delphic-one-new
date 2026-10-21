const cron = require('node-cron');
const logger = require('../config/logger');
const orgContext = require('../lib/orgContext');
const reminders = require('../modules/payroll/incrementReminders.service');

/**
 * Every morning (00:20 IST): when an employee has completed another year from their joining date, create the "increment
 * review due" reminder and tell the Super Admin users. Never touches salary. Also runs once at start-up and looks back a
 * week, so a missed night is caught up. Idempotent.
 */
async function run() {
  const result = await orgContext.runAs('Nightly job: increment reminders', () => reminders.generate());
  if (result.created) logger.info('increment_reminders_created', result);
  return result;
}

function schedule() {
  run().catch((err) => logger.error('increment_reminders_startup_failed', { err }));
  return cron.schedule('20 0 * * *', () => {
    run().catch((err) => logger.error('increment_reminders_tick_failed', { err }));
  }, { timezone: 'Asia/Kolkata' });
}

module.exports = { run, schedule };
