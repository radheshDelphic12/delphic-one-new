import { useEffect, useState } from 'react';
import { CalendarDays, Check, CircleHelp, FilePlus2, Undo2, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { useOrgMembershipOptions } from '../../lib/lookups.js';
import LeaveBalancesPanel from './LeaveBalancesPanel.jsx';
import LeaveTypesAdmin from './LeaveTypesAdmin.jsx';

const STANDARD_LEAVE_TYPES = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Casual Leave', paid: true, annual_quota: 12 },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Sick Leave', paid: true, annual_quota: 12 },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Earned Leave', paid: true, annual_quota: 18 },
  { id: '00000000-0000-4000-8000-000000000004', name: 'Unpaid Leave', paid: false, annual_quota: 0 },
  { id: '00000000-0000-4000-8000-000000000005', name: 'Comp Off', paid: true, annual_quota: 0 },
];

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }
  return new Date(value);
}

function formatDate(value) {
  const parsed = parseDateValue(value);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString() : 'Not set';
}

function formatRequestDate(row, side) {
  const value = side === 'start'
    ? row?.start_date || row?.from_date || row?.created_at
    : row?.end_date || row?.to_date || row?.created_at;
  return formatDate(value);
}

// `admin` = an admin applying leave: they pick the employee (blank = themselves)
// and may approve it in the same step. Everything else - the rules and the
// conflict checks against timesheets - is the same as a self request.
function LeaveRequestDrawer({ types, open, onClose, onSaved, admin = false }) {
  const { pushError } = useAlerts();
  const employees = useOrgMembershipOptions(admin && open);
  const [fields, setFields] = useState({
    org_membership_id: '',
    auto_approve: false,
    override_attendance: false,
    leave_type_id: '',
    from_date: '',
    to_date: '',
    reason: '',
    is_half_day: false,
    half_day_session: null,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setFields({
        org_membership_id: '',
        auto_approve: false,
        override_attendance: false,
        leave_type_id: types[0]?.id || '',
        from_date: '',
        to_date: '',
        reason: '',
        is_half_day: false,
        half_day_session: null,
      });
    }
  }, [open, types]);

  function set(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  // Admin special case: full-day leave over days marked present (approved at once, reason required).
  const overrideOn = admin && fields.override_attendance && !fields.is_half_day;

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const { org_membership_id: employeeId, auto_approve: autoApprove, override_attendance: _override, ...rest } = fields;
      const body = { ...rest, half_day_session: fields.is_half_day ? fields.half_day_session : null };
      const { data } = admin
        ? await apiClient.post('/leave/requests/admin', { ...body, ...(employeeId ? { org_membership_id: employeeId } : {}), auto_approve: overrideOn || autoApprove, ...(overrideOn ? { override_attendance: true } : {}) })
        : await apiClient.post('/leave/requests', body);
      onSaved(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to submit leave request'), 'Leave request not submitted');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title={admin ? 'Apply leave for an employee' : 'Request leave'} onClose={onClose} size="md" tone="create" footer={(
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="leave-request-form" className="btn-primary" disabled={saving || !fields.leave_type_id || !fields.from_date || !fields.to_date || (overrideOn && fields.reason.trim().length < 3)}>{saving ? 'Submitting...' : admin && (fields.auto_approve || overrideOn) ? 'Apply and approve' : 'Submit request'}</button>
      </>
    )}>
      <form id="leave-request-form" onSubmit={submit} className="space-y-4">
        {admin && <label className="block text-xs font-medium text-tertiary-600">Employee<SearchableSelect value={fields.org_membership_id} onChange={(value) => set('org_membership_id', value)} options={employees} allowClear className="mt-1" placeholder="Myself" searchPlaceholder="Search employees..." ariaLabel="Employee" /><span className="mt-1 block font-normal text-tertiary-500">Leave blank to apply for yourself.</span></label>}
        <label className="block text-xs font-medium text-tertiary-600">Leave type<select required value={fields.leave_type_id} onChange={(event) => set('leave_type_id', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"><option value="">Select leave type</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}{type.paid ? ' (paid)' : ' (unpaid)'}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-tertiary-600">From<input required type="date" value={fields.from_date} onChange={(event) => set('from_date', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label><label className="text-xs font-medium text-tertiary-600">To<input required type="date" value={fields.to_date} onChange={(event) => set('to_date', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label></div>
        <p className="text-xs text-tertiary-500">A full day is 9h and a half day 4.5h (paid leave counts toward paid hours, unpaid does not). Only working days are deducted — weekends and holidays on your calendar inside the dates are not counted. You can&apos;t take a full day off on a date you were marked present.</p>
        <label className="flex items-center gap-2 text-sm text-tertiary-700">
          <input
            type="checkbox"
            checked={fields.is_half_day}
            onChange={(event) => {
              const isHalfDay = event.target.checked;
              setFields((current) => ({
                ...current,
                is_half_day: isHalfDay,
                half_day_session: isHalfDay ? current.half_day_session || 'FIRST_HALF' : null,
              }));
            }}
          />
          Half-day request
        </label>
        {fields.is_half_day && (
          <fieldset className="rounded-xl border border-tertiary-200 p-3">
            <legend className="px-1 text-xs font-medium text-tertiary-600">Half-day session</legend>
            <div className="flex gap-4 text-sm text-tertiary-700">
              <label className="flex items-center gap-2">
                <input type="radio" name="half_day_session" value="FIRST_HALF" checked={fields.half_day_session === 'FIRST_HALF'} onChange={(event) => set('half_day_session', event.target.value)} />
                First half
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="half_day_session" value="SECOND_HALF" checked={fields.half_day_session === 'SECOND_HALF'} onChange={(event) => set('half_day_session', event.target.value)} />
                Second half
              </label>
            </div>
          </fieldset>
        )}
        {admin && !fields.is_half_day && <label className="flex items-start gap-2 text-sm text-tertiary-700"><input type="checkbox" className="mt-1" checked={fields.override_attendance} onChange={(event) => set('override_attendance', event.target.checked)} /><span>Override attendance (special case)<span className="block text-xs text-tertiary-500">Applies the leave even on days the employee was marked present. Those days change to leave and are audited, and the leave is approved immediately. A reason is required.</span></span></label>}
        {admin && <label className="flex items-start gap-2 text-sm text-tertiary-700"><input type="checkbox" className="mt-1" checked={fields.auto_approve || overrideOn} disabled={overrideOn} onChange={(event) => set('auto_approve', event.target.checked)} /><span>Approve immediately<span className="block text-xs text-tertiary-500">Otherwise it goes to the approval queue as Pending. Either way it is refused if the employee already has a conflicting timesheet.</span></span></label>}
        <label className="block text-xs font-medium text-tertiary-600">Reason{overrideOn && <span className="font-normal text-tertiary-500"> (required - why the attendance is changed, e.g. emergency)</span>}<textarea required={overrideOn} minLength={overrideOn ? 3 : undefined} value={fields.reason} onChange={(event) => set('reason', event.target.value)} rows={4} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
      </form>
    </Drawer>
  );
}

function DecisionDrawer({ row, open, onClose, onSaved }) {
  const { pushError } = useAlerts();
  const [status, setStatus] = useState('approved');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await apiClient.post(`/leave/requests/${row.id}/decision`, { status, reason: reason.trim() || undefined });
      onSaved(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to decide leave request'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return <Drawer open={open} title="Review leave request" onClose={onClose} size="sm" tone="edit" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="leave-decision-form" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save decision'}</button></>}>
    <form id="leave-decision-form" onSubmit={submit} className="space-y-4"><div className="rounded-xl bg-tertiary-50 p-3 text-sm text-tertiary-600">{row?.org_membership?.person?.name} · {row?.leave_type?.name}<br />{formatRequestDate(row, 'start')} to {formatRequestDate(row, 'end')}</div><label className="block text-xs font-medium text-tertiary-600">Decision<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label><label className="block text-xs font-medium text-tertiary-600">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label></form>
  </Drawer>;
}

// An already-approved paid leave can be converted to Unpaid Leave as a whole.
// The request stays approved. Only the type changes.
function MarkUnpaidModal({ row, onClose, onDone }) {
  const { pushError } = useAlerts();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (row) setReason(''); }, [row]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post(`/leave/requests/${row.id}/mark-unpaid`, { reason: reason.trim() || undefined });
      onDone();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to mark the leave unpaid'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={Boolean(row)} title="Mark leave unpaid" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Keep paid</button><button type="submit" form="mark-unpaid-form" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Mark unpaid'}</button></>}>
      <form id="mark-unpaid-form" onSubmit={submit} className="space-y-3">
        <p className="text-tertiary-600">{row?.org_membership?.person?.name} · {row?.leave_type?.name} · {formatRequestDate(row, 'start')} to {formatRequestDate(row, 'end')}</p>
        <p className="text-xs text-tertiary-500">The leave stays approved. It becomes Unpaid Leave, so those days no longer count as paid.</p>
        <label className="block text-xs font-medium text-tertiary-600">Reason <span className="font-normal text-tertiary-400">(optional)</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
      </form>
    </Modal>
  );
}

