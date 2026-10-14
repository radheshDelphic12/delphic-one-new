import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Building2 } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { compact } from '../../lib/format.js';
import { Disclosure, KpiTile as KpiCard } from './groupUi.jsx';
import Pill from '../../components/ui/Pill.jsx';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const short = (n) => `${Number(n) < 0 ? '-' : ''}₹${compact(Math.abs(Number(n || 0)))}`;
const show = (v, format) => (v === null || v === undefined ? 'N/A' : format === 'money' ? short(v) : format === 'pct' ? `${v}%` : Number(v).toLocaleString('en-IN'));

/**
 * One company's insight on the Group Finance tab, for the companies that have no dedicated section (Delphic Global,
 * Gulati Industries, Zephyr, Acconcy). The server sends every company in the same shape (groupInsights.service.js),
 * so this draws them all: KPI tiles, what needs attention, and the biggest items. Figures are the company's own.
 */
export default function CompanyInsightSection({ insight }) {
  const { switchOrg } = useAuth();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  if (!insight) return null;

  async function open() {
    try {
      await switchOrg(insight.org_id);
      navigate(insight.open_path || '/');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to open that company'), 'Something went wrong');
    }
  }

  return (
    <section className="space-y-4" aria-label={`${insight.org_name} insights`}>
      <div className="flex flex-wrap items-baseline gap-x-3 border-b border-tertiary-100 pb-2 pt-3">
        <span className="h-6 w-1.5 self-center rounded-full bg-gradient-to-b from-primary-400 to-primary-700" aria-hidden="true" />
        <h2 className="font-heading text-lg font-bold tracking-tight text-tertiary-900">{insight.org_name} - {insight.title.toLowerCase()}</h2>
        <span className="text-xs text-tertiary-500">{insight.subtitle}</span>
        <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={open}>Open company<ArrowUpRight className="h-3.5 w-3.5" /></button>
      </div>

      {insight.error ? <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-tertiary-500">{insight.subtitle}. Try again in a minute.</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {insight.kpis.map((k) => <KpiCard key={k.label} label={k.label} value={show(k.value, k.format)} hint={k.hint} icon={Building2} theme={k.tone} />)}
          </div>

          {insight.attention && (
            <Disclosure title={insight.attention.title} count={insight.attention.rows.length} icon={AlertTriangle}>
              <ul className="space-y-1">
                {insight.attention.rows.map((r, i) => (
                  <li key={`${r.label}-${i}`}>
                    <button type="button" className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-white" onClick={open}>
                      <span className="min-w-0 truncate"><span className="font-medium text-tertiary-900">{r.label}</span> <span className="text-xs text-tertiary-500">{r.detail}</span></span>
                      {r.tag ? <Pill tone="red">{inr(r.tag)} due</Pill> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}

          {insight.top && (
            <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
              <table className="w-full min-w-[28rem] text-sm">
                <thead className="text-left text-xs text-tertiary-500">
                  <tr>{insight.top.columns.map((c, i) => <th key={c.key} className={`px-3 py-2 font-medium ${i === 0 ? 'px-4' : ''} ${c.format ? 'text-right' : ''}`}>{i === 0 ? insight.top.title : c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {insight.top.rows.map((r, i) => (
                    <tr key={i} className="cursor-pointer border-t border-tertiary-100 hover:bg-primary-50/40" onClick={open}>
                      {insight.top.columns.map((c, j) => <td key={c.key} className={`px-3 py-2 ${j === 0 ? 'px-4 font-medium text-tertiary-900' : ''} ${c.format ? 'text-right tabular-nums' : ''}`}>{c.format ? show(r[c.key], c.format) : r[c.key]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
