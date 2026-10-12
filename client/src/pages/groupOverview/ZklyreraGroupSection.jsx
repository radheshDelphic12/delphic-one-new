import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Landmark } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, shortMonth } from '../../lib/format.js';
import { INVESTMENT_STATUS_META } from '../../lib/zklyrera/meta.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import { KpiTile as KpiCard } from './groupUi.jsx';
import Pill from '../../components/ui/Pill.jsx';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const short = (n) => `${Number(n) < 0 ? '-' : ''}₹${compact(Math.abs(Number(n || 0)))}`;

/**
 * Zklyrera Spirits' capital, returns and projections, shown on the Super Admin's group tabs. Capital placed and principal
 * returned are NOT revenue or profit (they sit here, beside the books); projections are plans, never results. Every figure
 * comes from /super-dashboard/group/overview (the company's own finance service).
 */
export default function ZklyreraGroupSection({ zklyrera }) {
  const { switchOrg } = useAuth();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  if (!zklyrera) return null;
  const { money: m, investments: inv, projected, period } = zklyrera;
  const orgId = zklyrera.companies[0]?.org_id;
  const name = zklyrera.companies.length === 1 ? zklyrera.companies[0].org_name : 'Zklyrera companies';

  async function open(targetOrgId, path) {
    try {
      await switchOrg(targetOrgId);
      navigate(path);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to open that company'), 'Something went wrong');
    }
  }
  const monthly = projected.monthly.map((r) => ({ ...r, label: shortMonth(r.month) }));
  const overdue = zklyrera.attention.overdue_investments || [];

  return (
    <section className="space-y-4" aria-label={`${name} capital and returns`}>
      <div className="flex flex-wrap items-baseline gap-x-3 border-b border-tertiary-100 pb-2 pt-3">
        <span className="h-6 w-1.5 self-center rounded-full bg-gradient-to-b from-[#d2ad73] to-[#8a6a3a]" aria-hidden="true" />
        <h2 className="font-heading text-lg font-bold tracking-tight text-tertiary-900">{name} - capital, returns and projections</h2>
        <span className="text-xs text-tertiary-500">Capital placed and principal returned are not revenue or profit; projections are plans</span>
        <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => open(orgId, '/zklyrera/investments')}>Open investments<ArrowUpRight className="h-3.5 w-3.5" /></button>
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

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Projected income and expenses by month" subtitle="The next twelve months, from the projections entered in the company (plans, not results)">
          {monthly.every((r) => !r.projected_income && !r.projected_expenses) ? <p className="py-8 text-center text-sm text-tertiary-500">No projections entered yet.</p> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={short} width={64} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v, n) => [inr(v), n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="projected_income" name="Projected income" stroke="#7B9A82" strokeWidth={2.25} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="projected_expenses" name="Projected expenses" stroke="#7A2E3B" strokeWidth={2.25} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="projected_net" name="Projected net" stroke="#B08D57" strokeWidth={2.25} strokeDasharray="6 4" dot={{ r: 3 }} />
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
        <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
          <h3 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><AlertTriangle className="h-4 w-4 text-amber-600" />Investments past their expected return date ({overdue.length})</h3>
          <ul className="space-y-1">
            {overdue.slice(0, 6).map((r) => (
              <li key={r.id}>
                <button type="button" className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-white" onClick={() => open(r.org_id, '/zklyrera/investments')}>
                  <span className="min-w-0 truncate"><span className="font-medium text-tertiary-900">{r.name}</span> <span className="text-xs text-tertiary-500">{r.code} · expected {r.expected_return_date}</span></span>
                  <Pill tone="red">{inr(r.outstanding_principal)} outstanding</Pill>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {zklyrera.top.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-xs text-tertiary-500"><tr><th className="px-4 py-2 font-medium">Largest open investments</th><th className="px-3 font-medium">Status</th><th className="px-3 text-right font-medium">Invested</th><th className="px-3 text-right font-medium">Outstanding</th><th className="px-3 text-right font-medium">Earnings</th><th className="px-3 font-medium">Expected by</th></tr></thead>
            <tbody>
              {zklyrera.top.map((t) => (
                <tr key={t.id} className="cursor-pointer border-t border-tertiary-100 hover:bg-primary-50/40" onClick={() => open(t.org_id, '/zklyrera/investments')}>
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
