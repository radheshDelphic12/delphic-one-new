import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pill from '../../components/ui/Pill.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inputCls = 'mt-1 block w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const FNF_LABEL = { not_started: 'Not started', pending: 'Pending', in_progress: 'In progress', settled: 'Settled' };
const FNF_TONE = { not_started: 'gray', pending: 'amber', in_progress: 'blue', settled: 'green' };

function FnfForm({ row, saving, onSubmit, onCancel }) {
  const f = row.fnf || {};
  const [amount, setAmount] = useState(f.amount ?? '');
  const [startDate, setStartDate] = useState(f.start_date || row.last_working_day || '');
  const [fnfDate, setFnfDate] = useState(f.fnf_date || '');
  const [status, setStatus] = useState(row.status === 'not_started' ? 'pending' : row.status);
  const [notes, setNotes] = useState(f.notes || '');
  const submit = (e) => {
    e.preventDefault();
    onSubmit({ amount: amount === '' ? null : Number(amount), start_date: startDate || null, fnf_date: fnfDate || null, status, notes: notes || null });
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>FnF amount (₹)<input type="number" min="0" step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className={labelCls}>Status
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {['pending', 'in_progress', 'settled'].map((s) => <option key={s} value={s}>{FNF_LABEL[s]}</option>)}
          </select>
        </label>
        <label className={labelCls}>FnF start date<input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label className={labelCls}>FnF date (settled on)<input type="date" className={inputCls} value={fnfDate} onChange={(e) => setFnfDate(e.target.value)} /></label>
      </div>
      <label className={labelCls}>Notes<textarea rows={3} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

/** Full and final settlement of everyone who has left: amount, start date, settled date and status. */
export function FnfTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/payroll/fnf', { params: status ? { status } : {} })
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load FnF'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [status, pushError]);
  useEffect(() => { load(); }, [load]);

  async function save(body) {
    setSaving(true);
    try {
      await apiClient.patch(`/payroll/fnf/${editing.org_membership_id}`, body);
      pushSuccess('FnF saved');
      setEditing(null);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save FnF'), 'Not saved');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'name', header: 'Employee', render: (r) => <span>{r.name}<span className="block text-xs text-tertiary-500">{[r.employee_code, r.department].filter(Boolean).join(' · ')}</span></span> },
    { key: 'lwd', header: 'Last working day', render: (r) => r.last_working_day || '-' },
    { key: 'amount', header: 'FnF amount', render: (r) => (r.fnf?.amount != null ? inr(r.fnf.amount) : <span className="text-tertiary-400">Not set</span>) },
    { key: 'start', header: 'Start date', render: (r) => r.fnf?.start_date || '-' },
    { key: 'date', header: 'FnF date', render: (r) => r.fnf?.fnf_date || '-' },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={FNF_TONE[r.status]}>{FNF_LABEL[r.status]}</Pill> },
    { key: 'act', header: '', render: (r) => <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setEditing(r)}>Update</button> },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm text-tertiary-500">Everyone who has left the company. A record starts as Pending when someone is exited.</p>
        <label className={labelCls}>Status
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {Object.entries(FNF_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <DataTable columns={columns} rows={rows.map((r) => ({ ...r, id: r.org_membership_id }))} loading={loading} emptyLabel="Nobody has left yet." />
      <Modal open={Boolean(editing)} title={editing ? `FnF: ${editing.name}` : ''} onClose={() => setEditing(null)}>
        {editing && <FnfForm key={editing.org_membership_id} row={editing} saving={saving} onSubmit={save} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

/** Increment reminders (Super Admin users only): an employee completed another year. Nothing changes salary by itself. */
export function IncrementRemindersTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/payroll/increment-reminders', { params: { status } })
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load reminders'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [status, pushError]);
  useEffect(() => { load(); }, [load]);

  async function decide(row, next) {
    try {
      await apiClient.post(`/payroll/increment-reminders/${row.id}/decision`, { status: next });
      pushSuccess(next === 'completed' ? 'Marked completed' : 'Ignored');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not update'), 'Not saved');
    }
  }

  const columns = [
    { key: 'name', header: 'Employee', render: (r) => <span>{r.name}<span className="block text-xs text-tertiary-500">{[r.company, r.department, r.designation].filter(Boolean).join(' · ')}</span></span> },
    { key: 'years', header: 'Completed', render: (r) => `${r.years_completed} year${r.years_completed === 1 ? '' : 's'}` },
    { key: 'due', header: 'Anniversary', render: (r) => r.due_date },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={r.status === 'pending' ? 'amber' : r.status === 'completed' ? 'green' : 'gray'}>{r.status}</Pill> },
    {
      key: 'act',
      header: '',
      render: (r) => r.status === 'pending' && (
        <span className="flex gap-2">
          <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => decide(r, 'completed')}>Completed</button>
          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => decide(r, 'ignored')}>Ignore</button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm text-tertiary-500">Reminders stay here until marked Completed or Ignored. Salary is never changed automatically.</p>
        <label className={labelCls}>Show
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {['pending', 'completed', 'ignored', 'all'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No increment reviews are due." />
    </div>
  );
}

/** Earlier months' salary that was not paid for days worked; the admin picks what to add to this run. */
export function PreviousDuesModal({ run, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    if (!run) return;
    setLoading(true);
    apiClient.get(`/payroll/runs/${run.id}/previous-dues`)
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load previous dues'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [run, pushError]);
  useEffect(() => { load(); }, [load]);

  async function add(row) {
    setBusy(`${row.org_membership_id}-${row.due_month}-${row.due_year}`);
    try {
      const { data } = await apiClient.post(`/payroll/runs/${run.id}/previous-dues/add`, { org_membership_id: row.org_membership_id, due_month: row.due_month, due_year: row.due_year });
      pushSuccess(data.meta?.needs_refresh ? 'Added. Use "Update payroll" to refresh the payslips.' : 'Added to this month\'s salary');
      load();
      onDone?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not add'), 'Not added');
    } finally {
      setBusy('');
    }
  }

  const columns = [
    { key: 'name', header: 'Employee', render: (r) => r.name },
    { key: 'month', header: 'For', render: (r) => `${MONTHS[r.due_month - 1]} ${r.due_year}` },
    { key: 'note', header: '', render: (r) => <span className="text-xs text-tertiary-500">{r.had_payslip ? 'Paid less than earned' : 'No payslip that month'}</span> },
    { key: 'amount', header: 'Unpaid', render: (r) => inr(r.amount) },
    { key: 'act', header: '', render: (r) => <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy === `${r.org_membership_id}-${r.due_month}-${r.due_year}`} onClick={() => add(r)}>Add to this month</button> },
  ];

  return (
    <Modal open={Boolean(run)} title="Previous months' unpaid salary" onClose={onClose}>
      <p className="mb-3 text-sm text-tertiary-500">Nothing is added automatically. Whatever you do not add is shown again next month.</p>
      <DataTable columns={columns} rows={rows.map((r) => ({ ...r, id: `${r.org_membership_id}-${r.due_month}-${r.due_year}` }))} loading={loading} emptyLabel="No earlier salary is pending." />
    </Modal>
  );
}
