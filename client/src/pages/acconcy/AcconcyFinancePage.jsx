import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import { SERVICE_META, SERVICE_TYPES, pctLabel } from '../../lib/acconcy/meta.js';
import { usePickers } from '../../lib/acconcy/pickers.js';
import { downloadText } from '../../lib/zephyr/csv.js';
import Modal from '../../components/ui/Modal.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import AcconcyTrendChart from '../../components/acconcy/AcconcyTrendChart.jsx';
import EntryForm from '../../components/acconcy/EntryForm.jsx';
import FinanceFilters, { BLANK_FILTERS, financeQuery } from '../../components/acconcy/FinanceFilters.jsx';
import { Empty, Kpi, Money, card, withReason } from '../../components/acconcy/ui.jsx';
import { dateLabel, shortMonth } from '../../lib/format.js';

function Th({ children, right }) {
  return <th className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const BLANK_ENTRY_FILTERS = { type: '', scope: '', category_id: '', service_type: '', party_id: '', vendor_id: '', deal_id: '', from: '', to: '' };

function PnlTab({ pickers, deals }) {
  const { pushError } = useAlerts();
  const [f, setF] = useState(BLANK_FILTERS);
  const [data, setData] = useState(null);
  const reqId = useRef(0);
  const set = (k, v) => setF((c) => ({ ...c, [k]: v }));
  useEffect(() => {
    const id = ++reqId.current;
    acconcyApi.pnl(financeQuery(f)).then((d) => { if (id === reqId.current) setData(d); }, (e) => pushError(acconcyError(e, 'Could not load the P&L'), 'Load failed'));
  }, [f, pushError]);
  const t = data?.totals;

  function exportCsv() {
    if (!data) return;
    const rows = [['Month', 'Revenue', 'Expenses', 'Salaries', 'Contractor costs', 'Net profit', 'Margin %'], ...data.by_month.map((m) => [m.month, m.revenue, m.expenses, m.salaries, m.contractor_costs, m.net_profit, m.margin_pct ?? ''])];
    downloadText('acconcy-pnl.csv', rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  }

  return (
    <div className="space-y-4">
      <FinanceFilters f={f} set={set} pickers={pickers} deals={deals} onReset={() => setF(BLANK_FILTERS)} />
      {!data ? <div className="py-8 text-center text-sm text-tertiary-500">Loading...</div> : (
        <>
          {!data.company_level_included && <div className="rounded-xl bg-primary-50 px-3 py-2 text-xs text-primary-900">A deal filter is on, so only deal revenue and deal expenses are shown (no company-level income, operating expenses or salaries).</div>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Revenue" value={<Money v={t.revenue} />} hint={`Deals ${Math.round(t.deal_revenue).toLocaleString('en-IN')} · other ${Math.round(t.other_revenue).toLocaleString('en-IN')}`} />
            <Kpi label="Deal expenses" value={<Money v={t.deal_expenses} />} />
            <Kpi label="Operating expenses" value={<Money v={t.operational_expenses} />} />
            <Kpi label="Salaries" value={<Money v={t.salaries} />} />
            <Kpi label="Contractor costs" value={<Money v={t.contractor_costs} />} />
            <Kpi label="Total expenses" value={<Money v={t.expenses} />} />
            <Kpi label="Net profit" value={<Money v={t.net_profit} signed />} hint={`Margin ${pctLabel(t.margin_pct)}`} tone="ax-gold" />
          </div>
          {data.by_month.length > 0 && (
            <section className={card}>
              <div className="mb-2 flex items-center justify-between"><h3 className="font-heading text-sm font-semibold text-tertiary-900">Month by month</h3><button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={exportCsv}><Download className="h-3.5 w-3.5" />CSV</button></div>
              <AcconcyTrendChart rows={data.by_month} />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="text-xs text-tertiary-500"><tr><Th>Month</Th><Th right>Revenue</Th><Th right>Expenses</Th><Th right>Salaries + contractors</Th><Th right>Net profit</Th><Th right>Margin</Th></tr></thead>
                  <tbody>
                    {data.by_month.map((m) => (
                      <tr key={m.month} className="border-t"><td className="px-3 py-1.5">{shortMonth(m.month)}</td><td className="px-3 py-1.5 text-right"><Money v={m.revenue} /></td><td className="px-3 py-1.5 text-right"><Money v={m.expenses} /></td><td className="px-3 py-1.5 text-right"><Money v={m.salaries + m.contractor_costs} /></td><td className="px-3 py-1.5 text-right"><Money v={m.net_profit} signed className="font-semibold" /></td><td className="px-3 py-1.5 text-right text-tertiary-500">{pctLabel(m.margin_pct)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <section className={`${card} overflow-x-auto`}>
              <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">By service</h3>
              {data.by_service.length === 0 ? <Empty>No deal activity in this view.</Empty> : (
                <table className="w-full min-w-[26rem] text-sm">
                  <thead className="text-xs text-tertiary-500"><tr><Th>Service</Th><Th right>Revenue</Th><Th right>Expenses</Th><Th right>Profit</Th></tr></thead>
                  <tbody>{data.by_service.map((s) => <tr key={s.key} className="border-t"><td className="px-3 py-1.5">{s.label}</td><td className="px-3 py-1.5 text-right"><Money v={s.revenue} /></td><td className="px-3 py-1.5 text-right"><Money v={s.expenses} /></td><td className="px-3 py-1.5 text-right"><Money v={s.net_profit} signed className="font-semibold" /></td></tr>)}</tbody>
                </table>
              )}
            </section>
            <section className={`${card} overflow-x-auto`}>
              <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">By deal</h3>
              {data.by_deal.length === 0 ? <Empty>No deal activity in this view.</Empty> : (
                <table className="w-full min-w-[26rem] text-sm">
                  <thead className="text-xs text-tertiary-500"><tr><Th>Deal</Th><Th right>Revenue</Th><Th right>Expenses</Th><Th right>Profit</Th></tr></thead>
                  <tbody>{data.by_deal.map((d) => <tr key={d.id} className="border-t"><td className="px-3 py-1.5">{d.code} {d.name}</td><td className="px-3 py-1.5 text-right"><Money v={d.revenue} /></td><td className="px-3 py-1.5 text-right"><Money v={d.expenses} /></td><td className="px-3 py-1.5 text-right"><Money v={d.net_profit} signed className="font-semibold" /></td></tr>)}</tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function EntriesTab({ me, pickers, deals, categories }) {
  const { pushError, pushSuccess } = useAlerts();
  const [f, setF] = useState(BLANK_ENTRY_FILTERS);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [res, setRes] = useState({ rows: [], totals: { revenue: 0, expense: 0 } });
  const [fetching, setFetching] = useState(true);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);
  const canEdit = axCan(me, 'ledger');
  const set = (k, v) => setF((c) => ({ ...c, [k]: v }));

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setFetching(true);
    try {
      const query = Object.fromEntries(Object.entries({ ...f, q: dq }).filter(([, v]) => v));
      const r = await acconcyApi.ledger(query);
      if (id === reqId.current) setRes({ rows: r.data, totals: r.totals || { revenue: 0, expense: 0 } });
    } catch (e) {
      if (id === reqId.current) pushError(acconcyError(e, 'Could not load entries'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [f, dq, pushError]);
  useEffect(() => { load(); }, [load]);

  async function save(body) {
    setSaving(true);
    try {
      await withReason(async (reason) => {
        const payload = { ...body, ...(reason ? { reason } : {}) };
        return modal.row ? acconcyApi.updateEntry(modal.row.id, payload) : acconcyApi.createEntry(payload);
      });
      pushSuccess('Saved');
      setModal(null);
      load();
    } catch (e) {
      pushError(acconcyError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function remove(e) {
    if (!window.confirm('Delete this entry?')) return;
    try { await withReason((reason) => acconcyApi.deleteEntry(e.id, reason)); load(); } catch (err) { pushError(acconcyError(err, 'Could not delete'), 'Delete failed'); }
  }

  const categoryOptions = categories.map((c) => ({ value: c.id, label: `${c.name} (${c.kind})` }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Revenue" value={<Money v={res.totals.revenue} />} hint="in this view" />
        <Kpi label="Expenses" value={<Money v={res.totals.expense} />} hint="in this view" />
        <Kpi label="Net" value={<Money v={res.totals.revenue - res.totals.expense} signed />} tone="ax-gold" />
      </div>
      <FilterBar
        q={q}
        onQ={setQ}
        searchPlaceholder="Search description or reference..."
        fields={[
          { key: 'type', label: 'Type', type: 'select', any: 'Revenue and expenses', options: [{ value: 'revenue', label: 'Revenue' }, { value: 'expense', label: 'Expenses' }] },
          { key: 'scope', label: 'Level', type: 'select', any: 'Deal and company', options: [{ value: 'deal', label: 'Deal entries' }, { value: 'company', label: 'Company-level entries' }] },
          { key: 'category_id', label: 'Category', type: 'select', any: 'Any category', options: categoryOptions },
          { key: 'service_type', label: 'Service type', type: 'select', any: 'Any service', options: SERVICE_TYPES.map((s) => ({ value: s.value, label: s.label })) },
          { key: 'party_id', label: 'Client', type: 'select', any: 'Any client', options: pickers.clients },
          { key: 'vendor_id', label: 'Vendor', type: 'select', any: 'Any vendor', options: pickers.vendors },
          { key: 'deal_id', label: 'Deal', type: 'select', any: 'Any deal', options: deals },
          { key: 'from', label: 'From', type: 'date' },
          { key: 'to', label: 'To', type: 'date' },
        ]}
        values={f}
        onChange={set}
        onReset={() => { setF(BLANK_ENTRY_FILTERS); setQ(''); }}
      >
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setModal({})}><Plus className="h-4 w-4" />New entry</button>}
      </FilterBar>
      {res.rows.length === 0 ? <Empty>{fetching ? 'Loading...' : 'No entries match these filters.'}</Empty> : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-primary-50/60 text-xs text-tertiary-500"><tr><Th>Date</Th><Th>Type</Th><Th>Category</Th><Th>Deal</Th><Th>Client / vendor</Th><Th>Description</Th><Th right>Amount</Th><th /></tr></thead>
            <tbody>
              {res.rows.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2">{dateLabel(e.entry_date)}</td>
                  <td className="px-3 py-2"><Pill tone={e.type === 'revenue' ? 'green' : 'amber'}>{e.type === 'revenue' ? 'Revenue' : 'Expense'}</Pill></td>
                  <td className="px-3 py-2">{e.category_name}</td>
                  <td className="px-3 py-2">{e.deal ? <span>{e.deal.code} <span className="text-xs text-tertiary-400">{SERVICE_META[e.deal.service_type]?.short}</span></span> : <span className="text-tertiary-400">Company</span>}</td>
                  <td className="px-3 py-2">{[e.party?.name, e.vendor?.name].filter(Boolean).join(' / ') || '-'}</td>
                  <td className="px-3 py-2 text-tertiary-600">{e.description || e.reference || '-'}</td>
                  <td className="px-3 py-2 text-right"><Money v={e.amount} className="font-medium" /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {canEdit && !e.source_type && <><button type="button" title="Edit" className="mr-1 rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setModal({ row: e })}><Pencil className="h-4 w-4" /></button><button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(e)}><Trash2 className="h-4 w-4" /></button></>}
                    {e.source_type && <span className="text-[11px] text-tertiary-400">from investment</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(modal)} onClose={() => setModal(null)} wide title={modal?.row ? 'Edit entry' : 'New revenue / expense entry'}>
        {modal && <EntryForm initial={modal.row} categories={categories} deals={deals} clients={pickers.clients} vendors={pickers.vendors} saving={saving} onSubmit={save} onCancel={() => setModal(null)} />}
      </Modal>
    </div>
  );
}

export default function AcconcyFinancePage() {
  const { me, loading } = useAcconcy();
  const pickers = usePickers();
  const [params, setParams] = useSearchParams();
  const [deals, setDeals] = useState([]);
  const [categories, setCategories] = useState([]);
  const tab = params.get('tab') === 'entries' ? 'entries' : 'pnl';

  useEffect(() => {
    if (!me) return;
    acconcyApi.deals({ status: 'all' }).then((rows) => setDeals(rows.map((d) => ({ value: d.id, label: `${d.code} ${d.name}` }))), () => {});
    acconcyApi.categories().then((c) => setCategories(c.filter((x) => x.active)), () => {});
  }, [me]);
  const tabs = useMemo(() => [{ key: 'pnl', label: 'Profit & loss' }, { key: 'entries', label: 'Revenue & expense entries' }], []);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!axCan(me, 'overview')) return <Navigate to="/acconcy" replace />;
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={tabs} value={tab} onChange={(k) => setParams({ tab: k }, { replace: true })} />
      {tab === 'pnl' ? <PnlTab pickers={pickers} deals={deals} /> : <EntriesTab me={me} pickers={pickers} deals={deals} categories={categories} />}
    </div>
  );
}
