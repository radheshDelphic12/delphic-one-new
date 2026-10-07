import { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Download, Lock, Pencil, Plus, Trash2, Unlock } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { gulatiApi, gulatiError } from '../../lib/gulati/api.js';
import { useGulati, gxCan } from '../../lib/gulati/useGulati.js';
import { inr, pctLabel, qtyLabel, useMasters } from '../../lib/gulati/meta.js';
import { usePickers } from '../../lib/gulati/pickers.js';
import { downloadText } from '../../lib/zephyr/csv.js';
import Modal from '../../components/ui/Modal.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import GulatiTrendChart from '../../components/gulati/GulatiTrendChart.jsx';
import { Area, DateInput, Empty, Kpi, Money, Num, Select, Text, card, dayOf, inputCls, labelCls, today, toBody, withReason } from '../../components/gulati/ui.jsx';
import { dateLabel, shortMonth } from '../../lib/format.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);

function Th({ children, right }) {
  return <th className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function FilterRow({ f, set, masters, pickers, deals, onReset }) {
  return (
    <div className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
      <label className={labelCls}>Month<input type="month" className={inputCls} value={f.month} onChange={(e) => set('month', e.target.value)} /></label>
      <DateInput label="From" value={f.from} onChange={(v) => set('from', v)} disabled={Boolean(f.month)} />
      <DateInput label="To" value={f.to} onChange={(v) => set('to', v)} disabled={Boolean(f.month)} />
      <Select label="Trading type" value={f.trading_type} onChange={(v) => set('trading_type', v)} options={masters.types.map((t) => ({ value: t.key, label: t.label }))} blank="All types" />
      <Select label="Client" value={f.party_id} onChange={(v) => set('party_id', v)} options={pickers.clients} blank="All clients" />
      <Select label="Vendor" value={f.vendor_id} onChange={(v) => set('vendor_id', v)} options={pickers.vendors} blank="All vendors" />
      <Select label="Deal" value={f.deal_id} onChange={(v) => set('deal_id', v)} options={deals} blank="All deals" />
      <Select label="Employee / contractor" value={f.assignee_id} onChange={(v) => set('assignee_id', v)} options={[...pickers.employees, ...pickers.contractors]} blank="Anyone" />
      <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="button" className="text-xs font-medium text-tertiary-500 hover:text-primary-700" onClick={onReset}>Clear filters</button></div>
    </div>
  );
}

function EntryForm({ initial, categories, dealOptions, partyOptions, onSubmit, onCancel, saving }) {
  const [v, setV] = useState({ type: initial?.type || 'expense', entry_date: dayOf(initial?.entry_date) || today(), category_id: initial?.category_id || '', deal_id: initial?.deal_id || '', party_id: initial?.party_id || '', amount: initial?.amount ?? '', tax: initial?.tax ?? 0, payment_mode: initial?.payment_mode ?? '', reference: initial?.reference ?? '', description: initial?.description ?? '' });
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const cats = categories.filter((c) => c.kind === v.type && c.active);
  useEffect(() => { if (!cats.some((c) => c.id === v.category_id)) setV((c) => ({ ...c, category_id: cats[0]?.id || '' })); }, [v.type]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(toBody(v, { numbers: ['amount', 'tax'] })); }} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Type" value={v.type} onChange={set('type')} options={[{ value: 'expense', label: 'Expense' }, { value: 'revenue', label: 'Other income' }]} />
        <Select label="Category" value={v.category_id} onChange={set('category_id')} options={cats.map((c) => ({ value: c.id, label: c.name }))} required />
        <Select label="Deal" value={v.deal_id} onChange={set('deal_id')} options={dealOptions} blank="Company level (no deal)" />
        <Select label="Client / vendor" value={v.party_id} onChange={set('party_id')} options={partyOptions} blank="None" />
        <DateInput label="Date" value={v.entry_date} onChange={set('entry_date')} required />
        <Num label="Amount" value={v.amount} onChange={set('amount')} required />
        <Num label="Tax (GST)" value={v.tax} onChange={set('tax')} />
        <Text label="Payment mode" value={v.payment_mode} onChange={set('payment_mode')} maxLength={60} />
        <Text label="Reference" className="sm:col-span-2" value={v.reference} onChange={set('reference')} maxLength={200} />
        <Area label="Description" className="sm:col-span-2" rows={2} value={v.description} onChange={set('description')} maxLength={1000} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </form>
  );
}

