import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useOrgMembershipOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

const STATUS_LABELS = {
  present: 'Present (also Present + OT)',
  full_day: 'Full day',
  half_day: 'Half day',
  pl: 'Paid leave (PL)',
  npl: 'Non-paid leave (NPL)',
  comp_off: 'Comp off',
  first_half: 'First half (FH)',
  second_half: 'Second half (SH)',
  absent: 'Absent',
};
const today = () => new Date().toISOString().slice(0, 10);
const money = (n, c = 'INR') => `${c} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * Finance > Billing Setup: per-resource client billing for a project.
 *  - a resource's own rate (monthly for one person, hourly for another, in the same month);
 *  - "apply the project rate to every allocated resource" so monthly billing follows each person's status;
 *  - the client billing status rules (the share of a working day billed for PL, NPL, comp off, FH, SH ...),
 *    which are separate from the employees' salary leave rules.
 */
export default function BillingSetupTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [projects, setProjects] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [rates, setRates] = useState([]);
  const [rules, setRules] = useState(null);
  const [form, setForm] = useState({ org_membership_id: '', rate_type: 'monthly', rate: '', effective_from: today() });
  const [applyFrom, setApplyFrom] = useState(today());
  const members = useOrgMembershipOptions(true);

  useEffect(() => {
    apiClient.get('/calendars/projects').then(({ data }) => setProjects(data.data || [])).catch(() => setProjects([]));
  }, []);

  const load = useCallback(() => {
    if (!accountId) { setRates([]); setRules(null); return; }
    apiClient.get('/billing/resource-rates', { params: { account_id: accountId } }).then(({ data }) => setRates(data.data || [])).catch(() => setRates([]));
    apiClient.get(`/billing/projects/${accountId}/billing-rules`).then(({ data }) => setRules(data.data)).catch(() => setRules(null));
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  const fail = (err, text) => pushError(apiErrorMessage(err, text), 'Something went wrong');

  async function addRate(event) {
    event.preventDefault();
    try {
      await apiClient.post('/billing/resource-rates', { account_id: accountId, org_membership_id: form.org_membership_id, rate_type: form.rate_type, rate: Number(form.rate), effective_from: form.effective_from });
      pushSuccess('Resource rate added');
      setForm((f) => ({ ...f, rate: '' }));
      load();
    } catch (err) { fail(err, 'Failed to add the rate'); }
  }

  async function removeRate(row) {
    const reason = window.prompt(`Remove ${row.resource}'s ${row.rate_type} rate? Give a reason (required):`);
    if (reason === null) return;
    if (reason.trim().length < 3) { pushError('A reason of at least 3 characters is required', 'Not removed'); return; }
    try {
      await apiClient.delete(`/billing/resource-rates/${row.id}`, { data: { reason: reason.trim() } });
      pushSuccess('Rate removed');
      load();
    } catch (err) { fail(err, 'Failed to remove the rate'); }
  }

  async function applyProjectRate() {
    try {
      const { data } = await apiClient.post(`/billing/projects/${accountId}/resource-rates/apply-project-rate`, { effective_from: applyFrom });
      pushSuccess(`${data.data.created} resource${data.data.created === 1 ? '' : 's'} now billed on their own rate (${data.data.skipped} already had one)`);
      load();
    } catch (err) { fail(err, 'Failed to apply the project rate'); }
  }

  async function saveRules(event) {
    event.preventDefault();
    const reason = window.prompt('Reason for changing the client billing status rules:') || undefined;
    try {
      const body = Object.fromEntries(Object.keys(STATUS_LABELS).map((k) => [k, Number(rules.rules[k])]));
      const { data } = await apiClient.put(`/billing/projects/${accountId}/billing-rules`, { rules: body, reason });
      setRules(data.data);
      pushSuccess('Billing status rules saved');
    } catch (err) { fail(err, 'Failed to save the rules'); }
  }

  const columns = [
    { key: 'resource', header: 'Resource', render: (r) => r.resource || '—' },
    { key: 'type', header: 'Billing type', render: (r) => r.rate_type },
    { key: 'rate', header: 'Rate', render: (r) => money(r.rate, r.currency) },
    { key: 'from', header: 'Effective from', render: (r) => r.effective_from },
    { key: 'actions', header: '', render: (r) => <button type="button" className="btn-ghost inline-flex items-center gap-1 text-danger-600" onClick={() => removeRate(r)}><Trash2 className="h-3.5 w-3.5" /> Remove</button> },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Finance</p>
        <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Billing setup per resource</h2>
        <p className="mt-1 text-sm text-tertiary-500">One project can bill Developer A monthly and Developer B hourly in the same month. Monthly resources are billed by their attendance / leave status; hourly ones by approved hours.</p>
        <div className="mt-3 max-w-md"><SearchableSelect value={accountId} onChange={setAccountId} options={projects.map((p) => ({ value: p.id, label: p.code ? `${p.name} · ${p.code}` : p.name, hint: p.client_name || undefined }))} placeholder="Select a project" /></div>
      </div>
      {accountId && (
        <>
          <section className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4">
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Resource rates</h3>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs font-medium text-tertiary-600">Apply the project rate to everyone allocated, from
                <input type="date" value={applyFrom} onChange={(e) => setApplyFrom(e.target.value)} className="ml-2 rounded-xl border px-3 py-1.5 text-sm" />
              </label>
              <button type="button" className="btn-secondary" onClick={applyProjectRate}>Apply project rate</button>
            </div>
            <form onSubmit={addRate} className="grid gap-2 sm:grid-cols-5">
              <div className="sm:col-span-2 text-xs font-medium text-tertiary-600">Resource<div className="mt-1"><SearchableSelect value={form.org_membership_id} onChange={(v) => setForm((f) => ({ ...f, org_membership_id: v }))} options={members} placeholder="Select resource" required /></div></div>
              <label className="text-xs font-medium text-tertiary-600">Billing type
                <select value={form.rate_type} onChange={(e) => setForm((f) => ({ ...f, rate_type: e.target.value }))} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm"><option value="monthly">Monthly</option><option value="hourly">Hourly</option></select>
              </label>
              <label className="text-xs font-medium text-tertiary-600">Rate
                <input required type="number" min="1" step="0.01" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-medium text-tertiary-600">From
                <input required type="date" value={form.effective_from} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm" />
              </label>
              <div className="sm:col-span-5"><button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={!form.org_membership_id || !form.rate}><Plus className="h-4 w-4" /> Add resource rate</button></div>
            </form>
            <DataTable columns={columns} rows={rates} emptyLabel="No resource-specific rates - everyone is billed on the project's rate" />
          </section>
          {rules && (
            <form onSubmit={saveRules} className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4">
              <h3 className="font-heading text-sm font-semibold text-tertiary-900">Client billing status rules</h3>
              <p className="text-xs text-tertiary-500">The share of a working day&apos;s rate billed to the client for each status (0 = not billed, 1 = full day). These are the client&apos;s rules; they never change employee salary.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <label key={key} className="text-xs font-medium text-tertiary-600">{label}
                    <input type="number" min="0" max="1" step="0.05" value={rules.rules[key]} onChange={(e) => setRules((r) => ({ ...r, rules: { ...r.rules, [key]: e.target.value } }))} className="mt-1 block w-full rounded-xl border px-3 py-2 text-sm" />
                  </label>
                ))}
              </div>
              <button type="submit" className="btn-primary">Save rules</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
