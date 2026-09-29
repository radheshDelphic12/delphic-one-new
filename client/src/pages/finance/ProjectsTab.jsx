import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { PROJECT_CATEGORIES, categoryLabel } from '../../lib/projectCategories.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import FilesPanel from '../../components/FilesPanel.jsx';
import LeadClientSelect from '../../components/LeadClientSelect.jsx';
import InvoicingSection from './InvoicingSection.jsx';
import ProjectCostingSection from './ProjectCostingSection.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { CONTRACT_FILTERS, CONTRACT_STATES, CategoryFilter, FilterPills, matchesCategory, money as moneyIn, useExchangeRates } from './projectFilters.jsx';

const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function billingLabel(row) {
  if (!row.billing_type) return <span className="text-tertiary-400">Not set</span>;
  const suffix = row.billing_type === 'hourly' ? '/hr' : '/mo';
  return (
    <span>
      <span className="capitalize">{row.billing_type}</span>
      <span className="ml-1.5 text-xs text-tertiary-500">{row.currency} {money(row.rate)}{suffix}</span>
      {row.billing_type === 'hourly' && row.estimated_monthly_hours ? (
        <span className="block text-xs text-tertiary-500">Est. {row.estimated_monthly_hours}h/mo ≈ {row.currency} {money(row.estimated_monthly_hours * row.rate)}</span>
      ) : null}
    </span>
  );
}

const formatDay = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString();

function AgreementDates({ row }) {
  if (!row.agreement_start_date && !row.agreement_end_date) return <span className="text-tertiary-400">Not set</span>;
  return (
    <span className="whitespace-nowrap text-sm">
      {row.agreement_start_date ? formatDay(row.agreement_start_date) : '…'} – {row.agreement_end_date ? formatDay(row.agreement_end_date) : 'open'}
    </span>
  );
}

function ContractPill({ contract }) {
  const state = CONTRACT_STATES.find((s) => s.key === contract?.state);
  if (!state) return null;
  const days = contract.state === 'about_to_end' && contract.days_left !== null ? ` · ${contract.days_left}d left` : '';
  return <Pill tone={state.tone}>{state.label}{days}</Pill>;
}

function emptyForm(profile) {
  return {
    project_name: profile.project_name || '',
    client_account_id: profile.client_account_id || '',
    service_category: profile.service_category || '',
    agreement_start_date: profile.agreement_start_date || '',
    agreement_end_date: profile.agreement_end_date || '',
    contract_status: profile.contract_status || '',
    benchmark_hours: profile.benchmark_hours ?? 160,
    overtime_billable: Boolean(profile.overtime_billable),
    overtime_multiplier: profile.overtime_multiplier ?? 1,
    estimated_monthly_hours: profile.estimated_monthly_hours ?? '',
    billing_type: profile.billing_type || '',
    rate: profile.rate ?? '',
    currency: profile.currency || 'INR',
  };
}

/**
 * One project's profile: identity, billing terms, agreement date + attachments,
 * and — kept in its own section, not merged with the calendar — who is assigned
 * to it (Employee ↔ Project). Its calendar (Project ↔ Calendar) is set under
 * People → HR Settings → Calendars.
 */
