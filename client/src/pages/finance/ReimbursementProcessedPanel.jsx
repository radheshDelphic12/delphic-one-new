import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useOrgMembershipOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

const money = (n, currency = 'INR') => `${currency} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (ymd) => (ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString() : '—');
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Finance > Expenses > Processed: every claim marked reimbursed between two dates, with when it was submitted, approved and paid
 * and how many days that took. Excel download. Admin only.
 */
export default function ReimbursementProcessedPanel() {
  const { pushError } = useAlerts();
  const members = useOrgMembershipOptions(true);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [employee, setEmployee] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const params = { from: from || undefined, to: to || undefined, org_membership_id: employee || undefined };

  const load = useCallback(() => {
    setData(null);
    apiClient.get('/expenses/claims/processed', { params: { ...params, format: 'json' } })
      .then(({ data: res }) => setData(res.data))
      .catch((err) => { setData({ rows: [], totals: [], average_days: 0 }); pushError(apiErrorMessage(err, 'Failed to load the report'), 'Something went wrong'); });
  }, [from, to, employee]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function download() {
    setBusy(true);
    try {
      await downloadFile('/expenses/claims/processed', { ...params, format: 'xlsx' }, `processed-reimbursements-${from || 'start'}-to-${to || 'today'}.xlsx`);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to download the report'), 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'processed_on', header: 'Processed on', render: (r) => <span className="font-medium text-tertiary-900" title={r.processed_at ? new Date(r.processed_at).toLocaleString() : ''}>{day(r.processed_on)}</span> },
    { key: 'employee', header: 'Employee', render: (r) => <span>{r.employee}{r.employee_code && <span className="block text-xs text-tertiary-500">{r.employee_code}</span>}</span> },
    { key: 'category', header: 'Category', render: (r) => <span>{r.category}{r.description && <span className="block max-w-[16rem] truncate text-xs text-tertiary-500" title={r.description}>{r.description}</span>}</span> },
    { key: 'expense_date', header: 'Expense date', render: (r) => day(r.expense_date) },
    { key: 'submitted_on', header: 'Submitted', render: (r) => day(r.submitted_on) },
    { key: 'approved_on', header: 'Approved', render: (r) => <span>{day(r.approved_on)}{r.approved_by && <span className="block text-xs text-tertiary-500">by {r.approved_by}</span>}</span> },
    { key: 'days', header: 'Days to process', render: (r) => r.days_to_process },
    { key: 'amount', header: 'Amount', render: (r) => <span className="font-semibold tabular-nums text-primary-700">{money(r.amount, r.currency)}</span> },
  ];

  return (
    <div className="space-y-4" data-testid="reimbursement-processed">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Expenses</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Processed reimbursements</h2>
          <p className="mt-1 text-sm text-tertiary-500">When each reimbursement was paid: the day it was marked reimbursed, with the submission and approval dates and the days it took.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">Processed from
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium text-tertiary-600">to
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="block w-56 text-xs font-medium text-tertiary-600">Employee
            <div className="mt-1"><SearchableSelect value={employee} onChange={setEmployee} options={members} placeholder="All employees" allowClear /></div>
          </label>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={download} disabled={busy || !data?.rows?.length}>
            <Download className="h-4 w-4" /> {busy ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </div>

      <DataTable columns={columns} rows={data?.rows || []} loading={!data} emptyLabel="No reimbursements were processed in this period." />

      {data?.rows?.length > 0 && (
        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
          <span className="text-tertiary-500">{data.rows.length} claim{data.rows.length === 1 ? '' : 's'} · average {data.average_days} days to process</span>
          {data.totals.map((t) => <span key={t.currency} className="font-semibold text-tertiary-900">Total {money(t.amount, t.currency)}</span>)}
        </div>
      )}
    </div>
  );
}
