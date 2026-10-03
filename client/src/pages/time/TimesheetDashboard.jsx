import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Lock, LockOpen, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_TONE = {
  approved: 'bg-green-50 text-green-700',
  pending: 'bg-amber-50 text-amber-700',
  rejected: 'bg-red-50 text-red-700',
  empty: 'bg-tertiary-50 text-tertiary-400',
  no_entries: 'bg-tertiary-50 text-tertiary-400',
};
const ATTENDANCE_LABEL = { present: 'Present', absent: 'Absent', half_day: 'Half day', leave: 'Leave', holiday: 'Holiday', wfh: 'WFH' };

const hoursLabel = (n) => `${Number(n || 0)}h`;
// Attendance as recorded; an attendance row of status "leave" shows the real leave type (Sick Leave, Casual Leave ...).
const attendanceText = (day) => day.attendance_label || ATTENDANCE_LABEL[day.attendance_status] || day.attendance_status;

function DayCell({ day, selected, onSelect }) {
  const off = day.day_type !== 'working';
  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      onMouseEnter={() => onSelect(day)}
      className={`flex min-h-[88px] flex-col gap-1 rounded-xl border p-2 text-left text-xs transition ${selected ? 'border-primary-500 ring-1 ring-primary-300' : 'border-tertiary-100 hover:border-primary-300'} ${off ? 'bg-tertiary-50/60' : 'bg-white'}`}
    >
      <span className="flex items-center justify-between">
        <span className="font-semibold text-tertiary-800">{Number(day.date.slice(8))}</span>
        {day.locked ? <Lock className="h-3 w-3 text-tertiary-500" aria-label="Locked" /> : <LockOpen className="h-3 w-3 text-tertiary-300" aria-label="Unlocked" />}
      </span>
      {day.logged > 0 && <span className={`rounded-md px-1.5 py-0.5 font-medium ${STATUS_TONE[day.status] || STATUS_TONE.empty}`} title="Project timesheet hours">Project {hoursLabel(day.logged)} · {day.status}</span>}
      {day.attendance_applicable !== false && day.attendance_status && <span className="text-tertiary-600" title="Attendance">{attendanceText(day)}</span>}
      {day.leave && <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-blue-700" title="Approved leave">{day.leave.name}{day.leave.is_half_day ? ' (half)' : ''}</span>}
      {day.attendance_conflict && <span className="text-[11px] text-amber-700">Present + approved leave - review</span>}
      {off && day.day_label && <span className="text-tertiary-400">{day.day_label}</span>}
      {(day.ot_hours > 0 || day.ot_tickets.length > 0) && (
        <span className="text-purple-700">OT {day.ot_tickets.length ? day.ot_tickets.map((t) => `${t.hours}h ${t.status}`).join(', ') : `${day.ot_hours}h ${day.ot_status || ''}`}</span>
      )}
    </button>
  );
}

