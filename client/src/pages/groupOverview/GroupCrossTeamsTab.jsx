import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { confirmAction } from '../../lib/confirmAction.js';
import Drawer from '../../components/ui/Drawer.jsx';

const label = 'block text-xs font-medium text-tertiary-600';
const input = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm';

/**
 * Group Dashboard > Cross-functional teams: teams that cut across the group's companies. Each has a name, a description, the companies it
 * covers (none chosen = all) and members from any of those companies; a person can be in several teams.
 */
export default function GroupCrossTeamsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // null | {} (new) | team
  const [search, setSearch] = useState('');
  const load = useCallback(() => apiClient.get('/group-teams').then(({ data: res }) => setData(res.data)).catch((err) => { setData({ teams: [], companies: [] }); pushError(apiErrorMessage(err, 'Could not load the teams'), 'Something went wrong'); }), [pushError]);
  useEffect(() => { load(); }, [load]);
  async function remove(t) {
    if (!await confirmAction(`Delete the team "${t.name}"? Its members stay in their companies.`)) return;
    try { await apiClient.delete(`/group-teams/${t.id}`); pushSuccess('Team deleted'); load(); } catch (err) { pushError(apiErrorMessage(err, 'Could not delete it'), 'Not deleted'); }
  }
  const q = search.trim().toLowerCase();
  const teams = (data?.teams || []).filter((t) => !q || `${t.name} ${t.description || ''} ${t.members.map((m) => m.name).join(' ')}`.toLowerCase().includes(q));
  return (
    <div className="space-y-3" data-testid="cross-teams">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a team or a person" className="w-64 rounded-xl border border-tertiary-200 px-3 py-2 text-sm" />
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setEditing({})} data-testid="cross-team-new"><Plus className="h-4 w-4" />New team</button>
      </div>
      {!data ? <p className="text-sm text-tertiary-500">Loading...</p> : teams.length === 0 ? <p className="rounded-2xl border border-dashed border-tertiary-200 p-6 text-center text-sm text-tertiary-500">No cross-functional teams yet.</p> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => (
            <section key={t.id} className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="cross-team-card">
              <div className="flex items-start justify-between gap-2">
                <h3 className="flex items-center gap-1.5 font-heading text-sm font-semibold text-tertiary-900"><UsersRound className="h-4 w-4 text-primary-600" />{t.name}</h3>
                <span className="flex gap-1">
                  <button type="button" aria-label="Edit team" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-primary-50 hover:text-primary-700" onClick={() => setEditing(t)}><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Delete team" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(t)}><Trash2 className="h-3.5 w-3.5" /></button>
                </span>
              </div>
              {t.description && <p className="mt-1 whitespace-pre-line text-xs text-tertiary-600">{t.description}</p>}
              <div className="mt-2 flex flex-wrap gap-1">{t.all_companies ? <span className="rounded-full bg-tertiary-100 px-2 py-0.5 text-[11px] text-tertiary-700">All companies</span> : t.companies.map((c) => <span key={c.id} className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] text-primary-800">{c.name}</span>)}</div>
              {t.lead && <p className="mt-2 text-xs text-tertiary-600">Lead: <span className="font-medium text-tertiary-900">{t.lead.name}</span></p>}
              <p className="mt-2 text-xs font-semibold text-tertiary-700">{t.member_count} member{t.member_count === 1 ? '' : 's'}</p>
              <ul className="mt-1 space-y-0.5 text-xs">{t.members.slice(0, 12).map((m) => <li key={m.user_id} className="flex justify-between gap-2"><span className="text-tertiary-900">{m.name}</span><span className="text-tertiary-500">{m.company || ''}</span></li>)}{t.members.length > 12 && <li className="text-tertiary-400">+ {t.members.length - 12} more</li>}</ul>
            </section>
          ))}
        </div>
      )}
      <TeamDrawer team={editing} companies={data?.companies || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </div>
  );
}

