const cron = require('node-cron');
const logger = require('../config/logger');
const orgContext = require('../lib/orgContext');
const { purgeExpiredRecordings } = require('../modules/aiInterviews/aiInterviews.service');

/**
 * Deletes AI interview recordings once their retention time (default 2 days) has passed. The interview, transcript and
 * scores stay; only the audio + video file goes. Idempotent, so it also runs once at start-up to catch a missed hour.
 */
async function run(now = new Date()) {
  return orgContext.runAs('Hourly job: AI interview recordings', () => purgeExpiredRecordings(now));
}

function schedule() {
  const tick = () => run().then((r) => { if (r.purged) logger.info('ai_interview_recordings_purged', { count: r.purged }); })
    .catch((err) => logger.error('ai_interview_recordings_failed', { err }));
  tick();
  return cron.schedule('5 * * * *', tick, { timezone: 'Asia/Kolkata' });
}

module.exports = { run, schedule };
