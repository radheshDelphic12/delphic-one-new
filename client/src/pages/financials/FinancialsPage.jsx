import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarRange, ClipboardList, PiggyBank, TrendingUp, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, money, shortMonth, titleCase } from '../../lib/format.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { LiveIndicator } from '../analytics/LiveSalesTab.jsx';

const POLL_MS = 60000;
const TABS = [
  { key: 'overview', label: 'Overview', icon: Wallet },
  { key: 'plan', label: 'Plan vs actual', icon: ClipboardList },
  { key: 'projection', label: 'Projection & valuation', icon: TrendingUp },
];
const LINE_LABEL = { revenue: 'Revenue', expense: 'Operating expenses', salary: 'Salary', other: 'Other costs' };

function OverviewTab() {
  const [months, setMonths] = useState(12);
  const { data, loading, updatedAt } = useLiveData(() => apiClient.get('/financials/monthly', { params: { months } }).then((r) => r.data.data), { intervalMs: POLL_MS, deps: [months] });
  const rows = data || [];
  const current = rows[rows.length - 1];
  const chart = rows.map((r) => ({ ...r, label: shortMonth(r.month), costs: r.expenses + r.salary + r.other }));

  const cols = [
    { key: 'month', header: 'Month', render: (r) => shortMonth(r.month) },
    { key: 'revenue', header: 'Revenue', render: (r) => money(r.revenue) },
    { key: 'expenses', header: 'Expenses', render: (r) => money(r.expenses) },
    { key: 'salary', header: 'Salary', render: (r) => money(r.salary) },
    { key: 'other', header: 'Other', render: (r) => money(r.other) },
    { key: 'profit', header: 'Profit', render: (r) => <span className={r.profit < 0 ? 'font-medium text-red-600' : 'font-medium text-green-700'}>{money(r.profit)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <LiveIndicator updatedAt={updatedAt} everyMs={POLL_MS} />
        <label className="text-xs font-medium text-tertiary-600">Months
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="ml-2 rounded-xl border px-2 py-1 text-sm">{[6, 12, 24].map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Revenue (this month)" value={money(current?.revenue)} icon={Wallet} theme="green" to="/finance?section=projects" />
        <KpiCard label="Costs (this month)" value={money((current?.expenses || 0) + (current?.salary || 0) + (current?.other || 0))} icon={PiggyBank} theme="red" to="/finance?section=projects" />
        <KpiCard label="Profit (this month)" value={money(current?.profit)} icon={TrendingUp} theme={(current?.profit || 0) < 0 ? 'red' : 'blue'} to="/finance?section=projects" />
        <KpiCard label="Salary basis" value={titleCase(current?.salary_basis || 'none')} hint="payroll when processed" icon={CalendarRange} theme="purple" />
      </div>
      <ChartCard title="Revenue, costs and profit" subtitle="Billing, trading, projects and recurring contracts vs expenses, vendors, salary">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => money(v)} />
              <Legend />
              <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
              <Bar dataKey="costs" name="Costs" fill={CHART_COLORS.danger} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="profit" name="Profit" stroke={CHART_COLORS.primary} strokeWidth={2} dot />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
      <DataTable columns={cols} rows={[...rows].reverse().map((r) => ({ ...r, id: r.month }))} loading={loading} emptyLabel="No financial activity yet" />
    </div>
  );
}

function PlanTab() {
  const { pushError, pushSuccess } = useAlerts();
  const now = new Date();
  const [period, setPeriod] = useState({ month: now.getUTCMonth() + 1, year: now.getUTCFullYear() });
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const { data, loading, refresh } = useLiveData(
    () => apiClient.get('/financials/plan', { params: { period_month: period.month, period_year: period.year } }).then((r) => r.data.data),
    { deps: [period.month, period.year] }
  );

  useEffect(() => {
    if (!data) return;
    const next = {};
    for (const line of data.lines) next[line.line_kind] = String(line.planned || '');
    setDraft(next);
  }, [data]);

  async function save() {
    setSaving(true);
    try {
      for (const line of data.lines) {
        const value = Number(draft[line.line_kind] || 0);
        if (value !== line.planned) {
          await apiClient.put('/financials/plan', { period_month: period.month, period_year: period.year, line_kind: line.line_kind, category: '', planned_amount: value });
        }
      }
      pushSuccess('Plan saved');
      refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save plan'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const cols = [
    { key: 'line_kind', header: 'Line', render: (r) => LINE_LABEL[r.line_kind] },
    { key: 'planned', header: 'Planned', render: (r) => <input type="number" min="0" value={draft[r.line_kind] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [r.line_kind]: e.target.value }))} className="w-32 rounded-lg border px-2 py-1 text-sm" aria-label={`Planned ${LINE_LABEL[r.line_kind]}`} /> },
    { key: 'actual', header: 'Actual', render: (r) => money(r.actual) },
    { key: 'variance', header: 'Variance', render: (r) => money(r.variance) },
    { key: 'variance_percent', header: '%', render: (r) => (r.variance_percent === null ? '-' : `${r.variance_percent}%`) },
    { key: 'on_track', header: 'Status', render: (r) => (r.planned ? <Pill tone={r.on_track ? 'green' : 'red'}>{r.on_track ? 'On track' : 'Off plan'}</Pill> : <Pill tone="gray">No plan</Pill>) },
  ];

  const years = useMemo(() => [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1], []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-3">
          <label className="text-xs font-medium text-tertiary-600">Month
            <select value={period.month} onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' })}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={period.year} onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>
        <button type="button" className="btn-primary" onClick={save} disabled={saving || !data}>{saving ? 'Saving...' : 'Save plan'}</button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label="Planned profit" value={money(data?.planned_profit)} icon={ClipboardList} theme="blue" />
        <KpiCard label="Actual profit (so far)" value={money(data?.actual_profit)} icon={TrendingUp} theme={(data?.actual_profit || 0) < 0 ? 'red' : 'green'} />
      </div>
      <DataTable columns={cols} rows={(data?.lines || []).map((l) => ({ ...l, id: l.line_kind }))} loading={loading} />
      <p className="text-xs text-tertiary-500">Actuals are derived live from billing, trading, project entries, recurring contracts, expense claims, vendor payments and payroll.</p>
    </div>
  );
}

