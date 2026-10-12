import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarRange, Check, ChevronLeft, ChevronRight, ListChecks, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { orgLogo } from '../../lib/orgLogo.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FREQ = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']];
const PRIORITY_TONE = { high: 'red', medium: 'amber', low: 'gray' };
const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';

const todayLocal = () => new Date().toLocaleDateString('en-CA');
const monthOf = (d) => d.slice(0, 7);
const addMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const monthTitle = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayTitle = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const rule = (t) => {
  if (t.kind === 'one_time') return `One-time · due ${t.due_date}`;
  const every = t.interval > 1 ? `every ${t.interval} ` : '';
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' }[t.frequency];
  const on = t.frequency === 'weekly' && t.weekdays?.length ? ` on ${t.weekdays.map((n) => SHORT[n - 1]).join(', ')}` : t.day_of_month ? ` on day ${t.day_of_month}` : '';
  return `Repeats ${every ? `${every}${unit}s` : unit === 'day' ? 'daily' : `${unit}ly`}${on} · from ${t.start_date}${t.end_date ? ` to ${t.end_date}` : ''}`;
};

function CompanyChip({ c, small }) {
  const logo = c ? orgLogo(c) : null;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-tertiary-200 bg-white ${small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'} font-medium text-tertiary-800`}>
      {c ? (logo ? <img src={logo} alt="" className="h-4 w-4 object-contain" /> : <span className="flex h-4 w-4 items-center justify-center rounded bg-primary-100 text-[9px] font-bold text-primary-700">{c.name[0]}</span>) : null}
      {c ? c.name : 'All companies'}
    </span>
  );
}

