import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Flag } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, shortMonth } from '../../lib/format.js';
import { FLAG_META, STATUS_META } from '../../lib/foundation/meta.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Pill from '../../components/ui/Pill.jsx';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const short = (n) => `₹${compact(n)}`;
const ATTENTION = [
  ['over_budget', 'Over budget'],
  ['projected_overrun', 'Forecast to exceed the budget'],
  ['ending_with_funds', 'Ending soon with funds left'],
  ['behind_plan', 'Spending behind the plan'],
  ['delayed', 'Past the planned end date'],
  ['completed_unspent', 'Completed with unspent funds'],
];

/**
 * Gulati Foundation's campaign planning, shown on the Super Admin's group tabs. These are budgets and projections, kept
 * apart from the books above them: an allocated budget is not an expense, planned investment is not actual investment,
 * a projection is not a result. Every figure comes from /super-dashboard/group/overview (the foundation's own service).
 * Clicking a campaign opens the foundation workspace (the company switch honours the usual authorisation) at that campaign.
 */
export default function FoundationGroupSection({ foundation }) {
  const { switchOrg } = useAuth();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  if (!foundation) return null;
  const { money: m, campaigns: c, projected } = foundation;
  const orgId = foundation.companies[0]?.org_id;
  const name = foundation.companies.length === 1 ? foundation.companies[0].org_name : 'Foundations';

  async function open(targetOrgId, path) {
    try {
      await switchOrg(targetOrgId);
      navigate(path);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to open that company'), 'Something went wrong');
    }
  }
  const monthly = projected.monthly.map((r) => ({ ...r, label: shortMonth(r.month) }));
  const attention = ATTENTION.map(([key, label]) => [key, label, foundation.attention[key] || []]).filter(([, , rows]) => rows.length);

  return (
    <section className="space-y-4" aria-label={`${name} campaigns`}>
      <div className="flex flex-wrap items-baseline gap-x-3 border-b border-tertiary-100 pb-2 pt-3">
        <span className="h-5 w-1.5 self-center rounded-full bg-[#4f8f60]" aria-hidden="true" />
        <h2 className="font-heading text-lg font-bold tracking-tight text-tertiary-900">{name} - campaigns and fund projections</h2>
        <span className="text-xs text-tertiary-500">Budgets and estimates, kept apart from the income and expenses above</span>
        <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => open(orgId, '/foundation/campaigns')}>Open campaigns<ArrowUpRight className="h-3.5 w-3.5" /></button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Campaigns" value={c.total} hint={`${c.active} active · ${c.planned} planned · ${c.completed} completed`} icon={Flag} theme="green" />
        <KpiCard label="Allocated budget" value={short(m.allocated_budget)} hint={`Planned investment ${short(m.planned_investment)}`} icon={Flag} theme="blue" />
        <KpiCard label="Actual spending" value={short(m.actual_expenditure)} hint={`Programme investment ${short(m.actual_investment)} · funds received ${short(m.funds_received)}`} icon={Flag} theme="orange" />
        <KpiCard label="Remaining allocated budget" value={short(m.remaining_allocated)} hint={`Uncommitted ${short(m.uncommitted)}${m.overspend > 0 ? ` · ${short(m.overspend)} over budget` : ''}`} icon={Flag} theme="purple" />
        <KpiCard label="Projected final expenditure" value={short(m.projected_final_expenditure)} hint={m.projected_overrun > 0 ? `${short(m.projected_overrun)} projected over budget` : 'An estimate, not a transaction'} icon={Flag} theme={m.projected_overrun > 0 ? 'red' : 'blue'} />
        <KpiCard label="Approved commitments" value={short(m.commitments)} hint="Approved, not yet paid" icon={Flag} theme="orange" />
        <KpiCard label="Spent in this period" value={short(foundation.period.actual_expenditure)} hint={`Funds received ${short(foundation.period.funds_received)}`} icon={Flag} theme="green" />
        <KpiCard label="Needs attention" value={foundation.attention_count} hint="Campaigns flagged below" icon={AlertTriangle} theme={foundation.attention_count ? 'red' : 'green'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Projected campaign expenditure by month" subtitle="Remaining planned investment spread over the months ahead, against the plan">
          {monthly.length === 0 ? <p className="py-8 text-center text-sm text-tertiary-500">No projected spending: no campaign has a planned end date and budget yet.</p> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthly} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={short} width={64} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v, n) => [inr(v), n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="planned_investment" name="Planned investment" fill="#9CC9AB" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="projected" name="Projected spending" stroke="#7A6BB5" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2.5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
        <ChartCard title="Projected by quarter" subtitle="April-March financial year">
          {projected.quarterly.length === 0 ? <p className="py-8 text-center text-sm text-tertiary-500">Nothing projected.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-tertiary-500"><tr><th className="py-1">Quarter</th><th className="text-right">Projected spending</th></tr></thead>
              <tbody>{projected.quarterly.map((q) => <tr key={q.label} className="border-t border-tertiary-100"><td className="py-1.5">{q.label}</td><td className="text-right tabular-nums">{inr(q.projected)}</td></tr>)}</tbody>
            </table>
          )}
        </ChartCard>
      </div>

      {attention.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
          <h3 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><AlertTriangle className="h-4 w-4 text-amber-600" />Campaigns that need attention</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {attention.map(([key, label, rows]) => (
              <div key={key}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-tertiary-500">{label} ({rows.length})</div>
                <ul className="space-y-1">
                  {rows.slice(0, 5).map((r) => (
                    <li key={`${key}-${r.campaign_id}`}>
                      <button type="button" className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-white" onClick={() => open(r.org_id, `/foundation/campaigns/${r.campaign_id}`)}>
                        <span className="min-w-0 truncate"><span className="font-medium text-tertiary-900">{r.name}</span> <span className="text-xs text-tertiary-500">{r.code}</span></span>
                        {r.amount ? <Pill tone={FLAG_META[key]?.tone}>{inr(r.amount)}</Pill> : <Pill tone={FLAG_META[key]?.tone}>{FLAG_META[key]?.label}</Pill>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {foundation.top.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-xs text-tertiary-500"><tr><th className="px-4 py-2 font-medium">Largest open campaigns</th><th className="px-3 font-medium">Status</th><th className="px-3 text-right font-medium">Allocated</th><th className="px-3 text-right font-medium">Spent</th><th className="px-3 text-right font-medium">Remaining</th><th className="px-3 font-medium">Ends</th></tr></thead>
            <tbody>
              {foundation.top.map((t) => (
                <tr key={t.id} className="cursor-pointer border-t border-tertiary-100 hover:bg-primary-50/40" onClick={() => open(t.org_id, `/foundation/campaigns/${t.id}`)}>
                  <td className="px-4 py-2"><span className="font-medium text-tertiary-900">{t.name}</span> <span className="text-xs text-tertiary-500">{t.code}</span></td>
                  <td className="px-3"><Pill tone={STATUS_META[t.status]?.tone}>{STATUS_META[t.status]?.label || t.status}</Pill></td>
                  <td className="px-3 text-right tabular-nums">{inr(t.allocated_budget)}</td>
                  <td className="px-3 text-right tabular-nums">{inr(t.actual_expenditure)}</td>
                  <td className="px-3 text-right tabular-nums">{inr(t.remaining_allocated)}</td>
                  <td className="px-3">{t.planned_end || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
