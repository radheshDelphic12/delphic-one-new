import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { Empty, Num, Select, Text, card, dayOf } from '../../components/acconcy/ui.jsx';
import { titleCase } from '../../lib/format.js';

const TABS = [
  { key: 'general', label: 'Company and valuation' },
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
    acconcyApi.settings().then(setS, () => {});
    acconcyApi.company().then(setCompany, () => {});
  }, []);
  if (!s || !company) return <div className="text-sm text-tertiary-500">Loading...</div>;
  const set = (k) => (v) => setS((c) => ({ ...c, [k]: v }));
  async function saveSettings(e) {
    e.preventDefault();
    try {
      const body = { lead_prefix: s.lead_prefix, deal_prefix: s.deal_prefix, task_prefix: s.task_prefix, investment_prefix: s.investment_prefix, profit_multiplier: Number(s.profit_multiplier), asset_multiplier: Number(s.asset_multiplier), include_investments_in_assets: Boolean(s.include_investments_in_assets), ...(reason.trim() ? { reason: reason.trim() } : {}) };
      setS(await acconcyApi.updateSettings(body));
      setReason('');
      pushSuccess('Settings saved');
    } catch (err) { pushError(acconcyError(err, 'Could not save'), 'Could not save'); }
  }
  async function saveCompany(e) {
    e.preventDefault();
    try { setCompany(await acconcyApi.updateCompany({ name: company.name, timezone: company.timezone })); pushSuccess('Company saved'); } catch (err) { pushError(acconcyError(err, 'Could not save'), 'Could not save'); }
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
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Valuation formula and numbering</h3>
        <p className="text-xs text-tertiary-500">Valuation = (profit x profit multiplier) + (asset value x asset multiplier). The multipliers are kept here once and used everywhere; every change is audited and the valuation history keeps the values used at the time.</p>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Profit multiplier" value={s.profit_multiplier} onChange={set('profit_multiplier')} />
          <Num label="Asset multiplier" value={s.asset_multiplier} onChange={set('asset_multiplier')} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(s.include_investments_in_assets)} onChange={(e) => set('include_investments_in_assets')(e.target.checked)} />Count current investment value as assets</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Text label="Lead prefix" value={s.lead_prefix} onChange={set('lead_prefix')} maxLength={12} />
          <Text label="Deal prefix" value={s.deal_prefix} onChange={set('deal_prefix')} maxLength={12} />
          <Text label="Task prefix" value={s.task_prefix} onChange={set('task_prefix')} maxLength={12} />
          <Text label="Investment prefix" value={s.investment_prefix} onChange={set('investment_prefix')} maxLength={12} />
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
  useEffect(() => { acconcyApi.audit({ limit: 150, ...(entity ? { entity } : {}) }).then(setRows, () => setRows([])); }, [entity]);
  const entities = ['setting', 'lead', 'deal', 'expense', 'investment', 'asset', 'salary', 'valuation', 'period', 'party', 'person', 'task', 'user', 'category', 'document'];
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

export default function AcconcySettingsPage() {
  const { me, loading } = useAcconcy();
  const { pushError } = useAlerts();
  const [tab, setTab] = useState('general');
  const [cats, setCats] = useState([]);
  const load = useCallback(() => {
    acconcyApi.categories().then(setCats, () => {});
  }, []);
  useEffect(() => { if (me && axCan(me, 'settings')) load(); }, [me, load]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!axCan(me, 'settings')) return <Navigate to="/acconcy" replace />;
  const attempt = (fn) => async (...a) => {
    try { await fn(...a); load(); } catch (e) { pushError(acconcyError(e, 'Could not save'), 'Could not save'); }
  };
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={TABS} value={tab} onChange={setTab} className="min-w-0" />
      {tab === 'general' && <General />}
      {tab === 'categories' && <MasterEditor title="Revenue and expense categories" hint="Revenue and expense entries (professional fees, travel, legal, consulting fees...) use these." rows={cats} labelKey="name" extraAdd={{ label: 'Kind', initial: 'expense', options: [{ value: 'expense', label: 'Expense' }, { value: 'revenue', label: 'Income' }] }} onAdd={attempt((name, kind) => acconcyApi.createCategory({ name, kind }))} onUpdate={attempt((r, body) => acconcyApi.updateCategory(r.id, body))} onDelete={attempt(async (r) => { if (window.confirm(`Delete ${r.name}?`)) await acconcyApi.deleteCategory(r.id); })} />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}
