import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Save, Search, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { isPermissionMode, isSuperAdminLevel, LEVEL_LABEL } from '../../lib/access.js';
import Pill from '../ui/Pill.jsx';
import PermissionGrid, { rankOf } from './PermissionGrid.jsx';
import AccessMigrationPanel from './AccessMigrationPanel.jsx';

const inputCls = 'mt-1 block w-full rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const box = 'rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card';
const levelTone = { super_admin: 'purple', admin: 'blue', employee: 'gray' };

/** (set + grants) - removals, as the permissions the person ends up with. Mirrors the server. */
function combine(setPerms, grants, removed) {
  const out = { ...(setPerms || {}) };
  for (const [k, v] of Object.entries(grants)) out[k] = !out[k] || rankOf(v) > rankOf(out[k]) ? v : out[k];
  for (const k of removed) delete out[k];
  return out;
}

const describe = (diff, labelOf) => [
  ...(diff.set.from !== diff.set.to ? [`Permission set: ${diff.set.from || 'none'} -> ${diff.set.to || 'none'}`] : []),
  ...diff.granted.map((g) => `Add: ${labelOf(g.key)}${g.scope && g.scope !== 'true' ? ` (${g.scope})` : ''}`),
  ...diff.changed.map((g) => `Change: ${labelOf(g.key)} ${g.from} -> ${g.to}`),
  ...diff.revoked.map((g) => `Remove: ${labelOf(g.key)}`),
  ...diff.removed.map((g) => `Take away: ${labelOf(g.key)}`),
  ...diff.restored.map((g) => `Give back: ${labelOf(g.key)}`),
];