function ProjectProfileDrawer({ project, onClose, onSaved }) {
  const { pushError, pushInfo } = useAlerts();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm(project ? emptyForm(project) : null); }, [project]);
  if (!project || !form) return <Drawer open={false} onClose={onClose} title="" />;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const monthly = form.billing_type === 'monthly';
  const hourly = form.billing_type === 'hourly';
  const estimatedAmount = hourly && Number(form.estimated_monthly_hours) > 0 && form.rate !== '' ? Number(form.estimated_monthly_hours) * Number(form.rate) : null;

  async function submit(event) {
    event.preventDefault();
    const patch = {
      project_name: form.project_name.trim(),
      agreement_start_date: form.agreement_start_date || null,
      agreement_end_date: form.agreement_end_date || null,
      contract_status: form.contract_status || null,
      benchmark_hours: Number(form.benchmark_hours) || 160,
      overtime_billable: form.overtime_billable,
      overtime_multiplier: Number(form.overtime_multiplier) || 1,
    };
    // The client's hour estimate only applies to hourly billing; leave it alone otherwise.
    if (hourly) patch.estimated_monthly_hours = Number(form.estimated_monthly_hours) > 0 ? Number(form.estimated_monthly_hours) : null;
    // Only send the client when it changed, so a legacy free-text client isn't wiped by an unrelated edit.
    if (form.client_account_id !== (project.client_account_id || '')) patch.client_account_id = form.client_account_id || null;
    if (form.service_category) patch.service_category = form.service_category;
    const billingChanged =
      form.billing_type && form.rate !== '' &&
      (form.billing_type !== project.billing_type || Number(form.rate) !== project.rate || form.currency !== project.currency);
    if (billingChanged) patch.billing = { rate_type: form.billing_type, rate: Number(form.rate), currency: form.currency };

    setSaving(true);
    try {
      await apiClient.patch(`/billing/projects/${project.id}`, patch);
      pushInfo('Project updated');
      onSaved();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the project'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      title={project.project_code ? `${project.project_name} · ${project.project_code}` : project.project_name}
      onClose={onClose}
      size="xl"
      tone="edit"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="project-profile-form" className="btn-primary" disabled={saving || !form.project_name.trim()}>{saving ? 'Saving…' : 'Save project'}</button>
        </>
      }
    >
      <div className="space-y-6">
        <form id="project-profile-form" onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-tertiary-600">
              Project name
              <input required value={form.project_name} onChange={(e) => set('project_name', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
              <span className="mt-1 block font-normal text-tertiary-400">
                A label only — another contract may share it. This project is <span className="font-medium text-tertiary-600">{project.project_code || 'identified by its id'}</span>, with its own resources, dates, rates, billing and P&amp;L.
              </span>
            </label>
            <div className="block text-xs font-medium text-tertiary-600">
              Client name
              <LeadClientSelect value={form.client_account_id} onChange={(v) => set('client_account_id', v)} current={project.client_account} />
              {!project.client_account_id && project.client_name && (
                <span className="mt-1 block font-normal text-tertiary-500">Saved as text: &ldquo;{project.client_name}&rdquo;. Pick the matching client to link it.</span>
              )}
            </div>
            <label className="block text-xs font-medium text-tertiary-600">
              Requirement <span className="font-normal text-tertiary-400">(not linked yet)</span>
              <input disabled value="" placeholder="—" className="mt-1 w-full rounded-xl border bg-tertiary-50 px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs font-medium text-tertiary-600">
              Category
              <select value={form.service_category} onChange={(e) => set('service_category', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                <option value="">Not set</option>
                {PROJECT_CATEGORIES.map((c) => <option key={c.value} value={c.value} disabled={c.disabled}>{c.label}</option>)}
              </select>
            </label>
          </div>

          <div className="rounded-2xl border border-tertiary-100 p-4">
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Billing</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-tertiary-600">
                Billing type
                <select value={form.billing_type} onChange={(e) => set('billing_type', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                  <option value="">Not set</option>
                  <option value="hourly">Hourly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-tertiary-600">
                {monthly ? 'Monthly rate' : 'Hourly rate'}
                <input type="number" min="0" step="0.01" value={form.rate} onChange={(e) => set('rate', e.target.value)} disabled={!form.billing_type} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-tertiary-50" />
              </label>
              <label className="block text-xs font-medium text-tertiary-600">
                Currency
                <select value={form.currency} onChange={(e) => set('currency', e.target.value)} disabled={!form.billing_type} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-tertiary-50">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-tertiary-600">
                Agreement start date
                <input type="date" value={form.agreement_start_date} onChange={(e) => set('agreement_start_date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs font-medium text-tertiary-600">
                Agreement end date
                <input type="date" min={form.agreement_start_date || undefined} value={form.agreement_end_date} onChange={(e) => set('agreement_end_date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
              </label>
              {monthly && (
                <label className="block text-xs font-medium text-tertiary-600">
                  Monthly benchmark (hours)
                  <input type="number" min="1" max="744" value={form.benchmark_hours} onChange={(e) => set('benchmark_hours', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                </label>
              )}
              {hourly && (
                <label className="block text-xs font-medium text-tertiary-600">
                  Estimated hours / month <span className="font-normal text-tertiary-400">(from client, optional)</span>
                  <input type="number" min="0" max="10000" step="0.5" value={form.estimated_monthly_hours} onChange={(e) => set('estimated_monthly_hours', e.target.value)} placeholder="e.g. 120" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                  <span className="mt-0.5 block font-normal text-tertiary-400">
                    {estimatedAmount !== null ? `≈ ${form.currency} ${money(estimatedAmount)} estimated revenue / month` : 'Shows estimated revenue in Billing & Sales'}
                  </span>
                </label>
              )}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-tertiary-600">
                Contract status
                <select value={form.contract_status} onChange={(e) => set('contract_status', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                  <option value="">Automatic (from the dates)</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
              <p className="self-end pb-2 text-xs text-tertiary-500 sm:col-span-2">
                Automatic: not started before the start date, about to end in its last 30 days, completed after the end date.
              </p>
            </div>
            <div className="mt-3 grid gap-3 rounded-xl border border-tertiary-100 bg-tertiary-50/50 p-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-xs font-medium text-tertiary-700 sm:col-span-2">
                <input type="checkbox" checked={form.overtime_billable} onChange={(e) => set('overtime_billable', e.target.checked)} className="h-4 w-4 rounded border-tertiary-300" />
                Client pays overtime on this contract
                <span className="font-normal text-tertiary-500">— approved overtime hours{monthly ? ' (and weekend / holiday work)' : ''} are billed; off = never billed, whatever Billing &amp; Sales shows.</span>
              </label>
              <label className="block text-xs font-medium text-tertiary-600">
                Overtime rate multiplier
                <input type="number" min="1" max="5" step="0.25" value={form.overtime_multiplier} onChange={(e) => set('overtime_multiplier', e.target.value)} disabled={!form.overtime_billable} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-tertiary-50" />
                <span className="mt-0.5 block font-normal text-tertiary-400">× the {monthly ? 'monthly rate ÷ benchmark hours' : 'hourly rate'}</span>
              </label>
            </div>
            <p className="mt-3 text-xs text-tertiary-500">
              {monthly
                ? `Monthly: the rate covers a ${form.benchmark_hours || 160}-hour benchmark spread over the month's actual working days (Mon–Fri less the project calendar's holidays). Each working day earns its share in proportion to hours logged.`
                : 'Hourly: logged (approved, billable) hours × the hourly rate. The estimated hours are a forecast only — billing and invoices always use approved hours.'}
              {' '}Nothing is billed or invoiced before the agreement start date. Changing the type or rate adds a new rate from the agreement start date (or today if none is set) — earlier billing is never rewritten.
            </p>
          </div>
        </form>

        <FilesPanel entityType="account" entityId={project.id} title="Client agreements" defaultLabel="Client Agreement" multiple />

        <div className="rounded-2xl border border-tertiary-100 p-4">
          <ProjectCostingSection accountId={project.id} />
        </div>

        <p className="text-xs text-tertiary-500">
          Calendar: <span className="font-medium text-tertiary-700">{project.calendar?.name || '—'}</span>
          {' · '}
          <Link to="/people?section=hr-settings&tab=calendars" className="text-primary-700 hover:underline">change under People → Calendars</Link>
        </p>
      </div>
    </Drawer>
  );
}

/**
 * Finance → Projects (was "Billing Rates"): the hub for running projects and
 * contracts — Manage Services and Projects alike — with billing terms, client
 * agreements, the project team, and invoicing.
 */
export default function ProjectsTab() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [category, setCategory] = useState('all');
  const [contract, setContract] = useState('all');
  const { toInr } = useExchangeRates();

  const matchesContract = (row, key) => key === 'all' || row.contract?.state === key;
  const visible = useMemo(
    () => rows.filter((row) => matchesCategory(row.service_category, category) && (contract === 'all' || row.contract?.state === contract)),
    [rows, category, contract]
  );

  // Monthly billing of the filtered projects, in INR. Hourly projects have no
  // fixed monthly figure; a currency with no exchange rate is left out and named.
  const monthly = visible.filter((row) => row.billing_type === 'monthly');
  const monthlyTotal = monthly.reduce((sum, row) => sum + (toInr(row.rate, row.currency) ?? 0), 0);
  const unconverted = [...new Set(monthly.filter((row) => toInr(row.rate, row.currency) === null).map((row) => row.currency))];
  const hourlyCount = visible.filter((row) => row.billing_type === 'hourly').length;

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/billing/projects')
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load projects'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [pushError]);

  useEffect(() => { load(); }, [load]);

  const columns = [
    { key: 'code', header: 'Project ID', render: (row) => <span className="font-mono text-xs text-tertiary-600">{row.project_code || '—'}</span> },
    { key: 'project', header: 'Project name', render: (row) => <span className="font-medium text-tertiary-900">{row.project_name}</span> },
    { key: 'client', header: 'Client name', render: (row) => row.client_name || <span className="text-tertiary-400">—</span> },
    { key: 'requirement', header: 'Requirement', render: (row) => row.requirement || '' },
    { key: 'billing', header: 'Billing type', render: billingLabel },
    { key: 'overtime', header: 'Overtime', render: (row) => (row.overtime_billable ? <Pill tone="green">Billed {row.overtime_multiplier}×</Pill> : <span className="text-xs text-tertiary-400">Not billed</span>) },
    { key: 'category', header: 'Category', render: (row) => categoryLabel(row.service_category) },
    { key: 'start', header: 'Agreement', render: (row) => <AgreementDates row={row} /> },
    { key: 'contract', header: 'Contract', render: (row) => <ContractPill contract={row.contract} /> },
    { key: 'open', header: '', render: (row) => <button type="button" className="btn-ghost text-xs" onClick={() => setSelected(row)}>Open</button> },
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-xs text-tertiary-500">
          Running projects and contracts. Add a project from <Link to="/people?section=hr-settings&tab=calendars" className="text-primary-700 hover:underline">People → Calendars → Add Project</Link>, then set its billing here.
        </p>
        {!loading && rows.length === 0 ? (
          <EmptyState title="No projects yet" description="Add a project under People → Calendars, and it will appear here." />
        ) : (
          <>
            <CategoryFilter rows={rows} getCategory={(row) => row.service_category} value={category} onChange={setCategory} loading={loading} />
            <FilterPills
              label="Contract"
              options={CONTRACT_FILTERS}
              rows={rows.filter((row) => matchesCategory(row.service_category, category))}
              matches={matchesContract}
              value={contract}
              onChange={setContract}
              loading={loading}
            />
            {!loading && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-tertiary-100 bg-white px-4 py-2.5 text-sm">
                <span className="text-tertiary-500">Monthly billing total</span>
                <span className="font-heading text-base font-semibold tabular-nums text-tertiary-900">{moneyIn(monthlyTotal, 'INR')}</span>
                <span className="text-xs text-tertiary-500">
                  {monthly.length} monthly project{monthly.length === 1 ? '' : 's'}
                  {hourlyCount > 0 && ` · ${hourlyCount} hourly not included`}
                  {unconverted.length > 0 && ` · ${unconverted.join(', ')} not included — set the exchange rate in Project P&L`}
                </span>
              </div>
            )}
            <DataTable columns={columns} rows={visible} loading={loading} emptyLabel="No projects in this category." onRowClick={setSelected} />
          </>
        )}
      </section>

      <section className="space-y-2 border-t border-tertiary-100 pt-5">
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Invoicing</h3>
        <InvoicingSection />
      </section>

      <ProjectProfileDrawer project={selected} onClose={() => setSelected(null)} onSaved={load} />
    </div>
  );
}
