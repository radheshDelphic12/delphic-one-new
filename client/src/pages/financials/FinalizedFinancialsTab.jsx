import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, History, IndianRupee, PiggyBank, TrendingUp, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import KpiCard from '../../components/ui/KpiCard.jsx';
import StatusBadge from '../../components/finance/StatusBadge.jsx';
import { MONTHS } from '../../components/finance/PeriodPicker.jsx';
import { inr } from '../../components/finance/CalculationLockBar.jsx';

const KIND_LABEL = { billing: 'Billing', salary: 'Salary', salary_employee: 'Salary', resource_revenue: 'Resource revenue', vendor_payment: 'Vendor payments', vendor_bill: 'Vendor', expense: 'Expense', financials: 'Financials' };

const STATES = [
  { key: 'locked', label: 'Locked', hint: 'Finalized records only' },
  { key: 'unlocked', label: 'Unlocked', hint: 'Live records not locked yet' },
  { key: 'all', label: 'All', hint: 'Locked + unlocked' },
];

function CategoryRows({ nodes, depth = 0, open, toggle, split }) {
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
          </td>
          {split && <td className="px-3 py-2 text-right tabular-nums text-success-700">{inr(n.locked_amount)}</td>}
          {split && <td className="px-3 py-2 text-right tabular-nums text-tertiary-500">{inr(n.unlocked_amount)}</td>}
          <td className="px-3 py-2 text-right tabular-nums">{inr(n.amount)}</td>
        </tr>
        {hasChildren && isOpen && <CategoryRows nodes={n.children} depth={depth + 1} open={open} toggle={toggle} split={split} />}
      </Fragment>
    );
  });
}

/**
 * Financials — the FINAL state: by default only LOCKED records (billing per
 * project, salary per employee, expenses, vendor billing), organised by
 * business category. Nothing still live appears unless the Unlocked / All
 * filter is chosen, and then it is shown apart. Records are locked in Live
 * Analytics; the Latest Update trail shows changes detected after locking.
 */
