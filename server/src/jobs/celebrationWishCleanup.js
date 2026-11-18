const cron = require('node-cron');
const logger = require('../config/logger');
const orgContext = require('../lib/orgContext');
const announcements = require('../modules/orgs/announcements.service');

/** Every night just after midnight IST: delete birthday / anniversary wishes from earlier days (they only live for their own day). */
async function run() {
  const result = await orgContext.runAs('Nightly job: clear old celebration wishes', () => announcements.purgeOldWishes());
  if (result.deleted) logger.info('celebration_wishes_cleared', result);
  return result;
}

function schedule() {
  return cron.schedule('5 0 * * *', () => {
    run().catch((err) => logger.error('celebration_wish_cleanup_failed', { err }));
  }, { timezone: 'Asia/Kolkata' });
}

module.exports = { run, schedule };
