import { useEffect, useState } from 'react';
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
import { Area, Num, Select, Text, Detail } from '../../components/novarex/ui.jsx';
import LinesEditor from '../../components/novarex/ops/LinesEditor.jsx';
import MasterPage, { statusPill } from '../../components/novarex/ops/MasterPage.jsx';
import { Btn, Money, inputCls, num, titleOf, useAction, useRows } from '../../components/novarex/ops/common.jsx';

const EXPIRY_TONE = { expired: 'red', near_expiry: 'amber', ok: 'green', no_expiry: 'gray' };
const BUCKETS = ['available', 'reserved', 'in_transit', 'damaged', 'quarantine', 'lost'];

function TransferDrawer({ open, onClose, pk, onSaved }) {
  const { pushSuccess } = useAlerts();
  const [v, setV] = useState({ from_warehouse_id: '', to_warehouse_id: '', notes: '', lines: [] });
  const [stock, setStock] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setV({ from_warehouse_id: '', to_warehouse_id: '', notes: '', lines: [{ product_id: '', batch_id: '', qty: '' }] }); setErr(''); } }, [open]);
  useEffect(() => { if (v.from_warehouse_id) nxApi.ops.onHand({ warehouse_id: v.from_warehouse_id }).then(setStock, () => setStock([])); else setStock([]); }, [v.from_warehouse_id]);
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const batchOpts = (l) => stock.filter((s) => s.product_id === l.product_id && s.available > 0 && s.quality_status === 'released' && s.expiry_state !== 'expired').map((s) => ({ value: s.batch_id, label: `${s.batch_no} · exp ${s.expiry_date || '-'} · ${s.available} available` }));
  const prodOpts = [...new Map(stock.filter((s) => s.available > 0).map((s) => [s.product_id, { value: s.product_id, label: `${s.sku} ${s.product}` }])).values()];
  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      await nxApi.ops.createTransfer({ from_warehouse_id: v.from_warehouse_id, to_warehouse_id: v.to_warehouse_id, notes: v.notes || null, lines: v.lines.map((l) => ({ product_id: l.product_id, batch_id: l.batch_id, qty: num(l.qty) })) });
      pushSuccess('Transfer request created'); onSaved(); onClose();
    } catch (x) { setErr(novarexError(x, 'Could not create the transfer')); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="xl" tone="create" title="New stock transfer">
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="From" value={v.from_warehouse_id} onChange={set('from_warehouse_id')} options={pk.warehouses} blank="Select source" required />
          <Select label="To" value={v.to_warehouse_id} onChange={set('to_warehouse_id')} options={pk.warehouses.filter((w) => w.value !== v.from_warehouse_id)} blank="Select destination" required />
        </div>
        <p className="text-xs text-tertiary-500">Moves stock between the company&apos;s own locations. It is never a sale. Goods for a franchise or third-party outlet are sold with a sales order.</p>
        <LinesEditor value={v.lines} onChange={set('lines')} blank={{ product_id: '', batch_id: '', qty: '' }} addLabel="Add product"
          fields={[{ key: 'product_id', label: 'Product', type: 'select', options: prodOpts, onPick: () => ({ batch_id: '' }) }, { key: 'batch_id', label: 'Batch', type: 'select', optionsFor: batchOpts }, { key: 'qty', label: 'Quantity', type: 'num', width: '6rem' }]} />
        <Area label="Notes" value={v.notes} onChange={set('notes')} rows={2} />
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Create request</button></div>
      </form>
    </Drawer>
  );
}

