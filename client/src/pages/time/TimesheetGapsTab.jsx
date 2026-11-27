import { useEffect, useMemo, useState } from 'react';
import { CalendarX2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import useSavedState from '../../lib/useSavedState.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// how each day cell looks: hours logged, a gap (working day, nothing logged on that project), leave, a day off, outside the allocation
const CELL = {
  logged: 'bg-success-50 text-success-800',
  gap: 'bg-danger-100 text-danger-700 font-semibold',
  leave: 'bg-sky-50 text-sky-700',
  off: 'bg-tertiary-50 text-tertiary-300',
  future: 'text-tertiary-300',
  not_allocated: 'bg-white text-tertiary-200',
};

/**
 * Time & Attendance > Timesheet gaps: the whole month in one table. One row per person and project they are allocated to, one column
 * per day: the hours logged, or a red mark on a working day when nothing was logged on that project. Rows with the most gaps come first.
 */
export default function TimesheetGapsTab() {
  const { pushError } = useAlerts();
  const now = new Date();
  const [month, setMonth] = useSavedState('timesheetGaps.month', now.getMonth() + 1);
  const [year, setYear] = useSavedState('timesheetGaps.year', now.getFullYear());
  const [projectId, setProjectId] = useSavedState('timesheetGaps.project', '');
  const [onlyGaps, setOnlyGaps] = useSavedState('timesheetGaps.onlyGaps', true);
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    apiClient.get('/timesheets/missing-matrix', { params: { year, month, ...(projectId ? { project_id: projectId } : {}), only_gaps: onlyGaps } })
      .then(({ data: res }) => { if (live) setData(res.data); })
      .catch((err) => { if (live) { setData({ dates: [], rows: [], projects: [], summary: null }); pushError(apiErrorMessage(err, 'Could not load the timesheet gaps'), 'Something went wrong'); } });
    return () => { live = false; };
  }, [year, month, projectId, onlyGaps]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => (data?.rows || []).filter((r) => !q || `${r.name} ${r.project.name}`.toLowerCase().includes(q)), [data, q]);
  const s = data?.summary;
  return (
    <div className="space-y-3" data-testid="timesheet-gaps">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-xl font-semibold text-tertiary-900"><CalendarX2 className="h-5 w-5" /> Timesheet gaps</h2>
          <p className="mt-1 text-sm text-tertiary-500">The whole month at once: for each person and project, the hours logged each day. A red mark is a working day (no holiday, no full-day leave) inside the allocation with nothing logged on that project.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month" className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Project
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project" className="mt-1 block max-w-[14rem] rounded-xl border px-3 py-2 text-sm"><option value="">All projects</option>{(data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Search
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Person or project" className="mt-1 block w-44 rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-xs text-tertiary-700"><input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} data-testid="gaps-only" /> Only rows with gaps</label>
        </div>
      </div>
      {s && <p className="text-sm text-tertiary-700">{s.with_gaps} of {s.rows} person-project rows have gaps · {s.gap_days} missing days in all</p>}
      <div className="flex flex-wrap gap-3 text-[11px] text-tertiary-600">
        {[['logged', '8 = hours logged'], ['gap', '✕ = not logged'], ['leave', 'L = leave'], ['off', 'day off / holiday'], ['not_allocated', '– = not on the project']].map(([k, l]) => <span key={k} className="inline-flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded border border-tertiary-200 ${CELL[k]}`} />{l}</span>)}
      </div>
      <div className="overflow-auto rounded-2xl border border-tertiary-100 bg-white shadow-card" style={{ maxHeight: 'calc(100dvh - 22rem)' }}>
        {!data ? <p className="p-4 text-sm text-tertiary-500">Loading...</p> : rows.length === 0 ? <p className="p-6 text-center text-sm text-tertiary-500">{onlyGaps ? 'No gaps this month.' : 'No project allocations this month.'}</p> : (
          <table className="min-w-full border-separate border-spacing-0 text-xs" data-testid="gaps-table">
            <thead className="sticky top-0 z-10 bg-white">
              <tr>
                <th className="sticky left-0 z-20 border-b bg-white px-2 py-1.5 text-left font-semibold text-tertiary-600">Person</th>
                <th className="border-b px-2 py-1.5 text-left font-semibold text-tertiary-600">Project</th>
                <th className="border-b px-2 py-1.5 text-right font-semibold text-danger-700">Gaps</th>
                {data.dates.map((d) => <th key={d.date} className={`border-b px-0.5 py-1 text-center font-medium ${d.weekday === 0 || d.weekday === 6 ? 'text-tertiary-300' : 'text-tertiary-600'}`}><div>{Number(d.date.slice(8))}</div><div className="text-[9px]">{WD[d.weekday]}</div></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid="gaps-row">
                  <td className="sticky left-0 z-10 whitespace-nowrap border-b bg-white px-2 py-1 font-medium text-tertiary-900">{r.name}{r.department && <span className="block text-[10px] font-normal text-tertiary-500">{r.department}</span>}</td>
                  <td className="whitespace-nowrap border-b px-2 py-1 text-tertiary-700">{r.project.name}</td>
                  <td className={`border-b px-2 py-1 text-right font-semibold ${r.gap_count ? 'text-danger-700' : 'text-success-700'}`}>{r.gap_count}</td>
                  {data.dates.map((d) => {
                    const c = r.days[d.date];
                    const text = c.state === 'logged' ? c.hours : c.state === 'gap' ? '✕' : c.state === 'leave' ? 'L' : c.state === 'not_allocated' ? '–' : '';
                    return <td key={d.date} title={`${d.date}: ${c.state.replace('_', ' ')}${c.hours ? `, ${c.hours}h` : ''}`} className={`h-7 w-7 min-w-[1.75rem] border-b border-l border-tertiary-50 text-center ${CELL[c.state] || ''}`}>{text}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
