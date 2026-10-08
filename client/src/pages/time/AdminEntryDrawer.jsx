import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useProjectOptions } from '../../lib/lookups.js';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

// After an admin change: tell them when a finalized month now needs its
// billing recalculated and re-invoiced.
export function financeNote(flagged) {
  return flagged
    ? ` ${flagged} locked calculation${flagged === 1 ? '' : 's'} flagged — recalculate in Live Analytics → Billing & sales, then regenerate the invoice.`
    : '';
}

/** Admin: delete any timesheet entry (any status, locked day or not), with a reason. */
export async function adminDeleteEntry(entry, { pushError, pushSuccess, onDone }) {
  const who = entry.org_membership?.person?.name || 'this employee';
  const reason = window.prompt(`Delete ${who}'s ${entry.hours}h on ${String(entry.date).slice(0, 10)}? Give a reason (required):`);
  if (reason === null) return;
  if (reason.trim().length < 3) { pushError('A reason of at least 3 characters is required', 'Not deleted'); return; }
  try {
    const { data } = await apiClient.delete(`/timesheets/entries/${entry.id}`, { data: { reason: reason.trim() } });
    pushSuccess(`Entry deleted.${financeNote(data.data?.flagged)}`);
    onDone?.();
  } catch (err) {
    pushError(apiErrorMessage(err, 'Failed to delete the entry'), 'Something went wrong');
  }
}

/**
 * Admin correction of any timesheet entry — any status (approved included),
 * on a locked day or not: hours, overtime, project, billable, description.
 * A reason is required; a finalized month is flagged for re-billing.
 */
export default function AdminEntryDrawer({ entry, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const projects = useProjectOptions(Boolean(entry));
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(entry ? {
      hours: String(entry.hours ?? ''),
      overtime_hours: String(entry.overtime_hours ?? 0),
      account_id: entry.account_id || '',
      billable: Boolean(entry.billable),
      notes: entry.notes || '',
      reason: '',
    } : null);
  }, [entry]);

  if (!entry || !form) return <Drawer open={false} title="" onClose={onClose} />;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await apiClient.patch(`/timesheets/entries/${entry.id}/admin`, {
        hours: Number(form.hours),
        overtime_hours: Number(form.overtime_hours) || 0,
        account_id: form.account_id || null,
        billable: form.account_id ? form.billable : false,
        notes: form.notes.trim() || null,
        reason: form.reason.trim(),
      });
      pushSuccess(`Entry updated.${financeNote(data.data?.flagged)}`);
      onSaved?.();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the entry'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const input = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm';
  const label = 'block text-xs font-medium text-tertiary-600';
  return (
    <Drawer
      open
      title={`Correct ${entry.org_membership?.person?.name || 'entry'} · ${String(entry.date).slice(0, 10)}`}
      onClose={onClose}
      size="md"
      tone="edit"
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="admin-entry-form" className="btn-primary" disabled={saving || form.reason.trim().length < 3 || !(Number(form.hours) > 0)}>{saving ? 'Saving…' : 'Save correction'}</button>
        </>
      )}
    >
      <form id="admin-entry-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800 sm:col-span-2">
          Admin correction — works on approved entries and locked days. If this month&apos;s billing is already locked it will be flagged so you can recalculate and re-invoice it.
        </p>
        <div className={`${label} sm:col-span-2`}>
          Project
          <SearchableSelect value={form.account_id} onChange={(v) => set('account_id', v)} options={projects} allowClear className="mt-1" placeholder="General (no project)" searchPlaceholder="Search projects…" ariaLabel="Project" />
        </div>
        <label className={label}>Hours<input type="number" min="0.25" max="24" step="0.25" required value={form.hours} onChange={(e) => set('hours', e.target.value)} className={input} /></label>
        <label className={label}>Overtime hours<input type="number" min="0" max="24" step="0.25" value={form.overtime_hours} onChange={(e) => set('overtime_hours', e.target.value)} disabled={!form.account_id} className={`${input} disabled:bg-tertiary-50`} /></label>
        <label className="flex items-center gap-2 text-sm text-tertiary-700 sm:col-span-2">
          <input type="checkbox" checked={form.billable} onChange={(e) => set('billable', e.target.checked)} disabled={!form.account_id} /> Billable
        </label>
        <label className={`${label} sm:col-span-2`}>Description<textarea rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={input} /></label>
        <label className={`${label} sm:col-span-2`}>
          Reason for the change <span className="text-danger-600">*</span>
          <input required minLength={3} value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. Hours logged on the wrong project" className={input} />
        </label>
      </form>
    </Drawer>
  );
}
