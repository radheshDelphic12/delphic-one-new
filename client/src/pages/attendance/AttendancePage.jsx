import { useEffect, useState } from 'react';
import { CalendarClock, CalendarPlus, History, Trash2, Upload, Wrench } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import AffectedCalculationsBanner from '../../components/finance/AffectedCalculationsBanner.jsx';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { BackfillMonthDrawer, BulkAttendanceDrawer, ManualAttendanceDrawer } from './AttendanceBackfill.jsx';

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
  const [manualOpen, setManualOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);

  async function loadAttendance() {
    setLoading(true);
    try {
      const endpoint = tab === 'team' ? '/attendance' : '/attendance/me';
      const { data } = await apiClient.get(endpoint, { params: { from, to } });
      // My attendance: holidays on my calendar and approved leave show as rows
      // too, on days with no attendance record.
      const recorded = new Set((data.data || []).map((r) => String(attendanceDate(r)).slice(0, 10)));
      const calendarRows = (data.calendar_days || [])
        .filter((d) => !recorded.has(d.date))
        .map((d) => ({ id: `calendar-${d.date}`, date: d.date, status: d.kind, calendar_label: d.label, from_calendar: true }));
      setRows([...(data.data || []), ...calendarRows].sort((a, b) => (String(attendanceDate(a)).slice(0, 10) < String(attendanceDate(b)).slice(0, 10) ? 1 : -1)));
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load attendance'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAttendance();
  }, [tab, from, to]);

  // Admin: remove a wrong record at any stage (a finalized month is flagged
  // for recalculation rather than rewritten).
  async function removeRecord(row) {
    const reason = window.prompt(`Delete ${row.org_membership?.person?.name || 'this'} attendance for ${String(row.date).slice(0, 10)}? Give a reason (required):`);
    if (reason === null) return;
    if (reason.trim().length < 3) { pushError('A reason of at least 3 characters is required', 'Not deleted'); return; }
    try {
      const { data } = await apiClient.delete(`/attendance/${row.id}`, { data: { reason: reason.trim() } });
      const flagged = data.data?.flagged || 0;
      pushInfo(`Attendance record deleted${flagged ? ` — ${flagged} locked calculation${flagged === 1 ? '' : 's'} flagged for recalculation` : ''}`);
      setRows((current) => current.filter((r) => r.id !== row.id));
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete the attendance record'), 'Something went wrong');
    }
  }

  function handleRegularized(updated) {
    setRows((current) => current.map((row) => row.id === updated.id ? { ...row, ...updated } : row));
    setRegularize(null);
    pushInfo('Attendance record updated');
  }

  const columns = [
    ...(tab === 'team' ? [{ key: 'employee', header: 'Employee', render: (row) => row.org_membership?.person?.name || 'Unknown' }] : []),
    { key: 'date', header: 'Date', render: (row) => formatDate(row) },
    { key: 'status', header: 'Status', render: (row) => <span className="inline-flex flex-col gap-0.5"><Badge value={row.status} />{row.from_calendar && <span className="text-[11px] text-tertiary-500">{row.calendar_label}{row.status === 'holiday' ? ' · holiday calendar' : ' · approved leave'}</span>}</span> },
    ...(tab === 'team' ? [{ key: 'actions', header: 'Actions', render: (row) => <span className="flex gap-1"><button type="button" className="btn-ghost inline-flex items-center gap-1" onClick={(event) => { event.stopPropagation(); setRegularize(row); }}><Wrench className="h-3.5 w-3.5" /> Correct</button><button type="button" className="btn-ghost inline-flex items-center gap-1 text-danger-600" onClick={(event) => { event.stopPropagation(); removeRecord(row); }}><Trash2 className="h-3.5 w-3.5" /> Delete</button></span> }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">People</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Attendance</h2>
          <p className="mt-1 text-sm text-tertiary-500">Daily attendance is marked automatically at your working-hour start time on working days. Leave and holidays are shown as they are.</p>
          <p className="mt-2 max-w-2xl rounded-xl bg-primary-50 px-3 py-2 text-xs text-primary-800">
            <b>Attendance is separate from project timesheets.</b> It records whether you were present, absent or on leave. Project hours are logged in the Timesheet and never come from attendance.
          </p>
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
      {tab === 'team' && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setMonthOpen(true)}><History className="h-4 w-4" /> Backfill previous month</button>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setManualOpen(true)}><CalendarPlus className="h-4 w-4" /> Add past attendance</button>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setBulkOpen(true)}><Upload className="h-4 w-4" /> Bulk upload</button>
        </div>
      )}
      {isAdmin && tab === 'team' && <AffectedCalculationsBanner refreshKey={rows} />}
      {!loading && rows.filter((row) => !status || row.status === status).length === 0 ? <EmptyState icon={CalendarClock} title="No attendance records" description="There are no attendance records for the selected period." /> : <DataTable columns={columns} rows={rows.filter((row) => !status || row.status === status)} loading={loading} maxHeight="calc(100dvh - 22rem)" emptyLabel="No attendance records" />}
      {isAdmin && <ManualAttendanceDrawer open={manualOpen} onClose={() => setManualOpen(false)} onSaved={() => { setManualOpen(false); pushInfo('Attendance recorded'); loadAttendance(); }} />}
      {isAdmin && <BackfillMonthDrawer open={monthOpen} onClose={() => setMonthOpen(false)} onApplied={loadAttendance} />}
      {isAdmin && <BulkAttendanceDrawer open={bulkOpen} onClose={() => setBulkOpen(false)} onApplied={loadAttendance} />}
      <RegularizeDrawer row={regularize} open={Boolean(regularize)} onClose={() => setRegularize(null)} onSaved={handleRegularized} />
    </div>
  );
}
