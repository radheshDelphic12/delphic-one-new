/**
 * Shared interview-round presentation: type list, per-type pill colors, result
 * colors, and grouping helpers. Imported by InterviewRoundsPanel, the calendar
 * (pills / cards / drawers), and pipeline round chips so they never drift.
 *
 * Keep round type values in sync with server/src/modules/submissions/stageMachines.js.
 */

export const ROUND_TYPES = [
  { value: 'internal_r1', label: 'Internal Round 1', group: 'internal', color: 'bg-sky-50 text-sky-800 border-sky-200' },
  { value: 'internal_r2', label: 'Internal Round 2', group: 'internal', color: 'bg-cyan-50 text-cyan-800 border-cyan-200' },
  { value: 'client_r1', label: 'Client Round 1', group: 'client', color: 'bg-violet-50 text-violet-800 border-violet-200' },
  { value: 'client_r2', label: 'Client Round 2', group: 'client', color: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  { value: 'client_r3', label: 'Client Round 3', group: 'client', color: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200' },
  { value: 'hr_cto_ceo', label: 'HR, CTO & CEO Round', group: 'hr', color: 'bg-amber-50 text-amber-900 border-amber-200' },
];

export const RESULT_COLORS = {
  pending: 'bg-tertiary-100 text-tertiary-700',
  pass: 'bg-success-50 text-success-700',
  fail: 'bg-danger-50 text-danger-700',
  no_show: 'bg-warning-50 text-warning-800',
  rescheduled: 'bg-sky-50 text-sky-800',
};

export const RESULT_LABELS = {
  pending: 'Pending',
  pass: 'Pass',
  fail: 'Fail',
  no_show: 'Candidate did not join',
  rescheduled: 'Rescheduled',
};

export const ROUND_RESULTS = ['pending', 'pass', 'fail', 'no_show', 'rescheduled'];

export function resultLabel(result) {
  return RESULT_LABELS[result] || String(result || '').replace(/_/g, ' ');
}

/**
 * Whether interview feedback has already been recorded for a calendar event /
 * round — a decision (pass / fail / did-not-join) or free-text feedback exists.
 * Used to switch the "Submit feedback" CTA to "Review feedback".
 */
export function hasSubmittedFeedback(event) {
  return ['pass', 'fail', 'no_show'].includes(event?.result) || Boolean(event?.feedback);
}

// Left-border accent color per round-type group; used by calendar event pills.
export const ROUND_GROUP_BORDER = {
  internal: 'border-l-sky-400',
  client: 'border-l-violet-400',
  hr: 'border-l-amber-400',
};

// Legend dots for the calendar toolbar (legacy round-group).
export const ROUND_GROUP_LEGEND = [
  { key: 'internal', label: 'Internal', dot: 'bg-sky-400' },
  { key: 'client', label: 'Client', dot: 'bg-violet-400' },
  { key: 'hr', label: 'HR / CxO', dot: 'bg-amber-400' },
  { key: 'cancelled', label: 'Cancelled', dot: 'bg-tertiary-300' },
];

/**
 * Calendar colour model. The interview SLOT itself is coloured:
 *   • no outcome yet (scheduled)   → the interview CATEGORY:
 *       internal = sky/blue, external (client-facing) = violet/purple.
 *   • an outcome/terminal state SUPERSEDES the category colour:
 *       passed      → green
 *       rejected    → red   (round result `fail`, or the submission was rejected / backed out)
 *       did not join→ orange (round result `no_show`)
 *       cancelled   → grey, struck
 *       rescheduled → category colour, dimmed + struck
 *   Badges are secondary; the colour is on the slot.
 */
export const STATUS_LEGEND = [
  { key: 'internal', label: 'Internal (scheduled)', dot: 'bg-sky-500' },
  { key: 'external', label: 'External (scheduled)', dot: 'bg-violet-500' },
  { key: 'meeting_online', label: 'Client meeting · online', dot: 'bg-pink-500' },
  { key: 'meeting_offline', label: 'Client meeting · in person', dot: 'bg-yellow-400' },
  { key: 'pass', label: 'Passed', dot: 'bg-emerald-500' },
  { key: 'fail', label: 'Rejected / failed', dot: 'bg-rose-500' },
  { key: 'no_show', label: 'Candidate did not join', dot: 'bg-orange-500' },
  { key: 'cancelled', label: 'Cancelled (struck through)', dot: 'bg-slate-400' },
  { key: 'rescheduled', label: 'Rescheduled (dimmed)', dot: 'bg-slate-300' },
];

/**
 * Client meetings (an account's scheduled meeting) ride the same calendar feed
 * as interviews but get their own hues so a glance separates them: an online
 * meeting is pink, an in-person one yellow. Full literal class strings so
 * Tailwind's JIT keeps them.
 */
const CLIENT_MEETING_LOOK = {
  online: {
    key: 'meeting_online',
    pill: 'bg-pink-500/15 text-pink-900 border-pink-200',
    pillBar: 'bg-pink-500',
    block: 'bg-pink-500 text-white',
    accent: 'border-l-pink-500',
    card: 'border-pink-200 bg-pink-50/50',
    isMuted: false,
    isStruck: false,
  },
  offline: {
    key: 'meeting_offline',
    pill: 'bg-yellow-400/20 text-yellow-900 border-yellow-300',
    pillBar: 'bg-yellow-400',
    block: 'bg-yellow-400 text-yellow-950',
    accent: 'border-l-yellow-400',
    card: 'border-yellow-300 bg-yellow-50/70',
    isMuted: false,
    isStruck: false,
  },
};

export function isClientMeeting(event) {
  return event?.kind === 'client_meeting';
}

/** Primary line for a calendar event: candidate for interviews, client for meetings. */
export function eventPrimaryLabel(event, fallback = 'Interview') {
  if (isClientMeeting(event)) return event?.account_name || 'Client meeting';
  return event?.candidate_name || fallback;
}

/** Type line: the round label for interviews, the meeting mode for meetings. */
export function eventTypeLabel(event) {
  if (isClientMeeting(event)) {
    return event?.meeting_mode === 'offline' ? 'Client meeting · In person' : 'Client meeting · Online';
  }
  return roundTypeMeta(event?.round_type).label;
}

const AUDIENCE_LOOK = {
  internal: {
    pill: 'bg-sky-500/15 text-sky-900 border-sky-200',
    pillBar: 'bg-sky-500',
    block: 'bg-sky-500 text-white',
    accent: 'border-l-sky-500',
    card: 'border-sky-200 bg-sky-50/50',
  },
  external: {
    pill: 'bg-violet-500/15 text-violet-900 border-violet-200',
    pillBar: 'bg-violet-500',
    block: 'bg-violet-500 text-white',
    accent: 'border-l-violet-500',
    card: 'border-violet-200 bg-violet-50/50',
  },
};

// Full literal class strings so Tailwind's JIT keeps them.
const OUTCOME_LOOK = {
  pass: {
    key: 'pass',
    pill: 'bg-emerald-500/15 text-emerald-900 border-emerald-200',
    pillBar: 'bg-emerald-500',
    block: 'bg-emerald-500 text-white',
    accent: 'border-l-emerald-500',
    card: 'border-emerald-200 bg-emerald-50/50',
    isMuted: false,
    isStruck: false,
  },
  fail: {
    key: 'fail',
    pill: 'bg-rose-500/15 text-rose-900 border-rose-200',
    pillBar: 'bg-rose-500',
    block: 'bg-rose-500 text-white',
    accent: 'border-l-rose-500',
    card: 'border-rose-200 bg-rose-50/50',
    isMuted: false,
    isStruck: false,
  },
  no_show: {
    key: 'no_show',
    pill: 'bg-orange-500/15 text-orange-900 border-orange-200',
    pillBar: 'bg-orange-500',
    block: 'bg-orange-500 text-white',
    accent: 'border-l-orange-500',
    card: 'border-orange-200 bg-orange-50/50',
    isMuted: false,
    isStruck: false,
  },
  completed: {
    key: 'completed',
    pill: 'bg-teal-500/15 text-teal-900 border-teal-200',
    pillBar: 'bg-teal-500',
    block: 'bg-teal-500 text-white',
    accent: 'border-l-teal-500',
    card: 'border-teal-200 bg-teal-50/50',
    isMuted: false,
    isStruck: false,
  },
};

// Submission stages that mean "this candidate is out"; colour the slot as rejected.
const REJECTED_STAGES = ['rejected', 'backout'];

const CANCELLED_LOOK = {
  key: 'cancelled',
  pill: 'bg-slate-100 text-slate-500 border-slate-200 opacity-70',
  pillBar: 'bg-slate-400',
  block: 'bg-slate-300 text-slate-600 line-through opacity-70',
  accent: 'border-l-slate-400',
  card: 'border-slate-200 bg-slate-50 opacity-65',
  isMuted: true,
  isStruck: true,
};

/**
 * Resolve calendar appearance. The slot is coloured by outcome when there is one
 * (cancelled / rejected / did-not-join / passed / failed all supersede), else by
 * the interview category (internal / external).
 */
export function eventAppearance(event) {
  if (event?.status === 'cancelled') return CANCELLED_LOOK;
  if (isClientMeeting(event)) {
    return CLIENT_MEETING_LOOK[event.meeting_mode === 'offline' ? 'offline' : 'online'];
  }

  const audience = event ? eventAudience(event) : 'internal';
  const base = AUDIENCE_LOOK[audience] || AUDIENCE_LOOK.internal;

  if (event?.result === 'rescheduled') {
    return {
      key: 'rescheduled',
      pill: `${base.pill} opacity-70`,
      pillBar: base.pillBar,
      block: `${base.block} line-through opacity-60`,
      accent: base.accent,
      card: `${base.card} opacity-70`,
      isMuted: true,
      isStruck: true,
    };
  }

  if (REJECTED_STAGES.includes(event?.submission_stage)) return OUTCOME_LOOK.fail;
  if (event?.result && OUTCOME_LOOK[event.result]) return OUTCOME_LOOK[event.result];
  if (event?.status === 'completed') return OUTCOME_LOOK.completed;

  return { key: audience, ...base, isMuted: false, isStruck: false };
}

export function isEventStruck(event) {
  return eventAppearance(event).isStruck;
}

export function roundTypeMeta(type) {
  return ROUND_TYPES.find((t) => t.value === type) || ROUND_TYPES[0];
}

export function audienceForRoundType(roundType) {
  return roundTypeMeta(roundType).group === 'client' ? 'external' : 'internal';
}

export function eventAudience(event) {
  if (isClientMeeting(event)) return 'external';
  return event?.audience || audienceForRoundType(event?.round_type);
}

export function roundTypeLabel(type) {
  return roundTypeMeta(type).label;
}

export function roundTypeGroup(type) {
  return roundTypeMeta(type).group;
}

export function roundGroupBorder(type) {
  return ROUND_GROUP_BORDER[roundTypeGroup(type)] || 'border-l-tertiary-300';
}

export function resultColor(result) {
  return RESULT_COLORS[result] || RESULT_COLORS.pending;
}
