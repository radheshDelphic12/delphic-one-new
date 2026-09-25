import { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
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
        <p className="text-xs text-tertiary-500">Computes revenue from approved + billable timesheet hours × billing rate, for every project with a billing rate, from its Agreement Start Date. Hourly = logged hours × rate; monthly = the rate spread over the month&apos;s working days against a 160-hour benchmark. Capped at 31 days per run.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">From<input required type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">To<input required type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        </div>
      </form>
    </Drawer>
  );
}

/** Invoicing — lives under Finance → Projects now that the Accounting tab is switched off. */
export default function InvoicingSection() {
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
    { key: 'client', header: 'Project', render: (row) => row.client_account?.name || '—' },
    { key: 'period', header: 'Period', render: (row) => `${row.period_month}/${row.period_year}` },
    { key: 'amount', header: 'Amount', render: (row) => `${row.currency} ${money(row.amount)}` },
    { key: 'lines', header: 'Line items', render: (row) => (row.line_items?.length ?? 0) },
    { key: 'status', header: 'Status', render: (row) => <Badge value={row.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex gap-2">
          {row.status === 'draft' && <button type="button" className="btn-ghost text-xs" onClick={() => transition(row, 'sent')}>Mark sent</button>}
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
