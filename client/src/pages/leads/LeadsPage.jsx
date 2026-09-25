import { useState } from 'react';
import { Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { isoDate, money, titleCase } from '../../lib/format.js';
import Drawer from '../../components/ui/Drawer.jsx';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { Briefcase, Percent, Repeat, Target } from 'lucide-react';

const STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
const CATEGORIES = [
  { value: 'self_project', label: 'Self project' },
  { value: 'client_project', label: 'Client project' },
  { value: 'other', label: 'Other' },
];
const BASIS_LABEL = { investor: 'Investor', customer_deal: 'Customer deal', project_type: 'Project type' };

function basisText(lead) {
  if (lead.category !== 'self_project') return null;
  const value = lead.self_project_basis === 'investor' ? lead.investor_name : lead.self_project_basis === 'customer_deal' ? lead.customer_deal_ref : lead.project_type;
  return `${BASIS_LABEL[lead.self_project_basis] || 'Basis'}: ${value || '-'}`;
}

export function leadFields(modules) {
  return [
    { name: 'name', label: 'Lead / project name', required: true },
    { name: 'category', label: 'Category', type: 'select', required: true, default: modules.includes('projects') ? 'self_project' : 'other', options: CATEGORIES },
    { name: 'self_project_basis', label: 'Self project is based on', type: 'select', required: true, show: (v) => v.category === 'self_project', options: Object.entries(BASIS_LABEL).map(([value, label]) => ({ value, label })) },
    { name: 'investor_name', label: 'Investor', required: true, show: (v) => v.category === 'self_project' && v.self_project_basis === 'investor' },
    { name: 'customer_deal_ref', label: 'Customer deal', required: true, hint: 'deal name or reference', show: (v) => v.category === 'self_project' && v.self_project_basis === 'customer_deal' },
    { name: 'project_type', label: 'Project type', required: true, show: (v) => v.category === 'self_project' && v.self_project_basis === 'project_type' },
    { name: 'contact_name', label: 'Contact person' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone' },
    { name: 'source', label: 'Source' },
    { name: 'estimated_value', label: 'Estimated value', type: 'number', min: 0 },
    { name: 'expected_monthly', label: 'Expected monthly revenue', type: 'number', min: 0, hint: 'for recurring deals' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
}

export default function LeadsPage() {
  const { user } = useAuth();
  const modules = user?.active_org?.enabled_modules || [];
  const isAdmin = user?.role === 'admin';
  const { pushError, pushSuccess } = useAlerts();
  const [create, setCreate] = useState(false);
  const [convertLead, setConvertLead] = useState(null);
  const [category, setCategory] = useState('');
  const board = useLiveData(() => apiClient.get('/leads', { params: { limit: 100, ...(category ? { category } : {}) } }).then((r) => r.data.data), { deps: [category] });
  const summary = useLiveData(() => apiClient.get('/leads/summary').then((r) => r.data.data));

  function refresh() {
    board.refresh();
    summary.refresh();
  }

  async function createLead(values) {
    try {
      await apiClient.post('/leads', values);
      pushSuccess('Lead added');
      refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to add lead'), 'Could not save');
      throw err;
    }
  }

  async function move(lead, stage) {
    try {
      await apiClient.post(`/leads/${lead.id}/stage`, { stage });
      refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Stage change failed'), 'Could not move lead');
    }
  }

  const leads = board.data || [];
  const s = summary.data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Open pipeline value" value={money(s?.open_pipeline_value)} icon={Target} theme="blue" />
        <KpiCard label="Expected monthly (open)" value={money(s?.open_expected_monthly)} icon={Repeat} theme="green" />
        <KpiCard label="Win rate" value={s?.win_rate === null || s?.win_rate === undefined ? '-' : `${s.win_rate}%`} icon={Percent} theme="purple" />
        <KpiCard label="Total leads" value={s?.total ?? 0} icon={Briefcase} theme="orange" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Category">
          <option value="">All categories</option>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setCreate(true)}><Plus className="h-4 w-4" />New lead</button>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((stage) => {
          const column = leads.filter((l) => l.stage === stage);
          return (
            <section key={stage} className="rounded-2xl border border-tertiary-100 bg-tertiary-50/60 p-2.5">
              <header className="mb-2 flex items-center justify-between px-1"><Pill value={stage} /><span className="text-xs text-tertiary-500">{column.length}</span></header>
              <div className="space-y-2">
                {column.map((lead) => (
                  <article key={lead.id} className="rounded-xl border border-tertiary-100 bg-white p-2.5 shadow-card">
                    <h3 className="text-sm font-medium text-tertiary-900">{lead.name}</h3>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Pill tone={lead.category === 'self_project' ? 'purple' : 'gray'}>{titleCase(lead.category)}</Pill>
                    </div>
                    {basisText(lead) && <p className="mt-1 text-xs text-tertiary-600">{basisText(lead)}</p>}
                    {lead.estimated_value ? <p className="mt-1 text-xs text-tertiary-500">Value {money(lead.estimated_value)}</p> : null}
                    {lead.expected_monthly ? <p className="text-xs text-tertiary-500">Monthly {money(lead.expected_monthly)}</p> : null}
                    {lead.owner && <p className="text-xs text-tertiary-400">{lead.owner.name}</p>}
                    {stage !== 'won' && stage !== 'lost' && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select aria-label={`Move ${lead.name}`} value="" onChange={(e) => e.target.value && move(lead, e.target.value)} className="rounded-lg border px-1.5 py-1 text-xs">
                          <option value="">Move to...</option>
                          {STAGES.filter((st) => st !== 'new' && st !== stage).map((st) => <option key={st} value={st}>{titleCase(st)}</option>)}
                        </select>
                        {isAdmin && (modules.includes('contracts') || (modules.includes('projects') && lead.category === 'self_project')) && (
                          <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => setConvertLead(lead)}>Convert</button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <FormDrawer open={create} onClose={() => setCreate(false)} title="New lead" submitLabel="Add lead" onSubmit={createLead} fields={leadFields(modules)} size="lg" />
      <ConvertShell lead={convertLead} modules={modules} onClose={() => setConvertLead(null)} onDone={() => { setConvertLead(null); refresh(); }} />
    </div>
  );
}

// Thin wrapper so the conversion drawer can re-key when the target changes.
function ConvertShell({ lead, modules, onClose, onDone }) {
  return lead ? <ConvertDrawerBody lead={lead} modules={modules} onClose={onClose} onDone={onDone} /> : null;
}

function ConvertDrawerBody({ lead, modules, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const canProject = lead.category === 'self_project' && modules.includes('projects');
  const canContract = modules.includes('contracts');
  const [target, setTarget] = useState(canProject ? 'project' : 'contract');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ kind: 'recurring', start_date: isoDate(), billing_frequency: 'monthly', recurring_amount: '' });

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = target === 'project' ? { to: 'project' } : { to: 'contract', ...form, recurring_amount: form.recurring_amount ? Number(form.recurring_amount) : undefined };
      await apiClient.post(`/leads/${lead.id}/convert`, body);
      pushSuccess(target === 'project' ? 'Project created and lead marked won' : 'Contract drafted and lead marked won');
      onDone();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Conversion failed'), 'Could not convert');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={`Convert: ${lead.name}`} size="md" tone="info" footer={<><button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" form="convert-lead" className="btn-primary" disabled={saving}>{saving ? 'Converting...' : 'Convert'}</button></>}>
      <form id="convert-lead" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">Convert to
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
            {canProject && <option value="project">Self project</option>}
            {canContract && <option value="contract">Contract</option>}
          </select>
        </label>
        {target === 'project' ? (
          <p className="text-xs text-tertiary-500">Creates a self project prefilled from this lead (investor, deal, type, budget) and marks the lead won.</p>
        ) : (
          <>
            <label className="block text-xs font-medium text-tertiary-600">Contract type
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                <option value="recurring">Recurring revenue</option><option value="construction">Construction</option><option value="service">Service</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-tertiary-600">Start date<input required type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
            <label className="block text-xs font-medium text-tertiary-600">Billing
              <select value={form.billing_frequency} onChange={(e) => setForm({ ...form, billing_frequency: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                {['one_time', 'monthly', 'quarterly', 'annual'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-tertiary-600">Amount per billing period <span className="font-normal text-tertiary-400">(defaults to expected monthly)</span><input type="number" min="0" value={form.recurring_amount} onChange={(e) => setForm({ ...form, recurring_amount: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
            <p className="text-xs text-tertiary-500">Drafts the contract and marks the lead won. Activate it from Contracts.</p>
          </>
        )}
      </form>
    </Drawer>
  );
}
