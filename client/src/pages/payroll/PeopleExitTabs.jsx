import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inputCls = 'mt-1 block w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

async function downloadFile(path, fallbackName) {
  const res = await apiClient.get(path, { responseType: 'blob' });
  const header = res.headers?.['content-disposition'] || '';
  const name = /filename="?([^";]+)"?/i.exec(header)?.[1] || fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The FnF statement of one person: what is still payable (salary not yet paid, the last month), the lines added by hand (leave encashment, notice
 * recovery, advances ...), the net, and the documents package (the statement + every salary slip since joining) to download or to email.
 */
function FnfStatementDrawer({ row, onClose, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [data, setData] = useState(null);
  const [items, setItems] = useState([]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [payForm, setPayForm] = useState({});
  const base = row ? `/payroll/fnf/${row.org_membership_id}` : null;

  const load = useCallback(() => {
    if (!base) return Promise.resolve();
    return apiClient.get(`${base}/statement`).then(({ data: res }) => { setData(res.data); setItems(res.data.items || []); }).catch((err) => pushError(apiErrorMessage(err, 'Could not build the statement'), 'Something went wrong'));
  }, [base, pushError]);
  useEffect(() => { setData(null); setEmail(''); setNote(''); setPayForm({}); load(); }, [load]);

  if (!row) return <Drawer open={false} title="" onClose={onClose} />;
  const dirty = JSON.stringify(items) !== JSON.stringify(data?.items || []);
  const entry = data?.payroll_entry || null;
  const now = new Date();
  const payMonth = payForm.month || (entry ? String(entry.period_month) : String(now.getMonth() + 1));
  const payYear = payForm.year || (entry ? String(entry.period_year) : String(now.getFullYear()));
  const payAmount = payForm.amount !== undefined ? payForm.amount : String(entry ? entry.amount : Math.max(0, data?.totals?.net_payable || 0));
  const setItem = (i, patch) => setItems((list) => list.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  async function run(key, fn, ok) {
    setBusy(key);
    try { await fn(); if (ok) pushSuccess(ok, 'Done'); } catch (err) { pushError(apiErrorMessage(err, 'That did not work'), 'Something went wrong'); } finally { setBusy(''); }
  }
  const savePayroll = () => run('payroll', async () => {
    await apiClient.put(`${base}/payroll-entry`, { period_month: Number(payMonth), period_year: Number(payYear), amount: Number(payAmount), ...(payForm.note ? { note: payForm.note } : {}) });
    setPayForm({});
    await load();
    onChanged?.();
  }, `The final payment is placed in the ${MONTH_NAMES[Number(payMonth) - 1]} ${payYear} payroll.`);
  const clearPayroll = () => run('payroll-clear', async () => { await apiClient.delete(`${base}/payroll-entry`); setPayForm({}); await load(); onChanged?.(); }, 'The final payment is taken out of payroll.');
  const saveItems = () => run('items', async () => {
    const clean = items.filter((i) => String(i.label || '').trim() && Number(i.amount) > 0).map((i) => ({ label: i.label.trim(), kind: i.kind, amount: Number(i.amount), ...(i.note ? { note: i.note } : {}) }));
    await apiClient.put(`${base}/items`, { items: clean });
    await load();
    onChanged?.();
  }, 'The statement lines are saved.');

  return (
    <Drawer open onClose={onClose} title={`FnF statement: ${row.name}`} size="xl" tone="info"
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" disabled={Boolean(busy)} data-testid="fnf-pdf" onClick={() => run('pdf', () => downloadFile(`${base}/statement.pdf`, 'FnF-Statement.pdf'))}>{busy === 'pdf' ? 'Preparing…' : 'Download statement (PDF)'}</button>
        <button type="button" className="btn-primary" disabled={Boolean(busy)} data-testid="fnf-zip" onClick={() => run('zip', () => downloadFile(`${base}/documents.zip`, 'FnF-Documents.zip'))}>{busy === 'zip' ? 'Preparing…' : 'Download all documents (zip)'}</button>
      </div>}>
      {!data ? <p className="text-sm text-tertiary-500">Preparing the statement…</p> : (
        <div className="space-y-4 text-sm" data-testid="fnf-statement">
          <div className="rounded-xl border border-tertiary-100 bg-tertiary-50/60 p-3 text-xs text-tertiary-600">
            <b className="text-tertiary-900">{data.employee.name}</b> · {data.employee.employee_code || '—'} · {[data.employee.designation, data.employee.department].filter(Boolean).join(', ') || '—'}<br />
            Joined {data.employee.joined_at || '—'} · last working day {data.employee.last_working_day || '—'}{data.employee.service_text ? ` · service ${data.employee.service_text}` : ''}
          </div>

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Worked out from payroll</h3>
            <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
              {data.earnings.filter((l) => l.auto).map((l) => <li key={l.label} className="flex justify-between px-3 py-2"><span>{l.label}{l.note && <span className="block text-[11px] text-tertiary-500">{l.note}</span>}</span><b className="tabular-nums text-success-700">{inr(l.amount)}</b></li>)}
              {!data.earnings.some((l) => l.auto) && <li className="px-3 py-2 text-xs text-tertiary-500">No unpaid salary found on the payslips. The last month shows here when it has no payslip yet.</li>}
            </ul>
          </section>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Added by you (leave encashment, notice recovery, advances ...)</h3>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary px-2 py-1 text-xs" data-testid="fnf-add-earning" onClick={() => setItems((l) => [...l, { label: '', kind: 'earning', amount: '' }])}>+ Earning</button>
                <button type="button" className="btn-secondary px-2 py-1 text-xs" data-testid="fnf-add-deduction" onClick={() => setItems((l) => [...l, { label: '', kind: 'deduction', amount: '' }])}>+ Deduction</button>
              </div>
            </div>
            <ul className="space-y-1.5">
              {items.map((i, idx) => (
                <li key={idx} className="grid grid-cols-[6rem_1fr_8rem_auto] items-center gap-2" data-testid="fnf-item">
                  <span className={`rounded-full px-2 py-0.5 text-center text-[11px] font-medium ${i.kind === 'earning' ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'}`}>{i.kind === 'earning' ? 'Earning' : 'Deduction'}</span>
                  <input className="rounded-lg border border-tertiary-200 px-2 py-1.5 text-sm" placeholder="What is this for" aria-label="Line label" maxLength={120} value={i.label} onChange={(e) => setItem(idx, { label: e.target.value })} />
                  <input type="number" min="0" step="0.01" className="rounded-lg border border-tertiary-200 px-2 py-1.5 text-right text-sm" placeholder="Amount" aria-label="Line amount" value={i.amount} onChange={(e) => setItem(idx, { amount: e.target.value })} />
                  <button type="button" aria-label="Remove this line" className="rounded px-2 text-danger-600 hover:bg-danger-50" onClick={() => setItems((l) => l.filter((_, k) => k !== idx))}>✕</button>
                </li>
              ))}
              {!items.length && <li className="text-xs text-tertiary-500">Nothing added. Use the buttons above.</li>}
            </ul>
            {dirty && <button type="button" className="btn-primary mt-2 text-xs" data-testid="fnf-save-items" disabled={busy === 'items'} onClick={saveItems}>{busy === 'items' ? 'Saving…' : 'Save these lines'}</button>}
          </section>

          <section className="rounded-xl border border-primary-200 bg-primary-50/50 p-3" data-testid="fnf-totals">
            <div className="flex justify-between"><span>Total earnings</span><b className="tabular-nums">{inr(data.totals.earnings)}</b></div>
            <div className="flex justify-between"><span>Total deductions</span><b className="tabular-nums">-{inr(data.totals.deductions)}</b></div>
            <div className="mt-1 flex justify-between border-t border-primary-200 pt-1 text-base"><span className="font-semibold">Net payable</span><b className="tabular-nums text-primary-800">{inr(data.totals.net_payable)}</b></div>
            {data.totals.recorded_amount != null && Math.abs(data.totals.recorded_amount - data.totals.net_payable) > 0.01 && <p className="mt-1 text-xs text-warning-800">The FnF register holds {inr(data.totals.recorded_amount)}. Update it with the amount above if this is the final figure.</p>}
          </section>

          <section className="rounded-xl border border-tertiary-100 p-3" data-testid="fnf-payroll-entry">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Pay this in a payroll month</h3>
            <p className="mt-1 text-xs text-tertiary-500">Pick any month. The amount appears on that month&apos;s payroll and payslip as &quot;Full &amp; final settlement&quot;. Choosing another month moves it.</p>
            {entry && <p className="mt-1 text-xs text-success-700" data-testid="fnf-payroll-current">Now set in {MONTH_NAMES[entry.period_month - 1]} {entry.period_year}: {inr(entry.amount)} ({entry.run_status === 'processed' ? 'that payroll is processed: use Update payroll on the run to refresh the payslip' : entry.run_status === 'no_run' ? 'no payroll run for that month yet' : 'payroll is still a draft'}).</p>}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-xs text-tertiary-600">Month
                <select className="input mt-1" data-testid="fnf-pay-month" value={payMonth} onChange={(e) => setPayForm((f) => ({ ...f, month: e.target.value }))}>{MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
              </label>
              <label className="text-xs text-tertiary-600">Year
                <input type="number" min="2000" max="2100" className="input mt-1" data-testid="fnf-pay-year" value={payYear} onChange={(e) => setPayForm((f) => ({ ...f, year: e.target.value }))} />
              </label>
              <label className="text-xs text-tertiary-600">Amount (₹)
                <input type="number" min="0" step="0.01" className="input mt-1" data-testid="fnf-pay-amount" value={payAmount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
              </label>
              <label className="text-xs text-tertiary-600">Note
                <input className="input mt-1" maxLength={300} value={payForm.note ?? entry?.note ?? ''} onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))} />
              </label>
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-primary text-xs" data-testid="fnf-pay-save" disabled={busy === 'payroll' || !(Number(payAmount) > 0)} onClick={savePayroll}>{busy === 'payroll' ? 'Saving…' : entry ? 'Move / update' : 'Add to payroll'}</button>
              {entry && <button type="button" className="btn-secondary text-xs" data-testid="fnf-pay-clear" disabled={busy === 'payroll-clear'} onClick={clearPayroll}>Take out of payroll</button>}
            </div>
          </section>

          {data.leave_balances.length > 0 && <p className="text-xs text-tertiary-500">Leave balance at exit: {data.leave_balances.map((b) => `${b.name} ${b.remaining === null ? 'no cap' : b.remaining}`).join(' · ')}. Add leave encashment above if it is paid.</p>}

          <section className="rounded-xl border border-tertiary-100 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Send the documents</h3>
            <p className="mt-1 text-xs text-tertiary-500">The package holds this FnF statement and {data.payslips.length} salary slip{data.payslips.length === 1 ? '' : 's'} since joining. Email it to their personal address (the work mailbox is usually closed after exit), or download it above and share it yourself.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input type="email" className="rounded-xl border border-tertiary-200 px-3 py-2 text-sm" placeholder="Personal email address" aria-label="Email to" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button type="button" className="btn-primary" data-testid="fnf-email" disabled={busy === 'mail' || !/^\S+@\S+\.\S+$/.test(email)} onClick={() => run('mail', () => apiClient.post(`${base}/email`, { to_email: email.trim(), ...(note.trim() ? { note: note.trim() } : {}) }), `The documents are queued to ${email.trim()}.`)}>{busy === 'mail' ? 'Queuing…' : 'Email documents'}</button>
            </div>
            <textarea rows={2} className="mt-2 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm" placeholder="A line for the mail (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </section>
        </div>
      )}
    </Drawer>
  );
}

/** Full and final settlement of everyone who has left: amount, start date, settled date and status. */
export function FnfTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [statementFor, setStatementFor] = useState(null);
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
    { key: 'act', header: '', render: (r) => (
      <span className="flex gap-1.5">
        <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setEditing(r)}>Update</button>
        <button type="button" className="btn-primary px-3 py-1 text-xs" data-testid="fnf-statement-open" onClick={() => setStatementFor(r)}>Statement &amp; documents</button>
      </span>
    ) },
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
      <FnfStatementDrawer row={statementFor} onClose={() => setStatementFor(null)} onChanged={load} />
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
