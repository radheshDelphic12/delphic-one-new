import { useEffect, useMemo, useState } from 'react';
import { Plus, Printer, RefreshCw } from 'lucide-react';
import usePaymentDialog, { isPaymentCancelled } from '../../components/payments/usePaymentDialog.jsx';
import InvoicePaymentsModal from '../../components/payments/InvoicePaymentsModal.jsx';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useProjectOptions } from '../../lib/lookups.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nowPeriod() {
  const now = new Date();
  return { period_month: now.getMonth() + 1, period_year: now.getFullYear() };
}

function GenerateInvoiceDrawer({ open, onClose, onSubmit }) {
  const accountOptions = useProjectOptions(open);
  const [fields, setFields] = useState({ client_account_id: '', ...nowPeriod() });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setFields({ client_account_id: '', ...nowPeriod() });
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ ...fields, period_month: Number(fields.period_month), period_year: Number(fields.period_year) });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title="Generate invoice" onClose={onClose} size="sm" tone="create" footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="generate-invoice-form" className="btn-primary" disabled={saving || !fields.client_account_id}>{saving ? 'Generating…' : 'Generate'}</button>
      </>
    }>
      <form id="generate-invoice-form" onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-tertiary-600">Project</label>
          <SearchableSelect value={fields.client_account_id} onChange={(v) => setFields((f) => ({ ...f, client_account_id: v }))} options={accountOptions} placeholder="Select project" searchPlaceholder="Search projects…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Month<input required type="number" min="1" max="12" value={fields.period_month} onChange={(e) => setFields((f) => ({ ...f, period_month: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">Year<input required type="number" value={fields.period_year} onChange={(e) => setFields((f) => ({ ...f, period_year: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        </div>
        <p className="text-xs text-tertiary-500">Sums that period&apos;s computed daily revenue for this project into a draft invoice. Only time from the project&apos;s Agreement Start Date is invoiced. Run &quot;Compute revenue&quot; first if the period has none yet.</p>
      </form>
    </Drawer>
  );
}

function ComputeRevenueDrawer({ open, onClose, onSubmit }) {
  const [from, setFrom] = useState(new Date(new Date().setDate(1)).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ date_from: from, date_to: to });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title="Compute daily revenue" onClose={onClose} size="sm" tone="edit" footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="compute-revenue-form" className="btn-primary" disabled={saving}>{saving ? 'Computing…' : 'Compute'}</button>
      </>
    }>
      <form id="compute-revenue-form" onSubmit={submit} className="space-y-3">
        <p className="text-xs text-tertiary-500">Computes revenue from approved + billable project timesheet hours × billing rate, for every project with a billing rate, from its Agreement Start Date. Hourly = logged hours × rate; monthly = the rate spread over the month&apos;s working days against a 160-hour benchmark. Capped at 31 days per run.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">From<input required type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">To<input required type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        </div>
      </form>
    </Drawer>
  );
}

// Invoices built from a locked Billing & Sales month carry { lines, project, … };
// older ones (from computed daily revenue) are a plain array of requirement lines.
function invoiceLines(row) {
  const items = row.line_items;
  if (Array.isArray(items)) return items.map((li) => ({ label: li.requirement_title || 'Services', hours: li.hours, overtime_hours: 0, amount: li.revenue }));
  return (items?.lines || []).map((li) => ({ label: li.resource, hours: li.hours, overtime_hours: li.overtime_hours, amount: li.revenue }));
}

/**
 * Invoicing — lives under Finance → Projects now that the Accounting tab is
 * switched off. The preferred flow: Live Analytics → Billing & Sales → lock
 * the project month → Generate invoice, which lands here as a draft built from
 * the locked figures ("from locked v#"). Drafts can be reviewed, downloaded
 * (print / save as PDF), marked sent (shared) and paid.
 */
