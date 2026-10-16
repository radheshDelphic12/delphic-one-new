import { useEffect, useMemo, useState } from 'react';
import { Ban, Download, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { formatMoney } from '../../lib/cashSelection.js';
import { GST_STATES, stateName } from '../../lib/gstStates.js';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pill from '../../components/ui/Pill.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';

const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const today = () => new Date().toLocaleDateString('en-CA');
const api = (path, params) => apiClient.get(`/group-cash${path}`, { params }).then((r) => r.data.data);
const TYPE_LABEL = { gst: 'GST invoice', non_gst: 'Non-GST invoice', usd_export: 'USD export invoice' };
const STATUS = { unpaid: ['amber', 'Unpaid'], partially_paid: ['blue', 'Part paid'], paid: ['green', 'Paid'], overdue: ['red', 'Overdue'], cancelled: ['gray', 'Cancelled'] };
const MODES = [['neft', 'NEFT'], ['rtgs', 'RTGS'], ['imps', 'IMPS'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['swift', 'SWIFT'], ['other', 'Other']];
const GST_RATES = [0, 5, 12, 18, 28, 3, 0.25];
const blankLine = () => ({ description: '', hsn_sac: '', qty: '1', rate: '', gst_rate: 18 });

const StateSelect = ({ value, onChange, label, required }) => (
  <label className={labelCls}>{label}
    <select required={required} className={inputCls} value={value} onChange={onChange}>
      <option value="">Choose a state…</option>
      {GST_STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
    </select>
  </label>
);

/** A rough total while typing; the final amounts are worked out by the server when the invoice is issued. */
function preview(type, lines, intra) {
  let sub = 0;
  let tax = 0;
  for (const l of lines) {
    const amount = Math.round(Number(l.qty || 0) * Number(l.rate || 0) * 100) / 100;
    sub += amount;
    if (type === 'gst') tax += (amount * Number(l.gst_rate || 0)) / 100;
  }
  return { sub, tax: Math.round(tax * 100) / 100, intra };
}

function NewInvoiceDrawer({ open, options, entities, invoice, onClose, onSaved }) {
  const { pushSuccess, pushError } = useAlerts();
  const empty = { legal_entity_id: '', type: 'gst', invoice_date: today(), due_date: '', workspace_id: '', buyer_name: '', buyer_gstin: '', buyer_address: '', buyer_state_code: '', receiving_wallet_id: '', notes: '', payment_instructions: '' };
  const [v, setV] = useState(empty);
  const [lines, setLines] = useState([blankLine()]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setV({ legal_entity_id: invoice.legal_entity_id, type: invoice.type, invoice_date: invoice.invoice_date, due_date: invoice.due_date || '', workspace_id: invoice.workspace_id || '', buyer_name: invoice.buyer_name, buyer_gstin: invoice.buyer_gstin || '', buyer_address: invoice.buyer_address || '', buyer_state_code: invoice.buyer_state_code || invoice.place_of_supply || '', receiving_wallet_id: invoice.receiving_wallet_id, notes: invoice.notes || '', payment_instructions: invoice.payment_instructions || '' });
      setLines(invoice.lines.map((l) => ({ description: l.description, hsn_sac: l.hsn_sac || '', qty: String(l.qty), rate: String(l.rate), gst_rate: l.gst_rate })));
    } else { setV(empty); setLines([blankLine()]); }
  }, [open, invoice]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value, ...(k === 'type' || k === 'legal_entity_id' ? { receiving_wallet_id: '' } : {}) }));
  const setLine = (i, k) => (e) => setLines((c) => c.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)));
  const entity = entities.find((x) => x.id === v.legal_entity_id);
  const currency = v.type === 'usd_export' ? 'USD' : 'INR';
  const wallets = useMemo(() => {
    const accountIds = new Set((options?.accounts || []).filter((a) => a.legal_entity_id === v.legal_entity_id && a.currency === currency).map((a) => a.id));
    return (options?.wallets || []).filter((w) => accountIds.has(w.bank_account_id));
  }, [options, v.legal_entity_id, currency]);
  const intra = Boolean(entity?.state_code && v.buyer_state_code && entity.state_code === v.buyer_state_code);
  const t = preview(v.type, lines, intra);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...v, workspace_id: v.workspace_id || null, due_date: v.due_date || null, lines: lines.map((l) => ({ ...l, hsn_sac: l.hsn_sac || null, gst_rate: Number(l.gst_rate) })) };
      const { legal_entity_id: entityId, ...rest } = body;
      const res = invoice ? await apiClient.patch(`/group-cash/invoices/${invoice.id}`, rest) : await apiClient.post('/group-cash/invoices', body);
      pushSuccess(invoice ? `Invoice ${res.data.data.invoice.number} updated` : `Invoice ${res.data.data.invoice.number} issued`);
      void entityId;
      onSaved(res.data.data.invoice);
      onClose();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not issue the invoice'), 'Not saved'); } finally { setBusy(false); }
  }
  const gst = v.type === 'gst';
  return (
    <Drawer open={open} onClose={onClose} size="xl" tone={invoice ? 'edit' : 'create'} title={invoice ? `Edit ${invoice.number}` : 'New invoice'}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>Issued by (legal entity)
            <select required disabled={Boolean(invoice)} className={inputCls} value={v.legal_entity_id} onChange={set('legal_entity_id')}><option value="">Choose…</option>{entities.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
          <label className={labelCls}>Type
            <select className={inputCls} value={v.type} onChange={set('type')}>{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className={labelCls}>Invoice date<input required type="date" className={inputCls} value={v.invoice_date} onChange={set('invoice_date')} /></label>
          <label className={labelCls}>Due date (optional)<input type="date" className={inputCls} value={v.due_date} onChange={set('due_date')} /></label>
          <label className={labelCls}>For company (optional tag)
            <select className={inputCls} value={v.workspace_id} onChange={set('workspace_id')}><option value="">None</option>{(options?.workspaces || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </label>
        </div>
        {entity && !entity.invoice_prefix && <p className="rounded-xl bg-warning-50 p-2 text-xs">This entity has no invoice prefix yet. Add one under Setup &gt; Legal entities.</p>}
        <div className="rounded-xl border border-tertiary-100 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Bill to</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>Name<input required className={inputCls} maxLength={200} value={v.buyer_name} onChange={set('buyer_name')} /></label>
            {gst && <label className={labelCls}>Buyer GSTIN (if any)<input className={inputCls} maxLength={15} value={v.buyer_gstin} onChange={(e) => setV((c) => ({ ...c, buyer_gstin: e.target.value.toUpperCase() }))} /></label>}
            {gst && <StateSelect required label="Buyer state (place of supply)" value={v.buyer_state_code} onChange={set('buyer_state_code')} />}
            <label className={`${labelCls} sm:col-span-2`}>Address<textarea rows={2} className={inputCls} maxLength={500} value={v.buyer_address} onChange={set('buyer_address')} /></label>
          </div>
          {gst && v.buyer_state_code && <p className="mt-2 text-xs text-tertiary-500">{intra ? `Same state (${stateName(v.buyer_state_code)}): CGST + SGST.` : `Different state (${stateName(v.buyer_state_code)}): IGST.`}</p>}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Items</p>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-xl border border-tertiary-100 p-2">
              <label className={`${labelCls} col-span-12 sm:col-span-5`}>Description<input required className={inputCls} maxLength={500} value={l.description} onChange={setLine(i, 'description')} /></label>
              {gst && <label className={`${labelCls} col-span-6 sm:col-span-2`}>HSN / SAC<input className={inputCls} maxLength={12} value={l.hsn_sac} onChange={setLine(i, 'hsn_sac')} /></label>}
              <label className={`${labelCls} col-span-3 sm:col-span-1`}>Qty<input required inputMode="decimal" className={inputCls} value={l.qty} onChange={setLine(i, 'qty')} /></label>
              <label className={`${labelCls} col-span-5 sm:col-span-2`}>Rate ({currency})<input required inputMode="decimal" className={inputCls} value={l.rate} onChange={setLine(i, 'rate')} /></label>
              {gst && <label className={`${labelCls} col-span-4 sm:col-span-1`}>GST %<select className={inputCls} value={l.gst_rate} onChange={setLine(i, 'gst_rate')}>{GST_RATES.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>}
              <button type="button" aria-label="Remove item" className="col-span-1 pb-2 text-tertiary-400 hover:text-danger-600 disabled:opacity-30" disabled={lines.length === 1} onClick={() => setLines((c) => c.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs" onClick={() => setLines((c) => [...c, blankLine()])}><Plus className="h-3.5 w-3.5" />Add item</button>
          <p className="text-right text-sm text-tertiary-700">Subtotal {formatMoney(t.sub.toFixed(2), currency)}{gst && ` · GST about ${formatMoney(t.tax.toFixed(2), currency)}`} · <strong>Total about {formatMoney((t.sub + t.tax).toFixed(2), currency)}</strong></p>
        </div>
        <label className={labelCls}>Money will be received in (wallet of this entity, {currency})
          <select required className={inputCls} value={v.receiving_wallet_id} onChange={set('receiving_wallet_id')}>
            <option value="">Choose a wallet…</option>
            {wallets.map((w) => <option key={w.id} value={w.id}>{w.owner_name} · {w.name}{w.bank_account_name ? ` · ${w.bank_account_name}` : ""}</option>)}
          </select>
        </label>
        {v.legal_entity_id && !wallets.length && <p className="text-xs text-warning-700">This entity has no {currency} wallet yet. Add one under Setup.</p>}
        {v.type === 'usd_export' && <label className={labelCls}>Bank and SWIFT details (printed on the invoice; leave empty to use the bank account&apos;s)<textarea rows={3} className={inputCls} maxLength={1000} value={v.payment_instructions} onChange={set('payment_instructions')} /></label>}
        <label className={labelCls}>Notes<textarea rows={2} className={inputCls} maxLength={2000} value={v.notes} onChange={set('notes')} /></label>
        <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={busy || !v.legal_entity_id || !v.receiving_wallet_id}>{busy ? 'Saving…' : invoice ? 'Save changes' : 'Issue invoice'}</button></div>
      </form>
    </Drawer>
  );
}

function InvoiceDrawer({ id, onClose, onChanged }) {
  const { pushSuccess, pushError } = useAlerts();
  const data = useLiveData(() => api(`/invoices/${id}`), { deps: [id], enabled: Boolean(id) });
  const inv = data.data;
  const [pay, setPay] = useState({ date: today(), amount: '', mode: 'neft', notes: '' });
  const [reason, setReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editPay, setEditPay] = useState(null);
  const meta = useLiveData(() => api('/options'), { deps: [] });
  const entityList = useLiveData(() => api('/entities'), { deps: [] });
  useEffect(() => { if (inv) setPay((c) => ({ ...c, amount: inv.balance })); }, [inv?.balance]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn, ok, fallback) => {
    try { await fn(); pushSuccess(ok); data.refresh(); onChanged(); } catch (err) { pushError(apiErrorMessage(err, fallback), 'Not saved'); }
  };
  const cur = inv?.currency;
  return (
    <Drawer open={Boolean(id)} onClose={onClose} size="xl" tone="info" title={inv ? `${inv.number} · ${inv.buyer_name}` : 'Invoice'}>
      {!inv ? <Skeleton className="h-40" /> : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={STATUS[inv.payment_status][0]}>{STATUS[inv.payment_status][1]}</Pill>
            <Pill tone="blue">{TYPE_LABEL[inv.type]}</Pill>
            <span className="text-xs text-tertiary-500">{inv.seller?.name} · {inv.invoice_date}{inv.due_date ? ` · due ${inv.due_date}` : ''}</span>
            {inv.payment_status !== 'cancelled' && <button type="button" className="btn-secondary ml-auto inline-flex items-center gap-1" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" />Edit</button>}
            <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => downloadFile(`/group-cash/invoices/${id}/pdf`, undefined, `${inv.number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`).catch((e) => pushError(apiErrorMessage(e, 'Could not download'), 'Download failed'))}><Download className="h-4 w-4" />PDF</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-tertiary-100">
            <table className="min-w-full text-sm">
              <thead className="bg-tertiary-50 text-left text-xs text-tertiary-500"><tr><th className="p-2">Item</th>{inv.type === 'gst' && <th className="p-2">HSN/SAC</th>}<th className="p-2 text-right">Qty</th><th className="p-2 text-right">Rate</th>{inv.type === 'gst' && <th className="p-2 text-right">GST %</th>}<th className="p-2 text-right">Amount</th></tr></thead>
              <tbody>{inv.lines.map((l, i) => <tr key={i} className="border-t border-tertiary-100"><td className="p-2">{l.description}</td>{inv.type === 'gst' && <td className="p-2">{l.hsn_sac}</td>}<td className="p-2 text-right">{l.qty}</td><td className="p-2 text-right">{formatMoney(l.rate, cur)}</td>{inv.type === 'gst' && <td className="p-2 text-right">{l.gst_rate}</td>}<td className="p-2 text-right">{formatMoney(l.amount, cur)}</td></tr>)}</tbody>
            </table>
          </div>
          <dl className="ml-auto max-w-xs space-y-1">
            {[['Subtotal', inv.subtotal], ['CGST', inv.cgst], ['SGST', inv.sgst], ['IGST', inv.igst]].filter(([l, x]) => l === 'Subtotal' || Number(x) > 0).map(([l, x]) => <div key={l} className="flex justify-between"><dt className="text-tertiary-500">{l}</dt><dd>{formatMoney(x, cur)}</dd></div>)}
            <div className="flex justify-between border-t border-tertiary-100 pt-1 font-semibold"><dt>Total</dt><dd>{formatMoney(inv.total, cur)}</dd></div>
            <div className="flex justify-between"><dt className="text-tertiary-500">Received</dt><dd>{formatMoney(inv.paid, cur)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Still due</dt><dd>{formatMoney(inv.balance, cur)}</dd></div>
          </dl>
          <div>
            <h4 className="mb-1 font-heading font-semibold text-tertiary-900">Payments received</h4>
            <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
              {inv.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-3 py-2"><span className="flex-1">{p.date} · {p.mode.toUpperCase()}{p.notes ? ` · ${p.notes}` : ''}</span><span className="tabular-nums">{formatMoney(p.amount, cur)}</span>
                  <button type="button" title="Edit this payment" className="rounded p-1 text-tertiary-400 hover:text-primary-600" onClick={() => setEditPay({ id: p.id, date: p.date, amount: p.amount, mode: p.mode, notes: p.notes || '' })}><Pencil className="h-4 w-4" /></button>
                  <button type="button" title="Remove this payment (the wallet entry goes too)" className="rounded p-1 text-tertiary-400 hover:text-danger-600" onClick={() => window.confirm('Remove this payment? The receipt is taken out of the wallet too.') && run(() => apiClient.delete(`/group-cash/invoices/${id}/payments/${p.id}`), 'Payment removed', 'Could not remove')}><Trash2 className="h-4 w-4" /></button></li>
              ))}
              {!inv.payments.length && <li className="px-3 py-3 text-tertiary-500">Nothing received yet.</li>}
            </ul>
          </div>
          {inv.payment_status !== 'cancelled' && inv.payment_status !== 'paid' && (
            <form className="grid grid-cols-2 items-end gap-3 rounded-xl border border-primary-100 bg-primary-50/30 p-3 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); run(() => apiClient.post(`/group-cash/invoices/${id}/payments`, pay), 'Payment recorded in the wallet', 'Could not record the payment'); }}>
              <label className={labelCls}>Date<input required type="date" className={inputCls} value={pay.date} onChange={(e) => setPay((c) => ({ ...c, date: e.target.value }))} /></label>
              <label className={labelCls}>Amount<input required inputMode="decimal" className={inputCls} value={pay.amount} onChange={(e) => setPay((c) => ({ ...c, amount: e.target.value }))} /></label>
              <label className={labelCls}>Mode<select className={inputCls} value={pay.mode} onChange={(e) => setPay((c) => ({ ...c, mode: e.target.value }))}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className={labelCls}>Note<input className={inputCls} maxLength={2000} value={pay.notes} onChange={(e) => setPay((c) => ({ ...c, notes: e.target.value }))} /></label>
              <button type="submit" className="btn-primary">Record payment</button>
            </form>
          )}
          {inv.payment_status !== 'cancelled' && !inv.payments.length && (
            cancelOpen ? (
              <div className="flex flex-wrap items-end gap-2"><label className={`${labelCls} flex-1`}>Why is it cancelled?<input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></label><button type="button" className="btn-secondary text-danger-600" disabled={reason.trim().length < 3} onClick={() => run(() => apiClient.post(`/group-cash/invoices/${id}/cancel`, { reason }), 'Invoice cancelled (its number stays used)', 'Could not cancel')}>Cancel invoice</button></div>
            ) : <button type="button" className="inline-flex items-center gap-1 text-xs text-danger-600 hover:underline" onClick={() => setCancelOpen(true)}><Ban className="h-3.5 w-3.5" />Cancel this invoice</button>
          )}
          {inv.cancelled_reason && <p className="text-xs text-tertiary-500">Cancelled: {inv.cancelled_reason}</p>}
        </div>
      )}
      <NewInvoiceDrawer open={editOpen} invoice={inv} options={meta.data} entities={entityList.data || []} onClose={() => setEditOpen(false)} onSaved={() => { data.refresh(); onChanged(); }} />
      <Drawer open={Boolean(editPay)} onClose={() => setEditPay(null)} size="sm" tone="edit" title="Edit payment">
        {editPay && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await apiClient.patch(`/group-cash/invoices/${id}/payments/${editPay.id}`, { date: editPay.date, amount: editPay.amount, mode: editPay.mode, notes: editPay.notes || null }); setEditPay(null); }, 'Payment updated (the wallet entry too)', 'Could not update the payment'); }}>
            <label className={labelCls}>Date<input required type="date" className={inputCls} value={editPay.date} onChange={(e) => setEditPay((c) => ({ ...c, date: e.target.value }))} /></label>
            <label className={labelCls}>Amount<input required inputMode="decimal" className={inputCls} value={editPay.amount} onChange={(e) => setEditPay((c) => ({ ...c, amount: e.target.value }))} /></label>
            <label className={labelCls}>Mode<select className={inputCls} value={editPay.mode} onChange={(e) => setEditPay((c) => ({ ...c, mode: e.target.value }))}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className={labelCls}>Note<input className={inputCls} maxLength={2000} value={editPay.notes} onChange={(e) => setEditPay((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="flex justify-end"><button type="submit" className="btn-primary">Save</button></div>
          </form>
        )}
      </Drawer>
    </Drawer>
  );
}

/** Book Keeping > Invoices: what each legal entity has billed, what is still due, and the receipts that went into wallets. */
export default function GroupInvoicesView({ options, onWalletsChanged }) {
  const [f, setF] = useState({ legal_entity_id: '', status: '', from: '', to: '', search: '' });
  const [newOpen, setNewOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const params = Object.fromEntries(Object.entries(f).filter(([, x]) => x));
  const list = useLiveData(() => api('/invoices', params), { deps: [f.legal_entity_id, f.status, f.from, f.to, f.search] });
  const entities = useLiveData(() => api('/entities'), { deps: [] });
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const d = list.data;
  const changed = () => { list.refresh(); onWalletsChanged?.(); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelCls}>Legal entity<select className={inputCls} value={f.legal_entity_id} onChange={set('legal_entity_id')}><option value="">All</option>{(options?.entities || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className={labelCls}>Status<select className={inputCls} value={f.status} onChange={set('status')}><option value="">All</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={labelCls}>From<input type="date" className={inputCls} value={f.from} onChange={set('from')} /></label>
        <label className={labelCls}>To<input type="date" className={inputCls} value={f.to} onChange={set('to')} /></label>
        <label className={labelCls}>Search<input className={inputCls} placeholder="Number or buyer" value={f.search} onChange={set('search')} /></label>
        <button type="button" className="btn-primary ml-auto inline-flex items-center gap-2" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />New invoice</button>
      </div>
      {!d ? <Skeleton className="h-40" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-tertiary-100 bg-white p-3"><p className="text-xs text-tertiary-500">Billed (not cancelled)</p><p className="font-heading text-lg font-semibold">{formatMoney(d.totals.INR, 'INR')} · {formatMoney(d.totals.USD, 'USD')}</p></div>
            <div className="rounded-2xl border border-tertiary-100 bg-white p-3"><p className="text-xs text-tertiary-500">Still to receive</p><p className="font-heading text-lg font-semibold">{formatMoney(d.outstanding.INR, 'INR')} · {formatMoney(d.outstanding.USD, 'USD')}</p></div>
          </div>
          {!d.rows.length ? <EmptyState icon={FileText} title="No invoices yet" description="Issue an invoice from a legal entity; payments you record go straight into its wallet." /> : (
            <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-tertiary-50 text-left text-xs text-tertiary-500"><tr><th className="p-2">Number</th><th className="p-2">Date</th><th className="p-2">Buyer</th><th className="p-2">Issued by</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Due</th><th className="p-2">Status</th></tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id} className="cursor-pointer border-t border-tertiary-100 hover:bg-tertiary-50/60" onClick={() => setOpenId(r.id)}>
                      <td className="p-2 font-mono text-xs font-medium text-primary-700">{r.number}</td>
                      <td className="p-2 whitespace-nowrap">{r.invoice_date}</td>
                      <td className="p-2">{r.buyer_name}</td>
                      <td className="p-2 text-xs text-tertiary-500">{r.legal_entity_name}</td>
                      <td className="p-2 text-right tabular-nums">{formatMoney(r.total, r.currency)}</td>
                      <td className="p-2 text-right tabular-nums">{r.payment_status === 'cancelled' ? '—' : formatMoney(r.balance, r.currency)}</td>
                      <td className="p-2"><Pill tone={STATUS[r.payment_status][0]}>{STATUS[r.payment_status][1]}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <NewInvoiceDrawer open={newOpen} options={options} entities={entities.data || []} onClose={() => setNewOpen(false)} onSaved={(inv) => { changed(); setOpenId(inv.id); }} />
      <InvoiceDrawer id={openId} onClose={() => setOpenId(null)} onChanged={changed} />
    </div>
  );
}
