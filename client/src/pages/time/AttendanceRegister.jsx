import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { downloadCsv } from '../../lib/groupExport.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Cell tone per kind of day. Leave codes (CL, SL, EL, CO ...) all share the leave tone.
const TONE = {
  present: 'bg-green-50 text-green-700',
  half_day: 'bg-amber-50 text-amber-700',
  leave: 'bg-blue-50 text-blue-700',
  absent: 'bg-red-50 text-red-700',
  holiday: 'bg-violet-50 text-violet-700',
  weekly_off: 'bg-tertiary-100 text-tertiary-500',
  none: '',
};
const LEGEND = [
  ['P', 'present', 'Present (office)'], ['WFH', 'present', 'Work from home'], ['HD', 'half_day', 'Half day'],
  ['CL', 'leave', 'Casual leave'], ['SL', 'leave', 'Sick leave'], ['EL', 'leave', 'Earned / paid leave'], ['UL', 'leave', 'Unpaid leave'], ['CO', 'leave', 'Comp off'], ['L', 'leave', 'Other leave'],
  ['H', 'holiday', 'Holiday'], ['WO', 'weekly_off', 'Weekly off'], ['A', 'absent', 'Absent (working day, nothing recorded)'],
];
const STATE_TAG = { notice_period: 'serving notice', exited: 'exited' };
const NO_PROJECT = 'No project';
const hoursLabel = (h) => (h ? Number(h).toFixed(h % 1 ? 1 : 0) : '');
const dayLabel = (d) => `${d.date.slice(8)} ${WEEKDAYS[d.weekday]}`;

/**
 * Monthly register: employees down the side, every day of the month across, one response for the whole month.
 * "Attendance" shows a short code per day with per-person totals; "Project hours" shows the hours logged per day (project
 * breakdown on hover and in the expandable row) with a monthly total. Click a name to open that person's calendar.
 */
