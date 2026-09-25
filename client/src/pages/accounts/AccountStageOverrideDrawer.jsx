import { useEffect, useState } from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
import AccountAttendeesPicker from './AccountAttendeesPicker.jsx';
import { ACCOUNT_ALL_STAGES, formatAccountValue } from './accountUtils.js';

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-tertiary-200 px-2.5 py-1.5 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100';

/**
 * Superadmin-only RHS drawer to force an account to any stage — including backward
 * moves and straight to `lead` — bypassing the normal transition map and the lock.
 *
 * Args:
 *   account: Account with at least id, stage, is_locked.
 *   open: Whether the drawer is visible.
 *   saving: Disable controls while the POST is in flight.
 *   onClose: Close handler.
 *   onMove: Called with the override body ({ to_stage, reason, is_locked, meeting_*? }).
 */
export default function AccountStageOverrideDrawer({ account, preferredToStage = '', open, saving, onClose, onMove }) {
  const [toStage, setToStage] = useState(preferredToStage || account?.stage || 'lead');
  const [reason, setReason] = useState('');
  const [isLocked, setIsLocked] = useState(Boolean(account?.is_locked));
  const [meetingMode, setMeetingMode] = useState('online');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  const [attendeeIds, setAttendeeIds] = useState([]);

  useEffect(() => {
    if (!open) return;
    setToStage(preferredToStage || account?.stage || 'lead');
    setReason('');
    setIsLocked(Boolean(account?.is_locked));
    setMeetingMode(account?.meeting_mode || 'online');
    setMeetingDate('');
    setMeetingLocation(account?.meeting_location || '');
    setMeetingNotes(account?.meeting_notes || '');
    setAttendeeIds((account?.meeting_attendees || []).map((a) => a.id));
  }, [open, account?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(event) {
    event.preventDefault();
    const body = { to_stage: toStage, reason: reason.trim(), is_locked: isLocked };
    if (toStage === 'meeting_scheduled') {
      body.meeting_mode = meetingMode;
      if (meetingDate) body.meeting_date = new Date(meetingDate).toISOString();
      if (meetingMode === 'offline' && meetingLocation.trim()) body.meeting_location = meetingLocation.trim();
      if (meetingNotes.trim()) body.meeting_notes = meetingNotes.trim();
      if (attendeeIds.length) body.meeting_attendee_ids = attendeeIds;
    }
    onMove(body);
  }

  if (!account) return null;

  return (
    <Drawer
      open={open}
      title="Override account stage"
      onClose={() => !saving && onClose()}
      size="sm"
      tone="edit"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" form="account-stage-override-form" disabled={saving || !toStage || !reason.trim()} className="btn-primary">
            {saving ? 'Applying…' : 'Apply override'}
          </button>
        </>
      }
    >
      <form id="account-stage-override-form" onSubmit={submit} className="space-y-3">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          Superadmin override - skips the normal transition rules and the lock. The move is recorded in stage history.
        </div>
        <p className="text-xs text-tertiary-500">Current stage: {formatAccountValue(account.stage)}</p>
        <label className="block text-xs font-medium text-tertiary-600">
          Target stage
          <select
            required
            value={toStage}
            onChange={(event) => setToStage(event.target.value)}
            className={`${INPUT_CLASS} capitalize`}
          >
            {ACCOUNT_ALL_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {formatAccountValue(stage)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Reason
          <textarea
            required
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={INPUT_CLASS}
            placeholder="Why this manual correction is needed"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-tertiary-600">
          <input type="checkbox" checked={isLocked} onChange={(event) => setIsLocked(event.target.checked)} />
          Keep record locked
        </label>
        {toStage === 'meeting_scheduled' && (
          <>
            <label className="block text-xs font-medium text-tertiary-600">
              Meeting mode
              <select value={meetingMode} onChange={(event) => setMeetingMode(event.target.value)} className={INPUT_CLASS}>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-tertiary-600">
              Meeting date and time
              <input
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
                  type="text"
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
                value={meetingNotes}
                onChange={(event) => setMeetingNotes(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <AccountAttendeesPicker open={open} value={attendeeIds} onChange={setAttendeeIds} />
          </>
        )}
      </form>
    </Drawer>
  );
}
