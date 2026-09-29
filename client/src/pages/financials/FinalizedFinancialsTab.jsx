import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, History, IndianRupee, PiggyBank, TrendingUp, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import KpiCard from '../../components/ui/KpiCard.jsx';
import StatusBadge from '../../components/finance/StatusBadge.jsx';
import PeriodPicker, { MONTHS, currentPeriod, periodLabel } from '../../components/finance/PeriodPicker.jsx';
import CalculationLockBar, { inr } from '../../components/finance/CalculationLockBar.jsx';

const KIND_LABEL = { billing: 'Billing', salary: 'Salary', resource_revenue: 'Resource revenue', vendor_payment: 'Vendor payments', financials: 'Financials' };

function CategoryRows({ nodes, depth = 0, open, toggle, sign = 1 }) {
  return nodes.map((n) => {
    const hasChildren = n.children?.length > 0;
    const isOpen = open.has(n.key);
    return (
      <Fragment key={n.key}>
        <tr className={`border-t border-tertiary-100 ${depth === 0 ? 'bg-tertiary-50/70 font-semibold' : ''}`}>
          <td className="py-2 pr-3" style={{ paddingLeft: `${12 + depth * 20}px` }}>
            {hasChildren ? (
              <button type="button" className="inline-flex items-center gap-1 text-left" onClick={() => toggle(n.key)} aria-expanded={isOpen}>
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{n.label}
              </button>
            ) : <span className="pl-5">{n.label}</span>}
            {n.note && <span className="block pl-5 text-xs font-normal text-amber-700">{n.note}</span>}
          </td>
          <td className="px-3 py-2 text-right tabular-nums">{inr(n.amount * sign)}</td>
        </tr>
        {hasChildren && isOpen && <CategoryRows nodes={n.children} depth={depth + 1} open={open} toggle={toggle} />}
      </Fragment>
    );
  });
}

/** A month's live category preview — what locking it would snapshot. */
function MonthPreview({ period }) {
  const { data, loading } = useLiveData(() => apiClient.get('/analytics/financial-month', { params: period }).then((r) => r.data.data), { deps: [period.period_month, period.period_year] });
  const [open, setOpen] = useState(() => new Set(['revenue', 'salaries', 'expenses']));
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  if (loading && !data) return <p className="text-sm text-tertiary-400">Loading…</p>;
  if (!data) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-tertiary-500">{data.source === 'locked' ? `Locked version ${data.locked_version} of ${periodLabel(period)}.` : `Live figures for ${periodLabel(period)} — locking snapshots exactly these.`} Components already locked (billing per project, salary, vendor payments) contribute their locked figures.</p>
      <table className="w-full text-sm"><tbody><CategoryRows nodes={data.categories} open={open} toggle={toggle} /></tbody></table>
      <p className="text-right text-sm font-semibold">Profit {inr(data.totals.profit)}</p>
    </div>
  );
}

/**
 * Financials — the FINAL approved state: only locked months, aggregated by
 * business category (Revenue / Salaries / Expenses), with the Latest Update
 * trail. Live Analytics stays dynamic; a month moves here when it is locked.
 */
