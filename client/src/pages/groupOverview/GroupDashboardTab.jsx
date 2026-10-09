import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Building2, PiggyBank, RefreshCw, TrendingUp, Users2, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import { orgLogo } from '../../lib/orgLogo.js';
import useLiveData from '../../lib/useLiveData.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { LiveIndicator } from '../analytics/LiveSalesTab.jsx';
import { GROUPINGS, GroupFilterBar, FigureSwitch, periodBinding, usePeriod } from './groupFilters.jsx';

const LIVE_EVERY_MS = 30000;
const money = (n) => (n === null || n === undefined ? 'N/A' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const compact = (n) => {
  const v = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(2)} L`;
  return `${sign}₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

function CompanyTile({ company, range, onOpen }) {
  const { org } = company;
  const logo = orgLogo(org);
  if (company.coming_soon) {
    return (
      <div className="rounded-2xl border border-dashed border-tertiary-200 bg-white p-4 text-tertiary-400">
        <p className="font-heading text-sm font-semibold">{org.name}</p>
        <p className="mt-1 text-xs">Coming soon - not built yet, left out of the totals.</p>
      </div>
    );
  }
  const loss = company.totals.profit < 0;
  return (
    <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card transition-shadow hover:shadow-cardHover">
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => onOpen(org)}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-50 text-primary-700">
          {logo ? <img src={logo} alt="" className="h-full w-full object-contain p-1" /> : <Building2 className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold text-tertiary-900">{org.name}</p>
          <p className="text-xs text-tertiary-500">{company.people.employees + company.people.contractors} people · open company →</p>
        </div>
      </button>
      {!company.has_data && <p className="mt-3 rounded-lg bg-tertiary-50 px-2 py-1 text-xs text-tertiary-500">No figures recorded in {range.from} to {range.to}.</p>}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-tertiary-400">Revenue</dt><dd className="font-medium text-tertiary-800">{compact(company.totals.revenue)}</dd></div>
        <div><dt className="text-tertiary-400">Expenses</dt><dd className="font-medium text-tertiary-800">{compact(company.totals.expenses)}</dd></div>
        <div><dt className="text-tertiary-400">Profit</dt><dd className={`font-medium ${loss ? 'text-danger-600' : 'text-success-700'}`}>{compact(company.totals.profit)}</dd></div>
        <div><dt className="text-tertiary-400">Margin</dt><dd className="font-medium text-tertiary-800">{company.totals.margin_pct === null ? 'N/A' : `${company.totals.margin_pct}%`}</dd></div>
      </dl>
      <div className="mt-3 flex items-center justify-between border-t border-tertiary-100 pt-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-tertiary-400">Valuation{company.valuation ? ` (${company.valuation.as_of})` : ''}</span>
        <span className="text-sm font-semibold text-tertiary-800">{company.valuation ? compact(company.valuation.current) : 'N/A'}</span>
      </div>
    </div>
  );
}

/**
 * Group Dashboard tab: the group at a glance for ANY period - a preset, a single month, or a start / end month -
 * grouped by month, quarter or year, on locked, live or all figures. Every number comes from the same endpoint as the
 * Group Finance tab (/group/overview), so the two tabs always agree and nothing here is calculated separately.
 */
export default function GroupDashboardTab() {
  const { switchOrg } = useAuth();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const period = usePeriod('this_month');
  const [granularity, setGranularity] = useState('month');
  const [state, setState] = useState('all');
  const { range, valid } = period;

  const { data, loading, error, updatedAt, refresh } = useLiveData(
    () => apiClient.get('/super-dashboard/group/overview', { params: { from: range.from, to: range.to, granularity, state } }).then((r) => r.data.data),
    { intervalMs: LIVE_EVERY_MS, enabled: valid, deps: [range?.from, range?.to, granularity, state] }
  );
  useEffect(() => {
    if (error) pushError(apiErrorMessage(error, 'Failed to load the group dashboard'), 'Something went wrong');
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = data?.totals;
  const chart = useMemo(() => {
    if (!data) return [];
    return data.trends.revenue.map((r, i) => ({ label: r.label, revenue: r.total, expenses: data.trends.expenses[i]?.total ?? 0, profit: data.trends.profit[i]?.total ?? 0 }));
  }, [data]);

  async function openCompany(org) {
    try {
      await switchOrg(org.id);
      navigate('/');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to open that company'), 'Something went wrong');
    }
  }

  const pb = periodBinding(period);
  const filterFields = [...pb.fields, { key: 'group', label: 'Group by', type: 'select', options: GROUPINGS }];
  const filterValues = { ...pb.values, group: granularity };
  const filterDefaults = { ...pb.defaults, group: 'month' };
  const changeFilter = (key, value) => (key === 'group' ? setGranularity(value) : pb.change(key, value));
  const resetFilters = () => { period.reset(); setGranularity('month'); setState('all'); };
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className={`h-1 overflow-hidden rounded-t-2xl bg-primary-100 ${loading ? '' : 'invisible'}`} aria-hidden="true"><div className="h-full w-1/3 animate-pulse rounded-r bg-primary-500" /></div>
        <div className="space-y-2 p-4">
          <GroupFilterBar fields={filterFields} values={filterValues} defaults={filterDefaults} onChange={changeFilter} onReset={resetFilters} below={<FigureSwitch value={state} onChange={setState} />}>
            {valid && <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700">{range.from} to {range.to}</span>}
            <LiveIndicator updatedAt={updatedAt} everyMs={LIVE_EVERY_MS} />
            <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium text-tertiary-700 hover:bg-tertiary-50" onClick={refresh} aria-label="Refresh now">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh
            </button>
          </GroupFilterBar>
          <p className="text-[11px] text-tertiary-500">Month is the finest period; quarter and year follow the April-March financial year. Pick a month, a quarter, a financial year or any start and end month.</p>
        </div>
      </div>

      {!valid && <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-tertiary-500">Pick a start month and an end month (the end cannot be before the start).</div>}
      {valid && loading && !data ? <Skeleton className="h-40 w-full" /> : !data ? null : (
        <div className={`space-y-5 transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard label="Companies" value={t.active_companies} hint={t.coming_soon_companies ? `${t.coming_soon_companies} coming soon` : undefined} icon={Building2} theme="blue" />
            <KpiCard label="Group headcount" value={t.employees + t.contractors} icon={Users2} theme="purple" />
            <KpiCard label="Revenue" value={compact(t.revenue)} icon={Wallet} theme="green" />
            <KpiCard label="Profit" value={compact(t.profit)} icon={TrendingUp} theme="blue" />
            <KpiCard label="Group valuation" value={compact(t.valuation)} icon={PiggyBank} theme="orange" />
          </div>

          <ChartCard title="Revenue, expenses and profit" subtitle={`All companies together, ${GROUPINGS.find(([k]) => k === granularity)[1].toLowerCase()}, ${range.from} to ${range.to}`}>
            {chart.length === 0 || chart.every((r) => !r.revenue && !r.expenses && !r.profit) ? (
              <EmptyState title="No financial data in this period" description="Nothing has been recorded for these months. Try another period." />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={70} />
                    <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [money(v), name]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="revenue" name="Revenue" fill="#4f8f60" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name="Expenses" fill={CHART_COLORS.warning} radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="profit" name="Profit" stroke="#1f4d33" strokeWidth={2} dot={chart.length < 25} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          <div>
            <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Companies</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.companies.map((c) => <CompanyTile key={c.org.id} company={c} range={range} onOpen={openCompany} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