/** One person: their set, the default basic access (with removals), and their own grants. Review before saving. */
function PersonEditor({ membershipId, catalog, sets, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [detail, setDetail] = useState(null);
  const [setId, setSetId] = useState('');
  const [grants, setGrants] = useState({});
  const [removed, setRemoved] = useState([]);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDetail(null);
    setReview(null);
    apiClient.get(`/access/people/${membershipId}`).then(({ data }) => {
      const d = data.data;
      setDetail(d);
      setSetId(d.set?.id || '');
      setGrants(Object.fromEntries(d.grants.map((g) => [g.key, g.value])));
      setRemoved(d.removed);
    }).catch((err) => pushError(apiErrorMessage(err, 'Could not load this person'), 'Something went wrong'));
  }, [membershipId, pushError]);

  const labels = useMemo(() => {
    const m = new Map();
    catalog.categories.forEach((c) => c.modules.forEach((mod) => mod.actions.forEach((a) => m.set(a.key, `${mod.label}: ${a.label}`))));
    catalog.basic.forEach((b) => m.set(b.key, `Basic: ${b.label}`));
    return (k) => m.get(k) || k;
  }, [catalog]);
  const setPerms = sets.find((s) => s.id === setId)?.permissions || {};
  const effective = combine(setPerms, grants, removed);

  if (!detail) return <div className={box}>Loading…</div>;
  if (detail.level !== 'employee') {
    return (
      <div className={box}>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">{detail.person.name} <Pill tone={levelTone[detail.level]}>{LEVEL_LABEL[detail.level]}</Pill></h3>
        <p className="mt-2 text-sm text-tertiary-600">{detail.level === 'super_admin' ? 'The Super Admin has every permission in every company and cannot be restricted or removed by anyone else.' : 'The company Admin has every permission in this company. Change who the Admin is from the Super Admin\'s Migration tab.'}</p>
      </div>
    );
  }

  const toggleKey = (key, next) => {
    if (next) {
      if (removed.includes(key)) setRemoved(removed.filter((k) => k !== key));
      else if (!setPerms[key] || rankOf(next) > rankOf(setPerms[key])) setGrants({ ...grants, [key]: next });
    } else if (key in grants) {
      const { [key]: _gone, ...rest } = grants;
      setGrants(rest);
      if (setPerms[key]) setRemoved([...removed, key]);
    } else if (setPerms[key]) setRemoved([...removed, key]);
    setReview(null);
  };
  const toggleBasic = (key, on) => { setRemoved(on ? removed.filter((k) => k !== key) : [...removed, key]); setReview(null); };
  const body = () => ({ set_id: setId || null, grants, removed });

  async function preview() {
    setBusy(true);
    try {
      const { data } = await apiClient.post(`/access/people/${membershipId}/preview`, body());
      setReview(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not preview the change'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      await apiClient.put(`/access/people/${membershipId}`, body());
      pushSuccess('Permissions saved');
      setReview(null);
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Not saved');
    } finally {
      setBusy(false);
    }
  }

  const lines = review ? describe(review.diff, labels) : [];
  return (
    <div className="space-y-4">
      <div className={box}>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">{detail.person.name} <Pill tone="gray">Employee</Pill></h3>
        <p className="text-xs text-tertiary-500">{detail.person.employee_code || 'no code'} · {detail.person.email}{detail.person.department ? ` · ${detail.person.department}` : ''}</p>
        <label className={`${labelCls} mt-3 max-w-sm`}>Permission set
          <select className={inputCls} value={setId} onChange={(e) => { setSetId(e.target.value); setReview(null); }}>
            <option value="">None (default basic access only)</option>
            {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {detail.legacy_role && <p className="mt-2 text-xs text-tertiary-500">Before the move this person was <strong>{detail.legacy_role}</strong>{detail.legacy_locked_until ? ` (kept read-only until ${new Date(detail.legacy_locked_until).toLocaleDateString()})` : ''}.</p>}
      </div>

      <div className={box}>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Default basic access</h3>
        <p className="text-xs text-tertiary-500">Every employee has this with no setup. Untick an item to take it away from this person only. Salary, bank details, documents, personal phone and address are never part of it.</p>
        <div className="mt-2 grid gap-1 md:grid-cols-2">
          {catalog.basic.map((b) => (
            <label key={b.key} className="flex items-start gap-2 py-1 text-sm text-tertiary-800">
              <input type="checkbox" className="mt-1" checked={!removed.includes(b.key)} onChange={(e) => toggleBasic(b.key, e.target.checked)} />
              {b.label}
            </label>
          ))}
        </div>
      </div>

      <div className={box}>
        <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Permissions</h3>
        <PermissionGrid categories={catalog.categories} value={effective} fromSet={setPerms} onChange={toggleKey} />
      </div>

      {review && (
        <div className="space-y-2 rounded-2xl border border-primary-200 bg-primary-50 p-4">
          <h3 className="font-heading text-sm font-semibold text-primary-800">Review before saving</h3>
          {lines.length ? <ul className="list-disc space-y-0.5 pl-5 text-sm text-primary-900">{lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="text-sm text-primary-900">Nothing changes.</p>}
          <p className="text-xs text-primary-800">Every change is recorded in the change log: who, when and what.</p>
        </div>
      )}
      <div className="flex justify-end gap-2">
        {review && lines.length > 0 && <button type="button" className="btn-primary inline-flex items-center gap-1" disabled={busy} onClick={save}><Save className="h-4 w-4" />Save changes</button>}
        <button type="button" className={review ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={preview}>{review ? 'Review again' : 'Review changes'}</button>
      </div>
    </div>
  );
}

/** A permission set: a name and a tick-grid. There is no "plain role it builds on" any more. */
function SetEditor({ set, catalog, onSaved, onDeleted }) {
  const { pushError, pushSuccess } = useAlerts();
  const [name, setName] = useState(set.name || '');
  const [description, setDescription] = useState(set.description || '');
  const [perms, setPerms] = useState(set.permissions || {});
  const [saving, setSaving] = useState(false);
  const change = (key, next) => setPerms((p) => { const n = { ...p }; if (next) n[key] = next; else delete n[key]; return n; });

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null, permissions: perms };
      const { data } = set.id ? await apiClient.patch(`/roles/${set.id}`, body) : await apiClient.post('/roles', body);
      pushSuccess('Permission set saved');
      onSaved(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the permission set'), 'Not saved');
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Delete the permission set "${set.name}"?`)) return;
    try {
      await apiClient.delete(`/roles/${set.id}`);
      pushSuccess('Permission set deleted');
      onDeleted();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not delete the permission set'), 'Not deleted');
    }
  }
  return (
    <form onSubmit={save} className={`${box} space-y-4`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>Name<input required minLength={2} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className={labelCls}>Description<input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      </div>
      <p className="text-xs text-tertiary-500">A set bundles permissions (for example &quot;HR Lead&quot; or &quot;Sales Team&quot;). Everyone also has the default basic access. The API enforces what is ticked here, not only the menu.</p>
      <PermissionGrid categories={catalog.categories} value={perms} onChange={change} />
      <div className="flex justify-between gap-2">
        {set.id ? <button type="button" className="btn-secondary inline-flex items-center gap-1 text-danger-600" onClick={remove}><Trash2 className="h-4 w-4" />Delete set</button> : <span />}
        <button type="submit" className="btn-primary inline-flex items-center gap-1" disabled={saving}><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save set'}</button>
      </div>
    </form>
  );
}

function PeopleTab({ catalog, sets, onSetsChanged }) {
  const { pushError } = useAlerts();
  const [people, setPeople] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const load = useCallback(() => {
    apiClient.get('/access/people').then(({ data }) => setPeople(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load people'), 'Something went wrong'));
  }, [pushError]);
  useEffect(() => { load(); }, [load]);
  const shown = people.filter((p) => !query.trim() || `${p.name} ${p.email} ${p.employee_code || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="grid gap-4 lg:grid-cols-[300px,1fr]">
      <div className="space-y-2 rounded-2xl border border-tertiary-100 bg-white p-2 shadow-card">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" aria-hidden />
          <input className="w-full rounded-xl border border-tertiary-200 py-2 pl-9 pr-3 text-sm" placeholder="Search people" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" />
        </label>
        <ul className="max-h-[70vh] space-y-1 overflow-y-auto" aria-label="People">
          {shown.map((p) => (
            <li key={p.org_membership_id}>
              <button type="button" onClick={() => setSelected(p.org_membership_id)} className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm ${selected === p.org_membership_id ? 'bg-primary-50 text-primary-700' : 'hover:bg-tertiary-50'}`}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-tertiary-500">{p.set?.name || 'Basic access'}{p.grants ? ` · ${p.grants} extra` : ''}</span>
                </span>
                {p.level !== 'employee' && <Pill tone={levelTone[p.level]}>{LEVEL_LABEL[p.level]}</Pill>}
              </button>
            </li>
          ))}
          {!shown.length && <li className="p-2 text-sm text-tertiary-500">No one found.</li>}
        </ul>
      </div>
      <div>
        {selected ? <PersonEditor key={selected} membershipId={selected} catalog={catalog} sets={sets} onSaved={() => { load(); onSetsChanged(); }} /> : <div className={`${box} text-sm text-tertiary-600`}>Pick a person to see what they can open and to change it. Everyone starts with the default basic access; the Super Admin and the company Admin can add to it, or take an item away from one person.</div>}
      </div>
    </div>
  );
}

function SetsTab({ catalog, sets, reload }) {
  const [selected, setSelected] = useState(null);
  const current = useMemo(() => (selected === 'new' ? { name: '', permissions: {} } : sets.find((s) => s.id === selected)), [selected, sets]);
  return (
    <div className="grid gap-4 lg:grid-cols-[260px,1fr]">
      <div className="space-y-2 rounded-2xl border border-tertiary-100 bg-white p-2 shadow-card">
        <button type="button" className="btn-primary inline-flex w-full items-center justify-center gap-1" onClick={() => setSelected('new')}><Plus className="h-4 w-4" />New permission set</button>
        <ul aria-label="Permission sets" className="space-y-1">
          {sets.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setSelected(s.id)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${selected === s.id ? 'bg-primary-50 text-primary-700' : 'hover:bg-tertiary-50'}`}>
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-tertiary-500">{s.members}</span>
              </button>
            </li>
          ))}
          {!sets.length && <li className="p-2 text-sm text-tertiary-500">No permission sets yet.</li>}
        </ul>
      </div>
      <div>
        {current ? <SetEditor key={selected} set={current} catalog={catalog} onSaved={(s) => { reload(); setSelected(s.id); }} onDeleted={() => { setSelected(null); reload(); }} /> : <div className={`${box} text-sm text-tertiary-600`}>A permission set bundles permissions so you can give them to several people at once. Pick one to edit, or make a new one.</div>}
      </div>
    </div>
  );
}

/**
 * Settings > Permissions. Only the Super Admin and the company Admin open it. In a company that has moved to permissions it edits
 * people and sets; the Super Admin also gets the Migration tab (backup, preview, approve, apply, restore) in every company.
 */
export default function PermissionsPanel() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const moved = isPermissionMode(user);
  const superAdmin = isSuperAdminLevel(user);
  const [tab, setTab] = useState(moved ? 'people' : 'migration');
  const [catalog, setCatalog] = useState(null);
  const [sets, setSets] = useState([]);
  const loadSets = useCallback(() => {
    apiClient.get('/roles').then(({ data }) => setSets(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load permission sets'), 'Something went wrong'));
  }, [pushError]);
  useEffect(() => {
    apiClient.get('/access/catalog').then(({ data }) => setCatalog(data.data)).catch(() => {});
    loadSets();
  }, [loadSets]);

  const tabs = [...(moved ? [['people', 'People'], ['sets', 'Permission sets']] : []), ...(superAdmin ? [['migration', 'Migration']] : [])];
  if (!catalog) return <div className={box}>Loading…</div>;
  return (
    <div className="space-y-4">
      {!moved && <div className={`${box} text-sm text-tertiary-700`}>This company still uses the old roles. Review the move to permissions in the Migration tab; nothing changes until the Super Admin approves and applies it.</div>}
      <div role="tablist" aria-label="Permissions sections" className="flex gap-1 border-b border-tertiary-100">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`-mb-px border-b-2 px-3.5 py-2 text-sm font-medium ${tab === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500 hover:text-tertiary-800'}`}>{label}</button>
        ))}
      </div>
      {tab === 'people' && moved && <PeopleTab catalog={catalog} sets={sets} onSetsChanged={loadSets} />}
      {tab === 'sets' && moved && <SetsTab catalog={catalog} sets={sets} reload={loadSets} />}
      {tab === 'migration' && superAdmin && <AccessMigrationPanel />}
    </div>
  );
}
