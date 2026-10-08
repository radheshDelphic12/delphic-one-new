import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Download, Lock, Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useClientAccountOptions, useOrgMembershipOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import RejectReasonModal from './RejectReasonModal.jsx';
import NoteText from '../../components/NoteText.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TASK_STATUSES = ['pending', 'in_progress', 'completed'];

export function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <p className="text-xs font-medium text-tertiary-500">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold text-tertiary-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-tertiary-400">{hint}</p>}
    </div>
  );
}

function AssignTaskDrawer({ open, onClose, onCreated }) {
  const { pushError } = useAlerts();
  const accountOptions = useClientAccountOptions(open);
  const membershipOptions = useOrgMembershipOptions(open);
  const [fields, setFields] = useState({ account_id: '', assignee_membership_id: '', title: '', description: '', due_date: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setFields({ account_id: '', assignee_membership_id: '', title: '', description: '', due_date: '' });
  }, [open]);

  function set(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/tasks', { ...fields, due_date: fields.due_date || undefined });
      onCreated();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to assign task'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Assign a task"
      onClose={onClose}
      size="sm"
      tone="create"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="assign-task-form" className="btn-primary" disabled={saving || !fields.account_id || !fields.assignee_membership_id || !fields.title.trim()}>
            {saving ? 'Assigning…' : 'Assign'}
          </button>
        </>
      }
    >
      <form id="assign-task-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">
          Assign to
          <div className="mt-1"><SearchableSelect value={fields.assignee_membership_id} onChange={(v) => set('assignee_membership_id', v)} options={membershipOptions} placeholder="Select employee" searchPlaceholder="Search people…" /></div>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Project
          <div className="mt-1"><SearchableSelect value={fields.account_id} onChange={(v) => set('account_id', v)} options={accountOptions} placeholder="Select project" searchPlaceholder="Search projects…" /></div>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Title
          <input required value={fields.title} onChange={(e) => set('title', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" placeholder="Fix login bug" />
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Description <span className="font-normal text-tertiary-400">(optional)</span>
          <textarea value={fields.description} onChange={(e) => set('description', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" rows={3} />
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Due date <span className="font-normal text-tertiary-400">(optional)</span>
          <input type="date" value={fields.due_date} onChange={(e) => set('due_date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
      </form>
    </Drawer>
  );
}

export function DrillDownDrawer({ member, period, onClose }) {
  const { pushError } = useAlerts();
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!member) return;
    setLoading(true);
    apiClient
      .get('/timesheets/my-log', { params: { ...period, org_membership_id: member.org_membership_id } })
      .then(({ data }) => setDays(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, "Failed to load this member's log"), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [member, period, pushError]);

  async function exportExcel() {
    try {
      const { data: blob } = await apiClient.get('/timesheets/export/excel', {
        params: { ...period, org_membership_id: member.org_membership_id },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `timesheet-${member.name}-${period.year}-${String(period.month).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to export'), 'Export failed');
    }
  }

  return (
    <Drawer open={Boolean(member)} title={member ? `${member.name}'s timesheet` : ''} onClose={onClose} size="lg">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-tertiary-500">
            {MONTHS[period.month - 1]} {period.year} · {member?.month_hours ?? 0} hrs logged
          </p>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={exportExcel}>
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
        {!loading && days.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Nothing logged this month" description="No entries for this period yet." />
        ) : (
          days.map((day) => (
            <div key={day.date} className="overflow-hidden rounded-2xl border border-tertiary-100">
              <div className="flex items-center justify-between bg-tertiary-50 px-3 py-1.5">
                <span className="text-sm font-semibold text-tertiary-900">{day.date}</span>
                <span className="text-xs font-medium text-tertiary-600">{day.total_hours} hrs</span>
              </div>
              <ul className="divide-y divide-tertiary-100 text-sm">
                {day.entries.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="min-w-0 text-tertiary-700">{entry.account?.name || 'General'}{entry.notes && <NoteText text={entry.notes} className="text-xs text-tertiary-500" />}</span>
                    <span className="flex items-center gap-1.5 shrink-0 text-tertiary-500">
                      {entry.hours}h <Badge value={entry.status} />
                      {entry.is_holiday_overtime && <Badge value="in_progress" label="Holiday OT" />}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </Drawer>
  );
}

/**
 * Admin/Superadmin monitoring hub — real-time status, per-employee
 * utilization, approvals, day locks, and task assignment. Reads/writes the
 * same TimesheetEntry / TimesheetLock / TimesheetRegularizationTicket /
 * AssignedTask endpoints the self-service pages use — no separate tracking
 * table, so the two views can never drift apart.
 */
export default function TeamMonitoringTab() {
  const { pushError, pushSuccess } = useAlerts();
  const now = new Date();
  const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
  const [departments, setDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drillMember, setDrillMember] = useState(null);
  const [rejecting, setRejecting] = useState(null); // { kind: 'entry' | 'ticket', row }

  const [pendingEntries, setPendingEntries] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [locks, setLocks] = useState([]);
  const [lockDate, setLockDate] = useState('');

  const [tasks, setTasks] = useState([]);
  const [taskStatusFilter, setTaskStatusFilter] = useState('');
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);

  useEffect(() => {
    apiClient.get('/departments').then(({ data }) => setDepartments(data.data || [])).catch(() => setDepartments([]));
  }, []);

  function loadOverview() {
    setLoading(true);
    apiClient
      .get('/timesheets/overview', { params: { department_id: departmentId || undefined, month: period.month, year: period.year } })
      .then(({ data }) => setOverview(data.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the team overview'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }

  function loadPending() {
    apiClient
      .get('/timesheets/entries', { params: { status: 'submitted', department_id: departmentId || undefined, limit: 100 } })
      .then(({ data }) => setPendingEntries(data.data || []))
      .catch(() => setPendingEntries([]));
  }

  function loadTickets() {
    apiClient
      .get('/timesheets/regularization-tickets', { params: { status: 'pending' } })
      .then(({ data }) => setTickets(data.data || []))
      .catch(() => setTickets([]));
  }

  function loadLocks() {
    apiClient.get('/timesheets/locks').then(({ data }) => setLocks(data.data || [])).catch(() => setLocks([]));
  }

  function loadTasks() {
    apiClient
      .get('/tasks', { params: { status: taskStatusFilter || undefined, limit: 100 } })
      .then(({ data }) => setTasks(data.data || []))
      .catch(() => setTasks([]));
  }

  useEffect(() => { loadOverview(); }, [period.month, period.year, departmentId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadPending(); }, [departmentId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadTickets(); loadLocks(); }, []);
  useEffect(() => { loadTasks(); }, [taskStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decideEntry(id, status, reason) {
    try {
      await apiClient.post(`/timesheets/entries/${id}/decision`, { status, reason });
      pushSuccess(`Entry ${status}`);
      loadPending();
      loadOverview();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record the decision'), 'Something went wrong');
      throw err;
    }
  }

  async function decideTicket(id, status, reason) {
    try {
      await apiClient.post(`/timesheets/regularization-tickets/${id}/decision`, { status, decision_reason: reason });
      pushSuccess(`Request ${status}`);
      loadTickets();
      loadPending();
      loadOverview();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record the decision'), 'Something went wrong');
      throw err;
    }
  }

  async function lockToday(event) {
    event.preventDefault();
    try {
      await apiClient.post('/timesheets/locks', { date: lockDate });
      pushSuccess(`Locked ${lockDate}`);
      setLockDate('');
      loadLocks();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to lock that day'), 'Something went wrong');
    }
  }

  // Unlock a day so its entries can be logged / changed normally again.
  async function unlock(lock) {
    const day = lock.date?.slice(0, 10);
    if (!window.confirm(`Unlock ${day}? Employees can then log and edit entries for that day again.`)) return;
    try {
      await apiClient.delete(`/timesheets/locks/${day}`);
      pushSuccess(`Unlocked ${day}`);
      loadLocks();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to unlock that day'), 'Something went wrong');
    }
  }

  async function setTaskStatus(task, status) {
    try {
      await apiClient.patch(`/tasks/${task.id}`, { status });
      loadTasks();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the task'), 'Something went wrong');
    }
  }

  const memberRows = useMemo(() => (overview?.members || []).map((m) => ({ id: m.org_membership_id, ...m })), [overview]);

  const gridColumns = [
    { key: 'name', header: 'Name', render: (row) => <span className="font-medium text-tertiary-900">{row.name}</span> },
    { key: 'department', header: 'Department', render: (row) => row.department || <span className="text-tertiary-400">—</span> },
    {
      key: 'logged_today',
      header: 'Logged today',
      render: (row) => (row.logged_today ? <Badge value="active" label="Logged" /> : <Badge value="rejected" label="Missing" />),
    },
    { key: 'month_hours', header: 'Hours this month', render: (row) => `${row.month_hours} hrs` },
    {
      key: 'allocation',
      header: 'Project allocation',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.allocation.length === 0 && <span className="text-tertiary-400">—</span>}
          {row.allocation.slice(0, 3).map((a) => (
            <span key={a.name} className="rounded-full bg-tertiary-100 px-2 py-0.5 text-[11px] text-tertiary-600">
              {a.name} {a.pct}%
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <button type="button" className="btn-ghost text-xs" onClick={() => setDrillMember(row)}>
          View log
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={period.month} onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))} className="rounded-xl border px-3 py-1.5 text-sm">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={period.year} onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))} className="rounded-xl border px-3 py-1.5 text-sm">
          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Team members" value={overview.summary.total_members} />
          <StatCard label="Logged today" value={overview.summary.logged_today} />
          <StatCard label="Missing today" value={overview.summary.missing_today} />
          <StatCard label="Pending approvals" value={overview.summary.pending_approvals} />
          <StatCard label="Overtime hours" value={overview.summary.overtime_hours} hint="Beyond the daily shift (weekends / holidays: all hours), this month" />
        </div>
      )}

      <section>
        <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Employee utilization</h3>
        <DataTable columns={gridColumns} rows={memberRows} loading={loading} emptyLabel="No team members found." />
      </section>

      <section>
        <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Pending approvals</h3>
        {pendingEntries.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing pending" description="Every submitted entry has been decided." />
        ) : (
          <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white shadow-card">
            {pendingEntries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="text-tertiary-700">
                  <b className="text-tertiary-900">{entry.org_membership?.person?.name}</b> — {entry.account?.name} · {entry.hours}h on {entry.date?.slice(0, 10)}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" className="btn-secondary text-xs" onClick={() => decideEntry(entry.id, 'approved')}>Approve</button>
                  <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => setRejecting({ kind: 'entry', row: entry })}>Reject</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {tickets.length > 0 && (
        <section>
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Regularization tickets</h3>
          <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white shadow-card">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="text-tertiary-700">
                  <b className="text-tertiary-900">{ticket.org_membership?.person?.name || ticket.requester?.name}</b>
                  {ticket.date ? ` — ${String(ticket.date).slice(0, 10)} · ${ticket.target_hours}h` : ''} — {ticket.reason}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" className="btn-secondary text-xs" onClick={() => decideTicket(ticket.id, 'approved')}>Approve</button>
                  <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => setRejecting({ kind: 'ticket', row: ticket })}>Reject</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <h3 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900">
          <Lock className="h-4 w-4" /> Pay-period locks
        </h3>
        <form onSubmit={lockToday} className="flex flex-wrap items-end gap-2">
          <input required type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} className="rounded-xl border px-3 py-2 text-sm" />
          <button type="submit" className="btn-primary text-xs">Lock day</button>
        </form>
        {locks.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {locks.map((lock) => (
              <span key={lock.id} className="inline-flex items-center gap-1 rounded-full bg-tertiary-100 px-2.5 py-1 text-xs text-tertiary-600">
                <Lock className="h-3 w-3" /> {lock.date?.slice(0, 10)}{lock.is_auto ? ' · auto' : ''}
                <button type="button" className="ml-1 rounded-full px-1.5 font-medium text-primary-700 hover:bg-white" onClick={() => unlock(lock)} aria-label={`Unlock ${lock.date?.slice(0, 10)}`}>Unlock</button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">Task assignment</h3>
          <div className="flex items-center gap-2">
            <select value={taskStatusFilter} onChange={(e) => setTaskStatusFilter(e.target.value)} className="rounded-xl border px-2 py-1 text-xs">
              <option value="">All statuses</option>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            <button type="button" className="btn-primary inline-flex items-center gap-1.5 text-xs" onClick={() => setTaskDrawerOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Assign task
            </button>
          </div>
        </div>
        {tasks.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No tasks assigned yet" description="Assign a task to see it here and on the employee's own timesheet." />
        ) : (
          <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white shadow-card">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-tertiary-900">{task.title}</span>
                    <Badge value={task.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-tertiary-500">
                    {task.assignee?.person?.name} · {task.account?.name}
                    {task.module_name ? ` · ${task.module_name}` : ''}
                  </p>
                </div>
                {task.status !== 'completed' && (
                  <button type="button" className="btn-ghost inline-flex shrink-0 items-center gap-1 text-xs" onClick={() => setTaskStatus(task, 'completed')}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark complete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <RejectReasonModal
        open={Boolean(rejecting)}
        title={rejecting?.kind === 'ticket' ? 'Reject regularisation request' : 'Reject timesheet entry'}
        subject={rejecting ? rejecting.row.org_membership?.person?.name || rejecting.row.requester?.name || '' : ''}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => (rejecting.kind === 'ticket' ? decideTicket(rejecting.row.id, 'rejected', reason) : decideEntry(rejecting.row.id, 'rejected', reason))}
      />
      <DrillDownDrawer member={drillMember} period={period} onClose={() => setDrillMember(null)} />
      <AssignTaskDrawer open={taskDrawerOpen} onClose={() => setTaskDrawerOpen(false)} onCreated={loadTasks} />
    </div>
  );
}
