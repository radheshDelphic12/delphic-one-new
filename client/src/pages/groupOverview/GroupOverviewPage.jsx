import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { Building2, Network, PiggyBank, Plus, Receipt, Settings, TrendingUp } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import OrgChartPage from '../orgChart/OrgChartPage.jsx';
import ProjectionsTab from './ProjectionsTab.jsx';
import GroupFinanceTab from './GroupFinanceTab.jsx';
import GroupDashboardTab from './GroupDashboardTab.jsx';
import GroupSettingsTab from './GroupSettingsTab.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function GroupOrgChartTab() {
  const { pushError } = useAlerts();
  const [orgs, setOrgs] = useState(null);

  useEffect(() => {
    apiClient.get('/org-chart/group').then(({ data }) => setOrgs(data.data)).catch((err) => pushError(apiErrorMessage(err, 'Failed to load the group org chart'), 'Something went wrong'));
  }, []);

  if (!orgs) return <Skeleton className="h-64 w-full" />;
  return <OrgChartPage groupOrgs={orgs} />;
}

function NewChargeDrawer({ open, orgs, onClose, onSubmit }) {
  const now = new Date();
  const [fields, setFields] = useState({ org_id: '', period_month: now.getMonth() + 1, period_year: now.getFullYear(), kind: '', amount: '', currency: 'INR' });
  const [saving, setSaving] = useState(false);
  const orgOptions = orgs.map((o) => ({ value: o.id, label: o.name }));

  useEffect(() => {
    if (open) setFields({ org_id: '', period_month: now.getMonth() + 1, period_year: now.getFullYear(), kind: '', amount: '', currency: 'INR' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function set(key, value) { setFields((current) => ({ ...current, [key]: value })); }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ ...fields, period_month: Number(fields.period_month), period_year: Number(fields.period_year), amount: Number(fields.amount) });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title="Raise intra-group charge" onClose={onClose} size="sm" tone="create" footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="group-charge-form" className="btn-primary" disabled={saving || !fields.org_id || !fields.kind.trim() || !fields.amount}>{saving ? 'Raising…' : 'Raise charge'}</button>
      </>
    }>
      <form id="group-charge-form" onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-tertiary-600">Charge to company</label>
          <SearchableSelect value={fields.org_id} onChange={(v) => set('org_id', v)} options={orgOptions} placeholder="Select subsidiary" searchPlaceholder="Search companies…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Month<input required type="number" min="1" max="12" value={fields.period_month} onChange={(e) => set('period_month', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">Year<input required type="number" value={fields.period_year} onChange={(e) => set('period_year', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        </div>
        <label className="block text-xs font-medium text-tertiary-600">Kind<input required value={fields.kind} onChange={(e) => set('kind', e.target.value)} placeholder="e.g. Shared infrastructure, seconded staff" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Amount<input required type="number" min="0" step="0.01" value={fields.amount} onChange={(e) => set('amount', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">Currency
            <select value={fields.currency} onChange={(e) => set('currency', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-tertiary-500">Records a cross-company service transfer for the group&apos;s books — e.g. a shared office or a seconded employee&apos;s cost passed through to the company that used it.</p>
      </form>
    </Drawer>
  );
}

/** Intra-group billing charges — raise a cross-company charge and see every charge raised across the group. Group-superadmin only. */
function GroupChargesTab() {
  const { pushError, pushInfo } = useAlerts();
  const [orgs, setOrgs] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function load() {
    setLoading(true);
    apiClient.get('/billing/group-charges/all').then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load group charges'), 'Something went wrong')).finally(() => setLoading(false));
  }
  useEffect(load, []);
  useEffect(() => {
    apiClient.get('/orgs').then(({ data }) => setOrgs(data.data || [])).catch(() => setOrgs([]));
  }, []);

  async function create(payload) {
    try {
      await apiClient.post('/billing/group-charges', payload);
      pushInfo('Charge raised');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to raise charge'), 'Something went wrong');
      throw err;
    }
  }

  const columns = [
    { key: 'org', header: 'Company', render: (row) => row.org?.name || '—' },
    { key: 'period', header: 'Period', render: (row) => `${MONTHS[row.period_month - 1] || row.period_month} ${row.period_year}` },
    { key: 'kind', header: 'Kind' },
    { key: 'amount', header: 'Amount', render: (row) => `${row.currency} ${money(row.amount)}` },
    { key: 'raised', header: 'Raised', render: (row) => new Date(row.created_at).toLocaleDateString() },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}><Plus className="h-4 w-4" /> Raise charge</button>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No intra-group charges yet" description="Raise a charge to pass a shared cost through to the company that used it." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No group charges." />
      )}
      <NewChargeDrawer open={drawerOpen} orgs={orgs} onClose={() => setDrawerOpen(false)} onSubmit={create} />
    </div>
  );
}

const TABS = [
  { key: 'finance', label: 'Group Finance', icon: PiggyBank },
  { key: 'dashboard', label: 'Dashboard', icon: Building2 },
  { key: 'projections', label: 'Projections & Valuation', icon: TrendingUp },
  { key: 'org-chart', label: 'Org Chart', icon: Network },
  { key: 'group-charges', label: 'Billing Charges', icon: Receipt },
  { key: 'settings', label: 'Settings', icon: Settings },
];

/** Group Overview — visible only to org-group superadmins (gated in navItems.js / AppLayout). */
export default function GroupOverviewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const requested = pathname === '/group-overview/settings' ? 'settings' : params.get('section') || 'finance';
  const section = TABS.some((t) => t.key === requested) ? requested : 'finance';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-5 overflow-hidden rounded-2xl bg-gradient-to-r from-[#1f3a2c] via-[#2f5d43] to-[#4f8f60] p-4 text-white shadow-card sm:p-5">
        <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-soft sm:h-28 sm:w-40">
          <img src="/group-logo.svg" alt="Gulati Industries" className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">Multi-organization group</p>
          <h2 className="font-heading text-xl font-bold tracking-tight sm:text-2xl">Gulati Industries</h2>
          <p className="mt-1 max-w-2xl text-sm text-white/80">One view of every company in the group: revenue, profit, assets and valuation side by side. Open any company from the sidebar to work inside it; the Group Dashboard link brings you back.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" role="tab" aria-selected={section === key} className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${section === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => navigate(key === 'settings' ? '/group-overview/settings' : `/group-overview?section=${key}`)}>
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {section === 'finance' && <GroupFinanceTab />}
      {section === 'dashboard' && <GroupDashboardTab />}
      {section === 'projections' && <ProjectionsTab />}
      {section === 'org-chart' && <GroupOrgChartTab />}
      {section === 'group-charges' && <GroupChargesTab />}
      {section === 'settings' && <GroupSettingsTab />}
    </div>
  );
}
