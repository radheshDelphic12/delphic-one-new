import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Building, CalendarClock, HardHat, Plus, Repeat } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, dateLabel, isoDate, money, shortMonth, titleCase } from '../../lib/format.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Pill from '../../components/ui/Pill.jsx';

const KIND_OPTIONS = [
  { value: 'recurring', label: 'Recurring revenue' },
  { value: 'construction', label: 'Construction' },
  { value: 'service', label: 'Service' },
];
const FREQ_OPTIONS = ['one_time', 'monthly', 'quarterly', 'annual'].map((v) => ({ value: v, label: titleCase(v) }));
const NEXT_STATUS = { draft: [['active', 'Activate'], ['terminated', 'Terminate']], active: [['completed', 'Complete'], ['terminated', 'Terminate']] };

function ProgressBar({ percent }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Progress ${percent}%`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-tertiary-100"><div className="h-full bg-primary-500" style={{ width: `${percent}%` }} /></div>
      <span className="text-xs text-tertiary-600">{percent}%</span>
    </div>
  );
}

export default function ContractsPage() {
  const { user } = useAuth();
  const modules = user?.active_org?.enabled_modules || [];
  const isAdmin = user?.role === 'admin';
  const { pushError, pushSuccess } = useAlerts();
  const [filters, setFilters] = useState({ kind: '', status: '' });
  const [create, setCreate] = useState(false);
  const [progressFor, setProgressFor] = useState(null);
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const list = useLiveData(() => apiClient.get('/contracts', { params: { limit: 100, ...params } }).then((r) => r.data.data), { deps: [filters.kind, filters.status] });
  const summary = useLiveData(() => apiClient.get('/contracts/summary').then((r) => r.data.data));
  const projects = useLiveData(() => apiClient.get('/projects', { params: { limit: 100 } }).then((r) => r.data.data), { enabled: modules.includes('projects') && isAdmin });

  function refresh() {
    list.refresh();
    summary.refresh();
  }
  async function guarded(fn, message) {
    try {
      await fn();
      pushSuccess(message);
      refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Request failed'), 'Could not save');
      throw err;
    }
  }

  const s = summary.data;
  const schedule = (s?.schedule || []).map((m) => ({ ...m, label: shortMonth(m.month) }));

  const cols = [
    { key: 'title', header: 'Contract', render: (r) => <div><p className="font-medium text-tertiary-900">{r.title}</p><p className="text-xs text-tertiary-500">{r.counterparty_name}</p></div> },
    { key: 'kind', header: 'Type', render: (r) => <Pill tone="purple">{titleCase(r.kind)}</Pill> },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.status} /> },
    { key: 'value', header: 'Value / MRR', render: (r) => (r.kind === 'recurring' ? <span>{money(r.monthly_equivalent)}<span className="text-xs text-tertiary-500"> /mo</span></span> : money(r.value)) },
    { key: 'progress', header: 'Progress', render: (r) => (r.kind === 'construction' ? <div><ProgressBar percent={r.progress_percent} /><p className="text-xs text-tertiary-500">Billed {money(r.billed_to_date)}{r.outstanding !== null ? `, ${money(r.outstanding)} left` : ''}</p></div> : '-') },
    { key: 'project', header: 'Project', render: (r) => (r.project ? <Link className="text-primary-700 hover:underline" to={`/projects/${r.project.id}`} onClick={(e) => e.stopPropagation()}>{r.project.name}</Link> : '-') },
    { key: 'dates', header: 'Term', render: (r) => `${dateLabel(r.start_date)} - ${r.end_date ? dateLabel(r.end_date) : 'ongoing'}` },
    ...(isAdmin ? [{ key: 'actions', header: '', render: (r) => (
      <span className="flex flex-wrap gap-2">
        {(NEXT_STATUS[r.status] || []).map(([status, label]) => (
          <button key={status} type="button" className={`text-xs font-medium hover:underline ${status === 'terminated' ? 'text-red-600' : 'text-primary-700'}`} onClick={() => guarded(() => apiClient.post(`/contracts/${r.id}/status`, { status }), `Contract ${status}`)}>{label}</button>
        ))}
        {r.status !== 'completed' && r.status !== 'terminated' && r.kind === 'construction' && <button type="button" className="text-xs font-medium text-tertiary-700 hover:underline" onClick={() => setProgressFor(r)}>Update progress</button>}
      </span>
    ) }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Monthly recurring revenue" value={money(s?.mrr)} hint={s ? `ARR ${money(s.arr)}` : undefined} icon={Repeat} theme="green" />
        <KpiCard label="Active recurring contracts" value={s?.recurring_contracts ?? 0} icon={Building} theme="blue" />
        <KpiCard label="Construction outstanding" value={money(s?.construction.outstanding)} hint={s ? `${s.construction.active} active, avg ${s.construction.avg_progress}%` : undefined} icon={HardHat} theme="orange" />
        <KpiCard label="Ending in 60 days" value={s?.expiring_soon.length ?? 0} icon={CalendarClock} theme={s?.expiring_soon.length ? 'red' : 'purple'} />
      </div>

      <ChartCard title="Expected recurring revenue, next 12 months" subtitle="Active recurring contracts, normalised to a monthly amount. Contracts that end drop out.">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={schedule} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => money(v)} />
              <Bar dataKey="expected_revenue" name="Expected revenue" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3">
          <select value={filters.kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Type"><option value="">All types</option>{KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Status"><option value="">All statuses</option>{['draft', 'active', 'completed', 'terminated'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</select>
        </div>
        {isAdmin && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setCreate(true)}><Plus className="h-4 w-4" />New contract</button>}
      </div>
      <DataTable columns={cols} rows={list.data || []} loading={list.loading} emptyLabel="No contracts yet" />

      <FormDrawer open={create} onClose={() => setCreate(false)} title="New contract" size="lg" submitLabel="Create draft"
        onSubmit={(v) => guarded(() => apiClient.post('/contracts', v), 'Contract drafted')}
        fields={[
          { name: 'kind', label: 'Type', type: 'select', required: true, default: modules.includes('projects') ? 'construction' : 'recurring', options: KIND_OPTIONS },
          { name: 'title', label: 'Title', required: true },
          { name: 'counterparty_name', label: 'Client / counterparty', required: true },
          { name: 'project_id', label: 'Self project', type: 'search', show: (v) => v.kind === 'construction' && modules.includes('projects'), options: (projects.data || []).map((p) => ({ value: p.id, label: p.name })), hint: 'optional' },
          { name: 'value', label: 'Contract value', type: 'number', min: 0, show: (v) => v.kind !== 'recurring' },
          { name: 'billing_frequency', label: 'Billing', type: 'select', required: true, default: 'monthly', options: FREQ_OPTIONS, show: (v) => v.kind === 'recurring' },
          { name: 'recurring_amount', label: 'Amount per billing period', type: 'number', min: 0, required: true, show: (v) => v.kind === 'recurring' },
          { name: 'start_date', label: 'Start date', type: 'date', required: true, default: isoDate() },
          { name: 'end_date', label: 'End date', type: 'date', hint: 'blank = ongoing' },
          { name: 'site_location', label: 'Site location', show: (v) => v.kind === 'construction' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ]} />

      <FormDrawer open={Boolean(progressFor)} onClose={() => setProgressFor(null)} title={`Progress: ${progressFor?.title || ''}`} tone="edit" submitLabel="Update"
        initial={{ progress_percent: progressFor?.progress_percent, billed_to_date: progressFor?.billed_to_date }}
        onSubmit={(v) => guarded(() => apiClient.patch(`/contracts/${progressFor.id}`, v), 'Progress updated')}
        fields={[
          { name: 'progress_percent', label: 'Work completed (%)', type: 'number', min: 0, required: true },
          { name: 'billed_to_date', label: 'Billed to date', type: 'number', min: 0, required: true, hint: `contract value ${money(progressFor?.value)}` },
        ]} />
    </div>
  );
}
