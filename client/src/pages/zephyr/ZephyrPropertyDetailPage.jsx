import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Banknote, Building2, FileText, History, KeyRound, Landmark, Layers, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import {
  EMI_FREQUENCIES, EVENT_KINDS, EVENT_TONE, FINANCING_TYPES, PROPERTY_STATUSES, PROPERTY_STATUS_META, PROPERTY_TYPE_LABEL, RENT_STATUS, UNIT_STATUSES, UNIT_STATUS_META,
  monthLabel, shiftMonth, thisMonth,
} from '../../lib/zephyr/propertyMeta.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { dateLabel } from '../../lib/format.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import ZephyrDocuments from '../../components/zephyr/ZephyrDocuments.jsx';
import { LeaseForm, PaymentForm, TenantForm } from '../../components/zephyr/ZephyrRentForms.jsx';
import { Detail, Empty, Section, card, dayOf, inputCls, labelCls, toBody, today } from '../../components/zephyr/formKit.jsx';
import { PropertyForm } from './ZephyrPropertiesPage.jsx';

const Actions = ({ saving, onCancel, label = 'Save' }) => (
  <div className="flex justify-end gap-2">
    <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
    <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : label}</button>
  </div>
);

function UnitForm({ initial, canFinance, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ name: initial?.name || '', building: initial?.building || '', floor: initial?.floor || '', unit_type: initial?.unit_type || '', area_value: initial?.area_value ?? '', status: initial?.status || 'available', ownership: initial?.ownership || 'zephyr', allocated_cost: initial?.allocated_cost ?? '', notes: initial?.notes || '' });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  const lockedStatus = initial && ['sold', 'rented'].includes(initial.status);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = toBody(v, { numbers: ['area_value', 'allocated_cost'] });
        if (!canFinance) delete body.allocated_cost;
        if (lockedStatus) delete body.status;
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <Section title="Unit">
        <label className={labelCls}>Unit name<input className={inputCls} value={v.name} onChange={set('name')} required maxLength={120} autoFocus placeholder="Shop 1, Flat 204…" /></label>
        <label className={labelCls}>Type<input className={inputCls} value={v.unit_type} onChange={set('unit_type')} maxLength={60} placeholder="Shop, office, flat…" /></label>
        <label className={labelCls}>Building (optional)<input className={inputCls} value={v.building} onChange={set('building')} maxLength={120} /></label>
        <label className={labelCls}>Floor (optional)<input className={inputCls} value={v.floor} onChange={set('floor')} maxLength={60} /></label>
        <label className={labelCls}>Area<input type="number" min="0" className={inputCls} value={v.area_value} onChange={set('area_value')} /></label>
        <label className={labelCls}>Ownership<select className={inputCls} value={v.ownership} onChange={set('ownership')}><option value="zephyr">Owned by Zephyr</option><option value="third_party">Third party</option></select></label>
        <label className={labelCls}>Status{lockedStatus && <span className="font-normal text-tertiary-400"> (set by {initial.status === 'sold' ? 'the sale' : 'the lease'})</span>}
          <select className={inputCls} value={lockedStatus ? initial.status : v.status} onChange={set('status')} disabled={lockedStatus}>{UNIT_STATUSES.filter((s) => lockedStatus || !['sold', 'rented'].includes(s.value)).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        </label>
        {canFinance && <label className={labelCls}>Allocated cost (₹)<input type="number" min="0" className={inputCls} value={v.allocated_cost} onChange={set('allocated_cost')} placeholder="Blank = share by area" /></label>}
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={2} value={v.notes} onChange={set('notes')} maxLength={2000} /></label>
      </Section>
      <Actions saving={saving} onCancel={onCancel} label="Save unit" />
    </form>
  );
}

function ValuationForm({ initial, units, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ unit_id: initial?.unit_id || '', value: initial?.value ?? '', as_of: initial ? dayOf(initial.as_of) : today(), notes: initial?.notes || '' });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); const body = toBody(v, { numbers: ['value'] }); if (initial) delete body.unit_id; onSubmit(body); }} className="space-y-4">
      <Section title="Manual valuation" hint="Valuation is entered by hand. It shows as unrealized appreciation and never counts as income until the property is sold.">
        <label className={labelCls}>Applies to<select className={inputCls} value={v.unit_id} onChange={set('unit_id')} disabled={Boolean(initial)}><option value="">Whole property</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label className={labelCls}>Current estimated value (₹)<input type="number" min="0" className={inputCls} value={v.value} onChange={set('value')} required autoFocus /></label>
        <label className={labelCls}>Valuation date<input type="date" className={inputCls} max={today()} value={v.as_of} onChange={set('as_of')} required /></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={2} value={v.notes} onChange={set('notes')} maxLength={500} /></label>
      </Section>
      <Actions saving={saving} onCancel={onCancel} label={initial ? 'Save changes' : 'Save valuation'} />
    </form>
  );
}

