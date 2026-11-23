import { useEffect, useState } from 'react';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Modal from '../ui/Modal.jsx';

/** Asks for the reason before something is undone (reimbursement, payment). onConfirm(reason) does the request; its error shows here. */
export default function UndoReasonModal({ open, title, description, confirmLabel = 'Undo', fieldLabel = 'Reason (kept in the history)', minLength = 3, confirmClass = 'btn-danger', closeLabel = 'Cancel', onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setReason(''); setError(''); setSaving(false); } }, [open]);

  async function submit() {
    setSaving(true);
    setError('');
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={saving ? () => {} : onClose}
      layer="z-[60]"
      footer={(
        <>
          <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>{closeLabel}</button>
          <button type="button" className={confirmClass} disabled={saving || reason.trim().length < minLength} onClick={submit}>{saving ? 'Working…' : confirmLabel}</button>
        </>
      )}
    >
      <div className="space-y-3">
        {description && <p className="text-xs text-tertiary-600">{description}</p>}
        <label className="block text-xs font-medium text-tertiary-600">{fieldLabel}
          <textarea rows={3} className="mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        {error && <p className="text-xs text-danger-600">{error}</p>}
      </div>
    </Modal>
  );
}