function TeamDrawer({ team, companies, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const open = team !== null;
  const [form, setForm] = useState({ name: '', description: '', company_ids: [], lead_user_id: '' });
  const [members, setMembers] = useState([]); // [{ user_id, name, org_id }]
  const [people, setPeople] = useState([]);
  const [find, setFind] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({ name: team.name || '', description: team.description || '', company_ids: (team.companies || []).map((c) => c.id), lead_user_id: team.lead?.id || '' });
    setMembers((team.members || []).map((m) => ({ user_id: m.user_id, name: m.name, org_id: m.org_id, company: m.company })));
    setFind('');
  }, [open, team]);
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      apiClient.get('/group-teams/people', { params: { ...(find.trim() ? { search: find.trim() } : {}), ...(form.company_ids.length ? { company_ids: form.company_ids.join(',') } : {}) } })
        .then(({ data }) => setPeople(data.data || [])).catch(() => setPeople([]));
    }, 250);
    return () => clearTimeout(t);
  }, [open, find, form.company_ids]);
  const chosen = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);
  const toggleCompany = (id) => setForm((f) => ({ ...f, company_ids: f.company_ids.includes(id) ? f.company_ids.filter((x) => x !== id) : [...f.company_ids, id] }));
  const addPerson = (p) => setMembers((cur) => (cur.some((m) => m.user_id === p.user_id) ? cur : [...cur, { user_id: p.user_id, name: p.name, org_id: p.companies[0]?.org_id || null, company: p.companies[0]?.name || null }]));
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name: form.name.trim(), description: form.description.trim() || null, company_ids: form.company_ids, lead_user_id: form.lead_user_id || null };
      const saved = team.id ? (await apiClient.patch(`/group-teams/${team.id}`, body)).data.data : (await apiClient.post('/group-teams', body)).data.data;
      await apiClient.put(`/group-teams/${saved.id}/members`, { members: members.map((m) => ({ user_id: m.user_id, org_id: m.org_id })) });
      pushSuccess(`${saved.name} saved`);
      onSaved();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not save the team'), 'Not saved'); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} title={team?.id ? `Edit ${team.name}` : 'New cross-functional team'} onClose={onClose} size="lg" tone={team?.id ? 'edit' : 'create'} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="cross-team-form" className="btn-primary" disabled={saving || !form.name.trim()} data-testid="cross-team-save">{saving ? 'Saving...' : 'Save team'}</button></>}>
      <form id="cross-team-form" onSubmit={save} className="space-y-3">
        <label className={label}>Team name<input className={input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required data-testid="cross-team-name" /></label>
        <label className={label}>Team description<textarea className={input} rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What the team is for, how it works" /></label>
        <div>
          <p className={label}>Companies <span className="font-normal text-tertiary-400">(none chosen = every company of the group)</span></p>
          <div className="mt-1 flex flex-wrap gap-1.5">{companies.map((c) => <label key={c.id} className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${form.company_ids.includes(c.id) ? 'border-primary-300 bg-primary-50 text-primary-800' : 'border-tertiary-200 text-tertiary-700'}`}><input type="checkbox" className="hidden" checked={form.company_ids.includes(c.id)} onChange={() => toggleCompany(c.id)} />{c.name}</label>)}</div>
        </div>
        <div>
          <p className={label}>Members ({members.length})</p>
          <div className="mt-1 flex flex-wrap gap-1.5">{members.map((m) => <span key={m.user_id} className="inline-flex items-center gap-1 rounded-full bg-tertiary-100 px-2 py-0.5 text-xs text-tertiary-800">{m.name}{m.company ? <span className="text-tertiary-500">· {m.company}</span> : null}<button type="button" aria-label={`Remove ${m.name}`} className="text-tertiary-400 hover:text-danger-600" onClick={() => setMembers((cur) => cur.filter((x) => x.user_id !== m.user_id))}>&times;</button></span>)}</div>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find people to add" className={`${input} mt-2`} data-testid="cross-team-find" />
          <ul className="mt-1 max-h-52 divide-y divide-tertiary-100 overflow-y-auto rounded-xl border border-tertiary-100">
            {people.filter((p) => !chosen.has(p.user_id)).slice(0, 40).map((p) => (
              <li key={p.user_id}><button type="button" className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-primary-50" onClick={() => addPerson(p)} data-testid="cross-team-person"><span>{p.name}</span><span className="text-xs text-tertiary-500">{p.companies.map((c) => c.name).join(', ')}</span></button></li>
            ))}
            {people.length === 0 && <li className="px-3 py-2 text-xs text-tertiary-500">Nobody found.</li>}
          </ul>
        </div>
        <label className={label}>Team lead (optional)
          <select className={input} value={form.lead_user_id} onChange={(e) => setForm((f) => ({ ...f, lead_user_id: e.target.value }))}><option value="">No lead</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select>
        </label>
      </form>
    </Drawer>
  );
}
