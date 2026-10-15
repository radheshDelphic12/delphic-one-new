import { Link } from 'react-router-dom';
import { Store, TrendingDown, TrendingUp } from 'lucide-react';
import ChartCard from '../ui/ChartCard.jsx';
import Pill from '../ui/Pill.jsx';
import { SITE_STATUS_META } from '../../lib/novarex/meta.js';
import { OutletLineChart } from './OutletCharts.jsx';
import { Money, card } from './ui.jsx';

const pctText = (v) => (v === null || v === undefined ? '-' : `${v}%`);

/**
 * Outlet-wise view of the selected filters: one row per outlet (and one for company-level records, kept apart and never spread
 * over the outlets), the best and weakest outlets over the same period, and a line per outlet for investment, revenue, expenses and net.
 */
export default function OutletsOverview({ outlets, canOpen = true }) {
  if (!outlets) return null;
  const { rows, totals, ranking, trend } = outlets;
  const outletRows = rows.filter((r) => r.outlet_id);
  const company = rows.find((r) => !r.outlet_id);
  const head = (t, right) => <th className={`px-2 py-2 font-medium ${right ? 'text-right' : ''}`}>{t}</th>;
  return (
    <section className="space-y-4" aria-label="Outlets">
      <div className={`${card} overflow-x-auto`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><Store className="h-4 w-4" />Outlet-wise results <span className="text-xs font-normal text-tertiary-500">({outlets.active} active of {outlets.total} outlet{outlets.total === 1 ? '' : 's'})</span></h3>
          {canOpen && <Link to="/novarex/outlets" className="text-xs font-medium text-primary-700 hover:underline">All outlets</Link>}
        </div>
        {rows.length === 0 ? <p className="py-4 text-sm text-tertiary-500">No outlets match these filters yet.</p> : (
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="text-left text-xs text-tertiary-500">
              <tr>{head('Outlet')}{head('Capital invested', true)}{head('Principal back', true)}{head('Revenue', true)}{head('Earnings', true)}{head('Expenses', true)}{head('Net result', true)}{head('Still invested', true)}{head('Net / capital', true)}</tr>
            </thead>
            <tbody>
              {outletRows.map((r) => (
                <tr key={r.outlet_id} className="border-t">
                  <td className="px-2 py-2">
                    {canOpen ? <Link to={`/novarex/outlets/${r.outlet_id}`} className="font-medium text-primary-700 hover:underline">{r.name}</Link> : <span className="font-medium text-tertiary-900">{r.name}</span>}
                    <span className="block text-xs text-tertiary-500">{r.code}{r.ownership_type ? ` · ${r.ownership_type}` : ''}{r.format ? ` · ${r.format}` : ''} {r.status && r.status !== 'active' && <Pill tone={SITE_STATUS_META[r.status]?.tone}>{SITE_STATUS_META[r.status]?.label}</Pill>}</span>
                  </td>
                  <td className="px-2 text-right tabular-nums"><Money v={r.invested_total} /></td>
                  <td className="px-2 text-right tabular-nums"><Money v={r.principal_returned} /></td>
                  <td className="px-2 text-right tabular-nums"><Money v={r.revenue} /></td>
                  <td className="px-2 text-right tabular-nums"><Money v={r.earnings} /></td>
                  <td className="px-2 text-right tabular-nums"><Money v={r.expenses} /></td>
                  <td className="px-2 text-right font-medium tabular-nums"><Money v={r.net_result} signed /></td>
                  <td className="px-2 text-right tabular-nums"><Money v={r.outstanding_principal} /></td>
                  <td className="px-2 text-right tabular-nums">{pctText(r.roi_pct)}</td>
                </tr>
              ))}
              {company && (
                <tr className="border-t bg-tertiary-50/50">
                  <td className="px-2 py-2"><span className="font-medium text-tertiary-800">{company.name}</span><span className="block text-xs text-tertiary-500">Shared overheads and capital that belong to no single outlet - not spread over the outlets</span></td>
                  <td className="px-2 text-right tabular-nums"><Money v={company.invested_total} /></td>
                  <td className="px-2 text-right tabular-nums"><Money v={company.principal_returned} /></td>
                  <td className="px-2 text-right tabular-nums"><Money v={company.revenue} /></td>
                  <td className="px-2 text-right tabular-nums"><Money v={company.earnings} /></td>
                  <td className="px-2 text-right tabular-nums"><Money v={company.expenses} /></td>
                  <td className="px-2 text-right font-medium tabular-nums"><Money v={company.net_result} signed /></td>
                  <td className="px-2 text-right tabular-nums"><Money v={company.outstanding_principal} /></td>
                  <td className="px-2 text-right tabular-nums">{pctText(company.roi_pct)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold">
                <td className="px-2 py-2">Company total</td>
                <td className="px-2 text-right tabular-nums"><Money v={totals.invested_total} /></td>
                <td className="px-2 text-right tabular-nums"><Money v={totals.principal_returned} /></td>
                <td className="px-2 text-right tabular-nums"><Money v={totals.revenue} /></td>
                <td className="px-2 text-right tabular-nums"><Money v={totals.earnings} /></td>
                <td className="px-2 text-right tabular-nums"><Money v={totals.expenses} /></td>
                <td className="px-2 text-right tabular-nums"><Money v={totals.net_result} signed /></td>
                <td className="px-2 text-right tabular-nums"><Money v={totals.outstanding_principal} /></td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
        <p className="mt-2 text-[11px] text-tertiary-500">Revenue = sales revenue and other business income; earnings = investment earnings received; principal back is never income. Net / capital = net result of the period divided by capital invested up to the end of the period - the same period for every outlet.</p>
      </div>

      {(ranking.best.length > 0 || ranking.weakest.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className={card}>
            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tertiary-500"><TrendingUp className="h-4 w-4 text-emerald-600" />Best performing</h4>
            <ul className="space-y-1 text-sm">{ranking.best.map((r) => <li key={r.outlet_id} className="flex justify-between"><span>{r.name}</span><span className="tabular-nums text-emerald-700">{pctText(r.roi_pct)}</span></li>)}</ul>
          </div>
          <div className={card}>
            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tertiary-500"><TrendingDown className="h-4 w-4 text-red-600" />Underperforming</h4>
            {ranking.weakest.length === 0 ? <p className="text-sm text-tertiary-500">Needs more than three outlets with capital invested to rank the weakest.</p> : <ul className="space-y-1 text-sm">{ranking.weakest.map((r) => <li key={r.outlet_id} className="flex justify-between"><span>{r.name}</span><span className={`tabular-nums ${r.roi_pct < 0 ? 'text-red-600' : 'text-tertiary-700'}`}>{pctText(r.roi_pct)}</span></li>)}</ul>}
          </div>
          <p className="text-[11px] text-tertiary-500 md:col-span-2">Ranked by: {ranking.metric}. Outlets without invested capital are not ranked.</p>
        </div>
      )}

      {trend.keys.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Monthly investment by outlet" subtitle="Capital placed, by month"><OutletLineChart rows={trend.investment} keys={trend.keys} label="Monthly investment by outlet" /></ChartCard>
          <ChartCard title="Monthly revenue by outlet" subtitle="Sales revenue, other income and earnings"><OutletLineChart rows={trend.revenue} keys={trend.keys} label="Monthly revenue by outlet" /></ChartCard>
          <ChartCard title="Outlet-wise expenses" subtitle="Operating costs, other expenses and salaries"><OutletLineChart rows={trend.expenses} keys={trend.keys} label="Outlet-wise expenses by month" /></ChartCard>
          <ChartCard title="Outlet-wise profit / loss" subtitle="Net result by month"><OutletLineChart rows={trend.net} keys={trend.keys} label="Outlet-wise net result by month" /></ChartCard>
        </div>
      )}
    </section>
  );
}