export default function FinalizedFinancialsTab() {
  const now = new Date();
  const [range, setRange] = useState({ period_year: now.getFullYear(), from_month: 1, to_month: now.getMonth() + 1 });
  const [state, setState] = useState('locked');
  const [open, setOpen] = useState(() => new Set(['revenue', 'salaries', 'expenses']));
  const params = { ...range, state };
  const { data, loading } = useLiveData(() => apiClient.get('/calculations/financials/records', { params }).then((r) => r.data.data), { deps: [range.period_year, range.from_month, range.to_month, state] });
  const trail = useLiveData(() => apiClient.get('/calculations/financials/summary', { params: range }).then((r) => r.data.data), { deps: [range.period_year, range.from_month, range.to_month] });
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const t = data?.totals;
  const c = data?.counts;
  const split = state === 'all';
  const lockedCount = c ? Object.values(c.locked).reduce((s, n) => s + n, 0) : 0;
  const unlockedCount = c ? Object.values(c.unlocked).reduce((s, n) => s + n, 0) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3">
        <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5" role="group" aria-label="Locked / unlocked">
          {STATES.map((s) => (
            <button key={s.key} type="button" title={s.hint} onClick={() => setState(s.key)} aria-pressed={state === s.key} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${state === s.key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{s.label}</button>
          ))}
        </div>
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
        <p className="pb-1.5 text-xs text-tertiary-500">
          {state === 'locked' && 'Only locked (finalized) records are counted — lock records in Live Analytics.'}
          {state === 'unlocked' && 'Live records that are not locked yet — projections, not final.'}
          {state === 'all' && 'Locked and unlocked records side by side.'}
          {c && ` ${lockedCount} locked${state !== 'locked' ? ` · ${unlockedCount} unlocked` : ''} record(s).`}
        </p>
        {loading && data && <p role="status" className="pb-1.5 text-xs font-medium text-primary-700">Updating for the new filter…</p>}
      </div>

      <div aria-busy={loading} className={`space-y-5 transition-opacity ${loading && data ? 'pointer-events-none opacity-50' : ''}`}>

      <div className="flex flex-wrap gap-2" aria-label="Records per month">
        {(data?.months || []).map((m) => (
          <span key={m.period_month} className="inline-flex items-center gap-1.5 rounded-xl border border-tertiary-100 bg-white px-2.5 py-1.5 text-xs">
            <span className="font-medium text-tertiary-800">{MONTHS[m.period_month - 1].slice(0, 3)}</span>
            {state !== 'unlocked' && <StatusBadge status={m.locked_records ? 'locked' : 'draft'} label={`${m.locked_records} locked`} size="xs" />}
            {state !== 'locked' && m.unlocked_records > 0 && <StatusBadge status="draft" label={`${m.unlocked_records} unlocked`} size="xs" />}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Revenue / sales" value={inr(t?.revenue)} hint={c ? `${state === 'unlocked' ? c.unlocked.billing : c.locked.billing + (split ? c.unlocked.billing : 0)} billing record(s)` : undefined} icon={IndianRupee} theme="green" />
        <KpiCard label="Salaries" value={inr(t?.salaries)} icon={Wallet} theme="purple" />
        <KpiCard label="Expenses" value={inr(t?.expenses)} hint="claims, group charges, vendors" icon={PiggyBank} theme="red" />
        <KpiCard label="Profit" value={inr(t?.profit)} icon={TrendingUp} theme={(t?.profit || 0) < 0 ? 'red' : 'blue'} />
      </div>
      {data?.missing_rates?.length > 0 && <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">Set the {data.missing_rates.join(', ')} exchange rate — those unlocked amounts count as 0 until then.</p>}

      <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-tertiary-500">
            <tr>
              <th className="px-3 py-2 font-medium">Category</th>
              {split && <th className="px-3 py-2 text-right font-medium">Locked</th>}
              {split && <th className="px-3 py-2 text-right font-medium">Unlocked</th>}
              <th className="px-3 py-2 text-right font-medium">{state === 'locked' ? 'Finalized amount' : state === 'unlocked' ? 'Live amount' : 'Total'}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && <tr><td colSpan={split ? 4 : 2} className="px-3 py-4 text-tertiary-400">Loading…</td></tr>}
            {data && <CategoryRows nodes={data.categories} open={open} toggle={toggle} split={split} />}
          </tbody>
        </table>
        {data && state === 'locked' && lockedCount === 0 && <p className="border-t border-tertiary-100 px-3 py-3 text-sm text-tertiary-500">Nothing locked in this range yet — lock billing, salaries, expenses and vendors in Live Analytics.</p>}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><History className="h-4 w-4" /> Latest Update</h2>
        {!trail.data?.latest_updates?.length ? (
          <p className="text-sm text-tertiary-500">No changes since locking in this range.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-tertiary-500">
                <tr><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">What changed</th><th className="px-3 py-2 font-medium">Affects</th><th className="px-3 py-2 font-medium">Who</th><th className="px-3 py-2 font-medium">Old → new amount</th><th className="px-3 py-2 font-medium">Reason / source</th><th className="px-3 py-2 font-medium">Status</th></tr>
              </thead>
              <tbody>
                {trail.data.latest_updates.map((u, i) => (
                  <tr key={u.id || `${u.type}-${u.period_month}-${u.version}-${i}`} className="border-t border-tertiary-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{new Date(u.at).toLocaleString()}</td>
                    <td className="px-3 py-2">{u.what}</td>
                    <td className="px-3 py-2 text-xs">{KIND_LABEL[u.kind || 'financials'] || u.kind}{u.scope_label ? ` · ${u.scope_label}` : ''} · {MONTHS[u.period_month - 1].slice(0, 3)} {u.period_year}</td>
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
    </div>
  );
}
