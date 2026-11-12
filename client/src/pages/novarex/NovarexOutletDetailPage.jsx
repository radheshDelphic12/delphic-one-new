import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Pencil } from 'lucide-react';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { useNovarex, nxCan } from '../../lib/novarex/useNovarex.js';
import { useNxPickers } from '../../lib/novarex/pickers.js';
import { INVESTMENT_STATUS_META, SITE_STATUS_META, TX_LABEL, TX_TONE, inr } from '../../lib/novarex/meta.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import ChartCard from '../../components/ui/ChartCard.jsx';
import NxFilterBar, { useNxFilters } from '../../components/novarex/NxFilters.jsx';
import { ExpenseTrendChart, IncomeChart, InvestmentFlowChart, NetTrendChart, ProjectedActualChart } from '../../components/novarex/NxCharts.jsx';
import { Detail, Kpi, Money, card } from '../../components/novarex/ui.jsx';
import { OutletForm } from './NovarexOutletsPage.jsx';

/** One outlet: its profile, its own financial dashboard for the chosen period, and its investments and transactions. */
export default function NovarexOutletDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me, loading } = useNovarex();
  const { pushError } = useAlerts();
  const pickers = useNxPickers({ people: false });
  const filters = useNxFilters({ preset: 'last_6', fyStart: me?.fy_start_month || 4 });
  const { params, key } = filters;
  const [outlet, setOutlet] = useState(null);
  const [edit, setEdit] = useState(false);
  const loadOutlet = useCallback(() => nxApi.outlet(id).then(setOutlet, (e) => pushError(novarexError(e, 'Could not load the outlet'), 'Load failed')), [id, pushError]);
  useEffect(() => { if (me) loadOutlet(); }, [me, loadOutlet]);
  const dash = useLiveData(() => nxApi.outletDashboard(id, params), { enabled: Boolean(me), intervalMs: 60000, deps: [id, key] });
  const invs = useLiveData(() => nxApi.investments({ outlet_id: id, limit: 100 }), { enabled: Boolean(me), deps: [id] });
  const txs = useLiveData(() => nxApi.transactions({ ...params, outlet_id: id, limit: 25 }), { enabled: Boolean(me), deps: [id, key] });
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'outlets')) return <Navigate to="/novarex" replace />;
  const d = dash.data;
  const p = d?.period;
  const canSalary = nxCan(me, 'payroll');
  const invColumns = [
    { key: 'name', header: 'Investment', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}</span></span> },
    { key: 'date', header: 'Date', render: (r) => dateLabel(r.investment_date) },
    { key: 'amount', header: 'Invested', render: (r) => <Money v={r.amount} /> },
    { key: 'pr', header: 'Principal back', render: (r) => <Money v={r.principal_returned} /> },
    { key: 'earn', header: 'Earnings', render: (r) => <Money v={r.earnings} /> },
    { key: 'out', header: 'Outstanding', render: (r) => <Money v={r.outstanding_principal} /> },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={INVESTMENT_STATUS_META[r.status]?.tone}>{INVESTMENT_STATUS_META[r.status]?.label}</Pill> },
  ];
  const txColumns = [
    { key: 'date', header: 'Date', render: (r) => dateLabel(r.date) },
    { key: 'type', header: 'Type', render: (r) => <Pill tone={TX_TONE[r.type]}>{TX_LABEL[r.type]}</Pill> },
    { key: 'desc', header: 'Details', render: (r) => r.description || r.party || r.person || '-' },
    { key: 'cat', header: 'Category', render: (r) => r.category || '-' },
    { key: 'amount', header: 'Amount', render: (r) => <span className={r.direction === 'in' ? 'font-medium text-emerald-700' : ''}>{r.direction === 'in' ? '+ ' : r.direction === 'out' ? '- ' : ''}<Money v={r.amount} /></span> },
  ];
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline" onClick={() => navigate('/novarex/outlets')}><ArrowLeft className="h-4 w-4" />All outlets</button>
        {outlet && nxCan(me, 'outletsEdit') && <button type="button" className="btn-secondary ml-auto inline-flex items-center gap-1.5" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Edit outlet</button>}
      </div>

      {outlet && (
        <section className={card} aria-label="Outlet profile">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="flex flex-wrap items-center gap-2 font-heading text-xl font-bold text-tertiary-900">{outlet.name}<Pill tone={SITE_STATUS_META[outlet.status]?.tone}>{SITE_STATUS_META[outlet.status]?.label}</Pill></h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-tertiary-600"><MapPin className="h-4 w-4" />{[outlet.location, outlet.district, outlet.state, outlet.country].filter(Boolean).join(', ') || 'Location not set'}{outlet.latitude !== null && outlet.longitude !== null && <a className="ml-2 text-xs text-primary-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${outlet.latitude},${outlet.longitude}`}>Map</a>}</p>
            </div>
            <span className="rounded-lg bg-tertiary-50 px-2.5 py-1 text-xs font-medium text-tertiary-700">{outlet.code}</span>
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Ownership type">{outlet.ownership_type?.name || '-'}</Detail>
            <Detail label="Primary format">{outlet.format?.name || '-'}</Detail>
            <Detail label="tags">{outlet.tags.join(', ') || '-'}</Detail>
            <Detail label="Outlet manager">{outlet.manager_name || '-'}</Detail>
            <Detail label="Started">{outlet.start_date ? dateLabel(outlet.start_date) : '-'}</Detail>
            <Detail label="Expected closure">{outlet.expected_closure_date ? dateLabel(outlet.expected_closure_date) : '-'}</Detail>
            <Detail label="Records">{outlet.counts.investments} investments · {outlet.counts.entries} entries · {outlet.counts.projections} projections</Detail>
            {outlet.archived_at && <Detail label="Closed on">{dateLabel(outlet.archived_at)}</Detail>}
          </dl>
          {outlet.description && <p className="mt-3 text-sm text-tertiary-700">{outlet.description}</p>}
          {outlet.notes && <p className="mt-1 text-xs text-tertiary-500">{outlet.notes}</p>}
        </section>
      )}

      <NxFilterBar filters={filters} pickers={pickers} fields={['income_category_id', 'expense_category_id', 'payment_status']} searchPlaceholder="Search this outlet's records..." />

      {!p ? <div className="py-8 text-center text-sm text-tertiary-500">{dash.loading ? 'Loading...' : 'No data.'}</div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Capital invested (period)" value={<Money v={p.investment_added} />} hint={`${inr(d.cumulative.investment_added)} all time`} />
            <Kpi label="Principal recovered" value={<Money v={p.principal_returned} />} hint={`${inr(d.cumulative.principal_returned)} all time · not income`} />
            <Kpi label="Sales revenue / other income" value={<Money v={p.other_income} />} hint="Sales and business income" tone="text-emerald-700" />
            <Kpi label="Investment earnings" value={<Money v={p.investment_earnings} />} hint="Profit on top of the principal" tone="text-emerald-700" />
            <Kpi label="Outlet expenses" value={<Money v={p.expenses_ex_salary} />} hint={`Operating ${inr(p.operating_expenses)} · other ${inr(p.other_expenses)}`} />
            <Kpi label="Salaries" value={p.salaries === null ? <span className="text-tertiary-400">Restricted</span> : <Money v={p.salaries} />} hint={p.salaries === null ? 'Payroll is visible to finance and admin' : 'Salaries booked to this outlet'} />
            <Kpi label="Net profit / loss" value={<Money v={p.net_result} signed />} hint="Income less expenses; capital and principal excluded" tone={p.net_result < 0 ? 'text-red-600' : 'text-emerald-700'} />
            <Kpi label="Principal still invested" value={<Money v={d.position.outstanding_principal} />} hint={`Expected returns still to come ${inr(d.position.expected_returns_outstanding)}`} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Capital placed vs principal recovered" subtitle="By month"><InvestmentFlowChart rows={d.trend} /></ChartCard>
            <ChartCard title="Revenue and earnings" subtitle="By month"><IncomeChart rows={d.trend} /></ChartCard>
            <ChartCard title="Outlet expenses and salaries" subtitle="By month"><ExpenseTrendChart rows={d.trend} showSalary={canSalary} /></ChartCard>
            <ChartCard title="Profit / loss" subtitle="Net result by month"><NetTrendChart rows={d.trend} /></ChartCard>
            <ChartCard title="Projected vs actual revenue" subtitle="Plan is dashed; it is an estimate, never a transaction"><ProjectedActualChart rows={d.projected_by_month} side="income" /></ChartCard>
            <ChartCard title="Projected vs actual expenses" subtitle="Spending above the plan is unfavourable"><ProjectedActualChart rows={d.projected_by_month} side="expenses" /></ChartCard>
          </div>
        </div>
      )}

      <section className={card} aria-label="Investments of this outlet">
        <div className="mb-2 flex items-center justify-between"><h3 className="font-heading text-sm font-semibold text-tertiary-900">Investments in this outlet</h3><Link to="/novarex/investments" className="text-xs font-medium text-primary-700 hover:underline">Manage investments</Link></div>
        <DataTable columns={invColumns} rows={invs.data?.data || []} loading={invs.loading && !invs.data} emptyLabel="No investments are linked to this outlet." maxHeight="40vh" />
      </section>
      <section className={card} aria-label="Transactions of this outlet">
        <div className="mb-2 flex items-center justify-between"><h3 className="font-heading text-sm font-semibold text-tertiary-900">Transactions (selected period)</h3><Link to="/novarex/transactions" className="text-xs font-medium text-primary-700 hover:underline">Full register</Link></div>
        <DataTable columns={txColumns} rows={(txs.data?.data || []).filter((r) => canSalary || r.type !== 'salary')} loading={txs.loading && !txs.data} emptyLabel="No transactions for this outlet in the period." maxHeight="40vh" />
      </section>

      <Drawer open={edit} onClose={() => setEdit(false)} size="lg" tone="edit" title={outlet ? `Edit ${outlet.name}` : 'Edit outlet'}>
        {edit && outlet && <OutletForm key={outlet.id} initial={outlet} pickers={pickers} canEdit={nxCan(me, 'outletsEdit')} onCancel={() => setEdit(false)} onSaved={() => { setEdit(false); loadOutlet(); dash.refresh(); }} />}
      </Drawer>
    </div>
  );
}
