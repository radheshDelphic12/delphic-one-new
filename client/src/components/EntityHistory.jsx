import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import apiClient from '../lib/apiClient.js';
import ChangeDetail from './ChangeDetail.jsx';
import { ACTION_LABEL, ACTION_TONE, entityLabel, whenLabel } from './changeLogUi.js';

/**
 * "History" of one record (a project on Finance > Projects): every change made to it and to what hangs off it
 * (allocations, vendor invoices, rates...), newest first. Loaded when opened. Company admins only.
 */
export default function EntityHistory({ entityType, entityId, title = 'Change history' }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(() => {
    setError('');
    apiClient.get('/change-log/entity', { params: { entity_type: entityType, entity_id: entityId } })
      .then(({ data }) => setRows(data.data || []))
      .catch(() => setError('The history could not be loaded.'));
  }, [entityType, entityId]);

  useEffect(() => { if (open && rows === null) load(); }, [open, rows, load]);

  return (
    <div className="rounded-2xl border border-tertiary-100 p-4">
      <button type="button" className="flex w-full items-center gap-2 text-left font-heading text-sm font-semibold text-tertiary-900" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <History className="h-4 w-4" /> {title}
      </button>
      {open && (
        <div className="mt-3">
          {error && <p className="text-xs text-danger-600">{error}</p>}
          {rows === null && !error && <p className="text-xs text-tertiary-500">Loading…</p>}
          {rows && rows.length === 0 && <p className="text-xs text-tertiary-500">No changes have been recorded yet. History starts from the day this log was switched on.</p>}
          {rows && rows.length > 0 && (
            <ul className="divide-y divide-tertiary-100 text-sm">
              {rows.map((r) => (
                <li key={r.id} className="py-2">
                  <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <span className="min-w-0">
                      <span className={`mr-2 rounded-md px-2 py-0.5 text-xs font-medium ${ACTION_TONE[r.action] || 'bg-tertiary-100 text-tertiary-700'}`}>{ACTION_LABEL[r.action] || r.action}</span>
                      <span className="text-tertiary-800">{entityLabel(r.entity_type)}{r.entity_label ? `: ${r.entity_label}` : ''}</span>
                      {r.changed_fields?.length > 0 && <span className="ml-2 text-xs text-tertiary-500">({r.changed_fields.join(', ')})</span>}
                    </span>
                    <span className="text-xs text-tertiary-500">{r.actor_name || 'System'} · {whenLabel(r.created_at)}</span>
                  </button>
                  {expanded === r.id && <div className="mt-2 rounded-xl bg-tertiary-50 p-3"><ChangeDetail row={r} /></div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
