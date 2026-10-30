/**
 * Notification event catalog.
 *
 * ROLE_EVENT_MATRIX declares, per NotificationType, which roles are eligible by
 * default and whether in-app delivery is on by default. It is a coarse eligibility
 * gate — the per-event recipient resolvers in recipients.js already target specific
 * users. A user with no NotificationPreference row falls back to the matrix default;
 * a row overrides it. The preferences UI shows a user only the types whose `roles`
 * list includes their role.
 *
 * ADMINS ARE EXEMPT FROM THIS GATE: dispatch.notify() folds every active admin
 * into the recipients of every event, whatever the `roles` list says. They are
 * still dropped when they are the actor, and can still mute a type for themselves
 * via NotificationPreference. `admin` therefore appears in every `roles` list here
 * only so the preferences UI offers admins the full set of toggles.
 *
 * renderNotification(type, ctx) returns a channel-agnostic "envelope"
 * ({ title, body, entity_type, entity_id, metadata }). The in-app channel persists
 * it verbatim; a future email / MS Teams channel formats from the same shape.
 */

const ALL_ROLES = ['bda', 'sales', 'recruiter', 'admin'];
// Timesheet events reach every kind of employee, including the low-privilege
// `employee` role that has no recruitment events.
const TIMESHEET_ROLES = ['employee', 'bda', 'sales', 'recruiter', 'admin'];

const ROLE_EVENT_MATRIX = {
  account_activated: { roles: ['bda', 'sales', 'admin'], defaultInApp: true },
  requirement_created: { roles: ['bda', 'sales', 'admin'], defaultInApp: true },
  requirement_assigned: { roles: ['recruiter', 'sales', 'admin'], defaultInApp: true },
  requirement_unassigned: { roles: ['recruiter', 'sales', 'admin'], defaultInApp: true },
  requirement_status_changed: { roles: ALL_ROLES, defaultInApp: true },
  interview_scheduled: { roles: ALL_ROLES, defaultInApp: true, defaultEmail: true },
  interview_rescheduled: { roles: ALL_ROLES, defaultInApp: true, defaultEmail: true },
  interview_cancelled: { roles: ALL_ROLES, defaultInApp: true, defaultEmail: true },
  interview_reminder: { roles: ALL_ROLES, defaultInApp: true, defaultEmail: true },
  interview_feedback_submitted: { roles: ['recruiter', 'sales', 'admin'], defaultInApp: true },
  candidate_submitted_to_client: { roles: ['sales', 'bda', 'admin'], defaultInApp: true },
  candidate_rejected: { roles: ['recruiter', 'sales', 'admin'], defaultInApp: true },
  candidate_backout: { roles: ['recruiter', 'sales', 'admin'], defaultInApp: true },
  candidate_offer: { roles: ['recruiter', 'sales', 'bda', 'admin'], defaultInApp: true, defaultEmail: true },
  candidate_closed: { roles: ['recruiter', 'sales', 'bda', 'admin'], defaultInApp: true },
  pm_ticket_assigned: { roles: TIMESHEET_ROLES, defaultInApp: true },
  pm_ticket_status_changed: { roles: TIMESHEET_ROLES, defaultInApp: true },
  pm_ticket_commented: { roles: TIMESHEET_ROLES, defaultInApp: true },
  pm_ticket_due_soon: { roles: TIMESHEET_ROLES, defaultInApp: true },
  timesheet_submitted: { roles: TIMESHEET_ROLES, defaultInApp: true },
  timesheet_entry_decided: { roles: TIMESHEET_ROLES, defaultInApp: true },
  timesheet_regularization_requested: { roles: TIMESHEET_ROLES, defaultInApp: true },
  timesheet_regularization_decided: { roles: TIMESHEET_ROLES, defaultInApp: true },
  // Sent only to Super Admin users (the job names them); the bell shows it until the reminder is decided.
  increment_review_due: { roles: ['admin'], defaultInApp: true },
  // To the person on the bench and the admins: days left on the bench.
  bench_countdown: { roles: ['admin', 'employee'], defaultInApp: true },
  // Resignations also go by email (HR and the Admin act on them, so the Admin is mailed too, unlike the copy-everything events).
  resignation_submitted: { roles: TIMESHEET_ROLES, defaultInApp: true, defaultEmail: true, defaultEmailAdmins: true },
  resignation_manager_updated: { roles: TIMESHEET_ROLES, defaultInApp: true, defaultEmail: true, defaultEmailAdmins: true },
  resignation_decided: { roles: TIMESHEET_ROLES, defaultInApp: true, defaultEmail: true },
  // Speak Up: written straight to the bell by the module (never by email, never with the subject or the reporter). Anyone can be a
  // handler or a reporter, so everyone lists them in their preferences, and the module honours a person's choice to mute them.
  whistleblower_new: { roles: TIMESHEET_ROLES, defaultInApp: true },
  whistleblower_update: { roles: TIMESHEET_ROLES, defaultInApp: true },
};

