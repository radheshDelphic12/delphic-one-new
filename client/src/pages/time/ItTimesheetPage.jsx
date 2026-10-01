import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Download, Plus, Timer, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useLeaveDay } from '../../lib/useLeaveDay.js';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Badge from '../../components/ui/Badge.jsx';
import StatusBadge from '../../components/finance/StatusBadge.jsx';
import LeaveDayNotice from './LeaveDayNotice.jsx';
import ProjectDayHint from '../../components/finance/ProjectDayHint.jsx';
import RegularisationSection from './RegularisationSection.jsx';
import NoteText from '../../components/NoteText.jsx';
import WeekHoursView from './WeekHoursView.jsx';
import { monthWeeks } from '../../lib/timesheetWeeks.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_LABEL = { submitted: 'Pending', approved: 'Approved', rejected: 'Rejected' };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function blankRow() {
  return { key: Math.random().toString(36).slice(2), account_id: '', hours: '', overtime_hours: '', notes: '' };
}

function dateLabel(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
}

/**
 * IT timesheet: Date / Project / Hours / Description, one inline grid for the
 * whole day. Projects are limited to the ones the admin assigned to you. Each
 * row is an ordinary /timesheets/entries POST, so the 24h/day cap, weekly
 * auto-lock, leave-day block and manager approval all apply unchanged.
 */
