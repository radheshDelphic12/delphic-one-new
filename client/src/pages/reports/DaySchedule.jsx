import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import MultiSelectDropdown from '../../components/ui/MultiSelectDropdown.jsx';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const toMin = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const pct = (min) => `${(min / 1440) * 100}%`;
// A start / end pair as bars on a 0-24h track; an end at or before the start runs past midnight and wraps to the morning.
function segments(start, end) {
  const s = toMin(start);
  const e = toMin(end);
  if (s == null || e == null) return [];
  return e > s ? [[s, e]] : [[s, 1440], ...(e > 0 ? [[0, e]] : [])];
}
const span = (start, end) => {
  const s = toMin(start);
  const e = toMin(end);
  const mins = e > s ? e - s : 1440 - s + e;
  return `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
};

function Track({ segs, tone, label }) {
  return (
    <div className="relative h-7 flex-1 rounded bg-tertiary-50" aria-label={label}>
      {HOURS.map((h) => <span key={h} className="absolute top-0 h-full border-l border-tertiary-100" style={{ left: pct(h * 60) }} />)}
      {segs.map(([a, b], i) => <span key={i} className={`absolute top-1 h-5 rounded ${tone}`} style={{ left: pct(a), width: pct(b - a) }} />)}
    </div>
  );
}

function Row({ name, sub, checked, onToggle, children, indent }) {
  return (
    <div className={`flex items-center gap-3 py-1 ${indent ? 'pl-6' : ''}`}>
      <label className="flex w-60 shrink-0 items-start gap-2 text-sm">
        {onToggle ? <input type="checkbox" className="mt-1" checked={checked} onChange={onToggle} /> : <span className="w-4" />}
        <span className="min-w-0"><span className="block truncate font-medium text-tertiary-900">{name}</span>{sub && <span className="block truncate text-xs text-tertiary-500">{sub}</span>}</span>
      </label>
      {children}
    </div>
  );
}

/** Reports > Day schedule: the 24-hour day with the working hours of the projects you tick, and the shifts (and people on them) beside them. */
export default function DaySchedule() {
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  const [shownProjects, setShownProjects] = useState(null); // null = all with hours
  const [shownShifts, setShownShifts] = useState(null);
  const [showPeople, setShowPeople] = useState(true);
  // Two multi-select filters that work together: the projects to draw and the employees to show under their shifts (empty = everyone).
  const [selProjects, setSelProjects] = useState([]);
  const [selPeople, setSelPeople] = useState([]);

  useEffect(() => {
    apiClient.get('/reports/day-schedule').then((res) => setData(res.data.data), (e) => pushError(apiErrorMessage(e, 'Could not load the schedule'), 'Load failed'));
  }, [pushError]);

  const withHours = useMemo(() => (data?.projects || []).filter((p) => p.start && p.end), [data]);
  const noHours = useMemo(() => (data?.projects || []).filter((p) => !(p.start && p.end)), [data]);
  const pOn = (id) => (shownProjects ? shownProjects.has(id) : true);
  const sOn = (id) => (shownShifts ? shownShifts.has(id) : true);
  const toggle = (set, setSet, all, id) => {
    const next = new Set(set || all);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  };
  const projectOptions = useMemo(() => withHours.map((p) => ({ id: p.id, label: `${p.code ? `${p.code} ` : ''}${p.name}`, hint: p.client || undefined })), [withHours]);
  const peopleOptions = useMemo(() => {
    const seen = new Map();
    (data?.shifts || []).forEach((sh) => sh.people.forEach((p) => { if (!seen.has(p.id)) seen.set(p.id, { id: p.id, label: p.name, hint: [p.employee_code, sh.name].filter(Boolean).join(' · ') }); }));
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);
  const projectFilter = selProjects.length > 0;
  const peopleFilter = selPeople.length > 0;
  const projectVisible = (id) => (!projectFilter || selProjects.includes(id)) && pOn(id);
  const nowMin = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();

  if (!data) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  const allProjectIds = withHours.map((p) => p.id);
  const allShiftIds = data.shifts.map((s) => s.id);

  return (
    <div className="space-y-4" data-testid="day-schedule">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <div className="w-64"><MultiSelectDropdown value={selProjects} onChange={setSelProjects} options={projectOptions} placeholder="All projects" searchPlaceholder="Search projects…" emptyMessage="No project has working hours yet." /></div>
        <div className="w-64"><MultiSelectDropdown value={selPeople} onChange={setSelPeople} options={peopleOptions} placeholder="All employees" searchPlaceholder="Search employees…" emptyMessage="No employee is on a shift yet." /></div>
        {(projectFilter || peopleFilter) && <button type="button" className="text-xs text-primary-700 underline" onClick={() => { setSelProjects([]); setSelPeople([]); }}>Clear filters</button>}
        <span className="text-sm font-medium text-tertiary-800">Show:</span>
        <button type="button" className="btn-secondary text-xs" onClick={() => setShownProjects(new Set(allProjectIds))}>All projects</button>
        <button type="button" className="btn-secondary text-xs" onClick={() => setShownProjects(new Set())}>No projects</button>
        <button type="button" className="btn-secondary text-xs" onClick={() => setShownShifts(new Set(allShiftIds))}>All shifts</button>
        <button type="button" className="btn-secondary text-xs" onClick={() => setShownShifts(new Set())}>No shifts</button>
        <label className="flex items-center gap-2 text-sm text-tertiary-700"><input type="checkbox" checked={showPeople} onChange={(e) => setShowPeople(e.target.checked)} />Show employees under each shift</label>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div className="min-w-[920px]">
          <div className="flex items-end gap-3 pb-1">
            <div className="w-60 shrink-0" />
            <div className="relative h-5 flex-1">
              {HOURS.map((h) => <span key={h} className="absolute -translate-x-1/2 text-[10px] tabular-nums text-tertiary-500" style={{ left: pct(h * 60) }}>{String(h).padStart(2, '0')}</span>)}
              <span className="absolute right-0 text-[10px] text-tertiary-400">24</span>
            </div>
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute z-10 w-px bg-red-400" style={{ left: `calc(15.75rem + (100% - 15.75rem) * ${nowMin / 1440})`, top: 0, bottom: 0 }} title="Now" />

            <h3 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Projects — working hours</h3>
            {withHours.length === 0 && <p className="py-2 text-sm text-tertiary-500">No project has working hours yet. Set Work start / end time in Finance &gt; Projects.</p>}
            {withHours.filter((p) => !projectFilter || selProjects.includes(p.id)).map((p) => (
              <Row key={p.id} name={`${p.code ? `${p.code} ` : ''}${p.name}`} sub={`${p.client || 'No client'} · ${p.start}–${p.end} (${span(p.start, p.end)})`} checked={projectVisible(p.id)} onToggle={() => toggle(shownProjects, setShownProjects, allProjectIds, p.id)}>
                <Track segs={projectVisible(p.id) ? segments(p.start, p.end) : []} tone={p.on_hold ? 'bg-amber-400/80' : 'bg-primary-500'} label={`${p.name} ${p.start} to ${p.end}`} />
              </Row>
            ))}

            <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Employee shifts</h3>
            {data.shifts.length === 0 && <p className="py-2 text-sm text-tertiary-500">No shifts are set up yet (HR settings).</p>}
            {peopleFilter && data.shifts.length > 0 && !data.shifts.some((sh) => sh.people.some((p) => selPeople.includes(p.id))) && <p className="py-2 text-sm text-tertiary-500">None of the selected employees is on a shift.</p>}
            {data.shifts.map((s) => {
              const people = peopleFilter ? s.people.filter((p) => selPeople.includes(p.id)) : s.people;
              if (peopleFilter && people.length === 0) return null;
              return (
                <div key={s.id}>
                  <Row name={s.name} sub={`${s.start}–${s.end} (${span(s.start, s.end)}) · ${s.people.length} ${s.people.length === 1 ? 'person' : 'people'}`} checked={sOn(s.id)} onToggle={() => toggle(shownShifts, setShownShifts, allShiftIds, s.id)}>
                    <Track segs={sOn(s.id) ? segments(s.start, s.end) : []} tone="bg-emerald-500" label={`${s.name} ${s.start} to ${s.end}`} />
                  </Row>
                  {sOn(s.id) && (showPeople || peopleFilter) && people.map((p) => (
                    <Row key={p.id} indent name={p.name} sub={[p.employee_code, p.team].filter(Boolean).join(' · ')}>
                      <Track segs={segments(s.start, s.end)} tone="bg-emerald-300" label={`${p.name} ${s.start} to ${s.end}`} />
                    </Row>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {noHours.length > 0 && (
        <p className="text-xs text-tertiary-500">
          {noHours.length} project{noHours.length === 1 ? ' has' : 's have'} no working hours yet: {noHours.slice(0, 8).map((p) => p.name).join(', ')}{noHours.length > 8 ? '…' : ''}. Add them under <Link to="/finance" className="text-primary-700 hover:underline">Finance &gt; Projects</Link> (Work start time / Work end time). They are for reporting only.
        </p>
      )}
    </div>
  );
}
