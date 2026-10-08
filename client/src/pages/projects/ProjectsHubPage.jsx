import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, FileText, FolderKanban, Plus, TrendingUp, Wallet } from 'lucide-react';
import apiClient, { openAuthenticatedFile } from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { dateLabel, money, titleCase } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';

const TABS = [
  { key: 'projects', label: 'Self projects', icon: FolderKanban },
  { key: 'documents', label: 'Legal & site documents', icon: FileText },
];

export const PROJECT_FIELDS = [
  { name: 'name', label: 'Project name', required: true },
  { name: 'project_type', label: 'Project type', hint: 'residential, commercial...' },
  { name: 'location', label: 'Location' },
  { name: 'investor_name', label: 'Investor' },
  { name: 'customer_deal_ref', label: 'Customer deal' },
  { name: 'budget', label: 'Budget', type: 'number', min: 0 },
  { name: 'start_date', label: 'Start date', type: 'date' },
  { name: 'end_date', label: 'Planned end', type: 'date' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

function ProjectsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [create, setCreate] = useState(false);
  const list = useLiveData(() => apiClient.get('/projects', { params: { limit: 100, ...(status ? { status } : {}) } }).then((r) => r.data.data), { deps: [status] });
  const summary = useLiveData(() => apiClient.get('/projects/summary').then((r) => r.data.data));

  async function createProject(values) {
    try {
      const res = await apiClient.post('/projects', values);
      pushSuccess('Project created');
      navigate(`/projects/${res.data.data.id}`);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to create project'), 'Could not save');
      throw err;
    }
  }

  const s = summary.data;
  const cols = [
    { key: 'name', header: 'Project', render: (r) => <Link className="font-medium text-primary-700 hover:underline" to={`/projects/${r.id}`}>{r.name}</Link> },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.status} /> },
    { key: 'basis', header: 'Investor / deal', render: (r) => r.investor_name || r.customer_deal_ref || r.project_type || '-' },
    { key: 'location', header: 'Location', render: (r) => r.location || '-' },
    { key: 'budget', header: 'Budget', render: (r) => (r.budget ? money(r.budget) : '-') },
    { key: 'revenue', header: 'Revenue', render: (r) => money(r.revenue) },
    { key: 'total_cost', header: 'Cost', render: (r) => money(r.total_cost) },
    { key: 'net', header: 'Net', render: (r) => <span className={r.net < 0 ? 'font-medium text-red-600' : 'font-medium text-green-700'}>{money(r.net)}</span> },
    { key: 'used', header: 'Budget used', render: (r) => (r.budget_used_percent === null ? '-' : <Pill tone={r.budget_used_percent > 100 ? 'red' : r.budget_used_percent > 85 ? 'amber' : 'green'}>{`${r.budget_used_percent}%`}</Pill>) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Projects" value={s?.projects ?? 0} hint={s ? `${s.by_status.active} active` : undefined} icon={FolderKanban} theme="blue" />
        <KpiCard label="Revenue booked" value={money(s?.revenue)} icon={TrendingUp} theme="green" />
        <KpiCard label="Cost (expense, salary, other)" value={money(s?.total_cost)} icon={Wallet} theme="orange" />
        <KpiCard label="Net position" value={money(s?.net)} hint={s?.total_budget ? `Budget ${money(s.total_budget)}` : undefined} icon={TrendingUp} theme={(s?.net || 0) < 0 ? 'red' : 'purple'} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Status"><option value="">All statuses</option>{['planning', 'active', 'on_hold', 'completed', 'cancelled'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</select>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setCreate(true)}><Plus className="h-4 w-4" />New self project</button>
      </div>
      <DataTable columns={cols} rows={list.data || []} loading={list.loading} onRowClick={(r) => navigate(`/projects/${r.id}`)} emptyLabel="No self projects yet" />
      <FormDrawer open={create} onClose={() => setCreate(false)} title="New self project" size="lg" submitLabel="Create" onSubmit={createProject} fields={PROJECT_FIELDS} />
    </div>
  );
}

function DocumentsTab() {
  const { pushError } = useAlerts();
  const [category, setCategory] = useState('');
  const { data, loading } = useLiveData(() => apiClient.get('/projects/documents/register', { params: category ? { category } : {} }).then((r) => r.data.data), { deps: [category] });
  const cols = [
    { key: 'title', header: 'Document', render: (r) => <span className="font-medium">{r.title}</span> },
    { key: 'category', header: 'Category', render: (r) => <Pill tone="purple">{titleCase(r.category)}</Pill> },
    { key: 'project', header: 'Project', render: (r) => <Link className="text-primary-700 hover:underline" to={`/projects/${r.project.id}`} onClick={(e) => e.stopPropagation()}>{r.project.name}</Link> },
    { key: 'reference_no', header: 'Reference', render: (r) => r.reference_no || '-' },
    { key: 'expires_on', header: 'Expires', render: (r) => (r.expires_on ? dateLabel(r.expires_on) : '-') },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.status} /> },
    { key: 'file', header: 'File', render: (r) => (r.file_url ? <button type="button" className="text-primary-700 hover:underline" onClick={(e) => { e.stopPropagation(); openAuthenticatedFile(r.file_url).catch((err) => pushError(err.message, 'Could not open file')); }}>Open</button> : <span className="text-tertiary-400">Not uploaded</span>) },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label="Documents tracked" value={data?.counts.total ?? 0} icon={FileText} theme="blue" />
        <KpiCard label="Expiring within 30 days" value={data?.counts.expiring_soon ?? 0} icon={AlertTriangle} theme="orange" />
        <KpiCard label="Expired" value={data?.counts.expired ?? 0} icon={AlertTriangle} theme={data?.counts.expired ? 'red' : 'green'} />
      </div>
      <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Category"><option value="">All categories</option>{['legal', 'site', 'permit', 'approval', 'title', 'other'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</select>
      <DataTable columns={cols} rows={data?.documents || []} loading={loading} emptyLabel="No legal or site documents tracked yet" />
    </div>
  );
}

export default function ProjectsHubPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'projects';
  const section = TABS.some((t) => t.key === requested) ? requested : 'projects';
  return (
    <div className="space-y-4">
      <SectionTabs tabs={TABS} value={section} onChange={(key) => setParams({ section: key })} />
      {section === 'projects' ? <ProjectsTab /> : <DocumentsTab />}
    </div>
  );
}
