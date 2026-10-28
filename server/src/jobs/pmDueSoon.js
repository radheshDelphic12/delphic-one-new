const cron = require('node-cron');
const logger = require('../config/logger');
const orgContext = require('../lib/orgContext');
const pm = require('../modules/pm/pm.service');

/** Every morning (08:30 IST): remind the assignee of every open project ticket due today or tomorrow. Once per ticket per day. */
async function run() {
  const result = await orgContext.runAs('Nightly job: project ticket reminders', () => pm.notifyDueSoon());
  if (result.sent) logger.info('pm_due_soon_sent', result);
  return result;
}

function schedule() {
  return cron.schedule('30 8 * * *', () => {
    run().catch((err) => logger.error('pm_due_soon_tick_failed', { err }));
  }, { timezone: 'Asia/Kolkata' });
}

module.exports = { run, schedule };
