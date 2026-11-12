import { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import HrSettingsPage from '../../pages/people/HrSettingsPage.jsx';

const selectCls = 'w-full rounded-lg border border-tertiary-200 bg-white px-2 py-1 text-xs focus:border-primary-500 focus:outline-none';

/** Who is on which team and who they report to, for the company that is open. Saves as you pick. */
function PeopleAndReporting({ refreshKey }) {
  const { pushError, pushInfo } = useAlerts();
  const [people, setPeople] = useState(null);
  const [teams, setTeams] = useState([]);

  const load = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([apiClient.get('/orgs/memberships'), apiClient.get('/teams')]);
      // the group account heads every company from above; it is not one of this company's people
      setPeople((m.data.data || []).filter((p) => p.employment_status !== 'terminated' && !p.person?.is_group_superadmin));
      setTeams(t.data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not load the people of this company'), 'Something went wrong');
      setPeople([]);
    }
  }, [pushError]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const byName = useMemo(() => [...(people || [])].sort((a, b) => (a.person?.name || '').localeCompare(b.person?.name || '')), [people]);

  async function save(person, patch) {
    try {
      await apiClient.patch(`/orgs/memberships/${person.id}`, patch);
      pushInfo(`${person.person?.name} saved`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Could not save');
    }
  }

  if (people === null) return <p className="py-6 text-center text-sm text-tertiary-500">Loading…</p>;
  if (!people.length) return <EmptyState title="No people in this company yet" description="Add users first (Users tab); they then appear here to be placed in a team." />;

  return (
    <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
      <table className="min-w-full text-sm" aria-label="People, teams and reporting">
        <thead className="bg-tertiary-50 text-xs text-tertiary-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Person</th>
            <th className="px-3 py-2 text-left font-medium">Team</th>
            <th className="px-3 py-2 text-left font-medium">Reports to</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-tertiary-100">
          {byName.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2">
                <div className="font-medium text-tertiary-900">{p.person?.name}</div>
                <div className="text-xs text-tertiary-500">{p.designation?.name || (p.role === 'admin' ? 'Company admin' : '')}</div>
              </td>
              <td className="px-3 py-2">
                <select className={selectCls} aria-label={`Team of ${p.person?.name}`} value={p.team?.id || ''} onChange={(e) => save(p, { team_id: e.target.value || null })}>
                  <option value="">Not in a team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </td>
              <td className="px-3 py-2">
                <select className={selectCls} aria-label={`Reports to, for ${p.person?.name}`} value={p.manager?.id || ''} onChange={(e) => save(p, { manager_id: e.target.value || null })}>
                  <option value="">Company admin (no one else)</option>
                  {byName.filter((o) => o.id !== p.id).map((o) => <option key={o.id} value={o.id}>{o.person?.name}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Teams, hiring plan (open positions) and reporting lines for one company's workspace: the same Teams screen that
 * People > HR Settings gives Delphic Global, plus who sits in which team and who reports to whom. What is set here is
 * what the Group Dashboard org chart draws for this company.
 */
export default function CompanyStructure() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div>
          <h3 className="font-heading text-base font-semibold text-tertiary-900">Teams and hiring plan</h3>
          <p className="text-xs text-tertiary-500">Create teams, name a lead, say who a team reports to, and set how many positions are open. They appear as yellow boxes in the Group Dashboard org chart.</p>
        </div>
        <HrSettingsPage only={['teams', 'departments']} onChanged={() => setRefreshKey((n) => n + 1)} />
      </section>
      <section className="space-y-2">
        <div>
          <h3 className="font-heading text-base font-semibold text-tertiary-900">People and reporting</h3>
          <p className="text-xs text-tertiary-500">Put each person in a team and choose who they report to. Anyone left on the default reports to the company admin.</p>
        </div>
        <PeopleAndReporting refreshKey={refreshKey} />
      </section>
    </div>
  );
}
