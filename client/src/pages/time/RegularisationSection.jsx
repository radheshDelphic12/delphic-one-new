import { useCallback, useEffect, useState } from 'react';
import { FileClock } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useLeaveDay } from '../../lib/useLeaveDay.js';
import Badge from '../../components/ui/Badge.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import LeaveDayNotice from './LeaveDayNotice.jsx';

const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function RequestDrawer({ open, requireProject, projectOptions, onClose, onSubmitted }) {
  const { pushError, pushSuccess } = useAlerts();
  const [fields, setFields] = useState({ date: '', account_id: '', hours: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const leave = useLeaveDay(open ? fields.date : null);

  useEffect(() => {
    if (open) setFields({ date: '', account_id: '', hours: '', reason: '' });
  }, [open]);

  function set(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/timesheets/regularization-requests', {
        date: fields.date,
        account_id: fields.account_id || undefined,
        hours: Number(fields.hours),
        reason: fields.reason.trim(),
      });
      pushSuccess('Regularisation request sent to your reporting manager');
      onSubmitted();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to send the request'), 'Request not sent');
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = fields.date && fields.hours && fields.reason.trim() && (!requireProject || fields.account_id) && !leave.is_leave_day;

  return (
    <Drawer
      open={open}
      title="Timesheet regularisation"
      onClose={onClose}
      size="sm"
      tone="create"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="regularisation-form" className="btn-primary" disabled={saving || !canSubmit}>
            {saving ? 'Sending…' : 'Send request'}
          </button>
        </>
      }
    >
      <form id="regularisation-form" onSubmit={submit} className="space-y-3">
        <p className="text-xs text-tertiary-500">
          Weeks lock automatically every Saturday at 00:00. If you missed the deadline, ask your reporting manager to approve a correction for the locked date.
        </p>
        <label className="block text-xs font-medium text-tertiary-600">
          Date
          <input required type="date" max={todayIso()} value={fields.date} onChange={(e) => set('date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        <LeaveDayNotice leave={leave} what="timesheet entries and regularisation" />
        {requireProject && (
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-600">Project</label>
            <SearchableSelect value={fields.account_id} onChange={(v) => set('account_id', v)} options={projectOptions} placeholder="Select an assigned project" searchPlaceholder="Search projects…" />
          </div>
        )}
        <label className="block text-xs font-medium text-tertiary-600">
          Target hours
          <input required type="number" min="0.5" max="24" step="0.5" value={fields.hours} onChange={(e) => set('hours', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Reason
          <textarea required rows={3} value={fields.reason} onChange={(e) => set('reason', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
      </form>
    </Drawer>
  );
}

/**
 * Employee-side Timesheet Regularisation: request a correction for a day that
 * has already auto-locked, and track those requests (Pending / Approved /
 * Rejected, with the manager's note). Shared by the IT and non-IT timesheets.
 */
export default function RegularisationSection({ requireProject = false, projectOptions = [], onChanged }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    apiClient
      .get('/timesheets/regularization-requests/mine')
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load your regularisation requests'), 'Something went wrong'));
  }, [pushError]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900">
            <FileClock className="h-4 w-4 text-primary-600" /> Timesheet regularisation
          </h2>
          <p className="mt-0.5 text-xs text-tertiary-500">Missed the weekly lock? Request a correction — your reporting manager approves it.</p>
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={() => setOpen(true)}>Request regularisation</button>
      </div>

      {rows.length > 0 && (
        <ul className="mt-3 divide-y divide-tertiary-100">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-tertiary-900">
                  {String(r.date || r.timesheet_entry?.date || '').slice(0, 10)} · {r.target_hours ?? r.requested_change?.hours}h
                </span>
                <span className="text-tertiary-500"> {r.account?.name || r.timesheet_entry?.account?.name ? `· ${r.account?.name || r.timesheet_entry?.account?.name}` : ''}</span>
                <p className="truncate text-xs text-tertiary-500">{r.reason}</p>
                {r.status === 'rejected' && r.decision_reason && <p className="text-xs text-danger-600">Manager: {r.decision_reason}</p>}
              </div>
              <Badge value={r.status} label={STATUS_LABEL[r.status]} />
            </li>
          ))}
        </ul>
      )}

      <RequestDrawer open={open} requireProject={requireProject} projectOptions={projectOptions} onClose={() => setOpen(false)} onSubmitted={() => { load(); onChanged?.(); }} />
    </section>
  );
}