export default function ItTimesheetPage() {
  const { pushError, pushSuccess } = useAlerts();
  const now = new Date();
  const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState([blankRow()]);
  const [saving, setSaving] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState(null);
  // Attendance-paid people raise overtime as a ticket (OT Tickets tab) instead of logging OT hours here.
  const [usesTickets, setUsesTickets] = useState(false);
  const leave = useLeaveDay(date);

  const projectOptions = useMemo(() => (projects || []).map((p) => ({ value: p.id, label: p.name })), [projects]);

  useEffect(() => {
    apiClient.get('/timesheets/my-projects').then(({ data }) => setProjects(data.data || [])).catch(() => setProjects([]));
    apiClient.get('/timesheets/overtime-tickets', { params: { scope: 'mine' } }).then(({ data }) => setUsesTickets(Boolean(data.data?.uses_tickets))).catch(() => setUsesTickets(false));
  }, []);

  function loadTasks() {
    apiClient.get('/tasks/mine').then(({ data }) => setTasks(data.data || [])).catch(() => setTasks([]));
  }
  useEffect(() => { loadTasks(); }, []);

  // Prefills a blank (or the first still-blank) row from an assigned task.
  function logThisTask(task) {
    setRows((current) => {
      const blankIndex = current.findIndex((r) => !r.account_id && !r.hours);
      const filled = { ...blankRow(), account_id: task.account.id, notes: task.title };
      if (blankIndex >= 0) {
        const next = [...current];
        next[blankIndex] = { ...filled, key: current[blankIndex].key };
        return next;
      }
      return [...current, filled];
    });
  }

  async function completeTask(task) {
    try {
      await apiClient.patch(`/tasks/${task.id}`, { status: 'completed' });
      pushSuccess(`Marked "${task.title}" complete`);
      loadTasks();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the task'), 'Something went wrong');
    }
  }

  const [weekKey, setWeekKey] = useState(0);

  async function load() {
    setLoading(true);
    setWeekKey((k) => k + 1);
    try {
      const { data } = await apiClient.get('/timesheets/my-log', { params: period });
      setDays(data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load your timesheet'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [period.month, period.year]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filters on the month's log: a Sunday–Saturday week and/or one project.
  const [weekFilter, setWeekFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  useEffect(() => { setWeekFilter(''); }, [period.month, period.year]);
  const weeks = useMemo(() => monthWeeks(period), [period]);
  const logProjects = useMemo(() => {
    const byId = new Map();
    for (const d of days) for (const e of d.entries) if (e.account?.id) byId.set(e.account.id, e.account.name);
    return [...byId].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [days]);
  const shownDays = useMemo(() => {
    const week = weeks.find((w) => w.key === weekFilter);
    return days
      .filter((d) => !week || (d.date >= week.from && d.date <= week.to))
      .map((d) => {
        if (!projectFilter) return d;
        const entries = d.entries.filter((e) => e.account?.id === projectFilter);
        return { ...d, entries, total_hours: Math.round(entries.reduce((s, e) => s + e.hours + (e.overtime_hours || 0), 0) * 100) / 100 };
      })
      .filter((d) => d.entries.length > 0);
  }, [days, weeks, weekFilter, projectFilter]);
  const filtered = Boolean(weekFilter || projectFilter);

  const monthTotal = useMemo(() => shownDays.reduce((sum, d) => sum + d.total_hours, 0), [shownDays]);

  // Overtime is per day (beyond the shift), so it follows the week filter, not a project.
  const monthOt = useMemo(() => (projectFilter ? 0 : shownDays.reduce((sum, d) => sum + (d.ot_hours || 0), 0)), [shownDays, projectFilter]);
  const draftTotal = useMemo(() => rows.reduce((sum, r) => sum + (Number(r.hours) || 0) + (Number(r.overtime_hours) || 0), 0), [rows]);
  const openTasks = tasks.filter((t) => t.status !== 'completed');

  function setRow(key, field, value) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }
  function addRow() {
    setRows((current) => [...current, blankRow()]);
  }
  function removeRow(key) {
    setRows((current) => (current.length > 1 ? current.filter((r) => r.key !== key) : current));
  }

  async function saveDay(event) {
    event.preventDefault();
    const ready = rows.filter((r) => r.account_id && r.hours);
    if (ready.length === 0) return;
    setSaving(true);
    try {
      for (const row of ready) {
        // Sequential, not Promise.all: entries share the same day's 24h cap,
        // so the server needs to see each one land before checking the next.
        await apiClient.post('/timesheets/entries', {
          date,
          account_id: row.account_id,
          hours: Number(row.hours),
          overtime_hours: Number(row.overtime_hours) || 0,
          notes: row.notes.trim() || undefined,
        });
      }
      pushSuccess(`Logged ${ready.length} task${ready.length === 1 ? '' : 's'} for ${dateLabel(date)} — sent to your reporting manager`);
      setRows([blankRow()]);
      if (period.month === Number(date.slice(5, 7)) && period.year === Number(date.slice(0, 4))) load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to log time'), 'Some rows may not have saved');
      load();
    } finally {
      setSaving(false);
    }
  }

  async function exportExcel() {
    try {
      const { data: blob } = await apiClient.get('/timesheets/export/excel', { params: period, responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `timesheet-${period.year}-${String(period.month).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to export the timesheet'), 'Export failed');
    }
  }

  const noProjects = projects !== null && projects.length === 0;

  return (
    <div className="space-y-5">
      {openTasks.length > 0 && (
        <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
          <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900">
            <ClipboardList className="h-4 w-4 text-primary-600" /> Assigned items
          </h2>
          <ul className="mt-3 divide-y divide-tertiary-100">
            {openTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-tertiary-900">{task.title}</span>
                    <Badge value={task.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-tertiary-500">
                    {task.account?.name}
                    {task.due_date ? ` · due ${task.due_date.slice(0, 10)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" className="btn-secondary text-xs" onClick={() => logThisTask(task)}>Log this</button>
                  <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => completeTask(task)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark complete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">Log a day</h2>
          <span className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
            Total: {draftTotal.toFixed(1)} hrs
          </span>
        </div>
        <form onSubmit={saveDay} className="mt-3 space-y-3">
          <label className="block text-xs font-medium text-tertiary-600">
            Date
            <input required type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full max-w-xs rounded-xl border px-3 py-2 text-sm" />
          </label>
          <LeaveDayNotice leave={leave} />
          {noProjects && (
            <p className="rounded-xl border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700">
              No projects are assigned to you yet. Ask your admin to assign you to a project before logging hours.
            </p>
          )}
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.key} className="grid grid-cols-1 gap-2 rounded-xl border border-tertiary-100 p-2.5 sm:grid-cols-[1.5fr_0.6fr_0.6fr_2.2fr_auto]">
                <SearchableSelect value={row.account_id} onChange={(v) => setRow(row.key, 'account_id', v)} options={projectOptions} placeholder="Project" searchPlaceholder="Search your projects…" />
                <input required type="number" min="0.25" max="24" step="0.25" placeholder="Hrs" aria-label="Hours worked" value={row.hours} onChange={(e) => setRow(row.key, 'hours', e.target.value)} className="rounded-xl border px-3 py-2 text-sm" />
                {usesTickets ? (
                  <span className="self-center text-xs text-tertiary-500" title="Overtime is raised as a ticket and approved by your manager">OT: use OT Tickets</span>
                ) : (
                  <input type="number" min="0" max="24" step="0.25" placeholder="OT hrs" aria-label="Overtime hours" title="Overtime beyond your regular hours — billed only on projects that pay overtime" value={row.overtime_hours} onChange={(e) => setRow(row.key, 'overtime_hours', e.target.value)} className="rounded-xl border px-3 py-2 text-sm" />
                )}
                <textarea placeholder="Description" rows={2} value={row.notes} onChange={(e) => setRow(row.key, 'notes', e.target.value)} className="min-h-[2.5rem] resize-y rounded-xl border px-3 py-2 text-sm" />
                <button type="button" aria-label="Remove row" className="justify-self-end text-tertiary-400 hover:text-red-600 sm:justify-self-center" onClick={() => removeRow(row.key)}>
                  <Trash2 className="h-4 w-4" />
                </button>
                {row.account_id && (
                  <div className="sm:col-span-5"><ProjectDayHint accountId={row.account_id} date={date} reloadKey={weekKey} requested={Number(row.hours) || 0} /></div>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={addRow}>
              <Plus className="h-4 w-4" /> Add task
            </button>
            <button type="submit" className="btn-primary" disabled={saving || leave.is_leave_day || noProjects}>{saving ? 'Saving…' : 'Save day'}</button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <select value={period.month} onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))} className="rounded-xl border px-3 py-1.5 text-sm">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={period.year} onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))} className="rounded-xl border px-3 py-1.5 text-sm">
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={weekFilter} onChange={(e) => setWeekFilter(e.target.value)} aria-label="Week" className="rounded-xl border px-3 py-1.5 text-sm">
              <option value="">Whole month</option>
              {weeks.map((w) => <option key={w.key} value={w.key}>Week {w.label}</option>)}
            </select>
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="Project" className="max-w-[14rem] rounded-xl border px-3 py-1.5 text-sm">
              <option value="">All projects</option>
              {logProjects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-tertiary-700">{filtered ? 'Filtered total' : 'Month total'}: {monthTotal.toFixed(1)} hrs{monthOt > 0 ? ` · ${monthOt.toFixed(1)}h OT` : ''}</span>
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={exportExcel}>
              <Download className="h-4 w-4" /> Export to Excel
            </button>
          </div>
        </div>

        {!loading && shownDays.length === 0 ? (
          filtered
            ? <EmptyState icon={Timer} title="Nothing matches these filters" description="Try another week or project." />
            : <EmptyState icon={Timer} title="Nothing logged this month yet" description="Log a day above to see it here." />
        ) : (
          <div className="space-y-3">
            {shownDays.map((day) => (
              <div key={day.date} className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
                <div className="flex items-center justify-between bg-tertiary-50 px-4 py-2">
                  <span className="text-sm font-semibold text-tertiary-900">{dateLabel(day.date)}</span>
                  <span className="text-xs font-medium text-tertiary-600">
                    {day.total_hours} hrs
                    {day.ot_hours > 0 && <span className="ml-1.5 font-semibold text-purple-700" title={`Beyond your ${day.expected_hours || 0}h expected for this day — goes to your manager for OT approval`}>· {day.ot_hours}h OT</span>}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-tertiary-500">
                      <th className="px-4 py-1.5 font-medium">Project</th>
                      <th className="px-4 py-1.5 font-medium">Hours</th>
                      <th className="px-4 py-1.5 font-medium">Description</th>
                      <th className="px-4 py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.entries.map((entry) => (
                      <tr key={entry.id} className="border-t border-tertiary-100">
                        <td className="px-4 py-1.5 text-tertiary-700">
                          {entry.account?.name || '—'}
                          {entry.is_holiday_overtime && (
                            <span title={entry.holiday_label || 'Project holiday'} className="ml-1.5 inline-block rounded-full bg-warning-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning-700">
                              Holiday OT
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-1.5 text-tertiary-700">{entry.hours}{entry.overtime_hours ? <span className="ml-1 text-xs text-warning-700">+{entry.overtime_hours} OT</span> : null}</td>
                        <td className="px-4 py-1.5 text-tertiary-500"><NoteText text={entry.notes} /></td>
                        <td className="px-4 py-1.5">
                          <StatusBadge status={entry.status} label={STATUS_LABEL[entry.status]} size="xs" />
                          {entry.status === 'approved' && entry.approved_by && (
                            <p className="mt-0.5 text-[11px] text-tertiary-500">by {entry.approved_by.name}{entry.approved_at ? ` · ${new Date(entry.approved_at).toLocaleString()}` : ''}</p>
                          )}
                          {entry.status === 'rejected' && entry.decision_reason && (
                            <p className="mt-0.5 text-xs text-danger-600">Manager: {entry.decision_reason}</p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      <WeekHoursView canDeleteOwn reloadKey={weekKey} onChanged={load} />

      <RegularisationSection requireProject projectOptions={projectOptions} onChanged={load} />
    </div>
  );
}
