import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../ui/DataTable.jsx';

const when = (value) => (value ? new Date(value).toLocaleString() : '—');

/**
 * Everything a person deleted in the app (timesheet entries, allocations, holidays, rates, charges, vendor invoices ...).
 * A delete is never final: the record is kept here with who deleted it and why, and Restore puts it back as it was.
 */
export default function RecycleBinPanel() {
  const { pushError, pushSuccess } = useAlerts();
  const [data, setData] = useState({ rows: [], models: [] });
  const [model, setModel] = useState('');
  const [q, setQ] = useState('');
  const [showRestored, setShowRestored] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await apiClient.get('/admin/recycle-bin', { params: { model: model || undefined, q: q.trim() || undefined, restored: showRestored || undefined } });
      setData(res.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load the recycle bin'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [model, q, showRestored, pushError]);
  useEffect(() => { load(); }, [load]);

  async function restore(row) {
    if (!window.confirm(`Restore ${row.type_label}${row.label ? ` "${row.label}"` : ''}?`)) return;
    setBusyId(row.id);
    try {
      await apiClient.post(`/admin/recycle-bin/${row.id}/restore`);
      pushSuccess(`${row.type_label} restored.`, 'Restored');
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to restore the record'), 'Not restored');
    } finally {
      setBusyId(null);
    }
  }

  const columns = [
    { key: 'type', header: 'Type', render: (r) => r.type_label },
    { key: 'what', header: 'Record', render: (r) => <span>{r.label || <span className="text-tertiary-400">{(r.row_id || '').slice(0, 8)}</span>}{r.summary && <span className="block text-xs text-tertiary-500">{r.summary}</span>}</span> },
    { key: 'reason', header: 'Reason', render: (r) => r.reason || '—' },
    { key: 'by', header: 'Deleted by', render: (r) => r.deleted_by_name || '—' },
    { key: 'at', header: 'When', render: (r) => when(r.deleted_at) },
    { key: 'restore', header: '', render: (r) => (r.restored_at ? <span className="text-xs text-success-700">Restored {when(r.restored_at)}</span> : <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busyId === r.id} onClick={() => restore(r)}>{busyId === r.id ? 'Restoring…' : 'Restore'}</button>) },
  ];

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Recycle bin</h3>
        <p className="text-xs text-tertiary-500">Every other record deleted in the app is kept here (timesheet entries, allocations, holidays, rates, charges, vendor invoices, wallets ...). Restore puts it back exactly as it was.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Type" className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm">
          <option value="">All types</option>
          {data.models.map((m) => <option key={m.model} value={m.model}>{m.label} ({m.count})</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-52 rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" />
        <label className="flex items-center gap-1.5 text-xs text-tertiary-600"><input type="checkbox" checked={showRestored} onChange={(e) => setShowRestored(e.target.checked)} /> Show restored</label>
      </div>
      <DataTable columns={columns} rows={data.rows} loading={loading} emptyLabel="Nothing deleted." />
    </section>
  );
}
