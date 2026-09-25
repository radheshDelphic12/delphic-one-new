/**
 * Notification → in-app route mapping + a tiny relative-time formatter. Shared by
 * the bell, the notifications page, and the calendar.
 */

export function entityLink({ entity_type, entity_id, metadata } = {}) {
  switch (entity_type) {
    case 'account':
      return entity_id ? `/accounts/${entity_id}` : '/accounts';
    case 'requirement':
      return entity_id ? `/requirements/${entity_id}` : '/requirements';
    case 'submission':
      return entity_id ? `/submissions/${entity_id}` : '/submissions';
    case 'profile':
      return entity_id ? `/profiles/${entity_id}` : '/profiles';
    case 'interview_round': {
      const submissionId = metadata?.submission_id;
      return submissionId ? `/submissions/${submissionId}#interview-rounds` : '/calendar';
    }
    default:
      return '/notifications';
  }
}

const UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

/** "just now", "5m ago", "3h ago", "Yesterday", "Mar 12". */
export function formatRelative(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const secs = Math.round(diffMs / 1000);

  if (secs < 45) return 'just now';
  for (const [unit, unitSecs] of UNITS) {
    const n = Math.floor(secs / unitSecs);
    if (n >= 1) {
      if (unit === 'day' && n === 1) return 'Yesterday';
      if (unit === 'minute') return `${n}m ago`;
      if (unit === 'hour') return `${n}h ago`;
      if (unit === 'day' && n < 7) return `${n}d ago`;
      return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }
  return 'just now';
}
