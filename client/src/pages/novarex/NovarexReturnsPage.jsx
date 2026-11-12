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
import { Area, Num, Select, Text } from '../../components/novarex/ui.jsx';
import { Btn, titleOf, useAction, useRows } from '../../components/novarex/ops/common.jsx';

const DISPOSITIONS = [['restock', 'Restock: fit to sell again (cost of sales reversed)'], ['damaged', 'Damaged stock'], ['destroy', 'Destroy / write off'], ['supplier_return', 'Send back to the supplier']];

function ReturnDrawer({ open, onClose, pk, onSaved }) {
  const { pushSuccess } = useAlerts();
  const [v, setV] = useState({ type: 'sales', invoice_id: '', warehouse_id: '', product_id: '', batch_id: '', qty: '', reason: '', from_bucket: 'available' });
  const [invoices, setInvoices] = useState([]);
  const [batches, setBatches] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setV({ type: 'sales', invoice_id: '', warehouse_id: '', product_id: '', batch_id: '', qty: '', reason: '', from_bucket: 'available' }); setErr(''); nxApi.ops.invoices({ type: 'sales' }).then((r) => setInvoices(r.filter((i) => i.status !== 'cancelled')), () => setInvoices([])); } }, [open]);
  useEffect(() => { if (v.product_id) nxApi.ops.batches({ product_id: v.product_id }).then(setBatches, () => setBatches([])); else setBatches([]); }, [v.product_id]);
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const inv = invoices.find((i) => i.id === v.invoice_id);
  const invoiceProducts = inv ? [...new Map((inv.lines || []).map((l) => [`${l.product_id}|${l.batch_id}`, l])).values()] : [];
  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      await nxApi.ops.createReturn({ type: v.type, invoice_id: v.invoice_id || null, warehouse_id: v.warehouse_id, product_id: v.product_id, batch_id: v.batch_id, qty: Number(v.qty), reason: v.reason, ...(v.type === 'purchase' ? { from_bucket: v.from_bucket } : {}) });
      pushSuccess(v.type === 'sales' ? 'Return received into quarantine. Inspect it to decide what happens to the stock.' : 'Supplier return recorded and a debit note raised'); onSaved(); onClose();
    } catch (x) { setErr(novarexError(x, 'Could not record the return')); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="lg" tone="create" title="New return">
      <form onSubmit={save} className="space-y-3">
        <Select label="Return type" value={v.type} onChange={set('type')} options={[{ value: 'sales', label: 'From a customer or outlet (we receive goods back)' }, { value: 'purchase', label: 'To a supplier (we send goods back)' }]} />
        {v.type === 'sales' && <Select label="Original sales invoice" value={v.invoice_id} onChange={(id) => setV((c) => ({ ...c, invoice_id: id, product_id: '', batch_id: '' }))} options={invoices.map((i) => ({ value: i.id, label: `${i.invoice_no} · ${i.party_name}` }))} blank="Select the invoice (needed for a credit note)" />}
        {v.type === 'sales' && inv && <Select label="Item returned" value={v.product_id ? `${v.product_id}|${v.batch_id}` : ''} onChange={(x) => { const [p, b] = x.split('|'); setV((c) => ({ ...c, product_id: p || '', batch_id: b || '' })); }} options={invoiceProducts.map((l) => ({ value: `${l.product_id}|${l.batch_id}`, label: `${l.name} · batch ${l.batch_no} · invoiced ${l.qty}` }))} blank="Select item" />}
        {(v.type === 'purchase' || !inv) && <><Select label="Product" value={v.product_id} onChange={(x) => setV((c) => ({ ...c, product_id: x, batch_id: '' }))} options={pk.products} blank="Select product" /><Select label="Batch" value={v.batch_id} onChange={set('batch_id')} options={batches.map((b) => ({ value: b.id, label: `${b.batch_no} · exp ${b.expiry_date || '-'}` }))} blank="Select batch" /></>}
        <Select label={v.type === 'sales' ? 'Receive into location' : 'Take from location'} value={v.warehouse_id} onChange={set('warehouse_id')} options={pk.warehouses} blank="Select location" required />
        {v.type === 'purchase' && <Select label="Stock bucket" value={v.from_bucket} onChange={set('from_bucket')} options={[{ value: 'available', label: 'Available' }, { value: 'damaged', label: 'Damaged' }, { value: 'quarantine', label: 'Quarantine' }]} />}
        <Num label="Quantity" value={v.qty} onChange={set('qty')} />
        <Text label="Reason" value={v.reason} onChange={set('reason')} required />
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Record return</button></div>
      </form>
    </Drawer>
  );
}

