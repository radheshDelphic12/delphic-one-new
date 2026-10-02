import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const hoursLabel = (n) => `${Number(n || 0)} hrs`;

/**
 * Project team timesheet: for a project you are allocated to, who is on the team, who has logged,
 * and how many hours (per person, per date, total). For tracking and transparency only - it never
 * limits anyone's hours. You can only open projects you are assigned to.
 */
export default function ProjectTeamTimesheet() {
  const { pushError } = useAlerts();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [projects, setProjects] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [team, setTeam] = useState(null);

  useEffect(() => {
    apiClient.get('/timesheets/my-projects')
      .then(({ data }) => {
        const rows = (data.data || []).filter((p) => !p.via_team);
        setProjects(rows);
        if (rows.length) setAccountId((current) => current || rows[0].id);
      })
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!accountId) { setTeam(null); return undefined; }
    let alive = true;
    setTeam(null);
    apiClient.get('/timesheets/project-team', { params: { account_id: accountId, year, month } })
      .then(({ data }) => { if (alive) setTeam(data.data); })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the project timesheet'), 'Something went wrong'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, year, month]);

  const columns = [
    { key: 'name', header: 'Team member', render: (r) => r.name },
    { key: 'assigned', header: 'Assigned', render: (r) => (r.assigned ? 'Yes' : <span className="text-tertiary-400">No (team mate)</span>) },
    { key: 'logged', header: 'Logged hours', render: (r) => (r.has_logged ? hoursLabel(r.total_hours) : <span className="text-tertiary-400">Not logged</span>) },
    { key: 'approved', header: 'Approved', render: (r) => hoursLabel(r.approved_hours) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Timesheet</p>
          <h2 className="mt-1 flex items-center gap-2 font-heading text-xl font-semibold text-tertiary-900"><Users className="h-5 w-5" /> Project team timesheet</h2>
          <p className="mt-1 text-sm text-tertiary-500">Hours logged by everyone on a project you are assigned to. For tracking only - there is no hour limit.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="text-xs font-medium text-tertiary-600">Project
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mt-1 block min-w-[12rem] rounded-xl border px-3 py-2 text-sm">
              {projects.length === 0 && <option value="">No assigned projects</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
        </div>
      </div>
      {accountId && (
        <>
          <DataTable
            columns={columns}
            rows={[...(team?.members || []), ...(team ? [{ org_membership_id: 'total', name: 'Project total', assigned: true, has_logged: true, total_hours: team.total_hours, approved_hours: team.members.reduce((s, m) => s + m.approved_hours, 0) }] : [])]}
            loading={!team}
            emptyLabel="Nobody is assigned to this project in the selected month"
          />
          {team && team.dates.length > 0 && (
            <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
              <h3 className="font-heading text-sm font-semibold text-tertiary-900">Date-wise hours</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-tertiary-500">
                      <th className="py-1 pr-4">Team member</th>
                      {team.dates.map((d) => <th key={d.date} className="px-2 py-1 text-right tabular-nums">{Number(d.date.slice(8))}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tertiary-100">
                    {team.members.filter((m) => m.has_logged).map((m) => (
                      <tr key={m.org_membership_id}>
                        <td className="py-1 pr-4 font-medium text-tertiary-800">{m.name}</td>
                        {team.dates.map((d) => <td key={d.date} className="px-2 py-1 text-right tabular-nums">{m.days[d.date] || ''}</td>)}
                      </tr>
                    ))}
                    <tr className="font-semibold text-tertiary-900">
                      <td className="py-1 pr-4">Total</td>
                      {team.dates.map((d) => <td key={d.date} className="px-2 py-1 text-right tabular-nums">{d.hours}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
