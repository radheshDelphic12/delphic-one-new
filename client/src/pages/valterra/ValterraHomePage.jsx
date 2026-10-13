import { useEffect, useMemo } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AlertTriangle, Landmark, Plus } from 'lucide-react';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { vtApi, valterraError } from '../../lib/valterra/api.js';
import { useValterra, vtCan } from '../../lib/valterra/useValterra.js';
import { useVtPickers } from '../../lib/valterra/pickers.js';
import { INVESTMENT_STATUS_META, VT_COLORS, inr } from '../../lib/valterra/meta.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Pill from '../../components/ui/Pill.jsx';
import ChartCard from '../../components/ui/ChartCard.jsx';
import VtFilterBar, { useVtFilters } from '../../components/valterra/VtFilters.jsx';
import SitesOverview from '../../components/valterra/SitesOverview.jsx';
import { CategoryChart, ExpenseTrendChart, IncomeChart, InvestmentFlowChart, InvestmentReturnsChart, NetTrendChart, ProjectedActualChart, VT_PIE } from '../../components/valterra/VtCharts.jsx';
import { Delta, Empty, Kpi, Money, card } from '../../components/valterra/ui.jsx';

const KPI_HINT = (text, change, inverse) => (<><span className="block">{text}</span>{change && <Delta pct={change.pct} inverse={inverse} />}</>);

function KpiGroup({ title, children }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-tertiary-500">{title}</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>
    </section>
  );
}

function PeriodTable({ title, s }) {
  const rows = [['Investment added', s.investment_added], ['Principal returned', s.principal_returned], ['Investment earnings', s.investment_earnings], ['Mining revenue / other income', s.other_income], ['Expenses', s.expenses], ['Net result', s.net_result]];
  return (
    <div className="rounded-xl border bg-white p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-tertiary-500">{title}</h4>
      <dl className="space-y-1 text-sm">{rows.map(([l, n]) => <div key={l} className="flex justify-between"><dt className="text-tertiary-600">{l}</dt><dd className={`tabular-nums ${l === 'Net result' ? `font-semibold ${n < 0 ? 'text-red-600' : 'text-tertiary-900'}` : ''}`}><Money v={n} /></dd></div>)}</dl>
    </div>
  );
}