function InspectDrawer({ ret, onClose, onDone }) {
  const { pushSuccess } = useAlerts();
  const [d, setD] = useState('restock');
  const [credit, setCredit] = useState(true);
  const [err, setErr] = useState('');
  useEffect(() => { setD('restock'); setCredit(Boolean(ret?.invoice_id)); setErr(''); }, [ret]);
  async function save(e) {
    e.preventDefault(); setErr('');
    try { await nxApi.ops.resolveReturn(ret.id, { disposition: d, issue_credit: credit }); pushSuccess('Inspection recorded'); onDone(); onClose(); } catch (x) {
      const msg = novarexError(x, 'Could not record the inspection');
      if (/reason/i.test(msg)) { const reason = window.prompt(`${msg}\n\nReason:`); if (reason) { try { await nxApi.ops.resolveReturn(ret.id, { disposition: d, issue_credit: credit, reason }); onDone(); onClose(); return; } catch (y) { setErr(novarexError(y, msg)); return; } } }
      setErr(msg);
    }
  }
  return (
    <Drawer open={Boolean(ret)} onClose={onClose} size="lg" tone="edit" title={`Inspect ${ret?.return_no || ''}`}>
      <form onSubmit={save} className="space-y-3">
        <p className="text-sm text-tertiary-600">{ret?.qty} x {ret?.product} (batch {ret?.batch_no}) is held in quarantine. Decide what happens to it.</p>
        <Select label="Disposition" value={d} onChange={setD} options={DISPOSITIONS.map(([value, label]) => ({ value, label }))} />
        {ret?.invoice_id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} />Issue a credit note against the original invoice (reduces revenue)</label>}
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Confirm</button></div>
      </form>
    </Drawer>
  );
}

function RecallDrawer({ open, onClose, pk, onSaved }) {
  const { pushSuccess } = useAlerts();
  const [v, setV] = useState({ product_id: '', batch_id: '', reason: '' });
  const [batches, setBatches] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setV({ product_id: '', batch_id: '', reason: '' }); setErr(''); } }, [open]);
  useEffect(() => { if (v.product_id) nxApi.ops.batches({ product_id: v.product_id }).then(setBatches, () => setBatches([])); else setBatches([]); }, [v.product_id]);
  async function save(e) {
    e.preventDefault(); setErr('');
    try { await nxApi.ops.createRecall(v); pushSuccess('Recall opened. The batch can no longer be allocated, dispatched or transferred.'); onSaved(); onClose(); } catch (x) { setErr(novarexError(x, 'Could not open the recall')); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="lg" tone="danger" title="Open a product recall">
      <form onSubmit={save} className="space-y-3">
        <Select label="Product" value={v.product_id} onChange={(x) => setV((c) => ({ ...c, product_id: x, batch_id: '' }))} options={pk.products} blank="Select product" required />
        <Select label="Batch" value={v.batch_id} onChange={(x) => setV((c) => ({ ...c, batch_id: x }))} options={batches.map((b) => ({ value: b.id, label: `${b.batch_no} · exp ${b.expiry_date || '-'}` }))} blank="Select batch" required />
        <Area label="Reason" value={v.reason} onChange={(x) => setV((c) => ({ ...c, reason: x }))} rows={3} required />
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Open recall</button></div>
      </form>
    </Drawer>
  );
}

