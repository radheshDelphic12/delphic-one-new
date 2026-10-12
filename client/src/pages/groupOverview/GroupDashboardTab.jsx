import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Building2, PiggyBank, RefreshCw, TrendingUp, Users2, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import useLiveData from '../../lib/useLiveData.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { LiveIndicator } from '../analytics/LiveSalesTab.jsx';
import { GROUPINGS, GroupFilterBar, FigureSwitch, periodBinding, usePeriod } from './groupFilters.jsx';
import { AXIS_TICK, ChartFrame, CompanyCard, GRID_PROPS, ShortPeriodHint, StatTile, colorAt, lineProps } from './groupUi.jsx';

const LIVE_EVERY_MS = 30000;
const money = (n) => (n === null || n === undefined ? 'N/A' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const compact = (n) => {
  const v = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(2)} L`;
  return `${sign}₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Companies" value={t.active_companies} icon={Building2} tone="blue" note={t.coming_soon_companies ? `${t.coming_soon_companies} coming soon` : `${t.active_companies} live`} />
            <StatTile label="Group headcount" value={t.employees + t.contractors} icon={Users2} tone="violet" note={`${t.employees} employees · ${t.contractors} contractors`} />
            <StatTile label="Revenue" value={compact(t.revenue)} icon={Wallet} tone="green" pct={t.change_pct?.revenue} series={data.trends.revenue.map((r) => r.total)} />
            <StatTile label="Profit" value={compact(t.profit)} icon={TrendingUp} tone="teal" pct={t.change_pct?.profit} series={data.trends.profit.map((r) => r.total)} />
            <StatTile label="Group valuation" value={compact(t.valuation)} icon={PiggyBank} tone="amber" pct={t.change_pct?.valuation} series={data.trends.valuation.map((r) => r.total)} />
          </div>

          <ChartCard title="Revenue, expenses and profit" subtitle={`All companies together, ${GROUPINGS.find(([k]) => k === granularity)[1].toLowerCase()}, ${range.from} to ${range.to}`}>
            {chart.length === 0 || chart.every((r) => !r.revenue && !r.expenses && !r.profit) ? (
              <EmptyState title="No financial data in this period" description="Nothing has been recorded for these months. Try another period." />
            ) : (
              <>
                <ChartFrame className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chart} margin={{ top: 22, right: 22, left: 0, bottom: 0 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                      <YAxis tick={AXIS_TICK} tickFormatter={compact} width={70} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [money(v), name]} cursor={{ stroke: '#9fb3a7', strokeDasharray: '3 4' }} />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} iconType="circle" />
                      <Line dataKey="revenue" name="Revenue" {...lineProps('#2f7d57', chart.length, { labels: true })} />
                      <Line dataKey="expenses" name="Expenses" {...lineProps('#f59e0b', chart.length, { labels: true })} />
                      <Line dataKey="profit" name="Profit" {...lineProps('#2563eb', chart.length, { labels: true })} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartFrame>
                <ShortPeriodHint count={chart.length} />
              </>
            )}
          </ChartCard>

          <div>
            <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Companies</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {data.companies.map((c, i) => <CompanyCard key={c.org.id} company={c} color={colorAt(i)} groupRevenue={t.revenue} onOpen={openCompany} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
