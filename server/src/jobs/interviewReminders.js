const cron = require('node-cron');
const prisma = require('../config/db');
const env = require('../config/env');
const logger = require('../config/logger');
const { roundTypeLabel } = require('../modules/submissions/stageMachines');
const { notify, interviewRoundParticipants } = require('../lib/notifications');

const REMINDER_INCLUDE = {
  submission: {
    select: {
      id: true,
      profile: { select: { name: true } },
      seat: { select: { requirement: { select: { title: true, account: { select: { name: true } } } } } },
    },
  },
};

function fmtWhen(date) {
  try {
    // Server clock is UTC — render in the business timezone or notifications show the wrong time.
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: env.timezone,
    });
  } catch (_err) {
    return '';
  }
}

/**
 * One reminder tick. Finds scheduled rounds inside the T-24h and T-1h windows that
 * have not had that reminder sent, dispatches `interview_reminder` to participants,
 * and stamps the dedupe column. Per-round try/catch so one failure does not abort
 * the batch. Safe to call directly from a test or a one-off `node -e`.
 */
async function run(now = new Date()) {
  const windows = [
    {
      label: 't24',
      column: 'reminder_sent_at',
      gte: new Date(now.getTime() + (24 * 60 - 15) * 60000),
      lte: new Date(now.getTime() + (24 * 60 + 15) * 60000),
    },
    {
      label: 't1',
      column: 'reminder_1h_sent_at',
      gte: new Date(now.getTime() + 45 * 60000),
      lte: new Date(now.getTime() + 75 * 60000),
    },
  ];

  let sent = 0;
  for (const w of windows) {
    let rounds = [];
    try {
      rounds = await prisma.interviewRound.findMany({
        where: {
          status: 'scheduled',
          scheduled_at: { gte: w.gte, lte: w.lte },
          [w.column]: null,
        },
        include: REMINDER_INCLUDE,
      });
    } catch (err) {
      logger.error('interview_reminder_query_failed', { window: w.label, err });
      continue;
    }

    for (const round of rounds) {
      try {
        const req = round.submission?.seat?.requirement;
        await notify(prisma, {
          type: 'interview_reminder',
          actorId: null,
          recipientIds: await interviewRoundParticipants(prisma, round.id),
          context: {
            candidateName: round.submission?.profile?.name,
            requirementTitle: req?.title,
            accountName: req?.account?.name,
            submissionId: round.submission_id,
            interviewRoundId: round.id,
            roundTypeLabel: roundTypeLabel(round.round_type),
            scheduledAtLabel: fmtWhen(round.scheduled_at),
          },
        });
        await prisma.interviewRound.update({ where: { id: round.id }, data: { [w.column]: new Date() } });
        sent += 1;
      } catch (err) {
        logger.error('interview_reminder_failed', { round_id: round.id, window: w.label, err });
      }
    }
  }

  logger.info('interview_reminders_run', { sent });
  return { sent };
}

function schedule() {
  return cron.schedule('*/15 * * * *', () => {
    run().catch((err) => logger.error('interview_reminders_tick_failed', { err }));
  });
}

module.exports = { run, schedule };