export default function InvoicingSection() {
  const { user } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [computeOpen, setComputeOpen] = useState(false);

  function load() {
    setLoading(true);
    apiClient.get('/billing/invoices').then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load invoices'), 'Something went wrong')).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function generate(payload) {
    try {
      await apiClient.post('/billing/invoices', payload);
      pushInfo('Invoice generated');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to generate invoice — run "Compute revenue" for this period first'), 'Something went wrong');
      throw err;
    }
  }

  async function computeRevenue(payload) {
    try {
      const { data } = await apiClient.post('/billing/daily-revenue/compute', payload);
      pushInfo(`Computed revenue for ${data.data?.computed_count ?? 0} project-days`);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to compute revenue'), 'Something went wrong');
      throw err;
    }
  }

  function downloadInvoice(row) {
    downloadFile(`/billing/invoices/${row.id}/pdf`, undefined, `${row.invoice_number || 'invoice'}.pdf`).catch((err) => pushError(apiErrorMessage(err, 'Could not download the invoice'), 'Something went wrong'));
  }

  const paymentDialog = usePaymentDialog();
  const [paymentsFor, setPaymentsFor] = useState(null);
  async function transition(row, status) {
    try {
      await apiClient.post(`/billing/invoices/${row.id}/status`, { status });
      pushInfo(`Invoice marked ${status}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update invoice status'), 'Something went wrong');
    }
  }
  async function recordPayment(row) {
    try {
      await paymentDialog.pay(
        { title: `Payment received${row.invoice_number ? ` · ${row.invoice_number}` : ''}`, direction: 'in', currency: row.currency, amount: row.pending_amount ?? row.amount, party: row.line_items?.project?.name || row.client_account?.name || '' },
        (body) => apiClient.post(`/billing/invoices/${row.id}/payments`, body),
      );
      pushInfo('Payment recorded');
      load();
    } catch (err) {
      if (!isPaymentCancelled(err)) pushError(apiErrorMessage(err, 'Failed to record the payment'), 'Something went wrong');
    }
  }

  // Month by month: which invoices are paid, partly paid or unpaid; filters combine, totals follow them (one line per currency).
  const [filters, setFilters] = useState({ year: '', month: '', status: '', pay: '', q: '' });
  const setFilter = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const years = useMemo(() => [...new Set(rows.map((r) => r.period_year))].sort((a, b) => b - a), [rows]);
  const shown = useMemo(() => rows.filter((r) => (
    (!filters.year || String(r.period_year) === filters.year)
    && (!filters.month || String(r.period_month) === filters.month)
    && (!filters.status || r.status === filters.status)
    && (!filters.pay || r.payment_status === filters.pay)
    && (!filters.q || `${r.invoice_number || ''} ${r.line_items?.project?.name || ''} ${r.client_account?.name || ''}`.toLowerCase().includes(filters.q.toLowerCase()))
  )), [rows, filters]);
  const totals = useMemo(() => {
    const by = new Map();
    for (const r of shown) {
      if (r.status === 'draft') continue;
      const t = by.get(r.currency) || { invoiced: 0, paid: 0, pending: 0 };
      t.invoiced += Number(r.amount || 0);
      t.paid += Number(r.paid_amount || 0);
      t.pending += Number(r.pending_amount ?? r.amount ?? 0);
      by.set(r.currency, t);
    }
    return [...by];
  }, [shown]);
  const anyFilter = Object.values(filters).some(Boolean);

  const columns = [
    { key: 'number', header: 'Invoice no.', render: (row) => <span className="font-mono text-xs font-medium text-tertiary-900">{row.invoice_number || '—'}</span> },
    { key: 'client', header: 'Project', render: (row) => <span>{row.line_items?.project?.name || row.client_account?.name || '—'}{row.line_items?.project?.code && <span className="block text-xs text-tertiary-500">{row.line_items.project.code}{row.line_items.project.client_name ? ` · ${row.line_items.project.client_name}` : ''}</span>}</span> },
    { key: 'period', header: 'Period', render: (row) => `${row.period_month}/${row.period_year}` },
    { key: 'amount', header: 'Amount', render: (row) => `${row.currency} ${money(row.amount)}` },
    { key: 'lines', header: 'Line items', render: (row) => invoiceLines(row).length },
    { key: 'source', header: 'Source', render: (row) => (row.calculation_version_id ? <span className="text-xs text-success-700">Locked billing v{row.line_items?.calculation_version}</span> : <span className="text-xs text-tertiary-500">Computed revenue</span>) },
    { key: 'status', header: 'Status', render: (row) => <span><Badge value={row.status} />{row.payment_status === 'partly_paid' && <span className="block text-[11px] text-warning-700">Paid {row.currency} {money(row.paid_amount)} · pending {money(row.pending_amount)}</span>}</span> },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex gap-2">
          <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => downloadInvoice(row)}><Printer className="h-3.5 w-3.5" /> View / download</button>
          {row.status === 'draft' && <button type="button" className="btn-ghost text-xs" onClick={() => transition(row, 'sent')}>Mark sent (shared)</button>}
          {row.status === 'sent' && <button type="button" className="btn-ghost text-xs" onClick={() => recordPayment(row)}>{row.payment_status === 'partly_paid' ? 'Record payment' : 'Mark paid'}</button>}
          {row.payments_count > 0 && <button type="button" className="btn-ghost text-xs" onClick={() => setPaymentsFor(row)}>Payments</button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {paymentDialog.dialog}
      <InvoicePaymentsModal invoice={paymentsFor} canUndo={Boolean(user?.is_group_superadmin)} onClose={() => setPaymentsFor(null)} onChanged={load} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setComputeOpen(true)}><RefreshCw className="h-4 w-4" /> Compute revenue</button>
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setGenerateOpen(true)}><Plus className="h-4 w-4" /> Generate invoice</button>
      </div>
      <div className="flex flex-wrap items-end gap-2" data-testid="invoicing-filters">
        <input value={filters.q} onChange={setFilter('q')} placeholder="Search invoice or project…" className="w-52 rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" />
        <select value={filters.year} onChange={setFilter('year')} aria-label="Year" className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm"><option value="">All years</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <select value={filters.month} onChange={setFilter('month')} aria-label="Month" className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm"><option value="">All months</option>{['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <select value={filters.status} onChange={setFilter('status')} aria-label="Status" className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm"><option value="">Any status</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option></select>
        <select value={filters.pay} onChange={setFilter('pay')} aria-label="Payment" className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm"><option value="">Any payment</option><option value="unpaid">Unpaid</option><option value="partly_paid">Partly paid</option><option value="paid">Paid</option></select>
        {anyFilter && <button type="button" className="btn-ghost text-xs" onClick={() => setFilters({ year: '', month: '', status: '', pay: '', q: '' })}>Clear filters</button>}
      </div>
      {totals.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="invoicing-totals">
          {totals.map(([cur, t]) => (
            <div key={cur} className="rounded-xl border border-tertiary-100 bg-white p-3 text-sm">
              <p className="text-xs font-medium text-tertiary-500">{cur}: sent and paid invoices</p>
              <p className="mt-1">Invoiced <span className="font-semibold tabular-nums">{money(t.invoiced)}</span></p>
              <p className="text-success-700">Paid <span className="font-semibold tabular-nums">{money(t.paid)}</span></p>
              <p className="text-warning-700">Pending <span className="font-semibold tabular-nums">{money(t.pending)}</span></p>
            </div>
          ))}
        </div>
      )}
      {!loading && rows.length === 0 ? (
        <EmptyState title="No invoices yet" description="Compute revenue for a period, then generate an invoice for a project." />
      ) : (
        <DataTable columns={columns} rows={shown} loading={loading} emptyLabel={anyFilter ? 'No invoices match these filters.' : 'No invoices.'} />
      )}
      <GenerateInvoiceDrawer open={generateOpen} onClose={() => setGenerateOpen(false)} onSubmit={generate} />
      <ComputeRevenueDrawer open={computeOpen} onClose={() => setComputeOpen(false)} onSubmit={computeRevenue} />
    </div>
  );
}
