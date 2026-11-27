import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useSavedState from '../../lib/useSavedState.js';

const PERIODS = [['week', 'This week'], ['month', 'This month'], ['quarter', 'This quarter']];
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

/**
 * Home dashboard (Delphic Global): the projects each person of a team (the IT team by default) was allocated to across this week,
 * month or quarter. The same numbers as People > Capacity & Allocation > Allocation by Period, which the link opens.
 * Shown only to people who may see allocations (the request fails otherwise and the card stays hidden).
 */
export default function TeamAllocationCard() {
  const [teams, setTeams] = useState(null);
  const [teamId, setTeamId] = useSavedState('dashboard.teamAllocation.team', '');
  const [period, setPeriod] = useSavedState('dashboard.teamAllocation.period', 'week');
  const [data, setData] = useState(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    apiClient.get('/teams').then(({ data: res }) => { if (live) setTeams(res.data || []); }).catch(() => { if (live) setHidden(true); });
    return () => { live = false; };
  }, []);
  // the IT team by default (a team whose name is or starts with "IT"), else the first team
  const chosen = useMemo(() => {
    if (!teams?.length) return '';
    if (teamId && teams.some((t) => t.id === teamId)) return teamId;
    const it = teams.find((t) => /^\s*it\b/i.test(t.name) || /\binformation technology\b/i.test(t.name));
    return (it || teams[0]).id;
  }, [teams, teamId]);

  useEffect(() => {
    if (!chosen) return undefined;
    let live = true;
    setData(null);
    apiClient.get('/allocations/reports/period-projects', { params: { date: today(), period, team_ids: chosen } })
      .then(({ data: res }) => { if (live) setData(res.data); })
      .catch(() => { if (live) setHidden(true); });
    return () => { live = false; };
  }, [chosen, period]);

  if (hidden || (teams && teams.length === 0)) return null;
  const rows = data?.rows || [];
  return (
    <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card" data-testid="team-allocation-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary-100 px-4 py-3">
        <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><FolderKanban className="h-4 w-4 text-primary-600" /> Team allocations</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={chosen} onChange={(e) => setTeamId(e.target.value)} aria-label="Team" className="rounded-lg border border-tertiary-200 px-2 py-1 text-xs">{(teams || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <div className="inline-flex rounded-lg border border-tertiary-200 p-0.5">
            {PERIODS.map(([k, l]) => <button key={k} type="button" onClick={() => setPeriod(k)} data-testid={`team-allocation-${k}`} className={`rounded-md px-2 py-0.5 text-xs ${period === k ? 'bg-primary-600 text-white' : 'text-tertiary-600'}`}>{l}</button>)}
          </div>
          <Link to="/people?section=capacity&view=period" className="text-xs font-medium text-primary-700 hover:underline">Full report</Link>
        </div>
      </div>
      {!data ? <p className="px-4 py-3 text-sm text-tertiary-500">Loading...</p> : (
        <>
          <p className="px-4 pt-2 text-[11px] text-tertiary-500">{fmt(data.from)} to {fmt(data.to)} · {rows.length} people · {rows.filter((r) => r.projects.length === 0).length} with no project</p>
          <ul className="max-h-80 divide-y divide-tertiary-100 overflow-y-auto px-4 pb-2">
            {rows.length === 0 && <li className="py-3 text-sm text-tertiary-500">Nobody in this team.</li>}
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <span className="font-medium text-tertiary-900">{r.name}</span>
                <span className="flex max-w-[70%] flex-wrap justify-end gap-1">
                  {r.projects.length === 0
                    ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">No project</span>
                    : r.projects.map((p) => <span key={p.id || p.name} className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-800" title={p.client_name || ''}>{p.name}</span>)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
