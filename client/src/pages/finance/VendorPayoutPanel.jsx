import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';

const money = (n, currency = 'INR') => `${currency} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const EMPTY = { rows: [], totals: [], excel_totals: [], bank_missing_count: 0 };

/**
 * Finance > Vendor Invoices > Bank payout: the unpaid vendor invoices of one month added up per vendor (net payable, after TDS and
 * adjustments) with the bank details saved on the vendor record, ready to download as one Excel file for the bank. Vendors with no
 * bank account or IFSC are flagged here and left out of the Excel. Nothing changes on the invoices; marking the vendor paid removes it.
 */
export default function VendorPayoutPanel() {
  const { pushError } = useAlerts();
  const [month, setMonth] = useState(thisMonth());
  const [sentOnly, setSentOnly] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const [year, monthNumber] = month ? month.split('-').map(Number) : [null, null];

  const load = useCallback(() => {
    if (!year) { setData(EMPTY); return; }
    setData(null);
    apiClient.get('/billing/vendor-invoices/payout', { params: { period_month: monthNumber, period_year: year, sent_only: sentOnly, format: 'json' } })
      .then(({ data: res }) => setData(res.data))
      .catch((err) => { setData(EMPTY); pushError(apiErrorMessage(err, 'Failed to load the vendor payout'), 'Something went wrong'); });
  }, [year, monthNumber, sentOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function download() {
    setBusy(true);
    try {
      await downloadFile('/billing/vendor-invoices/payout', { period_month: monthNumber, period_year: year, sent_only: sentOnly }, `vendor-payout-${year}-${String(monthNumber).padStart(2, '0')}.xlsx`);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to download the vendor payout'), 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  const notAdded = <span className="text-warning-700">Not added</span>;
  const columns = [
    { key: 'vendor', header: 'Vendor', render: (r) => <span>{r.vendor}{r.account_holder && <span className="block text-xs text-tertiary-500">{r.account_holder}{r.bank_name ? ` · ${r.bank_name}` : ''}</span>}</span> },
    { key: 'bank_account_number', header: 'Bank account number', render: (r) => r.bank_account_number || notAdded },
    { key: 'bank_ifsc', header: 'IFSC code', render: (r) => r.bank_ifsc || notAdded },
    { key: 'invoices', header: 'Invoices', render: (r) => r.invoices },
    { key: 'amount', header: 'Total to pay', render: (r) => <span className="font-semibold tabular-nums text-primary-700">{money(r.amount, r.currency)}</span> },
    { key: 'flag', header: '', render: (r) => (r.bank_missing ? <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-800">Not in Excel: bank details missing</span> : null) },
  ];

  return (
    <div className="space-y-4" data-testid="vendor-payout">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Vendor invoices</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Bank payout</h2>
          <p className="mt-1 text-sm text-tertiary-500">Each vendor&apos;s unpaid invoices for the month (net payable after TDS and adjustments), with the bank details on the vendor. Download the Excel and give it to the bank.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">Month
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs font-medium text-tertiary-600">
            <input type="checkbox" checked={sentOnly} onChange={(e) => setSentOnly(e.target.checked)} /> Only invoices marked Sent
          </label>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={download} disabled={busy || !year || !data?.excel_totals?.length}>
            <Download className="h-4 w-4" /> {busy ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {data?.bank_missing_count > 0 && (
        <p className="rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-800" data-testid="vendor-bank-missing">
          {data.bank_missing_count} {data.bank_missing_count === 1 ? 'vendor has' : 'vendors have'} no bank account number or IFSC saved. They are left out of the Excel until you add the details on the vendor record (Accounts &gt; vendor &gt; Edit).
        </p>
      )}

      <DataTable columns={columns} rows={data?.rows || []} loading={!data} emptyLabel="No unpaid vendor invoices for this month." />

      {data?.totals?.length > 0 && (
        <div className="flex flex-col items-end gap-1 text-sm" data-testid="vendor-payout-total">
          {data.totals.map((t) => <span key={t.currency} className="font-semibold text-tertiary-900">Month total {money(t.amount, t.currency)}</span>)}
          {data.bank_missing_count > 0 && data.excel_totals.map((t) => <span key={t.currency} className="text-xs text-tertiary-500">In the Excel {money(t.amount, t.currency)}</span>)}
        </div>
      )}
    </div>
  );
}