function LoanForm({ initial, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ financing_type: initial?.financing_type || 'bank_loan', lender: initial?.lender || '', loan_amount: initial?.loan_amount ?? '', outstanding_amount: initial?.outstanding_amount ?? '', emi_amount: initial?.emi_amount ?? '', emi_frequency: initial?.emi_frequency || 'monthly', interest_rate: initial?.interest_rate ?? '', start_date: dayOf(initial?.start_date), end_date: dayOf(initial?.end_date), status: initial?.status || 'active', notes: initial?.notes || '' });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(toBody(v, { numbers: ['loan_amount', 'outstanding_amount', 'emi_amount', 'interest_rate'] })); }} className="space-y-4">
      <Section title="Financing">
        <label className={labelCls}>Financing type<select className={inputCls} value={v.financing_type} onChange={set('financing_type')}>{FINANCING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        <label className={labelCls}>Bank / lender<input className={inputCls} value={v.lender} onChange={set('lender')} maxLength={200} autoFocus /></label>
        <label className={labelCls}>Loan amount (₹)<input type="number" min="0" className={inputCls} value={v.loan_amount} onChange={set('loan_amount')} /></label>
        <label className={labelCls}>Outstanding (₹)<input type="number" min="0" className={inputCls} value={v.outstanding_amount} onChange={set('outstanding_amount')} /></label>
        <label className={labelCls}>EMI (₹)<input type="number" min="0" className={inputCls} value={v.emi_amount} onChange={set('emi_amount')} /></label>
        <label className={labelCls}>EMI frequency<select className={inputCls} value={v.emi_frequency} onChange={set('emi_frequency')}>{EMI_FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
        <label className={labelCls}>Interest rate % (optional)<input type="number" min="0" step="0.001" className={inputCls} value={v.interest_rate} onChange={set('interest_rate')} /></label>
        <label className={labelCls}>Status<select className={inputCls} value={v.status} onChange={set('status')}><option value="active">Active</option><option value="closed">Closed</option></select></label>
        <label className={labelCls}>Loan start<input type="date" className={inputCls} value={v.start_date} onChange={set('start_date')} /></label>
        <label className={labelCls}>Loan end<input type="date" className={inputCls} min={v.start_date || undefined} value={v.end_date} onChange={set('end_date')} /></label>
      </Section>
      <Actions saving={saving} onCancel={onCancel} label="Save loan" />
    </form>
  );
}

function SaleForm({ initial, property, unit, parties, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ sale_value: initial?.sale_value ?? '', sale_date: initial ? dayOf(initial.sale_date) : today(), selling_costs: initial?.selling_costs || '', buyer_party_id: initial?.buyer_party_id || '', notes: initial?.notes || '' });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  const basis = unit ? null : property.total_invested;
  const profit = v.sale_value !== '' && basis != null ? Number(v.sale_value) - basis - (Number(v.selling_costs) || 0) : null;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(toBody({ ...v, ...(unit ? { unit_id: unit.id } : {}) }, { numbers: ['sale_value', 'selling_costs'] })); }} className="space-y-4">
      <div className="rounded-xl bg-primary-50 px-3 py-2 text-sm text-primary-900">Selling <strong>{unit ? `${property.name} · ${unit.name}` : `the whole of ${property.name}`}</strong>. This books realized revenue and cost in the P&amp;L.</div>
      <Section title="Sale">
        <label className={labelCls}>Sale value (₹)<input type="number" min="1" className={inputCls} value={v.sale_value} onChange={set('sale_value')} required autoFocus /></label>
        <label className={labelCls}>Sale date<input type="date" className={inputCls} max={today()} value={v.sale_date} onChange={set('sale_date')} required /></label>
        <label className={labelCls}>Brokerage / selling costs (₹)<input type="number" min="0" className={inputCls} value={v.selling_costs} onChange={set('selling_costs')} /></label>
        <label className={labelCls}>Buyer (client)<select className={inputCls} value={v.buyer_party_id} onChange={set('buyer_party_id')}><option value="">Not recorded</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={2} value={v.notes} onChange={set('notes')} maxLength={1000} /></label>
      </Section>
      {profit !== null && <div className="rounded-xl border px-3 py-2 text-sm">Expected net realized profit: <strong className={profit < 0 ? 'text-red-600' : 'text-green-700'}>{rupees(profit)}</strong> <span className="text-tertiary-500">(sale value − total investment {rupees(basis)} − selling costs)</span></div>}
      <Actions saving={saving} onCancel={onCancel} label={initial ? 'Save changes' : 'Record sale'} />
    </form>
  );
}

