import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, shortMonth } from '../../lib/format.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import { inr } from '../../components/finance/CalculationLockBar.jsx';
import { MONTHS } from '../../components/finance/PeriodPicker.jsx';

const rupee = (n) => `${Number(n) < 0 ? '-' : ''}₹${compact(Math.abs(Number(n || 0)))}`;

/**
 * One month-on-month line: a smooth line with a soft fill, a value on every
 * point and the exact amount in the tooltip.
 */
function TrendChart({ title, subtitle, data, dataKey, color, name, className = '' }) {
  const gradientId = `trend-${dataKey}`;
  return (
    <ChartCard title={title} subtitle={subtitle} className={className}>
      <div className="h-72" data-testid={`trend-${dataKey}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 22, right: 16, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={rupee} tick={{ fontSize: 11 }} width={64} />
            <Tooltip contentStyle={chartTooltipStyle} labelFormatter={(label) => label} formatter={(v) => [inr(v), name]} />
            <Area type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} dot={{ r: 2.5, fill: color, strokeWidth: 0 }} activeDot={{ r: 4 }} isAnimationActive={false}>
              <LabelList dataKey={dataKey} position="top" formatter={(v) => (v ? rupee(v) : '')} style={{ fontSize: 10, fill: '#6B7280' }} />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** The asset value (x3 in the valuation) an admin records for a month. */
function AssetValueForm({ rows, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const latest = rows[rows.length - 1];
  const [period, setPeriod] = useState(() => ({ month: latest?.period_month || new Date().getMonth() + 1, year: latest?.period_year || new Date().getFullYear() }));
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const current = rows.find((r) => r.period_month === period.month && r.period_year === period.year);
  const years = useMemo(() => [...new Set(rows.map((r) => r.period_year))], [rows]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.put('/financials/asset-values', { period_month: period.month, period_year: period.year, asset_value: Number(value) });
      pushSuccess('Asset value saved');
      setValue('');
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save the asset value'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3" aria-label="Record asset value">
      <label className="text-xs font-medium text-tertiary-600">Month
        <select value={period.month} onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </label>
      <label className="text-xs font-medium text-tertiary-600">Year
        <select value={period.year} onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <label className="text-xs font-medium text-tertiary-600">Asset value (₹)
        <input required type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder={current ? String(current.asset_value) : '0'} className="mt-1 block w-44 rounded-xl border px-3 py-1.5 text-sm" />
      </label>
      <button type="submit" className="btn-primary" disabled={saving || value === ''}>{saving ? 'Saving…' : 'Save asset value'}</button>
      <p className="pb-1.5 text-xs text-tertiary-500">
        Valuation = (Delphic profit × 240) + (Asset value × 3). A month without a recorded asset value uses the latest earlier one{current ? ` — ${MONTHS[period.month - 1]} ${period.year} currently ${inr(current.asset_value)}${current.asset_value_carried ? ' (carried forward)' : ''}` : ''}.
      </p>
    </form>
  );
}

/**
 * Financial Trends — Revenue, Profit and Valuation, month on month. Revenue and
 * profit are the Financials figures (locked records); valuation is
 * (Delphic profit × 240) + (asset value × 3). All values come from
 * GET /financials/trends - nothing is computed or hardcoded here.
 */
const STATES = [
  { key: 'locked', label: 'Locked', hint: 'Finalized records only' },
  { key: 'unlocked', label: 'Unlocked', hint: 'Live records not locked yet' },
  { key: 'all', label: 'All', hint: 'Locked + unlocked' },
];

const VIEW_NAME = { locked: 'Finalized (locked)', unlocked: 'Live (unlocked)', all: 'Locked + unlocked' };
const monthValue = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthIndex = (value) => { const [y, m] = value.split('-').map(Number); return y * 12 + m - 1; };

export default function FinancialTrendsTab() {
  const now = new Date();
  // Default window: the last 12 months, ending this month.
  const [from, setFrom] = useState(() => monthValue(new Date(now.getFullYear(), now.getMonth() - 11, 1)));
  const [to, setTo] = useState(() => monthValue(now));
  const [state, setState] = useState('locked');
  const rangeError = !from || !to ? 'Pick a start and an end month.' : monthIndex(to) < monthIndex(from) ? 'The end month cannot be before the start month.' : monthIndex(to) - monthIndex(from) >= 36 ? 'Pick at most 36 months.' : '';
  const params = useMemo(() => { const [fy, fm] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number); return { from_year: fy, from_month: fm, to_year: ty, to_month: tm, state }; }, [from, to, state]);
  const { data, loading, refresh } = useLiveData(() => (rangeError ? Promise.resolve(null) : apiClient.get('/financials/trends', { params }).then((r) => r.data.data)), { deps: [from, to, state, rangeError] });
  const rows = useMemo(() => data?.months.map((m) => ({ ...m, label: shortMonth(m.month) })) || [], [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-3">
        <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5" role="group" aria-label="Locked / unlocked / all">
          {STATES.map(({ key, label, hint }) => (
            <button key={key} type="button" title={hint} onClick={() => setState(key)} aria-pressed={state === key} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${state === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-tertiary-600">Start month
            <input type="month" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-tertiary-600">End month
            <input type="month" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm" />
          </label>
        </div>
        <p className="w-full text-xs text-tertiary-500">
          {state === 'locked' && 'Revenue, profit and valuation count locked (finalized) records only. Switch to Unlocked or All to include live records that are not locked yet.'}
          {state === 'unlocked' && 'Live records that are not locked yet — projections, not final.'}
          {state === 'all' && 'Locked and unlocked records together.'}
        </p>
      </div>
      {rangeError && <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">{rangeError}</p>}

      {rangeError ? null : loading && !data ? <p className="text-sm text-tertiary-500">Loading…</p> : (
        <div className="grid gap-4 xl:grid-cols-2">
          <TrendChart title="Revenue — month on month" subtitle={`${VIEW_NAME[state]} revenue per month (Financials)`} data={rows} dataKey="revenue" name="Revenue" color={CHART_COLORS.success} />
          <TrendChart title="Profit — month on month" subtitle={`${VIEW_NAME[state]} revenue less salaries and expenses (Financials)`} data={rows} dataKey="profit" name="Profit" color={CHART_COLORS.primary} />
          <TrendChart className="xl:col-span-2" title="Valuation — month on month" subtitle="(Delphic profit × 240) + (Asset value × 3)" data={rows} dataKey="valuation" name="Valuation" color={CHART_COLORS.purple} />
        </div>
      )}
      {rows.length > 0 && (
        <section className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white" aria-label="How the valuation is worked out">
          <h3 className="px-4 pt-3 font-heading text-sm font-semibold text-tertiary-900">How each month&apos;s valuation is worked out</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-tertiary-500"><tr>
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Delphic profit</th>
              <th className="px-3 py-2 text-right font-medium">× 240</th>
              <th className="px-3 py-2 text-right font-medium">Asset value</th>
              <th className="px-3 py-2 text-right font-medium">× 3</th>
              <th className="px-3 py-2 text-right font-medium">Valuation</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-t border-tertiary-100">
                  <td className="px-4 py-2">{r.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.delphic_profit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-tertiary-600">{inr(r.delphic_profit_x)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.asset_value)}{r.asset_value_carried ? <span className="ml-1 text-[10px] text-tertiary-400">carried</span> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-tertiary-600">{inr(r.asset_value_x)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-primary-700">{inr(r.valuation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-3 pt-2 text-xs text-tertiary-500">Delphic profit is the same profit shown in the Profit chart: locked records in the Locked view, live records in Unlocked, both in All.</p>
        </section>
      )}
      {rows.length > 0 && <AssetValueForm rows={rows} onSaved={refresh} />}
    </div>
  );
}
