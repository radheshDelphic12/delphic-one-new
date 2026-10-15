import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { useNovarex, nxCan } from '../../lib/novarex/useNovarex.js';
import { useOpsPickers } from '../../lib/novarex/opsPickers.js';
import { useNxPickers } from '../../lib/novarex/pickers.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { Area, DateInput, Detail, Select, Text, today } from '../../components/novarex/ui.jsx';
import LinesEditor from '../../components/novarex/ops/LinesEditor.jsx';
import MasterPage, { statusPill } from '../../components/novarex/ops/MasterPage.jsx';
import { Btn, Money, inputCls, num, titleOf, useAction, useRows } from '../../components/novarex/ops/common.jsx';

const LINE_BLANK = { product_id: '', qty: '', unit_price: '', discount_pct: '' };
const SO_STATUS = ['draft', 'confirmed', 'partially_fulfilled', 'fulfilled', 'cancelled'];

function OrderDrawer({ open, onClose, pk, onSaved, order }) {
  const { pushSuccess } = useAlerts();
  const [v, setV] = useState(null);
  const [seed, setSeed] = useState(null);
  const [err, setErr] = useState('');
  const key = order?.id || 'new';
  if (open && seed !== key) {
    setSeed(key); setErr('');
    setV({ customer_id: order?.customer_id || '', warehouse_id: order?.warehouse_id || '', order_date: order?.order_date || today(), expected_date: order?.expected_date || '', payment_terms: order?.payment_terms || '', delivery_address: order?.delivery_address || '', logistics_method: order?.logistics_method || '', notes: order?.notes || '', lines: (order?.lines || [LINE_BLANK]).map((l) => ({ product_id: l.product_id || '', qty: l.qty ?? '', unit_price: order ? l.unit_price : '', discount_pct: order ? l.discount_pct : '' })) });
  }
  if (!open && seed) setSeed(null);
  if (!v) return null;
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      const body = { customer_id: v.customer_id, warehouse_id: v.warehouse_id, order_date: v.order_date || undefined, expected_date: v.expected_date || null, payment_terms: v.payment_terms || null, delivery_address: v.delivery_address || null, logistics_method: v.logistics_method || null, notes: v.notes || null, lines: v.lines.map((l) => ({ product_id: l.product_id, qty: num(l.qty), ...(l.unit_price === '' ? {} : { unit_price: num(l.unit_price) }), ...(l.discount_pct === '' ? {} : { discount_pct: num(l.discount_pct) }) })) };
      if (order) await nxApi.ops.updateOrder(order.id, body); else await nxApi.ops.createOrder(body);
      pushSuccess(order ? 'Order updated' : 'Order created as a draft'); onSaved(); onClose();
    } catch (x) { setErr(novarexError(x, 'Could not save the order')); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="xl" tone={order ? 'edit' : 'create'} title={order ? `Edit ${order.so_no}` : 'New sales order'}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Customer / outlet" value={v.customer_id} onChange={set('customer_id')} options={pk.customers} blank="Select customer" required />
          <Select label="Fulfil from" value={v.warehouse_id} onChange={set('warehouse_id')} options={pk.warehouses} blank="Select warehouse" required />
          <DateInput label="Order date" value={v.order_date} onChange={set('order_date')} />
          <DateInput label="Expected delivery" value={v.expected_date} onChange={set('expected_date')} />
          <Text label="Payment terms" value={v.payment_terms} onChange={set('payment_terms')} placeholder="From the customer's credit days" />
          <Select label="Transport" value={v.logistics_method} onChange={set('logistics_method')} options={[{ value: 'own_vehicle', label: 'Company vehicle' }, { value: 'partner', label: 'Logistics partner' }]} blank="Decide at dispatch" />
          <Text label="Delivery address" className="sm:col-span-2" value={v.delivery_address} onChange={set('delivery_address')} placeholder="From the customer record" />
        </div>
        <p className="text-xs text-tertiary-500">Leave the price blank to use the product&apos;s selling price (less the franchise agreement discount, if the customer is a franchise outlet). A customer that is a company-owned outlet is supplied with a stock transfer, not a sale.</p>
        <LinesEditor value={v.lines} onChange={set('lines')} blank={LINE_BLANK} addLabel="Add product"
          fields={[{ key: 'product_id', label: 'Product', type: 'select', options: pk.products }, { key: 'qty', label: 'Quantity', type: 'num', width: '6rem' }, { key: 'unit_price', label: 'Unit price', type: 'num', width: '7rem' }, { key: 'discount_pct', label: 'Discount %', type: 'num', width: '6rem' }]} />
        <Area label="Notes" value={v.notes} onChange={set('notes')} rows={2} />
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Save order</button></div>
      </form>
    </Drawer>
  );
}

