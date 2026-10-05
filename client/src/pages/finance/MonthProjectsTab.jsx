import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { PROJECT_CATEGORIES, categoryLabel } from '../../lib/projectCategories.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ATTENTION = { invoice_not_generated: 'Invoice not generated', invoice_not_sent: 'Invoice not sent', payment_pending: 'Payment pending', billing_blocked: 'Billing blocked' };
const INVOICE_FILTERS = [['all', 'All invoices'], ['generated', 'Invoice generated'], ['not_generated', 'Invoice not generated'], ['paid', 'Paid'], ['unpaid', 'Unpaid'], ['sent', 'Sent'], ['unsent', 'Unsent']];
const CONTRACT_TYPE_FILTERS = [
  ['all', 'All'],
  ...PROJECT_CATEGORIES.filter((c) => !c.disabled).map((c) => [c.value, c.label]),
  ['none', 'No category'],
];

const money = (n, currency = 'INR') => `${currency} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * Finance month-wise project view: pick a month and see the projects that were running in it with their
 * client, contract type, billing type, assigned resources, logged hours, billing amount, invoice / payment status and
 * financial (lock) status - to reconcile Active projects -> Timesheet -> Billing -> Invoice -> Payment
 * -> Financial status. Also the Sales / Salary Excel exports for the month.
 */
export default function MonthProjectsTab() {
  const { pushError } = useAlerts();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [invoiceFilter, setInvoiceFilter] = useState('all');
  const [contractType, setContractType] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [view, setView] = useState(null);

  useEffect(() => {
    let alive = true;
    setView(null);
    apiClient.get('/calculations/finance/month-projects', { params: { period_month: month, period_year: year } })
      .then(({ data }) => { if (alive) setView(data.data); })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the month view'), 'Something went wrong'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  async function exportFile(kind) {
    try {
      await downloadFile(`/calculations/export/${kind}`, { period_month: month, period_year: year }, `${kind}-${year}-${String(month).padStart(2, '0')}.xlsx`);
    } catch (err) {
      pushError(apiErrorMessage(err, `Failed to export ${kind}`), 'Export failed');
    }
  }

  const rows = (view?.projects || []).filter((p) => {
    const inv = p.invoice;
    const okInvoice = invoiceFilter === 'all'
      || (invoiceFilter === 'generated' && inv.generated)
      || (invoiceFilter === 'not_generated' && !inv.generated)
      || (invoiceFilter === 'paid' && inv.paid)
      || (invoiceFilter === 'unpaid' && inv.generated && !inv.paid)
      || (invoiceFilter === 'sent' && inv.sent)
      || (invoiceFilter === 'unsent' && inv.generated && !inv.sent);
    const okContract = contractType === 'all'
      || (contractType === 'none' && !p.service_category)
      || p.service_category === contractType;
    return okInvoice && okContract && (typeFilter === 'all' || p.billing_type === typeFilter);
  });

  const columns = [
    { key: 'project', header: 'Project', render: (p) => <span>{p.project}{p.project_code && <span className="block text-xs text-tertiary-500">{p.project_code}</span>}</span> },
    { key: 'client', header: 'Client', render: (p) => p.client || '—' },
    { key: 'contract_type', header: 'Contract type', render: (p) => categoryLabel(p.service_category) },
    { key: 'type', header: 'Billing type', render: (p) => p.billing_type || '—' },
    { key: 'resources', header: 'Assigned resources', render: (p) => (p.assigned_resources.length ? p.assigned_resources.join(', ') : '—') },
    { key: 'hours', header: 'Logged hours', render: (p) => `${p.logged_hours}h` },
    { key: 'amount', header: 'Billing amount', render: (p) => money(p.billing_amount, p.currency) },
    { key: 'invoice', header: 'Invoice', render: (p) => (p.invoice.generated ? `${p.invoice.number || 'Generated'} · ${p.invoice.sent ? 'sent' : 'unsent'}` : 'Not generated') },
    { key: 'payment', header: 'Payment', render: (p) => p.payment_status.replace(/_/g, ' ') },
    { key: 'financial', header: 'Financial status', render: (p) => <span className="text-xs">Timesheets locked {p.financial_status.timesheet_locked}<br />Calculation {p.financial_status.calculation.replace(/_/g, ' ')} · Financial {p.financial_status.financial}</span> },
    { key: 'attention', header: 'To do', render: (p) => (p.attention.length ? <span className="text-xs text-danger-600">{p.attention.map((a) => ATTENTION[a] || a).join(', ')}</span> : <span className="text-xs text-tertiary-400">Nothing</span>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Finance</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Month-wise projects</h2>
          {view && <p className="mt-1 text-sm text-tertiary-500">{view.totals.projects} projects · {view.totals.not_generated} without an invoice · {view.totals.unsent} unsent · {view.totals.unpaid} unpaid</p>}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Invoice
            <select value={invoiceFilter} onChange={(e) => setInvoiceFilter(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{INVOICE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Contract type
            <select value={contractType} onChange={(e) => setContractType(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{CONTRACT_TYPE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Billing type
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm"><option value="all">All</option><option value="monthly">Monthly</option><option value="hourly">Hourly</option><option value="mixed">Mixed</option></select>
          </label>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => exportFile('sales')}><Download className="h-4 w-4" /> Sales Excel</button>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => exportFile('salary')}><Download className="h-4 w-4" /> Salary Excel</button>
        </div>
      </div>
      <DataTable columns={columns} rows={rows} loading={!view} emptyLabel="No projects were running in this month" maxHeight="calc(100dvh - 22rem)" />
    </div>
  );
}
