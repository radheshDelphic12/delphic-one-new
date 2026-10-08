import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Modal from '../../components/ui/Modal.jsx';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Update a processed payroll run from the current salary: payslips whose figures moved are updated in place
 * (each change kept as a revision with this reason) and newly eligible employees get a payslip.
 */
export default function RefreshRunModal({ open, run, periodText, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) { setReason(''); setResult(null); }
  }, [open, run?.id]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await apiClient.post(`/payroll/runs/${run.id}/refresh`, { reason: reason.trim() });
      setResult(data.data);
      const changed = data.data.updated.length + data.data.added.length;
      pushSuccess(changed ? `Payroll updated — ${data.data.updated.length} payslip(s) revised, ${data.data.added.length} added` : 'Payroll is already up to date');
      onDone?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the payroll run'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide title={`Update processed payroll — ${periodText || ''}`}>
      {!result ? (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-tertiary-600">
            Recalculates every payslip of this run from the current salary (salary structure, adjustments such as TDS / variable pay, attendance and leave) and updates the payslips whose figures changed. The payslip stays the same record; each change is kept on it as a revision with the reason below. Employees who became eligible after processing get a payslip. Nothing is deleted.
          </p>
          <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">If this month&apos;s salary is locked (Live Analytics → Salary), the locked figures are what is paid. Recalculate and lock the salary again first if a change should show up here.</p>
          <label className="block text-xs font-medium text-tertiary-600">Reason for the update (required)
            <textarea required minLength={3} maxLength={500} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm" placeholder="e.g. Q2 bonus added after processing" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving || reason.trim().length < 3}>{saving ? 'Updating…' : 'Update payslips'}</button>
          </div>
        </form>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-tertiary-600">
            Figures used: {result.source === 'locked' ? `locked salary (version ${result.locked_version})` : 'live salary (not locked)'}.
            {' '}<span className="font-medium text-tertiary-900">{result.updated.length}</span> revised, <span className="font-medium text-tertiary-900">{result.added.length}</span> added, <span className="font-medium text-tertiary-900">{result.unchanged}</span> unchanged
            {result.details_refreshed ? `, ${result.details_refreshed} with only their calculation details refreshed` : ''}
            {result.not_recalculated ? `, ${result.not_recalculated} left as they were (no longer in the salary calculation)` : ''}.
          </p>
          {result.updated.length > 0 && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-tertiary-50 text-xs text-tertiary-500"><tr><th className="px-3 py-2 text-left font-medium">Employee</th><th className="px-3 py-2 text-right font-medium">Net before</th><th className="px-3 py-2 text-right font-medium">Net now</th><th className="px-3 py-2 text-right font-medium">Change</th></tr></thead>
                <tbody>
                  {result.updated.map((u) => (
                    <tr key={u.org_membership_id} className="border-t">
                      <td className="px-3 py-2">{u.employee || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(u.previous_net)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(u.net)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${u.net >= u.previous_net ? 'text-success-700' : 'text-danger-600'}`}>{u.net >= u.previous_net ? '+' : '-'}{money(Math.abs(u.net - u.previous_net))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.added.length > 0 && <p className="text-tertiary-600">New payslip for: {result.added.map((a) => a.employee || 'employee').join(', ')}.</p>}
          {result.paid_mismatch.length > 0 && (
            <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">
              Already marked paid for a different amount: {result.paid_mismatch.map((p) => `${p.employee || 'employee'} (paid ${money(p.amount_paid)}, payslip now ${money(p.net)})`).join('; ')}. Update the payment details in Salary Payments.
            </p>
          )}
          <div className="flex justify-end"><button type="button" className="btn-primary" onClick={onClose}>Close</button></div>
        </div>
      )}
    </Modal>
  );
}
