import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { gulatiApi, gulatiError } from '../../lib/gulati/api.js';
import { resetMasters } from '../../lib/gulati/meta.js';
import { useGulati, gxCan } from '../../lib/gulati/useGulati.js';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { Empty, Num, Select, Text, card, dayOf } from '../../components/gulati/ui.jsx';
import { titleCase } from '../../lib/format.js';

const TABS = [
  { key: 'general', label: 'Company and valuation' },
  { key: 'types', label: 'Trading types' },
  { key: 'units', label: 'Units' },
  { key: 'categories', label: 'Categories' },
  { key: 'audit', label: 'Audit log' },
];

/** Rename / switch off / add rows of one admin-editable master list. */
function MasterEditor({ title, hint, rows, labelKey, onAdd, onUpdate, onDelete, extraAdd }) {
  const [name, setName] = useState('');
  const [extra, setExtra] = useState(extraAdd?.initial || '');
  const [draft, setDraft] = useState({});
  return (
    <section className={`${card} space-y-3`}>
      <div><h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3>{hint && <p className="text-xs text-tertiary-500">{hint}</p>}</div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name.trim(), extra); setName(''); } }}>
        <div className="min-w-[12rem] flex-1"><Text label="Add new" value={name} onChange={setName} maxLength={80} placeholder="Name" /></div>
        {extraAdd && <div className="w-40"><Select label={extraAdd.label} value={extra} onChange={setExtra} options={extraAdd.options} /></div>}
        <button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={!name.trim()}><Plus className="h-4 w-4" />Add</button>
      </form>
      {rows.length === 0 ? <Empty>Nothing here yet.</Empty> : (
        <ul className="divide-y rounded-xl border bg-white text-sm">
          {rows.map((r) => {
            const id = r.id || r.key;
            const value = draft[id] ?? r[labelKey];
            return (
              <li key={id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                {r.kind && <span className="w-16 text-xs uppercase text-tertiary-400">{r.kind}</span>}
                <input className="min-w-[10rem] flex-1 rounded-lg border px-2 py-1 text-sm" value={value} onChange={(e) => setDraft((d) => ({ ...d, [id]: e.target.value }))} onBlur={() => { if (draft[id] !== undefined && draft[id].trim() && draft[id] !== r[labelKey]) onUpdate(r, { [labelKey]: draft[id].trim() }); setDraft((d) => { const n = { ...d }; delete n[id]; return n; }); }} aria-label={`Rename ${r[labelKey]}`} />
                <label className="inline-flex items-center gap-1.5 text-xs text-tertiary-600"><input type="checkbox" checked={r.active} onChange={(e) => onUpdate(r, { active: e.target.checked })} />Active</label>
                {onDelete && <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => onDelete(r)}><Trash2 className="h-4 w-4" /></button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function General() {
  const { pushError, pushSuccess } = useAlerts();
  const [s, setS] = useState(null);
  const [company, setCompany] = useState(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    gulatiApi.settings().then(setS, () => {});
    gulatiApi.company().then(setCompany, () => {});
  }, []);
  if (!s || !company) return <div className="text-sm text-tertiary-500">Loading...</div>;
  const set = (k) => (v) => setS((c) => ({ ...c, [k]: v }));
  async function saveSettings(e) {
    e.preventDefault();
    try {
      const body = { valuation_method: s.valuation_method, valuation_multiple: Number(s.valuation_multiple), valuation_manual: s.valuation_method === 'manual' && s.valuation_manual !== null && s.valuation_manual !== '' ? Number(s.valuation_manual) : s.valuation_manual === '' ? null : s.valuation_manual, lead_prefix: s.lead_prefix, deal_prefix: s.deal_prefix, task_prefix: s.task_prefix, ...(reason.trim() ? { reason: reason.trim() } : {}) };
      setS(await gulatiApi.updateSettings(body));
      setReason('');
      pushSuccess('Settings saved');
    } catch (err) { pushError(gulatiError(err, 'Could not save'), 'Could not save'); }
  }
  async function saveCompany(e) {
    e.preventDefault();
    try { setCompany(await gulatiApi.updateCompany({ name: company.name, timezone: company.timezone })); pushSuccess('Company saved'); } catch (err) { pushError(gulatiError(err, 'Could not save'), 'Could not save'); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form onSubmit={saveCompany} className={`${card} space-y-3`}>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Company</h3>
        <Text label="Company name" value={company.name} onChange={(v) => setCompany((c) => ({ ...c, name: v }))} required maxLength={200} />
        <Text label="Timezone" value={company.timezone} onChange={(v) => setCompany((c) => ({ ...c, timezone: v }))} placeholder="Asia/Kolkata" />
        <div className="flex justify-end"><button type="submit" className="btn-primary">Save company</button></div>
      </form>
      <form onSubmit={saveSettings} className={`${card} space-y-3`}>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Valuation and numbering</h3>
        <p className="text-xs text-tertiary-500">The valuation is derived from the company financial performance. It is separate from the profit of any single deal.</p>
        <Select label="Valuation method" value={s.valuation_method} onChange={set('valuation_method')} options={[{ value: 'revenue_multiple', label: 'Revenue multiple (last 12 months)' }, { value: 'profit_multiple', label: 'Net profit multiple (last 12 months)' }, { value: 'manual', label: 'Manual value' }]} />
        <Num label="Multiple" value={s.valuation_multiple} onChange={set('valuation_multiple')} />
        {s.valuation_method === 'manual' && <Num label="Manual valuation" value={s.valuation_manual ?? ''} onChange={set('valuation_manual')} />}
        <div className="grid grid-cols-3 gap-2">
          <Text label="Lead prefix" value={s.lead_prefix} onChange={set('lead_prefix')} maxLength={12} />
          <Text label="Deal prefix" value={s.deal_prefix} onChange={set('deal_prefix')} maxLength={12} />
          <Text label="Task prefix" value={s.task_prefix} onChange={set('task_prefix')} maxLength={12} />
        </div>
        <Text label="Reason for the change (kept in the audit log)" value={reason} onChange={setReason} maxLength={500} />
        <div className="flex justify-end"><button type="submit" className="btn-primary">Save</button></div>
      </form>
    </div>
  );
}

function Audit() {
  const [rows, setRows] = useState(null);
  const [entity, setEntity] = useState('');
  useEffect(() => { gulatiApi.audit({ limit: 150, ...(entity ? { entity } : {}) }).then(setRows, () => setRows([])); }, [entity]);
  const entities = ['setting', 'lead', 'deal', 'purchase', 'sale', 'payment', 'expense', 'period', 'party', 'person', 'task', 'user', 'category', 'unit', 'trading_type', 'document'];
  return (
    <section className={`${card} space-y-3`}>
      <Select label="Show" value={entity} onChange={setEntity} options={entities.map((e) => ({ value: e, label: titleCase(e) }))} blank="Everything" className="max-w-xs" />
      {!rows ? <div className="text-sm text-tertiary-500">Loading...</div> : rows.length === 0 ? <Empty>No changes recorded.</Empty> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-sm"><thead className="text-left text-xs text-tertiary-500"><tr><th className="py-1 font-medium">When</th><th className="font-medium">What</th><th className="font-medium">Change</th><th className="font-medium">Reason</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t align-top"><td className="py-1.5 pr-3 whitespace-nowrap text-xs text-tertiary-500">{dayOf(r.created_at)} {String(r.created_at).slice(11, 16)}</td><td className="pr-3">{titleCase(r.entity)} · {r.action}</td><td className="pr-3 text-xs text-tertiary-600"><code className="break-all">{r.after ? JSON.stringify(r.after).slice(0, 160) : ''}</code></td><td className="text-xs text-tertiary-600">{r.reason || ''}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

export default function GulatiSettingsPage() {
  const { me, loading } = useGulati();
  const { pushError } = useAlerts();
  const [tab, setTab] = useState('general');
  const [types, setTypes] = useState([]);
  const [units, setUnits] = useState([]);
  const [cats, setCats] = useState([]);
  const load = useCallback(() => {
    gulatiApi.tradingTypes().then(setTypes, () => {});
    gulatiApi.units().then(setUnits, () => {});
    gulatiApi.categories().then(setCats, () => {});
  }, []);
  useEffect(() => { if (me && gxCan(me, 'settings')) load(); }, [me, load]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!gxCan(me, 'settings')) return <Navigate to="/gulati" replace />;
  const attempt = (fn) => async (...a) => {
    try { await fn(...a); resetMasters(); load(); } catch (e) { pushError(gulatiError(e, 'Could not save'), 'Could not save'); }
  };
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={TABS} value={tab} onChange={setTab} className="min-w-0" />
      {tab === 'general' && <General />}
      {tab === 'types' && <MasterEditor title="Trading types" hint="Copper Cathode and Trading of Deals are built in; add more, rename or switch any off. A switched-off type stays on old records." rows={types} labelKey="label" onAdd={attempt((label) => gulatiApi.createTradingType({ label }))} onUpdate={attempt((r, body) => gulatiApi.updateTradingType(r.key, body))} />}
      {tab === 'units' && <MasterEditor title="Quantity units" hint="Shown in the unit pickers on leads and deals." rows={units} labelKey="name" onAdd={attempt((name) => gulatiApi.createUnit({ name }))} onUpdate={attempt((r, body) => gulatiApi.updateUnit(r.id, body))} onDelete={attempt(async (r) => { if (window.confirm(`Delete ${r.name}? Existing records keep it.`)) await gulatiApi.deleteUnit(r.id); })} />}
      {tab === 'categories' && <MasterEditor title="Revenue and expense categories" hint="Deal expenses (transportation, brokerage...) and company entries use these." rows={cats} labelKey="name" extraAdd={{ label: 'Kind', initial: 'expense', options: [{ value: 'expense', label: 'Expense' }, { value: 'revenue', label: 'Income' }] }} onAdd={attempt((name, kind) => gulatiApi.createCategory({ name, kind }))} onUpdate={attempt((r, body) => gulatiApi.updateCategory(r.id, body))} onDelete={attempt(async (r) => { if (window.confirm(`Delete ${r.name}?`)) await gulatiApi.deleteCategory(r.id); })} />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}
