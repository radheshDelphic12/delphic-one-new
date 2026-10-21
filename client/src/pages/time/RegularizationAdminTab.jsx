import { useCallback, useEffect, useState } from 'react';
import { FileClock } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';

const KINDS = [['attendance', 'Attendance'], ['timesheets', 'Project timesheets']];
const STATUS_FILTERS = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']];
const label = (s) => String(s || '').replace(/_/g, ' ');

function Actions({ row, onDecide }) {
  if (row.status !== 'pending') return <span className="text-xs text-tertiary-500">{row.decision_reason || ''}</span>;
  return (
    <span className="flex gap-1">
      <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => onDecide(row, 'approved')}>Approve</button>
      <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => onDecide(row, 'rejected')}>Reject</button>
    </span>
  );
}

/**
 * Time & Attendance → Regularization (admin): every employee's correction requests in one place, for attendance
 * and for project timesheets, with approve / reject.
 */
export default function RegularizationAdminTab({ onPendingChange }) {
  const { pushError, pushSuccess } = useAlerts();
  const [kind, setKind] = useState('attendance');
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [pending, setPending] = useState({ attendance: 0, timesheets: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status: status || undefined };
      const [a, t, pa, pt] = await Promise.all([
        kind === 'attendance' ? apiClient.get('/attendance/regularization-requests', { params }) : null,
        kind === 'timesheets' ? apiClient.get('/timesheets/regularization-tickets', { params }) : null,
        apiClient.get('/attendance/regularization-requests', { params: { status: 'pending' } }),
        apiClient.get('/timesheets/regularization-tickets', { params: { status: 'pending' } }),
      ]);
      setRows(kind === 'attendance' ? a.data.data || [] : t.data.data || []);
      const counts = { attendance: (pa.data.data || []).length, timesheets: (pt.data.data || []).length };
      setPending(counts);
      if (onPendingChange) onPendingChange(counts.attendance + counts.timesheets);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not load the requests'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [kind, status, pushError, onPendingChange]);

  useEffect(() => { load(); }, [load]);

  async function decide(row, decision) {
    let reason;
    if (decision === 'rejected') {
      reason = window.prompt('Reason for rejecting (optional):');
      if (reason === null) return;
    }
    try {
      if (kind === 'attendance') await apiClient.post(`/attendance/regularization-requests/${row.id}/decision`, { status: decision, decision_reason: reason || undefined });
      else await apiClient.post(`/timesheets/regularization-tickets/${row.id}/decision`, { status: decision, decision_reason: reason || undefined });
      pushSuccess(`Request ${decision}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not record the decision'), 'Not applied');
    }
  }

  const attendanceColumns = [
    { key: 'employee', header: 'Employee', render: (r) => <span className="font-medium text-tertiary-900">{r.employee || 'Unknown'}</span> },
    { key: 'date', header: 'Date', render: (r) => r.date },
    { key: 'want', header: 'Requested', render: (r) => <span className="capitalize">{label(r.requested_status)}{r.check_in_time ? ` (${r.check_in_time}${r.check_out_time ? ` - ${r.check_out_time}` : ''})` : ''}</span> },
    { key: 'now', header: 'Now', render: (r) => (r.current ? <span className="capitalize">{label(r.current.status)}</span> : <span className="text-tertiary-400">No record</span>) },
    { key: 'reason', header: 'Reason', render: (r) => <span className="text-tertiary-700">{r.reason}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
    { key: 'actions', header: '', render: (r) => <Actions row={r} onDecide={decide} /> },
  ];
  const timesheetColumns = [
    { key: 'employee', header: 'Employee', render: (r) => <span className="font-medium text-tertiary-900">{r.org_membership?.person?.name || r.requester?.name || 'Unknown'}</span> },
    { key: 'date', header: 'Date', render: (r) => String(r.date || r.timesheet_entry?.date || '').slice(0, 10) || '-' },
    { key: 'project', header: 'Project', render: (r) => r.account?.project_name || r.account?.name || r.timesheet_entry?.account?.project_name || r.timesheet_entry?.account?.name || '-' },
    { key: 'hours', header: 'Hours', render: (r) => (r.target_hours != null ? `${r.target_hours}h` : '-') },
    { key: 'reason', header: 'Reason', render: (r) => <span className="text-tertiary-700">{r.reason}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
    { key: 'actions', header: '', render: (r) => <Actions row={r} onDecide={decide} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="ta-head flex flex-col gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Time &amp; Attendance</p>
          <h2 className="mt-1 flex items-center gap-2 font-heading text-xl font-semibold text-tertiary-900"><FileClock className="h-5 w-5" /> Regularization requests</h2>
          <p className="mt-1 text-sm text-tertiary-500">Corrections employees asked for, for attendance and for project timesheets. Approving applies the change.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5">
            {KINDS.map(([key, text]) => (
              <button key={key} type="button" onClick={() => setKind(key)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${kind === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:text-tertiary-900'}`}>
                {text}{pending[key] > 0 ? ` (${pending[key]})` : ''}
              </button>
            ))}
          </div>
          <label className="text-xs font-medium text-tertiary-600">Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm">
              {STATUS_FILTERS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
        </div>
      </div>
      <DataTable
        columns={kind === 'attendance' ? attendanceColumns : timesheetColumns}
        rows={rows}
        loading={loading}
        emptyLabel={status === 'pending' ? 'No pending requests.' : 'No requests match.'}
      />
    </div>
  );
}
