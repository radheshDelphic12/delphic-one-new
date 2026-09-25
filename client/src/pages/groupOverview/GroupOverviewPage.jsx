import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Building2, Network, PiggyBank, Plus, Receipt, TrendingUp, Users2, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import OrgChartPage from '../orgChart/OrgChartPage.jsx';
import ProjectionsTab from './ProjectionsTab.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];

const GROUP_BY_OPTIONS = [
  { value: 'day', label: 'Daily' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
];

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function defaultRangeFor(groupBy) {
  const to = new Date();
  const from = new Date(to);
  if (groupBy === 'day') from.setDate(from.getDate() - 30);
  else if (groupBy === 'month') from.setMonth(from.getMonth() - 6);
  else if (groupBy === 'quarter') from.setMonth(from.getMonth() - 12);
  else from.setFullYear(from.getFullYear() - 3);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function SubsidiaryTile({ tile, editable, onOpen, onSaveValuation }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tile.valuation ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSaveValuation(tile.org.id, value === '' ? null : Number(value));
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card transition-shadow hover:shadow-cardHover">
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => onOpen(tile.org)}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-50 text-primary-700">
          {tile.org.logo_url ? <img src={tile.org.logo_url} alt="" className="h-full w-full object-contain" /> : <Building2 className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold text-tertiary-900">{tile.org.name}</p>
          <p className="text-xs text-tertiary-500">{tile.headcount} people · open ERP →</p>
        </div>
      </button>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-tertiary-400">Revenue (30d)</dt><dd className="font-medium text-tertiary-800">{tile.org.default_currency} {money(tile.trailing_30d.revenue)}</dd></div>
        <div><dt className="text-tertiary-400">Margin (30d)</dt><dd className={`font-medium ${tile.trailing_30d.margin < 0 ? 'text-danger-600' : 'text-success-700'}`}>{tile.org.default_currency} {money(tile.trailing_30d.margin)}</dd></div>
        <div><dt className="text-tertiary-400">Expenses (30d)</dt><dd className="font-medium text-tertiary-800">{tile.org.default_currency} {money(tile.trailing_30d.expenses)}</dd></div>
        <div><dt className="text-tertiary-400">Vendor pay (30d)</dt><dd className="font-medium text-tertiary-800">{tile.org.default_currency} {money(tile.trailing_30d.vendor_payments)}</dd></div>
      </dl>
      <div className="mt-3 flex items-center justify-between border-t border-tertiary-100 pt-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-tertiary-400">Valuation</span>
        {editing ? (
          <div className="flex items-center gap-1">
            <input autoFocus type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} className="w-28 rounded-lg border px-2 py-1 text-xs" />
            <button type="button" className="btn-ghost text-xs" disabled={saving} onClick={save}>{saving ? '…' : 'Save'}</button>
          </div>
        ) : (
          <button type="button" className={`text-sm font-semibold ${editable ? 'text-primary-700 hover:underline' : 'text-tertiary-700'}`} onClick={() => editable && setEditing(true)}>
            {tile.valuation ? `${tile.org.default_currency} ${money(tile.valuation)}` : editable ? 'Set valuation' : 'Not set'}
          </button>
        )}
      </div>
    </div>
  );
}

