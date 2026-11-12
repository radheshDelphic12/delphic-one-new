import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { fxApi, foundationError } from '../../lib/foundation/api.js';
import { fxCan, useFoundation } from '../../lib/foundation/useFoundation.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { Area, Num, Text, card } from '../../components/foundation/ui.jsx';

const SCOPES = [
  { key: 'initiative', label: 'Initiatives', blurb: 'The kinds of work the foundation does. Every campaign belongs to one.', addLabel: 'Add initiative' },
  { key: 'expense', label: 'Spending categories', blurb: 'What money is spent on (shown when recording an expense).', addLabel: 'Add category' },
  { key: 'funding', label: 'Funding sources', blurb: 'Where money comes from: donation, grant, sponsor or the foundation itself.', addLabel: 'Add source' },
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

export default function FoundationInitiativesPage() {
  const { me, loading } = useFoundation();
  const { pushError, pushSuccess } = useAlerts();
  const [scope, setScope] = useState('initiative');
  const [rows, setRows] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => Promise.all([fxApi.categories(), fxApi.campaigns({ limit: 200 })]).then(([cats, camps]) => { setRows(cats); setCampaigns(camps.data); }, (e) => pushError(foundationError(e, 'Could not load'), 'Load failed')), [pushError]);
  useEffect(() => { if (me) load(); }, [me, load]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !fxCan(me, 'campaigns')) return <Navigate to="/foundation" replace />;
  const canEdit = fxCan(me, 'categories');
  const cur = SCOPES.find((s) => s.key === scope);
  const list = rows.filter((r) => r.scope === scope);
  const count = (id) => campaigns.filter((c) => c.category_id === id);

  async function save(body) {
    setSaving(true);
    setError('');
    try {
      if (drawer.row) await fxApi.updateCategory(drawer.row.id, body);
      else await fxApi.createCategory({ ...body, scope });
      pushSuccess('Saved');
      setDrawer(null);
      load();
    } catch (e) { setError(foundationError(e, 'Could not save')); } finally { setSaving(false); }
  }
  async function remove(r) {
    if (!window.confirm(`Remove "${r.name}"? Existing records keep it; it just disappears from new forms.`)) return;
    try { await fxApi.deleteCategory(r.id); load(); } catch (e) { pushError(foundationError(e, 'Could not remove'), 'Not removed'); }
  }

  const columns = [
    { key: 'name', header: 'Name', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span>{r.description && <span className="block text-xs text-tertiary-500">{r.description}</span>}</span> },
    ...(scope === 'initiative' ? [
      { key: 'n', header: 'Campaigns', render: (r) => count(r.id).length },
      { key: 'act', header: 'Active now', render: (r) => count(r.id).filter((c) => c.status === 'active').length },
    ] : []),
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.active ? 'active' : 'inactive'} /> },
    { key: 'a', header: '', render: (r) => canEdit && (
      <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button type="button" title="Edit" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => { setError(''); setDrawer({ row: r }); }}><Pencil className="h-4 w-4" /></button>
        <button type="button" title="Remove" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>
      </span>
    ) },
  ];

  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={SCOPES.map((s) => ({ key: s.key, label: s.label }))} value={scope} onChange={setScope} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tertiary-600">{cur.blurb}</p>
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => { setError(''); setDrawer({ row: null }); }}><Plus className="h-4 w-4" />{cur.addLabel}</button>}
      </div>
      <DataTable columns={columns} rows={list} emptyLabel="Nothing here yet." />
      {scope === 'initiative' && list.some((r) => count(r.id).length > 0) && (
        <section className={card}>
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Campaigns by initiative</h3>
          <ul className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
            {list.filter((r) => count(r.id).length).map((r) => <li key={r.id}><span className="font-medium">{r.name}</span><span className="text-tertiary-500"> - {count(r.id).map((c) => c.name).join(', ')}</span></li>)}
          </ul>
        </section>
      )}
      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="md" tone={drawer?.row ? 'edit' : 'create'} title={drawer?.row ? `Edit ${drawer.row.name}` : cur.addLabel}>
        {drawer && <CategoryForm key={drawer.row?.id || 'new'} initial={drawer.row} saving={saving} error={error} onSubmit={save} onCancel={() => setDrawer(null)} />}
      </Drawer>
    </div>
  );
}