const NOTIFICATION_TYPES = Object.keys(ROLE_EVENT_MATRIX);

// Whether email is on for someone who has not set a preference. Admins are copied on every event (see above), so for them email
// is opt-in: otherwise an admin who never subscribed gets every interview mail in the company. They can still switch it on per event.
function defaultEmailFor(type, role) {
  const entry = ROLE_EVENT_MATRIX[type];
  return (role !== 'admin' || entry?.defaultEmailAdmins === true) && entry?.defaultEmail === true;
}

// One-line human labels + descriptions for the preferences UI.
const NOTIFICATION_LABELS = {
  account_activated: ['Account activated', 'A client account you own moves to Active.'],
  requirement_created: ['Requirement created', 'A new requirement is opened on an account you own.'],
  requirement_assigned: ['Assigned to a requirement', 'You are assigned to a requirement.'],
  requirement_unassigned: ['Removed from a requirement', 'You are unassigned from a requirement.'],
  requirement_status_changed: ['Requirement status changed', 'A requirement you are involved with changes status.'],
  interview_scheduled: ['Interview scheduled', 'An interview round is scheduled on a candidate you follow.'],
  interview_rescheduled: ['Interview rescheduled', 'An interview round’s time changes.'],
  interview_cancelled: ['Interview cancelled', 'An interview round is cancelled.'],
  interview_reminder: ['Interview reminder', 'A reminder before an interview you are on (T-24h and T-1h).'],
  interview_feedback_submitted: ['Interview feedback submitted', 'An interviewer records a result or feedback.'],
  candidate_submitted_to_client: ['Candidate submitted to client', 'A candidate is submitted to the client.'],
  candidate_rejected: ['Candidate rejected', 'A candidate is marked rejected.'],
  candidate_backout: ['Candidate backed out', 'A candidate backs out.'],
  candidate_offer: ['Offer sent', 'An offer is sent to a candidate.'],
  candidate_closed: ['Ticket closed', 'A candidate ticket is closed (BGV cleared, candidate joined).'],
  pm_ticket_assigned: ['Project ticket assigned', 'A project ticket is assigned to you.'],
  pm_ticket_status_changed: ['Project ticket status changed', 'The status of a project ticket you raised or work on changes.'],
  pm_ticket_commented: ['Project ticket comment', 'Someone comments on a project ticket you raised or work on.'],
  pm_ticket_due_soon: ['Project ticket due soon', 'A project ticket assigned to you is due today or tomorrow.'],
  timesheet_submitted: ['Timesheet submitted', 'A direct report submits timesheet hours for your approval.'],
  timesheet_entry_decided: ['Timesheet decision', 'Your manager approves or rejects a timesheet entry.'],
  timesheet_regularization_requested: ['Regularisation requested', 'A direct report asks to regularise a locked timesheet day.'],
  timesheet_regularization_decided: ['Regularisation decision', 'Your regularisation request is approved or rejected.'],
  whistleblower_new: ['Speak Up: new complaint', 'A complaint is raised or assigned to you as a handler.'],
  whistleblower_update: ['Speak Up: update', 'A reply or a status change on a complaint.'],
  resignation_submitted: ['Resignation submitted', 'An employee submits a resignation (to their reporting manager, HR and admins).'],
  resignation_manager_updated: ['Resignation: manager update', 'A manager records the retention call on a resignation (to HR and admins).'],
  resignation_decided: ['Resignation decision', 'Your resignation is approved, rejected or closed as retained, or the F&F is started.'],
  bench_countdown: ['Bench countdown', "Days left of an employee's bench period."],
  increment_review_due: ['Increment review due', 'An employee completes another year with the company (an increment review is due).'],
};

function eventsForRole(role) {
  return NOTIFICATION_TYPES.filter((type) => ROLE_EVENT_MATRIX[type].roles.includes(role));
}