export default function AttendanceRegister({ year, month, status, onOpenPerson }) {
  const { pushError } = useAlerts();
  const [mode, setMode] = useState('attendance');
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [group, setGroup] = useState('employee');
  const [openProjects, setOpenProjects] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    setData(null);
    apiClient.get('/attendance-dashboard/register', { params: { year, month, status } })
      .then(({ data: res }) => { if (alive) setData(res.data); })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the register'), 'Something went wrong'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, status]);

  const projectTotals = useMemo(() => {
    const map = new Map();
    for (const p of data?.people || []) {
      const by = new Map();
      for (const d of p.days) for (const pr of d.projects) by.set(pr.project, Math.round(((by.get(pr.project) || 0) + pr.hours) * 100) / 100);
      map.set(p.org_membership_id, [...by.entries()].sort((a, b) => b[1] - a[1]));
    }
    return map;
  }, [data]);

  // One block per project: each person's own hours on that project per day, with project and person totals. Hours with no project fall under NO_PROJECT.
  const projectGroups = useMemo(() => {
    const groups = new Map();
    const round = (n) => Math.round(n * 100) / 100;
    for (const p of data?.people || []) {
      const mine = new Map();
      p.days.forEach((d, i) => {
        for (const pr of d.projects) {
          const name = pr.project || NO_PROJECT;
          if (!mine.has(name)) mine.set(name, { person: p, perDay: data.days.map(() => 0), total: 0 });
          const row = mine.get(name);
          row.perDay[i] = round(row.perDay[i] + pr.hours);
          row.total = round(row.total + pr.hours);
        }
      });
      for (const [name, row] of mine) {
        if (!groups.has(name)) groups.set(name, { name, rows: [], total: 0 });
        const g = groups.get(name);
        g.rows.push(row);
        g.total = round(g.total + row.total);
      }
    }
    for (const g of groups.values()) g.rows.sort((a, b) => b.total - a.total);
    return [...groups.values()].sort((a, b) => (a.name === NO_PROJECT) - (b.name === NO_PROJECT) || b.total - a.total);
  }, [data]);

  const toggleProject = (name) => setOpenProjects((prev) => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  const toggle = (id) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  function exportCsv() {
    if (!data) return;
    const dayHeads = data.days.map((d) => String(Number(d.date.slice(8))));
    const file = `${mode === 'attendance' ? 'attendance-register' : 'project-hours-register'}-${year}-${String(month).padStart(2, '0')}.csv`;
    if (mode === 'attendance') {
      downloadCsv(file, ['Employee', 'Code', 'Department', ...dayHeads, 'Present', 'WFH', 'Leave', 'Holidays', 'Weekly offs', 'Absent'],
        data.people.map((p) => [p.name, p.employee_code || '', p.department || '', ...p.days.map((d) => d.code), p.totals.present, p.totals.wfh, p.totals.leave, p.totals.holidays, p.totals.weekly_offs, p.totals.absent]));
    } else if (group === 'project') {
      downloadCsv(file, ['Project', 'Employee', 'Code', 'Department', ...dayHeads, 'Total hours'],
        projectGroups.flatMap((g) => g.rows.map((r) => [g.name, r.person.name, r.person.employee_code || '', r.person.department || '', ...r.perDay.map(hoursLabel), r.total])));
    } else {
      downloadCsv(file, ['Employee', 'Code', 'Department', ...dayHeads, 'Total hours'],
        data.people.map((p) => [p.name, p.employee_code || '', p.department || '', ...p.days.map((d) => hoursLabel(d.hours)), p.totals.hours]));
    }
  }

  const cols = data?.days.length || 0;
  const th = 'sticky top-0 z-10 bg-tertiary-50 text-center text-[11px] font-medium text-tertiary-500';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5 text-sm">
          {[['attendance', 'Attendance register'], ['hours', 'Project hours register']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMode(k)} className={`rounded-lg px-3 py-1.5 font-medium ${mode === k ? 'bg-primary-50 text-primary-700' : 'text-tertiary-500 hover:text-tertiary-800'}`}>{label}</button>
          ))}
        </div>
        {mode === 'hours' && (
          <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5 text-sm" data-testid="group-toggle">
            {[['employee', 'By employee'], ['project', 'By project']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setGroup(k)} className={`rounded-lg px-3 py-1.5 font-medium ${group === k ? 'bg-primary-50 text-primary-700' : 'text-tertiary-500 hover:text-tertiary-800'}`}>{label}</button>
            ))}
          </div>
        )}
        <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs" disabled={!data?.people.length} onClick={exportCsv}><Download className="h-3.5 w-3.5" /> Export CSV</button>
      </div>

      {mode === 'attendance' ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tertiary-500" data-testid="register-legend">
          {LEGEND.map(([code, kind, label]) => (
            <span key={code} className="inline-flex items-center gap-1"><span className={`inline-block min-w-[1.75rem] rounded px-1 text-center font-semibold ${TONE[kind]}`}>{code}</span>{label}</span>
          ))}
          <span className="inline-flex items-center gap-1"><span className="inline-block min-w-[1.75rem] rounded border border-dashed border-tertiary-300 px-1 text-center">&nbsp;</span>Blank = future day / not employed</span>
        </p>
      ) : (
        <p className="text-xs text-tertiary-500">Hours logged per day (approved and waiting for approval; rejected entries are left out). {group === 'project' ? 'Each block is one project: open it with the arrow to see who worked on it and their hours on that project only.' : 'Hover a cell for the project breakdown, or open a row with the arrow.'} A blank cell means no hours.</p>
      )}

      {!data ? <p className="text-sm text-tertiary-500">Loading the register...</p> : !data.people.length ? (
        <p className="rounded-2xl border border-dashed border-tertiary-200 p-4 text-sm text-tertiary-500">No employees with this status.</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-2xl border border-tertiary-100 bg-white shadow-card" data-testid="register-scroll">
          <table className="border-separate border-spacing-0 text-xs" data-testid={mode === 'attendance' ? 'attendance-register' : 'hours-register'}>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-[13rem] bg-tertiary-50 p-2 text-left text-xs font-medium text-tertiary-600">Employee · {MONTHS[month - 1]} {year}</th>
                {data.days.map((d) => (
                  <th key={d.date} className={`${th} min-w-[2rem] px-0.5 py-1 ${d.weekday === 0 || d.weekday === 6 ? 'text-tertiary-400' : ''}`}>
                    <span className="block text-tertiary-800">{Number(d.date.slice(8))}</span>
                    <span className="block font-normal">{WEEKDAYS[d.weekday]}</span>
                  </th>
                ))}
                {mode === 'attendance' ? ['Present', 'Leave', 'Holidays', 'Absent'].map((h) => <th key={h} className={`${th} min-w-[3.5rem] px-1 py-1`}>{h}</th>) : <th className={`${th} min-w-[4rem] px-1 py-1`}>Total hrs</th>}
              </tr>
            </thead>
            {mode === 'hours' && group === 'project' ? (
              <tbody data-testid="project-groups">
                {!projectGroups.length && <tr><td colSpan={cols + 2} className="p-4 text-sm text-tertiary-500">No hours logged this month.</td></tr>}
                {projectGroups.map((g) => {
                  const expanded = openProjects.has(g.name);
                  return (
                    <FragmentRow key={g.name}>
                      <tr className="bg-tertiary-50">
                        <td colSpan={cols + 2} className="sticky left-0 border-t border-tertiary-100 p-2">
                          <button type="button" className="flex items-center gap-1 text-left font-semibold text-tertiary-800" aria-label={expanded ? `Collapse ${g.name}` : `Expand ${g.name}`} onClick={() => toggleProject(g.name)}>
                            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {g.name}
                            <span className="font-normal text-tertiary-500">· {hoursLabel(g.total)} h · {g.rows.length} {g.rows.length === 1 ? 'person' : 'people'}</span>
                          </button>
                        </td>
                      </tr>
                      {expanded && g.rows.map((r) => (
                        <tr key={r.person.org_membership_id} className="hover:bg-tertiary-50/60">
                          <td className="sticky left-0 z-10 border-t border-tertiary-100 bg-white p-2 pl-6">
                            <button type="button" className="text-left font-medium text-primary-700 hover:underline" title="Open this person's calendar" onClick={() => onOpenPerson(r.person.org_membership_id)}>{r.person.name}</button>
                            {r.person.employee_code && <span className="block pl-0.5 text-[10px] text-tertiary-400">{r.person.employee_code}</span>}
                          </td>
                          {r.perDay.map((h, i) => (
                            <td key={data.days[i].date} title={`${dayLabel(data.days[i])}: ${h ? `${hoursLabel(h)} h on ${g.name}` : 'No hours'}`} className={`border-t border-tertiary-100 px-0.5 py-1 text-center text-[11px] tabular-nums ${h ? 'bg-primary-50 font-semibold text-primary-800' : 'text-tertiary-300'}`}>{hoursLabel(h)}</td>
                          ))}
                          <td className="border-t border-tertiary-100 text-center font-semibold tabular-nums">{hoursLabel(r.total)}</td>
                        </tr>
                      ))}
                    </FragmentRow>
                  );
                })}
              </tbody>
            ) : (
            <tbody>
              {data.people.map((p) => {
                const expanded = mode === 'hours' && open.has(p.org_membership_id);
                return (
                  <FragmentRow key={p.org_membership_id}>
                    <tr className="hover:bg-tertiary-50/60">
                      <td className="sticky left-0 z-10 border-t border-tertiary-100 bg-white p-2">
                        <div className="flex items-center gap-1">
                          {mode === 'hours' && (
                            <button type="button" aria-label={expanded ? 'Collapse' : 'Show projects'} className="text-tertiary-400 hover:text-tertiary-700" onClick={() => toggle(p.org_membership_id)}>
                              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          )}
                          <button type="button" className="text-left font-medium text-primary-700 hover:underline" title="Open this person's calendar" onClick={() => onOpenPerson(p.org_membership_id)}>
                            {p.name}{STATE_TAG[p.status] ? <span className="ml-1 font-normal text-tertiary-400">({STATE_TAG[p.status]})</span> : null}
                          </button>
                        </div>
                        {p.employee_code && <span className="block pl-0.5 text-[10px] text-tertiary-400">{p.employee_code}</span>}
                      </td>
                      {p.days.map((d) => {
                        const tip = mode === 'attendance'
                          ? `${dayLabel(d)}: ${d.label || d.code || 'No record'}`
                          : `${dayLabel(d)}: ${d.hours ? `${hoursLabel(d.hours)} h${d.projects.length ? ` — ${d.projects.map((x) => `${x.project} ${hoursLabel(x.hours)}h`).join(', ')}` : ''}` : 'No hours'}`;
                        return mode === 'attendance' ? (
                          <td key={d.date} title={tip} className={`border-t border-tertiary-100 px-0.5 py-1 text-center text-[11px] font-semibold ${TONE[d.kind] || ''}`}>{d.code}</td>
                        ) : (
                          <td key={d.date} title={tip} className={`border-t border-tertiary-100 px-0.5 py-1 text-center text-[11px] tabular-nums ${d.hours ? 'bg-primary-50 font-semibold text-primary-800' : d.kind === 'weekly_off' || d.kind === 'holiday' ? 'bg-tertiary-50 text-tertiary-300' : 'text-tertiary-300'}`}>{hoursLabel(d.hours)}</td>
                        );
                      })}
                      {mode === 'attendance' ? (
                        <>
                          <td className="border-t border-tertiary-100 text-center font-semibold tabular-nums text-green-700" title={`${p.totals.wfh} of these from home`}>{p.totals.present}</td>
                          <td className="border-t border-tertiary-100 text-center font-semibold tabular-nums text-blue-700">{p.totals.leave}</td>
                          <td className="border-t border-tertiary-100 text-center font-semibold tabular-nums text-violet-700">{p.totals.holidays}</td>
                          <td className="border-t border-tertiary-100 text-center font-semibold tabular-nums text-red-700">{p.totals.absent}</td>
                        </>
                      ) : <td className="border-t border-tertiary-100 text-center font-semibold tabular-nums">{hoursLabel(p.totals.hours) || 0}</td>}
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={cols + 2} className="sticky left-0 border-t border-tertiary-100 bg-tertiary-50/60 px-3 py-2 text-xs text-tertiary-700">
                          {projectTotals.get(p.org_membership_id)?.length
                            ? <span className="flex flex-wrap gap-x-4 gap-y-1">{projectTotals.get(p.org_membership_id).map(([project, h]) => <span key={project}><b>{project}</b> {hoursLabel(h)} h</span>)}</span>
                            : 'No hours logged this month.'}
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

// A plain fragment wrapper so a person can render one or two table rows under one key.
function FragmentRow({ children }) { return <>{children}</>; }
