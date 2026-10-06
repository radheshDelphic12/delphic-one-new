import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Briefcase, History, Landmark, Plus, Tags, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { SERVICE_META, useServiceTypes } from '../../lib/zephyr/serviceMeta.js';
import SectionTabs from '../../components/ui/SectionTabs.jsx';

const TABS = [
  { key: 'services', label: 'Services', icon: Briefcase },
  { key: 'valuation', label: 'Valuation', icon: Landmark },
  { key: 'categories', label: 'Categories', icon: Tags },
  { key: 'audit', label: 'Audit log', icon: History },
];

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const card = 'rounded-2xl border bg-white p-4 shadow-soft md:p-5';

const METHOD_LABEL = { manual: 'Manual value', revenue_multiple: 'Revenue multiple (trailing 12 months)', profit_multiple: 'Profit multiple (trailing 12 months)' };

function ValuationTab() {
  const { pushError, pushInfo } = useAlerts();
  const [form, setForm] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    zephyrApi.settings().then(setForm, (e) => pushError(zephyrError(e), 'Could not load settings'));
  }, [pushError]);

  if (!form) return <div className="py-6 text-sm text-tertiary-500">Loading…</div>;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await zephyrApi.updateSettings({
        valuation_method: form.valuation_method,
        valuation_multiple: Number(form.valuation_multiple),
        valuation_manual: form.valuation_method === 'manual' ? Number(form.valuation_manual) : form.valuation_manual,
        project_prefix: form.project_prefix,
        reason: reason || undefined,
      });
      setForm(next);
      setReason('');
      pushInfo('Settings saved');
    } catch (e) {
      pushError(zephyrError(e), 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className={`${card} max-w-xl space-y-4`}>
      <label className={labelCls}>
        Valuation method
        <select className={inputCls} value={form.valuation_method} onChange={(e) => set('valuation_method', e.target.value)}>
          {Object.entries(METHOD_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      {form.valuation_method === 'manual' ? (
        <label className={labelCls}>
          Company value ({form.currency})
          <input type="number" min="0" className={inputCls} value={form.valuation_manual ?? ''} onChange={(e) => set('valuation_manual', e.target.value)} required />
        </label>
      ) : (
        <label className={labelCls}>
          Multiple (x)
          <input type="number" min="0" step="0.1" className={inputCls} value={form.valuation_multiple} onChange={(e) => set('valuation_multiple', e.target.value)} required />
        </label>
      )}
      <label className={labelCls}>
        Project code prefix
        <input className={inputCls} maxLength={12} value={form.project_prefix} onChange={(e) => set('project_prefix', e.target.value)} required />
      </label>
      <label className={labelCls}>
        Reason for change <span className="font-normal text-tertiary-400">(kept in the audit log)</span>
        <input className={inputCls} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
    </form>
  );
}

function CategoryColumn({ kind, title, rows, reload }) {
  const { pushError } = useAlerts();
  const [name, setName] = useState('');

  async function run(action, fallback) {
    try {
      await action();
      await reload();
    } catch (e) {
      pushError(zephyrError(e, fallback), 'Category update failed');
    }
  }

  return (
    <div className={card}>
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3>
      <ul className="mt-3 divide-y">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2 py-2">
            <input
              defaultValue={row.name}
              className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm hover:border-tertiary-200 focus:border-primary-500 focus:outline-none"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== row.name && run(() => zephyrApi.updateCategory(row.id, { name: e.target.value.trim() }))}
              aria-label={`Rename ${row.name}`}
            />
            <label className="flex items-center gap-1 text-xs text-tertiary-500">
              <input type="checkbox" checked={row.active} onChange={(e) => run(() => zephyrApi.updateCategory(row.id, { active: e.target.checked }))} />
              Active
            </label>
            <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label={`Delete ${row.name}`} onClick={() => run(() => zephyrApi.deleteCategory(row.id))}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(async () => {
            await zephyrApi.createCategory({ kind, name: name.trim() });
            setName('');
          }, 'Could not add category');
        }}
      >
        <input className="min-w-0 flex-1 rounded-xl border px-3 py-1.5 text-sm" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <button type="submit" className="btn-secondary inline-flex items-center gap-1"><Plus className="h-4 w-4" />Add</button>
      </form>
    </div>
  );
}

function CategoriesTab() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  const reload = useCallback(
    () => zephyrApi.categories().then(setRows, (e) => pushError(zephyrError(e), 'Could not load categories')),
    [pushError]
  );
  useEffect(() => {
    reload();
  }, [reload]);

  if (!rows) return <div className="py-6 text-sm text-tertiary-500">Loading…</div>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CategoryColumn kind="revenue" title="Revenue categories" rows={rows.filter((r) => r.kind === 'revenue')} reload={reload} />
      <CategoryColumn kind="expense" title="Expense categories" rows={rows.filter((r) => r.kind === 'expense')} reload={reload} />
    </div>
  );
}

function AuditTab() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    zephyrApi.audit({ limit: 100 }).then(setRows, (e) => pushError(zephyrError(e), 'Could not load audit log'));
  }, [pushError]);
  if (!rows) return <div className="py-6 text-sm text-tertiary-500">Loading…</div>;
  return (
    <div className={`${card} overflow-x-auto p-0 md:p-0`}>
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
          <tr><th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">Entity</th><th className="px-4 py-2.5">Action</th><th className="px-4 py-2.5">Reason</th></tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-tertiary-400">Nothing recorded yet.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2.5 text-tertiary-500">{new Date(r.created_at).toLocaleString()}</td>
              <td className="px-4 py-2.5 capitalize">{r.entity}</td>
              <td className="px-4 py-2.5 capitalize">{r.action}</td>
              <td className="px-4 py-2.5 text-tertiary-500">{r.reason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServicesTab() {
  const { pushError, pushSuccess } = useAlerts();
  const { services, refresh } = useServiceTypes();
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');

  async function save(service, patch) {
    setBusy(service.key);
    try {
      await zephyrApi.updateServiceType(service.key, patch);
      refresh();
      setDrafts((d) => ({ ...d, [service.key]: undefined }));
      pushSuccess('Saved. Reload the page to see the new name everywhere.');
    } catch (e) {
      pushError(zephyrError(e, 'Could not save'), 'Could not save');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className={card}>
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Zephyr services</h3>
      <p className="mt-1 text-xs text-tertiary-500">The five services every lead and project belongs to. You can rename or hide a service; the underlying service stays the same, so history and reports are not affected.</p>
      <ul className="mt-4 divide-y">
        {services.map((s) => {
          const Icon = SERVICE_META[s.key].icon;
          const draft = drafts[s.key] ?? s.label;
          return (
            <li key={s.key} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><Icon className="h-4 w-4" /></span>
              <input className="min-w-[14rem] flex-1 rounded-xl border px-3 py-2 text-sm" value={draft} maxLength={80} aria-label={`${SERVICE_META[s.key].label} name`} onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))} />
              <button type="button" className="btn-secondary" disabled={busy === s.key || !draft.trim() || draft.trim() === s.label} onClick={() => save(s, { label: draft.trim() })}>Rename</button>
              <label className="inline-flex items-center gap-2 text-sm text-tertiary-700">
                <input type="checkbox" checked={s.active} disabled={busy === s.key} onChange={(e) => save(s, { active: e.target.checked })} />
                Offered
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function ZephyrSettingsPage() {
  const { me, loading } = useZephyr();
  const [tab, setTab] = useState('services');
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'settings')) return <Navigate to="/zephyr" replace />;

  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'services' && <ServicesTab />}
      {tab === 'valuation' && <ValuationTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}
