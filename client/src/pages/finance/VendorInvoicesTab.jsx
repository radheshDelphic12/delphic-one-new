import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { trackInWallet } from '../../lib/payments/trackInWallet.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import VendorPayoutPanel from './VendorPayoutPanel.jsx';
import ContractChargesSection from '../../components/finance/ContractChargesSection.jsx';
import FilesPanel from '../../components/FilesPanel.jsx';
import { PurchaseDrawer, PayPurchaseDrawer } from './VendorPurchaseDrawers.jsx';

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
  const [purchases, setPurchases] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [purchaseDrawer, setPurchaseDrawer] = useState({ open: false, purchase: null }); // Add / edit a normal purchase
  const [payFor, setPayFor] = useState(null);
  const [traceId, setTraceId] = useState(null);
  const [filesFor, setFilesFor] = useState(null); // the invoice whose files are open
  const [searchParams] = useSearchParams();
  const [view, setView] = useState('invoices');
  // the hub's hover menu links straight to a view: ?section=vendor-invoices&view=payout
  const urlView = searchParams.get('view');
  useEffect(() => { setView(['invoices', 'charges', 'payout'].includes(urlView) ? urlView : 'invoices'); }, [urlView]);

  const load = useCallback(() => {
    setRows(null);
    // Project invoices (generated from Live Analytics > Vendors) and normal purchases (a vendor bill with no project) of the month, side by side.
    const params = { period_month: month, period_year: year };
    Promise.all([
      apiClient.get('/billing/vendor-invoices', { params }).then(({ data }) => data.data || []).catch(() => []),
      apiClient.get('/billing/vendor-purchases', { params }).then(({ data }) => data.data || []).catch(() => []),
    ]).then(([invoices, bought]) => { setPurchases(bought); setRows(invoices); });
  }, [month, year]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiClient.get('/billing/vendors').then(({ data }) => setVendors(data.data || [])).catch(() => setVendors([])); }, []);

  async function savePurchase(payload) {
    const editing = purchaseDrawer.purchase;
    try {
      if (editing) await apiClient.patch(`/billing/vendor-purchases/${editing.id}`, payload);
      else await apiClient.post('/billing/vendor-purchases', payload);
      pushSuccess(editing ? 'Purchase updated' : 'Purchase added');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save the purchase'), 'Something went wrong');
      throw err; // keeps the drawer open
    }
  }
  async function payPurchase(payload) {
    try {
      const purchase = payFor;
      await apiClient.post(`/billing/vendor-purchases/${purchase.id}/pay`, payload);
      pushSuccess('Marked paid');
      load();
      // Same "take this payment out of a wallet?" popup as every other payment (the amount actually paid, in the bill's currency).
      void trackInWallet({ kind: 'vendor_purchase', reference_id: purchase.id, amount: payload.paid_amount ?? purchase.net_payable, currency: purchase.currency, title: `Vendor payment - ${purchase.bill_number}`, party: purchase.vendor_account?.name, category: purchase.category_name || 'Vendor payment' });
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to mark the purchase paid'), 'Something went wrong');
      throw err;
    }
  }
  async function purchaseAction(purchase, action, done) {
    try {
      await apiClient.post(`/billing/vendor-purchases/${purchase.id}/${action.name}`, action.body || {});
      pushSuccess(done);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the purchase'), 'Something went wrong');
    }
  }
  function cancelPurchase(purchase) {
    const reason = window.prompt(`Cancel purchase ${purchase.bill_number}? Its expense is removed. Reason (optional):`, '');
    if (reason === null) return;
    purchaseAction(purchase, { name: 'cancel', body: { reason: reason.trim() || undefined } }, 'Purchase cancelled');
  }

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

  // One list: the month's project invoices, then its normal purchases (a vendor bill with no project).
  const tableRows = [...(rows || []).map((r) => ({ ...r, kind: 'invoice' })), ...purchases];

  const columns = [
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor_account?.name || '—' },
    { key: 'type', header: 'Type', render: (r) => (r.kind === 'purchase' ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Purchase</span> : <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-800">Project invoice</span>) },
    { key: 'project', header: 'Project', render: (r) => (r.kind === 'purchase' ? <span className="text-tertiary-500">{r.category_name || 'No project'}{r.description ? ` - ${r.description}` : ''}</span> : r.project?.name || '—') },
    { key: 'number', header: 'Invoice', render: (r) => (r.kind === 'purchase' ? r.bill_number : r.invoice_number) || '—' },
    { key: 'amount', header: 'Amount', render: (r) => money(r.amount, r.currency) },
    { key: 'gst', header: 'GST', render: (r) => `+${money(r.gst_amount, r.currency)}` },
    { key: 'tds', header: 'TDS', render: (r) => `-${money(r.tds_amount, r.currency)}` },
    { key: 'adjustment', header: 'Adjustment', render: (r) => money(r.adjustment_amount, r.currency) },
    { key: 'net', header: 'Net payable', render: (r) => <span className="font-semibold">{money(r.net_payable, r.currency)}</span> },
    { key: 'sent', header: 'Sent', render: (r) => (r.kind === 'purchase' ? '—' : r.sent ? 'Sent' : 'Unsent') },
    { key: 'paid', header: 'Payment', render: (r) => (r.kind === 'purchase' && r.status === 'cancelled' ? <span className="text-danger-600">Cancelled</span> : r.paid ? `Paid${r.paid_on ? ` ${r.paid_on}` : ''}` : 'Unpaid') },
    {
      key: 'actions',
      header: '',
      render: (r) => (r.kind === 'purchase' ? (
        <span className="flex flex-wrap gap-1">
          {r.status === 'active' && <button type="button" className="btn-ghost text-xs" data-testid="vendor-purchase-edit" onClick={() => setPurchaseDrawer({ open: true, purchase: r })}>Edit</button>}
          {r.status === 'active' && (r.paid
            ? <button type="button" className="btn-ghost text-xs" onClick={() => purchaseAction(r, { name: 'unpay' }, 'Marked unpaid')}>Mark unpaid</button>
            : <button type="button" className="btn-ghost text-xs" data-testid="vendor-purchase-pay" onClick={() => setPayFor(r)}>Mark paid</button>)}
          <button type="button" className="btn-ghost text-xs" data-testid="vendor-invoice-files" onClick={() => setFilesFor(r)}>Files{r.file_count ? ` (${r.file_count})` : ''}</button>
          {r.status === 'active' && !r.paid && <button type="button" className="btn-ghost text-xs text-danger-600" data-testid="vendor-purchase-cancel" onClick={() => cancelPurchase(r)}>Cancel</button>}
        </span>
      ) : (
        <span className="flex flex-wrap gap-1">
          <button type="button" className="btn-ghost text-xs" onClick={() => track(r, { sent: !r.sent }, r.sent ? 'Marked unsent' : 'Marked sent')}>{r.sent ? 'Mark unsent' : 'Mark sent'}</button>
          <button type="button" className="btn-ghost text-xs" onClick={() => editMoney(r)}>GST / TDS / adjustment</button>
          <button type="button" className="btn-ghost text-xs" data-testid="vendor-invoice-files" onClick={() => setFilesFor(r)}>Files{r.file_count ? ` (${r.file_count})` : ''}</button>
          <button type="button" className="btn-ghost text-xs" onClick={() => setTraceId(r.id)}>Trace</button>
        </span>
      )),
    },
  ];

  // The Invoices / GST & TDS setup / Bank payout switch now lives in the Finance hub's hover menu on the Vendor Invoices tab.
  const tabs = null;
  if (view === 'charges') return <div className="space-y-4">{tabs}<VendorChargesPanel /></div>;
  if (view === 'payout') return <div className="space-y-4">{tabs}<VendorPayoutPanel /></div>;

  return (
    <div className="space-y-4">
      {tabs}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Finance</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Vendor invoices</h2>
          <p className="mt-1 text-sm text-tertiary-500">Vendor billing -&gt; invoice -&gt; GST / TDS / adjustments -&gt; sent -&gt; payment. Project invoices are generated from Live Analytics &gt; Vendors. For a vendor bill that is not tied to a client project (office, software, equipment), use Add purchase: it is booked as a company expense.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={exportVendor}><Download className="h-4 w-4" /> Vendor Excel</button>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" data-testid="vendor-purchase-add" onClick={() => setPurchaseDrawer({ open: true, purchase: null })}><Plus className="h-4 w-4" /> Add purchase</button>
        </div>
      </div>
      <DataTable columns={columns} rows={tableRows} loading={!rows} emptyLabel="No vendor invoices or purchases for this month" maxHeight="calc(100dvh - 22rem)" />
      <TraceDrawer invoiceId={traceId} onClose={() => setTraceId(null)} />
      <PurchaseDrawer open={purchaseDrawer.open} purchase={purchaseDrawer.purchase} vendors={vendors} onClose={() => setPurchaseDrawer({ open: false, purchase: null })} onSubmit={savePurchase} />
      <PayPurchaseDrawer purchase={payFor} onClose={() => setPayFor(null)} onSubmit={payPurchase} />
      <Drawer open={Boolean(filesFor)} title={filesFor ? `Files: ${filesFor.vendor_account?.name || 'Vendor'} ${filesFor.invoice_number || filesFor.bill_number || ''}`.trim() : 'Files'} onClose={() => { setFilesFor(null); load(); }}>
        {filesFor && <FilesPanel entityType={filesFor.kind === 'purchase' ? 'vendor_purchase' : 'project_vendor_invoice'} entityId={filesFor.id} title={filesFor.kind === 'purchase' ? 'Purchase bill files' : 'Vendor invoice files'} defaultLabel={filesFor.bill_number || filesFor.invoice_number || 'Vendor invoice'} multiple />}
      </Drawer>
    </div>
  );
}