export default function ValterraHomePage() {
  const { me, loading } = useValterra();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const pickers = useVtPickers({ people: true });
  const filters = useVtFilters({ fyStart: me?.fy_start_month || 4 });
  const { params, key } = filters;
  const { data, loading: busy, error } = useLiveData(() => vtApi.dashboard(params), { intervalMs: 60000, enabled: Boolean(me), deps: [key] });
  useEffect(() => { if (error) pushError(valterraError(error, 'Could not load the overview'), 'Load failed'); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const attention = useMemo(() => [
    ...(data?.attention.overdue_investments || []).map((a) => ({ ...a, type: 'overdue_investment' })),
    ...(data?.attention.overdue_receivables || []).map((a) => ({ ...a, type: 'overdue_receivable' })),
    ...(data?.attention.overdue_payables || []).map((a) => ({ ...a, type: 'overdue_payable' })),
  ], [data]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !vtCan(me, 'dashboard')) return <Navigate to="/valterra/investments" replace />;

  const p = data?.period;
  const ch = data?.change;
  const canSalary = vtCan(me, 'payroll');
  const columns = [
    { key: 'name', header: 'Investment', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}{r.category ? ` · ${r.category}` : ''}</span></span> },
    { key: 'date', header: 'Date', render: (r) => r.investment_date },
    { key: 'amount', header: 'Invested', render: (r) => <Money v={r.amount} /> },
    { key: 'principal', header: 'Principal back', render: (r) => <Money v={r.principal_returned} /> },
    { key: 'earnings', header: 'Earnings', render: (r) => <Money v={r.earnings} /> },
    { key: 'out', header: 'Outstanding', render: (r) => <Money v={r.outstanding_principal} /> },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={INVESTMENT_STATUS_META[r.status]?.tone}>{INVESTMENT_STATUS_META[r.status]?.label}</Pill> },
  ];

  return (
    <div className="mt-4 space-y-4">
      <VtFilterBar
        filters={filters}
        pickers={pickers}
        fields={['site_id', 'mining_type_id', 'material_id', 'investment_category_id', 'investment_status', 'income_category_id', 'expense_category_id', 'payment_status', ...(canSalary ? ['person_id'] : [])]}
        searchPlaceholder="Search..."
      >
        {vtCan(me, 'investmentsEdit') && <Link to="/valterra/investments?new=1" className="btn-primary inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />New investment</Link>}
        {vtCan(me, 'entriesEdit') && <Link to="/valterra/expenses?new=1" className="btn-secondary inline-flex items-center gap-1.5">Record expense</Link>}
      </VtFilterBar>

      {!p ? <div className="py-8 text-center text-sm text-tertiary-500">{busy ? 'Loading...' : 'No data.'}</div> : (
        <div className={`space-y-4 transition-opacity ${busy ? 'opacity-60' : ''}`}>
          <KpiGroup title="Capital">
            <Kpi label="Total investment added" value={<Money v={p.investment_added} />} hint={KPI_HINT(`${p.investment_count} placed · ${inr(data.cumulative.investment_added)} all time`, ch.investment_added)} />
            <Kpi label="Principal recovered" value={<Money v={p.principal_returned} />} hint={KPI_HINT(`${inr(data.cumulative.principal_returned)} all time · not income`, ch.principal_returned)} />
            <Kpi label="Principal still invested" value={<Money v={data.position.outstanding_principal} />} hint={`Expected returns still to come ${inr(data.position.expected_returns_outstanding)}`} />
            <Kpi label="Active mining sites" value={data.sites ? data.sites.active : 0} hint={`${data.sites?.total ?? 0} site${data.sites?.total === 1 ? '' : 's'} in view`} />
          </KpiGroup>
          <KpiGroup title="Income">
            <Kpi label="Mining revenue / other income" value={<Money v={p.other_income} />} hint={KPI_HINT('Sales and business income - not investment earnings', ch.other_income)} />
            <Kpi label="Investment earnings" value={<Money v={p.investment_earnings} />} hint={KPI_HINT('Profit on top of the principal', ch.investment_earnings)} tone="text-emerald-700" />
            <Kpi label="Recognised income" value={<Money v={p.income} />} hint={KPI_HINT('Mining revenue + other income + earnings; capital and principal excluded', ch.income)} tone="text-emerald-700" />
          </KpiGroup>
          <KpiGroup title="Costs">
            <Kpi label="Site operating expenses" value={<Money v={p.operating_expenses} />} hint="Operations, fuel, rent, repairs and other running costs" />
            <Kpi label="Other expenses" value={<Money v={p.other_expenses} />} hint="One-off and non-operating costs" />
            <Kpi label="Salaries" value={p.salaries === null ? <span className="text-tertiary-400">Restricted</span> : <Money v={p.salaries} />} hint={p.salaries === null ? 'Payroll is visible to finance and admin' : `${inr(p.salaries_paid)} paid · counted once`} />
            <Kpi label="Recognised expenses" value={<Money v={p.expenses} />} hint={KPI_HINT('Operating + other + salaries', ch.expenses, true)} />
          </KpiGroup>
          <KpiGroup title="Result and outlook">
            <Kpi label="Net profit / loss" value={<Money v={p.net_result} signed />} hint={KPI_HINT('Recognised income less recognised expenses', ch.net_result)} tone={p.net_result < 0 ? 'text-red-600' : 'text-emerald-700'} />
            <Kpi label="Outstanding receivables" value={<Money v={data.position.receivables} />} hint={`${data.position.overdue_receivables} overdue · money owed to the company`} />
            <Kpi label="Outstanding payables" value={<Money v={data.position.payables} />} hint={`${data.position.overdue_payables} overdue · money the company owes`} />
            <Kpi label="Projected future returns" value={<Money v={data.projected_future.returns} />} hint={`Principal ${inr(data.projected_future.principal_recovery)} + earnings ${inr(data.projected_future.earnings)} from ${data.projected_future.from} on - a plan, not received`} />
          </KpiGroup>
          <div className="grid gap-3 text-xs text-tertiary-600 md:grid-cols-3">
            <div className="rounded-xl border bg-tertiary-50/50 px-3 py-2">Cash in (principal + earnings + paid income)<div className="mt-0.5 text-sm font-semibold text-tertiary-900"><Money v={p.cash_in} /></div></div>
            <div className="rounded-xl border bg-tertiary-50/50 px-3 py-2">Cash out (capital placed + paid expenses + paid salaries)<div className="mt-0.5 text-sm font-semibold text-tertiary-900"><Money v={p.cash_out} /></div></div>
            <div className="rounded-xl border bg-tertiary-50/50 px-3 py-2">Cash balance (company)<div className="mt-0.5 text-sm font-semibold text-tertiary-900">{data.cash_balance_company_only ? <span className="font-normal text-tertiary-400">Company-wide figure - clear the site filters to see it</span> : data.cash_balance === null ? <span className="font-normal text-tertiary-400">Set an opening balance in setup</span> : <Money v={data.cash_balance} signed />}</div></div>
          </div>

          <SitesOverview sites={data.sites} canOpen={vtCan(me, 'sites')} />

          <div className="grid gap-3 md:grid-cols-3">
            <PeriodTable title="Current month" s={data.current_month} />
            <PeriodTable title="Previous month" s={data.previous_month} />
            <PeriodTable title={`Financial year to date (from ${data.ytd_from})`} s={data.year_to_date} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Capital placed vs principal recovered" subtitle="By month - the 12 months up to the end of the period"><InvestmentFlowChart rows={data.trend} /></ChartCard>
            <ChartCard title="Investment earnings and other income" subtitle="By month"><IncomeChart rows={data.trend} /></ChartCard>
            <ChartCard title="Expenses by category" subtitle="The selected period">
              <CategoryChart rows={data.expenses_by_category} />
              <ul className="mt-2 space-y-1 text-xs text-tertiary-600">{data.expenses_by_category.slice(0, 6).map((c, i) => <li key={c.name} className="flex justify-between"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: VT_PIE[i % VT_PIE.length] }} />{c.name}</span><span className="tabular-nums">{inr(c.amount)}</span></li>)}</ul>
            </ChartCard>
            <ChartCard title="Expenses and salaries" subtitle="By month"><ExpenseTrendChart rows={data.trend} showSalary={canSalary} /></ChartCard>
            <ChartCard title="Projected vs actual income" subtitle="Solid line = what happened; dashed line = the plan (an estimate)"><ProjectedActualChart rows={data.projected_by_month} side="income" /></ChartCard>
            <ChartCard title="Projected vs actual expenses" subtitle="Spending above the plan is unfavourable"><ProjectedActualChart rows={data.projected_by_month} side="expenses" /></ChartCard>
            <ChartCard title="Net result" subtitle="Income less expenses by month"><NetTrendChart rows={data.trend} /></ChartCard>
            <ChartCard title="Investment-wise returns" subtitle="Expected return vs received, per investment"><InvestmentReturnsChart rows={data.investments} /></ChartCard>
          </div>

          {data.comparison.some((c) => c.actual !== null && (c.projected || c.actual)) && (
            <section className={card} aria-label="Actual versus projected">
              <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Actual versus projected for the period</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="text-left text-xs text-tertiary-500"><tr><th className="py-1.5 font-medium">Line</th><th className="px-2 text-right font-medium">Projected</th><th className="px-2 text-right font-medium">Actual</th><th className="px-2 text-right font-medium">Variance</th><th className="px-2 text-right font-medium">Var %</th><th className="px-2 text-right font-medium">Remaining</th><th className="px-2 font-medium">Performance</th></tr></thead>
                  <tbody>
                    {data.comparison.filter((c) => c.actual !== null && (c.projected || c.actual)).map((c) => (
                      <tr key={c.line} className="border-t"><td className="py-1.5">{c.label}</td><td className="px-2 text-right tabular-nums"><Money v={c.projected} /></td><td className="px-2 text-right tabular-nums"><Money v={c.actual} /></td>
                        <td className={`px-2 text-right tabular-nums ${c.favourable === false ? 'text-red-600' : ''}`}><Money v={c.variance} /></td><td className="px-2 text-right tabular-nums">{c.variance_pct === null ? '-' : `${c.variance_pct}%`}</td><td className="px-2 text-right tabular-nums"><Money v={c.remaining} /></td>
                        <td className="px-2"><Pill tone={c.status === 'on_track' ? 'green' : c.status === 'off_track' ? 'red' : c.status === 'unplanned' ? 'amber' : 'gray'}>{{ on_track: 'On track', off_track: 'Off track', unplanned: 'Not planned', none: '-' }[c.status]}</Pill></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-tertiary-500">Variance = actual - projected. For income and returns a negative variance is unfavourable; for expenses a positive one is. Projections are plans, never transactions.</p>
            </section>
          )}

          {attention.length > 0 && (
            <section className={`${card} border-amber-200 bg-amber-50/40`} aria-label="Needs attention">
              <h3 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><AlertTriangle className="h-4 w-4 text-amber-600" />Needs attention ({attention.length})</h3>
              <ul className="grid gap-1.5 md:grid-cols-2">
                {attention.slice(0, 10).map((a) => (
                  <li key={`${a.type}-${a.id}`} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2 py-1.5 text-sm">
                    <span className="min-w-0 truncate">{a.type === 'overdue_investment' ? <><span className="font-medium text-tertiary-900">{a.name}</span> <span className="text-xs text-tertiary-500">{a.code} · expected {a.expected_return_date}</span></> : <><span className="font-medium text-tertiary-900">{a.party || (a.type === 'overdue_receivable' ? 'Receivable' : 'Payable')}</span> <span className="text-xs text-tertiary-500">due {a.due_date}</span></>}</span>
                    <Pill tone="red">{a.type === 'overdue_investment' ? `Overdue · ${inr(a.outstanding_principal)} out` : a.type === 'overdue_receivable' ? `Receivable ${inr(a.amount)}` : `Payable ${inr(a.amount)}`}</Pill>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={card}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><Landmark className="h-4 w-4" />Investments</h3>
              <Link to="/valterra/investments" className="text-xs font-medium text-primary-700 hover:underline">All investments</Link>
            </div>
            <DataTable columns={columns} rows={data.investments} emptyLabel="No investments match these filters." onRowClick={() => navigate('/valterra/investments')} maxHeight="50vh" />
            <p className="mt-2 text-[11px] text-tertiary-500">Figures follow the filters above. <span style={{ color: VT_COLORS.brass }}>Principal returned is not income</span>; projections are estimates and never create transactions.</p>
          </section>
          {data.investments.length === 0 && <Empty>No investments yet. Add the first one to start tracking capital and returns.</Empty>}
        </div>
      )}
    </div>
  );
}
