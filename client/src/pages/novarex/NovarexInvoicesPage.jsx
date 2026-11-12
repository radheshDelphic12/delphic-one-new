import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { useNovarex, nxCan } from '../../lib/novarex/useNovarex.js';
import { useOpsPickers } from '../../lib/novarex/opsPickers.js';
import { useNxPickers } from '../../lib/novarex/pickers.js';
import { downloadCsv, printReport } from '../../lib/groupExport.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { DateInput, Detail, Num, Text, today } from '../../components/novarex/ui.jsx';
import { Btn, Kpi, Money, inputCls, num, titleOf, useAction, useRows } from '../../components/novarex/ops/common.jsx';

const TYPES = [['sales', 'Sales invoice'], ['franchise', 'Franchise fee / royalty'], ['purchase', 'Purchase invoice'], ['credit_note', 'Credit note'], ['debit_note', 'Debit note']];
const STATUS_TONE = { paid: 'green', partially_paid: 'amber', issued: 'blue', credited: 'green', cancelled: 'red' };

function InvoiceDetail({ id, onClose, onChanged, canEdit }) {
  const { pushSuccess } = useAlerts();
  const [inv, setInv] = useState(null);
  const [pay, setPay] = useState(null);
  const [err, setErr] = useState('');
  const load = () => nxApi.ops.invoice(id).then(setInv, () => setInv(false));
  useEffect(() => { setInv(null); setPay(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async () => { await load(); onChanged(); };
  const act = useAction(refresh);
  if (!id) return null;
  const refund = inv && inv.outstanding < 0;
  const payable = inv && ['sales', 'franchise', 'purchase'].includes(inv.type) && inv.status !== 'cancelled' && inv.outstanding !== 0;
  async function submitPay(e) {
    e.preventDefault(); setErr('');
    try {
      await nxApi.ops.pay(id, { amount: num(pay.amount), pay_date: pay.pay_date || undefined, method: pay.method || null, reference: pay.reference || null });
      pushSuccess(refund ? 'Refund recorded' : 'Payment recorded'); setPay(null); refresh();
    } catch (x) {
      const msg = novarexError(x, 'Could not record the payment');
      if (/reason/i.test(msg)) { const reason = window.prompt(`${msg}\n\nReason:`); if (reason) { try { await nxApi.ops.pay(id, { amount: num(pay.amount), pay_date: pay.pay_date || undefined, method: pay.method || null, reference: pay.reference || null, reason }); setPay(null); refresh(); return; } catch (y) { setErr(novarexError(y, msg)); return; } } }
      setErr(msg);
    }
  }
  const print = () => printReport(`${titleOf(inv.type)} ${inv.invoice_no}`, `${inv.party_name || ''} · ${dateLabel(inv.issue_date)} · ${inv.tax_split?.type || ''}`,
    ['Item', 'HSN', 'Batch', 'Qty', 'Rate', 'Disc %', 'GST %', 'Amount', 'Tax', 'Total'], [...(inv.lines || []).map((l) => [l.name, l.hsn || '', l.batch_no || '', l.qty, l.unit_price, l.discount_pct || 0, l.gst_rate, l.net_amount, l.tax_amount, l.line_total]), ['', '', '', '', '', '', 'Subtotal', inv.subtotal, inv.tax_total, inv.total]]);
  return (
    <Drawer open onClose={onClose} size="xl" tone="info" title={inv ? `${titleOf(inv.type)} ${inv.invoice_no}` : 'Invoice'}>
      {inv === null && <p className="text-sm text-tertiary-500">Loading...</p>}
      {inv === false && <p className="text-sm text-danger-700">Could not load the invoice.</p>}
      {inv && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-1.5"><Pill tone={STATUS_TONE[inv.status] || 'gray'}>{titleOf(inv.status)}</Pill>{inv.tax_split && <Pill tone="gray">{inv.tax_split.type}</Pill>}<Pill tone="gray">e-invoice: {titleOf(inv.einvoice_status)}</Pill>{inv.eway_status !== 'not_required' && <Pill tone="amber">e-way bill: {titleOf(inv.eway_status)}</Pill>}<button type="button" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={print}><Printer className="h-3.5 w-3.5" />Print / PDF</button></div>
          <div className="grid gap-2 sm:grid-cols-2"><Detail label="Party">{inv.party_name}</Detail><Detail label="Issue date">{dateLabel(inv.issue_date)}</Detail><Detail label="Due date">{inv.due_date ? dateLabel(inv.due_date) : null}</Detail><Detail label="Notes">{inv.notes}</Detail></div>
          <DataTable embedded columns={[{ key: 'n', header: 'Item', render: (l) => <span>{l.name}<span className="block text-xs text-tertiary-500">{[l.hsn && `HSN ${l.hsn}`, l.batch_no && `Batch ${l.batch_no}`].filter(Boolean).join(' · ')}</span></span> }, { key: 'q', header: 'Qty', render: (l) => l.qty }, { key: 'u', header: 'Rate', render: (l) => <Money v={l.unit_price} /> }, { key: 'g', header: 'GST', render: (l) => `${l.gst_rate}%` }, { key: 'a', header: 'Amount', render: (l) => <Money v={l.net_amount} /> }, { key: 't', header: 'Total', render: (l) => <Money v={l.line_total} /> }]} rows={(inv.lines || []).map((l, i) => ({ ...l, id: i }))} />
          <div className="ml-auto max-w-xs space-y-1">
            <div className="flex justify-between"><span>Subtotal</span><Money v={inv.subtotal} /></div>
            {inv.tax_split?.type === 'IGST' ? <div className="flex justify-between"><span>IGST</span><Money v={inv.tax_split.igst} /></div> : inv.tax_split ? <><div className="flex justify-between"><span>CGST</span><Money v={inv.tax_split.cgst} /></div><div className="flex justify-between"><span>SGST</span><Money v={inv.tax_split.sgst} /></div></> : <div className="flex justify-between"><span>GST</span><Money v={inv.tax_total} /></div>}
            <div className="flex justify-between border-t pt-1 font-semibold"><span>Total</span><Money v={inv.total} /></div>
            <div className="flex justify-between"><span>Paid</span><Money v={inv.paid_amount} /></div>
            {inv.credited_amount > 0 && <div className="flex justify-between"><span>Credited</span><Money v={inv.credited_amount} /></div>}
            <div className="flex justify-between font-semibold"><span>{refund ? 'Refund due' : 'Outstanding'}</span><Money v={Math.abs(inv.outstanding)} /></div>
          </div>
          {inv.payments?.length > 0 && <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Payments</h4><ul className="space-y-0.5">{inv.payments.map((p) => <li key={p.id}>{dateLabel(p.pay_date)} · <Money v={p.amount} /> {p.direction === 'in' ? 'received' : 'paid'}{p.method ? ` by ${p.method}` : ''}{p.reference ? ` (${p.reference})` : ''}</li>)}</ul></div>}
          {inv.related?.length > 0 && <p>Related: {inv.related.map((r) => `${r.invoice_no} (${titleOf(r.type)}, ${r.total})`).join(', ')}</p>}
          {canEdit && !pay && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {payable && <Btn primary onClick={() => setPay({ amount: Math.abs(inv.outstanding), pay_date: today(), method: '', reference: '' })}>{refund ? 'Record refund' : inv.type === 'purchase' ? 'Record supplier payment' : 'Record payment received'}</Btn>}
              {inv.status === 'issued' && inv.paid_amount === 0 && inv.credited_amount === 0 && ['sales', 'franchise', 'purchase'].includes(inv.type) && inv.type !== 'purchase' && <Btn danger onClick={() => act(() => nxApi.ops.cancelInvoice(inv.id, {}), { confirm: `Cancel ${inv.invoice_no}? Its revenue and cost entries are cancelled too.`, done: 'Invoice cancelled' })}>Cancel invoice</Btn>}
            </div>
          )}
          {pay && (
            <form onSubmit={submitPay} className="space-y-3 rounded-xl border p-3">
              <div className="grid gap-3 sm:grid-cols-2"><Num label={refund ? 'Refund amount' : 'Amount'} value={pay.amount} onChange={(v) => setPay((c) => ({ ...c, amount: v }))} /><DateInput label="Date" value={pay.pay_date} onChange={(v) => setPay((c) => ({ ...c, pay_date: v }))} /><Text label="Method" value={pay.method} onChange={(v) => setPay((c) => ({ ...c, method: v }))} placeholder="Bank, UPI, cash..." /><Text label="Reference" value={pay.reference} onChange={(v) => setPay((c) => ({ ...c, reference: v }))} /></div>
              {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
              <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setPay(null)}>Cancel</button><button type="submit" className="btn-primary">Save</button></div>
            </form>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** Sales, purchase and franchise invoices, credit and debit notes, payments and outstanding balances. */
export default function NovarexInvoicesPage() {
  const { me, loading } = useNovarex();
  const pk = useOpsPickers();
  const nxp = useNxPickers({ people: false });
  const [f, setF] = useState({ q: '', type: '', status: '', payment: '', outlet_id: '', customer_id: '', supplier_id: '', from: '', to: '' });
  const [detail, setDetail] = useState(null);
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const list = useRows(() => nxApi.ops.invoices(f), [f]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'billing') && !nxCan(me, 'franchise')) return <Navigate to="/novarex" replace />;
  const rows = list.rows || [];
  const live = rows.filter((r) => r.status !== 'cancelled');
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  const recv = live.filter((r) => ['sales', 'franchise'].includes(r.type));
  const cols = [
    { key: 'n', header: 'Invoice', render: (r) => <span><span className="font-medium text-tertiary-900">{r.invoice_no}</span><span className="block text-xs text-tertiary-500">{titleOf(r.type)}</span></span> },
    { key: 'p', header: 'Party', render: (r) => r.party_name || '-' }, { key: 'd', header: 'Issued', render: (r) => dateLabel(r.issue_date) }, { key: 'du', header: 'Due', render: (r) => (r.due_date ? dateLabel(r.due_date) : '-') },
    { key: 's', header: 'Amount (excl. GST)', render: (r) => <Money v={r.subtotal} /> }, { key: 't', header: 'Total', render: (r) => <Money v={r.total} /> }, { key: 'pd', header: 'Paid', render: (r) => <Money v={r.paid_amount} /> }, { key: 'o', header: 'Outstanding', render: (r) => <Money v={r.outstanding} signed /> },
    { key: 'st', header: 'Status', render: (r) => <Pill tone={STATUS_TONE[r.status] || 'gray'}>{titleOf(r.status)}</Pill> },
  ];
  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Invoiced to customers" value={<Money v={sum(recv, 'total')} />} hint="Sales and franchise invoices in the list" />
        <Kpi label="Outstanding from customers" value={<Money v={sum(recv.filter((r) => r.outstanding > 0), 'outstanding')} />} hint="Receivable" />
        <Kpi label="Purchase invoices" value={<Money v={sum(live.filter((r) => r.type === 'purchase'), 'total')} />} hint="Inventory bought, not an expense" />
        <Kpi label="Owed to suppliers" value={<Money v={sum(live.filter((r) => r.type === 'purchase' && r.outstanding > 0), 'outstanding')} />} hint="Payable" />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <input className={`${inputCls} min-w-[12rem] flex-1`} placeholder="Search invoice number or party" value={f.q} onChange={set('q')} aria-label="Search" />
        <select className={inputCls} value={f.type} onChange={set('type')} aria-label="Type"><option value="">All types</option>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className={inputCls} value={f.status} onChange={set('status')} aria-label="Status"><option value="">All statuses</option>{Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{titleOf(s)}</option>)}</select>
        <select className={inputCls} value={f.payment} onChange={set('payment')} aria-label="Payment"><option value="">Any payment state</option><option value="open">Outstanding</option><option value="overdue">Overdue</option></select>
        <select className={inputCls} value={f.outlet_id} onChange={set('outlet_id')} aria-label="Outlet"><option value="">All outlets</option>{nxp.outlets.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className={inputCls} value={f.customer_id} onChange={set('customer_id')} aria-label="Customer"><option value="">All customers</option>{pk.customers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className={inputCls} value={f.supplier_id} onChange={set('supplier_id')} aria-label="Supplier"><option value="">All suppliers</option>{pk.suppliers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <input type="date" className={inputCls} value={f.from} onChange={set('from')} aria-label="From" /><input type="date" className={inputCls} value={f.to} onChange={set('to')} aria-label="To" />
        <button type="button" className="btn-secondary" disabled={!rows.length} onClick={() => downloadCsv('novarex-invoices.csv', ['Invoice', 'Type', 'Party', 'Issued', 'Due', 'Subtotal', 'GST', 'Total', 'Paid', 'Outstanding', 'Status'], rows.map((r) => [r.invoice_no, r.type, r.party_name || '', r.issue_date, r.due_date || '', r.subtotal, r.tax_total, r.total, r.paid_amount, r.outstanding, r.status]))}>CSV</button>
      </div>
      <DataTable columns={cols} rows={rows} loading={!list.rows} emptyLabel="No invoices match these filters. Invoices are created from delivered shipments, posted goods receipts and franchise settlements." onRowClick={(r) => setDetail(r.id)} />
      {detail && <InvoiceDetail id={detail} onClose={() => setDetail(null)} onChanged={list.reload} canEdit={nxCan(me, 'billingEdit')} />}
    </div>
  );
}
