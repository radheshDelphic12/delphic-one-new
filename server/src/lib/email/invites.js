const { buildInvite } = require('./ics');

/**
 * ICS for an interview round. Returns undefined when the round has no time yet.
 * Uses the round's stored meeting_link (e.g. a Teams link) as the join URL.
 * The id is the UID, so a reschedule (higher `sequence`) updates the same
 * calendar entry instead of creating a duplicate.
 */
function interviewRoundInvite({ round, title, description, organizer, method = 'REQUEST', sequence = 0 }) {
  if (!round?.scheduled_at) return undefined;
  const start = new Date(round.scheduled_at);
  const end = new Date(start.getTime() + (round.duration_minutes || 60) * 60 * 1000);
  return buildInvite({
    uid: `interview-round-${round.id}@delphic-one`,
    title,
    description,
    url: round.meeting_link || '',
    location: round.meeting_link ? 'Online' : '',
    start,
    end,
    organizer,
    method,
    sequence,
  });
}

module.exports = { interviewRoundInvite };
