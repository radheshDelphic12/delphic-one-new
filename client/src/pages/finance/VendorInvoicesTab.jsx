import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const money = (n, c = 'INR') => `${c} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** Where one vendor invoice comes from: vendor -> project -> billing record -> timesheet entries -> invoice -> payment. */
function TraceDrawer({ invoiceId, onClose }) {
  const [trace, setTrace] = useState(null);
  useEffect(() => {
    setTrace(null);
    if (!invoiceId) return;
    apiClient.get(`/billing/vendor-invoices/${invoiceId}/trace`).then(({ data }) => setTrace(data.data)).catch(() => setTrace(null));
  }, [invoiceId]);
  return (
    <Drawer open={Boolean(invoiceId)} title="Vendor invoice trace" onClose={onClose} size="lg">
      {!trace ? <p className="text-sm text-tertiary-500">Loading...</p> : (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-tertiary-600">
            <dt>Vendor</dt><dd className="text-tertiary-900">{trace.vendor.name}</dd>
            <dt>Project</dt><dd className="text-tertiary-900">{trace.project.name}</dd>
            <dt>Month</dt><dd className="text-tertiary-900">{MONTHS[trace.period.month - 1]} {trace.period.year}</dd>
            <dt>Invoice</dt><dd className="text-tertiary-900">{trace.invoice.invoice_number || '—'} · {money(trace.invoice.amount, trace.invoice.currency)}</dd>
            <dt>TDS / adjustment</dt><dd className="text-tertiary-900">-{money(trace.invoice.tds_amount)} / {money(trace.invoice.adjustment_amount)}</dd>
            <dt>Net payable</dt><dd className="font-semibold text-tertiary-900">{money(trace.invoice.net_payable, trace.invoice.currency)}</dd>
            <dt>Sent</dt><dd className="text-tertiary-900">{trace.invoice.sent ? 'Sent' : 'Unsent'}</dd>
            <dt>Payment</dt><dd className="text-tertiary-900">{trace.payment.paid ? `Paid ${money(trace.payment.paid_amount)}` : 'Unpaid'}</dd>
            <dt>Billing record</dt><dd className="text-tertiary-900">{trace.billing_record.locked ? `Locked, version ${trace.billing_record.calculation_version}` : 'Not locked yet (live figures)'}</dd>
          </dl>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Timesheet records ({trace.timesheet_hours.approved}h approved, {trace.timesheet_hours.pending}h pending)</h4>
            <ul className="mt-1 max-h-72 divide-y divide-tertiary-100 overflow-auto text-xs">
              {trace.timesheet_records.map((e) => <li key={e.id} className="flex justify-between py-1"><span>{e.date} · {e.resource}</span><span className="tabular-nums">{e.hours}h · {e.status}</span></li>)}
              {trace.timesheet_records.length === 0 && <li className="py-1 text-tertiary-400">No timesheet entries from this vendor&apos;s resources on the project that month.</li>}
            </ul>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/**
 * Finance > Vendor Invoices: vendor billing for a month with invoice number, TDS, adjustment, net payable,
 * Sent / Unsent and Paid / Unpaid; a trace of where each amount comes from; and the vendor Excel export.
 */
export default function VendorInvoicesTab() {
  const { pushError, pushSuccess } = useAlerts();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState(null);
  const [traceId, setTraceId] = useState(null);

  const load = useCallback(() => {
    setRows(null);
    apiClient.get('/billing/vendor-invoices', { params: { period_month: month, period_year: year } }).then(({ data }) => setRows(data.data || [])).catch(() => setRows([]));
  }, [month, year]);
  useEffect(() => { load(); }, [load]);

  async function track(row, change, done) {
    try {
      await apiClient.patch(`/billing/vendor-invoices/${row.id}/tracking`, change);
      pushSuccess(done);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the vendor invoice'), 'Something went wrong');
    }
  }

  function editMoney(row) {
    const tds = window.prompt('TDS withheld (amount):', String(row.tds_amount ?? 0));
    if (tds === null) return;
    const adjustment = window.prompt('Financial adjustment (negative reduces the payable):', String(row.adjustment_amount ?? 0));
    if (adjustment === null) return;
    const note = window.prompt('Note for the adjustment (optional):', row.adjustment_note || '') ?? '';
    track(row, { tds_amount: Number(tds) || 0, adjustment_amount: Number(adjustment) || 0, adjustment_note: note.trim() || undefined }, 'TDS / adjustment saved');
  }

  async function exportVendor() {
    try {
      await downloadFile('/calculations/export/vendor', { period_month: month, period_year: year }, `vendor-${year}-${String(month).padStart(2, '0')}.xlsx`);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to export vendor billing'), 'Export failed');
    }
  }

  const columns = [
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor_account?.name || '—' },
    { key: 'project', header: 'Project', render: (r) => r.project?.name || '—' },
    { key: 'number', header: 'Invoice', render: (r) => r.invoice_number || '—' },
    { key: 'amount', header: 'Amount', render: (r) => money(r.amount, r.currency) },
    { key: 'tds', header: 'TDS', render: (r) => `-${money(r.tds_amount, r.currency)}` },
    { key: 'adjustment', header: 'Adjustment', render: (r) => money(r.adjustment_amount, r.currency) },
    { key: 'net', header: 'Net payable', render: (r) => <span className="font-semibold">{money(r.net_payable, r.currency)}</span> },
    { key: 'sent', header: 'Sent', render: (r) => (r.sent ? 'Sent' : 'Unsent') },
    { key: 'paid', header: 'Payment', render: (r) => (r.paid ? 'Paid' : 'Unpaid') },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          <button type="button" className="btn-ghost text-xs" onClick={() => track(r, { sent: !r.sent }, r.sent ? 'Marked unsent' : 'Marked sent')}>{r.sent ? 'Mark unsent' : 'Mark sent'}</button>
          <button type="button" className="btn-ghost text-xs" onClick={() => editMoney(r)}>TDS / adjustment</button>
          <button type="button" className="btn-ghost text-xs" onClick={() => setTraceId(r.id)}>Trace</button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Finance</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Vendor invoices</h2>
          <p className="mt-1 text-sm text-tertiary-500">Vendor billing -&gt; invoice -&gt; TDS / adjustments -&gt; sent -&gt; payment. Invoices are generated from Live Analytics &gt; Vendors.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={exportVendor}><Download className="h-4 w-4" /> Vendor Excel</button>
        </div>
      </div>
      <DataTable columns={columns} rows={rows || []} loading={!rows} emptyLabel="No vendor invoices for this month" maxHeight="calc(100dvh - 22rem)" />
      <TraceDrawer invoiceId={traceId} onClose={() => setTraceId(null)} />
    </div>
  );
}
