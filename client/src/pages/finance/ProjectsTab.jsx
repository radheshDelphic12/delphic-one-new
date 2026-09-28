import { useCallback, useEffect, useState } from 'react';
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
    </span>
  );
}

function emptyForm(profile) {
  return {
    project_name: profile.project_name || '',
    client_account_id: profile.client_account_id || '',
    service_category: profile.service_category || '',
    agreement_start_date: profile.agreement_start_date || '',
    benchmark_hours: profile.benchmark_hours ?? 160,
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

  async function submit(event) {
    event.preventDefault();
    const patch = {
      project_name: form.project_name.trim(),
      agreement_start_date: form.agreement_start_date || null,
      benchmark_hours: Number(form.benchmark_hours) || 160,
    };
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
      title={project.project_name}
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
              <label className="block text-xs font-medium text-tertiary-600 sm:col-span-2">
                Agreement start date
                <input type="date" value={form.agreement_start_date} onChange={(e) => set('agreement_start_date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
              </label>
              {monthly && (
                <label className="block text-xs font-medium text-tertiary-600">
                  Monthly benchmark (hours)
                  <input type="number" min="1" max="744" value={form.benchmark_hours} onChange={(e) => set('benchmark_hours', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                </label>
              )}
            </div>
            <p className="mt-3 text-xs text-tertiary-500">
              {monthly
                ? `Monthly: the rate covers a ${form.benchmark_hours || 160}-hour benchmark spread over the month's actual working days (Mon–Fri less the project calendar's holidays). Each working day earns its share in proportion to hours logged.`
                : 'Hourly: logged (approved, billable) hours × the hourly rate.'}
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

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/billing/projects')
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load projects'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [pushError]);

  useEffect(() => { load(); }, [load]);

  const columns = [
    { key: 'project', header: 'Project name', render: (row) => <span className="font-medium text-tertiary-900">{row.project_name}</span> },
    { key: 'client', header: 'Client name', render: (row) => row.client_name || <span className="text-tertiary-400">—</span> },
    { key: 'requirement', header: 'Requirement', render: (row) => row.requirement || '' },
    { key: 'billing', header: 'Billing type', render: billingLabel },
    { key: 'category', header: 'Category', render: (row) => categoryLabel(row.service_category) },
    { key: 'start', header: 'Agreement start', render: (row) => (row.agreement_start_date ? new Date(`${row.agreement_start_date}T00:00:00`).toLocaleDateString() : <span className="text-tertiary-400">Not set</span>) },
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
          <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No projects." onRowClick={setSelected} />
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
