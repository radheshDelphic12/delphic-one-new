import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { doxApi } from '../../lib/delphicone/api.js';
import { useDelphicOne, doxCan } from '../../lib/delphicone/useDelphicOne.js';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pill from '../../components/ui/Pill.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import InvoiceCollectionDrawer from '../../components/payments/InvoiceCollectionDrawer.jsx';
import { inputCls, labelCls, th, thr, td, tdr, rupees, today, Tile, useLoad, useSave } from './ui.jsx';

const FILTERS = [['', 'All'], ['open', 'Unpaid'], ['overdue', 'Overdue'], ['followup_due', 'Follow-up due'], ['no_due_date', 'No due date'], ['paid', 'Paid']];
const STATUS = { unpaid: ['amber', 'Unpaid'], part_paid: ['blue', 'Part paid'], paid: ['green', 'Paid'], draft: ['gray', 'Draft'], cancelled: ['gray', 'Cancelled'] };
const MODES = [['neft', 'NEFT / bank'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['card', 'Card'], ['other', 'Other']];

function NewInvoiceDrawer({ open, customers, onClose, onSaved }) {
  const save = useSave();
  const [v, setV] = useState({ customer_id: '', amount: '', gst_rate: 18, invoice_date: today(), due_date: '', number: '', description: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV({ customer_id: '', amount: '', gst_rate: 18, invoice_date: today(), due_date: '', number: '', description: '' }); }, [open]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  const gst = Math.round(((Number(v.amount) || 0) * (Number(v.gst_rate) || 0))) / 100;
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const r = await save(() => doxApi.createInvoice({ customer_id: v.customer_id, amount: Number(v.amount), gst_rate: Number(v.gst_rate), invoice_date: v.invoice_date, due_date: v.due_date || null, number: v.number || null, description: v.description || null }), 'Invoice created', 'Could not create the invoice');
    setBusy(false);
    if (r) { onSaved(); onClose(); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="md" tone="create" title="New invoice" footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="dox-invoice-form" className="btn-primary" disabled={busy || !v.customer_id || !Number(v.amount)}>{busy ? 'Saving…' : 'Create invoice'}</button>
      </>
    }>
      <form id="dox-invoice-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2" data-testid="invoice-form">
        <label className={`${labelCls} sm:col-span-2`}>Customer<select required className={inputCls} aria-label="Customer" value={v.customer_id} onChange={set('customer_id')}><option value="">Choose a customer…</option>{(customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className={labelCls}>Amount before GST (₹)<input required type="number" min="0" step="0.01" aria-label="Amount" className={inputCls} value={v.amount} onChange={set('amount')} /></label>
        <label className={labelCls}>GST %<input type="number" min="0" max="40" step="0.5" className={inputCls} value={v.gst_rate} onChange={set('gst_rate')} /></label>
        <p className="text-xs text-tertiary-500 sm:col-span-2">GST {rupees(gst)} · total <b>{rupees((Number(v.amount) || 0) + gst)}</b></p>
        <label className={labelCls}>Invoice date<input type="date" className={inputCls} value={v.invoice_date} onChange={set('invoice_date')} /></label>
        <label className={labelCls}>Due date<input type="date" aria-label="Due date" className={inputCls} value={v.due_date} onChange={set('due_date')} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Invoice number (leave empty to number it automatically)<input className={inputCls} value={v.number} onChange={set('number')} placeholder="DO/2026-27/0001" /></label>
        <label className={`${labelCls} sm:col-span-2`}>What it is for<input className={inputCls} value={v.description} onChange={set('description')} placeholder="November 2026 subscription, 12 users" /></label>
      </form>
    </Drawer>
  );
}

function PaymentDrawer({ invoice, onClose, onChanged }) {
  const save = useSave();
  const [list, reload] = useLoad(() => (invoice ? doxApi.payments(invoice.id) : Promise.resolve([])), [invoice?.id], []);
  const [v, setV] = useState({ amount: '', date: today(), mode: 'neft', reference: '' });
  useEffect(() => { if (invoice) setV({ amount: String(invoice.balance), date: today(), mode: 'neft', reference: '' }); }, [invoice]);
  async function add(e) {
    e.preventDefault();
    const r = await save(() => doxApi.addPayment(invoice.id, { amount: Number(v.amount), date: v.date, mode: v.mode, reference: v.reference || null }), 'Payment recorded', 'Could not record the payment');
    if (r) { reload(); onChanged(); onClose(); }
  }
  async function remove(p) {
    if (!window.confirm('Remove this payment?')) return;
    const r = await save(() => doxApi.removePayment(invoice.id, p.id), 'Payment removed', 'Could not remove the payment');
    if (r) { reload(); onChanged(); }
  }
  return (
    <Drawer open={Boolean(invoice)} onClose={onClose} size="md" tone="info" title={invoice ? `Payments · ${invoice.number}` : ''}>
      {invoice && (
        <div className="space-y-4 text-sm" data-testid="payment-drawer">
          <p className="text-xs text-tertiary-500">{invoice.customer_name} · total {rupees(invoice.total)} · received {rupees(invoice.paid)} · still to receive <b>{rupees(invoice.balance)}</b></p>
          {invoice.balance > 0 && (
            <form onSubmit={add} className="grid grid-cols-2 gap-3 rounded-xl border border-primary-100 bg-primary-50/30 p-3">
              <label className={labelCls}>Amount (₹)<input required type="number" min="0" step="0.01" aria-label="Payment amount" className={inputCls} value={v.amount} onChange={(e) => setV((c) => ({ ...c, amount: e.target.value }))} /></label>
              <label className={labelCls}>Date<input required type="date" className={inputCls} value={v.date} onChange={(e) => setV((c) => ({ ...c, date: e.target.value }))} /></label>
              <label className={labelCls}>Mode<select className={inputCls} value={v.mode} onChange={(e) => setV((c) => ({ ...c, mode: e.target.value }))}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className={labelCls}>Reference (UTR, cheque no.)<input className={inputCls} value={v.reference} onChange={(e) => setV((c) => ({ ...c, reference: e.target.value }))} /></label>
              <button type="submit" className="btn-primary col-span-2 text-xs">Record payment</button>
            </form>
          )}
          <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
            {(list || []).length === 0 && <li className="px-3 py-3 text-xs text-tertiary-500">Nothing received yet.</li>}
            {(list || []).map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2"><span className="flex-1">{p.date} · {p.mode.toUpperCase()}{p.reference ? ` · ${p.reference}` : ''}</span><span className="tabular-nums">{rupees(p.amount)}</span><button type="button" className="text-xs text-danger-600 hover:underline" onClick={() => remove(p)}>Remove</button></li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

export default function DelphicOneInvoicesPage() {
  const { me } = useDelphicOne();
  const canEdit = doxCan(me, 'invoicesEdit');
  const save = useSave();
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.some(([k]) => k === (params.get('filter') || '')) ? params.get('filter') || '' : '';
  const [q, setQ] = useState('');
  const [data, reload] = useLoad(() => doxApi.invoices({ filter, q }), [filter, q], { rows: [], totals: null });
  const [customers] = useLoad(() => doxApi.customers({}), [], []);
  const [creating, setCreating] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [chaseFor, setChaseFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [reason, setReason] = useState('');
  const t = data?.totals;

  async function cancel() {
    const r = await save(() => doxApi.cancelInvoice(cancelFor.id, reason), 'Invoice cancelled', 'Could not cancel the invoice');
    if (r) { setCancelFor(null); setReason(''); reload(); }
  }
  return (
    <div className="space-y-3" data-testid="dox-invoices">
      {t && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Billed" value={rupees(t.billed)} hint="sent invoices in this view" />
          <Tile label="Received" value={rupees(t.received)} />
          <Tile label="To collect" value={rupees(t.outstanding)} />
          <Tile label="Overdue" value={rupees(t.overdue)} hint={`${t.overdue_count} invoice${t.overdue_count === 1 ? '' : 's'}`} tone={t.overdue_count ? 'border-danger-200' : ''} />
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Invoice filter">
          {FILTERS.map(([k, l]) => <button key={k || 'all'} type="button" role="tab" aria-selected={filter === k} data-testid={`invoice-filter-${k || 'all'}`} onClick={() => setParams(k ? { filter: k } : {})} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${filter === k ? 'border-primary-600 bg-primary-600 text-white' : 'border-tertiary-200 bg-white text-tertiary-700 hover:bg-primary-50'}`}>{l}</button>)}
        </div>
        <label className={labelCls}>Search<input className={inputCls} placeholder="Number or description" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {canEdit && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-2" data-testid="new-invoice" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New invoice</button>}
      </div>
      {!data ? <Skeleton className="h-40" /> : data.rows.length === 0 ? <EmptyState title="No invoices here" description={filter ? 'Nothing matches this filter.' : 'Create the first invoice for a customer.'} /> : (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted"><tr><th className={th}>Invoice</th><th className={th}>Customer</th><th className={th}>Date</th><th className={thr}>Total</th><th className={thr}>Balance</th><th className={th}>Due</th><th className={th}>Next follow-up</th><th className={th}>Status</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-tertiary-100" data-testid="invoice-row">
                  <td className={`${td} font-mono text-xs font-medium text-primary-700`}>{r.number}{r.description && <span className="block max-w-[14rem] truncate font-sans text-[11px] font-normal text-tertiary-500">{r.description}</span>}</td>
                  <td className={td}>{r.customer_name}</td>
                  <td className={`${td} whitespace-nowrap`}>{r.invoice_date}</td>
                  <td className={tdr}>{rupees(r.total)}</td>
                  <td className={`${tdr} font-medium`}>{r.status === 'sent' ? rupees(r.balance) : '—'}</td>
                  <td className={`${td} whitespace-nowrap text-xs`}>{r.due_date || <span className="text-tertiary-400">not set</span>}{r.overdue && <span className="block font-medium text-danger-600">{r.days_overdue} day{r.days_overdue === 1 ? '' : 's'} overdue</span>}</td>
                  <td className={`${td} text-xs`}>{r.next_followup_date ? <span className={r.followup_due ? 'font-semibold text-warning-700' : ''}>{r.next_followup_date}</span> : '—'}{r.followup_count > 0 && <span className="block max-w-[14rem] truncate text-tertiary-500" title={r.last_followup_note}>{r.last_followup_note}</span>}</td>
                  <td className={td}><Pill tone={STATUS[r.payment_status][0]}>{STATUS[r.payment_status][1]}</Pill></td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {canEdit && r.status === 'sent' && r.balance > 0 && <button type="button" className="btn-ghost text-xs" data-testid="record-payment" onClick={() => setPayFor(r)}>Payment</button>}
                    {canEdit && r.status === 'sent' && r.balance > 0 && <button type="button" className="btn-ghost text-xs" data-testid="invoice-followup" onClick={() => setChaseFor(r)}>Follow-up{r.followup_count ? ` (${r.followup_count})` : ''}</button>}
                    {canEdit && r.status !== 'cancelled' && r.paid === 0 && <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => { setCancelFor(r); setReason(''); }}>Cancel</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewInvoiceDrawer open={creating} customers={customers} onClose={() => setCreating(false)} onSaved={reload} />
      <PaymentDrawer invoice={payFor} onClose={() => setPayFor(null)} onChanged={reload} />
      <InvoiceCollectionDrawer invoice={chaseFor} title={chaseFor ? `Follow-up: ${chaseFor.number}` : ''} basePath={chaseFor ? `/delphic-one/invoices/${chaseFor.id}` : ''} onClose={() => setChaseFor(null)} onChanged={reload} />
      <Drawer open={Boolean(cancelFor)} onClose={() => setCancelFor(null)} size="sm" tone="edit" title={cancelFor ? `Cancel ${cancelFor.number}` : ''}>
        <div className="space-y-3 text-sm">
          <label className={labelCls}>Why is it cancelled?<input className={inputCls} aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button type="button" className="btn-primary" disabled={reason.trim().length < 3} onClick={cancel}>Cancel the invoice</button>
        </div>
      </Drawer>
    </div>
  );
}