function ProjectionTab() {
  const { data, loading, updatedAt } = useLiveData(() => apiClient.get('/financials/projection', { params: { months: 12, horizon: 6 } }).then((r) => r.data.data), { intervalMs: POLL_MS });
  const chart = useMemo(() => {
    if (!data) return [];
    const actual = data.actuals.map((a) => ({ label: shortMonth(a.month), actual: a.revenue, actualCost: a.expenses + a.salary + a.other }));
    const projected = data.projected.map((p) => ({ label: shortMonth(p.month), projected: p.revenue, projectedCost: p.cost }));
    return [...actual, ...projected];
  }, [data]);
  const v = data?.valuation;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><LiveIndicator updatedAt={updatedAt} everyMs={POLL_MS} />{data && <Pill tone={data.confidence === 'high' ? 'green' : data.confidence === 'medium' ? 'amber' : 'gray'}>{`Confidence: ${data.confidence}`}</Pill>}</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Projected revenue (6 mo)" value={money(data?.projected_revenue_total)} icon={TrendingUp} theme="green" />
        <KpiCard label="Projected profit (6 mo)" value={money(data?.projected_profit_total)} icon={PiggyBank} theme={(data?.projected_profit_total || 0) < 0 ? 'red' : 'blue'} />
        <KpiCard label="Valuation" value={money(v?.effective)} hint={v ? `${titleCase(v.method)}${v.multiple ? ` x${v.multiple}` : ''}` : undefined} icon={Wallet} theme="purple" />
        <KpiCard label="Manual valuation" value={v?.manual ? money(v.manual) : '-'} hint="set by the group admin" icon={Wallet} theme="orange" />
      </div>
      <ChartCard title="Revenue: actual and projected" subtitle="Least-squares trend over the last 6 months with data">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(val) => money(val)} />
              <Legend />
              <Bar dataKey="actual" name="Actual revenue" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
              <Bar dataKey="projected" name="Projected revenue" fill={CHART_COLORS.primarySoft} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="actualCost" name="Actual cost" stroke={CHART_COLORS.danger} dot={false} />
              <Line type="monotone" dataKey="projectedCost" name="Projected cost" stroke={CHART_COLORS.warning} strokeDasharray="5 4" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
      {!loading && v && v.method !== 'manual' && (
        <p className="text-xs text-tertiary-500">Valuation = {v.method === 'revenue_multiple' ? `annualised revenue ${money(v.annualised_revenue)}` : `annualised EBITDA ${money(v.annualised_ebitda)}`} x {v.multiple}, from the last {v.basis_months} complete months.</p>
      )}
    </div>
  );
}

export default function FinancialsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'overview';
  const section = TABS.some((t) => t.key === requested) ? requested : 'overview';
  return (
    <div className="space-y-4">
      <SectionTabs tabs={TABS} value={section} onChange={(key) => setParams({ section: key })} />
      {section === 'overview' && <OverviewTab />}
      {section === 'plan' && <PlanTab />}
      {section === 'projection' && <ProjectionTab />}
    </div>
  );
}
