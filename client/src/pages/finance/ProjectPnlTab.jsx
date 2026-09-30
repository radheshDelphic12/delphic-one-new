import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Paperclip, Plus, Trash2, TrendingUp } from 'lucide-react';
import apiClient, { openAuthenticatedFile } from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { CONTRACT_FILTERS, CategoryFilter, FilterPills, matchesCategory, money, useExchangeRates, ExchangeRatesPanel } from './projectFilters.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];

function ProfitCell({ value, currency, missing }) {
  if (value === null) return <span className="text-xs font-medium text-warning-700">Set {missing.join(', ')} rate</span>;
  return <span className={`font-medium tabular-nums ${value < 0 ? 'text-danger-700' : 'text-success-700'}`}>{money(value, currency)}</span>;
}

function Stat({ label, value, tone }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === 'bad' ? 'border-danger-200 bg-danger-50' : 'border-tertiary-100 bg-white'}`}>
      <p className="text-xs text-tertiary-500">{label}</p>
      <p className={`mt-0.5 font-heading text-base font-semibold tabular-nums ${tone === 'bad' ? 'text-danger-700' : 'text-tertiary-900'}`}>{value}</p>
    </div>
  );
}

const EMPTY_INVOICE = { vendor_account_id: '', invoice_number: '', amount: '', currency: 'INR', notes: '' };

function VendorInvoices({ projectId, period, vendors, onChanged }) {
  const { pushError, pushInfo } = useAlerts();
  const [invoices, setInvoices] = useState([]);
  const [files, setFiles] = useState({});
  const [form, setForm] = useState(EMPTY_INVOICE);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const { data } = await apiClient.get(`/billing/projects/${projectId}/vendor-invoices`, { params: period });
      const rows = data.data || [];
      setInvoices(rows);
      const docs = await Promise.all(rows.map((inv) => apiClient
        .get('/documents', { params: { entity_type: 'project_vendor_invoice', entity_id: inv.id } })
        .then((r) => [inv.id, r.data.data || []])
        .catch(() => [inv.id, []])));
      setFiles(Object.fromEntries(docs));
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load vendor invoices'), 'Something went wrong');
    }
  }

  useEffect(() => { load(); }, [projectId, period.period_month, period.period_year]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(key, value) { setForm((current) => ({ ...current, [key]: value })); }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await apiClient.post(`/billing/projects/${projectId}/vendor-invoices`, {
        ...period,
        vendor_account_id: form.vendor_account_id,
        invoice_number: form.invoice_number.trim() || null,
        amount: Number(form.amount),
        currency: form.currency,
        notes: form.notes.trim() || null,
      });
      if (file) {
        const body = new FormData();
        body.append('entity_type', 'project_vendor_invoice');
        body.append('entity_id', data.data.id);
        body.append('label', form.invoice_number.trim() || `Vendor invoice ${MONTHS[period.period_month - 1]} ${period.period_year}`);
        body.append('file', file);
        await apiClient.post('/documents', body);
      }
      pushInfo('Vendor invoice added');
      setForm(EMPTY_INVOICE);
      setFile(null);
      await load();
      onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to add the vendor invoice'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function remove(invoice) {
    try {
      await apiClient.delete(`/billing/vendor-invoices/${invoice.id}`);
      pushInfo('Vendor invoice removed');
      await load();
      onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to remove the vendor invoice'), 'Something went wrong');
    }
  }

  return (
    <div className="space-y-3">
      {invoices.length === 0 ? (
        <p className="text-sm text-tertiary-500">No vendor invoices for this month. Contractor cost uses their vendor rate until an invoice is added.</p>
      ) : (
        <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
          {invoices.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium text-tertiary-900">{inv.vendor_account?.name}</span>
                {inv.invoice_number && <span className="ml-2 text-tertiary-500">#{inv.invoice_number}</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{money(inv.amount, inv.currency)}</span>
                {(files[inv.id] || []).map((doc) => (
                  <button key={doc.id} type="button" aria-label="Open invoice file" className="rounded-lg p-1.5 text-primary-700 hover:bg-primary-50" onClick={() => openAuthenticatedFile(doc.file_url).catch((err) => pushError(err.message, 'Could not open file'))}>
                    <Paperclip className="h-3.5 w-3.5" />
                  </button>
                ))}
                <button type="button" aria-label="Remove vendor invoice" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(inv)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <SearchableSelect value={form.vendor_account_id} onChange={(v) => set('vendor_account_id', v)} options={vendors.map((v) => ({ value: v.id, label: v.name }))} placeholder="Vendor" searchPlaceholder="Search vendors…" />
        </div>
        <input value={form.invoice_number} onChange={(e) => set('invoice_number', e.target.value)} placeholder="Invoice number (optional)" className="rounded-xl border px-3 py-2 text-sm" />
        <div className="flex gap-2">
          <input type="number" min="0" step="0.01" required value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="Amount" className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm" />
          <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className="rounded-xl border px-2 py-2 text-sm">
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <input value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Notes (optional)" className="rounded-xl border px-3 py-2 text-sm sm:col-span-2" />
        <label className="text-xs font-medium text-tertiary-600 sm:col-span-2">
          Invoice file (optional)
          <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={saving || !form.vendor_account_id || !form.amount}>
            <Plus className="h-4 w-4" /> {saving ? 'Saving…' : 'Add vendor invoice'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ProjectPnlDrawer({ projectId, period, vendors, onClose, onChanged }) {
  const { pushError } = useAlerts();
  const [pnl, setPnl] = useState(null);

  function load() {
    if (!projectId) return;
    apiClient
      .get(`/billing/projects/${projectId}/pnl`, { params: period })
      .then(({ data }) => setPnl(data.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the project P&L'), 'Something went wrong'));
  }

  useEffect(() => { setPnl(null); load(); }, [projectId, period.period_month, period.period_year]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closed: nothing from the last project (its P&L can outlive the id for a
  // render, and the vendor invoices would then load for a null project).
  if (!projectId) return <Drawer open={false} title="" onClose={onClose} size="xl" />;

  const c = pnl?.currency;
  const foreign = pnl && pnl.revenue.original_currency && pnl.revenue.original_currency !== 'INR';
  return (
    <Drawer open title={pnl ? `${pnl.project.name} — ${MONTHS[period.period_month - 1]} ${period.period_year}` : 'Project P&L'} onClose={onClose} size="xl">
      {!pnl ? (
        <p className="text-sm text-tertiary-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={foreign ? `Client billing (${money(pnl.revenue.original_amount, pnl.revenue.original_currency)})` : 'Client billing'} value={money(pnl.revenue.amount, c)} />
            <Stat label="Internal salary" value={money(pnl.internal.cost, c)} />
            <Stat label="Vendor contractors" value={money(pnl.vendor.cost, c)} />
            <Stat
              label={`Profit${pnl.margin_percent !== null ? ` (${pnl.margin_percent}%)` : ''}`}
              value={pnl.profit === null ? `Set ${pnl.missing_rates.join(', ')} rate` : money(pnl.profit, c)}
              tone={pnl.profit === null || pnl.profit < 0 ? 'bad' : undefined}
            />
          </div>
          <p className="text-xs text-tertiary-500">
            Profit = client billing − (internal salary allocations + vendor contractor cost).
            {pnl.revenue.billing_type === 'monthly' && ` Fixed monthly billing of ${money(pnl.revenue.rate, pnl.revenue.original_currency)}${pnl.revenue.prorated_days ? `, prorated for ${pnl.revenue.prorated_days} days` : ''}.`}
            {pnl.revenue.billing_type === 'hourly' && ` ${pnl.revenue.billable_hours} approved billable hours this month at ${money(pnl.revenue.rate, pnl.revenue.original_currency)}/hr${pnl.revenue.overtime_hours ? `, plus ${pnl.revenue.overtime_hours}h approved overtime (${money(pnl.revenue.overtime_amount, pnl.revenue.original_currency)})` : ''}${pnl.revenue.locked ? ' — from the locked billing' : ''}.`}
            {pnl.revenue.note === 'after_agreement_end' && ' The agreement had ended before this month.'}
            {pnl.revenue.note === 'before_agreement_start' && ' The agreement had not started in this month.'}
            {pnl.revenue.note === 'no_billing_rate' && ' No billing terms are set for this project yet (Projects tab → Edit).'}
            {' All amounts are in INR'}{foreign ? `, converted from ${pnl.revenue.original_currency}` : ''}.
            {pnl.missing_rates.length > 0 && ` No exchange rate is set for ${pnl.missing_rates.join(', ')} — those amounts count as 0 until it is.`}
          </p>

          <section className="space-y-2">
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Internal employees</h3>
            {pnl.internal.employees.length === 0 ? (
              <p className="text-sm text-tertiary-500">No employees allocated to this project.</p>
            ) : (
              <DataTable
                rows={pnl.internal.employees.map((e) => ({ ...e, id: e.org_membership_id }))}
                columns={[
                  { key: 'name', header: 'Employee' },
                  { key: 'salary', header: 'Monthly salary', render: (r) => (r.missing_salary ? <span className="text-warning-700">No salary structure</span> : money(r.monthly_salary)) },
                  { key: 'alloc', header: 'Allocation', render: (r) => `${r.allocation_percent}%` },
                  { key: 'basis', header: 'Cost basis', render: (r) => (r.cost_basis === 'cost_rate' ? `${r.approved_hours}h × ${money(r.cost_rate_per_hr)}/h internal rate` : 'salary × allocation') },
                  { key: 'cost', header: 'Cost to project', render: (r) => money(r.cost, c) },
                ]}
              />
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Vendor contractors</h3>
            {pnl.vendor.vendors.length === 0 ? (
              <p className="text-sm text-tertiary-500">No contractors allocated and no vendor invoices this month.</p>
            ) : (
              <DataTable
                rows={pnl.vendor.vendors.map((v, i) => ({ ...v, id: v.vendor?.id || `none-${i}` }))}
                columns={[
                  { key: 'vendor', header: 'Vendor', render: (r) => r.vendor?.name || 'No vendor set' },
                  { key: 'contractors', header: 'Contractors', render: (r) => r.contractors.join(', ') || '-' },
                  { key: 'est', header: 'Vendor-rate estimate', render: (r) => money(r.estimated_cost, c) },
                  { key: 'inv', header: 'Invoiced', render: (r) => money(r.invoiced_amount, c) },
                  { key: 'cost', header: 'Cost used', render: (r) => <span>{money(r.cost, c)} <span className="text-xs text-tertiary-400">({r.basis === 'invoice' ? 'invoice' : 'rate'})</span></span> },
                ]}
              />
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Vendor invoices this month</h3>
            <p className="text-xs text-tertiary-500">Payable to the vendor, not through payroll. An invoice replaces that vendor&apos;s rate estimate for the month.</p>
            <VendorInvoices projectId={projectId} period={period} vendors={vendors} onChanged={() => { load(); onChanged(); }} />
          </section>
        </div>
      )}
    </Drawer>
  );
}

function Total({ label, value, tone }) {
  const color = tone === 'bad' ? 'text-danger-700' : tone === 'good' ? 'text-success-700' : 'text-tertiary-900';
  return (
    <div>
      <p className="text-xs text-tertiary-500">{label}</p>
      <p className={`font-heading text-base font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Finance → Project P&L: per-month profitability of every running project, in
 * INR. Client billing (fixed monthly or hourly) minus internal salary
 * allocations minus vendor contractor cost (vendor rate, or the vendor's
 * actual invoice), with totals for the requirement type filtered to.
 */
