import { useMemo, useState } from 'react';
import { IndianRupee, TrendingUp, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { inr } from '../../components/finance/CalculationLockBar.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);
const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500';
const thr = `${th} text-right`;
const td = 'px-3 py-2 align-top';
const tdr = `${td} text-right tabular-nums`;
const tone = (n) => (Number(n) < 0 ? 'text-danger-700' : 'text-success-700');

function Breakdown({ title, items, total }) {
  return (
    <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <div className="flex items-center justify-between"><h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3><span className="text-sm font-semibold tabular-nums">{inr(total)}</span></div>
      {items.length === 0 ? <p className="mt-3 text-sm text-tertiary-500">Nothing in this period.</p> : (
        <ul className="mt-3 divide-y divide-tertiary-100 text-sm">
          {items.map((n) => (
            <li key={n.key} className="py-2">
              <div className="flex items-center justify-between gap-3"><span className="font-medium text-tertiary-800">{n.label}</span><span className="tabular-nums">{inr(n.amount)}</span></div>
              {n.children?.length > 0 && (
                <ul className="mt-1 space-y-0.5 pl-3 text-xs text-tertiary-600">
                  {n.children.slice(0, 8).map((c) => <li key={c.key} className="flex justify-between gap-3"><span className="truncate">{c.label}</span><span className="tabular-nums">{inr(c.amount)}</span></li>)}
                  {n.children.length > 8 && <li className="text-tertiary-400">+ {n.children.length - 8} more</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Live Analytics > Earnings & profit: what the company has earned and what is left, up to today. Pick a month or a range (the current month by
 * default). A locked month shows its locked figures; an open month is live up to today, with the salary earned so far (not the whole month's pay).
 */
export default function EarningsProfitTab() {
  const [from, setFrom] = useState(thisMonth());
  const [to, setTo] = useState(thisMonth());
  const params = useMemo(() => ({ from, to }), [from, to]);
  const { data, loading } = useLiveData(() => apiClient.get('/analytics/earnings-profit', { params }).then((r) => r.data.data), { deps: [from, to], intervalMs: 60000 });
  const t = data?.totals;
  const asOf = data?.as_of ? new Date(`${data.as_of}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="space-y-4" data-testid="earnings-profit">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <div><label className="mb-1 block text-xs font-medium text-tertiary-600">From month</label><input type="month" className={FIELD_INPUT} aria-label="From month" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs font-medium text-tertiary-600">To month</label><input type="month" className={FIELD_INPUT} aria-label="To month" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
        {asOf && <p className="pb-2 text-xs text-tertiary-500" data-testid="as-of">Up to {asOf}. A running month counts what is earned and spent until today; a locked month shows its locked figures.</p>}
      </div>

      {loading && !data ? <Skeleton className="h-48" /> : data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Earnings (revenue)" value={inr(t.revenue)} icon={IndianRupee} theme="blue" />
            <KpiCard label="Salary earned to date" value={inr(t.salaries_to_date)} icon={Wallet} theme="blue" />
            <KpiCard label="Expenses" value={inr(t.expenses)} icon={Wallet} theme="blue" />
            <KpiCard label="Profit to date" value={inr(t.profit_to_date)} icon={TrendingUp} theme={t.profit_to_date < 0 ? 'red' : 'blue'} />
          </div>
          <p className="text-xs text-tertiary-500">Profit to date = earnings - salary earned so far - expenses (vendor payments included). {t.salaries_full_month !== t.salaries_to_date && <>With the full month salary the profit would be <b className={tone(t.profit_full_month)}>{inr(t.profit_full_month)}</b>.</>}</p>

          <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
            <table className="min-w-full text-sm">
              <thead className="bg-canvas-muted"><tr>
                <th className={th}>Month</th><th className={th}>Figures</th><th className={thr}>Earnings</th><th className={thr}>Salary to date</th><th className={thr}>Vendor payments</th><th className={thr}>Expenses (total)</th><th className={thr}>Profit to date</th><th className={thr}>Profit with full salary</th>
              </tr></thead>
              <tbody className="divide-y divide-tertiary-100">
                {data.months.map((m) => (
                  <tr key={`${m.period_year}-${m.period_month}`} data-testid="earnings-row">
                    <td className={`${td} whitespace-nowrap font-medium`}>{MONTHS[m.period_month - 1]} {m.period_year}</td>
                    <td className={td}>{m.source === 'locked' ? 'Locked' : m.open ? 'Live, up to today' : 'Live'}</td>
                    <td className={tdr}>{inr(m.revenue)}</td>
                    <td className={tdr}>{inr(m.salaries_to_date)}</td>
                    <td className={tdr}>{inr(m.vendor_payments)}</td>
                    <td className={tdr}>{inr(m.expenses)}</td>
                    <td className={`${tdr} font-semibold ${tone(m.profit_to_date)}`}>{inr(m.profit_to_date)}</td>
                    <td className={`${tdr} ${tone(m.profit_full_month)}`}>{inr(m.profit_full_month)}</td>
                  </tr>
                ))}
              </tbody>
              {data.months.length > 1 && (
                <tfoot className="bg-canvas-muted"><tr>
                  <td className={`${td} font-semibold`} colSpan={2}>Total</td>
                  <td className={`${tdr} font-semibold`}>{inr(t.revenue)}</td><td className={tdr}>{inr(t.salaries_to_date)}</td><td className={tdr}>{inr(t.vendor_payments)}</td><td className={tdr}>{inr(t.expenses)}</td>
                  <td className={`${tdr} font-semibold ${tone(t.profit_to_date)}`}>{inr(t.profit_to_date)}</td><td className={`${tdr} ${tone(t.profit_full_month)}`}>{inr(t.profit_full_month)}</td>
                </tr></tfoot>
              )}
            </table>
          </div>

          {data.months.some((m) => m.blockers.length > 0) && <p className="rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-800">{data.months.flatMap((m) => m.blockers).map((b) => b.message).join(' ')}</p>}

          <div className="grid gap-4 lg:grid-cols-2">
            <Breakdown title="Where the earnings come from" items={data.revenue_breakdown} total={t.revenue} />
            <Breakdown title="Where the money goes (expenses)" items={data.expense_breakdown} total={t.expenses} />
          </div>
        </>
      )}
    </div>
  );
}
