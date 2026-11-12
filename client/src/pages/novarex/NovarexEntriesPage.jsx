import { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import useLiveData from '../../lib/useLiveData.js';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { useNovarex, nxCan } from '../../lib/novarex/useNovarex.js';
import { useNxPickers } from '../../lib/novarex/pickers.js';
import { STATUS_LABEL, STATUS_TONE, TX_LABEL, TX_TONE, inr } from '../../lib/novarex/meta.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Pill from '../../components/ui/Pill.jsx';
import ChartCard from '../../components/ui/ChartCard.jsx';
import NxFilterBar, { useNxFilters } from '../../components/novarex/NxFilters.jsx';
import EntryDrawer from '../../components/novarex/EntryDrawer.jsx';
import { CategoryChart, ExpenseTrendChart, IncomeChart, VT_PIE } from '../../components/novarex/NxCharts.jsx';
import { Kpi, Money, card, withReason } from '../../components/novarex/ui.jsx';

const PAGES = {
  income: { kind: 'income', cap: 'entries', title: 'Revenue & Returns', add: 'Record revenue', searchPlaceholder: 'Search buyer, reference, notes...', filter: 'income_category_id', empty: 'No revenue recorded for these filters.' },
  expense: { kind: 'expense', cap: 'entries', title: 'Expenses', add: 'Record expense', searchPlaceholder: 'Search payee, reference, notes...', filter: 'expense_category_id', empty: 'No expenses recorded for these filters.' },
  salary: { kind: 'salary', cap: 'payroll', title: 'Salaries', add: 'Record salary', searchPlaceholder: 'Search employee, reference...', filter: 'person_id', empty: 'No salary recorded for these filters.' },
};

/** Income & Returns, Expenses and Salaries share one page: a list of entries of one kind with totals, filters and a chart. */
export default function NovarexEntriesPage({ type }) {
  const cfg = PAGES[type];
  const { me, loading } = useNovarex();
  const { pushError } = useAlerts();
  const [params, setParams] = useSearchParams();
  const pickers = useNxPickers({ people: true });
  const filters = useNxFilters({ fyStart: me?.fy_start_month || 4 });
  const { f, params: apiParams, key } = filters;
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [drawer, setDrawer] = useState({ open: params.get('new') === '1', entry: null });
  const entryQuery = useCallback(() => ({ kind: cfg.kind, q: f.q, from: f.from, to: f.to, category_id: f.income_category_id || f.expense_category_id, payment_status: f.payment_status, person_id: f.person_id, investment_id: f.investment_id, outlet_id: f.outlet_id, ownership_type_id: f.ownership_type_id, format_id: f.format_id, page, limit: 25 }), [cfg.kind, f, page]);
  const load = useCallback(() => nxApi.entries(entryQuery()).then(setData, (e) => pushError(novarexError(e, 'Could not load the entries'), 'Load failed')), [entryQuery, pushError]);
  const dash = useLiveData(() => nxApi.dashboard(apiParams), { enabled: Boolean(me), deps: [key] });
  const returns = useLiveData(() => (type === 'income' ? nxApi.transactions({ ...apiParams, limit: 100, sort: 'date' }) : Promise.resolve(null)), { enabled: Boolean(me) && type === 'income', deps: [key] });
  useEffect(() => { setPage(1); }, [key]);
  useEffect(() => { if (me) load(); }, [me, load]);
  useEffect(() => { if (params.get('new') === '1') setDrawer({ open: true, entry: null }); }, [params]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, cfg.cap)) return <Navigate to="/novarex" replace />;
  const canEdit = nxCan(me, 'entriesEdit') && (cfg.kind !== 'salary' || nxCan(me, 'payroll'));
  const close = () => { setDrawer({ open: false, entry: null }); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } };
  const refresh = () => { load(); dash.refresh(); returns.refresh(); pickers.refresh(); };
  async function remove(entry) {
    if (!window.confirm('Delete this entry?')) return;
    try { await withReason((reason) => nxApi.deleteEntry(entry.id, reason)); refresh(); } catch (e) { pushError(novarexError(e, 'Could not delete'), 'Not deleted'); }
  }
  const s = data?.summary;
  const d = dash.data;
  const p = d?.period;

  const columns = [
    { key: 'date', header: 'Date', render: (r) => dateLabel(r.entry_date) },
    cfg.kind === 'salary'
      ? { key: 'who', header: 'Employee', render: (r) => <span className="font-medium text-tertiary-900">{r.person?.name || r.party_name || '-'}</span> }
      : { key: 'cat', header: 'Category / party', render: (r) => <span>{r.category?.name || '-'}{r.party_name && <span className="block text-xs text-tertiary-500">{r.party_name}</span>}{r.investment && <span className="block text-xs text-tertiary-500">{r.investment.code}</span>}</span> },
    ...(cfg.kind === 'expense' ? [{ key: 'cls', header: 'Counts as', render: (r) => (r.expense_class === 'other' ? 'Other' : 'Operating') }] : []),
    { key: 'outlet', header: 'Outlet', render: (r) => (r.outlet ? <span className="text-tertiary-800">{r.outlet.name}<span className="block text-xs text-tertiary-500">{r.outlet.code}</span></span> : <span className="text-tertiary-400">Company level</span>) },
    { key: 'amount', header: 'Amount', render: (r) => <Money v={r.amount} /> },
    { key: 'status', header: 'Status', render: (r) => <span><Pill tone={STATUS_TONE[r.payment_status]}>{r.payment_status === 'paid' ? (cfg.kind === 'income' ? 'Received' : 'Paid') : STATUS_LABEL[r.payment_status]}</Pill>{r.payment_status === 'unpaid' && r.due_date && <span className="block text-xs text-tertiary-500">due {dateLabel(r.due_date)}</span>}</span> },
    { key: 'ref', header: 'Reference', render: (r) => r.reference || '-' },
    { key: 'a', header: '', render: (r) => canEdit && (
      <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button type="button" title="Edit" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setDrawer({ open: true, entry: r })}><Pencil className="h-4 w-4" /></button>
        <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>
      </span>
    ) },
  ];
  const returnRows = (returns.data?.data || []).filter((r) => ['principal_return', 'earnings'].includes(r.type) && r.status !== 'reversed');
  const retColumns = [
    { key: 'date', header: 'Date', render: (r) => dateLabel(r.date) },
    { key: 'inv', header: 'Investment', render: (r) => <span><span className="font-medium text-tertiary-900">{r.related?.name}</span><span className="block text-xs text-tertiary-500">{r.related?.code}</span></span> },
    { key: 'type', header: 'What it is', render: (r) => <Pill tone={TX_TONE[r.type]}>{TX_LABEL[r.type]}</Pill> },
    { key: 'amount', header: 'Amount', render: (r) => <Money v={r.amount} /> },
    { key: 'ref', header: 'Reference', render: (r) => r.reference || '-' },
  ];

  return (
    <div className="mt-4 space-y-4">
      <NxFilterBar filters={filters} pickers={pickers} fields={['outlet_id', 'ownership_type_id', 'format_id', cfg.filter, ...(cfg.kind === 'income' ? ['investment_id'] : []), 'payment_status']} searchPlaceholder={cfg.searchPlaceholder}>
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ open: true, entry: null })}><Plus className="h-4 w-4" />{cfg.add}</button>}
      </NxFilterBar>

      {cfg.kind === 'income' && p && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Investment earnings" value={<Money v={p.investment_earnings} />} hint="Profit on investments - income" tone="text-emerald-700" />
          <Kpi label="Principal recovered" value={<Money v={p.principal_returned} />} hint="Original capital back - not income" />
          <Kpi label="Sales revenue / other income" value={<Money v={p.other_income} />} hint="Paid and unpaid, from the entries below" />
          <Kpi label="Receivable" value={<Money v={d.position.receivables} />} hint={`${d.position.overdue_receivables} overdue`} />
        </div>
      )}
      {cfg.kind === 'expense' && p && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Operating expenses" value={<Money v={p.operating_expenses} />} />
          <Kpi label="Other expenses" value={<Money v={p.other_expenses} />} />
          <Kpi label="Paid" value={<Money v={p.paid_expenses} />} hint="Cash actually paid" />
          <Kpi label="Payable" value={<Money v={d.position.payables - (d.position.payables_salary || 0)} />} hint="Unpaid expenses" />
        </div>
      )}
      {cfg.kind === 'salary' && p && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Salary cost" value={<Money v={p.salaries} />} hint="Paid and payable in the period" />
          <Kpi label="Salary paid" value={<Money v={p.salaries_paid} />} />
          <Kpi label="Salary payable" value={<Money v={d.position.payables_salary} />} hint="Unpaid" tone={d.position.payables_salary ? 'text-amber-700' : undefined} />
          <Kpi label="Employees paid" value={d.salary_by_person?.length || 0} />
        </div>
      )}
      {s && cfg.kind !== 'salary' && <p className="text-xs text-tertiary-500">In this list: {inr(s[cfg.kind])} total · {inr(cfg.kind === 'income' ? s.unpaid_income : s.unpaid_expense)} unpaid.</p>}

      {d && cfg.kind === 'income' && <ChartCard title="Investment earnings and other income" subtitle="By month"><IncomeChart rows={d.trend} /></ChartCard>}
      {d && cfg.kind === 'expense' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Expenses by category" subtitle="The selected period">
            <CategoryChart rows={d.expenses_by_category} />
            <ul className="mt-2 space-y-1 text-xs text-tertiary-600">{d.expenses_by_category.slice(0, 6).map((c, i) => <li key={c.name} className="flex justify-between"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: VT_PIE[i % VT_PIE.length] }} />{c.name}</span><span className="tabular-nums">{inr(c.amount)}</span></li>)}</ul>
          </ChartCard>
          <ChartCard title="Expense trend" subtitle="By month"><ExpenseTrendChart rows={d.trend} showSalary={false} /></ChartCard>
        </div>
      )}
      {d && cfg.kind === 'salary' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Salary trend" subtitle="By month"><ExpenseTrendChart rows={d.trend} showSalary /></ChartCard>
          <section className={card}>
            <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">By employee (selected period)</h3>
            {(d.salary_by_person || []).length === 0 ? <p className="text-sm text-tertiary-400">No salary recorded in this period.</p> : (
              <table className="w-full text-sm"><thead className="text-left text-xs text-tertiary-500"><tr><th className="py-1 font-medium">Employee</th><th className="text-right font-medium">Paid</th><th className="text-right font-medium">Unpaid</th><th className="text-right font-medium">Total</th></tr></thead>
                <tbody>{d.salary_by_person.map((x) => <tr key={x.name} className="border-t"><td className="py-1.5">{x.name}</td><td className="text-right tabular-nums"><Money v={x.paid} /></td><td className="text-right tabular-nums"><Money v={x.unpaid} /></td><td className="text-right font-medium tabular-nums"><Money v={x.total} /></td></tr>)}</tbody></table>
            )}
          </section>
        </div>
      )}

      {cfg.kind === 'income' && (
        <section className={card} aria-label="Investment returns">
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Returns from investments</h3>
          <DataTable columns={retColumns} rows={returnRows} loading={returns.loading && !returns.data} emptyLabel="No returns received in this period." maxHeight="40vh" />
          <p className="mt-2 text-[11px] text-tertiary-500">Record a return from the investment itself (Investments, then open one). Principal is shown here for completeness but is not counted as income.</p>
        </section>
      )}

      <section className="space-y-2" aria-label={cfg.title}>
        {cfg.kind === 'income' && <h3 className="font-heading text-sm font-semibold text-tertiary-900">Sales revenue and other income</h3>}
        <DataTable columns={columns} rows={data?.data || []} loading={!data} emptyLabel={cfg.empty} onRowClick={(r) => canEdit && setDrawer({ open: true, entry: r })} maxHeight="60vh" />
        {data && (
          <div className="flex items-center justify-between text-xs text-tertiary-500">
            <span>{data.pagination.total} entr{data.pagination.total === 1 ? 'y' : 'ies'}</span>
            <span className="flex items-center gap-2">
              <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>Previous</button>
              <span>Page {data.pagination.page} of {data.pagination.pages}</span>
              <button type="button" className="btn-secondary" disabled={page >= data.pagination.pages} onClick={() => setPage((x) => x + 1)}>Next</button>
            </span>
          </div>
        )}
      </section>
      <EntryDrawer key={`${drawer.entry?.id || 'new'}-${drawer.open}`} open={drawer.open} entry={drawer.entry} kinds={[cfg.kind]} defaultKind={cfg.kind} pickers={pickers} onClose={close} onSaved={() => { close(); refresh(); }} />
    </div>
  );
}
