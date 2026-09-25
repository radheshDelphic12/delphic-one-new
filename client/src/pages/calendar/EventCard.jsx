import { Link } from 'react-router-dom';
import { CalendarX, ExternalLink, RefreshCw } from 'lucide-react';
import Badge from '../../components/ui/Badge.jsx';
import AvatarStack from '../../components/ui/AvatarStack.jsx';
import {
  eventAppearance,
  eventPrimaryLabel,
  eventTypeLabel,
  hasSubmittedFeedback,
  isClientMeeting,
  roundTypeMeta,
} from '../../lib/interviewRounds.js';
import { formatRelative } from '../../lib/notifications/notificationLinks.js';
import { formatTimeRange } from './monthGrid.js';

/**
 * Agenda-view event row. Status colors; cancelled / rescheduled are dull + struck.
 */
export default function EventCard({ event, onOpenDetail, onFeedback, onCancel }) {
  const look = eventAppearance(event);
  const meeting = isClientMeeting(event);
  const cancelled = event.status === 'cancelled';
  const rescheduled = event.result === 'rescheduled';
  const meta = roundTypeMeta(event.round_type);
  const typeLabel = eventTypeLabel(event);
  const primaryTo = meeting ? `/accounts/${event.account_id}` : `/submissions/${event.submission_id}`;
  const nowMs = new Date().getTime();
  const isPastStart = event.scheduled_at && new Date(event.scheduled_at).getTime() <= nowMs;
  const isFuture = event.scheduled_at && new Date(event.scheduled_at).getTime() > nowMs;
  const live = !cancelled && !rescheduled;
  const feedbackDone = hasSubmittedFeedback(event);
  // Client meetings carry no interview actions (feedback / cancel / reschedule).
  const canFeedback = !meeting && event.can_submit_feedback && live && (isPastStart || feedbackDone);
  // Cancel / Reschedule are offered to every role; the server enforces who may
  // actually do it (manager / scheduler) and 403s otherwise.
  const canCancel = !meeting && live && isFuture;
  const canReschedule = !meeting && live && event.status !== 'completed';

  return (
    <div className={`hover-zoom relative rounded-2xl border p-4 shadow-card ${look.card}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`font-heading text-sm font-semibold text-tertiary-900 ${look.isStruck ? 'line-through text-tertiary-500' : ''}`}>
          {formatTimeRange(event.scheduled_at, event.duration_minutes)}
        </span>
        <span className={`rounded-full border px-2 py-0.5 ${meeting ? look.pill : meta.color}`}>{typeLabel}</span>
        <Badge value={event.status} />
        {event.result && event.result !== 'pending' && <Badge value={event.result} />}
        <span className="ml-auto text-tertiary-400">{formatRelative(event.scheduled_at)}</span>
      </div>

      <div className={`mt-2 text-sm ${look.isStruck ? 'line-through text-tertiary-500' : ''}`}>
        <Link
          to={primaryTo}
          className={`font-semibold hover:underline ${look.isStruck ? 'text-tertiary-500' : 'text-primary-700'}`}
        >
          {eventPrimaryLabel(event, 'Candidate')}
        </Link>
        <span className="text-tertiary-500">
          {meeting && event.meeting_location ? ` · ${event.meeting_location}` : ''}
          {event.requirement_id ? (
            <>
              {' · '}
              <Link
                to={`/requirements/${event.requirement_id}`}
                className={`hover:underline ${look.isStruck ? 'text-tertiary-500' : 'text-primary-700'}`}
              >
                {event.requirement_title || 'requirement'}
              </Link>
            </>
          ) : event.requirement_title ? (
            ` · ${event.requirement_title}`
          ) : (
            ''
          )}
          {!meeting && event.account_name ? ` · ${event.account_name}` : ''}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {event.interviewers?.length > 0 ? (
          <AvatarStack people={event.interviewers} max={5} />
        ) : event.interviewer_name ? (
          <span className="text-xs text-tertiary-500">{event.interviewer_name}</span>
        ) : (
          <span className="text-xs text-tertiary-400">No interviewer</span>
        )}
        {event.meeting_link && !cancelled && !rescheduled && (
          <a
            href={event.meeting_link}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-xs"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Join
          </a>
        )}
      </div>

      {cancelled && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-tertiary-100 px-3 py-2 text-xs text-tertiary-600">
          <CalendarX className="h-3.5 w-3.5" />
          Cancelled{event.cancellation_reason ? `: ${event.cancellation_reason}` : ''}
        </div>
      )}
      {rescheduled && !cancelled && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800">
          <RefreshCw className="h-3.5 w-3.5" />
          Rescheduled
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={() => onOpenDetail(event)}>
          Open details
        </button>
        {canFeedback && (
          <button type="button" className="btn-secondary text-xs" onClick={() => onFeedback(event)}>
            {feedbackDone ? 'Review feedback' : 'Submit feedback'}
          </button>
        )}
        {canReschedule && (
          <button type="button" className="btn-ghost text-xs" onClick={() => onOpenDetail(event)}>
            Reschedule
          </button>
        )}
        {canCancel && (
          <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => onCancel(event)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
