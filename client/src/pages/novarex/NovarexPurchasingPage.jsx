import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { useNovarex, nxCan } from '../../lib/novarex/useNovarex.js';
import { useOpsPickers } from '../../lib/novarex/opsPickers.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { DateInput, Select, Area, today } from '../../components/novarex/ui.jsx';
import LinesEditor from '../../components/novarex/ops/LinesEditor.jsx';
import MasterPage, { statusPill } from '../../components/novarex/ops/MasterPage.jsx';
import { Btn, Money, inputCls, num, useAction, useRows } from '../../components/novarex/ops/common.jsx';

const PO_LINE_BLANK = { product_id: '', qty: '', unit_price: '', gst_rate: '' };
const GRN_LINE_BLANK = { product_id: '', batch_no: '', mfg_date: '', expiry_date: '', received_qty: '', damaged_qty: '0', rejected_qty: '0', unit_cost: '' };

function PurchaseOrderDrawer({ open, onClose, po, pk, onSaved }) {
  const { pushSuccess } = useAlerts();
  const [v, setV] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState(null);
  if (open && seed !== (po?.id || 'new')) {
    setSeed(po?.id || 'new');
    setV({ supplier_id: po?.supplier_id || '', warehouse_id: po?.warehouse_id || '', order_date: po?.order_date || today(), expected_date: po?.expected_date || '', notes: po?.notes || '', lines: (po?.lines || []).map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, gst_rate: l.gst_rate })) });
    setErr('');
  }
  if (!open && seed) setSeed(null);
  if (!v) return null;
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const total = v.lines.reduce((a, l) => a + num(l.qty) * num(l.unit_price) * (1 + (l.gst_rate === '' ? 0 : num(l.gst_rate)) / 100), 0);
  async function save(e) {
    e.preventDefault(); setSaving(true); setErr('');
    try {
      const body = { supplier_id: v.supplier_id, warehouse_id: v.warehouse_id, order_date: v.order_date || undefined, expected_date: v.expected_date || null, notes: v.notes || null, lines: v.lines.map((l) => ({ product_id: l.product_id, qty: num(l.qty), unit_price: num(l.unit_price), ...(l.gst_rate === '' ? {} : { gst_rate: num(l.gst_rate) }) })) };
      if (po) await nxApi.ops.updatePo(po.id, body); else await nxApi.ops.createPo(body);
      pushSuccess(po ? 'Purchase order updated' : 'Purchase order created'); onSaved(); onClose();
    } catch (x) { setErr(novarexError(x, 'Could not save')); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="xl" tone={po ? 'edit' : 'create'} title={po ? `Edit ${po.po_no}` : 'New purchase order'}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Supplier" value={v.supplier_id} onChange={set('supplier_id')} options={pk.suppliers} blank="Select supplier" required />
          <Select label="Deliver to warehouse" value={v.warehouse_id} onChange={set('warehouse_id')} options={pk.warehouses} blank="Select warehouse" required />
          <DateInput label="Order date" value={v.order_date} onChange={set('order_date')} />
          <DateInput label="Expected delivery" value={v.expected_date} onChange={set('expected_date')} />
        </div>
        <LinesEditor value={v.lines} onChange={set('lines')} blank={PO_LINE_BLANK} addLabel="Add product" totals={`Total incl. GST: ${total.toFixed(2)}`}
          fields={[
            { key: 'product_id', label: 'Product', type: 'select', options: pk.products, onPick: (l, id) => { const p = pk.raw.products?.find((x) => x.id === id); return p ? { unit_price: l.unit_price || p.purchase_price, gst_rate: p.gst_rate } : {}; } },
            { key: 'qty', label: 'Quantity', type: 'num', width: '6rem' }, { key: 'unit_price', label: 'Unit price', type: 'num', width: '7rem' }, { key: 'gst_rate', label: 'GST %', type: 'num', width: '5rem' },
          ]} />
        <Area label="Notes" value={v.notes} onChange={set('notes')} rows={2} />
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></div>
      </form>
    </Drawer>
  );
}

