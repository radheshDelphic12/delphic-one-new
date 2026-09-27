import { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, LogIn, LogOut, Wrench } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { ATTENDANCE_CHANGED, useTodayAttendance } from '../../lib/useTodayAttendance.js';
import LeaveDayNotice from '../time/LeaveDayNotice.jsx';
import CheckoutPrompt from './CheckoutPrompt.jsx';

const STATUS_OPTIONS = ['', 'present', 'absent', 'half_day', 'leave', 'holiday', 'wfh'];

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }
  return new Date(value);
}

function attendanceDate(row) {
  return row?.work_date || row?.date || row?.created_at;
}

function formatDate(row) {
  const parsed = formatDateValue(attendanceDate(row));
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString() : 'Not set';
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

function formatMinutes(value) {
  if (value === null || value === undefined) return 'Not calculated';
  const hours = Math.floor(Number(value) / 60);
  const minutes = Number(value) % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function RegularizeDrawer({ row, open, onClose, onSaved }) {
  const { pushError } = useAlerts();
  const [status, setStatus] = useState(row?.status || 'present');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setStatus(row?.status || 'present');
      setReason('');
    }
  }, [open, row]);

  async function submit(event) {
    event.preventDefault();
    if (!row || !reason.trim()) return;
    setSaving(true);
    try {
      const { data } = await apiClient.post(`/attendance/${row.id}/regularize`, {
        status,
        reason: reason.trim(),
      });
      onSaved(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to regularize attendance'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title="Regularize attendance" onClose={onClose} size="sm" tone="edit" footer={(
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="regularize-attendance" className="btn-primary" disabled={saving || !reason.trim()}>
          {saving ? 'Saving...' : 'Save correction'}
        </button>
      </>
    )}>
      <form id="regularize-attendance" onSubmit={submit} className="space-y-4">
        <div className="rounded-xl bg-tertiary-50 p-3 text-sm text-tertiary-600">
          {row?.org_membership?.person?.name} · {formatDate(row)}
        </div>
        <label className="block text-xs font-medium text-tertiary-600">
          Attendance status
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
            {STATUS_OPTIONS.filter(Boolean).map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Reason
          <textarea required value={reason} onChange={(event) => setReason(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
      </form>
    </Drawer>
  );
}

export default function AttendancePage() {
  const { user } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('mine');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [status, setStatus] = useState('');
  const [regularize, setRegularize] = useState(null);
  const {
    today,
    leaveToday,
    busy: actionLoading,
    checkIn,
    requestCheckOut,
    confirmCheckOut,
    promptOpen: checkoutPromptOpen,
    closePrompt,
  } = useTodayAttendance(user);

  async function loadAttendance() {
    setLoading(true);
    try {
      const endpoint = tab === 'team' ? '/attendance' : '/attendance/me';
      const { data } = await apiClient.get(endpoint, { params: { from, to } });
      setRows(data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load attendance'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAttendance();
  }, [tab, from, to]);

  // A check-in/out from here or the header refreshes the table.
  useEffect(() => {
    window.addEventListener(ATTENDANCE_CHANGED, loadAttendance);
    return () => window.removeEventListener(ATTENDANCE_CHANGED, loadAttendance);
  });

  function handleRegularized(updated) {
    setRows((current) => current.map((row) => row.id === updated.id ? { ...row, ...updated } : row));
    setRegularize(null);
    pushInfo('Attendance record updated');
  }

  const columns = [
    ...(tab === 'team' ? [{ key: 'employee', header: 'Employee', render: (row) => row.org_membership?.person?.name || 'Unknown' }] : []),
    { key: 'date', header: 'Date', render: (row) => formatDate(row) },
    { key: 'status', header: 'Status', render: (row) => <Badge value={row.status} /> },
    { key: 'check_in', header: 'Check in', render: (row) => formatDateTime(row.check_in_at) },
    { key: 'check_out', header: 'Check out', render: (row) => formatDateTime(row.check_out_at) },
    {
      key: 'late',
      header: 'Late',
      render: (row) => {
        if (row.late_minutes === null || row.late_minutes === undefined) return <span className="text-tertiary-400">No shift</span>;
        if (row.late_minutes === 0) return <span className="text-success-700">On time</span>;
        return <span className="font-medium text-danger-600">{formatMinutes(row.late_minutes)} late</span>;
      },
    },
    { key: 'overtime', header: 'Overtime', render: (row) => formatMinutes(row.overtime_minutes) },
    ...(tab === 'team' ? [{ key: 'actions', header: 'Actions', render: (row) => <button type="button" className="btn-ghost inline-flex items-center gap-1" onClick={(event) => { event.stopPropagation(); setRegularize(row); }}><Wrench className="h-3.5 w-3.5" /> Correct</button> }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">People</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Attendance</h2>
          <p className="mt-1 text-sm text-tertiary-500">Track check-ins, check-outs, daily status, and overtime.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="text-xs font-medium text-tertiary-600">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="text-xs font-medium text-tertiary-600">Status<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm"><option value="">All statuses</option>{STATUS_OPTIONS.filter(Boolean).map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}</select></label>
        </div>
      </div>
      <div className="flex gap-1 border-b border-tertiary-200">
        <button type="button" className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === 'mine' ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => setTab('mine')}>My attendance</button>
        {isAdmin && <button type="button" className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === 'team' ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => setTab('team')}>Team attendance</button>}
      </div>
      {tab === 'mine' && (
        <section className="rounded-2xl border border-primary-100 bg-primary-50/50 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3"><Clock3 className="h-5 w-5 text-primary-700" /><div><h3 className="font-semibold text-tertiary-900">Today</h3><p className="text-sm text-tertiary-600">{today ? `${formatDateTime(today.check_in_at)} to ${formatDateTime(today.check_out_at)}` : 'No attendance recorded yet.'}</p></div></div>
            <div className="flex gap-2">
              {!today?.check_in_at && <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={checkIn} disabled={actionLoading || leaveToday.is_leave_day}><LogIn className="h-4 w-4" /> Check in</button>}
              {today?.check_in_at && !today?.check_out_at && <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={requestCheckOut} disabled={actionLoading || leaveToday.is_leave_day}><LogOut className="h-4 w-4" /> Check out</button>}
              {today?.check_out_at && <span className="inline-flex items-center gap-2 rounded-xl bg-green-50 px-3 py-2 text-sm font-medium text-green-700"><CheckCircle2 className="h-4 w-4" /> Complete</span>}
            </div>
          </div>
          <div className="mt-3"><LeaveDayNotice leave={leaveToday} what="check-in, check-out, timesheet and project hours" /></div>
        </section>
      )}
      <CheckoutPrompt open={checkoutPromptOpen} onClose={closePrompt} onConfirm={confirmCheckOut} />
      {!loading && rows.filter((row) => !status || row.status === status).length === 0 ? <EmptyState icon={CalendarClock} title="No attendance records" description="There are no attendance records for the selected period." /> : <DataTable columns={columns} rows={rows.filter((row) => !status || row.status === status)} loading={loading} maxHeight="calc(100dvh - 22rem)" emptyLabel="No attendance records" />}
      <RegularizeDrawer row={regularize} open={Boolean(regularize)} onClose={() => setRegularize(null)} onSaved={handleRegularized} />
    </div>
  );
}