function EventForm({ initial, units, saving, onSubmit, onCancel, canFinance }) {
  const [v, setV] = useState({ kind: initial?.kind || 'note', event_date: initial ? dayOf(initial.event_date) : today(), title: initial?.title || '', amount: initial?.amount ?? '', unit_id: initial?.unit_id || '', notes: initial?.notes || '' });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); const body = toBody(v, { numbers: ['amount'] }); if (!canFinance) delete body.amount; if (initial) delete body.unit_id; onSubmit(body); }} className="space-y-4">
      <Section title="Timeline entry">
        <label className={labelCls}>Type<select className={inputCls} value={v.kind} onChange={set('kind')}>{EVENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
        <label className={labelCls}>Date<input type="date" className={inputCls} value={v.event_date} onChange={set('event_date')} required /></label>
        <label className={`${labelCls} sm:col-span-2`}>What happened<input className={inputCls} value={v.title} onChange={set('title')} required maxLength={200} autoFocus placeholder="Construction started, plastering done…" /></label>
        <label className={labelCls}>Unit (optional)<select className={inputCls} value={v.unit_id} onChange={set('unit_id')} disabled={Boolean(initial)}><option value="">Whole property</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        {canFinance && <label className={labelCls}>Amount (₹, optional)<input type="number" min="0" className={inputCls} value={v.amount} onChange={set('amount')} /></label>}
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={2} value={v.notes} onChange={set('notes')} maxLength={1000} /></label>
      </Section>
      <Actions saving={saving} onCancel={onCancel} label={initial ? 'Save changes' : 'Add to timeline'} />
    </form>
  );
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'units', label: 'Units', icon: Building2 },
  { key: 'leases', label: 'Tenants & leases', icon: Users },
  { key: 'rent', label: 'Rent', icon: KeyRound },
  { key: 'finance', label: 'Finance', icon: Landmark },
  { key: 'timeline', label: 'Timeline', icon: History },
  { key: 'documents', label: 'Documents', icon: FileText },
];