function DayDetail({ day }) {
  if (!day) return <p className="rounded-2xl border border-dashed border-tertiary-200 p-4 text-sm text-tertiary-500">Hover or select a day to see its details.</p>;
  return (
    <aside className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4 text-sm shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="font-heading font-semibold text-tertiary-900">{new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</h3>
        <span className="inline-flex items-center gap-1 text-xs text-tertiary-500">{day.locked ? <><Lock className="h-3 w-3" /> Locked</> : <><LockOpen className="h-3 w-3" /> Open</>}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-tertiary-600">
        {day.attendance_applicable !== false && (
          <>
            <dt>Attendance</dt><dd className="text-tertiary-900">{day.attendance_status ? attendanceText(day) : 'Not marked'}{day.attendance_conflict ? ' · approved leave also exists - needs review' : ''}</dd>
          </>
        )}
        <dt>Day type</dt><dd className="text-tertiary-900">{day.day_label || day.day_type.replace(/_/g, ' ')}</dd>
        {day.attendance_applicable !== false && (
          <>
            <dt>Leave</dt>
            <dd className="text-tertiary-900">
              {day.leaves.length ? day.leaves.map((l) => `${l.name}${l.is_half_day ? ' (half)' : ''}`).join(', ') : 'None'}
              {day.pending_leaves.length > 0 && ` · pending: ${day.pending_leaves.map((l) => l.name).join(', ')}`}
            </dd>
          </>
        )}
        <dt>Project hours</dt><dd className="text-tertiary-900">{hoursLabel(day.logged)} (approved {hoursLabel(day.approved)}, pending {hoursLabel(day.pending)})</dd>
        <dt>Project approval</dt><dd className="text-tertiary-900">{day.status === 'empty' ? 'No entries' : day.status}{day.admin_review ? ' · needs admin review' : ''}</dd>
      </dl>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Project-wise hours</h4>
        {day.project_hours.length === 0 ? <p className="text-xs text-tertiary-400">Nothing logged.</p> : (
          <ul className="mt-1 space-y-0.5 text-xs">{day.project_hours.map((p) => <li key={p.project} className="flex justify-between"><span>{p.project}</span><span className="tabular-nums">{hoursLabel(p.hours)}</span></li>)}</ul>
        )}
      </div>
      {day.entries.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Entries</h4>
          <ul className="mt-1 space-y-1 text-xs">
            {day.entries.map((e) => (
              <li key={e.id} className="rounded-lg bg-tertiary-50 px-2 py-1">
                <span className="font-medium">{e.project || 'No project'}</span> · {hoursLabel(e.hours)} · <Badge value={e.status} />
                {e.module_name && <span className="text-tertiary-500"> · {e.module_name}</span>}
                {e.notes && <p className="text-tertiary-500">{e.notes}</p>}
                {e.decision_reason && <p className="text-red-600">Reason: {e.decision_reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(day.ot_hours > 0 || day.ot_tickets.length > 0) && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Overtime</h4>
          <ul className="mt-1 space-y-0.5 text-xs">
            {day.ot_hours > 0 && <li>Timesheet OT: {hoursLabel(day.ot_hours)} · {day.ot_status || 'pending'}</li>}
            {day.ot_tickets.map((t) => <li key={t.id}>Ticket: {hoursLabel(t.hours)} · {t.status}{t.project ? ` · ${t.project}` : ''} - {t.reason}</li>)}
          </ul>
        </div>
      )}
    </aside>
  );
}

function MonthCalendar({ year, month, member, onBack }) {
  const { user } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null);
    setSelected(null);
    setPicked(new Set());
    apiClient.get('/timesheets/dashboard/calendar', { params: { year, month, org_membership_id: member.org_membership_id } })
      .then(({ data: res }) => { if (alive) setData(res.data); })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the timesheet'), 'Something went wrong'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, member.org_membership_id, reloadKey]);

  // Every project log of the month, newest first: the rows you can select for a bulk delete.
  const logs = useMemo(() => (data ? data.days.flatMap((d) => d.entries.map((e) => ({ ...e, date: d.date, locked: d.locked }))).sort((a, b) => (a.date < b.date ? 1 : -1)) : []), [data]);
  const toggle = (id) => setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allPicked = logs.length > 0 && logs.every((l) => picked.has(l.id));

  async function deleteLogs(ids) {
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected log${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    let reason;
    if (user?.role === 'admin') {
      reason = window.prompt('Reason for deleting (required):') || '';
      if (reason.trim().length < 3) { pushError('A reason of at least 3 characters is required', 'Not deleted'); return; }
    }
    setDeleting(true);
    try {
      const { data: res } = await apiClient.post('/timesheets/entries/bulk-delete', { ids, ...(reason ? { reason: reason.trim() } : {}) });
      const { deleted, failed } = res.data;
      pushInfo(`Deleted ${deleted.length} log${deleted.length === 1 ? '' : 's'}${failed.length ? `, ${failed.length} could not be deleted (locked or already decided)` : ''}`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete the logs'), 'Something went wrong');
    } finally {
      setDeleting(false);
    }
  }

  const cells = useMemo(() => {
    if (!data) return [];
    const lead = data.days.length ? data.days[0].weekday : 0;
    return [...Array(lead).fill(null), ...data.days];
  }, [data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onBack ? <button type="button" className="btn-ghost inline-flex items-center gap-1" onClick={onBack}><ArrowLeft className="h-4 w-4" /> All timesheets</button> : <span />}
        <h3 className="font-heading text-base font-semibold text-tertiary-900">{member.name} · {MONTHS[month - 1]} {year}</h3>
        {data && <span className="text-xs text-tertiary-500">Logged {hoursLabel(data.totals.logged)} · approved {hoursLabel(data.totals.approved)} · pending {hoursLabel(data.totals.pending)} · leave {hoursLabel(data.totals.leave_hours)}</span>}
      </div>
      {!data ? <p className="text-sm text-tertiary-500">Loading...</p> : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div>
            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-tertiary-500">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => (day ? <DayCell key={day.date} day={day} selected={selected?.date === day.date} onSelect={setSelected} /> : <span key={`pad-${i}`} />))}
            </div>
          </div>
          <DayDetail day={selected} />
        </div>
      )}
      {data && logs.length > 0 && (
        <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-heading text-sm font-semibold text-tertiary-900">Project logs of the month ({logs.length})</h4>
            <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs text-danger-700" disabled={!picked.size || deleting} onClick={() => deleteLogs([...picked])}>
              <Trash2 className="h-3.5 w-3.5" /> {deleting ? 'Deleting…' : `Delete selected (${picked.size})`}
            </button>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-tertiary-500">
                  <th className="w-8 py-1"><input type="checkbox" aria-label="Select all logs" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(logs.map((l) => l.id)))} /></th>
                  <th className="py-1 pr-3">Date</th><th className="pr-3">Project</th><th className="pr-3">Hours</th><th className="pr-3">Status</th><th className="pr-3">Notes</th><th />
                </tr>
              </thead>
              <tbody className="divide-y divide-tertiary-100">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1"><input type="checkbox" aria-label={`Select log of ${l.date}`} checked={picked.has(l.id)} onChange={() => toggle(l.id)} /></td>
                    <td className="pr-3 tabular-nums">{l.date}</td>
                    <td className="pr-3">{l.project || 'No project'}</td>
                    <td className="pr-3 tabular-nums">{l.hours}{l.overtime_hours ? ` +${l.overtime_hours} OT` : ''}</td>
                    <td className="pr-3"><Badge value={l.status} /></td>
                    <td className="pr-3 text-tertiary-500">{l.notes || ''}</td>
                    <td className="py-1 text-right"><button type="button" className="text-danger-600 hover:underline" title="Delete this log" disabled={deleting} onClick={() => deleteLogs([l.id])}><Trash2 className="inline h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Timesheet Dashboard: pick a month and year, see every timesheet you may view, and open one as a
 * calendar (logged hours, attendance, leave, lock and approval per day; day details on hover / click).
 */
export default function TimesheetDashboard() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let alive = true;
    setList(null);
    apiClient.get('/timesheets/dashboard', { params: { year, month } })
      .then(({ data }) => { if (alive) setList(data.data); })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load timesheets'), 'Something went wrong'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  // Someone who can only see their own timesheet goes straight to it.
  useEffect(() => {
    if (list && !open && list.people.length === 1) setOpen(list.people[0]);
  }, [list, open]);

  const columns = [
    { key: 'name', header: 'Employee', render: (r) => r.name },
    { key: 'department', header: 'Department', render: (r) => r.department || '—' },
    { key: 'logged', header: 'Logged', render: (r) => hoursLabel(r.logged_hours) },
    { key: 'approved', header: 'Approved', render: (r) => hoursLabel(r.approved_hours) },
    { key: 'pending', header: 'Pending', render: (r) => hoursLabel(r.pending_hours) },
    { key: 'status', header: 'Approval', render: (r) => <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status] || STATUS_TONE.empty}`}>{r.status.replace(/_/g, ' ')}</span> },
    { key: 'lock', header: 'Lock', render: (r) => (r.month_locked ? <span className="inline-flex items-center gap-1 text-xs"><Lock className="h-3 w-3" /> Locked</span> : <span className="text-xs text-tertiary-400">Open</span>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Timesheet</p>
          <h2 className="mt-1 flex items-center gap-2 font-heading text-xl font-semibold text-tertiary-900"><CalendarDays className="h-5 w-5" /> Timesheet Dashboard</h2>
          <p className="mt-1 text-sm text-tertiary-500">{user?.role === 'admin' ? 'Every timesheet for the month.' : 'Your timesheet and your direct reports.'} Open one to see it day by day.</p>
        </div>
        <div className="flex gap-2">
          <label className="text-xs font-medium text-tertiary-600">Month
            <select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setOpen(null); }} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setOpen(null); }} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
        </div>
      </div>
      {open ? (
        <MonthCalendar year={year} month={month} member={open} onBack={list?.people.length > 1 ? () => setOpen(null) : null} />
      ) : (
        <DataTable columns={columns} rows={list?.people || []} loading={!list} onRowClick={(row) => setOpen(row)} emptyLabel="No timesheets for this month" maxHeight="calc(100dvh - 20rem)" />
      )}
    </div>
  );
}
