import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import VendorPayoutPanel from './VendorPayoutPanel.jsx';
import ContractChargesSection from '../../components/finance/ContractChargesSection.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const money = (n, c = 'INR') => `${c} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** Finance > Vendor Invoices > GST & TDS: each vendor's GST / TDS lines, set up like a contract's charges; applied when its invoice is generated. */
function VendorChargesPanel() {
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState('');
  useEffect(() => {
    // The accounts API caps a page at 100, so read every page: a long vendor list must not be cut off.
    let cancelled = false;
    (async () => {
      const all = [];
      try {
        for (let page = 1; page <= 50; page += 1) {
          const { data } = await apiClient.get('/accounts', { params: { type: 'vendor', limit: 100, page, sort_by: 'name', sort_order: 'asc' } });
          all.push(...(data.data || []));
          if (page >= (data.pagination?.totalPages || 1)) break;
        }
      } catch { /* show what loaded */ }
      if (!cancelled) setVendors(all);
    })();
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Finance</p>
        <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Vendor GST &amp; TDS</h2>
        <p className="mt-1 text-sm text-tertiary-500">Set a vendor&apos;s GST and TDS once, the same way as on a client contract. They are worked out on every project row when the vendor&apos;s invoice is generated in Live Analytics &gt; Vendors: payable = amount + GST − TDS + adjustment.</p>
        <label className="mt-3 block text-xs font-medium text-tertiary-600">Vendor
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} data-testid="vendor-charges-select" className="mt-1 block w-full max-w-sm rounded-xl border px-3 py-2 text-sm">
            <option value="">Choose a vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      </div>
      {vendorId && <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card"><ContractChargesSection key={vendorId} accountId={vendorId} vendor /></div>}
    </div>
  );
}

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
            <dt>GST (added)</dt><dd className="text-tertiary-900">+{money(trace.invoice.gst_amount)}</dd>
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
  const [view, setView] = useState('invoices');

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
    const gst = window.prompt('GST (amount added to the payable):', String(row.gst_amount ?? 0));
    if (gst === null) return;
    const tds = window.prompt('TDS withheld (amount):', String(row.tds_amount ?? 0));
    if (tds === null) return;
    const adjustment = window.prompt('Financial adjustment (negative reduces the payable):', String(row.adjustment_amount ?? 0));
    if (adjustment === null) return;
    const note = window.prompt('Note for the adjustment (optional):', row.adjustment_note || '') ?? '';
    track(row, { gst_amount: Number(gst) || 0, tds_amount: Number(tds) || 0, adjustment_amount: Number(adjustment) || 0, adjustment_note: note.trim() || undefined }, 'GST / TDS / adjustment saved');
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
    { key: 'gst', header: 'GST', render: (r) => `+${money(r.gst_amount, r.currency)}` },
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
          <button type="button" className="btn-ghost text-xs" onClick={() => editMoney(r)}>GST / TDS / adjustment</button>
          <button type="button" className="btn-ghost text-xs" onClick={() => setTraceId(r.id)}>Trace</button>
        </span>
      ),
    },
  ];

  const tabs = (
    <div className="flex gap-2" role="tablist" aria-label="Vendor invoices views">
      {[['invoices', 'Invoices'], ['charges', 'GST & TDS setup'], ['payout', 'Bank payout']].map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={view === key} data-testid={`vendor-view-${key}`} onClick={() => setView(key)}
          className={`rounded-xl px-4 py-2 text-sm font-medium ${view === key ? 'bg-primary-600 text-white' : 'border bg-white text-tertiary-700 hover:bg-primary-50'}`}>{label}</button>
      ))}
    </div>
  );

  if (view === 'charges') return <div className="space-y-4">{tabs}<VendorChargesPanel /></div>;
  if (view === 'payout') return <div className="space-y-4">{tabs}<VendorPayoutPanel /></div>;

  return (
    <div className="space-y-4">
      {tabs}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Finance</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Vendor invoices</h2>
          <p className="mt-1 text-sm text-tertiary-500">Vendor billing -&gt; invoice -&gt; GST / TDS / adjustments -&gt; sent -&gt; payment. Invoices are generated from Live Analytics &gt; Vendors.</p>
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
