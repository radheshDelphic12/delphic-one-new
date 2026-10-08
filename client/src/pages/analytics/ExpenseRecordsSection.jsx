import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Modal from '../../components/ui/Modal.jsx';
import RecordLockButton from '../../components/finance/RecordLockButton.jsx';
import PeriodPicker, { currentPeriod, periodLabel } from '../../components/finance/PeriodPicker.jsx';
import { amountText, dateText } from '../../components/finance/financePrint.js';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unlocked', label: 'Unlocked' },
  { key: 'locked', label: 'Locked' },
];

function ExpenseView({ record, onClose }) {
  if (!record) return null;
  const rows = [
    ['Type', record.type === 'charge' ? 'Group charge' : 'Expense claim'],
    ['Category', record.category],
    ['Employee', record.person ? `${record.person}${record.employee_code ? ` (${record.employee_code})` : ''}` : '—'],
    ['Office', record.location || '—'],
    ['Date', dateText(record.date)],
    ['Status', record.status],
    ['Description', record.description || '—'],
    ['Amount', amountText(record.amount, record.currency)],
    ['Amount (INR)', record.amount_inr === null ? `No ${record.currency} exchange rate` : `${amountText(record.amount_inr, 'INR')}${record.currency !== 'INR' && record.exchange_rate ? ` @ ₹${record.exchange_rate}` : ''}`],
    ['Lock', record.lock.status === 'draft' ? 'Unlocked' : `Locked v${record.lock.version}`],
  ];
  return (
    <Modal open title="Expense" onClose={onClose} footer={<button type="button" className="btn-secondary" onClick={onClose}>Close</button>}>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-tertiary-500">{k}</dt><dd className="col-span-2 text-tertiary-900">{v}</dd></div>
        ))}
      </dl>
    </Modal>
  );
}

/**
 * Live Analytics → Expenses: the month's expense records — approved /
 * reimbursed claims and group charges — each lockable on its own
 * (Unlocked → Locked). Locked expenses move to Locked and count in Financials.
 */
export default function ExpenseRecordsSection() {
  const [period, setPeriod] = useState(currentPeriod());
  const [filter, setFilter] = useState('all');
  const [viewing, setViewing] = useState(null);
  const { data, loading, refresh } = useLiveData(() => apiClient.get('/analytics/expense-records', { params: period }).then((r) => r.data.data), { deps: [period.period_month, period.period_year] });
  const rows = useMemo(() => (data?.records || [])
    .filter((r) => filter === 'all' || (filter === 'locked' ? r.lock.status !== 'draft' : r.lock.status === 'draft'))
    .map((r) => ({ ...r, id: r.scope_key })), [data, filter]);
  const t = data?.totals;

  const columns = [
    { key: 'date', header: 'Date', render: (r) => dateText(r.date) },
    { key: 'type', header: 'Type', render: (r) => (r.type === 'charge' ? 'Group charge' : 'Claim') },
    { key: 'category', header: 'Category', render: (r) => <span className="font-medium text-tertiary-900">{r.category}</span> },
    { key: 'who', header: 'Employee / office', render: (r) => <span className="text-xs">{[r.person, r.location].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'amount', header: 'Amount', render: (r) => <span className="tabular-nums">{amountText(r.amount, r.currency)}{r.currency !== 'INR' && <span className="block text-xs text-tertiary-500">{r.amount_inr === null ? 'no exchange rate' : amountText(r.amount_inr, 'INR')}</span>}</span> },
    { key: 'view', header: '', render: (r) => <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setViewing(r)}><Eye className="h-3.5 w-3.5" /> View</button> },
    { key: 'lock', header: 'Lock', render: (r) => <RecordLockButton kind="expense" scopeKey={r.scope_key} period={period} lock={r.lock} label={`${r.category} expense`} onChanged={() => refresh?.()} /> },
  ];

  return (
    <section className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">Expense records · {periodLabel(period)}</h2>
          <p className="text-xs text-tertiary-500">
            Approved / reimbursed claims and group charges. Lock each one when it is final — locked expenses move to Locked and count in Financials.
            {t ? ` ${t.locked} of ${t.records} locked · locked ${amountText(t.locked_inr, 'INR')} · unlocked ${amountText(t.unlocked_inr, 'INR')}.` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <PeriodPicker value={period} onChange={setPeriod} label="Month" />
          <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5" role="group" aria-label="Lock filter">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} className={`rounded-lg px-2.5 py-1 text-xs font-medium ${filter === f.key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{f.label}</button>
            ))}
          </div>
        </div>
      </div>
      <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No approved expenses in this month" />
      <ExpenseView record={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}
