import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import apiClient from '../lib/apiClient.js';
import { useAlerts } from '../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../lib/alerts/apiErrorMessage.js';
import Modal from './ui/Modal.jsx';
import PasswordInput from './ui/PasswordInput.jsx';
import Tooltip from './ui/Tooltip.jsx';

/**
 * Superadmin-only soft-delete for account | requirement | submission | profile |
 * interview_round. POST /admin/:entity_type/:entity_id/delete { password, reason }.
 *
 * The record is hidden everywhere but retained; a superadmin can restore it.
 * Guard: the superadmin must re-enter their own login password + a reason.
 */
export default function DeleteRecordButton({ entityType, entityId, entityLabel, onDeleted, label = 'Delete record' }) {
  const { pushError, pushSuccess } = useAlerts();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const ready = password.trim().length > 0 && reason.trim().length > 0;

  async function submit(event) {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    try {
      const { data } = await apiClient.post(`/admin/${entityType}/${entityId}/delete`, {
        password,
        reason: reason.trim(),
      });
      const deps = data?.dependency
        ? Object.entries(data.dependency)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`)
        : [];
      pushSuccess(
        deps.length
          ? `${entityLabel || 'Record'} deleted (it had ${deps.join(', ')}). Reverse it from Settings → Deleted records.`
          : `${entityLabel || 'Record'} deleted. Reverse it from Settings → Deleted records.`,
        'Record deleted'
      );
      setOpen(false);
      setPassword('');
      setReason('');
      onDeleted?.();
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to delete record'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if (saving) return;
    setOpen(false);
    setPassword('');
  }

  return (
    <>
      <Tooltip label="Superadmin only - hides this record everywhere (reversible; password + reason required)">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-secondary border-danger-300 text-danger-700 hover:bg-danger-50"
        >
          <Trash2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </button>
      </Tooltip>

      <Modal
        open={open}
        title="Delete record"
        onClose={close}
        footer={
          <>
            <button type="button" onClick={close} className="btn-secondary" disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              form="delete-record-form"
              className="btn-primary bg-danger-600 hover:bg-danger-700"
              disabled={saving || !ready}
            >
              {saving ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <form id="delete-record-form" onSubmit={submit} className="space-y-3">
          <p className="text-xs text-tertiary-600">
            This hides <span className="font-medium">{entityLabel || 'this record'}</span> from every list, board and
            report. It is <span className="font-medium">reversible</span> - a superadmin can restore it. An audit entry
            with a full snapshot is written.
          </p>
          <label className="block text-xs font-medium text-tertiary-600">
            Your password
            <PasswordInput
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
              placeholder="Re-enter your login password"
            />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Reason
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
              placeholder="e.g. Duplicate of ACC-… / created by mistake"
            />
          </label>
        </form>
      </Modal>
    </>
  );
}
