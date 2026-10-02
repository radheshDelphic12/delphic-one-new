import { useCallback, useEffect, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useOrgMembershipOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KINDS = [
  ['tds', 'TDS adjustment (deducts)'],
  ['ot_adjustment', 'OT adjustment (adds)'],
  ['variable_pay', 'Variable pay (adds)'],
  ['reimbursement', 'Reimbursement (adds)'],
  ['addition', 'Other addition (adds)'],
  ['deduction', 'Other deduction (deducts)'],
];
const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Monthly salary adjustments on top of the salary structure (TDS, OT adjustment, variable pay,
 * reimbursements, other additions / deductions) and what each does to the payable salary.
 * Admin only; every change is audited and flags a locked month for recalculation.
 */
export default function SalaryAdjustmentsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [adjustments, setAdjustments] = useState([]);
  const [salary, setSalary] = useState(null);
  const [form, setForm] = useState({ org_membership_id: '', kind: 'variable_pay', amount: '', note: '' });
  const [saving, setSaving] = useState(false);
  const members = useOrgMembershipOptions(true);

  const load = useCallback(() => {
    apiClient.get('/payroll/adjustments', { params: { period_month: month, period_year: year } }).then(({ data }) => setAdjustments(data.data || [])).catch(() => setAdjustments([]));
    setSalary(null);
    apiClient.get('/calculations/export/salary', { params: { period_month: month, period_year: year, format: 'json' } }).then(({ data }) => setSalary(data.data || [])).catch(() => setSalary([]));
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  async function add(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/payroll/adjustments', { ...form, amount: Number(form.amount), period_month: month, period_year: year, note: form.note.trim() || undefined });
      pushSuccess('Adjustment added');
      setForm({ org_membership_id: form.org_membership_id, kind: form.kind, amount: '', note: '' });
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to add the adjustment'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row) {
    const reason = window.prompt(`Remove ${row.label} of ${money(row.amount)} for ${row.employee}? Give a reason (required):`);
    if (reason === null) return;
    if (reason.trim().length < 3) { pushError('A reason of at least 3 characters is required', 'Not removed'); return; }
    try {
      await apiClient.delete(`/payroll/adjustments/${row.id}`, { data: { reason: reason.trim() } });
      pushSuccess('Adjustment removed');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to remove the adjustment'), 'Something went wrong');
    }
  }

  async function exportSalary() {
    try {
      await downloadFile('/calculations/export/salary', { period_month: month, period_year: year }, `salary-${year}-${String(month).padStart(2, '0')}.xlsx`);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to export salary'), 'Export failed');
    }
  }

  const adjustmentColumns = [
    { key: 'employee', header: 'Employee', render: (r) => r.employee || '—' },
    { key: 'label', header: 'Adjustment', render: (r) => r.label },
    { key: 'effect', header: 'Effect', render: (r) => <span className={r.sign < 0 ? 'text-danger-600' : 'text-success-700'}>{r.sign < 0 ? '-' : '+'}{money(r.amount)}</span> },
    { key: 'note', header: 'Note', render: (r) => r.note || '—' },
    { key: 'actions', header: '', render: (r) => <button type="button" className="btn-ghost inline-flex items-center gap-1 text-danger-600" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /> Remove</button> },
  ];
  const salaryColumns = [
    { key: 'employee', header: 'Employee', render: (r) => r.employee },
    { key: 'salary', header: 'Basic / fixed salary', render: (r) => money(r.salary) },
    { key: 'variable_pay', header: 'Variable pay', render: (r) => money(r.variable_pay) },
    { key: 'ot', header: 'Approved OT', render: (r) => money(r.ot) },
    { key: 'reimbursements', header: 'Reimbursement', render: (r) => money(r.reimbursements) },
    { key: 'other_additions', header: 'Other additions', render: (r) => money(r.other_additions) },
    { key: 'tds', header: 'TDS', render: (r) => `-${money(r.tds)}` },
    { key: 'deductions', header: 'Deductions', render: (r) => `-${money(r.deductions)}` },
    { key: 'final_payable', header: 'Final payable', render: (r) => <span className="font-semibold text-primary-700">{money(r.final_payable)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Payroll</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Salary adjustments</h2>
          <p className="mt-1 text-sm text-tertiary-500">TDS, OT adjustment, variable pay and reimbursements change the final payable salary. The salary structure itself is unchanged.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={exportSalary}><Download className="h-4 w-4" /> Salary Excel</button>
        </div>
      </div>
      <form onSubmit={add} className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 sm:grid-cols-5">
        <div className="sm:col-span-2 text-xs font-medium text-tertiary-600">Employee<div className="mt-1"><SearchableSelect value={form.org_membership_id} onChange={(v) => setForm((f) => ({ ...f, org_membership_id: v }))} options={members} placeholder="Select employee" required /></div></div>
        <label className="text-xs font-medium text-tertiary-600">Type
          <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="text-xs font-medium text-tertiary-600">Amount
          <input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        <div className="flex items-end"><button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={saving || !form.org_membership_id || !form.amount}><Plus className="h-4 w-4" /> Add</button></div>
        <label className="text-xs font-medium text-tertiary-600 sm:col-span-5">Note
          <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm" placeholder="e.g. Q2 TDS deduction" />
        </label>
      </form>
      <DataTable columns={adjustmentColumns} rows={adjustments} emptyLabel="No adjustments for this month" />
      <section className="space-y-2">
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">How the adjustments affect the final payable salary</h3>
        <DataTable columns={salaryColumns} rows={salary || []} loading={!salary} emptyLabel="No salary lines for this month" />
      </section>
    </div>
  );
}
