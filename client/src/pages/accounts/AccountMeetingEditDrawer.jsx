import { useEffect, useState } from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
import FormActionsBar from '../../components/ui/FormActionsBar.jsx';
import AccountAttendeesPicker from './AccountAttendeesPicker.jsx';

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-tertiary-200 px-2.5 py-1.5 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100';

/** `Date` -> the value a `datetime-local` input expects, in local time. */
function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * RHS drawer to edit an account's meeting details (mode / date / location /
 * notes / attendees) — with no stage change. Unlike `AccountStageMoveDrawer`
 * (which only sets these fields while transitioning INTO `meeting_scheduled`),
 * this stays available for as long as the account has a meeting on record, so
 * a wrong attendee list or a corrected time can be fixed after the fact.
 *
 * Args:
 *   account: Account with meeting_* fields (+ id, is_locked).
 *   open, saving, onClose: standard drawer controls.
 *   onSave: called with the meeting body ({ meeting_mode, meeting_date, meeting_location?, meeting_notes?, meeting_attendee_ids }).
 */
export default function AccountMeetingEditDrawer({ account, open, saving, onClose, onSave }) {
  const [meetingMode, setMeetingMode] = useState('online');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  const [attendeeIds, setAttendeeIds] = useState([]);

  useEffect(() => {
    if (!open) return;
    setMeetingMode(account?.meeting_mode || 'online');
    setMeetingDate(toLocalInputValue(account?.meeting_date));
    setMeetingLocation(account?.meeting_location || '');
    setMeetingNotes(account?.meeting_notes || '');
    setAttendeeIds((account?.meeting_attendees || []).map((a) => a.id));
  }, [open, account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(event) {
    event.preventDefault();
    onSave({
      meeting_mode: meetingMode,
      meeting_date: new Date(meetingDate).toISOString(),
      meeting_location: meetingMode === 'offline' ? meetingLocation.trim() : undefined,
      meeting_notes: meetingNotes.trim(),
      meeting_attendee_ids: attendeeIds,
    });
  }

  if (!account) return null;

  return (
    <Drawer open={open} title="Edit meeting details" onClose={() => !saving && onClose()} size="sm" tone="edit">
      <form id="account-meeting-form" onSubmit={submit} className="space-y-3">
        <FormActionsBar>
          <button type="submit" form="account-meeting-form" disabled={saving || !meetingDate} className="btn-primary">
            {saving ? 'Saving…' : 'Save meeting'}
          </button>
        </FormActionsBar>
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
      </form>
    </Drawer>
  );
}
