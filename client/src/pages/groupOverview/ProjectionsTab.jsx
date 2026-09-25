import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PiggyBank, Settings2, TrendingUp, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, money, shortMonth, titleCase } from '../../lib/format.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { LiveIndicator } from '../analytics/LiveSalesTab.jsx';

const POLL_MS = 60000;
const MODULES = [
  ['trading', 'Trading (suppliers, consumers, rate cards)'],
  ['leads', 'Leads'],
  ['contracts', 'Contracts and recurring revenue'],
  ['projects', 'Self projects, legal and site documents'],
];
const METHODS = [
  { value: 'manual', label: 'Manual (entered figure)' },
  { value: 'revenue_multiple', label: 'Revenue multiple (annualised revenue x multiple)' },
  { value: 'ebitda_multiple', label: 'EBITDA multiple (annualised profit x multiple)' },
];

/**
 * Super Admin: live projections and dynamic valuation for every company.
 * Valuation is recomputed on each load from the last three complete months, so
 * it moves with the business. Settings choose the method and which vertical
 * modules a company has switched on.
 */
export default function ProjectionsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [editing, setEditing] = useState(null);
  const { data, loading, updatedAt, refresh } = useLiveData(() => apiClient.get('/super-dashboard/projections', { params: { months: 12, horizon: 6 } }).then((r) => r.data.data), { intervalMs: POLL_MS });

  const totals = data?.totals;
  const currency = totals?.currency;

  // Group-wide monthly series (only meaningful in a single currency).
  const chart = useMemo(() => {
    if (!data || data.totals.mixed_currency) return [];
    const byMonth = new Map();
    const put = (month, patch) => byMonth.set(month, { ...(byMonth.get(month) || { month }), ...patch });
    for (const o of data.orgs) {
      for (const a of o.actuals) {
        const cur = byMonth.get(a.month) || {};
        put(a.month, { actual: (cur.actual || 0) + a.revenue });
      }
      for (const p of o.projected) {
        const cur = byMonth.get(p.month) || {};
        put(p.month, { projected: (cur.projected || 0) + p.revenue, projectedProfit: (cur.projectedProfit || 0) + p.profit });
      }
    }
    return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)).map((r) => ({ ...r, label: shortMonth(r.month) }));
  }, [data]);

  async function saveSettings(values) {
    const enabled_modules = MODULES.map(([key]) => key).filter((key) => values[`mod_${key}`]);
    const body = { enabled_modules, valuation_method: values.valuation_method, valuation_multiple: values.valuation_multiple ?? null };
    try {
      await apiClient.patch(`/orgs/${editing.org.id}/settings`, body);
      pushSuccess(`${editing.org.name} settings saved. Users see module changes after they switch workspace or sign in again.`);
      refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save settings'), 'Could not save');
      throw err;
    }
  }

  const cols = [
    { key: 'org', header: 'Company', render: (r) => <span className="font-medium text-tertiary-900">{r.org.name}</span> },
    { key: 'valuation', header: 'Valuation', render: (r) => <span className="font-semibold">{r.valuation.effective ? `${r.org.currency} ${money(r.valuation.effective)}` : 'Not set'}</span> },
    { key: 'method', header: 'Method', render: (r) => <Pill tone={r.valuation.method === 'manual' ? 'gray' : 'blue'}>{`${titleCase(r.valuation.method)}${r.valuation.method !== 'manual' && r.valuation.multiple ? ` x${r.valuation.multiple}` : ''}`}</Pill> },
    { key: 'manual', header: 'Manual figure', render: (r) => (r.valuation.manual ? money(r.valuation.manual) : '-') },
    { key: 'rev', header: 'Trailing 12 mo revenue', render: (r) => money(r.actuals.reduce((s, m) => s + m.revenue, 0)) },
    { key: 'proj', header: 'Projected revenue (6 mo)', render: (r) => money(r.projected_revenue_total) },
    { key: 'profit', header: 'Projected profit (6 mo)', render: (r) => <span className={r.projected_profit_total < 0 ? 'text-red-600' : 'text-green-700'}>{money(r.projected_profit_total)}</span> },
    { key: 'conf', header: 'Confidence', render: (r) => <Pill tone={r.confidence === 'high' ? 'green' : r.confidence === 'medium' ? 'amber' : 'gray'}>{titleCase(r.confidence)}</Pill> },
    { key: 'settings', header: '', render: (r) => <button type="button" aria-label={`Settings for ${r.org.name}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => setEditing(r)}><Settings2 className="h-3.5 w-3.5" />Settings</button> },
  ];

  const initial = editing ? {
    valuation_method: editing.valuation.method,
    valuation_multiple: editing.valuation.multiple ?? '',
    ...Object.fromEntries(MODULES.map(([key]) => [`mod_${key}`, (editing.org.enabled_modules || []).includes(key)])),
  } : undefined;

  return (
    <div className="space-y-4">
      <LiveIndicator updatedAt={updatedAt} everyMs={POLL_MS} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Group valuation" value={currency ? `${currency} ${money(totals.valuation)}` : totals ? 'Mixed currencies' : '-'} hint="Sum of each company's effective valuation" icon={Wallet} theme="purple" />
        <KpiCard label="Projected revenue (6 mo)" value={currency ? money(totals.projected_revenue) : '-'} icon={TrendingUp} theme="green" />
        <KpiCard label="Projected profit (6 mo)" value={currency ? money(totals.projected_profit) : '-'} icon={PiggyBank} theme={(totals?.projected_profit || 0) < 0 ? 'red' : 'blue'} />
        <KpiCard label="Trailing 12 mo profit" value={currency ? money(totals.trailing_profit) : '-'} icon={PiggyBank} theme="orange" />
      </div>
      {totals?.mixed_currency && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Companies in this group use different currencies, so group totals and the combined chart are hidden. Compare companies below.</p>}

      {chart.length > 0 && (
        <ChartCard title="Group revenue: actual and projected" subtitle="All active companies, monthly">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => money(v)} />
                <Legend />
                <Bar dataKey="actual" name="Actual revenue" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
                <Bar dataKey="projected" name="Projected revenue" fill={CHART_COLORS.primarySoft} radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="projectedProfit" name="Projected profit" stroke={CHART_COLORS.purple} strokeDasharray="5 4" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      <DataTable columns={cols} rows={(data?.orgs || []).map((o) => ({ ...o, id: o.org.id }))} loading={loading} emptyLabel="No active companies" />
      <p className="text-xs text-tertiary-500">Projections fit a straight-line trend to each company&apos;s last six months with data, so they are indicative, not a forecast. With a multiple method, valuation = annualised revenue (or profit) of the last three complete months x the multiple; it falls back to the manual figure when there is no data yet.</p>

      <FormDrawer open={Boolean(editing)} onClose={() => setEditing(null)} tone="edit" size="lg" title={`Settings: ${editing?.org.name || ''}`} submitLabel="Save settings" initial={initial} onSubmit={saveSettings}
        fields={[
          { name: 'valuation_method', label: 'Valuation method', type: 'select', required: true, options: METHODS },
          { name: 'valuation_multiple', label: 'Multiple', type: 'number', min: 0, hint: 'blank = default (3x revenue, 8x EBITDA)', show: (v) => v.valuation_method !== 'manual' },
          ...MODULES.map(([key, label]) => ({ name: `mod_${key}`, label, type: 'checkbox' })),
        ]}
        intro="Choose how this company is valued and which optional modules appear in its sidebar."
      />
    </div>
  );
}
