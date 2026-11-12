import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Lock, LockOpen } from 'lucide-react';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { fxApi, foundationError } from '../../lib/foundation/api.js';
import { fxCan, useFoundation } from '../../lib/foundation/useFoundation.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, shortMonth } from '../../lib/format.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { FX_COLORS } from '../../components/foundation/FxCharts.jsx';

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

function Trend({ title, subtitle, data, dataKey, color, name, className = '' }) {
  const id = `fx-trend-${dataKey}`;
  return (
    <ChartCard title={title} subtitle={subtitle} className={className}>
      <div className="h-72" data-testid={id}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 22, right: 16, left: 4, bottom: 0 }}>
            <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.22} /><stop offset="100%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke={FX_COLORS.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={rupee} tick={{ fontSize: 11 }} width={64} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [rupees(v), name]} />
            <Area type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} fill={`url(#${id})`} dot={{ r: 2.5, fill: color, strokeWidth: 0 }} activeDot={{ r: 4 }} isAnimationActive={false}>
              <LabelList dataKey={dataKey} position="top" formatter={(v) => (v ? rupee(v) : '')} style={{ fontSize: 10, fill: '#6B7280' }} />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/**
 * Financials of the foundation itself: income (funds received), expenses (paid spending) and the fund balance, month by
 * month, with the same Locked / Unlocked / All views and month close as the other companies. Allocated budgets,
 * commitments, pledges and internal transfers are not income or expense, so they never appear here.
 */
export default function FoundationFinancialsPage() {
  const { me, loading } = useFoundation();
  const { pushError, pushSuccess } = useAlerts();
  const now = new Date();
  const [from, setFrom] = useState(() => monthValue(new Date(now.getFullYear(), now.getMonth() - 11, 1)));
  const [to, setTo] = useState(() => monthValue(now));
  const [state, setState] = useState('all');
  const [busy, setBusy] = useState(null);
  const rangeError = !from || !to ? 'Pick a start and an end month.' : monthIndex(to) < monthIndex(from) ? 'The end month cannot be before the start month.' : monthIndex(to) - monthIndex(from) >= 36 ? 'Pick at most 36 months.' : null;
  const { data, loading: busyData, refresh } = useLiveData(() => (rangeError ? Promise.resolve(null) : fxApi.valuation({ from, to, state })), { enabled: Boolean(me), deps: [from, to, state, rangeError] });
  const rows = useMemo(() => data?.months.map((m) => ({ ...m, label: shortMonth(m.month) })) || [], [data]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !fxCan(me, 'financials')) return <Navigate to="/foundation" replace />;
  const canClose = fxCan(me, 'closeMonth');
  const thisMonth = monthValue(now);

  async function toggleLock(r) {
    let reason;
    if (r.closed) {
      reason = window.prompt(`Reopen ${r.label}? Give a reason (required):`);
      if (reason === null) return;
      if (!reason.trim()) { pushError('A reason is required to reopen a month', 'Not reopened'); return; }
    } else if (!window.confirm(`Lock ${r.label}? Its figures are frozen as they are now. Money dated in it then needs an admin reason to change.`)) return;
    setBusy(r.month);
    try {
      if (r.closed) await fxApi.reopenMonth(r.month, { reason: reason.trim() });
      else await fxApi.closeMonth(r.month, {});
      pushSuccess(r.closed ? `${r.label} reopened` : `${r.label} locked`);
      refresh();
    } catch (err) { pushError(foundationError(err, 'Could not update the month'), 'Could not update'); } finally { setBusy(null); }
  }

  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={[{ key: 't', label: 'Financial trends' }]} value="t" onChange={() => {}} />
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-3">
        <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5" role="group" aria-label="Locked / unlocked / all">
          {STATES.map(({ key, label, hint }) => (
            <button key={key} type="button" title={hint} onClick={() => setState(key)} aria-pressed={state === key} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${state === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-tertiary-600">Start month<input type="month" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm" /></label>
          <label className="text-xs font-medium text-tertiary-600">End month<input type="month" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm" /></label>
        </div>
        <p className="w-full text-xs text-tertiary-500">
          {state === 'locked' && 'Income, expenses and the fund balance count closed (finalized) months only. Switch to Unlocked or All to include months that are still open.'}
          {state === 'unlocked' && 'Live figures of months that are not closed yet - not final.'}
          {state === 'all' && 'Closed and open months together, from live figures.'}
        </p>
      </div>
      {rangeError && <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">{rangeError}</p>}
      {busyData && data && <p role="status" className="text-xs font-medium text-primary-700">Updating for the new filter…</p>}
      {rangeError ? null : busyData && !data ? <p className="text-sm text-tertiary-500">Loading…</p> : (
        <div aria-busy={busyData} className={`grid gap-4 transition-opacity xl:grid-cols-2 ${busyData && data ? 'opacity-50' : ''}`}>
          <Trend title="Income - month on month" subtitle={`${VIEW_NAME[state]} funds received`} data={rows} dataKey="income" name="Income" color={FX_COLORS.investment} />
          <Trend title="Expenses - month on month" subtitle={`${VIEW_NAME[state]} paid spending`} data={rows} dataKey="expenses" name="Expenses" color={FX_COLORS.expenditure} />
          <Trend className="xl:col-span-2" title="Fund balance - month on month" subtitle="Funds received minus paid spending, running total" data={rows} dataKey="fund_balance" name="Fund balance" color={FX_COLORS.funding} />
        </div>
      )}
      {rows.length > 0 && (
        <section className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white" aria-label="Income and expenses by month">
          <h3 className="px-4 pt-3 font-heading text-sm font-semibold text-tertiary-900">Income and expenses by month</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-tertiary-500"><tr>
              <th className="px-4 py-2 font-medium">Month</th><th className="px-3 py-2 text-right font-medium">Income</th><th className="px-3 py-2 text-right font-medium">Expenses</th>
              <th className="px-3 py-2 text-right font-medium">Surplus / (deficit)</th><th className="px-3 py-2 text-right font-medium">Fund balance</th>{canClose && <th className="px-3 py-2 text-right font-medium">Lock</th>}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-t border-tertiary-100">
                  <td className="px-4 py-2">{r.label}{r.closed && <span className="ml-1.5 text-[10px] text-tertiary-400">closed</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupees(r.income)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupees(r.expenses)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.surplus < 0 ? 'text-red-600' : ''}`}>{rupees(r.surplus)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-primary-700">{rupees(r.fund_balance)}</td>
                  {canClose && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.closed ? <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" disabled={busy === r.month} onClick={() => toggleLock(r)}><LockOpen className="h-3.5 w-3.5" />Reopen</button>
                        : r.month <= thisMonth ? <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" disabled={busy === r.month} onClick={() => toggleLock(r)}><Lock className="h-3.5 w-3.5" />Lock month</button> : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-3 pt-2 text-xs text-tertiary-500">Income is funding that has been <b>received</b>; expenses are spending that has been <b>paid</b>. Allocated budgets, approved commitments, pledges and internal transfers are not income or expense. A foundation has no valuation, so none is shown.</p>
        </section>
      )}
    </div>
  );
}