export default function ProjectPnlTab() {
  const now = new Date();
  const [period, setPeriod] = useState({ period_month: now.getMonth() + 1, period_year: now.getFullYear() });
  const [openId, setOpenId] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [category, setCategory] = useState('all');
  const [clientId, setClientId] = useState('');
  const [contract, setContract] = useState('all');
  const { rates, reload: reloadRates } = useExchangeRates();
  const { data, loading, refresh } = useLiveData(
    () => apiClient.get('/billing/projects-pnl', { params: period }).then((r) => r.data.data),
    { deps: [period.period_month, period.period_year] }
  );

  useEffect(() => {
    apiClient.get('/billing/vendors').then(({ data: res }) => setVendors(res.data || [])).catch(() => setVendors([]));
  }, []);

  const rows = useMemo(() => (data || []).map((r) => ({ ...r, id: r.project.id })), [data]);
  // Client comes from the project's linked client account.
  const clientOptions = useMemo(() => {
    const map = new Map();
    for (const r of rows) if (r.project.client_account_id) map.set(r.project.client_account_id, r.project.client_name || 'Client');
    return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);
  const inTypeAndClient = useMemo(
    () => rows.filter((r) => matchesCategory(r.service_category, category) && (!clientId || r.project.client_account_id === clientId)),
    [rows, category, clientId]
  );
  // Contract status (not started / running / about to end / on hold / completed).
  const visible = useMemo(
    () => inTypeAndClient.filter((r) => contract === 'all' || r.contract?.state === contract),
    [inTypeAndClient, contract]
  );

  // Totals of the filtered rows. A row whose currency has no exchange rate has
  // no INR billing or profit yet, so it is left out of those two (and the margin).
  const totals = useMemo(() => {
    const complete = visible.filter((r) => r.profit !== null);
    const sum = (list, key) => list.reduce((s, r) => s + Number(r[key] || 0), 0);
    const revenue = sum(complete, 'revenue');
    const profit = sum(complete, 'profit');
    return {
      revenue,
      internal: sum(visible, 'internal_cost'),
      vendor: sum(visible, 'vendor_cost'),
      profit,
      margin: revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : null,
      incomplete: visible.length - complete.length,
      missing: [...new Set(visible.flatMap((r) => r.missing_rates || []))],
    };
  }, [visible]);

  const columns = [
    { key: 'project', header: 'Project', render: (r) => <button type="button" className="text-left font-medium text-primary-700 hover:underline" onClick={() => setOpenId(r.project.id)}>{r.project.name}{r.project.code && <span className="block text-xs font-normal text-tertiary-500">{r.project.code}</span>}</button> },
    { key: 'client', header: 'Client', render: (r) => r.project.client_name || '-' },
    {
      key: 'revenue',
      header: 'Billing',
      render: (r) => (
        <span className="tabular-nums">
          {money(r.revenue, r.currency)}
          {r.original_currency && r.original_currency !== 'INR' && <span className="block text-xs text-tertiary-500">{money(r.original_revenue, r.original_currency)}</span>}
          {r.billing_type === 'hourly' && <span className="block text-xs text-tertiary-500">{r.billable_hours} h × {money(r.billing_rate, r.original_currency)}{r.overtime_hours ? ` + ${r.overtime_hours}h OT` : ''}</span>}
          {r.minimum?.shortfall_hours > 0 && <span className="block text-xs font-medium text-warning-700">{r.minimum.shortfall_hours}h below the {r.minimum.hours}h minimum</span>}
        </span>
      ),
    },
    { key: 'internal', header: 'Internal salary', render: (r) => money(r.internal_cost, r.currency) },
    { key: 'vendor', header: 'Vendor cost', render: (r) => money(r.vendor_cost, r.currency) },
    { key: 'profit', header: 'Profit', render: (r) => <ProfitCell value={r.profit} currency={r.currency} missing={r.missing_rates || []} /> },
    { key: 'margin', header: 'Margin', render: (r) => (r.margin_percent !== null ? `${r.margin_percent}%` : '-') },
  ];
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-2">
          <CategoryFilter rows={rows} getCategory={(r) => r.service_category} value={category} onChange={setCategory} loading={loading} />
          <FilterPills
            label="Status"
            options={CONTRACT_FILTERS}
            rows={inTypeAndClient}
            matches={(r, key) => key === 'all' || r.contract?.state === key}
            value={contract}
            onChange={setContract}
            loading={loading}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-56"><SearchableSelect value={clientId} onChange={setClientId} options={clientOptions} placeholder="All clients" searchPlaceholder="Search clients…" allowClear ariaLabel="Client" /></div>
          <select aria-label="Month" value={period.period_month} onChange={(e) => setPeriod((p) => ({ ...p, period_month: Number(e.target.value) }))} className="rounded-xl border px-3 py-1.5 text-sm">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select aria-label="Year" value={period.period_year} onChange={(e) => setPeriod((p) => ({ ...p, period_year: Number(e.target.value) }))} className="rounded-xl border px-3 py-1.5 text-sm">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <ExchangeRatesPanel rates={rates} onSaved={() => { reloadRates(); refresh?.(); }} />

      {totals.missing.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Set the {totals.missing.join(', ')} exchange rate above. Until then {plural(totals.incomplete, 'project')} can&apos;t be converted to INR and {totals.incomplete === 1 ? 'is' : 'are'} left out of the billing and profit totals.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-tertiary-100 bg-white px-4 py-3 sm:grid-cols-5">
          <Total label={`Billing · ${plural(visible.length - totals.incomplete, 'project')}`} value={money(totals.revenue, 'INR')} />
          <Total label="Internal salary" value={money(totals.internal, 'INR')} />
          <Total label="Vendor cost" value={money(totals.vendor, 'INR')} />
          <Total label="Profit" value={money(totals.profit, 'INR')} tone={totals.profit < 0 ? 'bad' : 'good'} />
          <Total label="Margin" value={totals.margin !== null ? `${totals.margin}%` : '-'} />
        </div>
      )}

      {!loading && rows.length === 0 ? (
        <EmptyState icon={TrendingUp} title="No running projects" description="Active client projects appear here with their monthly profit." />
      ) : (
        <DataTable columns={columns} rows={visible} loading={loading} emptyLabel="No projects of this requirement type" />
      )}
      <ProjectPnlDrawer projectId={openId} period={period} vendors={vendors} onClose={() => setOpenId(null)} onChanged={() => refresh?.()} />
    </div>
  );
}
