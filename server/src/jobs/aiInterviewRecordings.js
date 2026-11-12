const cron = require('node-cron');
const logger = require('../config/logger');
const orgContext = require('../lib/orgContext');
const { purgeExpiredRecordings, moveRecordingsToSharePoint, sweepSharePointRecordings, diskStatus } = require('../modules/aiInterviews/aiInterviews.service');

/**
 * Hourly: deletes AI interview recordings once their retention time (default 2 days, never more than 7) has passed, on the server and
 * on SharePoint. The interview, transcript and scores stay; only the audio + video file goes. Idempotent, so it also runs once at
 * start-up to catch a missed hour. Also checks the free disk space.
 */
async function run(now = new Date()) {
  return orgContext.runAs('Hourly job: AI interview recordings', async () => {
    const purged = await purgeExpiredRecordings(now);
    const swept = await sweepSharePointRecordings(now).catch((err) => { logger.error('ai_interview_recordings_sweep_failed', { err }); return { swept: 0 }; });
    const disk = await diskStatus().catch(() => null);
    if (disk?.low) logger.error('low_disk_space', { free_mb: disk.freeMb, total_mb: disk.totalMb, min_free_mb: disk.minFreeMb });
    return { ...purged, swept: swept.swept, disk };
  });
}

/** Every 5 minutes: moves finished recordings to SharePoint (does nothing when SharePoint is not set up). */
async function moveToSharePoint(now = new Date()) {
  return orgContext.runAs('Job: move AI interview recordings to SharePoint', () => moveRecordingsToSharePoint(now));
}

function schedule() {
  const tick = () => run().then((r) => { if (r.purged || r.swept) logger.info('ai_interview_recordings_purged', { count: r.purged, swept: r.swept }); })
    .catch((err) => logger.error('ai_interview_recordings_failed', { err }));
  const move = () => moveToSharePoint().then((r) => { if (r.moved) logger.info('ai_interview_recordings_moved', { count: r.moved }); })
    .catch((err) => logger.error('ai_interview_recordings_move_failed', { err }));
  tick();
  move();
  cron.schedule('*/5 * * * *', move, { timezone: 'Asia/Kolkata' });
  return cron.schedule('5 * * * *', tick, { timezone: 'Asia/Kolkata' });
}

module.exports = { run, moveToSharePoint, schedule };
