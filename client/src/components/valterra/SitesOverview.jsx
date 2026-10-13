import { Link } from 'react-router-dom';
import { Mountain, TrendingDown, TrendingUp } from 'lucide-react';
import ChartCard from '../ui/ChartCard.jsx';
import Pill from '../ui/Pill.jsx';
import { SITE_STATUS_META } from '../../lib/valterra/meta.js';
import { SiteLineChart } from './SiteCharts.jsx';
import { Money, card } from './ui.jsx';

const pctText = (v) => (v === null || v === undefined ? '-' : `${v}%`);

/**
 * Site-wise view of the selected filters: one row per mining site (and one for company-level records, kept apart and never spread
 * over the sites), the best and weakest sites over the same period, and a line per site for investment, revenue, expenses and net.
 */
export default function SitesOverview({ sites, canOpen = true }) {
  if (!sites) return null;
  const { rows, totals, ranking, trend } = sites;
  const siteRows = rows.filter((r) => r.site_id);
  const company = rows.find((r) => !r.site_id);
  const head = (t, right) => <th className={`px-2 py-2 font-medium ${right ? 'text-right' : ''}`}>{t}</th>;
  return (
    <section className="space-y-4" aria-label="Mining sites">
      <div className={`${card} overflow-x-auto`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><Mountain className="h-4 w-4" />Site-wise results <span className="text-xs font-normal text-tertiary-500">({sites.active} active of {sites.total} site{sites.total === 1 ? '' : 's'})</span></h3>
          {canOpen && <Link to="/valterra/sites" className="text-xs font-medium text-primary-700 hover:underline">All mining sites</Link>}
        </div>
        {rows.length === 0 ? <p className="py-4 text-sm text-tertiary-500">No mining sites match these filters yet.</p> : (
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="text-left text-xs text-tertiary-500">
              <tr>{head('Site')}{head('Capital invested', true)}{head('Principal back', true)}{head('Revenue', true)}{head('Earnings', true)}{head('Expenses', true)}{head('Net result', true)}{head('Still invested', true)}{head('Net / capital', true)}</tr>
            </thead>
            <tbody>
              {siteRows.map((r) => (
                <tr key={r.site_id} className="border-t">
                  <td className="px-2 py-2">
                    {canOpen ? <Link to={`/valterra/sites/${r.site_id}`} className="font-medium text-primary-700 hover:underline">{r.name}</Link> : <span className="font-medium text-tertiary-900">{r.name}</span>}
                    <span className="block text-xs text-tertiary-500">{r.code}{r.mining_type ? ` · ${r.mining_type}` : ''}{r.material ? ` · ${r.material}` : ''} {r.status && r.status !== 'active' && <Pill tone={SITE_STATUS_META[r.status]?.tone}>{SITE_STATUS_META[r.status]?.label}</Pill>}</span>
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
                  <td className="px-2 py-2"><span className="font-medium text-tertiary-800">{company.name}</span><span className="block text-xs text-tertiary-500">Shared overheads and capital that belong to no single site - not spread over the sites</span></td>
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
        <p className="mt-2 text-[11px] text-tertiary-500">Revenue = mining revenue and other business income; earnings = investment earnings received; principal back is never income. Net / capital = net result of the period divided by capital invested up to the end of the period - the same period for every site.</p>
      </div>

      {(ranking.best.length > 0 || ranking.weakest.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className={card}>
            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tertiary-500"><TrendingUp className="h-4 w-4 text-emerald-600" />Best performing</h4>
            <ul className="space-y-1 text-sm">{ranking.best.map((r) => <li key={r.site_id} className="flex justify-between"><span>{r.name}</span><span className="tabular-nums text-emerald-700">{pctText(r.roi_pct)}</span></li>)}</ul>
          </div>
          <div className={card}>
            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tertiary-500"><TrendingDown className="h-4 w-4 text-red-600" />Underperforming</h4>
            {ranking.weakest.length === 0 ? <p className="text-sm text-tertiary-500">Needs more than three sites with capital invested to rank the weakest.</p> : <ul className="space-y-1 text-sm">{ranking.weakest.map((r) => <li key={r.site_id} className="flex justify-between"><span>{r.name}</span><span className={`tabular-nums ${r.roi_pct < 0 ? 'text-red-600' : 'text-tertiary-700'}`}>{pctText(r.roi_pct)}</span></li>)}</ul>}
          </div>
          <p className="text-[11px] text-tertiary-500 md:col-span-2">Ranked by: {ranking.metric}. Sites without invested capital are not ranked.</p>
        </div>
      )}

      {trend.keys.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Monthly investment by site" subtitle="Capital placed, by month"><SiteLineChart rows={trend.investment} keys={trend.keys} label="Monthly investment by site" /></ChartCard>
          <ChartCard title="Monthly revenue by site" subtitle="Mining revenue, other income and earnings"><SiteLineChart rows={trend.revenue} keys={trend.keys} label="Monthly revenue by site" /></ChartCard>
          <ChartCard title="Site-wise expenses" subtitle="Operating costs, other expenses and salaries"><SiteLineChart rows={trend.expenses} keys={trend.keys} label="Site-wise expenses by month" /></ChartCard>
          <ChartCard title="Site-wise profit / loss" subtitle="Net result by month"><SiteLineChart rows={trend.net} keys={trend.keys} label="Site-wise net result by month" /></ChartCard>
        </div>
      )}
    </section>
  );
}