function ReceiptDrawer({ open, onClose, init, pk, onSaved }) {
  const { pushSuccess } = useAlerts();
  const [v, setV] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState(null);
  const key = init ? `${init.id || init.po_id || 'x'}` : null;
  if (open && seed !== key) {
    setSeed(key);
    setV({ po_id: init?.po_id || '', supplier_id: init?.supplier_id || '', warehouse_id: init?.warehouse_id || '', receipt_date: init?.receipt_date || today(), notes: init?.notes || '', lines: (init?.lines || [GRN_LINE_BLANK]).map((l) => ({ ...GRN_LINE_BLANK, ...l })) });
    setErr('');
  }
  if (!open && seed) setSeed(null);
  if (!v) return null;
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  async function save(e) {
    e.preventDefault(); setSaving(true); setErr('');
    try {
      const body = { po_id: v.po_id || null, supplier_id: v.supplier_id || null, warehouse_id: v.warehouse_id || null, receipt_date: v.receipt_date || undefined, notes: v.notes || null, lines: v.lines.map((l) => ({ product_id: l.product_id, batch_no: l.batch_no, mfg_date: l.mfg_date || null, expiry_date: l.expiry_date || null, received_qty: num(l.received_qty), damaged_qty: num(l.damaged_qty), rejected_qty: num(l.rejected_qty), unit_cost: num(l.unit_cost) })) };
      if (init?.id) await nxApi.ops.updateReceipt(init.id, body); else await nxApi.ops.createReceipt(body);
      pushSuccess('Goods receipt saved. It adds no stock until it is posted.'); onSaved(); onClose();
    } catch (x) { setErr(novarexError(x, 'Could not save')); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="xl" tone={init?.id ? 'edit' : 'create'} title={init?.id ? 'Edit goods receipt' : 'New goods receipt'}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Supplier" value={v.supplier_id} onChange={set('supplier_id')} options={pk.suppliers} blank="From the purchase order" disabled={Boolean(v.po_id)} />
          <Select label="Receiving warehouse" value={v.warehouse_id} onChange={set('warehouse_id')} options={pk.warehouses} blank="From the purchase order" disabled={Boolean(v.po_id)} />
          <DateInput label="Receipt date" value={v.receipt_date} onChange={set('receipt_date')} />
        </div>
        <p className="text-xs text-tertiary-500">Enter each batch as it arrived. Damaged units go to damaged stock; rejected units are not stocked and not billed. Stock and the supplier invoice are created only when you post the receipt.</p>
        <LinesEditor value={v.lines} onChange={set('lines')} blank={GRN_LINE_BLANK} addLabel="Add batch line"
          fields={[
            { key: 'product_id', label: 'Product', type: 'select', options: pk.products, onPick: (l, id) => { const p = pk.raw.products?.find((x) => x.id === id); return p ? { unit_cost: l.unit_cost || p.purchase_price } : {}; } },
            { key: 'batch_no', label: 'Batch no.', type: 'text', width: '7rem' }, { key: 'mfg_date', label: 'Mfg date', type: 'date', width: '9rem' }, { key: 'expiry_date', label: 'Expiry date', type: 'date', width: '9rem' },
            { key: 'received_qty', label: 'Received', type: 'num', width: '5.5rem' }, { key: 'damaged_qty', label: 'Damaged', type: 'num', width: '5.5rem' }, { key: 'rejected_qty', label: 'Rejected', type: 'num', width: '5.5rem' }, { key: 'unit_cost', label: 'Unit cost', type: 'num', width: '6rem' },
          ]} />
        <Area label="Notes" value={v.notes} onChange={set('notes')} rows={2} />
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save draft'}</button></div>
      </form>
    </Drawer>
  );
}

/** Suppliers, purchase orders and goods receipts. Posting a receipt is the only thing that adds stock. */
export default function NovarexPurchasingPage() {
  const { me, loading } = useNovarex();
  const pk = useOpsPickers();
  const [tab, setTab] = useState('po');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [supplier, setSupplier] = useState('');
  const [poDrawer, setPoDrawer] = useState({ open: false, po: null });
  const [grnDrawer, setGrnDrawer] = useState({ open: false, init: null });
  const canEdit = nxCan(me, 'purchasingEdit');
  const pos = useRows(() => (tab === 'po' ? nxApi.ops.pos({ status, q, supplier_id: supplier }) : Promise.resolve(null)), [tab, status, q, supplier]);
  const grns = useRows(() => (tab === 'grn' ? nxApi.ops.receipts({ status, supplier_id: supplier }) : Promise.resolve(null)), [tab, status, supplier]);
  const act = useAction(() => Promise.all([pos.reload(), grns.reload()]));
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'purchasing')) return <Navigate to="/novarex" replace />;

  const poCols = [
    { key: 'no', header: 'PO', render: (r) => <span><span className="font-medium text-tertiary-900">{r.po_no}</span><span className="block text-xs text-tertiary-500">{dateLabel(r.order_date)}</span></span> },
    { key: 'sup', header: 'Supplier', render: (r) => r.supplier },
    { key: 'wh', header: 'Deliver to', render: (r) => r.warehouse },
    { key: 'exp', header: 'Expected', render: (r) => (r.expected_date ? dateLabel(r.expected_date) : '-') },
    { key: 'rec', header: 'Received', render: (r) => { const o = r.lines.reduce((a, l) => a + l.qty, 0); const g = r.lines.reduce((a, l) => a + (l.received_qty || 0), 0); return `${g} / ${o}`; } },
    { key: 'tot', header: 'Total (incl. GST)', render: (r) => <Money v={r.total} /> },
    { key: 'st', header: 'Status', render: (r) => <Pill value={r.status} /> },
    { key: 'a', header: '', render: (r) => canEdit && (
      <span className="flex flex-wrap justify-end gap-1">
        {['draft', 'submitted'].includes(r.status) && <Btn onClick={() => setPoDrawer({ open: true, po: r })}>Edit</Btn>}
        {r.status === 'draft' && <Btn onClick={() => act(() => nxApi.ops.actPo(r.id, 'submit', {}), { done: 'Submitted for approval' })}>Submit</Btn>}
        {['draft', 'submitted'].includes(r.status) && <Btn primary onClick={() => act(() => nxApi.ops.actPo(r.id, 'approve', {}), { done: 'Approved' })}>Approve</Btn>}
        {['approved', 'partially_received'].includes(r.status) && <Btn primary onClick={() => setGrnDrawer({ open: true, init: { po_id: r.id, supplier_id: r.supplier_id, warehouse_id: r.warehouse_id, lines: r.lines.map((l) => ({ product_id: l.product_id, received_qty: Math.max(0, l.qty - (l.received_qty || 0)), unit_cost: l.unit_price })) } })}>Receive goods</Btn>}
        {['draft', 'submitted', 'approved'].includes(r.status) && <Btn danger onClick={() => act(() => nxApi.ops.actPo(r.id, 'cancel', {}), { confirm: `Cancel ${r.po_no}?`, done: 'Cancelled' })}>Cancel</Btn>}
        {r.status === 'cancelled' && <Btn onClick={() => act(() => nxApi.ops.actPo(r.id, 'reopen', {}), { done: 'Reopened as draft' })}>Reopen</Btn>}
      </span>
    ) },
  ];
  const grnCols = [
    { key: 'no', header: 'Receipt', render: (r) => <span><span className="font-medium text-tertiary-900">{r.grn_no}</span><span className="block text-xs text-tertiary-500">{dateLabel(r.receipt_date)}</span></span> },
    { key: 'sup', header: 'Supplier', render: (r) => r.supplier },
    { key: 'wh', header: 'Warehouse', render: (r) => r.warehouse },
    { key: 'lines', header: 'Batches', render: (r) => r.lines.map((l) => `${l.batch_no} x${l.received_qty}`).join(', ') },
    { key: 'st', header: 'Status', render: (r) => <Pill value={r.status} tone={r.status === 'posted' ? 'green' : 'amber'} /> },
    { key: 'a', header: '', render: (r) => canEdit && r.status === 'draft' && (
      <span className="flex justify-end gap-1">
        <Btn onClick={() => setGrnDrawer({ open: true, init: r })}>Edit</Btn>
        <Btn primary onClick={() => act(() => nxApi.ops.postReceipt(r.id), { confirm: `Post ${r.grn_no}? Stock and the supplier invoice are created once and cannot be undone here.`, done: 'Posted: stock updated and supplier invoice created' })}>Post</Btn>
        <Btn danger onClick={() => act(() => nxApi.ops.deleteReceipt(r.id), { confirm: `Delete draft ${r.grn_no}?`, done: 'Deleted' })}>Delete</Btn>
      </span>
    ) },
  ];
  const supCols = [
    { key: 'n', header: 'Supplier', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}{r.gstin ? ` · ${r.gstin}` : ''}</span></span> },
    { key: 'c', header: 'Contact', render: (r) => [r.contact_name, r.phone].filter(Boolean).join(' · ') || '-' },
    { key: 'l', header: 'Licence', render: (r) => (r.licence_no ? `${r.licence_no}${r.licence_expiry ? ` (to ${dateLabel(r.licence_expiry)})` : ''}` : '-') },
    { key: 'cr', header: 'Credit', render: (r) => `${r.credit_days} days` },
    { key: 's', header: 'Status', render: statusPill },
  ];
  const supFields = [
    { key: 'name', label: 'Supplier name', required: true, span: 2 }, { key: 'code', label: 'Code', placeholder: 'Leave blank to generate' }, { key: 'contact_name', label: 'Contact person' },
    { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'gstin', label: 'GSTIN' }, { key: 'state', label: 'State (for GST)' },
    { key: 'licence_no', label: 'Drug / distributor licence no.' }, { key: 'licence_expiry', label: 'Licence expiry', type: 'date' }, { key: 'credit_days', label: 'Credit days', type: 'num' },
    { key: 'status', label: 'Status', type: 'select', required: true, default: 'active', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] }, { key: 'address', label: 'Address', type: 'area' }, { key: 'notes', label: 'Notes', type: 'area' },
  ];
  const poStatus = ['draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled'];
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={[{ key: 'po', label: 'Purchase orders' }, { key: 'grn', label: 'Goods receipts' }, { key: 'sup', label: 'Suppliers' }]} value={tab} onChange={(t) => { setTab(t); setStatus(''); }} />
      {tab !== 'sup' && (
        <div className="flex flex-wrap items-end gap-2">
          {tab === 'po' && <input className={`${inputCls} min-w-[12rem]`} placeholder="Search PO number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />}
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{(tab === 'po' ? poStatus : ['draft', 'posted']).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
          <select className={inputCls} value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Supplier"><option value="">All suppliers</option>{pk.suppliers.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          {canEdit && tab === 'po' && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => setPoDrawer({ open: true, po: null })}><Plus className="h-4 w-4" />New purchase order</button>}
          {canEdit && tab === 'grn' && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => setGrnDrawer({ open: true, init: {} })}><Plus className="h-4 w-4" />New goods receipt</button>}
        </div>
      )}
      {tab === 'po' && <DataTable columns={poCols} rows={pos.rows || []} loading={!pos.rows} emptyLabel="No purchase orders yet." />}
      {tab === 'grn' && <DataTable columns={grnCols} rows={grns.rows || []} loading={!grns.rows} emptyLabel="No goods receipts yet." />}
      {tab === 'sup' && <MasterPage resource="suppliers" singular="Supplier" columns={supCols} fields={supFields} canEdit={nxCan(me, 'purchasingEdit')} statusOptions={['active', 'inactive']} onChanged={pk.refresh} searchHint="Search name, code, GSTIN, licence..." />}
      <PurchaseOrderDrawer open={poDrawer.open} po={poDrawer.po} pk={pk} onClose={() => setPoDrawer({ open: false, po: null })} onSaved={pos.reload} />
      <ReceiptDrawer open={grnDrawer.open} init={grnDrawer.init} pk={pk} onClose={() => setGrnDrawer({ open: false, init: null })} onSaved={() => { grns.reload(); pos.reload(); }} />
    </div>
  );
}