function RentTab({ property, canEdit, people, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [month, setMonth] = useState(thisMonth());
  const [dues, setDues] = useState(null);
  const [paying, setPaying] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => zephyrApi.rentDues({ month, property_id: property.id }).then(setDues, (e) => pushError(zephyrError(e), 'Could not load rent')), [month, property.id, pushError]);
  useEffect(() => {
    setDues(null);
    load();
  }, [load]);

  async function pay(body) {
    setSaving(true);
    try {
      await zephyrApi.payRent(paying.id, body);
      pushSuccess('Payment recorded');
      setPaying(null);
      await load();
      onChanged();
    } catch (e) {
      pushError(zephyrError(e, 'Could not record the payment'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <span className="min-w-[8rem] text-center text-sm font-semibold text-tertiary-900">{monthLabel(month)}</span>
        <button type="button" className="btn-secondary" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()}>›</button>
      </div>
      {!dues ? <Empty>Loading…</Empty> : dues.length === 0 ? <Empty>No rent falls due this month for this property.</Empty> : (
        <div className={`${card} overflow-x-auto p-0 md:p-0`}>
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-4 py-2.5">Tenant / unit</th><th className="px-4 py-2.5">Due date</th><th className="px-4 py-2.5 text-right">Rent</th><th className="px-4 py-2.5 text-right">Paid</th><th className="px-4 py-2.5">Status</th><th className="w-28" /></tr></thead>
            <tbody className="divide-y">
              {dues.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2.5"><div className="font-medium text-tertiary-900">{d.tenant.name}</div><div className="text-xs text-tertiary-500">{d.unit.name}</div></td>
                  <td className="px-4 py-2.5">{dateLabel(d.due_date)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rupees(d.amount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rupees(d.paid_amount)}</td>
                  <td className="px-4 py-2.5"><Pill tone={RENT_STATUS[d.status].tone}>{RENT_STATUS[d.status].label}</Pill>{d.partially_paid && d.status === 'overdue' && <span className="ml-1 text-[11px] text-tertiary-500">part paid</span>}</td>
                  <td className="px-2 text-right">{canEdit && d.balance > 0 && <button type="button" className="btn-secondary" onClick={() => setPaying(d)}>Record payment</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Drawer open={Boolean(paying)} onClose={() => setPaying(null)} size="lg" tone="create" title="Record rent payment">
        {paying && <PaymentForm due={paying} people={people} saving={saving} onSubmit={pay} onCancel={() => setPaying(null)} />}
      </Drawer>
    </div>
  );
}

export default function ZephyrPropertyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me, loading } = useZephyr();
  const { pushError, pushSuccess } = useAlerts();
  const [p, setP] = useState(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState('overview');
  const [drawer, setDrawer] = useState(null); // { kind, unit?, loan? }
  const [saving, setSaving] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [parties, setParties] = useState([]);
  const [people, setPeople] = useState([]);
  const [leases, setLeases] = useState([]);
  const [sales, setSales] = useState([]);

  const canEdit = zxCan(me, 'propertiesEdit');
  const canFinance = zxCan(me, 'propertyFinance');
  const canRent = zxCan(me, 'rentEdit');
  const canTrade = zxCan(me, 'trading');
  const canDelete = zxCan(me, 'delete');

  const load = useCallback(
    () => zephyrApi.property(id).then(setP, (e) => (e?.response?.status === 404 ? setMissing(true) : pushError(zephyrError(e), 'Could not load property'))),
    [id, pushError]
  );
  useEffect(() => {
    setP(null);
    load();
  }, [load]);
  const loadLeases = useCallback(() => zephyrApi.leases({ property_id: id }).then(setLeases, () => setLeases([])), [id]);
  const loadSales = useCallback(() => (canTrade ? zephyrApi.sales({ property_id: id }).then((r) => setSales(r.data), () => setSales([])) : Promise.resolve()), [id, canTrade]);
  useEffect(() => {
    if (!me) return;
    if (zxCan(me, 'rent')) {
      zephyrApi.tenants().then(setTenants, () => setTenants([]));
      loadLeases();
      zephyrApi.people({ status: 'active' }).then(setPeople, () => setPeople([]));
    }
    zephyrApi.parties({ status: 'active', limit: 200 }).then((r) => setParties(r.data.filter((x) => x.kind !== 'vendor')), () => setParties([]));
    loadSales();
  }, [me, loadLeases, loadSales]);

  const units = useMemo(() => p?.units || [], [p]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'properties') || missing) return <Navigate to="/zephyr/properties" replace />;
  if (!p) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;

  const refreshAll = async () => {
    await Promise.all([load(), loadLeases(), loadSales()]);
  };

  // Runs a call, shows the server's reason on failure and refreshes the property on success.
  async function run(action, success, fail = 'Could not save') {
    setSaving(true);
    try {
      const result = await action();
      if (result?.id && result?.units) setP(result);
      else await load();
      if (success) pushSuccess(success);
      return true;
    } catch (e) {
      pushError(zephyrError(e, fail), fail);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const close = () => setDrawer(null);
  const status = PROPERTY_STATUS_META[p.status];
  const counts = units.reduce((a, u) => ({ ...a, [u.status]: (a[u.status] || 0) + 1 }), {});
  const cash = p.cash_flow;
  const activeLeases = leases.filter((l) => l.status === 'active');
  const tabs = TABS.filter((t) => (t.key === 'finance' ? canFinance : t.key === 'leases' || t.key === 'rent' ? zxCan(me, 'rent') : true));

  async function saveProperty(values) {
    if (await run(() => zephyrApi.updateProperty(p.id, values), 'Property saved')) close();
  }
  async function saveUnit(values) {
    const edit = drawer.unit;
    if (await run(() => (edit ? zephyrApi.updateUnit(p.id, edit.id, values) : zephyrApi.addUnit(p.id, values)), edit ? 'Unit saved' : 'Unit added')) close();
  }
  async function removeUnit(u) {
    if (window.confirm(`Remove ${u.name}?`)) await run(() => zephyrApi.deleteUnit(p.id, u.id), 'Unit removed', 'Could not remove');
  }
  async function saveLease(values) {
    const edit = drawer.lease;
    if (await run(() => (edit ? zephyrApi.updateLease(edit.id, values) : zephyrApi.createLease(values)), edit ? 'Lease updated' : 'Lease created')) {
      await refreshAll();
      close();
    }
  }
  async function endLease(l) {
    const reason = window.prompt(`End the lease of ${l.tenant?.name}? Optionally say why:`, '');
    if (reason === null) return;
    if (await run(() => zephyrApi.endLease(l.id, { reason: reason.trim() || null }), 'Lease ended')) await refreshAll();
  }
  async function saveTenant(values) {
    setSaving(true);
    try {
      const t = await zephyrApi.createTenant(values);
      setTenants((cur) => [...cur, t]);
      pushSuccess('Tenant added');
      setDrawer((cur) => ({ ...cur, kind: cur.back || 'lease' }));
    } catch (e) {
      pushError(zephyrError(e, 'Could not add the tenant'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function saveLoan(values) {
    const edit = drawer.loan;
    if (await run(() => (edit ? zephyrApi.updateLoan(p.id, edit.id, values) : zephyrApi.addLoan(p.id, values)), edit ? 'Loan saved' : 'Loan added')) close();
  }
  async function removeLoan(l) {
    if (window.confirm('Remove this loan?')) await run(() => zephyrApi.deleteLoan(p.id, l.id), 'Loan removed', 'Could not remove');
  }
  async function saveValuation(values) {
    const edit = drawer.valuation;
    if (await run(() => (edit ? zephyrApi.updateValuation(p.id, edit.id, values) : zephyrApi.addValuation(p.id, values)), 'Valuation saved')) close();
  }
  async function removeValuation(v) {
    if (window.confirm('Remove this valuation entry?')) await run(() => zephyrApi.deleteValuation(p.id, v.id), 'Valuation removed', 'Could not remove');
  }
  async function saveSale(values) {
    const edit = drawer.sale;
    if (await run(() => (edit ? zephyrApi.updateSale(p.id, edit.id, values) : zephyrApi.sellProperty(p.id, values)).then(() => load()), edit ? 'Sale updated' : 'Sale recorded')) {
      await loadSales();
      close();
    }
  }
  async function reverseSale(s) {
    const reason = window.prompt('Why is this sale being reversed?');
    if (!reason?.trim()) return;
    if (await run(() => zephyrApi.reverseSale(p.id, s.id, reason.trim()).then(() => load()), 'Sale reversed', 'Could not reverse')) await loadSales();
  }
  async function removeEvent(e) {
    if (window.confirm('Remove this timeline entry?')) await run(() => zephyrApi.deletePropertyEvent(p.id, e.id), 'Entry removed', 'Could not remove');
  }
  async function saveEvent(values) {
    const edit = drawer.event;
    if (await run(() => (edit ? zephyrApi.updatePropertyEvent(p.id, edit.id, values) : zephyrApi.addPropertyEvent(p.id, values)), edit ? 'Entry saved' : 'Added to the timeline')) close();
  }
  async function removeProperty() {
    if (!window.confirm(`Delete ${p.code} ${p.name}?`)) return;
    try {
      await zephyrApi.deleteProperty(p.id);
      pushSuccess('Property deleted');
      navigate('/zephyr/properties');
    } catch (e) {
      pushError(zephyrError(e, 'Could not delete'), 'Delete failed');
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <Link to="/zephyr/properties" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline"><ArrowLeft className="h-4 w-4" />All properties</Link>

      <section className={`${card} flex flex-wrap items-start justify-between gap-4`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-tertiary-500">{p.code}</span>
            <Pill tone={status?.tone}>{status?.label}</Pill>
            <Pill tone="gray">{PROPERTY_TYPE_LABEL[p.property_type]}</Pill>
          </div>
          <h2 className="mt-1 font-heading text-xl font-bold text-tertiary-900">{p.name}</h2>
          <div className="mt-1 text-sm text-tertiary-500">{[p.address, p.city, p.state].filter(Boolean).join(', ') || 'No address yet'}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <select aria-label="Property status" value={p.status} onChange={(e) => run(() => zephyrApi.updateProperty(p.id, { status: e.target.value }), 'Status updated')} className="rounded-xl border px-3 py-2 text-sm" disabled={p.status === 'sold'}>{PROPERTY_STATUSES.filter((s) => s.value !== 'sold' || p.status === 'sold').map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>}
          {canEdit && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'property' })}><Pencil className="h-4 w-4" />Edit</button>}
          {canTrade && p.status !== 'sold' && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'sale' })}><Banknote className="h-4 w-4" />Sell property</button>}
          {canDelete && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={removeProperty}><Trash2 className="h-4 w-4" />Delete</button>}
        </div>
      </section>

      <SectionTabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Units" value={units.length} hint={`${counts.rented || 0} rented · ${(counts.available || 0) + (counts.vacant || 0)} free · ${counts.sold || 0} sold`} />
            {canFinance && <StatCard label="Total invested" value={rupees(p.total_invested)} hint="all acquisition and development costs" />}
            {canFinance && <StatCard label="Current valuation" value={p.valuation == null ? '—' : rupees(p.valuation)} hint={p.valuation_date ? `manual, ${dateLabel(p.valuation_date)}` : 'not valued yet'} />}
            {canFinance && <StatCard label="Unrealized appreciation" value={p.appreciation == null ? '—' : rupees(p.appreciation)} hint={p.appreciation_pct == null ? 'enter a valuation' : `${p.appreciation_pct}% · not income until sold`} accent={p.appreciation > 0} />}
          </div>
          {canFinance && cash && (
            <section className={card}>
              <div className="mb-3 flex items-center justify-between"><h3 className="font-heading text-sm font-semibold text-tertiary-900">Cash flow this month</h3><Pill tone={cash.status === 'positive' ? 'green' : cash.status === 'negative' ? 'red' : 'gray'}>{cash.status === 'positive' ? 'Positive' : cash.status === 'negative' ? 'Negative' : 'Break-even'}</Pill></div>
              <dl className="grid gap-4 sm:grid-cols-4">
                <Detail label="Rental income">{rupees(cash.income)}</Detail>
                <Detail label="Operating expenses">{rupees(cash.expenses)}</Detail>
                <Detail label="Financing (EMI)">{rupees(cash.financing)}</Detail>
                <Detail label="Net cash flow"><span className={`text-base font-bold ${cash.net < 0 ? 'text-red-600' : 'text-green-700'}`}>{rupees(cash.net)}</span></Detail>
              </dl>
            </section>
          )}
          <section className={card}>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Location">{p.location}</Detail>
              <Detail label="Size">{p.area_value ? `${p.area_value.toLocaleString('en-IN')} ${p.area_unit}` : null}</Detail>
              <Detail label="Current use">{p.current_use}</Detail>
              <Detail label="Purchase date">{p.purchase_date ? dateLabel(p.purchase_date) : null}</Detail>
              <div className="sm:col-span-2 lg:col-span-3"><Detail label="Notes"><span className="whitespace-pre-wrap">{p.notes}</span></Detail></div>
            </dl>
          </section>
        </div>
      )}

      {tab === 'units' && (
        <div className="space-y-3">
          <div className="flex justify-end">{canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'unit' })}><Plus className="h-4 w-4" />Add unit</button>}</div>
          {units.length === 0 ? <Empty>No units yet. A plot or house can stay without units; add shops, flats or offices here when the property has them.</Empty> : (
            <div className={`${card} overflow-x-auto p-0 md:p-0`}>
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-4 py-2.5">Unit</th><th className="px-4 py-2.5">Floor</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Tenant</th>{canFinance && <th className="px-4 py-2.5 text-right">Valuation</th>}<th className="w-44" /></tr></thead>
                <tbody className="divide-y">
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-2.5"><div className="font-medium text-tertiary-900">{u.name}</div><div className="text-xs text-tertiary-500">{[u.unit_type, u.building, u.area_value && `${u.area_value} ${p.area_unit}`].filter(Boolean).join(' · ')}</div></td>
                      <td className="px-4 py-2.5">{u.floor || '—'}</td>
                      <td className="px-4 py-2.5"><Pill tone={UNIT_STATUS_META[u.status]?.tone}>{UNIT_STATUS_META[u.status]?.label}</Pill>{u.ownership === 'third_party' && <span className="ml-1 text-[11px] text-tertiary-500">third party</span>}</td>
                      <td className="px-4 py-2.5">{u.tenant ? <span>{u.tenant.name}<span className="block text-xs text-tertiary-500">{rupees(u.tenant.monthly_rent)} / month</span></span> : '—'}</td>
                      {canFinance && <td className="px-4 py-2.5 text-right tabular-nums">{u.valuation == null ? '—' : rupees(u.valuation)}</td>}
                      <td className="px-2 text-right">
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          {canRent && !u.tenant && !['sold'].includes(u.status) && u.ownership === 'zephyr' && <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50" onClick={() => setDrawer({ kind: 'lease', unit: u })}>Rent out</button>}
                          {canTrade && !u.tenant && u.status !== 'sold' && u.ownership === 'zephyr' && p.status !== 'sold' && <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50" onClick={() => setDrawer({ kind: 'sale', unit: u })}>Sell</button>}
                          {canEdit && <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-primary-50 hover:text-primary-700" aria-label={`Edit ${u.name}`} onClick={() => setDrawer({ kind: 'unit', unit: u })}><Pencil className="h-4 w-4" /></button>}
                          {canEdit && u.status !== 'sold' && !u.tenant && <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label={`Remove ${u.name}`} onClick={() => removeUnit(u)}><Trash2 className="h-4 w-4" /></button>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'leases' && (
        <div className="space-y-3">
          <div className="flex justify-end gap-2">{canRent && units.some((u) => !u.tenant && u.status !== 'sold' && u.ownership === 'zephyr') && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'lease' })}><Plus className="h-4 w-4" />New lease</button>}</div>
          {leases.length === 0 ? <Empty>No leases for this property yet.</Empty> : (
            <div className={`${card} overflow-x-auto p-0 md:p-0`}>
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-4 py-2.5">Tenant</th><th className="px-4 py-2.5">Unit</th><th className="px-4 py-2.5">Period</th><th className="px-4 py-2.5 text-right">Rent</th><th className="px-4 py-2.5 text-right">Deposit</th><th className="px-4 py-2.5">Status</th><th className="w-24" /></tr></thead>
                <tbody className="divide-y">
                  {leases.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2.5 font-medium text-tertiary-900">{l.tenant?.name}{l.tenant?.company_name && <span className="block text-xs font-normal text-tertiary-500">{l.tenant.company_name}</span>}</td>
                      <td className="px-4 py-2.5">{l.unit?.name}</td>
                      <td className="px-4 py-2.5 text-tertiary-600">{dateLabel(l.start_date)} → {l.ended_on ? dateLabel(l.ended_on) : l.end_date ? dateLabel(l.end_date) : 'ongoing'}<span className="block text-xs text-tertiary-400">due day {l.due_day}</span></td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{rupees(l.monthly_rent)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{rupees(l.security_deposit)}</td>
                      <td className="px-4 py-2.5"><Pill tone={l.status === 'active' ? 'green' : 'gray'}>{l.status === 'active' ? 'Active' : 'Ended'}</Pill></td>
                      <td className="px-2 text-right">{canRent && l.status === 'active' && <><button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50" onClick={() => setDrawer({ kind: 'lease', lease: l })}>Edit</button><button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-danger-600 hover:bg-danger-50" onClick={() => endLease(l)}>End lease</button></>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-tertiary-400">{activeLeases.length} active lease{activeLeases.length === 1 ? '' : 's'}, monthly rent {rupees(activeLeases.reduce((a, l) => a + l.monthly_rent, 0))}.</p>
        </div>
      )}

      {tab === 'rent' && zxCan(me, 'rent') && <RentTab property={p} canEdit={canRent} people={people} onChanged={load} />}

      {tab === 'finance' && canFinance && (
        <div className="space-y-4">
          <section className={card}>
            <div className="mb-3 flex items-center justify-between"><h3 className="font-heading text-sm font-semibold text-tertiary-900">Investment</h3>{canEdit && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'property' })}><Pencil className="h-4 w-4" />Edit costs</button>}</div>
            <dl className="grid gap-3 sm:grid-cols-4">
              {[['Purchase', 'purchase_cost'], ['Brokerage', 'brokerage'], ['Documentation', 'documentation_cost'], ['Registration', 'registration_cost'], ['Construction', 'construction_cost'], ['Renovation', 'renovation_cost'], ['Other', 'other_cost']].map(([label, key]) => <Detail key={key} label={label}>{rupees(p[key])}</Detail>)}
              <Detail label="Total invested"><strong className="tabular-nums">{rupees(p.total_invested)}</strong></Detail>
            </dl>
          </section>

          <section className={card}>
            <div className="mb-3 flex items-center justify-between"><h3 className="font-heading text-sm font-semibold text-tertiary-900">Manual valuation</h3><button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'valuation' })}><Plus className="h-4 w-4" />Update valuation</button></div>
            <p className="mb-3 text-xs text-tertiary-500">Current value {p.valuation == null ? 'not entered' : rupees(p.valuation)}. Appreciation {p.appreciation == null ? '—' : `${rupees(p.appreciation)} (${p.appreciation_pct ?? '—'}%)`} is <strong>unrealized</strong>: it is not in the P&amp;L until the property or a unit is sold.</p>
            {p.valuations?.length ? (
              <ul className="divide-y rounded-xl border bg-white text-sm">
                {p.valuations.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate text-tertiary-700">{dateLabel(v.as_of)}{v.unit_id ? ` · ${units.find((u) => u.id === v.unit_id)?.name || 'unit'}` : ''}{v.notes ? ` · ${v.notes}` : ''}</span>
                    <span className="inline-flex shrink-0 items-center gap-2"><span className="font-medium tabular-nums">{rupees(v.value)}</span><button type="button" className="rounded-lg p-1 text-tertiary-400 hover:bg-primary-50 hover:text-primary-700" aria-label="Edit valuation" onClick={() => setDrawer({ kind: 'valuation', valuation: v })}><Pencil className="h-4 w-4" /></button><button type="button" className="rounded-lg p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Remove valuation" onClick={() => removeValuation(v)}><Trash2 className="h-4 w-4" /></button></span>
                  </li>
                ))}
              </ul>
            ) : <Empty>No valuation entered yet.</Empty>}
          </section>

          <section className={card}>
            <div className="mb-3 flex items-center justify-between"><h3 className="font-heading text-sm font-semibold text-tertiary-900">Financing</h3><button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'loan' })}><Plus className="h-4 w-4" />Add loan</button></div>
            {p.loans?.length ? (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="border-b text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="py-2">Lender</th><th className="py-2 text-right">Loan</th><th className="py-2 text-right">Outstanding</th><th className="py-2 text-right">EMI</th><th className="py-2 text-right">Per month</th><th className="py-2">Status</th><th className="w-20" /></tr></thead>
                <tbody className="divide-y">
                  {p.loans.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 font-medium text-tertiary-900">{l.lender || FINANCING_TYPES.find((t) => t.value === l.financing_type)?.label}{l.interest_rate != null && <span className="block text-xs font-normal text-tertiary-500">{l.interest_rate}% interest</span>}</td>
                      <td className="py-2 text-right tabular-nums">{rupees(l.loan_amount)}</td>
                      <td className="py-2 text-right tabular-nums">{rupees(l.outstanding_amount)}</td>
                      <td className="py-2 text-right tabular-nums">{rupees(l.emi_amount)} <span className="text-xs text-tertiary-400">{l.emi_frequency}</span></td>
                      <td className="py-2 text-right tabular-nums">{rupees(l.monthly_cost)}</td>
                      <td className="py-2"><Pill tone={l.status === 'active' ? 'green' : 'gray'}>{l.status === 'active' ? 'Active' : 'Closed'}</Pill></td>
                      <td className="py-2 text-right"><button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-primary-50 hover:text-primary-700" aria-label="Edit loan" onClick={() => setDrawer({ kind: 'loan', loan: l })}><Pencil className="h-4 w-4" /></button><button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Remove loan" onClick={() => removeLoan(l)}><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : <Empty>No loan or financing recorded for this property.</Empty>}
            {p.loans?.length > 0 && <p className="mt-2 text-xs text-tertiary-500">Outstanding {rupees(p.outstanding_loan)} · monthly financing cost {rupees(p.monthly_financing)}.</p>}
          </section>

          {canTrade && (
            <section className={card}>
              <div className="mb-3 flex items-center justify-between"><h3 className="font-heading text-sm font-semibold text-tertiary-900">Sales (realized)</h3></div>
              {sales.length === 0 ? <Empty>Nothing sold from this property yet. Sell the property, or a unit from the Units tab.</Empty> : (
                <ul className="divide-y rounded-xl border bg-white text-sm">
                  {sales.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0"><span className="font-medium text-tertiary-900">{s.unit ? s.unit.name : 'Whole property'}</span><span className="block text-xs text-tertiary-500">{dateLabel(s.sale_date)}{s.buyer ? ` · ${s.buyer.name}` : ''} · held {s.holding_days ?? '—'} days</span></span>
                      <span className="inline-flex items-center gap-3"><span className="text-right"><span className="block tabular-nums">{rupees(s.sale_value)}</span><span className={`block text-xs tabular-nums ${s.realized_profit < 0 ? 'text-red-600' : 'text-green-700'}`}>profit {rupees(s.realized_profit)}</span></span><button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-danger-600 hover:bg-danger-50" onClick={() => reverseSale(s)}>Reverse</button><button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50" onClick={() => setDrawer({ kind: 'sale', sale: s, unit: s.unit ? units.find((u) => u.id === s.unit_id) : null })}>Edit</button></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      {tab === 'timeline' && (
        <div className="space-y-3">
          <div className="flex justify-end">{canEdit && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'event' })}><Plus className="h-4 w-4" />Add entry</button>}</div>
          {p.events.length === 0 ? <Empty>The timeline fills as the property is bought, built, valued, let and sold.</Empty> : (
            <ol className="relative space-y-4 border-l-2 border-primary-100 pl-5">
              {p.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full border-2 border-white bg-primary-400" />
                  <div className="flex flex-wrap items-center gap-2"><Pill tone={EVENT_TONE[e.kind]}>{e.kind}</Pill><span className="text-xs text-tertiary-500">{dateLabel(e.event_date)}</span>{e.amount != null && canFinance && <span className="text-xs font-medium tabular-nums text-tertiary-700">{rupees(e.amount)}</span>}</div>
                  <div className="mt-0.5 text-sm font-medium text-tertiary-900">{e.title}</div>
                  {e.notes && <div className="text-xs text-tertiary-500">{e.notes}</div>}
                  {canEdit && !e.source_type && (
                    <div className="mt-1 flex gap-3 text-xs">
                      <button type="button" className="font-medium text-primary-700 hover:underline" onClick={() => setDrawer({ kind: 'event', event: e })}>Edit</button>
                      <button type="button" className="font-medium text-danger-600 hover:underline" onClick={() => removeEvent(e)}>Remove</button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {tab === 'documents' && <section className={card}><ZephyrDocuments ownerType="property" ownerId={p.id} canEdit={canEdit} /></section>}

      <Drawer open={Boolean(drawer)} onClose={close} size="xl" tone={['unit', 'property', 'loan'].includes(drawer?.kind) && (drawer.unit || drawer.loan || drawer.kind === 'property') ? 'edit' : 'create'}
        title={{ property: `Edit ${p.code}`, unit: drawer?.unit ? `Edit ${drawer.unit.name}` : 'Add unit', lease: drawer?.lease ? 'Edit lease' : 'New lease', tenant: 'New tenant', valuation: drawer?.valuation ? 'Edit valuation' : 'Update valuation', loan: drawer?.loan ? 'Edit loan' : 'Add loan', sale: drawer?.sale ? 'Edit sale' : drawer?.unit ? `Sell ${drawer.unit.name}` : 'Sell property', event: drawer?.event ? 'Edit timeline entry' : 'Add to timeline' }[drawer?.kind] || ''}>
        {drawer?.kind === 'property' && <PropertyForm initial={p} canFinance={canFinance} saving={saving} onSubmit={saveProperty} onCancel={close} />}
        {drawer?.kind === 'unit' && <UnitForm initial={drawer.unit} canFinance={canFinance} saving={saving} onSubmit={saveUnit} onCancel={close} />}
        {drawer?.kind === 'lease' && (
          <LeaseForm initial={drawer.lease} tenants={tenants} unit={drawer.unit} units={units.filter((u) => !u.tenant && u.status !== 'sold' && u.ownership === 'zephyr')} saving={saving} onSubmit={saveLease} onCancel={close} onNewTenant={() => setDrawer({ ...drawer, kind: 'tenant', back: 'lease' })} />
        )}
        {drawer?.kind === 'tenant' && <TenantForm saving={saving} onSubmit={saveTenant} onCancel={() => setDrawer({ ...drawer, kind: drawer.back || 'lease' })} />}
        {drawer?.kind === 'valuation' && <ValuationForm initial={drawer.valuation} units={units} saving={saving} onSubmit={saveValuation} onCancel={close} />}
        {drawer?.kind === 'loan' && <LoanForm initial={drawer.loan} saving={saving} onSubmit={saveLoan} onCancel={close} />}
        {drawer?.kind === 'sale' && <SaleForm initial={drawer.sale} property={p} unit={drawer.unit} parties={parties} saving={saving} onSubmit={saveSale} onCancel={close} />}
        {drawer?.kind === 'event' && <EventForm initial={drawer.event} units={units} canFinance={canFinance} saving={saving} onSubmit={saveEvent} onCancel={close} />}
      </Drawer>
    </div>
  );
}