function GroupDashboardTab() {
  const { switchOrg } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const navigate = useNavigate();
  const [subsidiaries, setSubsidiaries] = useState(null);
  const [groupBy, setGroupBy] = useState('month');
  const [rollup, setRollup] = useState(null);
  const [loading, setLoading] = useState(true);

  function loadSubsidiaries() {
    apiClient.get('/super-dashboard/subsidiaries').then(({ data }) => setSubsidiaries(data.data)).catch((err) => pushError(apiErrorMessage(err, 'Failed to load subsidiaries'), 'Something went wrong'));
  }

  useEffect(() => { loadSubsidiaries(); }, []);

  useEffect(() => {
    setLoading(true);
    const { from, to } = defaultRangeFor(groupBy);
    apiClient
      .get('/super-dashboard/financials-rollup', { params: { from, to, group_by: groupBy } })
      .then(({ data }) => setRollup(data.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the group rollup'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [groupBy]);

  const totals = useMemo(() => {
    if (!subsidiaries) return null;
    return subsidiaries.reduce(
      (acc, tile) => ({
        headcount: acc.headcount + tile.headcount,
        revenue: acc.revenue + tile.trailing_30d.revenue,
        margin: acc.margin + tile.trailing_30d.margin,
        valuation: acc.valuation + (Number(tile.valuation) || 0),
        anyValuation: acc.anyValuation || tile.valuation !== null,
      }),
      { headcount: 0, revenue: 0, margin: 0, valuation: 0, anyValuation: false }
    );
  }, [subsidiaries]);

  async function openCompany(org) {
    try {
      await switchOrg(org.id);
      navigate('/');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to open that company'), 'Something went wrong');
    }
  }

  async function saveValuation(orgId, value) {
    try {
      await apiClient.patch(`/orgs/${orgId}/valuation`, { valuation: value });
      pushInfo('Valuation updated');
      loadSubsidiaries();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update valuation'), 'Something went wrong');
      throw err;
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Companies" value={subsidiaries?.length ?? '—'} icon={Building2} theme="blue" />
        <KpiCard label="Group headcount" value={totals ? totals.headcount : '—'} icon={Users2} theme="purple" />
        <KpiCard label="Revenue (30d, all cos.)" value={totals ? money(totals.revenue) : '—'} icon={Wallet} theme="green" />
        <KpiCard label="Group valuation" value={totals?.anyValuation ? money(totals.valuation) : 'Not set'} icon={PiggyBank} theme="orange" />
      </div>

      <ChartCard
        title="Revenue vs. expense"
        subtitle="Group-wide — margin nets revenue against employee cost; net also deducts approved expenses and vendor payments"
        action={
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="rounded-lg border px-2 py-1 text-xs">
            {GROUP_BY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        }
      >
        {loading && <Skeleton className="h-64 w-full" />}
        {!loading && (!rollup || rollup.length === 0) && (
          <EmptyState title="No financial data yet" description="Run profitability compute and approve some expenses to see this chart." />
        )}
        {!loading && rollup?.length > 0 && (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rollup} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill={CHART_COLORS.warning} radius={[4, 4, 0, 0]} />
                <Bar dataKey="vendor_payments" name="Vendor payments" fill={CHART_COLORS.muted} radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="net" name="Net" stroke={CHART_COLORS.success} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      <div>
        <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Subsidiaries</h3>
        {!subsidiaries && <Skeleton className="h-32 w-full" />}
        {subsidiaries?.length === 0 && <EmptyState icon={Building2} title="No subsidiaries yet" description="Create a second organization from the header's + button to see it here." />}
        {subsidiaries?.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {subsidiaries.map((tile) => (
              <SubsidiaryTile key={tile.org.id} tile={tile} editable onOpen={openCompany} onSaveValuation={saveValuation} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
  { key: 'dashboard', label: 'Dashboard', icon: Building2 },
  { key: 'projections', label: 'Projections & Valuation', icon: TrendingUp },
  { key: 'org-chart', label: 'Org Chart', icon: Network },
  { key: 'group-charges', label: 'Billing Charges', icon: Receipt },
];

/** Group Overview — visible only to org-group superadmins (gated in navItems.js / AppLayout). */
export default function GroupOverviewPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'dashboard';
  const section = TABS.some((t) => t.key === requested) ? requested : 'dashboard';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" role="tab" aria-selected={section === key} className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${section === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => setParams({ section: key })}>
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {section === 'dashboard' && <GroupDashboardTab />}
      {section === 'projections' && <ProjectionsTab />}
      {section === 'org-chart' && <GroupOrgChartTab />}
      {section === 'group-charges' && <GroupChargesTab />}
    </div>
  );
}
