import { useCallback, useEffect, useState } from 'react';
import { FileClock } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import Drawer from '../../components/ui/Drawer.jsx';

const STATUSES = [
  ['present', 'Present'],
  ['half_day', 'Half day'],
  ['wfh', 'Work from home'],
  ['absent', 'Absent'],
  ['leave', 'Leave'],
];
const TIMED = new Set(['present', 'half_day', 'wfh']);
const todayIso = () => new Date().toISOString().slice(0, 10);

function RequestDrawer({ open, onClose, onSubmitted }) {
  const { pushError, pushSuccess } = useAlerts();
  const [fields, setFields] = useState({ date: '', status: 'present', check_in_time: '', check_out_time: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setFields((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (open) setFields({ date: '', status: 'present', check_in_time: '', check_out_time: '', reason: '' });
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const timed = TIMED.has(fields.status);
      await apiClient.post('/attendance/regularization-requests', {
        date: fields.date,
        status: fields.status,
        reason: fields.reason.trim(),
        ...(timed && fields.check_in_time ? { check_in_time: fields.check_in_time } : {}),
        ...(timed && fields.check_out_time ? { check_out_time: fields.check_out_time } : {}),
      });
      pushSuccess('Request sent. An admin will review it.');
      onSubmitted();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not send the request'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const timed = TIMED.has(fields.status);
  return (
    <Drawer
      open={open}
      title="Request an attendance correction"
      onClose={onClose}
      size="sm"
      tone="edit"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="attendance-regularization" className="btn-primary" disabled={saving || !fields.date || fields.reason.trim().length < 3}>
            {saving ? 'Sending…' : 'Send request'}
          </button>
        </div>
      )}
    >
      <form id="attendance-regularization" onSubmit={submit} className="space-y-4">
        <p className="text-xs text-tertiary-500">Use this when your attendance for a past day is missing or wrong (for example you forgot to punch). Your admin reviews it; nothing changes until it is approved.</p>
        <label className="block text-xs font-medium text-tertiary-600">Date
          <input type="date" required max={todayIso()} value={fields.date} onChange={(e) => set('date', e.target.value)} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs font-medium text-tertiary-600">What it should be
          <select value={fields.status} onChange={(e) => set('status', e.target.value)} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm">
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {timed && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-tertiary-600">Check-in time (optional)
              <input type="time" value={fields.check_in_time} onChange={(e) => set('check_in_time', e.target.value)} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs font-medium text-tertiary-600">Check-out time (optional)
              <input type="time" value={fields.check_out_time} onChange={(e) => set('check_out_time', e.target.value)} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm" />
            </label>
          </div>
        )}
        <label className="block text-xs font-medium text-tertiary-600">Reason
          <textarea required rows={3} maxLength={500} value={fields.reason} onChange={(e) => set('reason', e.target.value)} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm" placeholder="Why does this day need correcting?" />
        </label>
      </form>
    </Drawer>
  );
}

/** Attendance → My attendance: ask an admin to correct a past day, and follow the request. */
export default function AttendanceRegularizationRequests() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    apiClient.get('/attendance/regularization-requests/mine').then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Could not load your requests'), 'Something went wrong'));
  }, [pushError]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-heading text-base font-semibold text-tertiary-900"><FileClock className="h-4 w-4" /> Attendance corrections</h3>
          <p className="text-xs text-tertiary-500">Missing or wrong attendance on a past day? Ask your admin to correct it.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Request a correction</button>
      </div>
      {rows.length > 0 && (
        <ul className="mt-3 divide-y divide-tertiary-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <b className="text-tertiary-900">{r.date}</b> to <span className="capitalize">{r.requested_status.replace('_', ' ')}</span>
                {r.check_in_time ? ` (${r.check_in_time}${r.check_out_time ? ` - ${r.check_out_time}` : ''})` : ''}
                <span className="block text-xs text-tertiary-500">{r.reason}{r.decision_reason ? ` · Admin: ${r.decision_reason}` : ''}</span>
              </span>
              <Badge value={r.status} />
            </li>
          ))}
        </ul>
      )}
      <RequestDrawer open={open} onClose={() => setOpen(false)} onSubmitted={() => { setOpen(false); load(); }} />
    </section>
  );
}
