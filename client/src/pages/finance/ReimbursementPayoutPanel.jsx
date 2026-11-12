import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';

const STATUSES = [['approved', 'Approved (to be paid)'], ['reimbursed', 'Reimbursed'], ['pending', 'Pending'], ['rejected', 'Rejected']];
const money = (n, currency = 'INR') => `${currency} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Finance > Expenses > Bank payout: the claims of one month and status added up per employee, with the bank account saved on
 * each employee's profile, ready to download as one Excel file for the bank (same idea as the salary Excel). Admin only.
 * Nothing changes on the claims here; after the bank transfer each claim is marked reimbursed under "Reimbursements".
 */
export default function ReimbursementPayoutPanel() {
  const { pushError } = useAlerts();
  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState('approved');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const [year, monthNumber] = month ? month.split('-').map(Number) : [null, null];

  const load = useCallback(() => {
    if (!year) { setData({ rows: [], totals: [], bank_missing_count: 0 }); return; }
    setData(null);
    apiClient.get('/expenses/claims/payout', { params: { period_month: monthNumber, period_year: year, status, format: 'json' } })
      .then(({ data: res }) => setData(res.data))
      .catch((err) => { setData({ rows: [], totals: [], bank_missing_count: 0 }); pushError(apiErrorMessage(err, 'Failed to load the payout'), 'Something went wrong'); });
  }, [year, monthNumber, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function download() {
    setBusy(true);
    try {
      await downloadFile('/expenses/claims/payout', { period_month: monthNumber, period_year: year, status }, `reimbursement-payout-${year}-${String(monthNumber).padStart(2, '0')}-${status}.xlsx`);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to download the payout'), 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'employee', header: 'Employee', render: (r) => <span>{r.employee}{r.employee_code && <span className="block text-xs text-tertiary-500">{r.employee_code}</span>}</span> },
    { key: 'bank_account_number', header: 'Bank account number', render: (r) => r.bank_account_number || <span className="text-tertiary-400">Not added</span> },
    { key: 'bank_ifsc', header: 'IFSC code', render: (r) => r.bank_ifsc || <span className="text-tertiary-400">Not added</span> },
    { key: 'claims', header: 'Claims', render: (r) => r.claims },
    { key: 'amount', header: 'Total to pay', render: (r) => <span className="font-semibold tabular-nums text-primary-700">{money(r.amount, r.currency)}</span> },
  ];

  return (
    <div className="space-y-4" data-testid="reimbursement-payout">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Expenses</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Bank payout</h2>
          <p className="mt-1 text-sm text-tertiary-500">Each employee&apos;s claims for the month, added up, with their bank account. Download the Excel and give it to the bank.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">Month (of the expense)
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium text-tertiary-600">Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm">
              {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={download} disabled={busy || !year || !data?.rows?.length}>
            <Download className="h-4 w-4" /> {busy ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {data?.bank_missing_count > 0 && (
        <p className="rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-800" data-testid="bank-missing">
          {data.bank_missing_count} {data.bank_missing_count === 1 ? 'employee has' : 'employees have'} no bank account or IFSC saved yet. They can add it under Settings → My details, or you can add it before paying.
        </p>
      )}

      <DataTable columns={columns} rows={data?.rows || []} loading={!data} emptyLabel={`No ${status} claims for this month.`} />

      {data?.totals?.length > 0 && (
        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm" data-testid="payout-total">
          {data.totals.map((t) => <span key={t.currency} className="font-semibold text-tertiary-900">Total {money(t.amount, t.currency)}</span>)}
        </div>
      )}
    </div>
  );
}
