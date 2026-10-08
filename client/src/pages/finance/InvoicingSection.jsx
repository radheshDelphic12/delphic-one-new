import { useEffect, useState } from 'react';
import { Plus, Printer, RefreshCw } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Invoices built from a locked Billing & Sales month carry { lines, project, … };
// older ones (from computed daily revenue) are a plain array of requirement lines.
function invoiceLines(row) {
  const items = row.line_items;
  if (Array.isArray(items)) return items.map((li) => ({ label: li.requirement_title || 'Services', hours: li.hours, overtime_hours: 0, amount: li.revenue }));
  return (items?.lines || []).map((li) => ({ label: li.resource, hours: li.hours, overtime_hours: li.overtime_hours, amount: li.revenue }));
}

/**
 * Review / download: a standalone, printable invoice ("Save as PDF" in the
 * print dialog is the download) — same approach as payslips.
 */
function printInvoice(row, orgName) {
  const lines = invoiceLines(row);
  const meta = Array.isArray(row.line_items) ? {} : row.line_items || {};
  const win = window.open('', '_blank', 'width=820,height=960');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>Invoice — ${escapeHtml(row.client_account?.name)} ${row.period_month}/${row.period_year}</title>
    <style>body{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;padding:32px}h1{font-size:18px;margin:0}.sub{color:#64748b;font-size:12px;margin:4px 0 20px}
    table{width:100%;border-collapse:collapse}td,th{padding:6px 8px;font-size:13px;text-align:left;border-bottom:1px solid #e8ebf2}.r{text-align:right}.total td{font-weight:700;font-size:15px}</style></head><body>
    <h1>${escapeHtml(orgName || 'Invoice')}</h1>
    <p class="sub">Invoice for ${escapeHtml(meta.project?.name || row.client_account?.name)}${meta.project?.code ? ` (${escapeHtml(meta.project.code)})` : ''}${meta.project?.client_name ? ` · ${escapeHtml(meta.project.client_name)}` : ''} · Period ${row.period_month}/${row.period_year} · Status ${escapeHtml(row.status)}${meta.calculation_version ? ` · locked billing v${meta.calculation_version}` : ''}</p>
    <table><thead><tr><th>Item</th><th class="r">Hours</th><th class="r">Overtime hrs</th><th class="r">Amount (${escapeHtml(row.currency)})</th></tr></thead><tbody>
    ${lines.map((l) => `<tr><td>${escapeHtml(l.label)}</td><td class="r">${escapeHtml(l.hours ?? '')}</td><td class="r">${escapeHtml(l.overtime_hours || '')}</td><td class="r">${escapeHtml(money(l.amount))}</td></tr>`).join('')}
    <tr class="total"><td colspan="3">Total</td><td class="r">${escapeHtml(row.currency)} ${escapeHtml(money(row.amount))}</td></tr></tbody></table>
    </body></html>`);
  win.document.close();
  win.focus();
  win.print();
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

  async function transition(row, status) {
    try {
      await apiClient.post(`/billing/invoices/${row.id}/status`, { status });
      pushInfo(`Invoice marked ${status}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update invoice status'), 'Something went wrong');
    }
  }

  const columns = [
    { key: 'client', header: 'Project', render: (row) => <span>{row.line_items?.project?.name || row.client_account?.name || '—'}{row.line_items?.project?.code && <span className="block text-xs text-tertiary-500">{row.line_items.project.code}{row.line_items.project.client_name ? ` · ${row.line_items.project.client_name}` : ''}</span>}</span> },
    { key: 'period', header: 'Period', render: (row) => `${row.period_month}/${row.period_year}` },
    { key: 'amount', header: 'Amount', render: (row) => `${row.currency} ${money(row.amount)}` },
    { key: 'lines', header: 'Line items', render: (row) => invoiceLines(row).length },
    { key: 'source', header: 'Source', render: (row) => (row.calculation_version_id ? <span className="text-xs text-success-700">Locked billing v{row.line_items?.calculation_version}</span> : <span className="text-xs text-tertiary-500">Computed revenue</span>) },
    { key: 'status', header: 'Status', render: (row) => <Badge value={row.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex gap-2">
          <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => printInvoice(row, user?.active_org?.name)}><Printer className="h-3.5 w-3.5" /> View / download</button>
          {row.status === 'draft' && <button type="button" className="btn-ghost text-xs" onClick={() => transition(row, 'sent')}>Mark sent (shared)</button>}
          {row.status === 'sent' && <button type="button" className="btn-ghost text-xs" onClick={() => transition(row, 'paid')}>Mark paid</button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setComputeOpen(true)}><RefreshCw className="h-4 w-4" /> Compute revenue</button>
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setGenerateOpen(true)}><Plus className="h-4 w-4" /> Generate invoice</button>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState title="No invoices yet" description="Compute revenue for a period, then generate an invoice for a project." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No invoices." />
      )}
      <GenerateInvoiceDrawer open={generateOpen} onClose={() => setGenerateOpen(false)} onSubmit={generate} />
      <ComputeRevenueDrawer open={computeOpen} onClose={() => setComputeOpen(false)} onSubmit={computeRevenue} />
    </div>
  );
}