function OrderDetail({ id, onClose, onChanged, canShip, canBill }) {
  const [o, setO] = useState(null);
  const [seed, setSeed] = useState(null);
  if (id && seed !== id) { setSeed(id); setO(null); nxApi.ops.order(id).then(setO, () => setO(false)); }
  if (!id && seed) setSeed(null);
  const refresh = () => nxApi.ops.order(id).then(setO).then(onChanged);
  const act = useAction(refresh);
  return (
    <Drawer open={Boolean(id)} onClose={onClose} size="xl" tone="info" title={o ? o.so_no : 'Order'}>
      {o === null && <p className="text-sm text-tertiary-500">Loading...</p>}
      {o === false && <p className="text-sm text-danger-700">Could not load the order.</p>}
      {o && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <Pill value={o.status} /> <Pill tone="blue">Fulfilment: {titleOf(o.fulfilment)}</Pill> <Pill tone="purple">Invoice: {titleOf(o.invoice_status)}</Pill> <Pill tone={o.payment_status === 'paid' ? 'green' : 'amber'}>Payment: {titleOf(o.payment_status)}</Pill>
          </div>
          <div className="grid gap-2 sm:grid-cols-2"><Detail label="Customer">{o.customer}</Detail><Detail label="Warehouse">{o.warehouse}</Detail><Detail label="Order date">{dateLabel(o.order_date)}</Detail><Detail label="Expected">{o.expected_date ? dateLabel(o.expected_date) : '-'}</Detail><Detail label="Total incl. GST"><Money v={o.total} /></Detail><Detail label="Payment terms">{o.payment_terms}</Detail></div>
          <DataTable embedded columns={[{ key: 'p', header: 'Product', render: (l) => `${l.sku} ${l.name}` }, { key: 'q', header: 'Qty', render: (l) => l.qty }, { key: 'u', header: 'Price', render: (l) => <Money v={l.unit_price} /> }, { key: 'al', header: 'Reserved', render: (l) => (l.allocations || []).map((a) => `${a.batch_no} x${a.qty}`).join(', ') || '-' }, { key: 'bo', header: 'Backorder', render: (l) => (Number(l.backorder_qty) > 0 ? <Pill tone="amber">{l.backorder_qty}</Pill> : '-') }, { key: 'sh', header: 'Shipped', render: (l) => l.shipped_qty || 0 }, { key: 'dl', header: 'Delivered', render: (l) => l.delivered_qty || 0 }]} rows={o.lines.map((l, i) => ({ ...l, id: i }))} />
          {o.shipments.length > 0 && <p>Shipments: {o.shipments.map((s) => `${s.shipment_no} (${titleOf(s.status)})`).join(', ')}</p>}
          {o.invoices.length > 0 && <p>Invoices: {o.invoices.map((s) => `${s.invoice_no} (${titleOf(s.status)})`).join(', ')}</p>}
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {o.status === 'draft' && canShip && <Btn primary onClick={() => act(() => nxApi.ops.actOrder(o.id, 'confirm', {}), { done: 'Confirmed: stock reserved earliest-expiry first' })}>Confirm and reserve stock</Btn>}
            {['confirmed', 'partially_fulfilled'].includes(o.status) && canShip && o.lines.some((l) => Number(l.backorder_qty) > 0) && <Btn onClick={() => act(() => nxApi.ops.actOrder(o.id, 'allocate', {}), { done: 'Allocation re-run' })}>Allocate backorder</Btn>}
            {['confirmed', 'partially_fulfilled'].includes(o.status) && canShip && <Btn primary onClick={() => act(() => nxApi.ops.createShipment({ sales_order_id: o.id }), { done: 'Shipment created from the reserved stock (see Shipments)' })}>Create shipment</Btn>}
            {['draft', 'confirmed'].includes(o.status) && canShip && <Btn danger onClick={() => act(() => nxApi.ops.actOrder(o.id, 'cancel', { reason: 'Cancelled on the order screen' }), { confirm: `Cancel ${o.so_no}? Reserved stock is released.`, done: 'Cancelled' })}>Cancel order</Btn>}
          </div>
          {canBill && o.shipments.some((s) => ['delivered', 'partially_delivered'].includes(s.status)) && <p className="text-xs text-tertiary-500">Invoice delivered shipments from the Shipments screen.</p>}
        </div>
      )}
    </Drawer>
  );
}

