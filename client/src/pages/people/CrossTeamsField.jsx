import { useCallback, useEffect, useState } from 'react';
import { UsersRound } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

/**
 * An employee's cross-functional teams (multi-select). The teams themselves are created on the Group Dashboard; here, whoever may edit
 * People picks which of the teams open to this company the person is in. Hidden when the group has no teams for this company.
 */
export default function CrossTeamsField({ membershipId, canEdit }) {
  const { pushError, pushSuccess } = useAlerts();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => apiClient.get(`/cross-teams/people/${membershipId}`).then(({ data: res }) => setData(res.data)).catch(() => setData(null)), [membershipId]);
  useEffect(() => { load(); }, [load]);
  if (!data || (data.options.length === 0 && data.teams.length === 0)) return null;
  async function save() {
    setSaving(true);
    try { const { data: res } = await apiClient.put(`/cross-teams/people/${membershipId}`, { team_ids: picked }); setData(res.data); setEditing(false); pushSuccess('Teams saved'); } catch (err) { pushError(apiErrorMessage(err, 'Could not save the teams'), 'Not saved'); } finally { setSaving(false); }
  }
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card" data-testid="cross-teams-field">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-heading text-sm font-semibold text-tertiary-900"><UsersRound className="h-4 w-4 text-primary-600" />Cross-functional teams</h3>
        {canEdit && !editing && <button type="button" className="btn-ghost text-xs" onClick={() => { setPicked(data.teams.filter((t) => data.options.some((o) => o.id === t.id)).map((t) => t.id)); setEditing(true); }} data-testid="cross-teams-edit">Edit</button>}
      </div>
      {!editing ? (
        <div className="mt-2 flex flex-wrap gap-1.5">{data.teams.length === 0 ? <span className="text-sm text-tertiary-500">Not in any team.</span> : data.teams.map((t) => <span key={t.id} className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs text-primary-800">{t.name}</span>)}</div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">{data.options.map((o) => (
            <label key={o.id} title={o.description || ''} className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${picked.includes(o.id) ? 'border-primary-300 bg-primary-50 text-primary-800' : 'border-tertiary-200 text-tertiary-700'}`}>
              <input type="checkbox" className="hidden" checked={picked.includes(o.id)} onChange={() => setPicked((cur) => (cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id]))} data-testid="cross-teams-option" />{o.name}
            </label>
          ))}</div>
          <div className="flex gap-2"><button type="button" className="btn-primary text-xs" disabled={saving} onClick={save} data-testid="cross-teams-save">{saving ? 'Saving...' : 'Save'}</button><button type="button" className="btn-secondary text-xs" onClick={() => setEditing(false)}>Cancel</button></div>
        </div>
      )}
    </section>
  );
}