function ReceiveDrawer({ open, transfer, onClose, onDone }) {
  const [lines, setLines] = useState([]);
  const [err, setErr] = useState('');
  const { pushSuccess } = useAlerts();
  useEffect(() => { if (open && transfer) { setErr(''); nxApi.ops.transfer(transfer.id).then((t) => setLines(t.lines.map((l) => ({ ...l, received_qty: l.qty, damaged_qty: 0 })))); } }, [open, transfer]);
  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      await nxApi.ops.actTransfer(transfer.id, 'receive', { lines: lines.map((l) => ({ product_id: l.product_id, batch_id: l.batch_id, received_qty: num(l.received_qty), damaged_qty: num(l.damaged_qty) })) });
      pushSuccess('Receipt confirmed. Destination stock updated.'); onDone(); onClose();
    } catch (x) { setErr(novarexError(x, 'Could not confirm the receipt')); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="xl" tone="edit" title={`Confirm receipt ${transfer?.transfer_no || ''}`}>
      <form onSubmit={save} className="space-y-3">
        <p className="text-xs text-tertiary-500">Enter what actually arrived. A difference from the dispatched quantity is recorded as a shortage; damaged units go to damaged stock.</p>
        <LinesEditor value={lines} onChange={setLines} addLabel="" readOnly={false}
          fields={[{ key: 'product', label: 'Product', type: 'text' }, { key: 'batch_no', label: 'Batch', type: 'text' }, { key: 'qty', label: 'Dispatched', type: 'num', width: '6rem' }, { key: 'received_qty', label: 'Received', type: 'num', width: '6rem' }, { key: 'damaged_qty', label: 'Damaged', type: 'num', width: '6rem' }]} />
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Confirm receipt</button></div>
      </form>
    </Drawer>
  );
}

