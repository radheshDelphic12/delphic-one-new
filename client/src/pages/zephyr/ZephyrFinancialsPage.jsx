import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Lock, LockOpen, TrendingUp } from 'lucide-react';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, shortMonth } from '../../lib/format.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { ZX_CHART } from '../../components/zephyr/ZephyrTrendChart.jsx';

const rupee = (n) => `${Number(n) < 0 ? '-' : ''}₹${compact(Math.abs(Number(n || 0)))}`;
const monthValue = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthIndex = (value) => { const [y, m] = value.split('-').map(Number); return y * 12 + m - 1; };

const STATES = [
  { key: 'locked', label: 'Locked', hint: 'Closed months only' },
  { key: 'unlocked', label: 'Unlocked', hint: 'Live figures of months that are not closed yet' },
  { key: 'all', label: 'All', hint: 'Closed + open months' },
];
const VIEW_NAME = { locked: 'Finalized (closed months)', unlocked: 'Live (open months)', all: 'Closed + open months' };

/** One month-on-month line: smooth line with a soft fill, a value on every point and the exact amount in the tooltip. */
function TrendChart({ title, subtitle, data, dataKey, color, name, className = '' }) {
  const gradientId = `zx-trend-${dataKey}`;
  return (
    <ChartCard title={title} subtitle={subtitle} className={className}>
      <div className="h-72" data-testid={`zx-trend-${dataKey}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 22, right: 16, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={ZX_CHART.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={rupee} tick={{ fontSize: 11 }} width={64} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [rupees(v), name]} />
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
  const [month, setMonth] = useState(() => rows[rows.length - 1]?.month || monthValue(new Date()));
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const current = rows.find((r) => r.month === month);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await zephyrApi.setAssetValue({ month, asset_value: Number(value) });
      pushSuccess('Asset value saved');
      setValue('');
      onSaved();
    } catch (err) {
      pushError(zephyrError(err, 'Failed to save the asset value'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Remove the asset value recorded for ${shortMonth(month)}? Later months will carry forward the earlier figure.`)) return;
    try {
      await zephyrApi.deleteAssetValue(month);
      pushSuccess('Asset value removed');
      onSaved();
    } catch (err) {
      pushError(zephyrError(err, 'Failed to remove the asset value'), 'Could not remove');
    }
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3" aria-label="Record asset value">
      <label className="text-xs font-medium text-tertiary-600">Month
        <input type="month" required max={monthValue(new Date())} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm" />
      </label>
      <label className="text-xs font-medium text-tertiary-600">Other assets (₹)
        <input required type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder={current ? String(current.recorded_asset_value ?? 0) : '0'} className="mt-1 block w-44 rounded-xl border px-3 py-1.5 text-sm" />
      </label>
      <button type="submit" className="btn-primary" disabled={saving || value === ''}>{saving ? 'Saving…' : 'Save asset value'}</button>
      {current?.asset_value_id && <button type="button" className="btn-secondary" onClick={remove}>Remove this month&apos;s value</button>}
      <p className="pb-1.5 text-xs text-tertiary-500">
        Valuation = (Zephyr profit × 240) + (Asset value × 3). Asset value = your <b>active properties</b>, added automatically{current ? ` (${shortMonth(month)}: ${rupees(current.property_value)} for ${current.property_count} propert${current.property_count === 1 ? 'y' : 'ies'})` : ''}, <b>plus the other assets recorded here</b> (a month without one uses the latest earlier figure){current ? ` - ${rupees(current.recorded_asset_value)}${current.asset_value_carried ? ' carried forward' : ''}` : ''}. A property counts at its latest valuation, or at cost until one is recorded, from its purchase date until it is sold.
      </p>
    </form>
  );
}

/**
 * Financial Trends — Revenue, Profit and Valuation, month on month, for Zephyr. Valuation is
 * (Zephyr profit × 240) + (asset value × 3), the same formula as Delphic Global. All values come
 * from GET /zephyr/financials/valuation - nothing is computed or hardcoded here.
 */
