import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';

/** Rejecting always needs the manager's reason — it is shown back to the employee. */
export default function RejectReasonModal({ open, title = 'Reject', subject, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setReason(''); }, [open]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="reject-reason-form" className="btn-primary" disabled={saving || !reason.trim()}>
            {saving ? 'Rejecting…' : 'Reject'}
          </button>
        </>
      }
    >
      <form id="reject-reason-form" onSubmit={submit} className="space-y-3">
        {subject && <p className="text-tertiary-600">{subject}</p>}
        <label className="block text-xs font-medium text-tertiary-600">
          Reason for rejection <span className="text-danger-600">*</span>
          <textarea
            required
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            placeholder="Tell the employee what to fix"
          />
        </label>
      </form>
    </Modal>
  );
}
