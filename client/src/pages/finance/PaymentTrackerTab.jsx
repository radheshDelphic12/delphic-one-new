import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Hourglass } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { promptAction } from '../../lib/confirmAction.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Pill from '../../components/ui/Pill.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const money = (n, c = 'INR') => `${c} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const SHOW = [
  ['all', 'All resources'],
  ['client_pending', 'Client has not paid'],
  ['vendor_pending', 'Vendor not paid'],
  ['client_paid_vendor_pending', 'Client paid, vendor not paid'],
  ['overdue', 'Overdue (client or vendor)'],
];
const CLIENT_STATE = { paid: ['green', 'Received'], part_paid: ['amber', 'Part received'], unpaid: ['red', 'Not received'], draft: ['gray', 'Draft (not sent)'], no_invoice: ['gray', 'Not invoiced'] };
const VENDOR_STATE = { paid: ['green', 'Paid'], unpaid: ['red', 'Not paid'], no_invoice: ['gray', 'Not invoiced'] };

function Tile({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <div className={`rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card ${tone}`}>
      <p className="flex items-center gap-1.5 text-xs text-tertiary-500"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</p>
      <p className="font-heading text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-tertiary-500">{hint}</p>}
    </div>
  );
}

function DueDate({ side }) {
  if (side.state === 'no_invoice') return <span className="text-tertiary-400">—</span>;
  return (
    <span className="whitespace-nowrap text-xs">
      {side.due_date || <span className="text-tertiary-400">not set</span>}
      {side.overdue && <span className="block font-medium text-danger-600">{side.days_overdue} day{side.days_overdue === 1 ? '' : 's'} overdue</span>}
    </span>
  );
}

/**
 * Finance > Payment Tracker: for one month, every contractor (a resource that belongs to a vendor) with the client's invoice and the vendor's
 * invoice side by side: invoice, received / paid, due date. Employees are not here (their pay runs through payroll).
 */
export default function PaymentTrackerTab() {
  const { pushError, pushSuccess } = useAlerts();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  // end of the range (Paras: start month to end month); the same as the start month = one month
  const [toMonth, setToMonth] = useState(now.getMonth() + 1);
  const [toYear, setToYear] = useState(now.getFullYear());
  const isRange = toMonth !== month || toYear !== year;
  const rangeBad = toYear * 12 + toMonth < year * 12 + month;
  const [client, setClient] = useState('');
  const [vendor, setVendor] = useState('');
  const [show, setShow] = useState('all');
  const [data, setData] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (rangeBad) { setData({ rows: [], summary: null, clients: [], vendors: [] }); return undefined; }
    setData(null);
    apiClient.get('/billing/payment-tracker', { params: { period_month: month, period_year: year, to_month: toMonth, to_year: toYear, ...(client ? { client_name: client } : {}), ...(vendor ? { vendor_account_id: vendor } : {}), ...(show !== 'all' ? { status: show } : {}) } })
      .then(({ data: res }) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) { setData({ rows: [], summary: null, clients: [], vendors: [] }); pushError(apiErrorMessage(err, 'Could not load the payment tracker'), 'Something went wrong'); } });
    return () => { cancelled = true; };
  }, [month, year, toMonth, toYear, client, vendor, show, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const resourceKey = (row) => ({ org_membership_id: row.org_membership_id, project_id: row.project.id, period_month: row.period_month, period_year: row.period_year });
  async function markPaid(row) {
    const today = new Date().toISOString().slice(0, 10);
    const paidOn = await promptAction(`${row.resource}: paid to ${row.vendor.name} on (date):`, today);
    if (!paidOn) return;
    const note = (await promptAction('Note, for example the transaction reference (optional):', '')) ?? '';
    try {
      await apiClient.put('/billing/payment-tracker/resource-payment', { ...resourceKey(row), paid_on: paidOn, ...(note.trim() ? { note: note.trim() } : {}) });
      pushSuccess(`${row.resource} marked paid`);
      setReloadKey((k) => k + 1);
    } catch (err) { pushError(apiErrorMessage(err, 'Could not mark it paid'), 'Not saved'); }
  }
  async function unmark(row) {
    try {
      await apiClient.delete('/billing/payment-tracker/resource-payment', { params: resourceKey(row) });
      pushSuccess('Mark removed');
      setReloadKey((k) => k + 1);
    } catch (err) { pushError(apiErrorMessage(err, 'Could not remove the mark'), 'Not saved'); }
  }

  const columns = [
    ...(isRange ? [{ key: 'period', header: 'Month', render: (r) => <span className="whitespace-nowrap text-xs">{MONTHS[r.period_month - 1].slice(0, 3)} {r.period_year}</span> }] : []),
    { key: 'resource', header: 'Resource', render: (r) => <span><span className="font-medium text-tertiary-900">{r.resource}</span><span className="block text-xs text-tertiary-500">{r.approved_hours}h approved</span></span> },
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor.name },
    { key: 'project', header: 'Client / project', render: (r) => <span>{r.client_name || '—'}<span className="block text-xs text-tertiary-500">{r.project.name}{r.project.code ? ` · ${r.project.code}` : ''}</span></span> },
    { key: 'c_invoice', header: 'Client · Invoice', render: (r) => (r.client.state === 'no_invoice' ? <span className="text-tertiary-400">—</span> : <span className="tabular-nums"><span className="font-mono text-xs">{r.client.invoice_number || '—'}</span><span className="block text-xs text-tertiary-600">{money(r.client.total, r.client.currency)}</span></span>) },
    { key: 'c_status', header: 'Client · Payment', render: (r) => { const [tone, label] = CLIENT_STATE[r.client.state]; return <span><Pill tone={tone}>{label}</Pill>{r.client.state === 'part_paid' && <span className="block text-[11px] text-tertiary-500">{money(r.client.received, r.client.currency)} of {money(r.client.total, r.client.currency)}</span>}</span>; } },
    { key: 'c_due', header: 'Client · Due date', render: (r) => <DueDate side={r.client} /> },
    { key: 'v_invoice', header: 'Vendor · Invoice', render: (r) => (r.vendor_invoice.state === 'no_invoice' ? <span className="text-tertiary-500 text-xs">{money(r.vendor_amount, r.currency)} to bill</span> : <span className="tabular-nums"><span className="font-mono text-xs">{r.vendor_invoice.invoice_number || '—'}</span><span className="block text-xs text-tertiary-600">{money(r.vendor_invoice.payable, r.vendor_invoice.currency)}</span></span>) },
    { key: 'v_status', header: 'Vendor · Payment', render: (r) => { const [tone, label] = VENDOR_STATE[r.vendor_invoice.state]; return <Pill tone={tone}>{label}</Pill>; } },
    { key: 'v_due', header: 'Vendor · Due date', render: (r) => <DueDate side={r.vendor_invoice} /> },
    {
      key: 'v_resource',
      header: 'This resource paid',
      render: (r) => (
        <span className="flex flex-col items-start gap-1" data-testid="resource-paid-cell">
          {r.vendor_resource.paid
            ? <Pill tone="green">{r.vendor_resource.source === 'vendor_payment' ? 'Paid (vendor payment)' : `Paid ${r.vendor_resource.paid_on || ''}`.trim()}</Pill>
            : <Pill tone="red">Not paid</Pill>}
          {r.vendor_resource.note && <span className="max-w-[12rem] text-[11px] text-tertiary-500">{r.vendor_resource.note}</span>}
          {r.vendor_resource.source === 'marked'
            ? <button type="button" className="btn-ghost text-xs" onClick={() => unmark(r)} data-testid="resource-unmark">Undo</button>
            : !r.vendor_resource.paid && <button type="button" className="btn-ghost text-xs" onClick={() => markPaid(r)} data-testid="resource-mark-paid">Mark paid</button>}
        </span>
      ),
    },
  ];

  const s = data?.summary;
  return (
    <div className="space-y-4" data-testid="payment-tracker">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Finance</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Client and vendor payments</h2>
          <p className="mt-1 text-sm text-tertiary-500">For a month, or from a start month to an end month: each vendor resource, whether the client has paid us and whether we have paid the vendor, with both due dates. Employees are not here, their pay runs through payroll. Set the due dates in Invoicing and Vendor Invoices.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">From month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month" className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">To month
            <select value={toMonth} onChange={(e) => setToMonth(Number(e.target.value))} aria-label="To month" data-testid="tracker-to-month" className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">To year
            <select value={toYear} onChange={(e) => setToYear(Number(e.target.value))} aria-label="To year" className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Client
            <select value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client" className="mt-1 block max-w-[14rem] rounded-xl border px-3 py-2 text-sm"><option value="">All clients</option>{(data?.clients || []).map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Vendor
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor" className="mt-1 block max-w-[14rem] rounded-xl border px-3 py-2 text-sm"><option value="">All vendors</option>{(data?.vendors || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Show
            <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show" className="mt-1 block rounded-xl border px-3 py-2 text-sm">{SHOW.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
        </div>
      </div>

      {s && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="tracker-summary">
          <Tile icon={ArrowDownToLine} label="Client invoices received" value={`${s.client_invoices.received} of ${s.client_invoices.total}`} hint={`${s.client_invoices.not_received + s.client_invoices.part_received} not fully received · ${s.client_invoices.not_invoiced + s.client_invoices.draft} not invoiced or not sent · ${s.client_invoices.overdue} overdue`} />
          <Tile icon={ArrowUpFromLine} label="Vendors paid" value={`${s.vendor_invoices.paid} of ${s.vendor_invoices.total}`} hint={`${s.vendor_invoices.unpaid} not paid · ${s.vendor_invoices.not_invoiced} not invoiced · ${s.vendor_invoices.overdue} overdue`} />
          <Tile icon={Hourglass} label="Client paid, vendor not paid" value={s.client_paid_vendor_pending} hint="Resources to pay now" tone={s.client_paid_vendor_pending ? 'border-amber-200 bg-amber-50/40' : ''} />
          <Tile icon={CheckCircle2} label="Vendor paid, client not paid" value={s.vendor_paid_client_pending} hint="Paid out, still to receive" tone={s.vendor_paid_client_pending ? 'border-danger-200 bg-danger-50/30' : ''} />
        </div>
      )}

      <DataTable columns={columns} rows={(data?.rows || []).map((r) => ({ ...r, id: r.key }))} loading={!data} emptyLabel={rangeBad ? 'The end month is before the start month' : `No vendor resources to track for ${MONTHS[month - 1]} ${year}${isRange ? ` to ${MONTHS[toMonth - 1]} ${toYear}` : ''}`} maxHeight="calc(100dvh - 24rem)" />
    </div>
  );
}
