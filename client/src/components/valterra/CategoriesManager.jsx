import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { vtApi, valterraError } from '../../lib/valterra/api.js';
import DataTable from '../ui/DataTable.jsx';
import Drawer from '../ui/Drawer.jsx';
import Pill from '../ui/Pill.jsx';
import SectionTabs from '../ui/SectionTabs.jsx';
import { Area, Num, Text } from './ui.jsx';

const SCOPES = [
  { key: 'mining_type', label: 'Mining types', blurb: 'The kinds of mining (stone / quarry, gold, iron ore, coal ...). Chosen on each mining site.', addLabel: 'Add mining type' },
  { key: 'material', label: 'Materials', blurb: 'The metal, mineral or stone a site mines (granite, gold ore, coal ...). Chosen on each mining site.', addLabel: 'Add material' },
  { key: 'investment', label: 'Investment types', blurb: 'The kinds of investment (site development, equipment, lease ...). Chosen when an investment is added.', addLabel: 'Add investment type' },
  { key: 'income', label: 'Revenue categories', blurb: 'Where business income comes from (mined material sales ...). Investment earnings are tracked separately, on the investment.', addLabel: 'Add income category' },
  { key: 'expense', label: 'Expense categories', blurb: 'What money is spent on. Shown when recording an expense and in the expense reports.', addLabel: 'Add expense category' },
];

function CategoryForm({ initial, onSubmit, onCancel, saving, error }) {
  const [v, setV] = useState({ name: initial?.name ?? '', description: initial?.description ?? '', sort_order: initial?.sort_order ?? '', active: initial?.active ?? true });
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name: v.name.trim(), description: v.description.trim() || (initial ? null : undefined), ...(v.sort_order !== '' ? { sort_order: Number(v.sort_order) } : {}), ...(initial ? { active: v.active } : {}) }); }} className="space-y-3">
      <Text label="Name" value={v.name} onChange={set('name')} required maxLength={80} autoFocus />
      <Area label="Description" rows={2} value={v.description} onChange={set('description')} maxLength={500} />
      <Num label="Order in lists" value={v.sort_order} onChange={set('sort_order')} step="1" min="0" hint="Smaller numbers first" />
      {initial && <label className="flex items-center gap-2 text-sm text-tertiary-700"><input type="checkbox" checked={v.active} onChange={(e) => set('active')(e.target.checked)} />Active (shown in forms and filters)</label>}
      {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </form>
  );
}

/** Add, rename, reorder and switch off the three kinds of category. Nothing here is fixed in code. */
export default function CategoriesManager({ canEdit }) {
  const { pushError, pushSuccess } = useAlerts();
  const [scope, setScope] = useState('mining_type');
  const [rows, setRows] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => vtApi.categories().then(setRows, (e) => pushError(valterraError(e, 'Could not load'), 'Load failed')), [pushError]);
  useEffect(() => { load(); }, [load]);
  const cur = SCOPES.find((s) => s.key === scope);
  const list = rows.filter((r) => r.scope === scope);

  async function save(body) {
    setSaving(true);
    setError('');
    try {
      if (drawer.row) await vtApi.updateCategory(drawer.row.id, body); else await vtApi.createCategory({ ...body, scope });
      pushSuccess('Saved');
      setDrawer(null);
      load();
    } catch (e) { setError(valterraError(e, 'Could not save')); } finally { setSaving(false); }
  }
  async function remove(r) {
    if (!window.confirm(`Remove "${r.name}"? Existing records keep it; it just disappears from new forms.`)) return;
    try { await vtApi.deleteCategory(r.id); load(); } catch (e) { pushError(valterraError(e, 'Could not remove'), 'Not removed'); }
  }
  const columns = [
    { key: 'name', header: 'Name', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span>{r.description && <span className="block text-xs text-tertiary-500">{r.description}</span>}</span> },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.active ? 'active' : 'inactive'} /> },
    { key: 'a', header: '', render: (r) => canEdit && (
      <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button type="button" title="Edit" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => { setError(''); setDrawer({ row: r }); }}><Pencil className="h-4 w-4" /></button>
        <button type="button" title="Remove" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>
      </span>
    ) },
  ];
  return (
    <div className="space-y-4">
      <SectionTabs tabs={SCOPES.map((s) => ({ key: s.key, label: s.label }))} value={scope} onChange={setScope} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tertiary-600">{cur.blurb}</p>
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => { setError(''); setDrawer({ row: null }); }}><Plus className="h-4 w-4" />{cur.addLabel}</button>}
      </div>
      <DataTable columns={columns} rows={list} emptyLabel="Nothing here yet." />
      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="md" tone={drawer?.row ? 'edit' : 'create'} title={drawer?.row ? `Edit ${drawer.row.name}` : cur.addLabel}>
        {drawer && <CategoryForm key={drawer.row?.id || 'new'} initial={drawer.row} saving={saving} error={error} onSubmit={save} onCancel={() => setDrawer(null)} />}
      </Drawer>
    </div>
  );
}
