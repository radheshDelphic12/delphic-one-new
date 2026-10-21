import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Pill from '../ui/Pill.jsx';

const inputCls = 'mt-1 block w-full rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const BASE = [['employee', 'Employee (self-service)'], ['bda', 'BDA'], ['sales', 'Sales'], ['recruiter', 'Recruiter'], ['admin', 'Admin']];
const SCOPE = [['own', 'Own'], ['team', 'Team'], ['all', 'Everyone']];

/** One permission row: a checkbox, plus Own / Team / Everyone when the action has a scope. */
function Action({ action, value, onChange }) {
  const on = Boolean(value);
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <label className="flex items-center gap-2 text-sm text-tertiary-800">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? (action.scoped ? 'all' : true) : false)} />
        {action.label}
      </label>
      {action.scoped && (
        <select disabled={!on} value={on ? value : 'all'} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-tertiary-200 px-2 py-1 text-xs disabled:opacity-40" aria-label={`${action.label} scope`}>
          {SCOPE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
    </div>
  );
}

function Editor({ role, catalog, onSaved, onDeleted }) {
  const { pushError, pushSuccess } = useAlerts();
  const [name, setName] = useState(role.name || '');
  const [description, setDescription] = useState(role.description || '');
  const [base, setBase] = useState(role.base_role || 'employee');
  const [perms, setPerms] = useState(role.permissions || {});
  const [saving, setSaving] = useState(false);
  const setPerm = (key) => (value) => setPerms((p) => {
    const next = { ...p };
    if (value) next[key] = value; else delete next[key];
    return next;
  });

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null, base_role: base, permissions: perms };
      const { data } = role.id ? await apiClient.patch(`/roles/${role.id}`, body) : await apiClient.post('/roles', body);
      pushSuccess('Role saved');
      onSaved(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the role'), 'Not saved');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the role "${role.name}"?`)) return;
    try {
      await apiClient.delete(`/roles/${role.id}`);
      pushSuccess('Role deleted');
      onDeleted();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not delete the role'), 'Not deleted');
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>Role name<input required minLength={2} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className={labelCls}>Plain role it builds on
          <select className={inputCls} value={base} onChange={(e) => setBase(e.target.value)}>{BASE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      </div>
      <label className={labelCls}>Description<input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <p className="text-xs text-tertiary-500">The plain role keeps the person&apos;s access to everything the permissions below do not cover, so nobody loses a screen. The ticked permissions decide the actions listed here.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {catalog.map((m) => (
          <fieldset key={m.module} className="rounded-xl border border-tertiary-100 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500">{m.label}</legend>
            {m.actions.map((a) => <Action key={a.key} action={a} value={perms[a.key]} onChange={setPerm(a.key)} />)}
          </fieldset>
        ))}
      </div>
      <div className="flex justify-between gap-2">
        {role.id ? <button type="button" className="btn-secondary inline-flex items-center gap-1 text-danger-600" onClick={remove}><Trash2 className="h-4 w-4" />Delete role</button> : <span />}
        <button type="submit" className="btn-primary inline-flex items-center gap-1" disabled={saving}><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save role'}</button>
      </div>
    </form>
  );
}

/** Who holds a role, with a picker to give it to someone (their plain role becomes the role's base role). */
function People({ role, people, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [members, setMembers] = useState([]);
  const [pick, setPick] = useState('');
  const load = useCallback(() => {
    apiClient.get(`/roles/${role.id}/members`).then(({ data }) => setMembers(data.data || [])).catch(() => setMembers([]));
  }, [role.id]);
  useEffect(() => { load(); }, [load]);
  const assign = async (membershipId, roleId) => {
    try {
      await apiClient.post('/roles/assign', typeof membershipId === 'object' ? { user_id: membershipId.user, role_id: roleId } : { org_membership_id: membershipId, role_id: roleId });
      pushSuccess(roleId ? 'Role given' : 'Role removed');
      setPick('');
      load();
      onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not change the role'), 'Not saved');
    }
  };
  const held = new Set(members.map((m) => m.user_id));
  return (
    <div className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <h3 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><Users className="h-4 w-4" /> People with this role</h3>
      <ul className="divide-y divide-tertiary-100 text-sm">
        {members.map((m) => (
          <li key={m.org_membership_id} className="flex items-center justify-between py-1.5">
            <span>{m.name} <span className="text-xs text-tertiary-500">{m.email}</span></span>
            <button type="button" className="text-xs text-danger-600 hover:underline" onClick={() => assign(m.org_membership_id, null)}>Remove</button>
          </li>
        ))}
        {!members.length && <li className="py-2 text-tertiary-500">Nobody yet.</li>}
      </ul>
      <div className="flex gap-2">
        <select className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Give this role to">
          <option value="">Give this role to…</option>
          {people.filter((p) => !held.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="btn-primary mt-1 inline-flex items-center gap-1" disabled={!pick} onClick={() => assign({ user: pick }, role.id)}><Plus className="h-4 w-4" />Give</button>
      </div>
    </div>
  );
}

/** The starter roles' proposed people, for confirmation. Nothing changes until "Apply" is pressed. */
function Mapping({ onApplied }) {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null);
  const [chosen, setChosen] = useState({});
  useEffect(() => {
    apiClient.get('/roles/mapping-preview').then(({ data }) => {
      setRows(data.data || []);
      setChosen(Object.fromEntries((data.data || []).filter((r) => r.status === 'match').map((r) => [r.named, r.candidates[0].org_membership_id])));
    }).catch((err) => pushError(apiErrorMessage(err, 'Could not load the mapping'), 'Something went wrong'));
  }, [pushError]);
  if (!rows) return null;
  const assignments = rows.filter((r) => chosen[r.named]).map((r) => ({ org_membership_id: chosen[r.named], role_name: r.role }));
  async function apply() {
    if (!window.confirm(`Give ${assignments.length} people their new role? Their plain role may change as shown.`)) return;
    try {
      await apiClient.post('/roles/mapping-apply', { assignments });
      pushSuccess('Roles applied');
      onApplied();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not apply'), 'Not applied');
    }
  }
  return (
    <div className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Proposed people for the starting roles</h3>
      <p className="text-xs text-tertiary-500">Review this first. Nobody changes until you press Apply. A person who is not listed here keeps exactly the access they have today.</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-tertiary-500"><th className="py-1">Role</th><th>Person</th><th>Now</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.named} className="border-t border-tertiary-100">
              <td className="py-1.5 font-medium">{r.role}</td>
              <td>
                {r.status === 'not_found' && <span className="text-warning-700">No one named &quot;{r.named}&quot; found</span>}
                {r.status !== 'not_found' && (
                  <select className="rounded-lg border border-tertiary-200 px-2 py-1 text-xs" value={chosen[r.named] || ''} onChange={(e) => setChosen((c) => ({ ...c, [r.named]: e.target.value }))}>
                    <option value="">{r.status === 'ambiguous' ? 'Pick the right person…' : 'Skip'}</option>
                    {r.candidates.map((c) => <option key={c.org_membership_id} value={c.org_membership_id}>{c.name}</option>)}
                  </select>
                )}
              </td>
              <td className="text-xs text-tertiary-500">
                {(r.candidates.find((c) => c.org_membership_id === chosen[r.named]) || {}).current_role || ''}
                {r.candidates.find((c) => c.org_membership_id === chosen[r.named])?.base_role_changes && <Pill tone="amber">plain role changes to {r.new_base_role}</Pill>}
              </td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end"><button type="button" className="btn-primary" disabled={!assignments.length} onClick={apply}>Apply to {assignments.length} {assignments.length === 1 ? 'person' : 'people'}</button></div>
    </div>
  );
}

/** Settings > Roles & permissions (Super Admin): build roles by ticking permissions, give them to people. */
export default function RolesPermissionsPanel() {
  const { pushError, pushSuccess } = useAlerts();
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState(null); // role id, or 'new'
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    apiClient.get('/roles').then(({ data }) => setRoles(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load roles'), 'Something went wrong')).finally(() => setLoading(false));
  }, [pushError]);
  useEffect(() => {
    load();
    apiClient.get('/roles/catalog').then(({ data }) => setCatalog(data.data || [])).catch(() => {});
    apiClient.get('/users/directory').then(({ data }) => setPeople((data.data || []).filter((u) => u.active !== false).map((u) => ({ id: u.id, name: u.name })))).catch(() => {});
  }, [load]);

  const current = useMemo(() => (selected === 'new' ? { name: '', permissions: {}, base_role: 'employee' } : roles.find((r) => r.id === selected)), [selected, roles]);

  async function installStarter() {
    try {
      const { data } = await apiClient.post('/roles/starter');
      pushSuccess(data.data.created.length ? `Added ${data.data.created.length} starting roles` : 'The starting roles already exist');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not add the starting roles'), 'Not saved');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <p className="max-w-2xl text-sm text-tertiary-600">Build roles by ticking what each one may do. The API enforces these, not only the screens. People with no custom role keep working exactly as before.</p>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={installStarter}>Add the starting roles</button>
          <button type="button" className="btn-primary inline-flex items-center gap-1" onClick={() => setSelected('new')}><Plus className="h-4 w-4" />New role</button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px,1fr]">
        <ul className="space-y-1 rounded-2xl border border-tertiary-100 bg-white p-2 shadow-card" aria-label="Roles">
          {loading && <li className="p-2 text-sm text-tertiary-500">Loading…</li>}
          {!loading && !roles.length && <li className="p-2 text-sm text-tertiary-500">No roles yet. Add the starting roles, or make a new one.</li>}
          {roles.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setSelected(r.id)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${selected === r.id ? 'bg-primary-50 text-primary-700' : 'hover:bg-tertiary-50'}`}>
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-tertiary-500">{r.members}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-4">
          {current && <Editor key={selected} role={current} catalog={catalog} onSaved={(r) => { load(); setSelected(r.id); }} onDeleted={() => { setSelected(null); load(); }} />}
          {current && current.id && <People role={current} people={people} onChanged={load} />}
          {!current && <Mapping onApplied={load} />}
        </div>
      </div>
    </div>
  );
}
