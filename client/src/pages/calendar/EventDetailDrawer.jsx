import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, UserX } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Badge from '../../components/ui/Badge.jsx';
import AvatarStack from '../../components/ui/AvatarStack.jsx';
import {
  audienceForRoundType,
  eventTypeLabel,
  hasSubmittedFeedback,
  isClientMeeting,
} from '../../lib/interviewRounds.js';
import { formatTimeRange } from './monthGrid.js';

function Row({ label, children }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-tertiary-400">{label}</span>
      <span className="min-w-0 flex-1 text-tertiary-700">{children}</span>
    </div>
  );
}

/** Full event view + feedback / cancel / reschedule actions. */
export default function EventDetailDrawer({ event, open, onClose, onFeedback, onChanged }) {
  const { pushSuccess, pushError } = useAlerts();
  const [cancelReason, setCancelReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [nextWhen, setNextWhen] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !event) return;
    setCancelReason('');
    setConfirming(false);
    setRescheduling(false);
    setNextWhen('');
  }, [open, event]);

  if (!event) return null;
  const cancelled = event.status === 'cancelled';
  const meeting = isClientMeeting(event);
  const typeLabel = eventTypeLabel(event);
  const audience = event.audience || audienceForRoundType(event.round_type);
  const when = event.scheduled_at ? new Date(event.scheduled_at) : null;
  const nowMs = new Date().getTime();
  const isFuture = when && when.getTime() > nowMs;
  const isPastStart = when && when.getTime() <= nowMs;
  const feedbackDone = hasSubmittedFeedback(event);
  // Once feedback exists the assigned interviewer / manager can still open it to
  // review or amend — the CTA just changes label instead of disappearing.
  // Client meetings carry no interview actions (feedback / cancel / reschedule).
  const canFeedback = !meeting && event.can_submit_feedback && !cancelled && (isPastStart || feedbackDone);
  // Cancel / Reschedule are offered to every role; the server enforces who may
  // actually perform them and 403s otherwise.
  const canCancel = !meeting && !cancelled && isFuture;
  const canReschedule = !meeting && !cancelled && event.status !== 'completed' && event.result !== 'rescheduled';

  async function doCancel() {
    if (!cancelReason.trim()) {
      pushError('A cancellation reason is required');
      return;
    }
    setBusy(true);
    try {
      await apiClient.post(`/interviews/${event.id}/cancel`, { reason: cancelReason.trim() });
      pushSuccess('Interview cancelled');
      setConfirming(false);
      setCancelReason('');
      onClose();
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to cancel interview'));
    } finally {
      setBusy(false);
    }
  }

  async function doReschedule() {
    setBusy(true);
    try {
      // A new time is optional: with one, re-time the round; without one, just
      // flag it as needing a reschedule (a new slot can be set later).
      const body = nextWhen
        ? { scheduled_at: new Date(nextWhen).toISOString() }
        : { result: 'rescheduled' };
      await apiClient.patch(`/interview-rounds/${event.id}`, body);
      pushSuccess(nextWhen ? 'Interview rescheduled' : 'Marked for rescheduling');
      setRescheduling(false);
      onClose();
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to reschedule'));
    } finally {
      setBusy(false);
    }
  }

  async function markDidNotJoin() {
    setBusy(true);
    try {
      await apiClient.post(`/interviews/${event.id}/feedback`, {
        result: 'no_show',
        feedback: 'Candidate did not join',
      });
      pushSuccess('Marked as candidate did not join');
      onClose();
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update result'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={() => !busy && onClose()}
      tone={cancelled ? 'danger' : 'info'}
      size="md"
      title={`${typeLabel}${event.round_name ? `: ${event.round_name}` : ''}`}
    >
      <div className="space-y-4">
        {cancelled && (
          <div className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-700">
            Cancelled{event.cancellation_reason ? `: ${event.cancellation_reason}` : ''}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Badge value={audience} />
          <Badge value={event.status} />
          {event.result && event.result !== 'pending' ? <Badge value={event.result} /> : null}
        </div>

        <div>
          <Row label="When">
            {formatTimeRange(event.scheduled_at, event.duration_minutes)} ·{' '}
            {when?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Row>
          <Row label="Scheduled by">{event.scheduled_by?.name || 'Not recorded'}</Row>
          {meeting ? (
            <>
              <Row label="Mode">{event.meeting_mode === 'offline' ? 'In person' : 'Online'}</Row>
              {event.meeting_location && <Row label="Location">{event.meeting_location}</Row>}
            </>
          ) : (
            <>
              <Row label="Candidate">
                <Link to={`/submissions/${event.submission_id}`} className="text-primary-700 hover:underline" onClick={onClose}>
                  {event.candidate_name || 'Candidate'}
                </Link>
              </Row>
              <Row label="Requirement">
                {event.requirement_id ? (
                  <Link
                    to={`/requirements/${event.requirement_id}`}
                    className="text-primary-700 hover:underline"
                    onClick={onClose}
                  >
                    {event.requirement_title || 'View requirement'}
                  </Link>
                ) : (
                  event.requirement_title || 'Not set'
                )}
              </Row>
            </>
          )}
          <Row label={meeting ? 'Client' : 'Account'}>
            {meeting && event.account_id ? (
              <Link to={`/accounts/${event.account_id}`} className="text-primary-700 hover:underline" onClick={onClose}>
                {event.account_name || 'View client'}
              </Link>
            ) : (
              event.account_name || 'Not set'
            )}
          </Row>
          <Row label={meeting ? 'Attendees' : 'Interviewers'}>
            {event.interviewers?.length ? (
              <AvatarStack people={event.interviewers} max={6} />
            ) : (
              event.interviewer_name || 'Not set'
            )}
          </Row>
          {meeting && event.meeting_notes && <Row label="Notes">{event.meeting_notes}</Row>}
        </div>

        {event.meeting_link && !cancelled && (
          <a
            href={event.meeting_link}
            target="_blank"
            rel="noreferrer"
            className="btn-primary inline-flex w-full items-center justify-center gap-2 text-sm"
          >
            <ExternalLink className="h-4 w-4" /> Join meeting
          </a>
        )}

        {(event.feedback || event.rating != null) && (
          <div className="rounded-xl border border-tertiary-100 bg-tertiary-50/60 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-tertiary-400">Feedback</p>
            <p className="mt-1 flex items-center gap-2">
              <Badge value={event.result || 'pending'} />
              {event.rating != null && <span className="text-amber-700">★ {event.rating}</span>}
            </p>
            {event.feedback && <p className="mt-1.5 text-tertiary-600">{event.feedback}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-tertiary-100 pt-3">
          {canFeedback && (
            <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => onFeedback(event)}>
              {feedbackDone ? 'Review feedback' : 'Submit feedback'}
            </button>
          )}
          {canFeedback && !feedbackDone && event.result !== 'no_show' && (
            <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={markDidNotJoin}>
              <UserX className="h-3.5 w-3.5" /> Candidate did not join
            </button>
          )}
          {canReschedule && !rescheduling && (
            <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => setRescheduling(true)}>
              Reschedule
            </button>
          )}
          {canCancel && !confirming && (
            <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => setConfirming(true)}>
              Cancel interview
            </button>
          )}
        </div>

        {rescheduling && (
          <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-3">
            <label className="block text-xs font-medium text-primary-900">
              New date and time <span className="font-normal text-primary-700">(optional)</span>
              <input
                type="datetime-local"
                value={nextWhen}
                onChange={(e) => setNextWhen(e.target.value)}
                className="mt-1 w-full rounded-lg border border-primary-200 px-2 py-1.5 text-sm"
              />
            </label>
            <p className="mt-1 text-[11px] text-primary-700">
              Leave blank to just flag this interview for rescheduling; you can set a slot later.
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => setRescheduling(false)}>
                Back
              </button>
              <button type="button" className="btn-primary text-xs" disabled={busy} onClick={doReschedule}>
                {busy ? 'Saving…' : nextWhen ? 'Save new time' : 'Mark for rescheduling'}
              </button>
            </div>
          </div>
        )}

        {confirming && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 p-3">
            <label className="block text-xs font-medium text-danger-800">
              Cancellation reason
              <textarea
                rows={2}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-danger-200 px-2 py-1.5 text-sm"
              />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => setConfirming(false)}>
                Keep it
              </button>
              <button type="button" className="btn-primary bg-danger-600 text-xs" disabled={busy} onClick={doCancel}>
                {busy ? 'Cancelling…' : 'Confirm cancel'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