function truncate(str, max = 120) {
  if (!str) return '';
  const s = String(str);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function actorPrefix(ctx) {
  return ctx.actorName ? `${ctx.actorName} ` : '';
}

/**
 * @param {string} type NotificationType
 * @param {object} ctx  free-form context assembled at the call site
 * @returns {{ title: string, body: string, entity_type: string|null, entity_id: string|null, metadata: object }}
 */
function renderNotification(type, ctx = {}) {
  const account = ctx.accountName || 'an account';
  const accountSuffix = ctx.accountName ? ` (${ctx.accountName})` : '';
  const requirement = ctx.requirementTitle || 'a requirement';
  const candidate = ctx.candidateName || 'a candidate';
  const roundLabel = ctx.roundTypeLabel || 'Interview';
  const when = ctx.scheduledAtLabel || '';

  switch (type) {
    case 'account_activated':
      return envelope(
        'Account activated',
        `${actorPrefix(ctx)}moved ${account} to Active.`,
        'account', ctx.accountId, ctx
      );
    case 'requirement_created':
      return envelope(
        'New requirement',
        `${actorPrefix(ctx)}created "${truncate(requirement)}" on ${account}.`,
        'requirement', ctx.requirementId, ctx
      );
    case 'requirement_assigned':
      return envelope(
        'You were assigned to a requirement',
        `${actorPrefix(ctx)}assigned you to "${truncate(requirement)}"${accountSuffix}.`,
        'requirement', ctx.requirementId, ctx
      );
    case 'requirement_unassigned':
      return envelope(
        'You were removed from a requirement',
        `${actorPrefix(ctx)}unassigned you from "${truncate(requirement)}"${accountSuffix}.`,
        'requirement', ctx.requirementId, ctx
      );
    case 'requirement_status_changed':
      return envelope(
        'Requirement status changed',
        `${actorPrefix(ctx)}set "${truncate(requirement)}" to ${ctx.toStatus || 'a new status'}.`,
        'requirement', ctx.requirementId, ctx
      );
    case 'bench_countdown':
      return envelope(
        'Bench period ending',
        `${ctx.employeeName || 'An employee'} has ${Number(ctx.daysLeft) === 0 ? 'their last day' : `${ctx.daysLeft} day${Number(ctx.daysLeft) === 1 ? '' : 's'} left`} on the bench (ends ${ctx.endDate || 'soon'}).`,
        null, null, ctx
      );
    case 'increment_review_due':
      return envelope(
        'Increment review due',
        `${ctx.employeeName || 'An employee'} completes ${ctx.years || 1} year${Number(ctx.years) === 1 ? '' : 's'} on ${ctx.dueDate || 'today'}. An increment review is due; salary is not changed automatically.`,
        null, null, ctx
      );
    case 'interview_scheduled':
      return envelope(
        'Interview scheduled',
        `${roundLabel} for ${candidate}${when ? ` on ${when}` : ''} (${truncate(requirement)}).`,
        'interview_round', ctx.interviewRoundId, ctx
      );
    case 'interview_rescheduled':
      return envelope(
        'Interview rescheduled',
        `${roundLabel} for ${candidate} moved${when ? ` to ${when}` : ''} (${truncate(requirement)}).`,
        'interview_round', ctx.interviewRoundId, ctx
      );
    case 'interview_cancelled':
      return envelope(
        'Interview cancelled',
        `${roundLabel} for ${candidate} was cancelled${ctx.reason ? `: ${truncate(ctx.reason)}` : ''}.`,
        'interview_round', ctx.interviewRoundId, ctx
      );
    case 'interview_reminder':
      return envelope(
        'Upcoming interview',
        `${roundLabel} for ${candidate}${when ? ` ${when}` : ' soon'} (${truncate(requirement)}).`,
        'interview_round', ctx.interviewRoundId, ctx
      );
    case 'interview_feedback_submitted':
      return envelope(
        'Interview feedback submitted',
        `${actorPrefix(ctx)}recorded ${ctx.result || 'feedback'} for ${candidate} — ${roundLabel}.`,
        'interview_round', ctx.interviewRoundId, ctx
      );
    case 'candidate_submitted_to_client':
      return envelope(
        'Candidate submitted to client',
        `${actorPrefix(ctx)}submitted ${candidate} to ${account} for "${truncate(requirement)}".`,
        'submission', ctx.submissionId, ctx
      );
    case 'candidate_rejected':
      return envelope(
        'Candidate rejected',
        `${candidate} was rejected on "${truncate(requirement)}"${ctx.reason ? `: ${truncate(ctx.reason)}` : ''}.`,
        'submission', ctx.submissionId, ctx
      );
    case 'candidate_backout':
      return envelope(
        'Candidate backed out',
        `${candidate} backed out on "${truncate(requirement)}"${ctx.reason ? `: ${truncate(ctx.reason)}` : ''}.`,
        'submission', ctx.submissionId, ctx
      );
    case 'candidate_offer':
      return envelope(
        'Offer sent',
        `${actorPrefix(ctx)}sent an offer to ${candidate} for "${truncate(requirement)}" (${account}).`,
        'submission', ctx.submissionId, ctx
      );
    case 'candidate_closed':
      return envelope(
        'Ticket closed',
        `${actorPrefix(ctx)}closed the ticket for ${candidate} on "${truncate(requirement)}" (${account}).`,
        'submission', ctx.submissionId, ctx
      );
    case 'resignation_submitted':
      return envelope('Resignation submitted', `${ctx.employeeName || 'An employee'} has resigned (proposed last working day ${ctx.lwd || 'not set'}).`, 'resignation', ctx.resignationId, ctx);
    case 'resignation_manager_updated':
      return envelope('Resignation: manager update', `${ctx.managerName || 'The manager'} updated the retention call for ${ctx.employeeName || 'an employee'}: ${ctx.outcomeLabel || 'update recorded'}.`, 'resignation', ctx.resignationId, ctx);
    case 'whistleblower_new':
    case 'whistleblower_update':
      return envelope(ctx.title || 'Speak Up', ctx.body || '', 'whistle_case', ctx.caseId, ctx);
    case 'resignation_decided':
      return envelope('Resignation update', ctx.message || 'Your resignation request was updated.', 'resignation', ctx.resignationId, ctx);
    case 'pm_ticket_assigned':
      return envelope(
        'Project ticket assigned',
        `${actorPrefix(ctx)}assigned you #${ctx.ticketNumber} "${truncate(ctx.ticketTitle)}" in ${ctx.projectCode} ${ctx.projectName || ''}.`.replace(/\s+\./, '.'),
        'pm_ticket', ctx.ticketId, ctx
      );
    case 'pm_ticket_status_changed':
      return envelope(
        'Project ticket status changed',
        `${actorPrefix(ctx)}moved #${ctx.ticketNumber} "${truncate(ctx.ticketTitle)}" (${ctx.projectCode}) to ${ctx.statusLabel || 'a new status'}.`,
        'pm_ticket', ctx.ticketId, ctx
      );
    case 'pm_ticket_commented':
      return envelope(
        'New comment on a project ticket',
        `${actorPrefix(ctx)}commented on #${ctx.ticketNumber} "${truncate(ctx.ticketTitle)}" (${ctx.projectCode})${ctx.comment ? `: ${truncate(ctx.comment)}` : '.'}`,
        'pm_ticket', ctx.ticketId, ctx
      );
    case 'pm_ticket_due_soon':
      return envelope(
        'Project ticket due soon',
        `#${ctx.ticketNumber} "${truncate(ctx.ticketTitle)}" (${ctx.projectCode}) is due ${ctx.dueLabel || 'soon'}.`,
        'pm_ticket', ctx.ticketId, ctx
      );
    case 'timesheet_submitted':
      return envelope(
        'Timesheet awaiting approval',
        `${ctx.employeeName || 'An employee'} logged ${ctx.hours ?? ''}h${ctx.dateLabel ? ` for ${ctx.dateLabel}` : ''}${ctx.accountName ? ` on ${ctx.accountName}` : ''}.`,
        null, null, ctx
      );
    case 'timesheet_entry_decided':
      return envelope(
        `Timesheet ${ctx.status || 'reviewed'}`,
        `Your ${ctx.hours ?? ''}h entry${ctx.dateLabel ? ` for ${ctx.dateLabel}` : ''} was ${ctx.status || 'reviewed'}${ctx.reason ? `: ${truncate(ctx.reason)}` : '.'}`,
        null, null, ctx
      );
    case 'timesheet_regularization_requested':
      return envelope(
        'Regularisation request',
        `${ctx.employeeName || 'An employee'} asked to regularise ${ctx.hours ?? ''}h${ctx.dateLabel ? ` on ${ctx.dateLabel}` : ''}${ctx.reason ? ` — ${truncate(ctx.reason)}` : ''}.`,
        null, null, ctx
      );
    case 'timesheet_regularization_decided':
      return envelope(
        `Regularisation ${ctx.status || 'reviewed'}`,
        `Your request for${ctx.dateLabel ? ` ${ctx.dateLabel}` : ' a locked day'} was ${ctx.status || 'reviewed'}${ctx.reason ? `: ${truncate(ctx.reason)}` : '.'}`,
        null, null, ctx
      );
    default:
      return envelope('Notification', 'You have a new notification.', null, null, ctx);
  }
}

function envelope(title, body, entity_type, entity_id, ctx) {
  const metadata = { ...(ctx.metadata || {}) };
  if (ctx.submissionId && entity_type === 'interview_round') metadata.submission_id = ctx.submissionId;
  return { title, body, entity_type: entity_type || null, entity_id: entity_id || null, metadata };
}

module.exports = {
  ROLE_EVENT_MATRIX,
  NOTIFICATION_TYPES,
  NOTIFICATION_LABELS,
  eventsForRole,
  defaultEmailFor,
  renderNotification,
};
