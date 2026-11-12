import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Landmark } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, shortMonth } from '../../lib/format.js';
import { INVESTMENT_STATUS_META } from '../../lib/novarex/meta.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import { Disclosure, GRID_PROPS, KpiTile as KpiCard, lineProps } from './groupUi.jsx';
import Pill from '../../components/ui/Pill.jsx';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const short = (n) => `${Number(n) < 0 ? '-' : ''}₹${compact(Math.abs(Number(n || 0)))}`;

/**
 * Novarex Pharmaceuticals' capital, returns and projections, shown on the Super Admin's group tabs. Capital placed and principal
 * returned are NOT revenue or profit (they sit here, beside the books); projections are plans, never results. Every figure
 * comes from /super-dashboard/group/overview (the company's own finance service).
 */
export default function NovarexGroupSection({ novarex }) {
  const { switchOrg } = useAuth();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  if (!novarex) return null;
  const { money: m, investments: inv, projected, period } = novarex;
  const orgId = novarex.companies[0]?.org_id;
  const name = novarex.companies.length === 1 ? novarex.companies[0].org_name : 'Novarex companies';

  async function open(targetOrgId, path) {
    try {
      await switchOrg(targetOrgId);
      navigate(path);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to open that company'), 'Something went wrong');
    }
  }
  const monthly = projected.monthly.map((r) => ({ ...r, label: shortMonth(r.month) }));
  const overdue = novarex.attention.overdue_investments || [];

  return (
    <section className="space-y-4" aria-label={`${name} capital and returns`}>
      <div className="flex flex-wrap items-baseline gap-x-3 border-b border-tertiary-100 pb-2 pt-3">
        <span className="h-6 w-1.5 self-center rounded-full bg-gradient-to-b from-[#d2ad73] to-[#8a6a3a]" aria-hidden="true" />
        <h2 className="font-heading text-lg font-bold tracking-tight text-tertiary-900">{name} - outlets, capital, returns and projections</h2>
        <span className="text-xs text-tertiary-500">Capital placed and principal returned are not revenue or profit; projections are plans</span>
        <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => open(orgId, '/novarex/outlets')}>Open outlets<ArrowUpRight className="h-3.5 w-3.5" /></button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Investments" value={inv.total} hint={`${inv.active} active · ${inv.completed} completed · ${inv.overdue} overdue`} icon={Landmark} theme="blue" />
        <KpiCard label="Capital invested (all time)" value={short(m.capital_invested_total)} hint={`Principal returned ${short(m.principal_returned_total)}`} icon={Landmark} theme="purple" />
        <KpiCard label="Principal still invested" value={short(m.outstanding_principal)} hint={`Expected returns still to come ${short(m.expected_returns_outstanding)}`} icon={Landmark} theme="orange" />
        <KpiCard label="Investment earnings (all time)" value={short(m.earnings_total)} hint="The profit on top of the principal" icon={Landmark} theme="green" />
        <KpiCard label="Capital placed (period)" value={short(period.investment_added)} hint={`Principal returned ${short(period.principal_returned)}`} icon={Landmark} theme="blue" />
        <KpiCard label="Net result (period)" value={short(period.net_result)} hint={`Income ${short(period.income)} · expenses ${short(period.expenses)}`} icon={Landmark} theme={period.net_result < 0 ? 'red' : 'green'} />
        <KpiCard label="Cash in / out (period)" value={`${short(period.cash_in)} / ${short(period.cash_out)}`} hint="Money actually received and paid" icon={Landmark} theme="orange" />
        <KpiCard label="Receivables / payables" value={`${short(m.receivables)} / ${short(m.payables)}`} hint="Unpaid income owed to it / unpaid costs it owes" icon={overdue.length ? AlertTriangle : Landmark} theme={overdue.length ? 'red' : 'purple'} />
      </div>

      {novarex.operations && (() => {
        const o = novarex.operations; const k = o.kpis;
        const series = o.series.map((r) => ({ ...r, label: shortMonth(r.month) }));
        return (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Sales revenue (period)" value={short(k.sales_revenue)} hint={`Invoiced without GST, less credit notes · ${k.invoices_issued} invoices`} icon={Landmark} theme="green" />
              <KpiCard label="Gross profit (period)" value={short(k.gross_profit)} hint={`Cost of goods sold ${short(k.cost_of_goods)}${k.gross_margin_pct === null ? '' : ` · margin ${k.gross_margin_pct}%`}`} icon={Landmark} theme={k.gross_profit < 0 ? 'red' : 'green'} />
              <KpiCard label="Inventory value" value={short(k.inventory_value)} hint={`Near expiry ${short(k.near_expiry_value)} · expired ${short(k.expired_stock_value)}`} icon={Landmark} theme="blue" />
              <KpiCard label="Receivables / payables" value={`${short(k.receivables)} / ${short(k.payables)}`} hint={`Overdue receivables ${short(k.receivables_overdue)} · cash collected ${short(k.cash_collected)}`} icon={Landmark} theme="purple" />
              <KpiCard label="Franchise fees (period)" value={short(k.franchise_fees)} hint="Fees, royalties and revenue shares invoiced" icon={Landmark} theme="orange" />
              <KpiCard label="Logistics cost (period)" value={short(k.logistics_cost)} hint={`Freight variance ${short(o.delivery.freight_variance)} · ${o.delivery.on_time}/${o.delivery.delivered} on time`} icon={Landmark} theme="orange" />
              <KpiCard label="Stock alerts" value={o.alerts.expired + o.alerts.near_expiry + o.alerts.below_reorder + o.alerts.recalled} hint={`${o.alerts.expired} expired · ${o.alerts.near_expiry} near expiry · ${o.alerts.below_reorder} below reorder · ${o.alerts.recalled} recalled`} icon={AlertTriangle} theme={o.alerts.expired + o.alerts.recalled ? 'red' : 'blue'} />
              <KpiCard label="Purchases (period)" value={short(k.purchases)} hint="Goods bought, kept as inventory until sold" icon={Landmark} theme="blue" />
            </div>
            <ChartCard title="Sales, cost of goods, gross profit and logistics by month" subtitle="Actual figures from invoices, stock and shipments in the selected period">
              {series.length === 0 ? <p className="py-8 text-center text-sm text-tertiary-500">No activity in this period.</p> : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={short} width={64} />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v, n) => [inr(v), n]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line dataKey="sales" name="Sales revenue" {...lineProps('#0F766E', series.length)} />
                      <Line dataKey="cogs" name="Cost of goods" {...lineProps('#9b3b4b', series.length)} />
                      <Line dataKey="gross_profit" name="Gross profit" {...lineProps('#2563A8', series.length, { dashed: true, width: 2.5 })} />
                      <Line dataKey="logistics" name="Logistics" {...lineProps('#B08D57', series.length)} />
                      <Line dataKey="collections" name="Cash collected" {...lineProps('#5f8f6b', series.length)} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
            {o.outlets.length > 0 && (
              <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="text-left text-xs text-tertiary-500"><tr><th className="px-4 py-2 font-medium">Outlet sales (period)</th><th className="px-3 font-medium">Ownership</th><th className="px-3 text-right font-medium">Sales</th><th className="px-3 text-right font-medium">Cost of goods</th><th className="px-3 text-right font-medium">Gross profit</th><th className="px-3 text-right font-medium">Fees</th><th className="px-3 text-right font-medium">Receivable</th></tr></thead>
                  <tbody>
                    {o.outlets.map((r) => (
                      <tr key={`${r.org_id}-${r.outlet_id || 'none'}`} className="cursor-pointer border-t border-tertiary-100 hover:bg-primary-50/40" onClick={() => open(r.org_id, r.outlet_id ? `/novarex/outlets/${r.outlet_id}` : '/novarex')}>
                        <td className="px-4 py-2 font-medium text-tertiary-900">{r.outlet}</td>
                        <td className="px-3 text-xs text-tertiary-600">{r.ownership || '-'}</td>
                        <td className="px-3 text-right tabular-nums">{inr(r.revenue)}</td>
                        <td className="px-3 text-right tabular-nums">{inr(r.cogs)}</td>
                        <td className={`px-3 text-right tabular-nums ${r.gross_profit < 0 ? 'text-red-600' : ''}`}>{inr(r.gross_profit)}</td>
                        <td className="px-3 text-right tabular-nums">{inr(r.franchise_fees)}</td>
                        <td className="px-3 text-right tabular-nums">{inr(r.receivable)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-tertiary-100 px-4 py-2 text-[11px] text-tertiary-500">Franchise and third-party outlets show only what Novarex sold or invoiced to them. Their own retail sales, salaries and expenses are never counted.</p>
              </div>
            )}
          </>
        );
      })()}

      {novarex.outlets?.rows?.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="text-left text-xs text-tertiary-500"><tr><th className="px-4 py-2 font-medium">Outlets ({novarex.outlets.active} active of {novarex.outlets.total})</th><th className="px-3 font-medium">Type / format</th><th className="px-3 text-right font-medium">Invested</th><th className="px-3 text-right font-medium">Income</th><th className="px-3 text-right font-medium">Expenses</th><th className="px-3 text-right font-medium">Net result</th><th className="px-3 text-right font-medium">Still invested</th></tr></thead>
            <tbody>
              {novarex.outlets.rows.map((s) => (
                <tr key={s.outlet_id} className="cursor-pointer border-t border-tertiary-100 hover:bg-primary-50/40" onClick={() => open(s.org_id, `/novarex/outlets/${s.outlet_id}`)}>
                  <td className="px-4 py-2"><span className="font-medium text-tertiary-900">{s.name}</span> <span className="text-xs text-tertiary-500">{s.code}</span></td>
                  <td className="px-3 text-xs text-tertiary-600">{[s.ownership_type, s.format].filter(Boolean).join(' · ') || '-'}</td>
                  <td className="px-3 text-right tabular-nums">{inr(s.invested_total)}</td>
                  <td className="px-3 text-right tabular-nums">{inr(s.income)}</td>
                  <td className="px-3 text-right tabular-nums">{inr(s.expenses)}</td>
                  <td className={`px-3 text-right tabular-nums ${s.net_result < 0 ? 'text-red-600' : ''}`}>{inr(s.net_result)}</td>
                  <td className="px-3 text-right tabular-nums">{inr(s.outstanding_principal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-tertiary-100 px-4 py-2 text-[11px] text-tertiary-500">Outlet figures cover all time. Company-level overheads ({short(novarex.outlets.company_level_net)} net) are kept apart and are not spread over the outlets.</p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Projected income and expenses by month" subtitle="The next twelve months, from the projections entered in the company (plans, not results)">
          {monthly.every((r) => !r.projected_income && !r.projected_expenses) ? <p className="py-8 text-center text-sm text-tertiary-500">No projections entered yet.</p> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={short} width={64} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v, n) => [inr(v), n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line dataKey="projected_income" name="Projected income" {...lineProps('#5f8f6b', monthly.length)} />
                  <Line dataKey="projected_expenses" name="Projected expenses" {...lineProps('#9b3b4b', monthly.length)} />
                  <Line dataKey="projected_net" name="Projected net" {...lineProps('#B08D57', monthly.length, { dashed: true, width: 2.5 })} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
        <ChartCard title="Next twelve months (plan)" subtitle="Totals of the projections">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-t border-tertiary-100"><td className="py-1.5">Projected income</td><td className="text-right tabular-nums">{inr(projected.total_income)}</td></tr>
              <tr className="border-t border-tertiary-100"><td className="py-1.5">Projected expenses</td><td className="text-right tabular-nums">{inr(projected.total_expenses)}</td></tr>
              <tr className="border-t border-tertiary-100 font-semibold"><td className="py-1.5">Projected net result</td><td className={`text-right tabular-nums ${projected.total_net < 0 ? 'text-red-600' : ''}`}>{inr(projected.total_net)}</td></tr>
            </tbody>
          </table>
        </ChartCard>
      </div>

      {overdue.length > 0 && (
        <Disclosure title="Investments past their expected return date" count={overdue.length} icon={AlertTriangle}>
          <ul className="space-y-1">
            {overdue.slice(0, 6).map((r) => (
              <li key={r.id}>
                <button type="button" className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-white" onClick={() => open(r.org_id, '/novarex/investments')}>
                  <span className="min-w-0 truncate"><span className="font-medium text-tertiary-900">{r.name}</span> <span className="text-xs text-tertiary-500">{r.code} · expected {r.expected_return_date}</span></span>
                  <Pill tone="red">{inr(r.outstanding_principal)} outstanding</Pill>
                </button>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {novarex.top.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-xs text-tertiary-500"><tr><th className="px-4 py-2 font-medium">Largest open investments</th><th className="px-3 font-medium">Status</th><th className="px-3 text-right font-medium">Invested</th><th className="px-3 text-right font-medium">Outstanding</th><th className="px-3 text-right font-medium">Earnings</th><th className="px-3 font-medium">Expected by</th></tr></thead>
            <tbody>
              {novarex.top.map((t) => (
                <tr key={t.id} className="cursor-pointer border-t border-tertiary-100 hover:bg-primary-50/40" onClick={() => open(t.org_id, '/novarex/investments')}>
                  <td className="px-4 py-2"><span className="font-medium text-tertiary-900">{t.name}</span> <span className="text-xs text-tertiary-500">{t.code}</span></td>
                  <td className="px-3"><Pill tone={INVESTMENT_STATUS_META[t.status]?.tone}>{INVESTMENT_STATUS_META[t.status]?.label || t.status}</Pill></td>
                  <td className="px-3 text-right tabular-nums">{inr(t.amount)}</td>
                  <td className="px-3 text-right tabular-nums">{inr(t.outstanding_principal)}</td>
                  <td className="px-3 text-right tabular-nums">{inr(t.earnings)}</td>
                  <td className="px-3">{t.expected_return_date || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
