import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../ui/DataTable.jsx';
import Modal from '../ui/Modal.jsx';

const TYPE_LABEL = {
  account: 'Account',
  requirement: 'Requirement',
  submission: 'Submission',
  profile: 'Profile',
  interview_round: 'Interview round',
};

function when(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

/**
 * Superadmin recovery view: everything currently soft-deleted (with a Restore
 * action) plus the full delete / restore audit trail. Rendered inside the
 * Settings page "Deleted records" tab.
 */
export default function DeletedRecordsPanel() {
  const { pushError, pushSuccess } = useAlerts();
  const [deleted, setDeleted] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, a] = await Promise.all([
        apiClient.get('/admin/deleted'),
        apiClient.get('/admin/audit', { params: { limit: 150 } }),
      ]);
      setDeleted(d.data.data || []);
      setAudit(a.data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load deletion activity'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [pushError]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmRestore(event) {
    event.preventDefault();
    if (!reason.trim() || busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/admin/${restoreTarget.entity_type}/${restoreTarget.entity_id}/restore`, {
        reason: reason.trim(),
      });
      pushSuccess(`${TYPE_LABEL[restoreTarget.entity_type] || 'Record'} restored.`, 'Restored');
      setRestoreTarget(null);
      setReason('');
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to restore record'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const idFallback = (r) => <span className="text-tertiary-400">{r.entity_id.slice(0, 8)}</span>;

  const deletedColumns = [
    { key: 'entity_type', header: 'Type', render: (r) => TYPE_LABEL[r.entity_type] || r.entity_type },
    { key: 'name', header: 'Name', render: (r) => r.name || idFallback(r) },
    { key: 'delete_reason', header: 'Reason' },
    { key: 'deleted_by_name', header: 'Deleted by', render: (r) => r.deleted_by_name || '—' },
    { key: 'deleted_at', header: 'When', render: (r) => when(r.deleted_at) },
    {
      key: '_restore',
      header: '',
      render: (r) => (
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-xs"
          onClick={() => {
            setRestoreTarget(r);
            setReason('');
          }}
        >
          Restore
        </button>
      ),
    },
  ];

  const auditColumns = [
    {
      key: 'action',
      header: 'Action',
      render: (r) => (
        <span className={r.action === 'restore' ? 'text-emerald-700' : 'text-danger-700'}>
          {r.action === 'restore' ? 'Restored' : 'Deleted'}
        </span>
      ),
    },
    { key: 'entity_type', header: 'Type', render: (r) => TYPE_LABEL[r.entity_type] || r.entity_type },
    { key: 'name', header: 'Name', render: (r) => r.name || idFallback(r) },
    { key: 'reason', header: 'Reason' },
    { key: 'actor_name', header: 'By', render: (r) => r.actor_name || '—' },
    { key: 'created_at', header: 'When', render: (r) => when(r.created_at) },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-tertiary-500">
        Superadmin deletions are reversible. Restoring puts the record back in every list, board and report.
      </p>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-tertiary-700">Currently deleted ({deleted.length})</h3>
        <DataTable
          columns={deletedColumns}
          rows={deleted.map((r) => ({ ...r, id: `${r.entity_type}:${r.entity_id}` }))}
          loading={loading}
          emptyLabel="Nothing is deleted right now."
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-tertiary-700">Delete / restore trail</h3>
        <DataTable
          columns={auditColumns}
          rows={audit.map((r) => ({ ...r, id: r.id }))}
          loading={loading}
          emptyLabel="No deletions have been made."
        />
      </section>

      <Modal
        open={Boolean(restoreTarget)}
        title="Restore record"
        onClose={() => !busy && setRestoreTarget(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setRestoreTarget(null)}>
              Cancel
            </button>
            <button type="submit" form="restore-form" className="btn-primary" disabled={busy || !reason.trim()}>
              {busy ? 'Restoring…' : 'Restore'}
            </button>
          </>
        }
      >
        <form id="restore-form" onSubmit={confirmRestore} className="space-y-3">
          <p className="text-xs text-tertiary-600">
            Restoring <span className="font-medium">{restoreTarget?.name || restoreTarget?.entity_id}</span> (
            {TYPE_LABEL[restoreTarget?.entity_type] || restoreTarget?.entity_type}). An audit entry is written.
          </p>
          <label className="block text-xs font-medium text-tertiary-600">
            Reason
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
              placeholder="Why is this record being restored?"
            />
          </label>
        </form>
      </Modal>
    </div>
  );
}
