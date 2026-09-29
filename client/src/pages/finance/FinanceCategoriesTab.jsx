import { useState } from 'react';
import { Check, Pencil, Plus, Power, Trash2, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useFinanceCategories } from '../../lib/lookups.js';
import Pill from '../../components/ui/Pill.jsx';

function CategoryList({ kind, title, description }) {
  const { pushError, pushInfo } = useAlerts();
  const [refreshKey, setRefreshKey] = useState(0);
  const rows = useFinanceCategories(kind, { includeInactive: true, refreshKey });
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);
  const reload = () => setRefreshKey((k) => k + 1);

  async function call(fn, success) {
    try {
      const res = await fn();
      pushInfo(typeof success === 'function' ? success(res) : success);
      reload();
      return true;
    } catch (err) {
      pushError(apiErrorMessage(err, 'That did not work'), 'Could not save');
      return false;
    }
  }

  async function add(event) {
    event.preventDefault();
    if (await call(() => apiClient.post('/finance-categories', { kind, name: name.trim() }), 'Category added')) setName('');
  }

  return (
    <section className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <div>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3>
        <p className="mt-0.5 text-xs text-tertiary-500">{description}</p>
      </div>
      <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
        {rows.length === 0 && <li className="px-3 py-2 text-sm text-tertiary-400">No categories yet.</li>}
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            {editing?.id === row.id ? (
              <form className="flex flex-1 items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (await call(() => apiClient.patch(`/finance-categories/${row.id}`, { name: editing.name.trim() }), 'Category renamed')) setEditing(null); }}>
                <input autoFocus required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="flex-1 rounded-xl border px-3 py-1.5 text-sm" aria-label="Category name" />
                <button type="submit" className="rounded-lg p-1.5 text-success-700 hover:bg-success-50" aria-label="Save name"><Check className="h-4 w-4" /></button>
                <button type="button" className="rounded-lg p-1.5 text-tertiary-500 hover:bg-tertiary-100" aria-label="Cancel" onClick={() => setEditing(null)}><X className="h-4 w-4" /></button>
              </form>
            ) : (
              <span className="flex items-center gap-2">
                <span className={row.is_active ? 'font-medium text-tertiary-900' : 'text-tertiary-400 line-through'}>{row.name}</span>
                <Pill tone={row.is_active ? 'green' : 'gray'}>{row.is_active ? 'Active' : 'Inactive'}</Pill>
                {row.usage > 0 && <span className="text-xs text-tertiary-500">used {row.usage}×</span>}
              </span>
            )}
            {editing?.id !== row.id && (
              <span className="flex items-center gap-1">
                <button type="button" className="rounded-lg p-1.5 text-tertiary-500 hover:bg-tertiary-100" aria-label={`Rename ${row.name}`} onClick={() => setEditing({ id: row.id, name: row.name })}><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-tertiary-600 hover:bg-tertiary-100" onClick={() => call(() => apiClient.patch(`/finance-categories/${row.id}`, { is_active: !row.is_active }), row.is_active ? 'Category deactivated' : 'Category activated')}>
                  <Power className="h-3.5 w-3.5" /> {row.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label={`Delete ${row.name}`} onClick={() => call(() => apiClient.delete(`/finance-categories/${row.id}`), (res) => (res.data.data.deactivated ? 'In use — deactivated instead of deleted' : 'Category deleted'))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" className="flex-1 rounded-xl border px-3 py-2 text-sm" aria-label={`New ${title} name`} />
        <button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={!name.trim()}><Plus className="h-4 w-4" /> Add</button>
      </form>
    </section>
  );
}

/**
 * Finance → Categories (admin only, like HR Settings → Designations): the
 * category lists offered when recording a group charge or an expense claim.
 * A category already used on records is deactivated rather than deleted, so
 * those records keep reading correctly.
 */
export default function FinanceCategoriesTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CategoryList kind="group_charge" title="Group Charge categories" description="Office Rent, Electricity, Internet, Infrastructure … — picked when adding a group charge." />
      <CategoryList kind="expense" title="Expense categories" description="Travel, Supplies, Meals … — picked by employees when submitting an expense claim." />
    </div>
  );
}
