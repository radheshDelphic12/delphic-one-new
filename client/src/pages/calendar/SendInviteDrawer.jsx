import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import MultiSelectDropdown from '../../components/ui/MultiSelectDropdown.jsx';

function localInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaults() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  return { title: '', start: localInput(start), end: localInput(new Date(start.getTime() + 30 * 60000)), meeting_url: '', location: '', description: '', people: [], extra: '' };
}

/**
 * Team meeting invite: emails an .ics REQUEST to colleagues and/or external
 * addresses. Paste a Teams / Meet link and it is embedded in the invite.
 * Delivery goes through the server email outbox; without SMTP configured the
 * invite is recorded there as "skipped" instead of being sent.
 */
export default function SendInviteDrawer({ open, onClose }) {
  const { pushError, pushSuccess } = useAlerts();
  const [form, setForm] = useState(defaults);
  const [members, setMembers] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(defaults());
    apiClient.get('/orgs/memberships').then((res) => setMembers(res.data.data || [])).catch(() => setMembers([]));
  }, [open]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    const emails = form.extra.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
    setSaving(true);
    try {
      const res = await apiClient.post('/invites', {
        title: form.title,
        description: form.description || undefined,
        location: form.location || undefined,
        meeting_url: form.meeting_url || undefined,
        start: new Date(form.start).toISOString(),
        end: new Date(form.end).toISOString(),
        attendee_user_ids: form.people,
        attendee_emails: emails,
      });
      pushSuccess(`Invite queued for ${res.data.data.queued} attendee${res.data.data.queued === 1 ? '' : 's'}`);
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to send invite'), 'Could not send invite');
    } finally {
      setSaving(false);
    }
  }

  const options = members.map((m) => ({ id: m.person?.id, label: m.person?.name || 'Unknown', hint: m.person?.email })).filter((o) => o.id);

  return (
    <Drawer open={open} onClose={onClose} title="Send calendar invite" size="lg" tone="create" footer={<><button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" form="send-invite-form" className="btn-primary" disabled={saving}>{saving ? 'Sending...' : 'Send invite'}</button></>}>
      <form id="send-invite-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">Title<input required value={form.title} onChange={set('title')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Starts<input required type="datetime-local" value={form.start} onChange={set('start')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">Ends<input required type="datetime-local" value={form.end} min={form.start} onChange={set('end')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        </div>
        <label className="block text-xs font-medium text-tertiary-600">Teams / Meet link <span className="font-normal text-tertiary-400">(optional)</span><input type="url" value={form.meeting_url} onChange={set('meeting_url')} placeholder="https://teams.microsoft.com/l/meetup-join/..." className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        <label className="block text-xs font-medium text-tertiary-600">Location <span className="font-normal text-tertiary-400">(optional)</span><input value={form.location} onChange={set('location')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        <div>
          <span className="mb-1 block text-xs font-medium text-tertiary-600">Team members</span>
          <MultiSelectDropdown value={form.people} onChange={(people) => setForm((f) => ({ ...f, people }))} options={options} placeholder="Invite colleagues" searchPlaceholder="Search people" />
        </div>
        <label className="block text-xs font-medium text-tertiary-600">External emails <span className="font-normal text-tertiary-400">(comma or space separated)</span><textarea rows={2} value={form.extra} onChange={set('extra')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        <label className="block text-xs font-medium text-tertiary-600">Agenda <span className="font-normal text-tertiary-400">(optional)</span><textarea rows={3} value={form.description} onChange={set('description')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        <p className="text-xs text-tertiary-500">Attendees receive an .ics invite that adds to Outlook, Teams, Google or Apple Calendar.</p>
      </form>
    </Drawer>
  );
}