function FinancialTrends() {
  const now = new Date();
  // Default window: the last 12 months, ending this month.
  const [from, setFrom] = useState(() => monthValue(new Date(now.getFullYear(), now.getMonth() - 11, 1)));
  const [to, setTo] = useState(() => monthValue(now));
  const [state, setState] = useState('all');
  const rangeError = !from || !to ? 'Pick a start and an end month.' : monthIndex(to) < monthIndex(from) ? 'The end month cannot be before the start month.' : monthIndex(to) - monthIndex(from) >= 36 ? 'Pick at most 36 months.' : null;
  const { data, loading, refresh } = useLiveData(() => (rangeError ? Promise.resolve(null) : zephyrApi.valuation({ from, to, state })), { deps: [from, to, state, rangeError] });
  const rows = useMemo(() => data?.months.map((m) => ({ ...m, label: shortMonth(m.month) })) || [], [data]);
  const { pushError, pushSuccess } = useAlerts();
  const [lockBusy, setLockBusy] = useState(null);
  const thisMonth = monthValue(new Date());

  // Locking a finished month freezes its revenue, expense, salaries and profit; the Locked view and the valuation then read those.
  async function toggleLock(r) {
    let reason;
    if (r.closed) {
      reason = window.prompt(`Reopen ${r.label}? Give a reason (required):`);
      if (reason === null) return;
      if (!reason.trim()) { pushError('A reason is required to reopen a month', 'Not reopened'); return; }
    } else if (!window.confirm(`Lock ${r.label}? Its figures are frozen as they are now. An admin can reopen it later with a reason.`)) return;
    setLockBusy(r.month);
    try {
      if (r.closed) await zephyrApi.reopenMonth(r.month, reason.trim());
      else await zephyrApi.closeMonth(r.month);
      pushSuccess(r.closed ? `${r.label} reopened` : `${r.label} locked`);
      refresh();
    } catch (err) {
      pushError(zephyrError(err, 'Could not update the month'), 'Could not update');
    } finally {
      setLockBusy(null);
    }
  }

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
          {state === 'locked' && 'Revenue, profit and valuation count closed (finalized) months only. Switch to Unlocked or All to include months that are still open.'}
          {state === 'unlocked' && 'Live figures of months that are not closed yet — projections, not final.'}
          {state === 'all' && 'Closed and open months together, from live figures.'}
        </p>
      </div>
      {rangeError && <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">{rangeError}</p>}
      {loading && data && <p role="status" className="text-xs font-medium text-primary-700">Updating for the new filter…</p>}

      {rangeError ? null : loading && !data ? <p className="text-sm text-tertiary-500">Loading…</p> : (
        <div aria-busy={loading} className={`grid gap-4 transition-opacity xl:grid-cols-2 ${loading && data ? 'opacity-50' : ''}`}>
          <TrendChart title="Revenue — month on month" subtitle={`${VIEW_NAME[state]} revenue per month`} data={rows} dataKey="revenue" name="Revenue" color={ZX_CHART.revenue} />
          <TrendChart title="Profit — month on month" subtitle={`${VIEW_NAME[state]} revenue less expense and salaries`} data={rows} dataKey="profit" name="Profit" color={ZX_CHART.profit} />
          <TrendChart className="xl:col-span-2" title="Valuation — month on month" subtitle="(Zephyr profit × 240) + (Asset value × 3)" data={rows} dataKey="valuation" name="Valuation" color={ZX_CHART.expense} />
        </div>
      )}
      {rows.length > 0 && (
        <section className={`overflow-x-auto rounded-2xl border border-tertiary-100 bg-white transition-opacity ${loading && data ? 'opacity-50' : ''}`} aria-label="How the valuation is worked out">
          <h3 className="px-4 pt-3 font-heading text-sm font-semibold text-tertiary-900">How each month&apos;s valuation is worked out</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-tertiary-500"><tr>
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Zephyr profit</th>
              <th className="px-3 py-2 text-right font-medium">× 240</th>
              <th className="px-3 py-2 text-right font-medium">Asset value</th>
              <th className="px-3 py-2 text-right font-medium">× 3</th>
              <th className="px-3 py-2 text-right font-medium">Valuation</th>
              <th className="px-3 py-2 text-right font-medium">Lock</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-t border-tertiary-100">
                  <td className="px-4 py-2">{r.label}{r.closed && <span className="ml-1.5 text-[10px] text-tertiary-400">closed</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupees(r.profit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-tertiary-600">{rupees(r.profit_x)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupees(r.asset_value)}<span className="block text-[10px] text-tertiary-400">properties {rupees(r.property_value)} ({r.property_count}) + other {rupees(r.recorded_asset_value)}{r.asset_value_carried ? ' (carried)' : ''}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums text-tertiary-600">{rupees(r.asset_value_x)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-primary-700">{rupees(r.valuation)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.closed ? (
                      <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" disabled={lockBusy === r.month} onClick={() => toggleLock(r)}><LockOpen className="h-3.5 w-3.5" />Reopen</button>
                    ) : r.month < thisMonth ? (
                      <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" disabled={lockBusy === r.month} onClick={() => toggleLock(r)}><Lock className="h-3.5 w-3.5" />Lock month</button>
                    ) : <span className="text-[11px] text-tertiary-400" title="A month can be locked once it is over">in progress</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-3 pt-2 text-xs text-tertiary-500">Zephyr profit is the same profit shown in the Profit chart: revenue less expense and approved salaries. Use Lock month on a finished month to freeze its figures (Locked view and valuation then read them); Reopen undoes it with a reason. A month cannot be locked while it has draft salary slips.</p>
        </section>
      )}
      {rows.length > 0 && <AssetValueForm rows={rows} onSaved={refresh} />}
      {data?.properties?.length > 0 && (
        <section className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white" aria-label="Properties counted in the asset value">
          <h3 className="px-4 pt-3 font-heading text-sm font-semibold text-tertiary-900">Properties counted in the asset value (as at {shortMonth(data.to)})</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-tertiary-500"><tr><th className="px-4 py-2 font-medium">Property</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 text-right font-medium">Value</th><th className="px-3 py-2 font-medium">Basis</th></tr></thead>
            <tbody>
              {data.properties.map((r) => (
                <tr key={r.id} className="border-t border-tertiary-100"><td className="px-4 py-2"><Link to={`/zephyr/properties/${r.id}`} className="font-medium text-primary-700 hover:underline">{r.code} {r.name}</Link></td><td className="px-3 py-2 capitalize">{r.status.replace(/_/g, ' ')}</td><td className="px-3 py-2 text-right tabular-nums">{rupees(r.value)}</td><td className="px-3 py-2 text-xs text-tertiary-500">{r.basis === 'valuation' ? `Valuation${r.as_of ? ` (${r.as_of})` : ''}` : 'Cost (no valuation recorded yet)'}</td></tr>
              ))}
              <tr className="border-t-2 font-semibold"><td className="px-4 py-2">Total properties</td><td /><td className="px-3 py-2 text-right tabular-nums">{rupees(data.properties.reduce((a2, r) => a2 + r.value, 0))}</td><td /></tr>
            </tbody>
          </table>
          <p className="px-4 pb-3 pt-2 text-xs text-tertiary-500">Active, under-construction, under-renovation and held properties count automatically, from their purchase date until they are sold; sold and inactive ones do not. Record a valuation on the property to move it from cost to market value.</p>
        </section>
      )}
    </div>
  );
}

const TABS = [{ key: 'trends', label: 'Financial trends', icon: TrendingUp }];

export default function ZephyrFinancialsPage() {
  const { me, loading } = useZephyr();
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'overviewValuation')) return <Navigate to="/zephyr" replace />;
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={TABS} value="trends" onChange={() => {}} />
      <FinancialTrends />
    </div>
  );
}
