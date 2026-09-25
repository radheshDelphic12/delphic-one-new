import { useState } from 'react';
import apiClient from '../lib/apiClient.js';
import { useAlerts } from '../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../lib/alerts/apiErrorMessage.js';
import Modal from './ui/Modal.jsx';
import Tooltip from './ui/Tooltip.jsx';

/**
 * Unlock for locked account | requirement | seat | submission.
 * POST /admin/:entity_type/:entity_id/unlock { reason }
 * (BDA may unlock accounts only; admin may unlock any entity type.)
 */
export default function UnlockButton({ entityType, entityId, onUnlocked, label = 'Unlock' }) {
  const { pushError } = useAlerts();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await apiClient.post(`/admin/${entityType}/${entityId}/unlock`, { reason: reason.trim() });
      setOpen(false);
      setReason('');
      onUnlocked?.();
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to unlock'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if (saving) return;
    setOpen(false);
  }

  return (
    <>
      <Tooltip label="Admin only - reopens this locked record for editing (reason required)">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-secondary border-amber-300 text-amber-800 hover:bg-amber-50"
        >
          {label}
        </button>
      </Tooltip>

      <Modal
        open={open}
        title="Unlock record"
        onClose={close}
        footer={
          <>
            <button type="button" onClick={close} className="btn-secondary" disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="unlock-form" className="btn-primary" disabled={saving || !reason.trim()}>
              {saving ? 'Unlocking…' : 'Unlock'}
            </button>
          </>
        }
      >
        <form id="unlock-form" onSubmit={submit} className="space-y-3">
          <p className="text-xs text-tertiary-500">Admin only. Reason is required and written to stage history.</p>
          <label className="block text-xs font-medium text-tertiary-600">
            Reason
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
              placeholder="Why is this record being unlocked?"
            />
          </label>
        </form>
      </Modal>
    </>
  );
}
