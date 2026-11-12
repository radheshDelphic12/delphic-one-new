import { useEffect, useState } from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
import apiClient from '../../lib/apiClient.js';
import AccountAttendeesPicker from './AccountAttendeesPicker.jsx';
import { ACCOUNT_TRANSITIONS, formatAccountValue } from './accountUtils.js';

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-tertiary-200 px-2.5 py-1.5 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100';

/**
 * RHS drawer to advance an account through allowed lead stages.
 *
 * Args:
 *   account: Account with at least id and stage.
 *   open: Whether the drawer is visible.
 *   saving: Disable controls while the stage POST is in flight.
 *   onClose: Close handler.
 *   onMove: Called with the stage-change body ({ to_stage, reason?, meeting_*? }).
 */
export default function AccountStageMoveDrawer({
  account,
  open,
  saving,
  onClose,
  onMove,
  preferredToStage = '',
}) {
  const stages = ACCOUNT_TRANSITIONS[account?.stage] || [];
  const [toStage, setToStage] = useState(stages[0] || '');
  const [reason, setReason] = useState('');
  const [meetingMode, setMeetingMode] = useState('online');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  const [duration, setDuration] = useState(60);
  const [attendeeIds, setAttendeeIds] = useState([]);

  useEffect(() => {
    if (!open) return;
    const preferred = preferredToStage && stages.includes(preferredToStage) ? preferredToStage : stages[0] || '';
    setToStage(preferred);
    setReason('');
    setMeetingMode('online');
    setMeetingDate('');
    setMeetingLocation('');
    setMeetingNotes(account?.meeting_notes || '');
    setDuration(account?.meeting_duration_minutes || 60);
    setAttendeeIds((account?.meeting_attendees || []).map((a) => a.id));
  }, [open, account?.stage, preferredToStage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dropping, and reactivating a dropped account, both need a reason (written to stage history).
  const needsReason = toStage === 'dropped' || account?.stage === 'dropped';
  // The projects still running under this client (GET /accounts/:id). Fetched here because the list and board rows do not carry it.
  const [fetchedProjects, setFetchedProjects] = useState([]);
  const accountId = account?.id;
  useEffect(() => {
    if (!open || !accountId) return undefined;
    let current = true;
    setFetchedProjects([]);
    apiClient.get(`/accounts/${accountId}`).then((r) => { if (current) setFetchedProjects(r.data.data?.live_projects || []); }).catch(() => {});
    return () => { current = false; };
  }, [open, accountId]);
  const liveProjects = fetchedProjects.length ? fetchedProjects : account?.live_projects || [];

  function submit(event) {
    event.preventDefault();
    const body = { to_stage: toStage };
    if (needsReason) body.reason = reason.trim();
    if (toStage === 'meeting_scheduled') {
      body.meeting_mode = meetingMode;
      body.meeting_date = new Date(meetingDate).toISOString();
      if (meetingMode === 'offline') body.meeting_location = meetingLocation.trim();
      body.meeting_notes = meetingNotes.trim();
      body.meeting_duration_minutes = Number(duration) || 60;
      body.meeting_attendee_ids = attendeeIds;
    }
    onMove(body);
  }

  if (!account) return null;

  return (
    <Drawer
      open={open}
      title="Move account stage"
      onClose={() => !saving && onClose()}
      size="sm"
      tone="edit"
      footer={
        <>
          <button type="button" form="account-stage-form" onClick={onClose} disabled={saving} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" form="account-stage-form" disabled={saving || !toStage} className="btn-primary">
            {saving ? 'Moving…' : 'Move stage'}
          </button>
        </>
      }
    >
      <form id="account-stage-form" onSubmit={submit} className="space-y-3">
        <p className="text-xs text-tertiary-500">Current stage: {formatAccountValue(account.stage)}</p>
        <label className="block text-xs font-medium text-tertiary-600">
          Next stage
          <select
            required
            value={toStage}
            onChange={(event) => setToStage(event.target.value)}
            className={`${INPUT_CLASS} capitalize`}
          >
            {stages.map((stage) => (
              <option key={stage} value={stage}>
                {formatAccountValue(stage)}
              </option>
            ))}
          </select>
        </label>
        {toStage === 'meeting_scheduled' && (
          <>
            <label className="block text-xs font-medium text-tertiary-600">
              Meeting mode
              <select
                required
                value={meetingMode}
                onChange={(event) => setMeetingMode(event.target.value)}
                className={INPUT_CLASS}
              >
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-tertiary-600">
              Meeting date and time
              <input
                required
                type="datetime-local"
                value={meetingDate}
                onChange={(event) => setMeetingDate(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block text-xs font-medium text-tertiary-600">
              Duration (minutes)
              <input
                type="number"
                min={5}
                max={1440}
                step={5}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            {meetingMode === 'offline' && (
              <label className="block text-xs font-medium text-tertiary-600">
                Meeting location
                <input
                  required
                  type="text"
                  placeholder="e.g. Client office, Sector 5"
                  value={meetingLocation}
                  onChange={(event) => setMeetingLocation(event.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
            )}
            <label className="block text-xs font-medium text-tertiary-600">
              Meeting notes
              <textarea
                rows={3}
                placeholder="Agenda, prep notes, or a summary after the meeting…"
                value={meetingNotes}
                onChange={(event) => setMeetingNotes(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <AccountAttendeesPicker open={open} value={attendeeIds} onChange={setAttendeeIds} />
          </>
        )}
        {toStage === 'dropped' && liveProjects.length > 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This client has {liveProjects.length} live project{liveProjects.length === 1 ? '' : 's'} (
            {liveProjects.map((p) => `${p.project_name}${p.project_code ? ` – ${p.project_code}` : ''}`).join(', ')}). Dropping the client only
            affects Sales; the projects keep billing. To stop a project, Finance marks it Completed / On hold.
          </p>
        )}
        {needsReason && (
          <label className="block text-xs font-medium text-tertiary-600">
            Reason
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        )}
      </form>
    </Drawer>
  );
}
