import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useAlerts } from '../../../lib/alerts/alertContext.jsx';
import { nxApi, novarexError } from '../../../lib/novarex/api.js';
import DataTable from '../../ui/DataTable.jsx';
import Drawer from '../../ui/Drawer.jsx';
import Pill from '../../ui/Pill.jsx';
import { Area, Num, Select, Text, DateInput } from '../ui.jsx';

const inputCls = 'rounded-xl border px-3 py-2 text-sm';

const initialOf = (fields, row) => Object.fromEntries(fields.map((f) => {
  const v = row?.[f.key];
  if (f.type === 'tags') return [f.key, (v || []).join(', ')];
  if (f.type === 'bool') return [f.key, v ?? f.default ?? false];
  return [f.key, v ?? f.default ?? ''];
}));

function toBody(fields, v, editing) {
  const body = {};
  for (const f of fields) {
    let x = v[f.key];
    if (f.type === 'num') x = x === '' ? undefined : Number(x);
    else if (f.type === 'tags') x = x.split(',').map((t) => t.trim()).filter(Boolean);
    else if (f.type === 'bool') x = Boolean(x);
    else x = x === '' ? (editing ? null : undefined) : x;
    if (f.required && (x === undefined || x === null || x === '')) throw new Error(`${f.label} is required`);
    if (x !== undefined) body[f.key] = x;
  }
  return body;
}

/**
 * One master-data screen (products, warehouses, suppliers, customers, partners, rate cards, vehicles): search, status filter,
 * create / edit drawer, archive and restore. Everything is described by `fields` and `columns`; nothing is fixed in the page.
 */
export default function MasterPage({ resource, singular, columns, fields, canEdit, statusOptions, extraFilters = [], onChanged, intro, searchHint }) {
  const api = useMemo(() => nxApi.ops.master(resource), [resource]);
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [filters, setFilters] = useState({});
  const [archived, setArchived] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [v, setV] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => api.list({ q, status, archived: archived ? 'true' : undefined, ...filters }).then(setRows, (e) => pushError(novarexError(e, 'Could not load'), 'Load failed')), [api, q, status, archived, filters, pushError]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const open = (row) => { setError(''); setV(initialOf(fields, row)); setDrawer({ row }); };
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));

  async function save(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const body = toBody(fields, v, Boolean(drawer.row));
      if (drawer.row) await api.update(drawer.row.id, body); else await api.create(body);
      pushSuccess(drawer.row ? `${singular} updated` : `${singular} created`);
      setDrawer(null); load(); onChanged?.();
    } catch (err) { setError(err.response ? novarexError(err, 'Could not save') : err.message); } finally { setSaving(false); }
  }
  async function archive(r) {
    if (!window.confirm(`Archive ${r.name || r.reg_no}? History stays; it disappears from new forms.`)) return;
    try { await api.archive(r.id); load(); onChanged?.(); } catch (err) { pushError(novarexError(err, 'Could not archive'), 'Not archived'); }
  }
  async function restore(r) {
    try { await api.restore(r.id); load(); onChanged?.(); } catch (err) { pushError(novarexError(err, 'Could not restore'), 'Not restored'); }
  }
  const cols = [
    ...columns,
    ...(canEdit ? [{ key: '_a', header: '', render: (r) => (
      <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button type="button" title="Edit" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => open(r)}><Pencil className="h-4 w-4" /></button>
        {r.archived ? <button type="button" title="Restore" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => restore(r)}><RotateCcw className="h-4 w-4" /></button>
          : <button type="button" title="Archive" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => archive(r)}><Archive className="h-4 w-4" /></button>}
      </span>
    ) }] : []),
  ];

  return (
    <div className="space-y-3">
      {intro && <p className="text-sm text-tertiary-600">{intro}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <input className={`${inputCls} min-w-[14rem] flex-1`} placeholder={searchHint || 'Search...'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {statusOptions && (
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        )}
        {extraFilters.map((ef) => (
          <select key={ef.key} className={inputCls} value={filters[ef.key] || ''} onChange={(e) => setFilters((c) => ({ ...c, [ef.key]: e.target.value }))} aria-label={ef.label}>
            <option value="">{ef.label}</option>
            {ef.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-tertiary-600"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Show archived</label>
        {canEdit && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => open(null)}><Plus className="h-4 w-4" />New {singular.toLowerCase()}</button>}
      </div>
      <DataTable columns={cols} rows={rows || []} loading={!rows} emptyLabel={`No ${singular.toLowerCase()} records yet.`} onRowClick={canEdit ? open : undefined} />
      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="lg" tone={drawer?.row ? 'edit' : 'create'} title={drawer?.row ? `Edit ${singular.toLowerCase()}` : `New ${singular.toLowerCase()}`}>
        {drawer && (
          <form onSubmit={save} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => {
                const span = f.span === 2 || f.type === 'area' ? 'sm:col-span-2' : '';
                if (f.type === 'select') return <Select key={f.key} label={f.label} className={span} value={v[f.key]} onChange={set(f.key)} options={f.options || []} blank={f.required ? undefined : 'Not set'} />;
                if (f.type === 'num') return <Num key={f.key} label={f.label} className={span} value={v[f.key]} onChange={set(f.key)} hint={f.hint} />;
                if (f.type === 'date') return <DateInput key={f.key} label={f.label} className={span} value={v[f.key]} onChange={set(f.key)} />;
                if (f.type === 'area') return <Area key={f.key} label={f.label} className={span} rows={3} value={v[f.key]} onChange={set(f.key)} />;
                if (f.type === 'bool') return <label key={f.key} className="flex items-center gap-2 text-sm text-tertiary-700"><input type="checkbox" checked={Boolean(v[f.key])} onChange={(e) => set(f.key)(e.target.checked)} />{f.label}</label>;
                return <Text key={f.key} label={f.label} className={span} value={v[f.key]} onChange={set(f.key)} placeholder={f.placeholder} />;
              })}
            </div>
            {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setDrawer(null)} disabled={saving}>Cancel</button>
              {canEdit && <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : drawer.row ? 'Save changes' : 'Create'}</button>}
            </div>
          </form>
        )}
      </Drawer>
    </div>
  );
}

export const statusPill = (r) => <Pill tone={r.archived ? 'gray' : r.status === 'active' || r.status === 'available' ? 'green' : 'amber'}>{r.archived ? 'archived' : (r.status || '').replace(/_/g, ' ')}</Pill>;