// ------------------------------------------------------------------ task form
function TaskForm({ initial, companies, onSubmit, onCancel, saving, error }) {
  const t = initial || {};
  const [v, setV] = useState(() => ({
    title: t.title || '', notes: t.notes || '', org_id: t.org_id || '', priority: t.priority || 'medium', kind: t.kind || 'one_time',
    due_date: t.due_date || todayLocal(), frequency: t.frequency || 'weekly', interval: t.interval || 1, weekdays: t.weekdays?.length ? t.weekdays : [1],
    day_of_month: t.day_of_month || '', start_date: t.start_date || todayLocal(), end_date: t.end_date || '', status: t.status || 'active',
  }));
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target ? e.target.value : e }));
  const toggleDay = (n) => setV((c) => ({ ...c, weekdays: c.weekdays.includes(n) ? c.weekdays.filter((x) => x !== n) : [...c.weekdays, n].sort() }));
  const recurring = v.kind === 'recurring';
  const bad = recurring ? !v.start_date || (v.frequency === 'weekly' && !v.weekdays.length) || (v.end_date && v.end_date < v.start_date) : !v.due_date;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          title: v.title.trim(), notes: v.notes.trim() || null, org_id: v.org_id || null, priority: v.priority, kind: v.kind, status: v.status,
          ...(recurring
            ? { frequency: v.frequency, interval: Number(v.interval) || 1, weekdays: v.frequency === 'weekly' ? v.weekdays : [], day_of_month: ['monthly', 'quarterly', 'yearly'].includes(v.frequency) && v.day_of_month ? Number(v.day_of_month) : null, start_date: v.start_date, end_date: v.end_date || null }
            : { due_date: v.due_date }),
        });
      }}
      className="space-y-3"
    >
      <label className={labelCls}>Task<input required maxLength={200} className={inputCls} value={v.title} onChange={set('title')} placeholder="e.g. Review monthly P&L, file GST, board meeting" autoFocus /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>Company
          <select className={inputCls} value={v.org_id} onChange={set('org_id')}>
            <option value="">All companies</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={labelCls}>Priority
          <select className={inputCls} value={v.priority} onChange={set('priority')}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        </label>
      </div>
      <div>
        <span className={labelCls}>Type</span>
        <div className="mt-1 inline-flex rounded-xl border border-tertiary-200 p-0.5" role="group" aria-label="Task type">
          {[['one_time', 'One-time'], ['recurring', 'Recurring']].map(([k, label]) => (
            <button key={k} type="button" aria-pressed={v.kind === k} onClick={() => setV((c) => ({ ...c, kind: k }))} className={`rounded-lg px-4 py-1.5 text-sm font-medium ${v.kind === k ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{label}</button>
          ))}
        </div>
      </div>
      {!recurring ? (
        <label className={labelCls}>Due date<input required type="date" className={inputCls} value={v.due_date} onChange={set('due_date')} /></label>
      ) : (
        <div className="space-y-3 rounded-xl border border-tertiary-100 bg-tertiary-50/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>Repeats
              <select className={inputCls} value={v.frequency} onChange={set('frequency')}>{FREQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label className={labelCls}>Every (number)
              <input type="number" min="1" max="52" className={inputCls} value={v.interval} onChange={set('interval')} />
              <span className="mt-0.5 block text-[11px] font-normal text-tertiary-400">1 = every {v.frequency === 'daily' ? 'day' : v.frequency === 'weekly' ? 'week' : v.frequency === 'monthly' ? 'month' : v.frequency === 'quarterly' ? 'quarter' : 'year'}, 2 = every other</span>
            </label>
          </div>
          {v.frequency === 'weekly' && (
            <div>
              <span className={labelCls}>On these days</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {SHORT.map((d, i) => <button key={d} type="button" aria-pressed={v.weekdays.includes(i + 1)} onClick={() => toggleDay(i + 1)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${v.weekdays.includes(i + 1) ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-tertiary-200 text-tertiary-500'}`}>{d}</button>)}
              </div>
            </div>
          )}
          {['monthly', 'quarterly', 'yearly'].includes(v.frequency) && (
            <label className={labelCls}>Day of the month (blank = the start date&apos;s day)
              <input type="number" min="1" max="31" className={inputCls} value={v.day_of_month} onChange={set('day_of_month')} />
              <span className="mt-0.5 block text-[11px] font-normal text-tertiary-400">31 in a shorter month falls on its last day</span>
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>Starts<input required type="date" className={inputCls} value={v.start_date} onChange={set('start_date')} /></label>
            <label className={labelCls}>Ends (optional)<input type="date" min={v.start_date} className={inputCls} value={v.end_date} onChange={set('end_date')} /></label>
          </div>
        </div>
      )}
      {initial && <label className={labelCls}>Status<select className={inputCls} value={v.status} onChange={set('status')}><option value="active">Active</option><option value="paused">Paused (no dates while paused)</option><option value="cancelled">Cancelled</option></select></label>}
      <label className={labelCls}>Notes<textarea rows={3} maxLength={4000} className={inputCls} value={v.notes} onChange={set('notes')} /></label>
      {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving || bad}>{saving ? 'Saving…' : initial ? 'Save task' : 'Add task'}</button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ weekly day editor
