import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Check, Pencil, Trash2, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import FormActionsBar from '../../components/ui/FormActionsBar.jsx';
import AccountAttendeesPicker from './AccountAttendeesPicker.jsx';
import { apiErrorMessage } from './accountUtils.js';

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-tertiary-200 px-2.5 py-1.5 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100';

const STATUS_LOOK = {
  scheduled: 'bg-sky-100 text-sky-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-tertiary-100 text-tertiary-500 line-through',
};

function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Schedule / edit one extra meeting. `meeting` null = new. */
function ClientMeetingDrawer({ meeting, open, saving, onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState('online');
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState('');
  const [link, setLink] = useState('');
  const [notes, setNotes] = useState('');
  const [attendeeIds, setAttendeeIds] = useState([]);

  useEffect(() => {
    if (!open) return;
    setTitle(meeting?.title || '');
    setMode(meeting?.mode || 'online');
    setWhen(toLocalInputValue(meeting?.scheduled_at));
    setDuration(meeting?.duration_minutes || 60);
    setLocation(meeting?.location || '');
    setLink(meeting?.link || '');
    setNotes(meeting?.notes || '');
    setAttendeeIds((meeting?.attendees || []).map((a) => a.id));
  }, [open, meeting?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(event) {
    event.preventDefault();
    onSave({
      title: title.trim(),
      mode,
      scheduled_at: new Date(when).toISOString(),
      duration_minutes: Number(duration) || 60,
      location: mode === 'offline' ? location.trim() : undefined,
      link: mode === 'online' ? link.trim() : undefined,
      notes: notes.trim(),
      attendee_ids: attendeeIds,
    });
  }

  return (
    <Drawer open={open} title={meeting ? 'Edit meeting' : 'Schedule a meeting'} onClose={() => !saving && onClose()} size="sm" tone={meeting ? 'edit' : undefined}>
      <form id="client-meeting-form" onSubmit={submit} className="space-y-3">
        <FormActionsBar>
          <button type="submit" form="client-meeting-form" disabled={saving || !title.trim() || !when} className="btn-primary">
            {saving ? 'Saving…' : meeting ? 'Save meeting' : 'Schedule meeting'}
          </button>
        </FormActionsBar>
        <label className="block text-xs font-medium text-tertiary-600">
          Title
          <input required type="text" maxLength={200} placeholder="e.g. Quarterly review, Contract renewal" value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLASS} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={INPUT_CLASS}>
              <option value="online">Online</option>
              <option value="offline">In person</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Duration (minutes)
            <input type="number" min={5} max={1440} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} className={INPUT_CLASS} />
          </label>
        </div>
        <label className="block text-xs font-medium text-tertiary-600">
          Date and time
          <input required type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={INPUT_CLASS} />
        </label>
        {mode === 'offline' ? (
          <label className="block text-xs font-medium text-tertiary-600">
            Location
            <input required type="text" placeholder="e.g. Client office, Sector 5" value={location} onChange={(e) => setLocation(e.target.value)} className={INPUT_CLASS} />
          </label>
        ) : (
          <label className="block text-xs font-medium text-tertiary-600">
            Meeting link (optional)
            <input type="url" placeholder="https://meet.google.com/…" value={link} onChange={(e) => setLink(e.target.value)} className={INPUT_CLASS} />
          </label>
        )}
        <label className="block text-xs font-medium text-tertiary-600">
          Notes
          <textarea rows={3} placeholder="Agenda, or a summary after the meeting…" value={notes} onChange={(e) => setNotes(e.target.value)} className={INPUT_CLASS} />
        </label>
        <AccountAttendeesPicker open={open} value={attendeeIds} onChange={setAttendeeIds} />
      </form>
    </Drawer>
  );
}

/**
 * Extra meetings with an active client / vendor. Tracking only: they never change the account
 * stage, and they show on the Calendar. Shown for active accounts; `canMutate` gates the actions.
 */
export default function AccountClientMeetings({ account, canMutate }) {
  const { pushError, pushSuccess } = useAlerts();
  const [meetings, setMeetings] = useState(null);
  const [drawer, setDrawer] = useState({ open: false, meeting: null });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get(`/accounts/${account.id}/meetings`);
      setMeetings(data.data || []);
    } catch (error) {
      setMeetings([]);
      pushError(apiErrorMessage(error, 'Failed to load meetings'), 'Something went wrong');
    }
  }, [account.id, pushError]);

  useEffect(() => { load(); }, [load]);

  async function save(body) {
    setSaving(true);
    try {
      if (drawer.meeting) await apiClient.patch(`/accounts/${account.id}/meetings/${drawer.meeting.id}`, body);
      else await apiClient.post(`/accounts/${account.id}/meetings`, body);
      pushSuccess(drawer.meeting ? 'Meeting updated' : 'Meeting scheduled');
      setDrawer({ open: false, meeting: null });
      await load();
    } catch (error) {
      pushError(apiErrorMessage(error, 'Failed to save the meeting'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(meeting, status) {
    try {
      await apiClient.patch(`/accounts/${account.id}/meetings/${meeting.id}`, { status });
      await load();
    } catch (error) {
      pushError(apiErrorMessage(error, 'Failed to update the meeting'), 'Something went wrong');
    }
  }

  async function remove(meeting) {
    if (!window.confirm(`Delete the meeting "${meeting.title}"?`)) return;
    try {
      await apiClient.delete(`/accounts/${account.id}/meetings/${meeting.id}`);
      await load();
    } catch (error) {
      pushError(apiErrorMessage(error, 'Failed to delete the meeting'), 'Something went wrong');
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-tertiary-200 bg-white" aria-label="Meetings">
      <div className="flex items-center justify-between gap-2 border-b border-tertiary-100 bg-tertiary-50/60 px-3.5 py-2.5">
        <div>
          <h2 className="font-heading text-sm font-semibold tracking-tight text-tertiary-900">Meetings</h2>
          <p className="text-xs text-tertiary-500">Track extra meetings with this {account.type === 'vendor' ? 'vendor' : 'client'}. They show on the calendar and don&apos;t change the stage.</p>
        </div>
        {canMutate && (
          <button type="button" className="btn-secondary shrink-0" onClick={() => setDrawer({ open: true, meeting: null })}>
            <CalendarPlus className="h-4 w-4" /> Schedule meeting
          </button>
        )}
      </div>
      <div className="p-3.5">
        {meetings === null ? (
          <p className="text-sm text-tertiary-500">Loading…</p>
        ) : meetings.length === 0 ? (
          <p className="text-sm text-tertiary-500">No meetings tracked yet.</p>
        ) : (
          <ul className="divide-y divide-tertiary-100">
            {meetings.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-tertiary-900">
                    {m.title}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_LOOK[m.status]}`}>{m.status}</span>
                  </p>
                  <p className="text-xs text-tertiary-600">
                    {new Date(m.scheduled_at).toLocaleString()} · {m.duration_minutes} min · {m.mode === 'offline' ? `In person${m.location ? ` — ${m.location}` : ''}` : 'Online'}
                    {m.link && <> · <a href={m.link} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">Join link</a></>}
                  </p>
                  {m.attendees.length > 0 && <p className="mt-0.5 text-xs text-tertiary-500">With: {m.attendees.map((a) => a.name).join(', ')}</p>}
                  {m.notes && <p className="mt-0.5 whitespace-pre-wrap text-xs text-tertiary-500">{m.notes}</p>}
                </div>
                {canMutate && (
                  <div className="flex shrink-0 items-center gap-1">
                    {m.status === 'scheduled' && (
                      <button type="button" className="btn-ghost text-xs" title="Mark as done" onClick={() => setStatus(m, 'completed')}><Check className="h-3.5 w-3.5" />Done</button>
                    )}
                    {m.status === 'scheduled' && (
                      <button type="button" className="btn-ghost text-xs" title="Cancel meeting" onClick={() => setStatus(m, 'cancelled')}><X className="h-3.5 w-3.5" />Cancel</button>
                    )}
                    {m.status !== 'scheduled' && (
                      <button type="button" className="btn-ghost text-xs" onClick={() => setStatus(m, 'scheduled')}>Reopen</button>
                    )}
                    <button type="button" className="btn-ghost text-xs" onClick={() => setDrawer({ open: true, meeting: m })}><Pencil className="h-3.5 w-3.5" />Edit</button>
                    <button type="button" className="btn-ghost text-xs text-error-600" onClick={() => remove(m)}><Trash2 className="h-3.5 w-3.5" />Delete</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ClientMeetingDrawer meeting={drawer.meeting} open={drawer.open} saving={saving} onClose={() => setDrawer({ open: false, meeting: null })} onSave={save} />
    </section>
  );
}
