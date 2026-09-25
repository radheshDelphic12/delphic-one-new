import { useEffect, useState } from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
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
    setAttendeeIds((account?.meeting_attendees || []).map((a) => a.id));
  }, [open, account?.stage, preferredToStage]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(event) {
    event.preventDefault();
    const body = { to_stage: toStage };
    if (toStage === 'dropped') body.reason = reason.trim();
    if (toStage === 'meeting_scheduled') {
      body.meeting_mode = meetingMode;
      body.meeting_date = new Date(meetingDate).toISOString();
      if (meetingMode === 'offline') body.meeting_location = meetingLocation.trim();
      body.meeting_notes = meetingNotes.trim();
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
        {toStage === 'dropped' && (
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
