import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function previousMonth() {
  const d = new Date();
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return { year: prev.getFullYear(), month: prev.getMonth() + 1 };
}

/** Admin: the approval chain switches. Employee -> Manager (optional) -> Admin (mandatory). */
function ApprovalPolicyCard() {
  const { pushError, pushSuccess } = useAlerts();
  const [policy, setPolicy] = useState(null);

  useEffect(() => {
    apiClient.get('/timesheets/approval-policy').then(({ data }) => setPolicy(data.data)).catch(() => setPolicy(null));
  }, []);

  async function toggle(key) {
    try {
      const { data } = await apiClient.patch('/timesheets/approval-policy', { [key]: !policy[key] });
      setPolicy(data.data);
      pushSuccess('Approval settings saved');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save the approval settings'), 'Something went wrong');
    }
  }

  if (!policy) return null;
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Approval chain</h3>
      <p className="mt-1 text-xs text-tertiary-500">Employee &rarr; Manager (optional) &rarr; Admin (mandatory). Applies to timesheets and overtime tickets.</p>
      <div className="mt-3 flex flex-wrap gap-6 text-sm">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={policy.timesheet_manager_approval} onChange={() => toggle('timesheet_manager_approval')} /> Manager approval enabled</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={policy.timesheet_admin_approval} onChange={() => toggle('timesheet_admin_approval')} /> Admin final approval required</label>
      </div>
    </section>
  );
}

/** The lock audit trail: who locked / reopened what, when, and why. One row per employee / project. */
function LockAuditList({ year, month, refreshKey }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    apiClient.get('/calculations/lock-audit', { params: { year, month, limit: 100 } }).then(({ data }) => setRows(data.data || [])).catch(() => setRows([]));
  }, [year, month, refreshKey]);
  const columns = [
    { key: 'when', header: 'When', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'actor', header: 'By', render: (r) => r.actor?.name || '—' },
    { key: 'stage', header: 'Stage', render: (r) => r.stage },
    { key: 'action', header: 'Action', render: (r) => r.action.replace(/_/g, ' ') },
    { key: 'who', header: 'Employee / project', render: (r) => r.employee?.name || r.project?.name || '—' },
    { key: 'status', header: 'Status', render: (r) => `${r.previous_status || '—'} → ${r.new_status || '—'}` },
    { key: 'change', header: 'Change', render: (r) => r.change || '—' },
    { key: 'reason', header: 'Reason', render: (r) => r.reason || '—' },
  ];
  return <DataTable columns={columns} rows={rows} emptyLabel="No lock activity for this month" maxHeight="24rem" />;
}

/**
 * Admin: stage 1 of the financial lock - lock a month of timesheets per employee (one or many at once).
 * The previous month is due by the 5th of the next one; locking is manual. Reopen needs a reason.
 * Every employee gets their own audit row, bulk or not.
 */
export default function TimesheetLocksTab() {
  const { pushError, pushSuccess } = useAlerts();
  const initial = useMemo(() => previousMonth(), []);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);
  const [auditKey, setAuditKey] = useState(0);

  const load = useCallback(() => {
    setData(null);
    apiClient.get('/timesheets/locks/month-status', { params: { year, month } })
      .then(({ data: res }) => { setData(res.data); setSelected(new Set()); })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the lock status'), 'Something went wrong'));
  }, [year, month, pushError]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function run(path, body, done) {
    setBusy(true);
    try {
      const { data: res } = await apiClient.post(path, body);
      pushSuccess(done(res.data));
      setReason('');
      load();
      setAuditKey((k) => k + 1);
    } catch (err) {
      pushError(apiErrorMessage(err, 'The lock action failed'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const ids = [...selected];
  // A timesheet is not locked while entries wait for approval; "force" is the admin override (needs a reason).
  const lockedText = (r) => `${r.locked} timesheet${r.locked === 1 ? '' : 's'} locked${r.pending_entries ? ` - ${r.pending_entries} skipped because entries are still waiting for approval` : ''}`;
  const lockSelected = () => run('/timesheets/locks/month', { year, month, org_membership_ids: ids, reason: reason.trim() || undefined, force: force || undefined }, lockedText);
  const lockAll = () => run('/timesheets/locks/month', { year, month, all_with_entries: true, reason: reason.trim() || undefined, force: force || undefined }, lockedText);
  const reopen = () => run('/timesheets/locks/month/reopen', { year, month, org_membership_ids: ids, reason: reason.trim() }, (r) => `${r.reopened} timesheet${r.reopened === 1 ? '' : 's'} reopened`);

  const columns = [
    { key: 'pick', header: '', render: (r) => <input type="checkbox" checked={selected.has(r.org_membership_id)} onChange={() => toggle(r.org_membership_id)} aria-label={`Select ${r.name}`} /> },
    { key: 'name', header: 'Employee', render: (r) => r.name },
    { key: 'department', header: 'Department', render: (r) => r.department || '—' },
    { key: 'hours', header: 'Hours', render: (r) => `${r.hours}h` },
    { key: 'entries', header: 'Entries', render: (r) => `${r.entries} (${r.pending} pending)` },
    { key: 'approval', header: 'Approval', render: (r) => (r.pending > 0 ? <span className="text-xs font-medium text-warning-700">{r.pending} waiting for approval</span> : <span className="text-xs text-success-700">All decided</span>) },
    { key: 'lock', header: 'Lock', render: (r) => (r.locked ? <span className="inline-flex items-center gap-1 text-xs"><Lock className="h-3 w-3" /> Locked</span> : <span className={`inline-flex items-center gap-1 text-xs ${r.needs_lock ? 'font-medium text-danger-600' : 'text-tertiary-500'}`}><LockOpen className="h-3 w-3" /> {r.needs_lock ? 'Open - overdue' : 'Open'}</span>) },
  ];

  return (
    <div className="space-y-4">
      <ApprovalPolicyCard />
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Stage 1 - timesheet lock</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Attendance locks</h2>
          {data && <p className={`mt-1 text-sm ${data.overdue ? 'font-medium text-danger-600' : 'text-tertiary-500'}`}>{MONTHS[month - 1]} {year} timesheets are due to be locked by {data.due_date}{data.overdue ? ' - the deadline has passed' : ''}.</p>}
        </div>
        <div className="flex gap-2">
          <label className="text-xs font-medium text-tertiary-600">Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[initial.year - 1, initial.year, initial.year + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-tertiary-600">Reason (required to reopen)
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-64 rounded-xl border px-3 py-2 text-sm" placeholder="e.g. September close" />
        </label>
        <label className="inline-flex items-center gap-1.5 pb-2 text-xs text-tertiary-600"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Lock even with entries pending approval (needs a reason)</label>
        <button type="button" className="btn-primary" disabled={busy || ids.length === 0 || (force && reason.trim().length < 3)} onClick={lockSelected}>Lock selected ({ids.length})</button>
        <button type="button" className="btn-secondary" disabled={busy || (force && reason.trim().length < 3)} onClick={lockAll}>Lock everyone with entries</button>
        <button type="button" className="btn-secondary" disabled={busy || ids.length === 0 || reason.trim().length < 3} onClick={reopen}>Reopen selected</button>
      </div>
      <DataTable columns={columns} rows={data?.people || []} loading={!data} emptyLabel="Nobody to show" maxHeight="calc(100dvh - 26rem)" />
      <section className="space-y-2">
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Lock audit trail</h3>
        <LockAuditList year={year} month={month} refreshKey={auditKey} />
      </section>
    </div>
  );
}