/** Customers and sales orders. Order, fulfilment, invoice and payment status are shown separately. */
export default function NovarexSalesPage() {
  const { me, loading } = useNovarex();
  const pk = useOpsPickers();
  const nxp = useNxPickers({ people: false });
  const [tab, setTab] = useState('orders');
  const [f, setF] = useState({ q: '', status: '', customer_id: '', warehouse_id: '', from: '', to: '', invoice_status: '', payment_status: '' });
  const [drawer, setDrawer] = useState({ open: false, order: null });
  const [detail, setDetail] = useState(null);
  const canEdit = nxCan(me, 'salesEdit');
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const orders = useRows(() => (tab === 'orders' ? nxApi.ops.orders(f) : null), [tab, f]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'sales')) return <Navigate to="/novarex" replace />;
  const cols = [
    { key: 'n', header: 'Order', render: (r) => <span><span className="font-medium text-tertiary-900">{r.so_no}</span><span className="block text-xs text-tertiary-500">{dateLabel(r.order_date)}</span></span> },
    { key: 'c', header: 'Customer', render: (r) => <span>{r.customer}{r.outlet && <span className="block text-xs text-tertiary-500">{r.outlet}</span>}</span> },
    { key: 'w', header: 'From', render: (r) => r.warehouse },
    { key: 'e', header: 'Expected', render: (r) => (r.expected_date ? dateLabel(r.expected_date) : '-') },
    { key: 't', header: 'Total', render: (r) => <Money v={r.total} /> },
    { key: 's', header: 'Order', render: (r) => <Pill value={r.status} tone={r.status === 'cancelled' ? 'red' : r.status === 'fulfilled' ? 'green' : 'blue'} /> },
    { key: 'f', header: 'Fulfilment', render: (r) => titleOf(r.fulfilment) },
    { key: 'i', header: 'Invoice', render: (r) => titleOf(r.invoice_status) },
    { key: 'p', header: 'Payment', render: (r) => <Pill tone={r.payment_status === 'paid' ? 'green' : r.payment_status === 'partial' ? 'amber' : 'gray'}>{titleOf(r.payment_status)}</Pill> },
  ];
  const custCols = [
    { key: 'n', header: 'Customer', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}{r.gstin ? ` · ${r.gstin}` : ''}</span></span> },
    { key: 'k', header: 'Kind', render: (r) => titleOf(r.kind) }, { key: 'c', header: 'Contact', render: (r) => [r.contact_name, r.phone].filter(Boolean).join(' · ') || '-' }, { key: 'cr', header: 'Credit', render: (r) => `${r.credit_days} days` }, { key: 's', header: 'Status', render: statusPill },
  ];
  const custFields = [
    { key: 'name', label: 'Customer name', required: true, span: 2 }, { key: 'code', label: 'Code', placeholder: 'Leave blank to generate' },
    { key: 'kind', label: 'Kind', type: 'select', required: true, default: 'external', options: [{ value: 'external', label: 'External customer' }, { value: 'distributor', label: 'Distributor' }, { value: 'outlet', label: 'Outlet' }] },
    { key: 'outlet_id', label: 'Linked outlet', type: 'select', options: nxp.outlets }, { key: 'contact_name', label: 'Contact person' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
    { key: 'gstin', label: 'GSTIN' }, { key: 'state', label: 'State (for GST)' }, { key: 'credit_days', label: 'Credit days', type: 'num' }, { key: 'status', label: 'Status', type: 'select', required: true, default: 'active', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] }, { key: 'address', label: 'Delivery / billing address', type: 'area' },
  ];
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={[{ key: 'orders', label: 'Sales orders' }, { key: 'customers', label: 'Customers and outlets' }]} value={tab} onChange={setTab} />
      {tab === 'orders' && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <input className={`${inputCls} min-w-[12rem]`} placeholder="Search order number" value={f.q} onChange={set('q')} aria-label="Search" />
            <select className={inputCls} value={f.status} onChange={set('status')} aria-label="Order status"><option value="">All order statuses</option>{SO_STATUS.map((s) => <option key={s} value={s}>{titleOf(s)}</option>)}</select>
            <select className={inputCls} value={f.invoice_status} onChange={set('invoice_status')} aria-label="Invoice status"><option value="">Any invoice status</option><option value="none">Not invoiced</option><option value="partial">Partly invoiced</option><option value="invoiced">Invoiced</option></select>
            <select className={inputCls} value={f.payment_status} onChange={set('payment_status')} aria-label="Payment status"><option value="">Any payment status</option><option value="unpaid">Unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option></select>
            <select className={inputCls} value={f.customer_id} onChange={set('customer_id')} aria-label="Customer"><option value="">All customers</option>{pk.customers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <select className={inputCls} value={f.warehouse_id} onChange={set('warehouse_id')} aria-label="Warehouse"><option value="">All warehouses</option>{pk.warehouses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <input type="date" className={inputCls} value={f.from} onChange={set('from')} aria-label="From date" /><input type="date" className={inputCls} value={f.to} onChange={set('to')} aria-label="To date" />
            {canEdit && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => setDrawer({ open: true, order: null })}><Plus className="h-4 w-4" />New order</button>}
          </div>
          <DataTable columns={cols} rows={orders.rows || []} loading={!orders.rows} emptyLabel="No sales orders match these filters." onRowClick={(r) => setDetail(r.id)} />
        </>
      )}
      {tab === 'customers' && <MasterPage resource="customers" singular="Customer" columns={custCols} fields={custFields} canEdit={nxCan(me, 'salesEdit')} statusOptions={['active', 'inactive']} onChanged={pk.refresh} searchHint="Search name, code, GSTIN..." />}
      <OrderDrawer open={drawer.open} order={drawer.order} pk={pk} onClose={() => setDrawer({ open: false, order: null })} onSaved={orders.reload} />
      <OrderDetail id={detail} onClose={() => setDetail(null)} onChanged={orders.reload} canShip={canEdit} canBill={nxCan(me, 'billingEdit')} />
    </div>
  );
}
