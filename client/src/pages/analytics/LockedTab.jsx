import { useMemo, useState } from 'react';
import { Eye, Lock, Printer } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import StatusBadge from '../../components/finance/StatusBadge.jsx';
import { MONTHS, periodLabel } from '../../components/finance/PeriodPicker.jsx';
import { amountText, billingCalculationLines, dateText, printLockedRecord, vendorLineText } from '../../components/finance/financePrint.js';

const KINDS = [
  { value: '', label: 'All records' },
  { value: 'billing', label: 'Billing' },
  { value: 'salary_employee', label: 'Salary' },
  { value: 'expense', label: 'Expenses' },
  { value: 'vendor_bill', label: 'Vendors' },
];

function Row({ label, children }) {
  return <div className="contents"><dt className="text-tertiary-500">{label}</dt><dd className="col-span-2 text-tertiary-900">{children}</dd></div>;
}

/** What a locked record holds — read from its locked snapshot, never recomputed. */
function LockedDetails({ rec }) {
  const s = rec.summary || {};
  if (rec.kind === 'billing') {
    return (
      <div className="space-y-3">
        <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-sm">
          <Row label="Project">{s.project?.name}{s.project?.code ? ` · ${s.project.code}` : ''}</Row>
          <Row label="Client">{s.project?.client_name || '—'}</Row>
          <Row label="Billing type">{s.details?.billing_type === 'monthly' ? 'Monthly' : 'Hourly'}</Row>
          <Row label="Currency">{rec.currency}{rec.currency !== 'INR' ? ` · ${amountText(rec.amount_inr, 'INR')}${s.exchange_rate ? ` @ ₹${s.exchange_rate}` : ''}${s.inr_at_lock ? ' (rate at lock)' : ''}` : ''}</Row>
          <Row label="Invoice">{rec.invoice ? `${rec.invoice.invoice_number || '—'} · ${rec.invoice.status} · ${amountText(rec.invoice.amount, rec.invoice.currency)}` : 'Not generated'}</Row>
        </dl>
        <ul className="space-y-0.5 rounded-xl bg-tertiary-50 p-3 text-xs text-tertiary-700">{billingCalculationLines(s.details).map((l) => <li key={l}>{l}</li>)}</ul>
      </div>
    );
  }
  if (rec.kind === 'salary_employee') {
    const b = s.breakdown || {};
    return (
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-sm">
        <Row label="Employee">{s.employee?.name}{s.employee?.employee_code ? ` (${s.employee.employee_code})` : ''}</Row>
        <Row label="Department / team">{[s.employee?.department, s.employee?.team].filter(Boolean).join(' · ') || '—'}</Row>
        <Row label="Monthly CTC">{amountText(s.ctc, 'INR')} · per hour {amountText(b.hourly_rate, 'INR')}</Row>
        <Row label="Hours">{b.working_days} working days × {b.shift_hours}h = {b.expected_hours}h expected · {b.paid_hours}h paid · {b.deficit_hours || 0}h short</Row>
        <Row label="Overtime">{b.ot_approved_hours || 0}h approved · {amountText(s.ot_amount, 'INR')}</Row>
        <Row label="Net pay">{amountText(s.gross, 'INR')} − {amountText(s.deductions, 'INR')} = <span className="font-semibold">{amountText(s.net, 'INR')}</span></Row>
      </dl>
    );
  }
  if (rec.kind === 'expense') {
    const r = s.record || {};
    return (
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-sm">
        <Row label="Type">{r.type === 'charge' ? 'Group charge' : 'Expense claim'}</Row>
        <Row label="Category">{r.category}</Row>
        <Row label="Employee / office">{[r.person, r.location].filter(Boolean).join(' · ') || '—'}</Row>
        <Row label="Date">{dateText(r.date)}</Row>
        <Row label="Description">{r.description || '—'}</Row>
        <Row label="Amount">{amountText(r.amount, r.currency)}{r.currency !== 'INR' ? ` · ${amountText(rec.amount_inr, 'INR')}${r.exchange_rate ? ` @ ₹${r.exchange_rate}` : ''}` : ''}</Row>
      </dl>
    );
  }
  if (rec.kind === 'vendor_bill' || rec.kind === 'vendor_payment') {
    return (
      <div className="space-y-2">
        {rec.kind === 'vendor_bill' && <p className="text-sm"><span className="text-tertiary-500">Vendor:</span> <span className="font-medium">{s.vendor?.name}</span>{rec.vendor_invoices?.length ? <span className="text-tertiary-500"> · invoice {rec.vendor_invoices[0].invoice_number}</span> : null}</p>}
        <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100 text-xs">
          {(s.lines || []).map((l, i) => (
            <li key={`${l.contractor}-${l.project?.id}-${i}`} className="space-y-0.5 px-3 py-2">
              <div className="flex flex-wrap justify-between gap-2"><span className="font-medium text-tertiary-900">{l.contractor}</span><span className="tabular-nums">{amountText(l.amount, l.currency)}{l.currency !== 'INR' ? ` · ${amountText(l.amount_inr, 'INR')}` : ''}</span></div>
              <div className="text-tertiary-500">{[l.project?.client_name, l.project?.name].filter(Boolean).join(' · ')}</div>
              <div className="text-tertiary-600">{vendorLineText(l, l.currency)}</div>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <p className="text-sm text-tertiary-600">{amountText(rec.amount_inr, 'INR')}</p>;
}

/**
 * Live Analytics → Locked: every finalized record — billing per project,
 * salary per employee, expenses, vendor billing — with what it was locked
 * from. View shows the locked figures; Download prints the statement (or the
 * invoice). Only these records count in Financials.
 */
export default function LockedTab() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState('');
  const [kind, setKind] = useState('');
  const [viewing, setViewing] = useState(null);
  const params = useMemo(() => ({ period_year: year, ...(month ? { period_month: Number(month) } : {}), ...(kind ? { kind } : {}) }), [year, month, kind]);
  const { data, loading } = useLiveData(() => apiClient.get('/calculations/locked', { params }).then((r) => r.data.data), { deps: [JSON.stringify(params)] });
  const rows = data || [];
  const total = rows.reduce((s, r) => s + (r.amount_inr || 0), 0);
  const byKind = (k) => rows.filter((r) => r.kind === k || (k === 'salary_employee' && r.kind === 'salary') || (k === 'vendor_bill' && r.kind === 'vendor_payment')).length;

  const download = (rec) => {
    if (!printLockedRecord(rec, user?.active_org?.name)) pushError('Allow pop-ups for this site to download.', 'Pop-up blocked');
  };

  const columns = [
    { key: 'kind', header: 'Type', render: (r) => <span className="text-xs font-medium text-tertiary-700">{r.kind_label}</span> },
    { key: 'record', header: 'Record', render: (r) => (
      <span>
        <span className="font-medium text-tertiary-900">{r.scope_label || '—'}</span>
        {r.kind === 'billing' && r.summary?.project?.client_name && <span className="block text-xs text-tertiary-500">{r.summary.project.client_name}</span>}
      </span>
    ) },
    { key: 'period', header: 'Period', render: (r) => periodLabel(r) },
    { key: 'amount', header: 'Amount', render: (r) => <span className="tabular-nums"><span className="font-medium">{amountText(r.amount, r.currency)}</span>{r.currency !== 'INR' && <span className="block text-xs text-tertiary-500">{amountText(r.amount_inr, 'INR')}</span>}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} label={r.status === 'locked' ? `Locked v${r.version}` : undefined} size="xs" /> },
    { key: 'by', header: 'Locked by', render: (r) => <span className="text-xs">{r.locked_by?.name || '—'}{r.locked_at && <span className="block text-tertiary-500">{new Date(r.locked_at).toLocaleString()}</span>}</span> },
    { key: 'invoice', header: 'Invoice', render: (r) => <span className="text-xs">{r.invoice ? `${r.invoice.invoice_number || '—'} · ${r.invoice.status}` : r.vendor_invoices?.length ? r.vendor_invoices[0].invoice_number || 'generated' : '—'}</span> },
    { key: 'actions', header: 'Action', render: (r) => (
      <div className="flex gap-1">
        <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setViewing(r)}><Eye className="h-3.5 w-3.5" /> View</button>
        <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => download(r)}><Printer className="h-3.5 w-3.5" /> Download</button>
      </div>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3">
        <label className="text-xs font-medium text-tertiary-600">Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
            {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-tertiary-600">Month
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
            <option value="">All months</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-tertiary-600">Type
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <p className="pb-1.5 text-xs text-tertiary-500">Finalized records only — these (and nothing still live) make up Financials.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Locked records" value={loading && !data ? '…' : rows.length} hint={`total ${amountText(total, 'INR')}`} icon={Lock} theme="green" />
        <KpiCard label="Billing" value={byKind('billing')} icon={Lock} theme="blue" />
        <KpiCard label="Salary" value={byKind('salary_employee')} icon={Lock} theme="purple" />
        <KpiCard label="Expenses" value={byKind('expense')} icon={Lock} theme="red" />
        <KpiCard label="Vendors" value={byKind('vendor_bill')} icon={Lock} theme="orange" />
      </div>
      <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="Nothing locked for this selection yet — lock records in Billing & sales, Salary, Expenses or Vendors" />
      <Drawer
        open={Boolean(viewing)}
        title={viewing ? `${viewing.kind_label} · ${viewing.scope_label || ''} — ${periodLabel(viewing)}` : ''}
        onClose={() => setViewing(null)}
        size="lg"
        footer={viewing && (
          <>
            <button type="button" className="btn-secondary" onClick={() => setViewing(null)}>Close</button>
            <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => download(viewing)}><Printer className="h-4 w-4" /> Download</button>
          </>
        )}
      >
        {viewing && (
          <div className="space-y-3">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={viewing.status} label={viewing.status === 'locked' ? `Locked v${viewing.version}` : undefined} />
              <span className="text-tertiary-500">by {viewing.locked_by?.name || '—'}{viewing.locked_at ? ` · ${new Date(viewing.locked_at).toLocaleString()}` : ''}</span>
            </p>
            <LockedDetails rec={viewing} />
            <p className="text-right text-base font-semibold">{amountText(viewing.amount, viewing.currency)}</p>
          </div>
        )}
      </Drawer>
    </div>
  );
}