function PlanEditor({ assignments, onSubmit, onCancel, saving }) {
  const [grid, setGrid] = useState(() => Object.fromEntries(assignments.map((a) => [a.org.id, a.weekdays])));
  const toggle = (id, n) => setGrid((g) => ({ ...g, [id]: g[id]?.includes(n) ? g[id].filter((x) => x !== n) : [...(g[id] || []), n].sort() }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(assignments.map((a) => ({ org_id: a.org.id, weekdays: grid[a.org.id] || [] }))); }} className="space-y-4">
      <p className="text-sm text-tertiary-600">Choose the day(s) of the week each company is reviewed on. A company can have more than one day; clear all of them to leave it unassigned.</p>
      <div className="overflow-x-auto rounded-xl border border-tertiary-100">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-tertiary-50 text-xs text-tertiary-500"><tr><th className="px-3 py-2 text-left font-medium">Company</th>{SHORT.map((d) => <th key={d} className="px-2 py-2 text-center font-medium">{d}</th>)}</tr></thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.org.id} className="border-t border-tertiary-100">
                <td className="px-3 py-2"><CompanyChip c={a.org} /></td>
                {SHORT.map((d, i) => (
                  <td key={d} className="px-2 py-2 text-center"><input type="checkbox" aria-label={`${a.org.name} on ${DAYS[i]}`} checked={Boolean(grid[a.org.id]?.includes(i + 1))} onChange={() => toggle(a.org.id, i + 1)} className="h-4 w-4 accent-primary-600" /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save weekly plan'}</button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ the tab
export default function GroupTasksTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [weekDate, setWeekDate] = useState(todayLocal());
  const [month, setMonth] = useState(monthOf(todayLocal()));
  const [view, setView] = useState('list');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState('all');
  const [drawer, setDrawer] = useState(null); // { task } | { plan: true }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const week = useLiveData(() => apiClient.get('/super-dashboard/group/weekly-plan', { params: { date: weekDate, ...(company ? { org_id: company } : {}) } }).then((r) => r.data.data), { intervalMs: 60000, deps: [weekDate, company] });
  const monthData = useLiveData(() => apiClient.get('/super-dashboard/group/tasks', { params: { month, status, ...(company ? { org_id: company } : {}) } }).then((r) => r.data.data), { intervalMs: 60000, deps: [month, status, company] });
  const refresh = useCallback(() => { week.refresh(); monthData.refresh(); }, [week, monthData]);
  useEffect(() => { if (week.error) pushError(apiErrorMessage(week.error, 'Could not load the weekly plan'), 'Load failed'); }, [week.error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (monthData.error) pushError(apiErrorMessage(monthData.error, 'Could not load the tasks'), 'Load failed'); }, [monthData.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const companies = useMemo(() => (week.data?.assignments || []).map((a) => a.org).filter((o) => !o.coming_soon), [week.data]);
  const m = monthData.data;
  const byDate = useMemo(() => { const map = new Map(); for (const i of m?.items || []) map.set(i.date, [...(map.get(i.date) || []), i]); return map; }, [m]);
  const taskById = useMemo(() => new Map((m?.tasks || []).map((t) => [t.id, t])), [m]);

  async function toggleDone(item) {
    try {
      await apiClient.put(`/super-dashboard/group/tasks/${item.task_id}/occurrences/${item.date}`, { done: !item.done });
      refresh();
    } catch (e) { pushError(apiErrorMessage(e, 'Could not update the task'), 'Not saved'); }
  }
  async function saveTask(body) {
    setSaving(true);
    setError('');
    try {
      if (drawer.task) await apiClient.patch(`/super-dashboard/group/tasks/${drawer.task.id}`, body);
      else await apiClient.post('/super-dashboard/group/tasks', body);
      pushSuccess(drawer.task ? 'Task saved' : 'Task added');
      setDrawer(null);
      refresh();
    } catch (e) { setError(apiErrorMessage(e, 'Could not save the task')); } finally { setSaving(false); }
  }
  async function deleteTask(id) {
    if (!window.confirm('Delete this task? A recurring task is removed for every date.')) return;
    try { await apiClient.delete(`/super-dashboard/group/tasks/${id}`); refresh(); } catch (e) { pushError(apiErrorMessage(e, 'Could not delete'), 'Not deleted'); }
  }
  async function savePlan(assignments) {
    setSaving(true);
    try {
      await apiClient.put('/super-dashboard/group/weekly-plan', { assignments });
      pushSuccess('Weekly plan saved');
      setDrawer(null);
      refresh();
    } catch (e) { pushError(apiErrorMessage(e, 'Could not save the weekly plan'), 'Not saved'); } finally { setSaving(false); }
  }

  const TaskRow = ({ i }) => {
    const task = taskById.get(i.task_id);
    return (
      <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${i.done ? 'bg-success-50/30' : ''}`}>
        <button type="button" role="checkbox" aria-checked={i.done} aria-label={`Mark "${i.title}" ${i.done ? 'not done' : 'done'}`} onClick={() => toggleDone(i)} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${i.done ? 'border-success-600 bg-success-600 text-white' : 'border-tertiary-300 bg-white hover:border-primary-500'}`}>{i.done && <Check className="h-3.5 w-3.5" />}</button>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${i.done ? 'text-tertiary-400 line-through' : 'text-tertiary-900'}`}>{i.title}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-tertiary-500">
            <CompanyChip c={i.company} small />
            {i.recurring && <span className="inline-flex items-center gap-1 text-primary-700"><Repeat className="h-3 w-3" />{i.frequency}</span>}
            {i.assignee?.name && <span>· {i.assignee.name}</span>}
            {i.done && i.done_by && <span>· done by {i.done_by}</span>}
            {i.notes && <span className="truncate">· {i.notes}</span>}
          </p>
        </div>
        {i.overdue && <Pill tone="red">Overdue</Pill>}
        <Pill tone={PRIORITY_TONE[i.priority]}>{i.priority}</Pill>
        {task && <button type="button" title="Edit" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => { setError(''); setDrawer({ task }); }}><Pencil className="h-4 w-4" /></button>}
        <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => deleteTask(i.task_id)}><Trash2 className="h-4 w-4" /></button>
      </li>
    );
  };

  // calendar grid (Monday first)
  const grid = useMemo(() => {
    if (!m) return [];
    const first = new Date(`${m.from}T00:00:00Z`);
    const lead = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, k) => `${month}-${String(k + 1).padStart(2, '0')}`)];
  }, [m, month]);

  const w = week.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-medium text-tertiary-600">Company
          <select className="ml-2 rounded-xl border px-3 py-1.5 text-sm" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company filter">
            <option value="">All companies</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => { setError(''); setDrawer({ task: null }); }}><Plus className="h-4 w-4" />Add task</button>
      </div>

      {/* ---------------- weekly table ---------------- */}
      <section className="rounded-2xl border border-tertiary-100 bg-white shadow-card" aria-label="Weekly plan">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary-100 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 font-heading text-base font-semibold text-tertiary-900"><CalendarRange className="h-4 w-4 text-primary-700" />Weekly plan</h2>
            <p className="text-xs text-tertiary-500">Which company is looked at on which day, with that day&apos;s tasks. Today is highlighted.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-lg border p-1.5 hover:bg-tertiary-50" aria-label="Previous week" onClick={() => w && setWeekDate(w.prev_week)}><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[10rem] text-center text-sm font-medium text-tertiary-800">{w ? `${dayTitle(w.week_start)} – ${dayTitle(w.week_end)}` : '…'}</span>
            <button type="button" className="rounded-lg border p-1.5 hover:bg-tertiary-50" aria-label="Next week" onClick={() => w && setWeekDate(w.next_week)}><ChevronRight className="h-4 w-4" /></button>
            <button type="button" className="btn-secondary text-sm" onClick={() => setWeekDate(todayLocal())}>This week</button>
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={() => setDrawer({ plan: true })} disabled={!w}><Pencil className="h-3.5 w-3.5" />Set company days</button>
          </div>
        </div>
        {!w ? <div className="p-4"><Skeleton className="h-40 w-full" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-left text-xs text-tertiary-500"><tr><th className="w-36 px-4 py-2 font-medium">Day</th><th className="px-3 py-2 font-medium">Companies</th><th className="px-3 py-2 font-medium">Tasks</th></tr></thead>
              <tbody>
                {w.days.map((d) => (
                  <tr key={d.date} data-today={d.is_today ? 'true' : undefined} className={`border-t border-tertiary-100 align-top ${d.is_today ? 'bg-primary-50 ring-1 ring-inset ring-primary-300' : d.is_past ? 'bg-tertiary-50/40 text-tertiary-500' : ''}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-tertiary-900">{d.name}</div>
                      <div className="text-xs text-tertiary-500">{dayTitle(d.date)}</div>
                      {d.is_today && <span className="mt-1 inline-block rounded-full bg-primary-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Today</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {d.companies.length === 0 ? <span className="text-xs text-tertiary-400">No company linked</span> : (
                        <div className="flex flex-wrap gap-1.5">{d.companies.map((c) => <CompanyChip key={c.id} c={c} />)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {d.tasks.length === 0 ? <span className="text-xs text-tertiary-400">No tasks</span> : (
                        <ul className="space-y-1">
                          {d.tasks.map((t) => (
                            <li key={t.key} className="flex items-center gap-2">
                              <button type="button" role="checkbox" aria-checked={t.done} aria-label={`Mark "${t.title}" ${t.done ? 'not done' : 'done'}`} onClick={() => toggleDone(t)} className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${t.done ? 'border-success-600 bg-success-600 text-white' : 'border-tertiary-300 bg-white'}`}>{t.done && <Check className="h-3 w-3" />}</button>
                              <span className={t.done ? 'text-tertiary-400 line-through' : 'text-tertiary-900'}>{t.title}</span>
                              {t.company && <span className="text-xs text-tertiary-500">· {t.company.name}</span>}
                              {t.recurring && <Repeat className="h-3 w-3 text-primary-600" aria-label="Recurring" />}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {w.unassigned.length > 0 && <p className="border-t border-tertiary-100 px-4 py-2 text-xs text-amber-800">Not linked to a day yet: {w.unassigned.map((o) => o.name).join(', ')}. Use &quot;Set company days&quot;.</p>}
          </div>
        )}
      </section>

      {/* ---------------- month ---------------- */}
      <section className="rounded-2xl border border-tertiary-100 bg-white shadow-card" aria-label="Tasks for the month">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary-100 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 font-heading text-base font-semibold text-tertiary-900"><ListChecks className="h-4 w-4 text-primary-700" />Tasks - {monthTitle(month)}</h2>
            <p className="text-xs text-tertiary-500">One-time and recurring tasks of every company, date by date.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="rounded-lg border p-1.5 hover:bg-tertiary-50" aria-label="Previous month" onClick={() => setMonth(addMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></button>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border px-2 py-1 text-sm" aria-label="Month" />
            <button type="button" className="rounded-lg border p-1.5 hover:bg-tertiary-50" aria-label="Next month" onClick={() => setMonth(addMonth(month, 1))}><ChevronRight className="h-4 w-4" /></button>
            <button type="button" className="btn-secondary text-sm" onClick={() => setMonth(monthOf(todayLocal()))}>This month</button>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" aria-label="Show">
              <option value="all">All</option><option value="open">Open</option><option value="done">Done</option>
            </select>
            <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="View">
              {[['list', 'List', ListChecks], ['calendar', 'Calendar', CalendarDays]].map(([k, l, Icon]) => (
                <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${view === k ? 'bg-primary-600 text-white' : 'text-tertiary-600'}`}><Icon className="h-3.5 w-3.5" />{l}</button>
              ))}
            </div>
          </div>
        </div>
        {!m ? <div className="p-4"><Skeleton className="h-40 w-full" /></div> : (
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard label="Tasks this month" value={m.summary.total} icon={ListChecks} theme="blue" />
              <KpiCard label="Open" value={m.summary.open} icon={ListChecks} theme="orange" />
              <KpiCard label="Done" value={m.summary.done} icon={Check} theme="green" />
              <KpiCard label="Overdue" value={m.summary.overdue} hint={`${m.summary.recurring} recurring · ${m.summary.one_time} one-time`} icon={CalendarDays} theme={m.summary.overdue ? 'red' : 'purple'} />
            </div>
            {view === 'list' ? (
              m.items.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-tertiary-400">Nothing due in {monthTitle(month)}. Use &quot;Add task&quot; to plan one.</p> : (
                <div className="space-y-3">
                  {[...byDate.entries()].map(([date, items]) => (
                    <div key={date} className={`overflow-hidden rounded-xl border ${date === m.today ? 'border-primary-400' : 'border-tertiary-100'}`}>
                      <div className={`flex items-center justify-between px-3 py-1.5 text-xs font-semibold ${date === m.today ? 'bg-primary-50 text-primary-800' : 'bg-tertiary-50 text-tertiary-600'}`}>
                        <span>{dayTitle(date)}{date === m.today ? ' · Today' : ''}</span><span>{items.length} task{items.length === 1 ? '' : 's'}</span>
                      </div>
                      <ul className="divide-y divide-tertiary-100">{items.map((i) => <TaskRow key={i.key} i={i} />)}</ul>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div>
                <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-tertiary-100 bg-tertiary-100 text-xs">
                  {SHORT.map((d) => <div key={d} className="bg-tertiary-50 px-2 py-1.5 text-center font-semibold text-tertiary-600">{d}</div>)}
                  {grid.map((date, idx) => (
                    <div key={date || `pad-${idx}`} className={`min-h-[5.5rem] bg-white p-1.5 ${date === m.today ? 'ring-2 ring-inset ring-primary-400' : ''}`}>
                      {date && (
                        <>
                          <div className={`mb-1 text-[11px] font-semibold ${date === m.today ? 'text-primary-700' : 'text-tertiary-500'}`}>{Number(date.slice(8))}</div>
                          <ul className="space-y-0.5">
                            {(byDate.get(date) || []).slice(0, 3).map((i) => (
                              <li key={i.key}><button type="button" onClick={() => toggleDone(i)} title={`${i.title}${i.company ? ` - ${i.company.name}` : ''}${i.done ? ' (done)' : ''}`} className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${i.done ? 'bg-success-50 text-tertiary-400 line-through' : i.overdue ? 'bg-danger-50 text-danger-700' : i.recurring ? 'bg-primary-50 text-primary-800' : 'bg-amber-50 text-amber-900'}`}>{i.title}</button></li>
                            ))}
                            {(byDate.get(date) || []).length > 3 && <li className="px-1 text-[10px] text-tertiary-400">+{byDate.get(date).length - 3} more</li>}
                          </ul>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-tertiary-500">Click a task to tick it off. Green-grey = recurring, amber = one-time, red = overdue.</p>
              </div>
            )}
            {m.tasks.length > 0 && (
              <details className="rounded-xl border border-tertiary-100 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-tertiary-800">All task rules ({m.tasks.length})</summary>
                <ul className="mt-2 divide-y divide-tertiary-100">
                  {m.tasks.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span><span className="font-medium text-tertiary-900">{t.title}</span> <span className="text-xs text-tertiary-500">{rule(t)}{t.status !== 'active' ? ` · ${t.status}` : ''}</span></span>
                      <span className="flex gap-1"><button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => { setError(''); setDrawer({ task: t }); }}>Edit</button><button type="button" className="text-xs font-medium text-danger-600 hover:underline" onClick={() => deleteTask(t.id)}>Delete</button></span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      <Drawer open={Boolean(drawer?.plan)} onClose={() => setDrawer(null)} size="lg" tone="edit" title="Company days of the week">
        {drawer?.plan && w && <PlanEditor assignments={w.assignments.filter((a) => !a.org.coming_soon)} saving={saving} onSubmit={savePlan} onCancel={() => setDrawer(null)} />}
      </Drawer>
      <Drawer open={Boolean(drawer && !drawer.plan)} onClose={() => setDrawer(null)} size="lg" tone={drawer?.task ? 'edit' : 'create'} title={drawer?.task ? 'Edit task' : 'Add task'}>
        {drawer && !drawer.plan && <TaskForm key={drawer.task?.id || 'new'} initial={drawer.task} companies={companies} saving={saving} error={error} onSubmit={saveTask} onCancel={() => setDrawer(null)} />}
      </Drawer>
    </div>
  );
}