/** Returns, damaged goods inspection and product recalls (with batch traceability under Stock). */
export default function NovarexReturnsPage() {
  const { me, loading } = useNovarex();
  const pk = useOpsPickers();
  const [tab, setTab] = useState('returns');
  const [drawer, setDrawer] = useState(false);
  const [recallDrawer, setRecallDrawer] = useState(false);
  const [inspect, setInspect] = useState(null);
  const canEdit = nxCan(me, 'stockEdit') || nxCan(me, 'salesEdit');
  const rets = useRows(() => (tab === 'returns' ? nxApi.ops.returns({}) : null), [tab]);
  const rcl = useRows(() => (tab === 'recalls' ? nxApi.ops.recalls() : null), [tab]);
  const act = useAction(() => Promise.all([rets.reload(), rcl.reload()]));
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'stock') && !nxCan(me, 'sales')) return <Navigate to="/novarex" replace />;
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={[{ key: 'returns', label: 'Returns and damaged goods' }, { key: 'recalls', label: 'Product recalls' }]} value={tab} onChange={setTab} />
      {tab === 'returns' && (
        <>
          <div className="flex items-center justify-between gap-2"><p className="text-sm text-tertiary-600">Returned goods go to quarantine first. They become saleable only after inspection.</p>{canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer(true)}><Plus className="h-4 w-4" />New return</button>}</div>
          <DataTable columns={[{ key: 'n', header: 'Return', render: (r) => <span><span className="font-medium text-tertiary-900">{r.return_no}</span><span className="block text-xs text-tertiary-500">{dateLabel(r.return_date)}</span></span> }, { key: 't', header: 'Type', render: (r) => (r.type === 'sales' ? 'From customer' : 'To supplier') }, { key: 'p', header: 'Product', render: (r) => <span>{r.product}<span className="block text-xs text-tertiary-500">Batch {r.batch_no}</span></span> }, { key: 'q', header: 'Qty', render: (r) => r.qty }, { key: 'w', header: 'Location', render: (r) => r.warehouse }, { key: 'r', header: 'Reason', render: (r) => r.reason }, { key: 'd', header: 'Disposition', render: (r) => (r.disposition ? titleOf(r.disposition) : '-') }, { key: 's', header: 'Status', render: (r) => <Pill tone={r.status === 'pending' ? 'amber' : 'green'}>{titleOf(r.status)}</Pill> }, { key: 'a', header: '', render: (r) => canEdit && r.type === 'sales' && r.status === 'pending' && <Btn primary onClick={() => setInspect(r)}>Inspect</Btn> }]} rows={rets.rows || []} loading={!rets.rows} emptyLabel="No returns." />
        </>
      )}
      {tab === 'recalls' && (
        <>
          <div className="flex items-center justify-between gap-2"><p className="text-sm text-tertiary-600">A recalled batch is blocked from sale, dispatch and transfer. Open a batch in Stock to trace who received it.</p>{nxCan(me, 'stockEdit') && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setRecallDrawer(true)}><Plus className="h-4 w-4" />Open recall</button>}</div>
          <DataTable columns={[{ key: 'n', header: 'Recall', render: (r) => <span><span className="font-medium text-tertiary-900">{r.recall_no}</span><span className="block text-xs text-tertiary-500">{dateLabel(r.recall_date)}</span></span> }, { key: 'p', header: 'Product', render: (r) => r.product }, { key: 'b', header: 'Batch', render: (r) => r.batch_no }, { key: 'r', header: 'Reason', render: (r) => r.reason }, { key: 's', header: 'Status', render: (r) => <Pill tone={r.status === 'open' ? 'red' : 'green'}>{titleOf(r.status)}</Pill> }, { key: 'a', header: '', render: (r) => nxCan(me, 'stockEdit') && r.status === 'open' && <Btn onClick={() => act(() => nxApi.ops.closeRecall(r.id, {}), { confirm: 'Close this recall? The batch stays flagged until you release it under Stock > Batches.', done: 'Recall closed' })}>Close</Btn> }]} rows={rcl.rows || []} loading={!rcl.rows} emptyLabel="No recalls." />
        </>
      )}
      <ReturnDrawer open={drawer} onClose={() => setDrawer(false)} pk={pk} onSaved={rets.reload} />
      <InspectDrawer ret={inspect} onClose={() => setInspect(null)} onDone={rets.reload} />
      <RecallDrawer open={recallDrawer} onClose={() => setRecallDrawer(false)} pk={pk} onSaved={rcl.reload} />
    </div>
  );
}
