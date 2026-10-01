import { useState } from 'react';
import { Lock, RotateCcw } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Modal from '../ui/Modal.jsx';
import StatusBadge from './StatusBadge.jsx';
import { periodLabel } from './PeriodPicker.jsx';

const FROZEN = ['locked', 'change_detected'];

/**
 * Lock one Live Analytics record (a project's billing, an employee's salary,
 * a vendor's billing, an expense) — Unlocked → Locked. A locked record shows
 * its badge and can be reopened (reason required). Uses the shared
 * /calculations lock system, so the version + audit history are the same as
 * everywhere else; the server says what still blocks the lock.
 */
export default function RecordLockButton({ kind, scopeKey, period, lock, label, onChanged, size = 'xs' }) {
  const { pushError, pushSuccess } = useAlerts();
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const status = lock?.status || 'draft';
  const frozen = FROZEN.includes(status);

  // An older whole-month lock covers this record: show it, nothing to act on.
  if (lock?.scope === 'month') return <StatusBadge status={status} label={`Locked (month) v${lock.version}`} size={size} />;

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post(`/calculations/${action}`, { kind, scope_key: scopeKey, period_month: period.period_month, period_year: period.period_year, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      pushSuccess?.(action === 'lock' ? `${label || 'Record'} locked` : `${label || 'Record'} reopened`);
      setAction(null);
      setReason('');
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, action === 'lock' ? 'Could not lock' : 'Could not reopen'), action === 'lock' ? 'Not locked' : 'Not reopened');
    } finally {
      setSaving(false);
    }
  }

  const reopen = action === 'reopen';
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {frozen ? (
        <>
          <StatusBadge status={status} label={status === 'locked' ? `Locked v${lock.version}` : undefined} size={size} />
          <button type="button" className="btn-ghost inline-flex items-center gap-1 px-1.5 py-0.5 text-xs" onClick={() => setAction('reopen')} title="Back to unlocked so it can be corrected and locked again"><RotateCcw className="h-3 w-3" /> Reopen</button>
        </>
      ) : (
        <button type="button" className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs" onClick={() => setAction('lock')}><Lock className="h-3 w-3" /> Lock</button>
      )}
      {action && (
        <Modal
          open
          title={reopen ? 'Reopen locked record' : 'Lock record'}
          onClose={() => setAction(null)}
          footer={(
            <>
              <button type="button" className="btn-secondary" onClick={() => setAction(null)} disabled={saving}>Cancel</button>
              <button type="submit" form="record-lock-form" className="btn-primary" disabled={saving || (reopen && !reason.trim())}>{saving ? 'Saving…' : reopen ? 'Reopen' : 'Lock'}</button>
            </>
          )}
        >
          <form id="record-lock-form" onSubmit={submit} className="space-y-3">
            <p className="text-sm text-tertiary-600">
              {reopen
                ? `${label} — ${periodLabel(period)}: back to unlocked (live). Earlier locked versions are kept.`
                : `${label} — ${periodLabel(period)}: freeze the current figures as the final record. It moves to Locked and counts in Financials. Later changes are flagged, never applied silently.`}
            </p>
            <label className="block text-xs font-medium text-tertiary-600">
              Reason {reopen ? <span className="text-danger-600">*</span> : <span className="font-normal text-tertiary-400">(optional)</span>}
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required={reopen} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" placeholder="Recorded in the audit history" />
            </label>
          </form>
        </Modal>
      )}
    </span>
  );
}
