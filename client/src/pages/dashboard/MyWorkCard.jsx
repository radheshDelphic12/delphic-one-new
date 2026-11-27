import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FolderKanban } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useSavedState from '../../lib/useSavedState.js';

const PERIODS = [['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']];
const fmt = (h) => (h ? Number(h).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '');

/**
 * Dashboard > My projects: the projects you are allocated to and the hours you logged on each, for a week (day by day), a month (week by
 * week), a quarter or a year (month by month). Move back and forward with the arrows. Hidden for someone with no projects at all.
 */
export default function MyWorkCard() {
  const [period, setPeriod] = useSavedState('dashboard.myWork.period', 'week');
  const [date, setDate] = useState('');
  const [data, setData] = useState(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let live = true;
    apiClient.get('/timesheets/my-work', { params: { period, ...(date ? { date } : {}) } })
      .then(({ data: res }) => { if (live) setData(res.data); })
      .catch(() => { if (live) setHidden(true); });
    return () => { live = false; };
  }, [period, date]);
  if (hidden || (data && data.projects.length === 0 && !date && period === 'week' && data.total_hours === 0 && data.projects.every((p) => !p.allocated))) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card" data-testid="my-work-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary-100 px-4 py-3">
        <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><FolderKanban className="h-4 w-4 text-primary-600" /> My projects</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-tertiary-200 p-0.5">
            {PERIODS.map(([k, l]) => <button key={k} type="button" onClick={() => { setPeriod(k); setDate(''); }} data-testid={`my-work-${k}`} className={`rounded-md px-2 py-0.5 text-xs ${period === k ? 'bg-primary-600 text-white' : 'text-tertiary-600'}`}>{l}</button>)}
          </div>
          <span className="inline-flex items-center gap-1 text-xs text-tertiary-700">
            <button type="button" aria-label="Previous" className="rounded border border-tertiary-200 p-0.5" disabled={!data} onClick={() => setDate(data.previous)}><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span className="min-w-[7rem] text-center font-medium" data-testid="my-work-label">{data?.label || '…'}</span>
            <button type="button" aria-label="Next" className="rounded border border-tertiary-200 p-0.5" disabled={!data} onClick={() => setDate(data.next)}><ChevronRight className="h-3.5 w-3.5" /></button>
          </span>
        </div>
      </div>
      {!data ? <p className="px-4 py-3 text-sm text-tertiary-500">Loading...</p> : data.projects.length === 0 ? <p className="px-4 py-3 text-sm text-tertiary-500">No projects in this period.</p> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted text-left text-[11px] uppercase text-tertiary-500">
              <tr>
                <th className="px-3 py-2">Project</th>
                {data.parts.map((p) => <th key={p.key} className="whitespace-nowrap px-2 py-2 text-right">{p.label}</th>)}
                <th className="px-3 py-2 text-right">Total h</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((r) => (
                <tr key={r.id} className="border-t border-tertiary-100" data-testid="my-work-row">
                  <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{r.name}</span>
                    <span className="block text-[11px] text-tertiary-500">{[r.client, r.allocated ? `allocated${r.allocation?.percent != null ? ` ${r.allocation.percent}%` : ''}${r.allocation?.to ? ` until ${r.allocation.to}` : ''}` : 'hours logged, not allocated'].filter(Boolean).join(' · ')}</span></td>
                  {data.parts.map((p) => <td key={p.key} className={`px-2 py-2 text-right tabular-nums ${r.by_part[p.key] ? 'text-tertiary-900' : 'text-tertiary-300'}`}>{fmt(r.by_part[p.key]) || '-'}</td>)}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(r.hours) || 0}</td>
                </tr>
              ))}
              <tr className="border-t border-tertiary-200 bg-canvas-muted text-xs font-semibold">
                <td className="px-3 py-2">Total</td>
                {data.parts.map((p) => <td key={p.key} className="px-2 py-2 text-right tabular-nums">{fmt(data.totals[p.key]) || '-'}</td>)}
                <td className="px-3 py-2 text-right tabular-nums">{fmt(data.total_hours) || 0}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
