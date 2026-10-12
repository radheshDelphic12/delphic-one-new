import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import useLiveData from '../../lib/useLiveData.js';
import { zkApi, zklyreraError } from '../../lib/zklyrera/api.js';
import { useZklyrera, zkCan } from '../../lib/zklyrera/useZklyrera.js';
import { useZkPickers } from '../../lib/zklyrera/pickers.js';
import { STATUS_LABEL, STATUS_TONE, TX_LABEL, TX_TONE, TX_TYPES, inr } from '../../lib/zklyrera/meta.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import ZkFilterBar, { useZkFilters } from '../../components/zklyrera/ZkFilters.jsx';
import { Detail, Kpi, Money } from '../../components/zklyrera/ui.jsx';

const BLANK_X = { type: '', min: '', max: '' };

/** Every movement of money in one register: investments placed, returns (principal / earnings), income, expenses, salaries, transfers. */
export default function ZklyreraTransactionsPage() {
  const { me, loading } = useZklyrera();
  const { pushError } = useAlerts();
  const pickers = useZkPickers({ people: true });
  const filters = useZkFilters({ fyStart: me?.fy_start_month || 4, extra: BLANK_X });
  const { params, key } = filters;
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sort: 'date', dir: 'desc' });
  const [open, setOpen] = useState(null);
  const query = { ...params, ...sort, page, limit: 25 };
  const { data, loading: busy, error } = useLiveData(() => zkApi.transactions(query), { enabled: Boolean(me), deps: [key, page, sort.sort, sort.dir] });
  useEffect(() => { setPage(1); }, [key]);
  useEffect(() => { if (error) pushError(zklyreraError(error, 'Could not load the transactions'), 'Load failed'); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !zkCan(me, 'entries') && !zkCan(me, 'investments')) return <Navigate to="/zklyrera" replace />;
  const s = data?.summary;
  const toggle = (col) => setSort((c) => ({ sort: col, dir: c.sort === col && c.dir === 'desc' ? 'asc' : 'desc' }));
  const head = (label, col) => <button type="button" className="font-medium hover:underline" onClick={() => toggle(col)}>{label}{sort.sort === col ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</button>;
  const columns = [
    { key: 'date', header: head('Date', 'date'), render: (r) => dateLabel(r.date) },
    { key: 'type', header: 'Type', render: (r) => <Pill tone={TX_TONE[r.type]}>{TX_LABEL[r.type]}</Pill> },
    { key: 'desc', header: 'Details', render: (r) => <span><span className="text-tertiary-900">{r.description || r.party || r.person || '-'}</span>{r.related && <span className="block text-xs text-tertiary-500">{r.related.code} {r.related.name}</span>}</span> },
    { key: 'cat', header: 'Category', render: (r) => r.category || '-' },
    { key: 'amount', header: head('Amount', 'amount'), render: (r) => <span className={r.direction === 'in' ? 'font-medium text-emerald-700' : ''}>{r.direction === 'in' ? '+ ' : r.direction === 'out' ? '- ' : ''}<Money v={r.amount} /></span> },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status] || r.status}</Pill> },
    { key: 'ref', header: 'Reference', render: (r) => r.reference || '-' },
  ];
  return (
    <div className="mt-4 space-y-4">
      <ZkFilterBar
        filters={filters}
        pickers={pickers}
        fields={['investment_category_id', 'investment_id', 'income_category_id', 'expense_category_id', 'payment_status', ...(zkCan(me, 'payroll') ? ['person_id'] : [])]}
        extraFields={[
          { key: 'type', label: 'Transaction type', type: 'select', any: 'All', options: TX_TYPES.filter((t) => zkCan(me, 'payroll') || t.value !== 'salary') },
          { key: 'min', label: 'Amount from (₹)', type: 'number', min: 0 },
          { key: 'max', label: 'Amount up to (₹)', type: 'number', min: 0 },
        ]}
        searchPlaceholder="Search description, reference, party, investment..."
      />
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Kpi label="Investments placed" value={<Money v={s.investment} />} />
          <Kpi label="Principal returned" value={<Money v={s.principal_return} />} />
          <Kpi label="Earnings" value={<Money v={s.earnings} />} tone="text-emerald-700" />
          <Kpi label="Income" value={<Money v={s.income} />} />
          <Kpi label="Expenses" value={<Money v={s.expense} />} />
          <Kpi label="Salaries" value={s.salary === null ? <span className="text-tertiary-400">Restricted</span> : <Money v={s.salary} />} />
          <Kpi label="Transfers" value={<Money v={s.transfer} />} hint="Not counted in results" />
        </div>
      )}
      <div className={busy && data ? 'opacity-60 transition-opacity' : ''}>
        <DataTable columns={columns} rows={data?.data || []} loading={!data} emptyLabel="No transactions match these filters." onRowClick={(r) => setOpen(r)} maxHeight="62vh" />
      </div>
      {data && (
        <div className="flex items-center justify-between text-xs text-tertiary-500">
          <span>{data.pagination.total} transaction{data.pagination.total === 1 ? '' : 's'} · totals above follow the filters</span>
          <span className="flex items-center gap-2">
            <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span>Page {data.pagination.page} of {data.pagination.pages}</span>
            <button type="button" className="btn-secondary" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </span>
        </div>
      )}
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} size="md" tone="info" title={open ? `${TX_LABEL[open.type]} · ${inr(open.amount)}` : ''}>
        {open && (
          <dl className="space-y-3">
            <Detail label="Date">{dateLabel(open.date)}</Detail>
            <Detail label="Type">{TX_LABEL[open.type]} ({open.direction === 'in' ? 'money in' : open.direction === 'out' ? 'money out' : 'internal'})</Detail>
            <Detail label="Amount"><Money v={open.amount} /></Detail>
            <Detail label="Status">{STATUS_LABEL[open.status] || open.status}</Detail>
            <Detail label="Category">{open.category}</Detail>
            <Detail label="Details">{open.description}</Detail>
            <Detail label="Paid to / from">{open.party}</Detail>
            <Detail label="Employee">{open.person}</Detail>
            <Detail label="Due date">{open.due_date && dateLabel(open.due_date)}</Detail>
            <Detail label="Reference">{open.reference}</Detail>
            <Detail label="Related investment">{open.related && `${open.related.code} · ${open.related.name}`}</Detail>
            <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-xs text-tertiary-600">{open.source === 'entry' ? 'Edit this record from Income & Returns, Expenses or Salaries.' : 'Open the investment (Investments page) to see or change its returns.'}</p>
          </dl>
        )}
      </Drawer>
    </div>
  );
}
