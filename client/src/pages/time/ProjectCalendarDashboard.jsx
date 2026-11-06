import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { adminFor } from '../../lib/access.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { localToday } from '../attendance/AttendanceBackfill.jsx';
import AdminEntryDrawer, { adminDeleteEntry } from './AdminEntryDrawer.jsx';
import { AddTimesheetEntryDrawer } from './TimesheetBackfill.jsx';
import { CONTRACT_FILTERS, FilterPills } from '../finance/projectFilters.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hoursLabel = (n) => `${Number(n || 0)}h`;

function DayCell({ day, selected, onSelect }) {
  const off = day.day_type !== 'working';
  return (
    <button type="button" onClick={() => onSelect(day)} className={`flex min-h-[96px] flex-col gap-1 rounded-xl border p-2 text-left text-xs transition ${selected ? 'border-primary-500 ring-1 ring-primary-300' : 'border-tertiary-100 hover:border-primary-300'} ${off ? 'bg-tertiary-50/60' : 'bg-white'}`}>
      <span className="font-semibold text-tertiary-800">{Number(day.date.slice(8))}</span>
      {day.hours > 0 && <span className="rounded-md bg-green-50 px-1.5 py-0.5 font-medium text-green-700">{hoursLabel(day.hours)} · {day.entries.length} log{day.entries.length === 1 ? '' : 's'}</span>}
      {day.day_type === 'holiday' && <span className="text-tertiary-500">{day.day_label || 'Holiday'}</span>}
      {day.on_leave.length > 0 && <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-blue-700">{day.on_leave.length} on leave</span>}
    </button>
  );
}

function DayPanel({ day, canEdit, today, onAdd, onEdit, onDelete }) {
  if (!day) return <p className="text-sm text-tertiary-500">Select a day to see the tasks, hours and leave.</p>;
  return (
    <div className="space-y-3 text-sm">
      <h3 className="font-heading font-semibold text-tertiary-900">{new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</h3>
      <p className="text-xs text-tertiary-500">{day.day_type === 'holiday' ? `Holiday${day.day_label ? ` · ${day.day_label}` : ''}` : day.day_type === 'weekend' ? 'Weekend' : 'Working day'} · {hoursLabel(day.hours)} logged</p>
      <div>
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Tasks and hours</h4>
          {canEdit && day.date <= today && (
            <button type="button" data-testid="project-day-add" className="inline-flex items-center gap-1 rounded-lg border border-primary-200 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50" onClick={() => onAdd(day)}><Plus className="h-3.5 w-3.5" /> Add hours</button>
          )}
        </div>
        {day.entries.length === 0 ? <p className="text-xs text-tertiary-400">Nothing logged.</p> : (
          <ul className="mt-1 space-y-1 text-xs">
            {day.entries.map((e) => (
              <li key={e.id} className="rounded-lg bg-tertiary-50 px-2 py-1">
                <span className="font-medium">{e.person}</span> · {hoursLabel(e.hours)}{e.overtime_hours ? ` +${e.overtime_hours}h OT` : ''} · {e.status}
                {e.task && <span className="text-tertiary-600"> · {e.task}</span>}
                {e.notes && <p className="text-tertiary-500">{e.notes}</p>}
                {canEdit && (
                  <span className="mt-1 flex gap-2">
                    <button type="button" data-testid="project-entry-edit" className="inline-flex items-center gap-1 text-primary-700 hover:underline" onClick={() => onEdit(day, e)}><Pencil className="h-3 w-3" /> Edit</button>
                    <button type="button" data-testid="project-entry-delete" className="inline-flex items-center gap-1 text-danger-600 hover:underline" onClick={() => onDelete(day, e)}><Trash2 className="h-3 w-3" /> Delete</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">On leave</h4>
        {day.on_leave.length === 0 ? <p className="text-xs text-tertiary-400">Nobody.</p> : (
          <ul className="mt-1 space-y-0.5 text-xs">{day.on_leave.map((l, i) => <li key={`${l.person}-${i}`}>{l.person} · {l.leave}{l.is_half_day ? ' (half)' : ''}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

/** Project Calendar: pick a project, see its month as a calendar; click a day for the tasks, hours and leave. */
export default function ProjectCalendarDashboard() {
  const { pushError, pushSuccess } = useAlerts();
  const { user } = useAuth();
  // the same people who can correct timesheet entries elsewhere (admin, or a person holding Timesheets update)
  const canEdit = adminFor(user, 'timesheets.update');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [projects, setProjects] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [data, setData] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(null); // { date } while the Add hours drawer is open
  const [correcting, setCorrecting] = useState(null); // an entry being corrected
  const selected = data?.days.find((d) => d.date === selectedDate) || null;
  const today = localToday();
  const [status, setStatus] = useState('all');
  const visible = useMemo(() => (projects || []).filter((p) => status === 'all' || p.status === status), [projects, status]);

  useEffect(() => {
    let alive = true;
    apiClient.get('/attendance-dashboard/projects', { params: { year, month } })
      .then(({ data: res }) => { if (alive) setProjects(res.data); })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load projects'), 'Something went wrong'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  // the open project follows the filter: when it drops out of the list, the first match opens
  useEffect(() => {
    if (visible.length && !visible.some((p) => p.id === projectId)) setProjectId(visible[0].id);
  }, [visible, projectId]);

  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    apiClient.get(`/attendance-dashboard/projects/${projectId}/calendar`, { params: { year, month } })
      .then(({ data: res }) => { if (alive) setData(res.data); })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the project calendar'), 'Something went wrong'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, year, month, reloadKey]);

  // another project or month starts with nothing selected (a reload after an edit keeps the day open)
  useEffect(() => { setSelectedDate(null); setData(null); }, [projectId, year, month]);

  const reload = () => setReloadKey((k) => k + 1);
  // the shape the correction drawer and the delete prompt expect
  const entryFor = (day, e) => ({ ...e, date: day.date, account_id: data.project.id, org_membership: { person: { name: e.person } } });

  const step = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };
  const cells = useMemo(() => (data ? [...Array(data.days[0]?.weekday || 0).fill(null), ...data.days] : []), [data]);

  return (
    <div className="space-y-4">
      <div className="ta-head flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Projects</p>
          <h2 className="mt-1 flex items-center gap-2 font-heading text-xl font-semibold text-tertiary-900"><CalendarRange className="h-5 w-5" /> Project Calendar</h2>
          <p className="mt-1 text-sm text-tertiary-500">Every project as a calendar: hours logged, the tasks behind them, leave and holidays.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" className="btn-ghost" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></button>
          <label className="text-xs font-medium text-tertiary-600">Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <button type="button" className="btn-ghost" aria-label="Next month" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {projects && projects.length > 0 && (
        <FilterPills label="Status" options={CONTRACT_FILTERS} rows={projects} matches={(p, key) => key === 'all' || p.status === key} value={status} onChange={setStatus} />
      )}

      {canEdit && <p className="rounded-xl bg-primary-50 px-3 py-2 text-xs text-primary-800" data-testid="project-calendar-edit-hint">Admin: pick a day, then add hours, edit or delete an entry of this project. A reason is asked and saved with every change, locked days included.</p>}
      {projects && !projects.length ? <p className="rounded-2xl border border-dashed border-tertiary-200 p-4 text-sm text-tertiary-500">No projects to show.</p> : (
        <div className="grid gap-4 lg:grid-cols-[14rem_1fr_21rem]">
          <nav className="max-h-[70vh] space-y-1 overflow-y-auto rounded-2xl border border-tertiary-100 bg-white p-2 shadow-card" aria-label="Projects">
            {visible.map((p) => (
              <button key={p.id} type="button" onClick={() => setProjectId(p.id)} className={`block w-full truncate rounded-xl px-3 py-2 text-left text-sm ${p.id === projectId ? 'bg-primary-50 font-medium text-primary-700 ring-1 ring-primary-100' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{p.name}</button>
            ))}
            {projects && !visible.length && <p className="px-3 py-2 text-xs text-tertiary-500">No projects with this status.</p>}
          </nav>
          {!data || !visible.length ? <p className="text-sm text-tertiary-500">{visible.length || !projects ? 'Loading...' : ''}</p> : (
            <div>
              <h3 className="mb-2 font-heading text-base font-semibold text-tertiary-900">{data.project.name} · {MONTHS[month - 1]} {year} <span className="ml-2 text-xs font-normal text-tertiary-500">{hoursLabel(data.total_hours)} logged{data.project.calendar ? ` · ${data.project.calendar}` : ''}</span></h3>
              <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-tertiary-500">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, i) => (day ? <DayCell key={day.date} day={day} selected={selected?.date === day.date} onSelect={(d) => setSelectedDate(d.date)} /> : <span key={`pad-${i}`} />))}
              </div>
            </div>
          )}
          <aside className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
            <DayPanel
              day={selected}
              canEdit={canEdit}
              today={today}
              onAdd={(day) => setAdding({ date: day.date })}
              onEdit={(day, e) => setCorrecting(entryFor(day, e))}
              onDelete={(day, e) => adminDeleteEntry(entryFor(day, e), { pushError, pushSuccess, onDone: reload })}
            />
          </aside>
        </div>
      )}
      <AddTimesheetEntryDrawer
        open={Boolean(adding)}
        initial={adding ? { date: adding.date, account_id: projectId } : null}
        onClose={() => setAdding(null)}
        onSaved={reload}
      />
      <AdminEntryDrawer entry={correcting} onClose={() => setCorrecting(null)} onSaved={reload} />
    </div>
  );
}