// Admin withdraws a pending or already-approved leave. The days go back to the
// employee's balance on their own (balances are computed from approved leave).
function WithdrawModal({ row, onClose, onDone }) {
  const { pushError } = useAlerts();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (row) setReason(''); }, [row]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post(`/leave/requests/${row.id}/revoke`, { reason: reason.trim() || undefined });
      onDone();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to withdraw the leave'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={Boolean(row)} title="Withdraw leave" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Keep leave</button><button type="submit" form="withdraw-leave-form" className="btn-primary" disabled={saving}>{saving ? 'Withdrawing…' : 'Withdraw leave'}</button></>}>
      <form id="withdraw-leave-form" onSubmit={submit} className="space-y-3">
        <p className="text-tertiary-600">{row?.org_membership?.person?.name} · {row?.leave_type?.name} · {formatRequestDate(row, 'start')} to {formatRequestDate(row, 'end')}</p>
        <p className="text-xs text-tertiary-500">The leave is cancelled and the days go back to the employee&apos;s balance. If it was approved, attendance and timesheets open up again for those dates.</p>
        <label className="block text-xs font-medium text-tertiary-600">Reason <span className="font-normal text-tertiary-400">(optional, shown to the employee)</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
      </form>
    </Modal>
  );
}

export default function LeavePage() {
  const { user } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('mine');
  const [types, setTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [requestOpen, setRequestOpen] = useState(false);
  const [adminApplyOpen, setAdminApplyOpen] = useState(false);
  const [decision, setDecision] = useState(null);
  const [withdrawing, setWithdrawing] = useState(null);
  const [markingUnpaid, setMarkingUnpaid] = useState(null);
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [typesResponse, rowsResponse, balancesResponse] = await Promise.all([
        apiClient.get('/leave/types'),
        apiClient.get(tab === 'team' ? '/leave/requests' : '/leave/requests/me', { params: status ? { status } : {} }),
        apiClient.get('/leave/balances/me'),
      ]);
      const apiTypes = typesResponse.data.data || [];
      setTypes(apiTypes.length > 0 ? apiTypes : STANDARD_LEAVE_TYPES);
      setRows(rowsResponse.data.data || []);
      setBalances(balancesResponse.data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load leave data'), 'Something went wrong');
    } finally {
      setLoading(false);
      setBalancesLoading(false);
    }
  }

  useEffect(() => { load(); }, [tab, status]);

  async function cancelRequest(row) {
    try {
      await apiClient.post(`/leave/requests/${row.id}/cancel`);
      pushInfo('Leave request cancelled');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to cancel leave request'), 'Something went wrong');
    }
  }

  // Approval queue: approve every pending request shown, one decision each.
  const pendingRows = tab === 'team' ? rows.filter((row) => row.status === 'pending') : [];
  const [bulkBusy, setBulkBusy] = useState(false);
  async function approveAllPending() {
    if (!pendingRows.length || !window.confirm(`Approve all ${pendingRows.length} pending leave request${pendingRows.length === 1 ? '' : 's'}?`)) return;
    setBulkBusy(true);
    let failed = 0;
    for (const row of pendingRows) {
      try { await apiClient.post(`/leave/requests/${row.id}/decision`, { status: 'approved' }); } catch { failed += 1; }
    }
    setBulkBusy(false);
    if (failed) pushError(`${pendingRows.length - failed} approved; ${failed} could not be approved.`, 'Some requests were skipped');
    else pushInfo(`${pendingRows.length} leave request${pendingRows.length === 1 ? '' : 's'} approved`);
    load();
  }

  function replaceRow(updated) {
    setRows((current) => current.map((row) => row.id === updated.id ? { ...row, ...updated } : row));
    setDecision(null);
    pushInfo('Leave request updated');
  }

  const columns = [
    ...(tab === 'team' ? [{ key: 'employee', header: 'Employee', render: (row) => row.org_membership?.person?.name || 'Unknown' }] : []),
    { key: 'type', header: 'Leave type', render: (row) => <span>{row.leave_type?.name || 'Unknown'} <span className="text-xs text-tertiary-500">({row.leave_type?.paid === false ? 'Unpaid' : 'Paid'})</span></span> },
    { key: 'dates', header: 'Dates', render: (row) => `${formatRequestDate(row, 'start')} to ${formatRequestDate(row, 'end')}` },
    { key: 'days', header: 'Days', render: (row) => (row.is_half_day ? 'Half day (0.5)' : row.days ?? '—') },
    { key: 'status', header: 'Status', render: (row) => <Badge value={row.status} /> },
    { key: 'reason', header: 'Reason', render: (row) => row.reason || 'Not provided' },
    { key: 'actions', header: 'Actions', render: (row) => tab === 'team' && (row.status === 'pending' || row.status === 'approved') ? <div className="flex gap-1">{row.status === 'pending' && <button type="button" className="btn-ghost inline-flex items-center gap-1" onClick={() => setDecision(row)}><Check className="h-3.5 w-3.5" /> Review</button>}{row.status === 'approved' && row.leave_type?.paid !== false && <button type="button" className="btn-ghost inline-flex items-center gap-1" onClick={() => setMarkingUnpaid(row)}>Mark unpaid</button>}<button type="button" className="btn-ghost inline-flex items-center gap-1" onClick={() => setWithdrawing(row)}><Undo2 className="h-3.5 w-3.5" /> Withdraw</button></div> : tab === 'mine' && row.status === 'pending' ? <button type="button" className="btn-ghost inline-flex items-center gap-1" onClick={() => cancelRequest(row)}><X className="h-3.5 w-3.5" /> Cancel</button> : null },
  ];

  return <div className="space-y-4">
    <div className="flex flex-col gap-4 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">People</p><h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Leave management</h2><p className="mt-1 text-sm text-tertiary-500">Request time away and review approval status.</p></div><div className="flex gap-2"><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border px-3 py-2 text-sm"><option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select>{isAdmin && <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setAdminApplyOpen(true)}><FilePlus2 className="h-4 w-4" /> Apply for employee</button>}{tab === 'mine' && <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setRequestOpen(true)}><FilePlus2 className="h-4 w-4" /> Request leave</button>}</div></div>
    <div className="grid gap-4 md:grid-cols-3"><div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card md:col-span-2"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-semibold text-tertiary-800"><CircleHelp className="h-4 w-4 text-tertiary-400" /> Leave balances</div><span className="text-xs text-tertiary-400">{balances[0]?.as_of ? `1 Jan – ${new Date(`${balances[0].as_of}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Current year'}</span></div>{balancesLoading ? <p className="mt-3 text-sm text-tertiary-500">Loading balances...</p> : balances.length === 0 ? <p className="mt-3 text-sm text-tertiary-500">No leave balance records are available.</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2">{balances.map((balance) => <div key={balance.leave_type_id} className="rounded-xl border border-tertiary-100 bg-tertiary-50/50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-tertiary-800">{balance.leave_type_name} <span className="text-xs text-tertiary-400">({balance.code})</span></span><span className="text-sm font-semibold text-primary-700">{balance.unlimited ? 'Uncapped' : `${balance.remaining} remaining`}</span></div><p className="mt-1 text-xs text-tertiary-500">{balance.used} taken{balance.unlimited ? '' : ` of ${balance.allocated}`}{balance.upcoming > 0 ? ` · ${balance.upcoming} approved ahead` : ''}{balance.pending > 0 ? ` · ${balance.pending} pending` : ''}</p></div>)}</div>}</div><div className="rounded-2xl border border-tertiary-100 bg-white p-4"><p className="text-xs uppercase tracking-wide text-tertiary-500">Visible requests</p><p className="mt-2 text-2xl font-semibold text-tertiary-900">{loading ? '...' : rows.length}</p><p className="mt-4 text-xs uppercase tracking-wide text-tertiary-500">Leave types</p><p className="mt-2 text-2xl font-semibold text-tertiary-900">{loading ? '...' : types.length}</p></div></div>
    <div className="flex gap-1 border-b border-tertiary-200"><button type="button" className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === 'mine' ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => setTab('mine')}>My requests</button>{isAdmin && <button type="button" className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === 'team' ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => setTab('team')}>Approval queue</button>}{isAdmin && <button type="button" className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === 'balances' ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => setTab('balances')}>Balances</button>}</div>
    {pendingRows.length > 1 && <div className="flex justify-end"><button type="button" className="btn-primary inline-flex items-center gap-1.5 text-sm" disabled={bulkBusy} onClick={approveAllPending}><Check className="h-4 w-4" /> {bulkBusy ? 'Approving…' : `Approve all pending (${pendingRows.length})`}</button></div>}
    {tab === 'balances' ? <LeaveBalancesPanel /> : !loading && rows.length === 0 ? <EmptyState icon={CalendarDays} title="No leave requests" description="There are no leave requests for the selected status." /> : <DataTable columns={columns} rows={rows} loading={loading} maxHeight="calc(100dvh - 25rem)" emptyLabel="No leave requests" />}
    {isAdmin && <LeaveTypesAdmin />}
    <LeaveRequestDrawer types={types} open={requestOpen} onClose={() => setRequestOpen(false)} onSaved={(created) => { setRows((current) => [created, ...current]); setRequestOpen(false); pushInfo('Leave request submitted'); }} />
    {isAdmin && <LeaveRequestDrawer admin types={types} open={adminApplyOpen} onClose={() => setAdminApplyOpen(false)} onSaved={() => { setAdminApplyOpen(false); pushInfo('Leave applied'); load(); }} />}
    <MarkUnpaidModal row={markingUnpaid} onClose={() => setMarkingUnpaid(null)} onDone={() => { setMarkingUnpaid(null); pushInfo('Leave marked unpaid'); load(); }} />
    <WithdrawModal row={withdrawing} onClose={() => setWithdrawing(null)} onDone={() => { setWithdrawing(null); pushInfo('Leave withdrawn'); load(); }} />
    <DecisionDrawer row={decision} open={Boolean(decision)} onClose={() => setDecision(null)} onSaved={replaceRow} />
  </div>;
}
