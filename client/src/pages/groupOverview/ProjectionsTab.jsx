import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PiggyBank, RefreshCw, Settings2, TrendingUp, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, money, shortMonth, titleCase } from '../../lib/format.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Pill from '../../components/ui/Pill.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { LiveIndicator } from '../analytics/LiveSalesTab.jsx';
import { GroupFilterBar, FigureSwitch, periodBinding, usePeriod } from './groupFilters.jsx';

const POLL_MS = 60000;
const HORIZONS = [['1', 'Next month'], ['2', 'Next 2 months'], ['3', 'Next 3 months'], ['6', 'Next 6 months'], ['9', 'Next 9 months'], ['12', 'Next 12 months']];
const MODULES = [
  ['trading', 'Trading (suppliers, consumers, rate cards)'],
  ['leads', 'Leads'],
  ['contracts', 'Contracts and recurring revenue'],
  ['projects', 'Self projects, legal and site documents'],
];

const rupees = (n) => (n === null || n === undefined ? '-' : `₹${money(n)}`);

/** One company's month-by-month history and projection. */
function MonthlyDrawer({ company, formula, onClose }) {
  if (!company) return <Drawer open={false} onClose={onClose} title="" />;
  const rows = [...company.history.map((m) => ({ ...m, kind: 'actual' })), ...company.projected.map((m) => ({ ...m, kind: 'projected' }))];
  return (
    <Drawer open title={`${company.org.name} - month by month`} onClose={onClose} size="lg">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-tertiary-500"><th className="py-1">Month</th><th></th><th className="text-right">Revenue</th><th className="text-right">Expenses</th><th className="text-right">Profit</th><th className="text-right">Asset value</th><th className="text-right">Valuation</th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={`${m.kind}-${m.month}`} className={`border-t border-tertiary-100 ${m.kind === 'projected' ? 'bg-primary-50/40' : ''}`}>
              <td className="py-1">{shortMonth(m.month)}</td>
              <td className="px-2"><Pill tone={m.kind === 'projected' ? 'blue' : 'gray'}>{m.kind === 'projected' ? 'Projected' : 'Actual'}</Pill></td>
              <td className="text-right">{rupees(m.revenue)}</td>
              <td className="text-right">{rupees(m.expenses)}</td>
              <td className={`text-right ${m.profit < 0 ? 'text-red-600' : ''}`}>{rupees(m.profit)}</td>
              <td className="text-right">{rupees(m.asset_value)}</td>
              <td className="text-right font-medium">{rupees(m.valuation)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-tertiary-500">Valuation = profit x {formula.profit} + asset value x {formula.asset_value}. Projected months use the latest recorded asset value.</p>
    </Drawer>
  );
}

/**
 * Projections and valuation for the whole group, built on the same monthly books as the Group Finance tab
 * (/group/projection). Pick the history window (a preset, a month, or a start / end month), how many months to project
 * after its end month, and which figures to read (locked, live, all). Nothing is computed here.
 */
export default function ProjectionsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [editing, setEditing] = useState(null);
  const [openOrgId, setOpenOrgId] = useState(null);
  const period = usePeriod('this_month');
  const [horizon, setHorizon] = useState('6');
  const [state, setState] = useState('all');
  const { range, valid } = period;

  const { data, loading, error, updatedAt, refresh } = useLiveData(
    () => apiClient.get('/super-dashboard/group/projection', { params: { from: range.from, to: range.to, horizon, state } }).then((r) => r.data.data),
    { intervalMs: POLL_MS, enabled: valid, deps: [range?.from, range?.to, horizon, state] }
  );
  useEffect(() => {
    if (error) pushError(apiErrorMessage(error, 'Failed to load the projections'), 'Something went wrong');
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = data?.group.totals;
  const live = useMemo(() => (data?.companies || []).filter((c) => !c.coming_soon), [data]);
  const chart = useMemo(() => {
    if (!data || data.mixed_currency) return [];
    const byMonth = new Map();
    for (const r of data.group.history) byMonth.set(r.month, { month: r.month, label: shortMonth(r.month), actual: r.revenue, actualValuation: r.valuation, actualProfit: r.profit });
    // The projected lines start on the last actual month (unless the projection itself covers it, e.g. the current month)
    // so each pair reads as one continuous trend.
    const lastActual = data.group.history[data.group.history.length - 1];
    const first = data.group.projected[0];
    if (lastActual && first && first.month > lastActual.month) {
      const row = byMonth.get(lastActual.month);
      row.projected = row.actual; row.projectedValuation = row.actualValuation; row.projectedProfit = row.actualProfit;
    }
    for (const r of data.group.projected) byMonth.set(r.month, { ...(byMonth.get(r.month) || { month: r.month, label: shortMonth(r.month) }), projected: r.revenue, projectedValuation: r.valuation, projectedProfit: r.profit });
    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [data]);

  async function saveSettings(values) {
    const enabled_modules = MODULES.map(([key]) => key).filter((key) => values[`mod_${key}`]);
    try {
      await apiClient.patch(`/orgs/${editing.org.id}/settings`, { enabled_modules, coming_soon: Boolean(values.coming_soon) });
      pushSuccess(`${editing.org.name} settings saved. Users see module changes after they switch workspace or sign in again.`);
      refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save settings'), 'Could not save');
      throw err;
    }
  }

  const cols = [
    { key: 'org', header: 'Company', render: (r) => <button type="button" className="font-medium text-primary-700 hover:underline" onClick={() => setOpenOrgId(r.org.id)}>{r.org.name}</button> },
    { key: 'hist', header: 'Revenue (history)', render: (r) => (r.coming_soon ? 'Coming soon' : rupees(r.totals.history_revenue)) },
    { key: 'proj', header: `Projected revenue (${horizon} mo)`, render: (r) => (r.coming_soon ? '-' : rupees(r.totals.projected_revenue)) },
    { key: 'pprofit', header: `Projected profit (${horizon} mo)`, render: (r) => (r.coming_soon ? '-' : <span className={r.totals.projected_profit < 0 ? 'text-red-600' : 'text-green-700'}>{rupees(r.totals.projected_profit)}</span>) },
    { key: 'val', header: 'Valuation now', render: (r) => (r.coming_soon ? '-' : <span className="font-semibold">{rupees(r.totals.current_valuation)}</span>) },
    { key: 'pval', header: 'Projected valuation', render: (r) => (r.coming_soon ? '-' : <span className="font-semibold">{rupees(r.totals.projected_valuation)}</span>) },
    { key: 'conf', header: 'Confidence', render: (r) => (r.coming_soon ? '-' : <Pill tone={r.confidence === 'high' ? 'green' : r.confidence === 'medium' ? 'amber' : 'gray'}>{titleCase(r.confidence)}</Pill>) },
    { key: 'settings', header: '', render: (r) => <button type="button" aria-label={`Settings for ${r.org.name}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => setEditing(r)}><Settings2 className="h-3.5 w-3.5" />Settings</button> },
  ];

  const initial = editing ? {
    ...Object.fromEntries(MODULES.map(([key]) => [`mod_${key}`, (editing.org.enabled_modules || []).includes(key)])),
    coming_soon: Boolean(editing.org.coming_soon),
  } : undefined;
  const pb = periodBinding(period, 'History (actuals)');
  const filterFields = [...pb.fields, { key: 'horizon', label: 'Project', type: 'select', options: HORIZONS }];
  const filterValues = { ...pb.values, horizon };
  const filterDefaults = { ...pb.defaults, horizon: '6' };
  const changeFilter = (key, value) => (key === 'horizon' ? setHorizon(value) : pb.change(key, value));
  const resetFilters = () => { period.reset(); setHorizon('6'); setState('all'); };
  const projectedSpan = data && data.projected_months.length ? `${shortMonth(data.projected_months[0])} to ${shortMonth(data.projected_months[data.projected_months.length - 1])}` : '';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className={`h-1 overflow-hidden rounded-t-2xl bg-primary-100 ${loading ? '' : 'invisible'}`} aria-hidden="true"><div className="h-full w-1/3 animate-pulse rounded-r bg-primary-500" /></div>
        <div className="space-y-2 p-4">
          <GroupFilterBar fields={filterFields} values={filterValues} defaults={filterDefaults} onChange={changeFilter} onReset={resetFilters} below={<FigureSwitch value={state} onChange={setState} />}>
            {projectedSpan && <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">Projecting {projectedSpan}</span>}
            <LiveIndicator updatedAt={updatedAt} everyMs={POLL_MS} />
            <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium text-tertiary-700 hover:bg-tertiary-50" onClick={refresh} aria-label="Refresh now">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh
            </button>
          </GroupFilterBar>
          <p className="text-[11px] text-tertiary-500">History is what you see as actuals. The projection covers the current month and the months after it (or starts after an earlier history end), and is a straight-line fit of the last six complete months that have figures - whatever history you pick - so it is indicative, not a forecast. The current month&apos;s actuals are only to date.</p>
        </div>
      </div>

      {!valid && <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-tertiary-500">Pick a start month and an end month (the end cannot be before the start).</div>}
      {valid && loading && !data ? <Skeleton className="h-40 w-full" /> : !data ? null : (
        <div className={`space-y-4 transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={`Valuation (${shortMonth(data.to)})`} value={data.currency ? rupees(totals.current_valuation) : 'Mixed currencies'} hint="Sum of each company's valuation" icon={Wallet} theme="purple" />
            <KpiCard label={`Projected valuation (${data.projected_months.length ? shortMonth(data.projected_months[data.projected_months.length - 1]) : '-'})`} value={data.currency ? rupees(totals.projected_valuation) : '-'} icon={PiggyBank} theme="blue" />
            <KpiCard label={`Projected revenue (${horizon} mo)`} value={data.currency ? rupees(totals.projected_revenue) : '-'} hint={`History: ${rupees(totals.history_revenue)}`} icon={TrendingUp} theme="green" />
            <KpiCard label={`Projected profit (${horizon} mo)`} value={data.currency ? rupees(totals.projected_profit) : '-'} hint={`History: ${rupees(totals.history_profit)}`} icon={PiggyBank} theme={(totals.projected_profit || 0) < 0 ? 'red' : 'orange'} />
          </div>
          {data.mixed_currency && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Companies in this group use different currencies, so group totals and the combined charts are hidden. Compare companies below.</p>}

          {chart.length > 0 && (
            <div className="grid gap-4 xl:grid-cols-2">
              <ChartCard title="Group revenue: actual and projected" subtitle="All active companies, month by month">
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [rupees(v), name]} />
                      <Legend />
                      <Line type="monotone" dataKey="actual" name="Actual revenue" stroke={CHART_COLORS.success} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="projected" name="Projected revenue" stroke={CHART_COLORS.primary} strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="projectedProfit" name="Projected profit" stroke={CHART_COLORS.purple} strokeWidth={1.5} strokeDasharray="2 4" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
              <ChartCard title="Group valuation: actual and projected" subtitle={`Profit x ${data.formula.profit} + asset value x ${data.formula.asset_value}, month by month`}>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [rupees(v), name]} />
                      <Legend />
                      <Line type="monotone" dataKey="actualValuation" name="Actual valuation" stroke={CHART_COLORS.success} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="projectedValuation" name="Projected valuation" stroke={CHART_COLORS.primary} strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
            </div>
          )}

          {data.group.projected.length > 0 && !data.mixed_currency && (
            <section className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
              <h3 className="px-4 pt-3 font-heading text-sm font-semibold text-tertiary-900">Projected month by month (all companies)</h3>
              <table className="mt-2 w-full text-sm">
                <thead><tr className="text-left text-xs text-tertiary-500"><th className="px-4 py-2">Month</th><th className="px-3 text-right">Revenue</th><th className="px-3 text-right">Profit</th><th className="px-3 text-right">Valuation</th></tr></thead>
                <tbody>
                  {data.group.projected.map((m) => (
                    <tr key={m.month} className="border-t border-tertiary-100"><td className="px-4 py-2">{shortMonth(m.month)}</td><td className="px-3 text-right">{rupees(m.revenue)}</td><td className={`px-3 text-right ${m.profit < 0 ? 'text-red-600' : ''}`}>{rupees(m.profit)}</td><td className="px-3 text-right font-medium">{rupees(m.valuation)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <DataTable columns={cols} rows={data.companies.map((o) => ({ ...o, id: o.org.id }))} loading={false} emptyLabel="No active companies" />
        </div>
      )}

      <MonthlyDrawer company={live.find((c) => c.org.id === openOrgId) || null} formula={data?.formula || { profit: 240, asset_value: 3 }} onClose={() => setOpenOrgId(null)} />
      <FormDrawer open={Boolean(editing)} onClose={() => setEditing(null)} tone="edit" size="lg" title={`Settings: ${editing?.org.name || ''}`} submitLabel="Save settings" initial={initial} onSubmit={saveSettings}
        fields={[
          ...MODULES.map(([key, label]) => ({ name: `mod_${key}`, label, type: 'checkbox' })),
          { name: 'coming_soon', label: 'Coming soon (company not built yet: shown as Coming soon, cannot be opened, left out of group totals)', type: 'checkbox' },
        ]}
        intro="Choose which optional modules appear in this company's sidebar. Valuation is always profit x 240 + asset value x 3."
      />
    </div>
  );
}
