import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Lock, LockOpen } from 'lucide-react';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, shortMonth } from '../../lib/format.js';
import ChartCard from '../ui/ChartCard.jsx';

export const AX_CHART = { revenue: '#4F8A6B', profit: '#3F4B52', valuation: '#B08D3C', grid: '#E5E0D2' };

const rupee = (n) => `${Number(n) < 0 ? '-' : ''}₹${compact(Math.abs(Number(n || 0)))}`;
const rupees = (n) => `${Number(n) < 0 ? '-' : ''}₹${Math.abs(Number(n || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
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
  const gradientId = `ax-trend-${dataKey}`;
  return (
    <ChartCard title={title} subtitle={subtitle} className={className}>
      <div className="h-72" data-testid={`ax-trend-${dataKey}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 22, right: 16, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={AX_CHART.grid} vertical={false} />
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

/**
 * Financial Trends - Revenue, Profit and Valuation, month on month, for Acconcy Finance. Same layout as the Gulati
 * Industries page. Valuation = (profit x profit multiplier) + (asset value x asset multiplier); every value comes
 * from GET /acconcy/finance/valuation - nothing is computed or hardcoded here.
 */
export default function AcconcyFinancialTrends({ canClose }) {
  const { pushError, pushSuccess } = useAlerts();
  const now = new Date();
  const [from, setFrom] = useState(() => monthValue(new Date(now.getFullYear(), now.getMonth() - 11, 1)));
  const [to, setTo] = useState(() => monthValue(now));
  const [state, setState] = useState('all');
  const [lockBusy, setLockBusy] = useState(null);
  const rangeError = !from || !to ? 'Pick a start and an end month.' : monthIndex(to) < monthIndex(from) ? 'The end month cannot be before the start month.' : monthIndex(to) - monthIndex(from) >= 36 ? 'Pick at most 36 months.' : null;
  const { data, loading, refresh } = useLiveData(() => (rangeError ? Promise.resolve(null) : acconcyApi.valuation({ from, to, state })), { deps: [from, to, state, rangeError] });
  const rows = useMemo(() => data?.months.map((m) => ({ ...m, label: shortMonth(m.month) })) || [], [data]);
  const thisMonth = monthValue(now);
  const f = data?.formula;

  async function toggleLock(r) {
    let reason;
    if (r.closed) {
      reason = window.prompt(`Reopen ${r.label}? Give a reason (required):`);
      if (reason === null) return;
      if (!reason.trim()) { pushError('A reason is required to reopen a month', 'Not reopened'); return; }
    } else if (!window.confirm(`Lock ${r.label}? Its figures are frozen as they are now. An admin can reopen it later with a reason.`)) return;
    setLockBusy(r.month);
    try {
      if (r.closed) await acconcyApi.reopenMonth(r.month, { reason: reason.trim() });
      else await acconcyApi.closeMonth(r.month, {});
      pushSuccess(r.closed ? `${r.label} reopened` : `${r.label} locked`);
      refresh();
    } catch (err) {
      pushError(acconcyError(err, 'Could not update the month'), 'Could not update');
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
          {state === 'unlocked' && 'Live figures of months that are not closed yet - projections, not final.'}
          {state === 'all' && 'Closed and open months together, from live figures.'}
        </p>
      </div>
      {rangeError && <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">{rangeError}</p>}
      {loading && data && <p role="status" className="text-xs font-medium text-primary-700">Updating for the new filter…</p>}

      {rangeError ? null : loading && !data ? <p className="text-sm text-tertiary-500">Loading…</p> : (
        <div aria-busy={loading} className={`grid gap-4 transition-opacity xl:grid-cols-2 ${loading && data ? 'opacity-50' : ''}`}>
          <TrendChart title="Revenue - month on month" subtitle={`${VIEW_NAME[state]} revenue per month`} data={rows} dataKey="revenue" name="Revenue" color={AX_CHART.revenue} />
          <TrendChart title="Profit - month on month" subtitle={`${VIEW_NAME[state]} net profit (deals, deal expenses and company expenses)`} data={rows} dataKey="profit" name="Profit" color={AX_CHART.profit} />
          <TrendChart className="xl:col-span-2" title="Valuation - month on month" subtitle={`(Acconcy profit × ${f?.profit ?? ''}) + (Asset value × ${f?.asset_value ?? ''})`} data={rows} dataKey="total" name="Valuation" color={AX_CHART.valuation} />
        </div>
      )}
      {rows.length > 0 && (
        <section className={`overflow-x-auto rounded-2xl border border-tertiary-100 bg-white transition-opacity ${loading && data ? 'opacity-50' : ''}`} aria-label="How the valuation is worked out">
          <h3 className="px-4 pt-3 font-heading text-sm font-semibold text-tertiary-900">How each month&apos;s valuation is worked out</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-tertiary-500"><tr>
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Acconcy profit</th>
              <th className="px-3 py-2 text-right font-medium">× {f?.profit}</th>
              <th className="px-3 py-2 text-right font-medium">Asset value</th>
              <th className="px-3 py-2 text-right font-medium">× {f?.asset_value}</th>
              <th className="px-3 py-2 text-right font-medium">Valuation</th>
              {canClose && <th className="px-3 py-2 text-right font-medium">Lock</th>}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-t border-tertiary-100">
                  <td className="px-4 py-2">{r.label}{r.closed && <span className="ml-1.5 text-[10px] text-tertiary-400">closed</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupees(r.profit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-tertiary-600">{rupees(r.profit_component)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupees(r.asset_value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-tertiary-600">{rupees(r.asset_component)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-primary-700">{rupees(r.total)}</td>
                  {canClose && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.closed ? (
                        <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" disabled={lockBusy === r.month} onClick={() => toggleLock(r)}><LockOpen className="h-3.5 w-3.5" />Reopen</button>
                      ) : r.month <= thisMonth ? (
                        <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" disabled={lockBusy === r.month} onClick={() => toggleLock(r)}><Lock className="h-3.5 w-3.5" />Lock month</button>
                      ) : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-3 pt-2 text-xs text-tertiary-500">
            Acconcy profit is the same profit shown in the Profit chart. Asset value is the active assets{f?.include_investments ? ' plus the current value of investments' : ''} - add or change them in <Link to="/acconcy/investments" className="font-medium text-primary-700 hover:underline">Investments &amp; assets</Link>. Use Lock month to freeze a month&apos;s figures; Reopen undoes it with a reason.
          </p>
        </section>
      )}
    </div>
  );
}
