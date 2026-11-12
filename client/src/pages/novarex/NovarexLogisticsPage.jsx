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
import { DateInput, Detail, Num, Select, Text, Area, today } from '../../components/novarex/ui.jsx';
import LinesEditor from '../../components/novarex/ops/LinesEditor.jsx';
import MasterPage, { statusPill } from '../../components/novarex/ops/MasterPage.jsx';
import { Btn, Money, inputCls, num, titleOf, useAction, useRows } from '../../components/novarex/ops/common.jsx';

const STATUS_TONE = { delivered: 'green', partially_delivered: 'amber', delivery_failed: 'red', returned: 'red', cancelled: 'red', dispatched: 'blue', in_transit: 'blue', out_for_delivery: 'blue' };
const NEXT = { pending_dispatch: ['ready_for_dispatch', 'dispatched'], ready_for_dispatch: ['dispatched'], dispatched: ['in_transit', 'out_for_delivery'], in_transit: ['out_for_delivery'], out_for_delivery: [] };
const ALL_STATUS = ['pending_dispatch', 'ready_for_dispatch', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered', 'partially_delivered', 'delivery_failed', 'returned', 'cancelled'];

function ShipmentDetail({ id, onClose, onChanged, canEdit, canBill, canTransport, pk }) {
  const { pushSuccess } = useAlerts();
  const [s, setS] = useState(null);
  const [deliver, setDeliver] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const load = () => (id ? nxApi.ops.shipment(id).then(setS, () => setS(false)) : null);
  useEffect(() => { setS(null); setDeliver(null); setEdit(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async () => { await load(); onChanged(); };
  const act = useAction(refresh);
  if (!id) return <Drawer open={false} onClose={onClose} title="" />;
  async function submitDeliver(e) {
    e.preventDefault(); setErr('');
    try {
      await nxApi.ops.shipmentStatus(id, { status: 'delivered', pod_note: deliver.pod_note || null, actual_freight: deliver.actual_freight === '' ? undefined : num(deliver.actual_freight), lines: deliver.lines.map((l) => ({ product_id: l.product_id, batch_id: l.batch_id, delivered_qty: num(l.delivered_qty), damaged_qty: num(l.damaged_qty), missing_qty: num(l.missing_qty) })) });
      pushSuccess('Delivery confirmed'); setDeliver(null); refresh();
    } catch (x) { setErr(novarexError(x, 'Could not confirm delivery')); }
  }
  async function submitEdit(e) {
    e.preventDefault(); setErr('');
    try {
      await nxApi.ops.updateShipment(id, { vehicle_id: edit.vehicle_id || null, partner_id: edit.partner_id || null, rate_card_id: edit.rate_card_id || null, method: edit.method, driver_name: edit.driver_name || null, tracking_ref: edit.tracking_ref || null, expected_at: edit.expected_at || null, distance_km: edit.distance_km === '' ? undefined : num(edit.distance_km), weight_kg: edit.weight_kg === '' ? undefined : num(edit.weight_kg), actual_freight: edit.actual_freight === '' ? null : num(edit.actual_freight), freight_status: edit.freight_status });
      pushSuccess('Shipment updated'); setEdit(null); refresh();
    } catch (x) { setErr(novarexError(x, 'Could not update')); }
  }
  const openEdit = () => setEdit({ method: s.method, vehicle_id: s.vehicle_id || '', partner_id: s.partner_id || '', rate_card_id: s.rate_card_id || '', driver_name: s.driver_name || '', tracking_ref: s.tracking_ref || '', expected_at: s.expected_at || '', distance_km: s.distance_km ?? '', weight_kg: s.weight_kg ?? '', actual_freight: s.actual_freight ?? '', freight_status: s.freight_status });
  const setE = (k) => (val) => setEdit((c) => ({ ...c, [k]: val }));
  return (
    <Drawer open onClose={onClose} size="xl" tone="info" title={s ? s.shipment_no : 'Shipment'}>
      {s === null && <p className="text-sm text-tertiary-500">Loading...</p>}
      {s === false && <p className="text-sm text-danger-700">Could not load the shipment.</p>}
      {s && !deliver && !edit && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-1.5"><Pill tone={STATUS_TONE[s.status] || 'gray'}>{titleOf(s.status)}</Pill><Pill tone="gray">{s.method === 'partner' ? 'Logistics partner' : 'Company vehicle'}</Pill>{s.invoice && <Pill tone="purple">Invoice {s.invoice.invoice_no}</Pill>}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Detail label="Order">{s.so_no || (s.transfer_id ? 'Stock transfer' : '-')}</Detail><Detail label="From">{s.from}</Detail><Detail label="Customer">{s.customer}</Detail><Detail label="Outlet">{s.outlet}</Detail>
            <Detail label="Vehicle">{s.vehicle}</Detail><Detail label="Partner">{s.partner}</Detail><Detail label="Driver">{s.driver_name}</Detail><Detail label="Tracking reference">{s.tracking_ref}</Detail>
            <Detail label="Expected">{s.expected_at ? dateLabel(s.expected_at) : null}</Detail><Detail label="Delivered">{s.delivered_at ? dateLabel(s.delivered_at) : null}</Detail>
            <Detail label="Estimated freight"><Money v={s.estimated_freight} /></Detail><Detail label="Actual freight">{s.actual_freight === null ? null : <Money v={s.actual_freight} />}</Detail>
            <Detail label="Freight variance">{s.freight_variance === null ? null : <Money v={s.freight_variance} signed />}</Detail><Detail label="Freight payment">{titleOf(s.freight_status)}</Detail>
            <Detail label="Damaged / missing">{s.damaged_qty || s.missing_qty ? `${s.damaged_qty} damaged, ${s.missing_qty} missing` : null}</Detail><Detail label="Proof of delivery">{s.pod_note}</Detail>
          </div>
          <DataTable embedded columns={[{ key: 'p', header: 'Product', render: (l) => `${l.sku || ''} ${l.product || ''}` }, { key: 'b', header: 'Batch', render: (l) => l.batch_no }, { key: 'x', header: 'Expiry', render: (l) => (l.expiry_date ? dateLabel(l.expiry_date) : '-') }, { key: 'q', header: 'Packed', render: (l) => l.qty }, { key: 'd', header: 'Delivered', render: (l) => l.delivered_qty || 0 }, { key: 'm', header: 'Damaged / missing', render: (l) => `${l.damaged_qty || 0} / ${l.missing_qty || 0}` }]} rows={s.lines.map((l, i) => ({ ...l, id: i }))} />
          {s.profitability && <p className="rounded-xl bg-tertiary-50 px-3 py-2">Shipment profit: revenue <Money v={s.profitability.revenue} /> - cost of goods <Money v={s.profitability.cogs} /> - freight and trip cost <Money v={s.profitability.freight_cost} /> = <b><Money v={s.profitability.profit} signed /></b></p>}
          {s.method === 'own_vehicle' && s.trip_cost > 0 && <p className="text-xs text-tertiary-500">Trip cost recorded for this shipment: <Money v={s.trip_cost} />. Company-vehicle freight is the cost of its trips; no separate freight entry is made.</p>}
          {canEdit && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {(NEXT[s.status] || []).map((n) => <Btn key={n} primary={n === 'dispatched'} onClick={() => act(() => nxApi.ops.shipmentStatus(s.id, { status: n }), { done: `Marked ${titleOf(n)}`, confirm: n === 'dispatched' ? 'Dispatch? The reserved stock leaves the warehouse now.' : undefined })}>{n === 'dispatched' ? 'Dispatch' : titleOf(n)}</Btn>)}
              {['dispatched', 'in_transit', 'out_for_delivery'].includes(s.status) && <Btn primary onClick={() => setDeliver({ pod_note: '', actual_freight: s.actual_freight ?? '', lines: s.lines.map((l) => ({ ...l, delivered_qty: l.qty, damaged_qty: 0, missing_qty: 0 })) })}>Confirm delivery</Btn>}
              {['dispatched', 'in_transit', 'out_for_delivery'].includes(s.status) && <Btn danger onClick={() => act(() => nxApi.ops.shipmentStatus(s.id, { status: 'delivery_failed', pod_note: 'Delivery failed' }), { done: 'Marked failed' })}>Delivery failed</Btn>}
              {['delivery_failed', 'dispatched', 'in_transit', 'out_for_delivery'].includes(s.status) && <Btn danger onClick={() => act(() => nxApi.ops.shipmentStatus(s.id, { status: 'returned' }), { confirm: 'Mark returned? The goods go back to quarantine for inspection.', done: 'Returned' })}>Goods returned</Btn>}
              {['pending_dispatch', 'ready_for_dispatch'].includes(s.status) && <Btn danger onClick={() => act(() => nxApi.ops.shipmentStatus(s.id, { status: 'cancelled' }), { confirm: 'Cancel this shipment? The stock stays reserved for the order.', done: 'Cancelled' })}>Cancel</Btn>}
              {canTransport && <Btn onClick={openEdit}>Edit transport and freight</Btn>}
              {canBill && s.sales_order_id && !s.invoice && ['delivered', 'partially_delivered'].includes(s.status) && <Btn primary onClick={() => act(() => nxApi.ops.invoiceShipment(s.id, {}), { done: 'Invoice created' })}>Create invoice</Btn>}
            </div>
          )}
        </div>
      )}
      {deliver && (
        <form onSubmit={submitDeliver} className="space-y-3">
          <p className="text-xs text-tertiary-500">Enter what the customer accepted. Damaged goods come back to damaged stock, missing goods are written off to the lost bucket, and anything not delivered goes to quarantine for inspection. The invoice is for accepted goods only.</p>
          <LinesEditor value={deliver.lines} onChange={(lines) => setDeliver((c) => ({ ...c, lines }))} addLabel="" fields={[{ key: 'product', label: 'Product', type: 'text' }, { key: 'batch_no', label: 'Batch', type: 'text' }, { key: 'qty', label: 'Packed', type: 'num', width: '5rem' }, { key: 'delivered_qty', label: 'Accepted', type: 'num', width: '5.5rem' }, { key: 'damaged_qty', label: 'Damaged', type: 'num', width: '5.5rem' }, { key: 'missing_qty', label: 'Missing', type: 'num', width: '5.5rem' }]} />
          <Num label="Actual freight (optional)" value={deliver.actual_freight} onChange={(val) => setDeliver((c) => ({ ...c, actual_freight: val }))} />
          <Area label="Proof of delivery / receipt notes" value={deliver.pod_note} onChange={(val) => setDeliver((c) => ({ ...c, pod_note: val }))} rows={2} />
          {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setDeliver(null)}>Back</button><button type="submit" className="btn-primary">Confirm delivery</button></div>
        </form>
      )}
      {edit && (
        <form onSubmit={submitEdit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Transport" value={edit.method} onChange={setE('method')} options={[{ value: 'own_vehicle', label: 'Company vehicle' }, { value: 'partner', label: 'Logistics partner' }]} />
            {edit.method === 'own_vehicle' ? <Select label="Vehicle" value={edit.vehicle_id} onChange={setE('vehicle_id')} options={pk.vehicles} blank="Not assigned" /> : <Select label="Logistics partner" value={edit.partner_id} onChange={setE('partner_id')} options={pk.partners} blank="Not assigned" />}
            {edit.method === 'partner' && <Select label="Rate card" value={edit.rate_card_id} onChange={setE('rate_card_id')} options={pk.rateCards.filter((r) => !edit.partner_id || r.partner_id === edit.partner_id)} blank="No rate card" />}
            <Text label="Driver / contact" value={edit.driver_name} onChange={setE('driver_name')} /><Text label="Tracking reference or URL" value={edit.tracking_ref} onChange={setE('tracking_ref')} /><DateInput label="Expected delivery" value={edit.expected_at} onChange={setE('expected_at')} />
            <Num label="Distance (km)" value={edit.distance_km} onChange={setE('distance_km')} /><Num label="Weight (kg)" value={edit.weight_kg} onChange={setE('weight_kg')} />
            {edit.method === 'partner' && <><Num label="Actual freight" value={edit.actual_freight} onChange={setE('actual_freight')} hint="One expense entry follows this amount: it is never duplicated" /><Select label="Freight payment" value={edit.freight_status} onChange={setE('freight_status')} options={[{ value: 'unpaid', label: 'Unpaid (payable)' }, { value: 'paid', label: 'Paid' }]} /></>}
          </div>
          {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Back</button><button type="submit" className="btn-primary">Save</button></div>
        </form>
      )}
    </Drawer>
  );
}

function TripDrawer({ trip, onClose, pk, onSaved }) {
  const { pushSuccess } = useAlerts();
  const [v, setV] = useState({});
  const [err, setErr] = useState('');
  useEffect(() => { if (trip) { setErr(''); setV({ vehicle_id: trip.vehicle_id || '', shipment_id: trip.shipment_id || '', trip_date: trip.trip_date || today(), distance_km: trip.distance_km ?? '', fuel_cost: trip.fuel_cost ?? '', toll_cost: trip.toll_cost ?? '', maintenance_cost: trip.maintenance_cost ?? '', other_cost: trip.other_cost ?? '', notes: trip.notes || '' }); } }, [trip]);
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      const n = (x) => (x === '' ? 0 : num(x));
      await nxApi.ops.saveTrip(trip.id, { vehicle_id: v.vehicle_id, shipment_id: v.shipment_id || null, trip_date: v.trip_date, distance_km: v.distance_km === '' ? undefined : num(v.distance_km), fuel_cost: n(v.fuel_cost), toll_cost: n(v.toll_cost), maintenance_cost: n(v.maintenance_cost), other_cost: n(v.other_cost), notes: v.notes || null });
      pushSuccess('Trip saved'); onSaved(); onClose();
    } catch (x) { setErr(novarexError(x, 'Could not save the trip')); }
  }
  return (
    <Drawer open={Boolean(trip)} onClose={onClose} size="lg" tone={trip?.id ? 'edit' : 'create'} title={trip?.id ? 'Edit trip' : 'New vehicle trip'}>
      <form onSubmit={save} className="space-y-3">
        <Select label="Vehicle" value={v.vehicle_id} onChange={set('vehicle_id')} options={pk.vehicles} blank="Select vehicle" required />
        <DateInput label="Trip date" value={v.trip_date} onChange={set('trip_date')} />
        <Num label="Distance (km)" value={v.distance_km} onChange={set('distance_km')} />
        <div className="grid grid-cols-2 gap-3"><Num label="Fuel" value={v.fuel_cost} onChange={set('fuel_cost')} /><Num label="Tolls" value={v.toll_cost} onChange={set('toll_cost')} /><Num label="Maintenance" value={v.maintenance_cost} onChange={set('maintenance_cost')} /><Num label="Other" value={v.other_cost} onChange={set('other_cost')} /></div>
        <Area label="Notes" value={v.notes} onChange={set('notes')} rows={2} />
        <p className="text-xs text-tertiary-500">The total becomes one vehicle-cost expense entry; editing the trip updates that entry instead of adding another.</p>
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Save trip</button></div>
      </form>
    </Drawer>
  );
}

/** Shipments, transport and freight: logistics partners and rate cards, company vehicles and their trips. */
export default function NovarexLogisticsPage() {
  const { me, loading } = useNovarex();
  const pk = useOpsPickers();
  const [tab, setTab] = useState('shipments');
  const [f, setF] = useState({ q: '', status: '', method: '', partner_id: '', warehouse_id: '', freight_status: '', from: '', to: '' });
  const [detail, setDetail] = useState(null);
  const [trip, setTrip] = useState(null);
  const canEdit = nxCan(me, 'logisticsEdit') || nxCan(me, 'stockEdit') || nxCan(me, 'salesEdit');
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const ships = useRows(() => (tab === 'shipments' ? nxApi.ops.shipments(f) : null), [tab, f]);
  const trips = useRows(() => (tab === 'trips' ? nxApi.ops.trips({}) : null), [tab]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'logistics') && !nxCan(me, 'sales')) return <Navigate to="/novarex" replace />;
  const mgr = nxCan(me, 'logisticsEdit');
  const shipCols = [
    { key: 'n', header: 'Shipment', render: (r) => <span><span className="font-medium text-tertiary-900">{r.shipment_no}</span><span className="block text-xs text-tertiary-500">{r.so_no || (r.transfer_id ? 'Transfer' : '')}</span></span> },
    { key: 'c', header: 'To', render: (r) => r.customer || r.outlet || '-' }, { key: 'f', header: 'From', render: (r) => r.from },
    { key: 'm', header: 'Transport', render: (r) => (r.method === 'partner' ? r.partner || 'Partner (unassigned)' : r.vehicle || 'Company vehicle') },
    { key: 'e', header: 'Expected', render: (r) => (r.expected_at ? dateLabel(r.expected_at) : '-') },
    { key: 'fe', header: 'Freight est. / actual', render: (r) => <span><Money v={r.estimated_freight} /> / {r.actual_freight === null ? '-' : <Money v={r.actual_freight} />}</span> },
    { key: 'v', header: 'Variance', render: (r) => (r.freight_variance === null ? '-' : <Money v={r.freight_variance} signed />) },
    { key: 's', header: 'Status', render: (r) => <Pill tone={STATUS_TONE[r.status] || 'gray'}>{titleOf(r.status)}</Pill> },
  ];
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={[{ key: 'shipments', label: 'Shipments' }, ...(mgr ? [{ key: 'trips', label: 'Vehicle trips' }, { key: 'partners', label: 'Logistics partners' }, { key: 'cards', label: 'Rate cards' }, { key: 'vehicles', label: 'Company vehicles' }] : [])]} value={tab} onChange={setTab} />
      {tab === 'shipments' && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <input className={`${inputCls} min-w-[12rem]`} placeholder="Search shipment number" value={f.q} onChange={set('q')} aria-label="Search" />
            <select className={inputCls} value={f.status} onChange={set('status')} aria-label="Status"><option value="">All statuses</option>{ALL_STATUS.map((s) => <option key={s} value={s}>{titleOf(s)}</option>)}</select>
            <select className={inputCls} value={f.method} onChange={set('method')} aria-label="Transport"><option value="">Any transport</option><option value="own_vehicle">Company vehicle</option><option value="partner">Logistics partner</option></select>
            <select className={inputCls} value={f.partner_id} onChange={set('partner_id')} aria-label="Partner"><option value="">All partners</option>{pk.partners.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <select className={inputCls} value={f.warehouse_id} onChange={set('warehouse_id')} aria-label="Warehouse"><option value="">All warehouses</option>{pk.warehouses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <select className={inputCls} value={f.freight_status} onChange={set('freight_status')} aria-label="Freight payment"><option value="">Any freight payment</option><option value="unpaid">Freight unpaid</option><option value="paid">Freight paid</option></select>
            <input type="date" className={inputCls} value={f.from} onChange={set('from')} aria-label="From" /><input type="date" className={inputCls} value={f.to} onChange={set('to')} aria-label="To" />
          </div>
          <DataTable columns={shipCols} rows={ships.rows || []} loading={!ships.rows} emptyLabel="No shipments. Create one from a confirmed sales order." onRowClick={(r) => setDetail(r.id)} />
        </>
      )}
      {tab === 'trips' && (
        <>
          <div className="flex justify-end">{mgr && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setTrip({})}><Plus className="h-4 w-4" />New trip</button>}</div>
          <DataTable columns={[{ key: 'd', header: 'Date', render: (r) => dateLabel(r.trip_date) }, { key: 'v', header: 'Vehicle', render: (r) => r.vehicle }, { key: 's', header: 'Shipment', render: (r) => r.shipment_no || '-' }, { key: 'k', header: 'km', render: (r) => r.distance_km ?? '-' }, { key: 'f', header: 'Fuel', render: (r) => <Money v={r.fuel_cost} /> }, { key: 't', header: 'Tolls', render: (r) => <Money v={r.toll_cost} /> }, { key: 'm', header: 'Maintenance', render: (r) => <Money v={r.maintenance_cost} /> }, { key: 'o', header: 'Other', render: (r) => <Money v={r.other_cost} /> }, { key: 'x', header: 'Total', render: (r) => <Money v={r.total_cost} /> }]} rows={trips.rows || []} loading={!trips.rows} emptyLabel="No trips." onRowClick={mgr ? (r) => setTrip(r) : undefined} />
        </>
      )}
      {tab === 'partners' && <MasterPage resource="logistics-partners" singular="Partner" canEdit={mgr} statusOptions={['active', 'inactive']} onChanged={pk.refresh} searchHint="Search name, code, GSTIN..."
        columns={[{ key: 'n', header: 'Partner', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}{r.gstin ? ` · ${r.gstin}` : ''}</span></span> }, { key: 'r', header: 'Service regions', render: (r) => (r.regions || []).join(', ') || '-' }, { key: 'p', header: 'Pricing', render: (r) => titleOf(r.pricing_model) }, { key: 'c', header: 'Contact', render: (r) => [r.contact_name, r.phone].filter(Boolean).join(' · ') || '-' }, { key: 's', header: 'Status', render: statusPill }]}
        fields={[{ key: 'name', label: 'Partner name', required: true, span: 2 }, { key: 'code', label: 'Code', placeholder: 'Leave blank to generate' }, { key: 'contact_name', label: 'Contact person' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'gstin', label: 'GSTIN' }, { key: 'regions', label: 'Service regions', type: 'tags', placeholder: 'Comma separated' }, { key: 'pricing_model', label: 'Usual pricing model', type: 'select', default: 'fixed', options: [{ value: 'fixed', label: 'Fixed per shipment' }, { value: 'per_km', label: 'Per kilometre' }, { value: 'per_unit', label: 'Per unit / package' }, { value: 'per_weight', label: 'Per kg' }, { value: 'zone', label: 'Zone-based' }] }, { key: 'payment_terms', label: 'Payment terms' }, { key: 'status', label: 'Status', type: 'select', required: true, default: 'active', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] }, { key: 'notes', label: 'Contract notes', type: 'area' }]} />}
      {tab === 'cards' && <MasterPage resource="rate-cards" singular="Rate card" canEdit={mgr} onChanged={pk.refresh} searchHint="Search rate cards..." extraFilters={[{ key: 'partner_id', label: 'All partners', options: pk.partners }]}
        intro="Each partner can have several rate cards with their own formula: fixed charge, per km, per unit, per kg or a zone price, plus handling and cold-chain charges."
        columns={[{ key: 'n', header: 'Rate card', render: (r) => <span className="font-medium text-tertiary-900">{r.name}</span> }, { key: 'p', header: 'Partner', render: (r) => pk.partners.find((p) => p.value === r.partner_id)?.label || '-' }, { key: 'm', header: 'Model', render: (r) => titleOf(r.model) }, { key: 'b', header: 'Base', render: (r) => <Money v={r.base_amount} /> }, { key: 'r', header: 'Rate', render: (r) => <Money v={r.rate} /> }, { key: 'h', header: 'Handling / cold chain', render: (r) => <span><Money v={r.handling_charge} /> / <Money v={r.cold_chain_charge} /></span> }, { key: 'a', header: 'Active', render: (r) => (r.active ? 'Yes' : 'No') }]}
        fields={[{ key: 'partner_id', label: 'Partner', type: 'select', required: true, options: pk.partners }, { key: 'name', label: 'Rate card name', required: true }, { key: 'model', label: 'Pricing model', type: 'select', required: true, default: 'fixed', options: [{ value: 'fixed', label: 'Fixed per shipment (base)' }, { value: 'per_km', label: 'Base + rate per km' }, { value: 'per_unit', label: 'Base + rate per unit' }, { value: 'per_weight', label: 'Base + rate per kg' }, { value: 'zone', label: 'Zone price (base)' }] }, { key: 'zone', label: 'Zone / region' }, { key: 'base_amount', label: 'Base amount', type: 'num' }, { key: 'rate', label: 'Rate', type: 'num' }, { key: 'handling_charge', label: 'Handling charge', type: 'num' }, { key: 'cold_chain_charge', label: 'Cold-chain charge', type: 'num' }, { key: 'active', label: 'Active', type: 'bool', default: true }, { key: 'notes', label: 'Notes', type: 'area' }]} />}
      {tab === 'vehicles' && <MasterPage resource="vehicles" singular="Vehicle" canEdit={mgr} statusOptions={['available', 'on_trip', 'maintenance', 'inactive']} onChanged={pk.refresh} searchHint="Search registration, type, driver..."
        columns={[{ key: 'r', header: 'Vehicle', render: (r) => <span><span className="font-medium text-tertiary-900">{r.reg_no}</span><span className="block text-xs text-tertiary-500">{[r.vehicle_type, r.capacity].filter(Boolean).join(' · ')}</span></span> }, { key: 'd', header: 'Driver', render: (r) => r.driver_name || '-' }, { key: 'i', header: 'Insurance to', render: (r) => (r.insurance_expiry ? dateLabel(r.insurance_expiry) : '-') }, { key: 'p', header: 'Permit to', render: (r) => (r.permit_expiry ? dateLabel(r.permit_expiry) : '-') }, { key: 's', header: 'Status', render: statusPill }]}
        fields={[{ key: 'reg_no', label: 'Registration number', required: true }, { key: 'vehicle_type', label: 'Vehicle type' }, { key: 'capacity', label: 'Capacity' }, { key: 'driver_name', label: 'Assigned driver' }, { key: 'insurance_expiry', label: 'Insurance expiry', type: 'date' }, { key: 'permit_expiry', label: 'Permit expiry', type: 'date' }, { key: 'status', label: 'Status', type: 'select', required: true, default: 'available', options: ['available', 'on_trip', 'maintenance', 'inactive'].map((v) => ({ value: v, label: titleOf(v) })) }, { key: 'notes', label: 'Notes', type: 'area' }]} />}
      {detail && <ShipmentDetail id={detail} onClose={() => setDetail(null)} onChanged={ships.reload} canEdit={canEdit} canBill={nxCan(me, 'billingEdit')} canTransport={mgr} pk={pk} />}
      <TripDrawer trip={trip} onClose={() => setTrip(null)} pk={pk} onSaved={trips.reload} />
    </div>
  );
}
