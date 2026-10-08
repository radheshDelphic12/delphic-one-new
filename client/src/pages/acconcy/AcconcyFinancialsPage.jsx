import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Lock, Save, Unlock } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import { pctLabel } from '../../lib/acconcy/meta.js';
import { usePickers } from '../../lib/acconcy/pickers.js';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import AcconcyFinancialTrends from '../../components/acconcy/AcconcyFinancialTrends.jsx';
import FinanceFilters, { BLANK_FILTERS, financeQuery } from '../../components/acconcy/FinanceFilters.jsx';
import { Empty, Kpi, Money, Num, Text, card, inputCls, labelCls } from '../../components/acconcy/ui.jsx';
import { dateLabel, shortMonth } from '../../lib/format.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);
function Th({ children, right }) {
  return <th className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function ServiceTab({ pickers, deals }) {
  const { pushError } = useAlerts();
  const [f, setF] = useState(BLANK_FILTERS);
  const [rows, setRows] = useState(null);
  const [inv, setInv] = useState(null);
  const set = (k, v) => setF((c) => ({ ...c, [k]: v }));
  useEffect(() => {
    const q = financeQuery(f);
    Promise.all([acconcyApi.serviceReport(q), acconcyApi.investmentReport(q).catch(() => null)]).then(([r, i]) => { setRows(r); setInv(i); }, (e) => pushError(acconcyError(e, 'Could not load the report'), 'Load failed'));
  }, [f, pushError]);
  const sum = (key) => (rows || []).reduce((a, r) => a + r[key], 0);
  return (
    <div className="space-y-4">
      <FinanceFilters f={f} set={set} pickers={pickers} deals={deals} onReset={() => setF(BLANK_FILTERS)} />
      {!rows ? <div className="py-8 text-center text-sm text-tertiary-500">Loading...</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Service revenue" value={<Money v={sum('revenue')} />} />
            <Kpi label="Service expenses" value={<Money v={sum('expenses')} />} />
            <Kpi label="Service profit" value={<Money v={sum('profit')} signed />} tone="ax-gold" />
            {inv && <Kpi label="Investment gain / loss" value={<Money v={inv.totals.gain_loss} signed />} hint={`Invested ${Math.round(inv.totals.invested).toLocaleString('en-IN')}`} />}
          </div>
          <section className={`${card} overflow-x-auto`}>
            <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Revenue, expenses and profit by service</h3>
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-xs text-tertiary-500"><tr><Th>Service</Th><Th right>Deals</Th><Th right>Revenue</Th><Th right>Expenses</Th><Th right>Profit</Th><Th right>Margin</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t"><td className="px-3 py-1.5 font-medium text-tertiary-900">{r.label}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.deals}</td><td className="px-3 py-1.5 text-right"><Money v={r.revenue} /></td><td className="px-3 py-1.5 text-right"><Money v={r.expenses} /></td><td className="px-3 py-1.5 text-right"><Money v={r.profit} signed className="font-semibold" /></td><td className="px-3 py-1.5 text-right text-tertiary-500">{pctLabel(r.margin_pct)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className={`${card} overflow-x-auto`}>
            <h3 className="mb-1 font-heading text-sm font-semibold text-tertiary-900">Investments by service</h3>
            <p className="mb-2 text-xs text-tertiary-500">Unrealised gain is shown here but never counted as revenue. Only realised gains reach the revenue above.</p>
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-xs text-tertiary-500"><tr><Th>Service</Th><Th right>Holdings</Th><Th right>Invested</Th><Th right>Current value</Th><Th right>Realised</Th><Th right>Unrealised</Th><Th right>Gain / loss</Th></tr></thead>
              <tbody>
                {rows.filter((r) => r.investment_count > 0).length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-tertiary-400">No investments in this view.</td></tr>}
                {rows.filter((r) => r.investment_count > 0).map((r) => (
                  <tr key={r.key} className="border-t"><td className="px-3 py-1.5 font-medium text-tertiary-900">{r.label}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.investment_count}</td><td className="px-3 py-1.5 text-right"><Money v={r.investment.invested} /></td><td className="px-3 py-1.5 text-right"><Money v={r.investment.current_value} /></td><td className="px-3 py-1.5 text-right"><Money v={r.investment.realised_gain} signed /></td><td className="px-3 py-1.5 text-right"><Money v={r.investment.unrealised_gain} signed /></td><td className="px-3 py-1.5 text-right"><Money v={r.investment.gain_loss} signed className="font-semibold" /><span className="block text-[11px] text-tertiary-400">{pctLabel(r.investment.gain_loss_pct)}</span></td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function FormulaSettings({ formula, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [v, setV] = useState({ profit: formula.profit, asset: formula.asset_value, investments: formula.include_investments, reason: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { setV((c) => ({ ...c, profit: formula.profit, asset: formula.asset_value, investments: formula.include_investments })); }, [formula]);
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await acconcyApi.updateSettings({ profit_multiplier: Number(v.profit), asset_multiplier: Number(v.asset), include_investments_in_assets: v.investments, reason: v.reason.trim() || undefined });
      pushSuccess('Valuation formula updated');
      setV((c) => ({ ...c, reason: '' }));
      onSaved();
    } catch (err) {
      pushError(acconcyError(err, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={save} className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end`}>
      <Num label="Profit multiplier" value={v.profit} onChange={(x) => setV((c) => ({ ...c, profit: x }))} required />
      <Num label="Asset multiplier" value={v.asset} onChange={(x) => setV((c) => ({ ...c, asset: x }))} required />
      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={v.investments} onChange={(e) => setV((c) => ({ ...c, investments: e.target.checked }))} />Count investments as assets</label>
      <Text label="Reason (audited)" value={v.reason} onChange={(x) => setV((c) => ({ ...c, reason: x }))} maxLength={500} />
      <button type="submit" className="btn-primary inline-flex items-center justify-center gap-1.5" disabled={saving}><Save className="h-4 w-4" />Save formula</button>
    </form>
  );
}

function ValuationTab({ me }) {
  const { pushError, pushSuccess } = useAlerts();
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState('');
  const isAdmin = me.role === 'admin';
  const load = useCallback(() => acconcyApi.valuation(Object.fromEntries(Object.entries(range).filter(([, v]) => v))).then(setData, (e) => pushError(acconcyError(e, 'Could not load the valuation'), 'Load failed')), [range, pushError]);
  useEffect(() => { load(); }, [load]);
  async function record() {
    try {
      await acconcyApi.recordValuation({ month: thisMonth(), ...(notes.trim() ? { notes: notes.trim() } : {}) });
      pushSuccess('Valuation recorded in the history');
      setNotes('');
      load();
    } catch (e) {
      pushError(acconcyError(e, 'Could not record'), 'Could not record');
    }
  }
  if (!data) return <div className="py-8 text-center text-sm text-tertiary-500">Loading...</div>;
  const c = data.current;
  const p = data.previous;
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-primary-50 px-3 py-2 text-sm text-primary-900">Valuation = (profit x <b>{data.formula.profit}</b>) + (asset value x <b>{data.formula.asset_value}</b>). Profit is the company net profit of the month; asset value is the active assets{data.formula.include_investments ? ' plus the current value of investments' : ''}. It is a separate business metric: it is never added to revenue or the P&L.</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Current valuation" value={<Money v={c.total} signed />} hint={shortMonth(c.month)} tone="ax-gold" />
        <Kpi label="Previous month" value={p ? <Money v={p.total} signed /> : '-'} hint={p ? shortMonth(p.month) : undefined} />
        <Kpi label="Change" value={data.change === null ? '-' : <Money v={data.change} signed />} />
        <Kpi label="Profit" value={<Money v={c.profit} signed />} hint="of the month" />
        <Kpi label="Profit component" value={<Money v={c.profit_component} signed />} hint={`x ${c.profit_multiplier}`} />
        <Kpi label="Asset value" value={<Money v={c.asset_value} />} hint={`Assets ${Math.round(c.asset_breakdown.assets).toLocaleString('en-IN')} · investments ${Math.round(c.asset_breakdown.investments).toLocaleString('en-IN')}`} />
        <Kpi label="Asset component" value={<Money v={c.asset_component} />} hint={`x ${c.asset_multiplier}`} />
        <Kpi label="Valuation date" value={dateLabel(new Date().toISOString())} hint="today" />
      </div>
      {isAdmin && <FormulaSettings formula={data.formula} onSaved={load} />}
      <div className={`${card} flex flex-wrap items-end gap-3`}>
        <label className={labelCls}>From<input type="month" className={inputCls} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></label>
        <label className={labelCls}>To<input type="month" className={inputCls} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></label>
        <button type="button" className="text-xs font-medium text-tertiary-500 hover:text-primary-700" onClick={() => setRange({ from: '', to: '' })}>Last 12 months</button>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Text label="Note for the history" value={notes} onChange={setNotes} maxLength={500} />
          <button type="button" className="btn-primary" onClick={record}>Record this month&apos;s valuation</button>
        </div>
      </div>
      <section className={`${card} overflow-x-auto`}>
        <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Month by month (live)</h3>
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="text-xs text-tertiary-500"><tr><Th>Month</Th><Th right>Profit</Th><Th right>x {data.formula.profit}</Th><Th right>Asset value</Th><Th right>x {data.formula.asset_value}</Th><Th right>Valuation</Th><Th>Month</Th></tr></thead>
          <tbody>
            {[...data.months].reverse().map((m) => (
              <tr key={m.month} className="border-t"><td className="px-3 py-1.5">{shortMonth(m.month)}</td><td className="px-3 py-1.5 text-right"><Money v={m.profit} signed /></td><td className="px-3 py-1.5 text-right"><Money v={m.profit_component} signed /></td><td className="px-3 py-1.5 text-right"><Money v={m.asset_value} /></td><td className="px-3 py-1.5 text-right"><Money v={m.asset_component} /></td><td className="px-3 py-1.5 text-right"><Money v={m.total} signed className="font-semibold" /></td><td className="px-3 py-1.5">{m.closed ? <Pill tone="green">Closed</Pill> : <Pill tone="gray">Open</Pill>}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className={`${card} overflow-x-auto`}>
        <h3 className="mb-1 font-heading text-sm font-semibold text-tertiary-900">Valuation history</h3>
        <p className="mb-2 text-xs text-tertiary-500">Each row keeps the multipliers used at the time, so it stays auditable if the formula changes later. Closing a month records one automatically.</p>
        {data.history.length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="text-xs text-tertiary-500"><tr><Th>Date</Th><Th>For month</Th><Th right>Profit</Th><Th right>Asset value</Th><Th right>Multipliers</Th><Th right>Profit comp.</Th><Th right>Asset comp.</Th><Th right>Total</Th><Th>Source</Th></tr></thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.id} className="border-t"><td className="px-3 py-1.5">{dateLabel(h.valuation_date)}</td><td className="px-3 py-1.5">{shortMonth(h.month)}</td><td className="px-3 py-1.5 text-right"><Money v={h.profit} signed /></td><td className="px-3 py-1.5 text-right"><Money v={h.asset_value} /></td><td className="px-3 py-1.5 text-right tabular-nums">{h.profit_multiplier} / {h.asset_multiplier}</td><td className="px-3 py-1.5 text-right"><Money v={h.profit_component} signed /></td><td className="px-3 py-1.5 text-right"><Money v={h.asset_component} /></td><td className="px-3 py-1.5 text-right"><Money v={h.total} signed className="font-semibold" /></td><td className="px-3 py-1.5 text-xs text-tertiary-500">{h.source === 'month_close' ? 'Month close' : 'Recorded'}{h.notes ? ` · ${h.notes}` : ''}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function PeriodsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null);
  const load = useCallback(() => acconcyApi.periods().then(setRows, (e) => pushError(acconcyError(e, 'Could not load months'), 'Load failed')), [pushError]);
  useEffect(() => { load(); }, [load]);
  async function close(m) {
    const note = window.prompt(`Close ${shortMonth(m)}? Revenue, expenses, salaries, investments and assets dated in it are locked. Optional note:`, '');
    if (note === null) return;
    try { await acconcyApi.closeMonth(m, note.trim() ? { note: note.trim() } : {}); pushSuccess(`${shortMonth(m)} closed`); load(); } catch (e) { pushError(acconcyError(e, 'Could not close'), 'Could not close'); }
  }
  async function reopen(m) {
    const reason = window.prompt(`Reason for reopening ${shortMonth(m)}:`);
    if (!reason?.trim()) return;
    try { await acconcyApi.reopenMonth(m, { reason: reason.trim() }); pushSuccess(`${shortMonth(m)} reopened`); load(); } catch (e) { pushError(acconcyError(e, 'Could not reopen'), 'Could not reopen'); }
  }
  if (!rows) return <div className="py-8 text-center text-sm text-tertiary-500">Loading...</div>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-tertiary-600">Closing a month freezes its figures. Records dated in a closed month cannot be added or changed until it is reopened (an admin can still edit with a reason, and the close is then flagged as changed).</p>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-primary-50/60 text-xs text-tertiary-500"><tr><Th>Month</Th><Th>Status</Th><Th right>Revenue</Th><Th right>Expenses</Th><Th right>Net profit (live)</Th><Th right>Net profit (at close)</Th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className="border-t">
                <td className="px-3 py-2">{shortMonth(r.month)}</td>
                <td className="px-3 py-2">{r.status === 'closed' ? <Pill tone="green">Closed</Pill> : <Pill tone="gray">Open</Pill>}{r.stale && <Pill tone="amber">Changed since close</Pill>}</td>
                <td className="px-3 py-2 text-right"><Money v={r.live.revenue} /></td>
                <td className="px-3 py-2 text-right"><Money v={r.live.expenses} /></td>
                <td className="px-3 py-2 text-right"><Money v={r.live.net_profit} signed /></td>
                <td className="px-3 py-2 text-right">{r.snapshot ? <Money v={r.snapshot.net_profit} signed /> : '-'}</td>
                <td className="px-3 py-2 text-right">
                  {r.status === 'closed'
                    ? <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => reopen(r.month)}><Unlock className="h-3.5 w-3.5" />Reopen</button>
                    : r.month <= thisMonth() && <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => close(r.month)}><Lock className="h-3.5 w-3.5" />Close month</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AcconcyFinancialsPage() {
  const { me, loading } = useAcconcy();
  const pickers = usePickers();
  const [params, setParams] = useSearchParams();
  const [deals, setDeals] = useState([]);
  useEffect(() => {
    if (me && axCan(me, 'overview')) acconcyApi.deals({ status: 'all' }).then((rows) => setDeals(rows.map((d) => ({ value: d.id, label: `${d.code} ${d.name}` }))), () => {});
  }, [me]);
  const tabs = useMemo(() => (me ? [
    ...(axCan(me, 'valuation') ? [{ key: 'trends', label: 'Financial trends' }] : []),
    ...(axCan(me, 'overview') ? [{ key: 'service', label: 'Service-wise' }] : []),
    ...(axCan(me, 'valuation') ? [{ key: 'valuation', label: 'Valuation' }] : []),
    ...(axCan(me, 'financials') ? [{ key: 'periods', label: 'Month close' }] : []),
  ] : []), [me]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!tabs.length) return <Navigate to="/acconcy" replace />;
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab') : tabs[0].key;
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={tabs} value={tab} onChange={(k) => setParams({ tab: k }, { replace: true })} />
      {tab === 'trends' && <AcconcyFinancialTrends canClose={axCan(me, 'financials')} />}
      {tab === 'service' && <ServiceTab pickers={pickers} deals={deals} />}
      {tab === 'valuation' && <ValuationTab me={me} />}
      {tab === 'periods' && <PeriodsTab />}
    </div>
  );
}