function AdjustDrawer({ open, onClose, pk, onDone }) {
  const [v, setV] = useState({ warehouse_id: '', product_id: '', batch_id: '', bucket: 'available', qty: '', reason: '' });
  const [batches, setBatches] = useState([]);
  const [err, setErr] = useState('');
  const { pushSuccess } = useAlerts();
  useEffect(() => { if (open) { setV({ warehouse_id: '', product_id: '', batch_id: '', bucket: 'available', qty: '', reason: '' }); setErr(''); } }, [open]);
  useEffect(() => { if (v.product_id) nxApi.ops.batches({ product_id: v.product_id }).then(setBatches, () => setBatches([])); else setBatches([]); }, [v.product_id]);
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  async function save(e) {
    e.preventDefault(); setErr('');
    try { await nxApi.ops.adjust({ ...v, qty: num(v.qty) }); pushSuccess('Adjustment recorded'); onDone(); onClose(); } catch (x) { setErr(novarexError(x, 'Could not adjust')); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="lg" tone="create" title="Stock adjustment">
      <form onSubmit={save} className="space-y-3">
        <Select label="Location" value={v.warehouse_id} onChange={set('warehouse_id')} options={pk.warehouses} blank="Select location" required />
        <Select label="Product" value={v.product_id} onChange={(x) => setV((c) => ({ ...c, product_id: x, batch_id: '' }))} options={pk.products} blank="Select product" required />
        <Select label="Batch" value={v.batch_id} onChange={set('batch_id')} options={batches.map((b) => ({ value: b.id, label: `${b.batch_no} · exp ${b.expiry_date || '-'}` }))} blank="Select batch" required />
        <Select label="Stock bucket" value={v.bucket} onChange={set('bucket')} options={BUCKETS.map((b) => ({ value: b, label: titleOf(b) }))} />
        <Num label="Quantity change (negative to remove)" value={v.qty} onChange={set('qty')} min="-1000000000" hint="A count difference, a write-off or found stock. It can never take a bucket below zero." />
        <Text label="Reason (required, audited)" value={v.reason} onChange={set('reason')} required minLength={3} />
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Record adjustment</button></div>
      </form>
    </Drawer>
  );
}

function TraceDrawer({ batchId, onClose }) {
  const [t, setT] = useState(null);
  useEffect(() => { setT(null); if (batchId) nxApi.ops.trace(batchId).then(setT, () => setT(false)); }, [batchId]);
  return (
    <Drawer open={Boolean(batchId)} onClose={onClose} size="xl" tone="info" title="Batch traceability">
      {t === null && <p className="text-sm text-tertiary-500">Loading...</p>}
      {t === false && <p className="text-sm text-danger-700">Could not load the trace.</p>}
      {t && (
        <div className="space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <Detail label="Product">{t.batch.product} ({t.batch.sku})</Detail><Detail label="Batch">{t.batch.batch_no}</Detail>
            <Detail label="Supplier">{t.batch.supplier}</Detail><Detail label="Expiry">{t.batch.expiry_date ? dateLabel(t.batch.expiry_date) : '-'}</Detail>
            <Detail label="Quality status">{titleOf(t.batch.quality_status)}</Detail><Detail label="Received">{t.batch.received_qty}</Detail>
          </div>
          <TraceList title="Held now" rows={t.holding.map((h) => `${h.warehouse}: ${h.qty} ${titleOf(h.bucket)}`)} />
          <TraceList title="Receipts" rows={t.receipts.map((r) => `${r.grn_no} · ${dateLabel(r.date)}`)} />
          <TraceList title="Transfers" rows={t.transfers.map((r) => `${r.transfer_no} · ${r.from} to ${r.to} · ${titleOf(r.status)}`)} />
          <TraceList title="Sales orders" rows={t.sales_orders.map((r) => `${r.so_no} · ${r.customer} · ${titleOf(r.status)}`)} />
          <TraceList title="Shipments" rows={t.shipments.map((r) => `${r.shipment_no} · ${titleOf(r.status)}`)} />
          <TraceList title="Invoices" rows={t.invoices.map((r) => `${r.invoice_no} · ${r.party} · ${r.total}`)} />
          <TraceList title="Customers who received it" rows={t.customers} />
        </div>
      )}
    </Drawer>
  );
}
const TraceList = ({ title, rows }) => (
  <div><h4 className="mb-1 font-heading text-xs font-semibold uppercase tracking-wide text-tertiary-500">{title}</h4>{rows.length ? <ul className="list-disc space-y-0.5 pl-5">{rows.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="text-xs text-tertiary-400">None</p>}</div>
);

/** Stock: on hand by batch and location, batches and expiry, movements, transfers, adjustments, alerts and locations. */
export default function NovarexStockPage() {
  const { me, loading } = useNovarex();
  const pk = useOpsPickers();
  const [tab, setTab] = useState('onhand');
  const [f, setF] = useState({ q: '', warehouse_id: '', product_id: '', expiry_state: '', batch_status: '' });
  const [trace, setTrace] = useState(null);
  const [tDrawer, setTDrawer] = useState(false);
  const [rcv, setRcv] = useState({ open: false, transfer: null });
  const [adj, setAdj] = useState(false);
  const canEdit = nxCan(me, 'stockEdit');
  const setFilter = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const onhand = useRows(() => (tab === 'onhand' ? nxApi.ops.onHand(f) : null), [tab, f]);
  const prods = useRows(() => (tab === 'products' ? nxApi.ops.productStock({ product_id: f.product_id }) : null), [tab, f.product_id]);
  const batches = useRows(() => (tab === 'batches' ? nxApi.ops.batches(f) : null), [tab, f]);
  const ledger = useRows(() => (tab === 'ledger' ? nxApi.ops.ledger({ warehouse_id: f.warehouse_id, product_id: f.product_id, limit: 300 }) : null), [tab, f.warehouse_id, f.product_id]);
  const trf = useRows(() => (tab === 'transfers' ? nxApi.ops.transfers({ warehouse_id: f.warehouse_id }) : null), [tab, f.warehouse_id]);
  const adjs = useRows(() => (tab === 'adjust' ? nxApi.ops.adjustments({ warehouse_id: f.warehouse_id }) : null), [tab, f.warehouse_id]);
  const al = useRows(() => (tab === 'alerts' ? nxApi.ops.alerts() : null), [tab]);
  const act = useAction(() => Promise.all([onhand.reload(), batches.reload(), trf.reload(), adjs.reload(), prods.reload(), al.reload()]));
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'stock')) return <Navigate to="/novarex" replace />;

  const onCols = [
    { key: 'p', header: 'Product', render: (r) => <span><span className="font-medium text-tertiary-900">{r.product}</span><span className="block text-xs text-tertiary-500">{r.sku}</span></span> },
    { key: 'b', header: 'Batch', render: (r) => <button type="button" className="font-medium text-primary-700 hover:underline" onClick={() => setTrace(r.batch_id)}>{r.batch_no}</button> },
    { key: 'e', header: 'Expiry', render: (r) => <span>{r.expiry_date ? dateLabel(r.expiry_date) : '-'} <Pill tone={EXPIRY_TONE[r.expiry_state]}>{titleOf(r.expiry_state)}</Pill></span> },
    { key: 'w', header: 'Location', render: (r) => <span>{r.warehouse}<span className="block text-xs text-tertiary-500">{r.city || ''}</span></span> },
    { key: 'a', header: 'Available', render: (r) => r.available }, { key: 'r', header: 'Reserved', render: (r) => r.reserved }, { key: 'i', header: 'In transit', render: (r) => r.in_transit },
    { key: 'd', header: 'Damaged', render: (r) => r.damaged }, { key: 'qn', header: 'Quarantine', render: (r) => r.quarantine },
    { key: 'v', header: 'Value', render: (r) => <Money v={r.value} /> }, { key: 'q', header: 'Batch status', render: (r) => <Pill value={r.quality_status} tone={r.quality_status === 'released' ? 'green' : 'red'} /> },
  ];
  const alertTable = (title, rows, tone) => rows && (
    <section className="space-y-1"><h3 className="font-heading text-sm font-semibold text-tertiary-900">{title} <Pill tone={rows.length ? tone : 'green'}>{rows.length}</Pill></h3>{rows.length > 0 && <DataTable columns={onCols.slice(0, 4).concat([{ key: 'a', header: 'Stock', render: (r) => r.available + r.reserved + r.in_transit + r.quarantine }, { key: 'v', header: 'Value', render: (r) => <Money v={r.value} /> }])} rows={rows.map((r, i) => ({ ...r, id: `${r.batch_id}-${r.warehouse_id}-${i}` }))} embedded />}</section>
  );
  const FILTERS = (fields) => (
    <div className="flex flex-wrap items-end gap-2">
      {fields.includes('q') && <input className={`${inputCls} min-w-[14rem] flex-1`} placeholder="Search product, SKU, batch, location..." value={f.q} onChange={setFilter('q')} aria-label="Search" />}
      {fields.includes('warehouse') && <select className={inputCls} value={f.warehouse_id} onChange={setFilter('warehouse_id')} aria-label="Location"><option value="">All locations</option>{pk.warehouses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
      {fields.includes('product') && <select className={inputCls} value={f.product_id} onChange={setFilter('product_id')} aria-label="Product"><option value="">All products</option>{pk.products.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
      {fields.includes('expiry') && <select className={inputCls} value={f.expiry_state} onChange={setFilter('expiry_state')} aria-label="Expiry"><option value="">Any expiry</option><option value="ok">Within shelf life</option><option value="near_expiry">Near expiry</option><option value="expired">Expired</option></select>}
      {fields.includes('batch') && <select className={inputCls} value={f.batch_status} onChange={(e) => setF((c) => ({ ...c, batch_status: e.target.value, quality_status: e.target.value }))} aria-label="Batch status"><option value="">Any batch status</option><option value="released">Released</option><option value="quarantine">Quarantine</option><option value="rejected">Rejected</option><option value="recalled">Recalled</option></select>}
    </div>
  );
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={[{ key: 'onhand', label: 'On hand' }, { key: 'products', label: 'By product' }, { key: 'batches', label: 'Batches and expiry' }, { key: 'ledger', label: 'Movements' }, { key: 'transfers', label: 'Transfers' }, { key: 'adjust', label: 'Adjustments' }, { key: 'alerts', label: 'Alerts' }, { key: 'locations', label: 'Locations' }]} value={tab} onChange={setTab} />
      {tab === 'onhand' && <>{FILTERS(['q', 'warehouse', 'product', 'expiry', 'batch'])}<DataTable columns={onCols} rows={(onhand.rows || []).map((r) => ({ ...r, id: `${r.batch_id}-${r.warehouse_id}` }))} loading={!onhand.rows} emptyLabel="No stock matches these filters." /></>}
      {tab === 'products' && <>{FILTERS(['product'])}<DataTable columns={[{ key: 'p', header: 'Product', render: (r) => <span><span className="font-medium text-tertiary-900">{r.product}</span><span className="block text-xs text-tertiary-500">{r.sku}</span></span> }, { key: 'a', header: 'Available', render: (r) => r.available }, { key: 'r', header: 'Reserved', render: (r) => r.reserved }, { key: 'i', header: 'In transit', render: (r) => r.in_transit }, { key: 'd', header: 'Damaged', render: (r) => r.damaged }, { key: 'm', header: 'Minimum', render: (r) => r.reorder_level || '-' }, { key: 'v', header: 'Value', render: (r) => <Money v={r.value} /> }, { key: 's', header: 'Reorder', render: (r) => (r.below_reorder ? <Pill tone="red">Reorder now</Pill> : <Pill tone="green">OK</Pill>) }]} rows={(prods.rows || []).map((r) => ({ ...r, id: r.product_id }))} loading={!prods.rows} /></>}
      {tab === 'batches' && <>{FILTERS(['q', 'product', 'expiry', 'batch'])}<DataTable columns={[{ key: 'p', header: 'Product', render: (r) => <span><span className="font-medium text-tertiary-900">{r.product}</span><span className="block text-xs text-tertiary-500">{r.sku}</span></span> }, { key: 'b', header: 'Batch', render: (r) => <button type="button" className="font-medium text-primary-700 hover:underline" onClick={() => setTrace(r.id)}>{r.batch_no}</button> }, { key: 'e', header: 'Expiry', render: (r) => <span>{r.expiry_date ? dateLabel(r.expiry_date) : '-'} <Pill tone={EXPIRY_TONE[r.expiry_state]}>{titleOf(r.expiry_state)}</Pill></span> }, { key: 's', header: 'Supplier', render: (r) => r.supplier || '-' }, { key: 'c', header: 'Unit cost', render: (r) => <Money v={r.unit_cost} /> }, { key: 'q', header: 'Quality status', render: (r) => (canEdit ? <select className={inputCls} value={r.quality_status} onClick={(e) => e.stopPropagation()} onChange={(e) => act(() => nxApi.ops.updateBatch(r.id, { quality_status: e.target.value, reason: 'Status changed on the stock screen' }), { done: 'Batch status updated' })}>{['released', 'quarantine', 'rejected', 'recalled'].map((s) => <option key={s} value={s}>{titleOf(s)}</option>)}</select> : <Pill value={r.quality_status} />) }]} rows={batches.rows || []} loading={!batches.rows} emptyLabel="No batches." /></>}
      {tab === 'ledger' && <>{FILTERS(['warehouse', 'product'])}<DataTable columns={[{ key: 'd', header: 'Date', render: (r) => dateLabel(r.date) }, { key: 'p', header: 'Product', render: (r) => r.product }, { key: 'b', header: 'Batch', render: (r) => r.batch_no }, { key: 'w', header: 'Location', render: (r) => r.warehouse }, { key: 'k', header: 'Bucket', render: (r) => titleOf(r.bucket) }, { key: 'q', header: 'Quantity', render: (r) => <span className={r.qty < 0 ? 'text-red-600' : 'text-emerald-700'}>{r.qty > 0 ? '+' : ''}{r.qty}</span> }, { key: 'm', header: 'Movement', render: (r) => titleOf(r.movement) }, { key: 'n', header: 'Note', render: (r) => r.note || '' }]} rows={ledger.rows || []} loading={!ledger.rows} emptyLabel="No movements." /></>}
      {tab === 'transfers' && <>
        <div className="flex flex-wrap items-end gap-2">{FILTERS(['warehouse'])}{canEdit && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => setTDrawer(true)}><Plus className="h-4 w-4" />New transfer</button>}</div>
        <DataTable columns={[{ key: 'n', header: 'Transfer', render: (r) => <span><span className="font-medium text-tertiary-900">{r.transfer_no}</span><span className="block text-xs text-tertiary-500">{dateLabel(r.request_date)}</span></span> }, { key: 'f', header: 'From', render: (r) => r.from }, { key: 't', header: 'To', render: (r) => r.to }, { key: 'l', header: 'Lines', render: (r) => `${r.lines.length} line(s), ${r.lines.reduce((a, l) => a + Number(l.qty), 0)} units` }, { key: 's', header: 'Status', render: (r) => <Pill value={r.status} tone={r.status === 'received' ? 'green' : r.status === 'dispatched' ? 'blue' : r.status === 'cancelled' ? 'red' : 'amber'} /> }, { key: 'a', header: '', render: (r) => canEdit && (<span className="flex flex-wrap justify-end gap-1">{r.status === 'draft' && <Btn onClick={() => act(() => nxApi.ops.actTransfer(r.id, 'approve', {}), { done: 'Approved' })}>Approve</Btn>}{['draft', 'approved'].includes(r.status) && <Btn primary onClick={() => act(() => nxApi.ops.actTransfer(r.id, 'dispatch', {}), { done: 'Dispatched: stock is now in transit' })}>Dispatch</Btn>}{r.status === 'dispatched' && <Btn primary onClick={() => setRcv({ open: true, transfer: r })}>Confirm receipt</Btn>}{['draft', 'approved'].includes(r.status) && <Btn danger onClick={() => act(() => nxApi.ops.actTransfer(r.id, 'cancel', {}), { confirm: `Cancel ${r.transfer_no}?`, done: 'Cancelled' })}>Cancel</Btn>}</span>) }]} rows={trf.rows || []} loading={!trf.rows} emptyLabel="No transfers." />
      </>}
      {tab === 'adjust' && <>
        <div className="flex flex-wrap items-end gap-2">{FILTERS(['warehouse'])}{canEdit && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => setAdj(true)}><Plus className="h-4 w-4" />New adjustment</button>}</div>
        <DataTable columns={[{ key: 'd', header: 'Date', render: (r) => dateLabel(r.date) }, { key: 'p', header: 'Product', render: (r) => r.product }, { key: 'b', header: 'Batch', render: (r) => r.batch_no }, { key: 'w', header: 'Location', render: (r) => r.warehouse }, { key: 'k', header: 'Bucket', render: (r) => titleOf(r.bucket) }, { key: 'q', header: 'Change', render: (r) => <span className={r.qty < 0 ? 'text-red-600' : 'text-emerald-700'}>{r.qty > 0 ? '+' : ''}{r.qty}</span> }, { key: 'r', header: 'Reason', render: (r) => r.reason }]} rows={adjs.rows || []} loading={!adjs.rows} emptyLabel="No adjustments." />
      </>}
      {tab === 'alerts' && al.rows && (
        <div className="space-y-5">
          <p className="text-xs text-tertiary-500">Near-expiry warning period: {al.rows.warning_days} days (set in Setup).</p>
          {alertTable('Expired stock', al.rows.expired, 'red')}{alertTable('Near expiry', al.rows.near_expiry, 'amber')}{alertTable('Recalled or rejected batches in stock', al.rows.recalled, 'red')}{alertTable('Quarantined stock', al.rows.quarantined, 'amber')}
          <section className="space-y-1"><h3 className="font-heading text-sm font-semibold text-tertiary-900">Below minimum stock <Pill tone={al.rows.below_reorder.length ? 'amber' : 'green'}>{al.rows.below_reorder.length}</Pill></h3>{al.rows.below_reorder.length > 0 && <DataTable columns={[{ key: 'p', header: 'Product', render: (r) => `${r.sku} ${r.product}` }, { key: 'a', header: 'Available', render: (r) => r.available }, { key: 'm', header: 'Minimum', render: (r) => r.reorder_level }]} rows={al.rows.below_reorder.map((r) => ({ ...r, id: r.product_id }))} embedded />}</section>
        </div>
      )}
      {tab === 'locations' && <MasterPage resource="warehouses" singular="Location" canEdit={canEdit} statusOptions={['active', 'inactive']} onChanged={pk.refresh} searchHint="Search name, code, city..." intro="Warehouses and outlet stock rooms. An outlet's stock room is a location of type outlet linked to that outlet."
        columns={[{ key: 'n', header: 'Location', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}</span></span> }, { key: 't', header: 'Type', render: (r) => titleOf(r.type) }, { key: 'c', header: 'City / state', render: (r) => [r.city, r.state].filter(Boolean).join(', ') || '-' }, { key: 'm', header: 'Manager', render: (r) => r.manager_name || '-' }, { key: 's', header: 'Status', render: statusPill }]}
        fields={[{ key: 'name', label: 'Location name', required: true, span: 2 }, { key: 'code', label: 'Code', placeholder: 'Leave blank to generate' }, { key: 'type', label: 'Type', type: 'select', required: true, default: 'warehouse', options: [{ value: 'warehouse', label: 'Warehouse' }, { value: 'outlet', label: 'Outlet stock room' }, { value: 'virtual', label: 'Other' }] }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'manager_name', label: 'Manager' }, { key: 'address', label: 'Address', type: 'area' }, { key: 'status', label: 'Status', type: 'select', required: true, default: 'active', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] }]} />}
      <TransferDrawer open={tDrawer} onClose={() => setTDrawer(false)} pk={pk} onSaved={trf.reload} />
      <ReceiveDrawer open={rcv.open} transfer={rcv.transfer} onClose={() => setRcv({ open: false, transfer: null })} onDone={() => { trf.reload(); onhand.reload(); }} />
      <AdjustDrawer open={adj} onClose={() => setAdj(false)} pk={pk} onDone={() => { adjs.reload(); onhand.reload(); }} />
      <TraceDrawer batchId={trace} onClose={() => setTrace(null)} />
    </div>
  );
}
