import { useEffect, useState } from 'react';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Modal from '../ui/Modal.jsx';

/** Asks for the reason before something is undone (reimbursement, payment). onConfirm(reason) does the request; its error shows here. */
export default function UndoReasonModal({ open, title, description, confirmLabel = 'Undo', onConfirm, onClose }) {
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
      setError(apiErrorMessage(err, 'Could not undo'));
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
          <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="button" className="btn-danger" disabled={saving || reason.trim().length < 3} onClick={submit}>{saving ? 'Working…' : confirmLabel}</button>
        </>
      )}
    >
      <div className="space-y-3">
        {description && <p className="text-xs text-tertiary-600">{description}</p>}
        <label className="block text-xs font-medium text-tertiary-600">Reason (kept in the history)
          <textarea rows={3} className="mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        {error && <p className="text-xs text-danger-600">{error}</p>}
      </div>
    </Modal>
  );
}
