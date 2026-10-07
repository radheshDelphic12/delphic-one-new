import { useCallback, useEffect, useRef, useState } from 'react';
import { Banknote, CheckCircle2, Clock3, Pencil } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { cleanParams } from '../analytics/AttendanceSalaryTab.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pill from '../../components/ui/Pill.jsx';

const MODES = [['bank_transfer', 'Bank transfer'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['other', 'Other']];
const MODE_LABEL = Object.fromEntries(MODES);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inputCls = 'mt-1 block w-full rounded-xl border px-3 py-2 text-sm';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const monthLabel = (key) => `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthsAgo = (n) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};
const salaries = (n) => `${n ?? '…'} ${n === 1 ? 'salary' : 'salaries'}`;
const today = () => new Date().toISOString().slice(0, 10);

function PaymentForm({ row, saving, onSubmit, onCancel }) {
  const p = row.payment;
  const [v, setV] = useState({
    status: p ? 'paid' : 'paid',
    paid_on: p?.paid_on || today(),
    amount_paid: p?.amount_paid ?? row.payable,
    payment_mode: p?.payment_mode || 'bank_transfer',
    transaction_id: p?.transaction_id || '',
    bank_name: p?.bank_name || '',
    notes: p?.notes || '',
  });
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  const paid = v.status === 'paid';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(paid
          ? { status: 'paid', paid_on: v.paid_on, amount_paid: Number(v.amount_paid), payment_mode: v.payment_mode, transaction_id: v.transaction_id, bank_name: v.bank_name, notes: v.notes }
          : { status: 'not_paid', notes: v.notes });
      }}
      className="space-y-3"
    >
      <p className="text-sm text-tertiary-600"><span className="font-medium text-tertiary-900">{row.employee}</span> · {monthLabel(row.month)} · payable {inr(row.payable)}</p>
      <div className="flex gap-4 text-sm">
        <label className="inline-flex items-center gap-2"><input type="radio" name="pay-status" checked={paid} onChange={() => setV((c) => ({ ...c, status: 'paid' }))} /> Paid</label>
        <label className="inline-flex items-center gap-2"><input type="radio" name="pay-status" checked={!paid} onChange={() => setV((c) => ({ ...c, status: 'not_paid' }))} /> Not paid</label>
      </div>
      {paid ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>Paid on<input type="date" required max={today()} className={inputCls} value={v.paid_on} onChange={set('paid_on')} /></label>
          <label className={labelCls}>Amount paid<input type="number" required min="0" step="0.01" className={inputCls} value={v.amount_paid} onChange={set('amount_paid')} /></label>
          <label className={labelCls}>Payment mode
            <select className={inputCls} value={v.payment_mode} onChange={set('payment_mode')}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className={labelCls}>Transaction ID / UTR<input className={inputCls} maxLength={120} value={v.transaction_id} onChange={set('transaction_id')} placeholder="e.g. UTR number or cheque no." /></label>
          <label className={`${labelCls} sm:col-span-2`}>Bank name<input className={inputCls} maxLength={120} value={v.bank_name} onChange={set('bank_name')} /></label>
          <label className={`${labelCls} sm:col-span-2`}>Notes<textarea rows={2} maxLength={500} className={inputCls} value={v.notes} onChange={set('notes')} /></label>
        </div>
      ) : (
        <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">Saving as Not paid clears any transaction details recorded for this month. The change is kept in the audit log.</p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

/**
 * Salary payments dashboard (admin): every employee's salary for every month in the range with whether it
 * has been paid, filterable by status, and the transaction details of each payment.
 */
export default function SalaryPaymentsTab({ filters }) {
  const { pushError, pushSuccess } = useAlerts();
  const [range, setRange] = useState({ from: monthsAgo(5), to: thisMonth() });
  const [status, setStatus] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const alertsRef = useRef({ pushError });
  useEffect(() => { alertsRef.current = { pushError }; });

  const params = cleanParams({ ...range, status, ...filters });
  const key = JSON.stringify(params);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const { data: body } = await apiClient.get('/payroll/salary-payments', { params: JSON.parse(key) });
      if (mine === seq.current) setData(body.data);
    } catch (err) {
      if (mine === seq.current) alertsRef.current.pushError(apiErrorMessage(err, 'Could not load salary payments'), 'Load failed');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [key]);
  useEffect(() => { load(); }, [load]);

  async function save(body) {
    setSaving(true);
    try {
      await apiClient.put('/payroll/salary-payments', { org_membership_id: edit.org_membership_id, period_month: edit.period_month, period_year: edit.period_year, ...body });
      pushSuccess(body.status === 'paid' ? 'Marked as paid' : 'Marked as not paid');
      setEdit(null);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the payment'), 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const t = data?.totals;
  const columns = [
    { key: 'month', header: 'Month', render: (r) => <span className="whitespace-nowrap font-medium">{monthLabel(r.month)}</span> },
    { key: 'employee', header: 'Employee', render: (r) => <span><span className="font-medium text-tertiary-900">{r.employee}</span><span className="block text-xs text-tertiary-500">{[r.employee_code, r.department].filter(Boolean).join(' · ')}</span></span> },
    { key: 'payable', header: 'Salary payable', render: (r) => <span className="tabular-nums">{inr(r.payable)}</span> },
    { key: 'status', header: 'Status', render: (r) => <span className="whitespace-nowrap"><Pill tone={r.status === 'paid' ? 'green' : 'amber'}>{r.status === 'paid' ? 'Paid' : 'Not paid'}</Pill></span> },
    { key: 'paid_on', header: 'Paid on', render: (r) => <span className="whitespace-nowrap">{r.payment?.paid_on || '—'}</span> },
    { key: 'amount', header: 'Amount paid', render: (r) => (r.payment ? <span className="tabular-nums">{inr(r.payment.amount_paid)}</span> : '—') },
    { key: 'mode', header: 'Mode', render: (r) => (r.payment?.payment_mode ? MODE_LABEL[r.payment.payment_mode] : '—') },
    { key: 'txn', header: 'Transaction ID', render: (r) => (r.payment?.transaction_id ? <span title={r.payment.bank_name || undefined}>{r.payment.transaction_id}</span> : '—') },
    { key: 'actions', header: '', render: (r) => <button type="button" className="btn-ghost inline-flex items-center gap-1 whitespace-nowrap text-xs" onClick={() => setEdit(r)}><Pencil className="h-3.5 w-3.5" />{r.status === 'paid' ? 'Edit' : 'Mark paid'}</button> },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-3">
        <label className={labelCls}>From month<input type="month" className={inputCls} value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} /></label>
        <label className={labelCls}>To month<input type="month" className={inputCls} value={range.to} min={range.from} max={thisMonth()} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} /></label>
        <label className={labelCls}>Status
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="paid">Paid</option>
            <option value="not_paid">Not paid</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Salary payable" value={inr(t?.payable)} hint={`${salaries(t?.salaries)} in the selected months`} icon={Banknote} theme="blue" />
        <KpiCard label="Paid" value={inr(t?.paid_amount)} hint={`${salaries(t?.paid_count)} paid`} icon={CheckCircle2} theme="green" />
        <KpiCard label="Not paid" value={inr(t?.not_paid_amount)} hint={`${salaries(t?.not_paid_count)} pending`} icon={Clock3} theme="orange" />
      </div>

      {data?.by_month?.length > 1 && (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-tertiary-50 text-xs text-tertiary-500">
              <tr><th className="px-3 py-2 text-left font-medium">Month</th><th className="px-3 py-2 text-right font-medium">Payable</th><th className="px-3 py-2 text-right font-medium">Paid</th><th className="px-3 py-2 text-right font-medium">Not paid</th></tr>
            </thead>
            <tbody>
              {data.by_month.map((m) => (
                <tr key={m.month} className="border-t">
                  <td className="px-3 py-2 font-medium">{monthLabel(m.month)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(m.payable)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-success-700">{inr(m.paid_amount)} <span className="text-xs text-tertiary-400">({m.paid_count})</span></td>
                  <td className="px-3 py-2 text-right tabular-nums text-orange-700">{inr(m.not_paid_amount)} <span className="text-xs text-tertiary-400">({m.not_paid_count})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={loading && data ? 'opacity-60' : ''} aria-busy={loading}>
        <DataTable columns={columns} rows={data?.rows || []} loading={loading && !data} emptyLabel="No salaries match these filters" />
      </div>
      <p className="text-xs text-tertiary-500">Salary payable is the final payable salary of the month (locked figures where the salary is locked). Employees without a salary structure are not listed.</p>

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.status === 'paid' ? 'Edit payment details' : 'Mark salary paid'}>
        {edit && <PaymentForm key={edit.id} row={edit} saving={saving} onSubmit={save} onCancel={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}