function ExpensesTab({ me, dealOptions, partyOptions }) {
  const { pushError, pushSuccess } = useAlerts();
  const [f, setF] = useState({ scope: '', type: '', from: '', to: '', category_id: '' });
  const [data, setData] = useState({ rows: [], totals: { revenue: 0, expense: 0 } });
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await gulatiApi.ledger(Object.fromEntries(Object.entries(f).filter(([, v]) => v)));
      setData({ rows: res.data, totals: res.totals });
    } catch (e) { pushError(gulatiError(e, 'Could not load'), 'Load failed'); }
  }, [f, pushError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { gulatiApi.categories().then(setCategories, () => {}); }, []);

  async function save(body) {
    setSaving(true);
    try {
      await withReason(async (reason) => {
        const payload = { ...body, ...(reason ? { reason } : {}) };
        return modal.row ? gulatiApi.updateEntry(modal.row.id, payload) : gulatiApi.createEntry(payload);
      });
      pushSuccess('Saved');
      setModal(null);
      load();
    } catch (e) { pushError(gulatiError(e, 'Could not save'), 'Could not save'); } finally { setSaving(false); }
  }
  async function del(row) {
    if (!window.confirm('Delete this entry?')) return;
    try { await withReason((reason) => gulatiApi.deleteEntry(row.id, reason)); load(); } catch (e) { pushError(gulatiError(e, 'Could not delete'), 'Delete failed'); }
  }
  const set = (k) => (v) => setF((c) => ({ ...c, [k]: v }));
  return (
    <div className="space-y-3">
      <div className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-5`}>
        <Select label="Level" value={f.scope} onChange={set('scope')} options={[{ value: 'deal', label: 'Deal expenses' }, { value: 'company', label: 'Company level' }]} blank="All" />
        <Select label="Type" value={f.type} onChange={set('type')} options={[{ value: 'expense', label: 'Expense' }, { value: 'revenue', label: 'Other income' }]} blank="All" />
        <Select label="Category" value={f.category_id} onChange={set('category_id')} options={categories.map((c) => ({ value: c.id, label: c.name }))} blank="All" />
        <DateInput label="From" value={f.from} onChange={set('from')} />
        <DateInput label="To" value={f.to} onChange={set('to')} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-tertiary-600">Expenses <Money v={data.totals.expense} className="font-semibold" /> · Other income <Money v={data.totals.revenue} className="font-semibold" /></div>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setModal({})}><Plus className="h-4 w-4" />Add entry</button>
      </div>
      {data.rows.length === 0 ? <Empty>No entries match.</Empty> : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-primary-50/60 text-xs text-tertiary-500"><tr><Th>Date</Th><Th>Category</Th><Th>Deal</Th><Th>Party</Th><Th>Description</Th><Th right>Amount</Th><th /></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{dateLabel(r.entry_date)}</td>
                  <td className="px-3 py-2">{r.category_name}</td>
                  <td className="px-3 py-2">{r.deal ? `${r.deal.code}` : <span className="text-tertiary-400">Company</span>}</td>
                  <td className="px-3 py-2">{r.party?.name || '-'}</td>
                  <td className="px-3 py-2 text-tertiary-600">{r.description || r.reference || '-'}</td>
                  <td className={`px-3 py-2 text-right ${r.type === 'revenue' ? 'text-green-700' : ''}`}>{r.type === 'revenue' ? '+' : ''}<Money v={r.amount} /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap"><button type="button" title="Edit" className="mr-1 rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setModal({ row: r })}><Pencil className="h-4 w-4" /></button><button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => del(r)}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(modal)} onClose={() => setModal(null)} wide title={modal?.row ? 'Edit entry' : 'Add entry'}>
        {modal && <EntryForm initial={modal.row} categories={categories} dealOptions={dealOptions} partyOptions={partyOptions} saving={saving} onSubmit={save} onCancel={() => setModal(null)} />}
      </Modal>
      {me.role === 'admin' && <p className="text-xs text-tertiary-400">Entries dated in a closed month need an admin reason, and flag that month for re-closing.</p>}
    </div>
  );
}

function PeriodsTab({ canClose }) {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null);
  const load = useCallback(() => gulatiApi.periods().then(setRows, (e) => pushError(gulatiError(e), 'Load failed')), [pushError]);
  useEffect(() => { load(); }, [load]);
  async function close(p) {
    if (!window.confirm(`Close ${shortMonth(p.month)}? Sales, purchases and expenses dated in it will be locked.`)) return;
    try { await gulatiApi.closeMonth(p.month, {}); pushSuccess('Month closed'); load(); } catch (e) { pushError(gulatiError(e, 'Could not close'), 'Could not close'); }
  }
  async function reopen(p) {
    const reason = window.prompt(`Reason for reopening ${shortMonth(p.month)}:`);
    if (!reason?.trim()) return;
    try { await gulatiApi.reopenMonth(p.month, { reason: reason.trim() }); pushSuccess('Month reopened'); load(); } catch (e) { pushError(gulatiError(e, 'Could not reopen'), 'Could not reopen'); }
  }
  if (!rows) return <div className="text-sm text-tertiary-500">Loading...</div>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-tertiary-600">Closing a month locks its sales, purchases and expenses. Changes after that need an admin reason and flag the month as out of date until it is reopened and closed again.</p>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-primary-50/60 text-xs text-tertiary-500"><tr><Th>Month</Th><Th>Status</Th><Th right>Sales</Th><Th right>Gross profit</Th><Th right>Net profit (live)</Th><Th right>Net at close</Th><th /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.month} className="border-t">
                <td className="px-3 py-2 font-medium">{shortMonth(p.month)}</td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><Pill tone={p.status === 'closed' ? 'gray' : 'green'}>{p.status === 'closed' ? 'Closed' : 'Open'}</Pill>{p.stale && <Pill tone="amber">Changed since close</Pill>}</span></td>
                <td className="px-3 py-2 text-right"><Money v={p.live.sales_revenue} /></td>
                <td className="px-3 py-2 text-right"><Money v={p.live.gross_profit} signed /></td>
                <td className="px-3 py-2 text-right"><Money v={p.live.net_profit} signed /></td>
                <td className="px-3 py-2 text-right">{p.snapshot ? <Money v={p.snapshot.net_profit} signed /> : '-'}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {canClose && p.status === 'open' && p.month <= thisMonth() && <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => close(p)}><Lock className="h-3.5 w-3.5" />Close month</button>}
                  {canClose && p.status === 'closed' && <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => reopen(p)}><Unlock className="h-3.5 w-3.5" />Reopen</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GulatiFinancePage() {
  const { me, loading } = useGulati();
  const { pushError } = useAlerts();
  const masters = useMasters();
  const pickers = usePickers();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const BLANK = { month: '', from: '', to: '', trading_type: '', party_id: '', vendor_id: '', deal_id: '', assignee_id: '' };
  const [f, setF] = useState(() => ({ ...BLANK, ...Object.fromEntries(Object.keys(BLANK).map((k) => [k, params.get(k)]).filter(([, v]) => v)) }));
  const [pnl, setPnl] = useState(null);
  const [report, setReport] = useState(null);
  const [overview, setOverview] = useState(null);
  const [deals, setDeals] = useState([]);

  const load = useCallback(async () => {
    try {
      const q = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
      const [p, r, o] = await Promise.all([gulatiApi.pnl(q), gulatiApi.tradingReport(q), gulatiApi.overview(q)]);
      setPnl(p); setReport(r); setOverview(o);
    } catch (e) { pushError(gulatiError(e, 'Could not load figures'), 'Load failed'); }
  }, [f, pushError]);
  useEffect(() => { if (me && gxCan(me, 'overview')) load(); }, [me, load]);
  useEffect(() => { if (me && gxCan(me, 'deals')) gulatiApi.deals({ status: 'all' }).then((d) => setDeals(d.map((x) => ({ value: x.id, label: `${x.code} ${x.name}` }))), () => {}); }, [me]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!gxCan(me, 'overview')) return <Navigate to="/gulati" replace />;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'pnl', label: 'P&L' },
    { key: 'types', label: 'By trading type' },
    ...(gxCan(me, 'ledger') ? [{ key: 'expenses', label: 'Expenses' }] : []),
    ...(gxCan(me, 'financials') ? [{ key: 'close', label: 'Month close' }] : []),
  ];
  const set = (k, v) => setF((c) => ({ ...c, [k]: v, ...(k === 'month' && v ? { from: '', to: '' } : {}) }));
  const partyOptions = [...new Map([...pickers.clients, ...pickers.vendors].map((o) => [o.value, o])).values()];
  const t = pnl?.totals;
  const filterRow = <FilterRow f={f} set={set} masters={masters} pickers={pickers} deals={deals} onReset={() => setF(BLANK)} />;

  function exportCsv() {
    const rows = [['Month', 'Sales', 'Purchase cost', 'Gross profit', 'Deal expenses', 'Company expenses', 'Other income', 'Net profit']];
    pnl.by_month.forEach((m) => rows.push([m.month, m.sales_revenue, m.purchase_cost, m.gross_profit, m.deal_expenses, m.company_expenses, m.company_income, m.net_profit]));
    downloadText('gulati-pnl.csv', rows.map((r) => r.join(',')).join('\n'));
  }

  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={tabs} value={tab} onChange={(k) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', k); return n; }, { replace: true })} className="min-w-0" />

      {tab === 'overview' && overview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Total revenue" value={<Money v={overview.sales_revenue} />} />
            <Kpi label="Total purchase cost" value={<Money v={overview.purchase_cost} />} />
            <Kpi label="Gross profit" value={<Money v={overview.gross_profit} signed />} hint={`Margin ${pctLabel(overview.gross_margin_pct)}`} />
            <Kpi label="Net profit" value={<Money v={overview.net_profit} signed />} hint={`Margin ${pctLabel(overview.net_margin_pct)}`} tone="gx-copper" />
            <Kpi label="Total expenses" value={<Money v={overview.deal_expenses + overview.company_expenses} />} hint={`Deal ${inr(overview.deal_expenses)}`} />
            <Kpi label="Outstanding receivables" value={<Money v={overview.receivables} />} />
            <Kpi label="Outstanding payables" value={<Money v={overview.payables} />} />
            <Kpi label="Active deal value" value={<Money v={overview.active_deal_value} />} hint={`${overview.active_deals} active deals`} />
            <Kpi label="Completed deal value" value={<Money v={overview.completed_deal_value} />} hint={`${overview.completed_deals} completed deals`} />
            {overview.valuation && <Kpi label="Company valuation" value={overview.valuation.value === null ? '-' : <Money v={overview.valuation.value} />} hint={`${overview.valuation.method.replace('_', ' ')} on the last 12 months`} />}
          </div>
          <section className={card}>
            <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Monthly performance</h3>
            {pnl?.by_month.length ? <GulatiTrendChart rows={pnl.by_month} /> : <Empty>No sales or purchases recorded yet.</Empty>}
          </section>
          <p className="text-xs text-tertiary-400">Valuation is derived from these figures through the method set in Gulati setup. It is never edited by an individual deal.</p>
        </div>
      )}

      {tab === 'pnl' && (
        <div className="space-y-4">
          {filterRow}
          {t && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Kpi label="Sales revenue" value={<Money v={t.sales_revenue} />} />
                <Kpi label="Purchase cost" value={<Money v={t.purchase_cost} />} />
                <Kpi label="Gross profit" value={<Money v={t.gross_profit} signed />} hint={`Margin ${pctLabel(t.gross_margin_pct)}`} />
                <Kpi label="Deal expenses" value={<Money v={t.deal_expenses} />} />
                <Kpi label="Net profit" value={<Money v={t.net_profit} signed />} hint={`Margin ${pctLabel(t.net_margin_pct)}`} tone="gx-copper" />
              </div>
              {pnl.company_level_included && (t.company_expenses > 0 || t.company_income > 0) && <p className="text-xs text-tertiary-500">Net profit also includes company-level expenses {inr(t.company_expenses)} and other income {inr(t.company_income)}.</p>}
              <div className="flex justify-end"><button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={exportCsv} disabled={!pnl.by_month.length}><Download className="h-4 w-4" />Export CSV</button></div>
              <div className="overflow-x-auto rounded-xl border bg-white">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead className="bg-primary-50/60 text-xs text-tertiary-500"><tr><Th>Month</Th><Th right>Sales</Th><Th right>Purchase cost</Th><Th right>Gross profit</Th><Th right>Deal expenses</Th><Th right>Company exp.</Th><Th right>Net profit</Th></tr></thead>
                  <tbody>
                    {pnl.by_month.map((m) => <tr key={m.month} className="border-t"><td className="px-3 py-2 font-medium">{shortMonth(m.month)}</td><td className="px-3 py-2 text-right"><Money v={m.sales_revenue} /></td><td className="px-3 py-2 text-right"><Money v={m.purchase_cost} /></td><td className="px-3 py-2 text-right"><Money v={m.gross_profit} signed /></td><td className="px-3 py-2 text-right"><Money v={m.deal_expenses} /></td><td className="px-3 py-2 text-right"><Money v={m.company_expenses} /></td><td className="px-3 py-2 text-right font-semibold"><Money v={m.net_profit} signed /></td></tr>)}
                    {pnl.by_month.length === 0 && <tr><td className="px-3 py-6 text-center text-tertiary-400" colSpan={7}>Nothing in this period.</td></tr>}
                  </tbody>
                </table>
              </div>
              {pnl.by_deal.length > 0 && (
                <section className={card}>
                  <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">By deal</h3>
                  <div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-sm"><thead className="text-xs text-tertiary-500"><tr><Th>Deal</Th><Th right>Sales</Th><Th right>Purchase</Th><Th right>Expenses</Th><Th right>Net</Th></tr></thead><tbody>{pnl.by_deal.map((d) => <tr key={d.id} className="border-t"><td className="px-3 py-1.5">{d.code} {d.name}</td><td className="px-3 py-1.5 text-right"><Money v={d.sales_revenue} /></td><td className="px-3 py-1.5 text-right"><Money v={d.purchase_cost} /></td><td className="px-3 py-1.5 text-right"><Money v={d.deal_expenses} /></td><td className="px-3 py-1.5 text-right font-medium"><Money v={d.net_profit} signed /></td></tr>)}</tbody></table></div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'types' && (
        <div className="space-y-4">
          {filterRow}
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-primary-50/60 text-xs text-tertiary-500"><tr><Th>Trading type</Th><Th right>Deals</Th><Th right>Purchase qty</Th><Th right>Sales qty</Th><Th right>Purchase value</Th><Th right>Sales value</Th><Th right>Gross profit</Th><Th right>Expenses</Th><Th right>Net profit</Th></tr></thead>
              <tbody>
                {(report || []).map((r) => <tr key={r.key} className="border-t"><td className="px-3 py-2 font-medium">{r.label}</td><td className="px-3 py-2 text-right tabular-nums">{r.deals}</td><td className="px-3 py-2 text-right tabular-nums">{qtyLabel(r.purchase_qty)}</td><td className="px-3 py-2 text-right tabular-nums">{qtyLabel(r.sales_qty)}</td><td className="px-3 py-2 text-right"><Money v={r.purchase_cost} /></td><td className="px-3 py-2 text-right"><Money v={r.sales_revenue} /></td><td className="px-3 py-2 text-right"><Money v={r.gross_profit} signed /></td><td className="px-3 py-2 text-right"><Money v={r.deal_expenses} /></td><td className="px-3 py-2 text-right font-semibold"><Money v={r.net_profit} signed /></td></tr>)}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-tertiary-400">Quantities are summed across the units recorded on each purchase and sale.</p>
        </div>
      )}

      {tab === 'expenses' && gxCan(me, 'ledger') && <ExpensesTab me={me} dealOptions={deals} partyOptions={partyOptions} />}
      {tab === 'close' && gxCan(me, 'financials') && <PeriodsTab canClose={gxCan(me, 'closeMonth')} />}
    </div>
  );
}
