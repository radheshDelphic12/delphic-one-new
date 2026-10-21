import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, ScrollText } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import ChangeDetail from '../../components/ChangeDetail.jsx';
import { ACTION_LABEL, ACTION_TONE, entityLabel, whenLabel } from '../../components/changeLogUi.js';

const inputCls = 'mt-1 block w-full rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const EMPTY = { org_id: '', entity_type: '', actor_id: '', action: '', from: '', to: '' };

/** The change log across every company: filters, a table, and a drawer with the exact old and new values. */
function ChangeLog() {
  const { pushError } = useAlerts();
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], pagination: { page: 1, totalPages: 1, total: 0 }, facets: { companies: [], entity_types: [], actors: [] } });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const set = (key) => (e) => { setPage(1); setFilters((f) => ({ ...f, [key]: e.target.value })); };

  const load = useCallback(() => {
    setLoading(true);
    const params = { page, limit: 50, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
    apiClient.get('/change-log', { params })
      .then(({ data: body }) => setData({ rows: body.data, pagination: body.pagination, facets: body.facets }))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the change log'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [filters, page, pushError]);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { key: 'when', header: 'When', render: (r) => <span className="whitespace-nowrap text-xs text-tertiary-600">{whenLabel(r.created_at)}</span> },
    { key: 'company', header: 'Company', render: (r) => r.company || <span className="text-tertiary-400">-</span> },
    { key: 'who', header: 'Who', render: (r) => r.actor_name || <span className="text-tertiary-400">System</span> },
    { key: 'action', header: 'Action', render: (r) => <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${ACTION_TONE[r.action] || 'bg-tertiary-100 text-tertiary-700'}`}>{ACTION_LABEL[r.action] || r.action}</span> },
    { key: 'what', header: 'Record', render: (r) => <span><span className="text-xs uppercase tracking-wide text-tertiary-500">{entityLabel(r.entity_type)}</span><span className="block font-medium text-tertiary-900">{r.entity_label || r.entity_id || '-'}</span></span> },
    { key: 'fields', header: 'Changed', render: (r) => <span className="text-xs text-tertiary-600">{r.changed_fields?.length ? r.changed_fields.join(', ') : ''}</span> },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-6">
        <label className={labelCls}>Company
          <select className={inputCls} value={filters.org_id} onChange={set('org_id')}><option value="">All companies</option>{data.facets.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className={labelCls}>Record type
          <select className={inputCls} value={filters.entity_type} onChange={set('entity_type')}><option value="">All types</option>{data.facets.entity_types.map((t) => <option key={t} value={t}>{entityLabel(t)}</option>)}</select>
        </label>
        <label className={labelCls}>Person
          <select className={inputCls} value={filters.actor_id} onChange={set('actor_id')}><option value="">Everyone</option>{data.facets.actors.filter((a) => a.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
        <label className={labelCls}>Action
          <select className={inputCls} value={filters.action} onChange={set('action')}><option value="">Any</option>{Object.entries(ACTION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className={labelCls}>From<input type="date" className={inputCls} value={filters.from} onChange={set('from')} /></label>
        <label className={labelCls}>To<input type="date" className={inputCls} value={filters.to} min={filters.from || undefined} onChange={set('to')} /></label>
      </div>
      <div className="flex items-center justify-between text-xs text-tertiary-500">
        <span>{data.pagination.total} change{data.pagination.total === 1 ? '' : 's'}</span>
        {Object.values(filters).some(Boolean) && <button type="button" className="font-medium text-primary-700 hover:underline" onClick={() => { setPage(1); setFilters(EMPTY); }}>Clear filters</button>}
      </div>
      <DataTable columns={columns} rows={data.rows} loading={loading} onRowClick={setOpen} emptyLabel="No changes match these filters." />
      <div className="flex items-center justify-end gap-2 text-xs">
        <button type="button" className="btn-secondary px-3 py-1" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <span className="text-tertiary-500">Page {data.pagination.page} of {Math.max(1, data.pagination.totalPages)}</span>
        <button type="button" className="btn-secondary px-3 py-1" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
      <Drawer open={Boolean(open)} title={open ? `${ACTION_LABEL[open.action] || open.action}: ${open.entity_label || entityLabel(open.entity_type)}` : ''} onClose={() => setOpen(null)} size="lg">
        {open && <ChangeDetail row={open} />}
      </Drawer>
    </div>
  );
}

/** Soft-deleted records of the group, with a Restore button. */
function Deleted() {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/change-log/deleted').then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load deleted records'), 'Something went wrong')).finally(() => setLoading(false));
  }, [pushError]);
  useEffect(() => { load(); }, [load]);

  async function restore(row) {
    const reason = window.prompt(`Restore ${entityLabel(row.entity_type)} "${row.name || row.entity_id}"? Give a reason:`, 'Deleted by mistake');
    if (reason === null) return;
    try {
      await apiClient.post('/change-log/restore', { entity_type: row.entity_type, entity_id: row.entity_id, reason: reason.trim() || 'Restored' });
      pushSuccess('Record restored');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not restore'), 'Not restored');
    }
  }

  const columns = [
    { key: 'when', header: 'Deleted', render: (r) => <span className="whitespace-nowrap text-xs text-tertiary-600">{whenLabel(r.deleted_at)}</span> },
    { key: 'company', header: 'Company', render: (r) => r.company || '-' },
    { key: 'what', header: 'Record', render: (r) => <span><span className="text-xs uppercase tracking-wide text-tertiary-500">{entityLabel(r.entity_type)}</span><span className="block font-medium text-tertiary-900">{r.name || r.entity_id}</span></span> },
    { key: 'by', header: 'Deleted by', render: (r) => r.deleted_by_name || '-' },
    { key: 'why', header: 'Reason', render: (r) => <span className="text-tertiary-700">{r.delete_reason || ''}</span> },
    { key: 'act', header: '', render: (r) => <button type="button" className="btn-secondary inline-flex items-center gap-1 px-3 py-1 text-xs" onClick={() => restore(r)}><RotateCcw className="h-3.5 w-3.5" />Restore</button> },
  ];
  return <DataTable columns={columns} rows={rows.map((r) => ({ ...r, id: `${r.entity_type}-${r.entity_id}` }))} loading={loading} emptyLabel="Nothing has been deleted." />;
}

export default function GroupLogsTab() {
  const [view, setView] = useState('log');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Group</p>
          <h2 className="mt-1 flex items-center gap-2 font-heading text-xl font-semibold text-tertiary-900"><ScrollText className="h-5 w-5" /> Logs</h2>
          <p className="mt-1 text-sm text-tertiary-500">Every create, update and delete across the group&apos;s companies: who, when, and the exact old and new values. Deleted records can be restored.</p>
        </div>
        <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5">
          {[['log', 'Change log'], ['deleted', 'Deleted records']].map(([key, text]) => (
            <button key={key} type="button" onClick={() => setView(key)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${view === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:text-tertiary-900'}`}>{text}</button>
          ))}
        </div>
      </div>
      {view === 'log' ? <ChangeLog /> : <Deleted />}
    </div>
  );
}