export default function FinalizedFinancialsTab() {
  const now = new Date();
  const [range, setRange] = useState({ period_year: now.getFullYear(), from_month: 1, to_month: 12 });
  const [finalizeFor, setFinalizeFor] = useState(() => {
    const p = currentPeriod();
    return p.period_month === 1 ? { period_month: 12, period_year: p.period_year - 1 } : { period_month: p.period_month - 1, period_year: p.period_year };
  });
  const [open, setOpen] = useState(() => new Set(['revenue', 'salaries', 'expenses']));
  const { data, loading, refresh } = useLiveData(() => apiClient.get('/calculations/financials/summary', { params: range }).then((r) => r.data.data), { deps: [range.period_year, range.from_month, range.to_month] });
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const t = data?.totals;
  const finalizedCount = data?.months.filter((m) => m.finalized).length || 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3">
        <label className="text-xs font-medium text-tertiary-600">Year
          <select value={range.period_year} onChange={(e) => setRange((r) => ({ ...r, period_year: Number(e.target.value) }))} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
            {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-tertiary-600">From
          <select value={range.from_month} onChange={(e) => setRange((r) => ({ ...r, from_month: Number(e.target.value), to_month: Math.max(r.to_month, Number(e.target.value)) }))} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-tertiary-600">To
          <select value={range.to_month} onChange={(e) => setRange((r) => ({ ...r, to_month: Number(e.target.value), from_month: Math.min(r.from_month, Number(e.target.value)) }))} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <p className="pb-1.5 text-xs text-tertiary-500">{finalizedCount} of {data?.months.length ?? '…'} months finalized — only finalized months are counted below.</p>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Month status">
        {(data?.months || []).map((m) => (
          <span key={m.period_month} className="inline-flex items-center gap-1.5 rounded-xl border border-tertiary-100 bg-white px-2.5 py-1.5 text-xs">
            <span className="font-medium text-tertiary-800">{MONTHS[m.period_month - 1].slice(0, 3)}</span>
            <StatusBadge status={m.finalized ? m.status : 'draft'} label={m.finalized ? `${m.status === 'change_detected' ? 'Change Detected' : 'Locked'} v${m.version}` : 'Not finalized'} size="xs" />
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Revenue / sales" value={inr(t?.revenue)} icon={IndianRupee} theme="green" />
        <KpiCard label="Salaries" value={inr(t?.salaries)} icon={Wallet} theme="purple" />
        <KpiCard label="Expenses" value={inr(t?.expenses)} icon={PiggyBank} theme="red" />
        <KpiCard label="Profit" value={inr(t?.profit)} icon={TrendingUp} theme={(t?.profit || 0) < 0 ? 'red' : 'blue'} />
      </div>

      <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-tertiary-500"><tr><th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 text-right font-medium">Finalized amount</th></tr></thead>
          <tbody>
            {loading && !data && <tr><td colSpan={2} className="px-3 py-4 text-tertiary-400">Loading…</td></tr>}
            {data && data.categories.length === 0 && <tr><td colSpan={2} className="px-3 py-4 text-tertiary-400">No finalized month in this range yet — lock a month below.</td></tr>}
            {data && <CategoryRows nodes={data.categories} open={open} toggle={toggle} />}
          </tbody>
        </table>
      </section>

      <section className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">Finalize a month into Financials</h2>
          <PeriodPicker value={finalizeFor} onChange={setFinalizeFor} label="Month" />
        </div>
        <CalculationLockBar kind="financials" period={finalizeFor} title="Financials" onChanged={() => refresh?.()} />
        <MonthPreview period={finalizeFor} />
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><History className="h-4 w-4" /> Latest Update</h2>
        {!data?.latest_updates?.length ? (
          <p className="text-sm text-tertiary-500">No changes since finalization in this range.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-tertiary-500">
                <tr><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">What changed</th><th className="px-3 py-2 font-medium">Affects</th><th className="px-3 py-2 font-medium">Who</th><th className="px-3 py-2 font-medium">Old → new amount</th><th className="px-3 py-2 font-medium">Reason / source</th><th className="px-3 py-2 font-medium">Status</th></tr>
              </thead>
              <tbody>
                {data.latest_updates.map((u, i) => (
                  <tr key={u.id || `${u.type}-${u.period_month}-${u.version}-${i}`} className="border-t border-tertiary-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{new Date(u.at).toLocaleString()}</td>
                    <td className="px-3 py-2">{u.what}</td>
                    <td className="px-3 py-2 text-xs">{KIND_LABEL[u.kind || 'financials']}{u.scope_label && u.kind === 'billing' ? ` · ${u.scope_label}` : ''} · {MONTHS[u.period_month - 1].slice(0, 3)} {u.period_year}</td>
                    <td className="px-3 py-2 text-xs">{u.by?.name || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums">{inr(u.old_amount)} → {inr(u.new_amount)}</td>
                    <td className="px-3 py-2 text-xs capitalize">{(u.reason || '—').replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2">{u.type === 'recalculated' ? <StatusBadge status="locked" label={`Re-finalized v${u.version}`} size="xs" /> : <StatusBadge status={u.status} size="xs" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
