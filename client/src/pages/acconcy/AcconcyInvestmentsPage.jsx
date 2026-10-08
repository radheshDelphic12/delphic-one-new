import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Banknote, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, INVESTMENT_STATUSES, INVESTMENT_STATUS_META, INVESTMENT_TYPES, INVESTMENT_TYPE_META, SERVICE_TYPES, pctLabel, qtyLabel } from '../../lib/acconcy/meta.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import AcconcyDocuments from '../../components/acconcy/AcconcyDocuments.jsx';
import { Area, DateInput, Detail, Empty, Kpi, Money, Num, Section, Select, Text, dayOf, today, toBody, withReason } from '../../components/acconcy/ui.jsx';
import { dateLabel } from '../../lib/format.js';

const NUMS = ['amount', 'current_value', 'quantity', 'purchase_price', 'current_price', 'equity_pct'];
const FIELDS = ['name', 'type', 'deal_id', 'service_type', 'investment_date', 'amount', 'current_value', 'quantity', 'unit', 'purchase_price', 'current_price', 'purity', 'storage_location', 'startup_name', 'equity_pct', 'description', 'notes'];
const BLANK = { type: '', service_type: '', deal_id: '', status: '', from: '', to: '' };
const gainTone = (n) => (n > 0 ? 'text-green-700' : n < 0 ? 'text-red-600' : '');

function InvestmentForm({ initial, deals, onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, k === 'investment_date' ? dayOf(initial?.investment_date) || today() : initial?.[k] ?? (k === 'type' ? 'gold' : '')])));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const metal = v.type === 'gold' || v.type === 'silver';
  const auto = v.quantity !== '' && v.purchase_price !== '' ? Number(v.quantity) * Number(v.purchase_price) : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = toBody(v, { numbers: NUMS });
        body.name = v.name.trim();
        if (body.current_value === null || body.current_value === undefined) delete body.current_value;
        if (!initial) delete body.status;
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <Section title="Investment">
        <Text label="Investment name" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} autoFocus />
        <Select label="Type" value={v.type} onChange={set('type')} options={INVESTMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))} required />
        <Select label="Service type" value={v.service_type} onChange={set('service_type')} options={SERVICE_TYPES.map((t) => ({ value: t.value, label: t.label }))} blank="Automatic from type" />
        <Select label="Linked deal" value={v.deal_id} onChange={set('deal_id')} options={deals} blank="No deal" />
        <DateInput label="Investment date" value={v.investment_date} onChange={set('investment_date')} required />
        <Num label="Investment amount" value={v.amount} onChange={set('amount')} required min="0.01" hint={auto !== null ? `Quantity x purchase price = ${auto.toLocaleString('en-IN')}` : undefined} />
        <Num label="Current value" value={v.current_value} onChange={set('current_value')} hint="Left blank = the investment amount. This is unrealised: it never counts as revenue." />
      </Section>
      {metal && (
        <Section title="Gold / silver details" hint="All optional.">
          <Num label="Quantity" value={v.quantity} onChange={set('quantity')} />
          <Text label="Unit" value={v.unit} onChange={set('unit')} placeholder="g, kg, oz" maxLength={40} />
          <Num label="Purchase price (per unit)" value={v.purchase_price} onChange={set('purchase_price')} />
          <Num label="Current price (per unit)" value={v.current_price} onChange={set('current_price')} />
          <Text label="Purity" value={v.purity} onChange={set('purity')} placeholder="24K, 999" maxLength={60} />
          <Text label="Storage location" value={v.storage_location} onChange={set('storage_location')} maxLength={200} />
        </Section>
      )}
      {v.type === 'venture' && (
        <Section title="Venture details" hint="Ownership is optional.">
          <Text label="Company / startup" value={v.startup_name} onChange={set('startup_name')} maxLength={200} />
          <Num label="Ownership / equity %" value={v.equity_pct} onChange={set('equity_pct')} max="100" />
        </Section>
      )}
      <Section title="Description">
        <Area label="Description" className="sm:col-span-2" rows={4} value={v.description} onChange={set('description')} maxLength={20000} />
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={set('notes')} maxLength={4000} />
      </Section>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save investment'}</button>
      </div>
    </form>
  );
}

function RealiseForm({ inv, onSubmit, onCancel, saving }) {
  const p = inv.performance;
  const [v, setV] = useState({ realised_date: today(), amount_received: '', cost_released: p.remaining_cost, full: true, remaining_value: '', notes: '' });
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const cost = v.full ? p.remaining_cost : Number(v.cost_released || 0);
  const gain = v.amount_received === '' ? null : Number(v.amount_received) - cost;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = { realised_date: v.realised_date, amount_received: Number(v.amount_received), full: v.full, notes: v.notes.trim() || null };
        if (!v.full) {
          body.cost_released = Number(v.cost_released);
          if (v.remaining_value !== '') body.remaining_value = Number(v.remaining_value);
        }
        onSubmit(body);
      }}
      className="space-y-3"
    >
      <p className="text-sm text-tertiary-600">Record cash actually received. Only the gain (received minus the cost released) is posted to revenue; the unrealised value stays out of the P&L.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <DateInput label="Date" value={v.realised_date} onChange={set('realised_date')} required min={dayOf(inv.investment_date)} />
        <Num label="Amount received" value={v.amount_received} onChange={set('amount_received')} required />
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.full} onChange={(e) => set('full')(e.target.checked)} />Sell / redeem the whole holding (cost {Math.round(p.remaining_cost).toLocaleString('en-IN')})</label>
        {!v.full && <Num label="Cost released" value={v.cost_released} onChange={set('cost_released')} required max={p.remaining_cost} />}
        {!v.full && <Num label="Value of what is still held" value={v.remaining_value} onChange={set('remaining_value')} hint="Optional; keeps the unrealised figure up to date" />}
        <Text label="Notes" className="sm:col-span-2" value={v.notes} onChange={set('notes')} maxLength={1000} />
      </div>
      {gain !== null && <div className={`rounded-xl bg-primary-50 px-3 py-2 text-sm ${gainTone(gain)}`}>{gain >= 0 ? 'Realised gain' : 'Realised loss'}: {Math.abs(gain).toLocaleString('en-IN')}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving || v.amount_received === ''}>{saving ? 'Saving...' : 'Record realisation'}</button>
      </div>
    </form>
  );
}

function AssetForm({ initial, onSubmit, onCancel, saving }) {
  const [v, setV] = useState({ name: initial?.name ?? '', category: initial?.category ?? 'other', value: initial?.value ?? '', as_of_date: dayOf(initial?.as_of_date) || today(), status: initial?.status ?? 'active', notes: initial?.notes ?? '' });
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(toBody(v, { numbers: ['value'] })); }} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Text label="Asset" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} />
        <Select label="Category" value={v.category} onChange={set('category')} options={ASSET_CATEGORIES} />
        <Select label="Status" value={v.status} onChange={set('status')} options={[{ value: 'active', label: 'Active (counts in valuation)' }, { value: 'disposed', label: 'Disposed' }]} />
        <Num label="Value" value={v.value} onChange={set('value')} required />
        <DateInput label="Value as of" value={v.as_of_date} onChange={set('as_of_date')} required />
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={set('notes')} maxLength={2000} />
      </div>
      <p className="text-xs text-tertiary-500">The valuation counts active assets dated on or before each month end. Investments are added automatically (see Financials settings), so do not list them here as well.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save asset'}</button>
      </div>
    </form>
  );
}

function AssetsTab({ me }) {
  const { pushError, pushSuccess } = useAlerts();
  const [f, setF] = useState({ category: '', status: 'active' });
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const canEdit = axCan(me, 'valuation');
  const load = useCallback(async () => {
    try {
      const r = await acconcyApi.assets(Object.fromEntries(Object.entries({ ...f, q: q.trim() }).filter(([, v]) => v)));
      setRows(r.data);
      setTotal(r.total_active ?? 0);
    } catch (e) {
      pushError(acconcyError(e, 'Could not load assets'), 'Load failed');
    }
  }, [f, q, pushError]);
  useEffect(() => { load(); }, [load]);
  async function save(body) {
    setSaving(true);
    try {
      await withReason(async (reason) => {
        const payload = { ...body, ...(reason ? { reason } : {}) };
        return modal.row ? acconcyApi.updateAsset(modal.row.id, payload) : acconcyApi.createAsset(payload);
      });
      pushSuccess('Saved');
      setModal(null);
      load();
    } catch (e) {
      pushError(acconcyError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function remove(a) {
    if (!window.confirm(`Delete ${a.name}?`)) return;
    try { await withReason((reason) => acconcyApi.deleteAsset(a.id, reason)); load(); } catch (e) { pushError(acconcyError(e, 'Could not delete'), 'Delete failed'); }
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi label="Active asset value" value={<Money v={total} />} hint="Feeds the valuation (x 3)" tone="ax-gold" /><Kpi label="Assets in view" value={rows.length} /></div>
      <FilterBar
        q={q}
        onQ={setQ}
        searchPlaceholder="Search assets..."
        fields={[
          { key: 'category', label: 'Category', type: 'select', any: 'Any category', options: ASSET_CATEGORIES },
          { key: 'status', label: 'Status', type: 'select', any: 'All', options: [{ value: 'active', label: 'Active' }, { value: 'disposed', label: 'Disposed' }] },
        ]}
        values={f}
        onChange={(k, v) => setF((c) => ({ ...c, [k]: v }))}
        onReset={() => { setF({ category: '', status: '' }); setQ(''); }}
      >
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setModal({})}><Plus className="h-4 w-4" />New asset</button>}
      </FilterBar>
      {rows.length === 0 ? <Empty>No assets match. Add the assets that should count in the company valuation.</Empty> : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-primary-50/60 text-left text-xs text-tertiary-500"><tr><th className="px-3 py-2 font-medium">Asset</th><th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 font-medium">As of</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 text-right font-medium">Value</th><th /></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="px-3 py-2 font-medium text-tertiary-900">{a.name}{a.notes && <span className="block text-xs font-normal text-tertiary-400">{a.notes}</span>}</td>
                  <td className="px-3 py-2">{ASSET_CATEGORY_LABEL[a.category] || a.category}</td>
                  <td className="px-3 py-2">{dateLabel(a.as_of_date)}</td>
                  <td className="px-3 py-2"><Pill tone={a.status === 'active' ? 'green' : 'gray'}>{a.status === 'active' ? 'Active' : 'Disposed'}</Pill></td>
                  <td className="px-3 py-2 text-right"><Money v={a.value} className="font-medium" /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{canEdit && <><button type="button" title="Edit" className="mr-1 rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setModal({ row: a })}><Pencil className="h-4 w-4" /></button><button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(a)}><Trash2 className="h-4 w-4" /></button></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(modal)} onClose={() => setModal(null)} wide title={modal?.row ? 'Edit asset' : 'New asset'}>
        {modal && <AssetForm initial={modal.row} saving={saving} onSubmit={save} onCancel={() => setModal(null)} />}
      </Modal>
    </div>
  );
}

function InvestmentsTab({ me }) {
  const { pushError, pushSuccess } = useAlerts();
  const [f, setF] = useState(BLANK);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [res, setRes] = useState({ rows: [], totals: null, byType: {} });
  const [deals, setDeals] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [drawer, setDrawer] = useState(null); // { mode: 'create' | 'edit' | 'view', inv? }
  const [realise, setRealise] = useState(null);
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);
  const canEdit = axCan(me, 'investments');
  const set = (k, v) => setF((c) => ({ ...c, [k]: v }));

  useEffect(() => { acconcyApi.deals({ status: 'all' }).then((rows) => setDeals(rows.map((d) => ({ value: d.id, label: `${d.code} ${d.name}` }))), () => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setFetching(true);
    try {
      const r = await acconcyApi.investments(Object.fromEntries(Object.entries({ ...f, q: dq }).filter(([, v]) => v)));
      if (id === reqId.current) setRes({ rows: r.data, totals: r.totals, byType: r.by_type || {} });
    } catch (e) {
      if (id === reqId.current) pushError(acconcyError(e, 'Could not load investments'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [f, dq, pushError]);
  useEffect(() => { load(); }, [load]);

  const inv = drawer?.inv;
  async function refresh(id) {
    const fresh = await acconcyApi.investment(id);
    setDrawer((d) => (d ? { ...d, inv: fresh } : d));
    load();
  }
  async function save(body) {
    setSaving(true);
    try {
      const out = await withReason(async (reason) => {
        const payload = { ...body, ...(reason ? { reason } : {}) };
        return drawer.mode === 'create' ? acconcyApi.createInvestment(payload) : acconcyApi.updateInvestment(inv.id, payload);
      });
      pushSuccess('Saved');
      setDrawer({ mode: 'view', inv: out });
      load();
    } catch (e) {
      pushError(acconcyError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function doRealise(body) {
    setSaving(true);
    try {
      await withReason((reason) => acconcyApi.realiseInvestment(inv.id, { ...body, ...(reason ? { reason } : {}) }));
      pushSuccess('Realisation recorded');
      setRealise(null);
      await refresh(inv.id);
    } catch (e) {
      pushError(acconcyError(e, 'Could not record'), 'Could not record');
    } finally {
      setSaving(false);
    }
  }
  async function undo(r) {
    if (!window.confirm('Undo this realisation? The revenue / expense posted from it is removed.')) return;
    try { await withReason((reason) => acconcyApi.deleteRealisation(inv.id, r.id, reason)); await refresh(inv.id); } catch (e) { pushError(acconcyError(e, 'Could not undo'), 'Could not undo'); }
  }
  async function remove() {
    if (!window.confirm(`Delete ${inv.name}?`)) return;
    try { await withReason((reason) => acconcyApi.deleteInvestment(inv.id, reason)); setDrawer(null); load(); } catch (e) { pushError(acconcyError(e, 'Could not delete'), 'Delete failed'); }
  }

  const t = res.totals;
  return (
    <div className="space-y-4">
      {t && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Total invested" value={<Money v={t.invested} />} hint="original amounts" />
          <Kpi label="Current value" value={<Money v={t.current_value} />} hint="what is still held" />
          <Kpi label="Unrealised gain" value={<Money v={t.unrealised_gain} signed />} hint="not revenue" />
          <Kpi label="Realised gain" value={<Money v={t.realised_gain} signed />} hint="posted to revenue" />
          <Kpi label="Gain / loss" value={<Money v={t.gain_loss} signed />} tone="ax-gold" />
          <Kpi label="Gain / loss %" value={pctLabel(t.gain_loss_pct)} />
        </div>
      )}
      <FilterBar
        q={q}
        onQ={setQ}
        searchPlaceholder="Search name, code, startup..."
        fields={[
          { key: 'type', label: 'Type', type: 'select', any: 'Any type', options: INVESTMENT_TYPES.map((x) => ({ value: x.value, label: x.label })) },
          { key: 'service_type', label: 'Service type', type: 'select', any: 'Any service', options: SERVICE_TYPES.map((x) => ({ value: x.value, label: x.label })) },
          { key: 'deal_id', label: 'Deal', type: 'select', any: 'Any deal', options: deals },
          { key: 'status', label: 'Status', type: 'select', any: 'Any status', options: INVESTMENT_STATUSES.map((x) => ({ value: x.value, label: x.label })) },
          { key: 'from', label: 'Invested from', type: 'date' },
          { key: 'to', label: 'Invested to', type: 'date' },
        ]}
        values={f}
        onChange={set}
        onReset={() => { setF(BLANK); setQ(''); }}
      >
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'create' })}><Plus className="h-4 w-4" />New investment</button>}
      </FilterBar>

      {res.rows.length === 0 ? <Empty>{fetching ? 'Loading...' : 'No investments match these filters.'}</Empty> : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-primary-50/60 text-left text-xs text-tertiary-500"><tr><th className="px-3 py-2 font-medium">Investment</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 text-right font-medium">Current value</th><th className="px-3 py-2 text-right font-medium">Realised</th><th className="px-3 py-2 text-right font-medium">Gain / loss</th><th className="px-3 py-2 font-medium">Status</th></tr></thead>
            <tbody>
              {res.rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t hover:bg-primary-50/40" onClick={() => setDrawer({ mode: 'view', inv: r })}>
                  <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}{r.deal ? ` · ${r.deal.code}` : ''}</span></td>
                  <td className="px-3 py-2"><Pill tone={INVESTMENT_TYPE_META[r.type]?.tone}>{INVESTMENT_TYPE_META[r.type]?.label}</Pill></td>
                  <td className="whitespace-nowrap px-3 py-2">{dateLabel(r.investment_date)}</td>
                  <td className="px-3 py-2 text-right"><Money v={r.amount} /></td>
                  <td className="px-3 py-2 text-right"><Money v={r.performance.current_value} /></td>
                  <td className="px-3 py-2 text-right"><Money v={r.performance.realised_gain} signed /></td>
                  <td className="px-3 py-2 text-right"><Money v={r.performance.gain_loss} signed className="font-semibold" /><span className="block text-[11px] text-tertiary-400">{pctLabel(r.performance.gain_loss_pct)}</span></td>
                  <td className="px-3 py-2"><Pill tone={INVESTMENT_STATUS_META[r.status]?.tone}>{INVESTMENT_STATUS_META[r.status]?.label}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="xl" tone={drawer?.mode === 'create' ? 'create' : drawer?.mode === 'edit' ? 'edit' : 'default'} title={drawer?.mode === 'create' ? 'New investment' : drawer?.mode === 'edit' ? `Edit ${inv?.name}` : inv ? `${inv.code} · ${inv.name}` : ''}>
        {drawer && drawer.mode !== 'view' && <InvestmentForm key={inv?.id || 'new'} initial={drawer.mode === 'edit' ? inv : null} deals={deals} saving={saving} onSubmit={save} onCancel={() => setDrawer(drawer.mode === 'edit' ? { mode: 'view', inv } : null)} />}
        {drawer?.mode === 'view' && inv && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2"><Pill tone={INVESTMENT_TYPE_META[inv.type]?.tone}>{INVESTMENT_TYPE_META[inv.type]?.label}</Pill><Pill tone={INVESTMENT_STATUS_META[inv.status]?.tone}>{INVESTMENT_STATUS_META[inv.status]?.label}</Pill></span>
              <span className="inline-flex flex-wrap gap-2">
                {canEdit && inv.status !== 'realised' && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setRealise(true)}><Banknote className="h-4 w-4" />Record sale / redemption</button>}
                {canEdit && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'edit', inv })}><Pencil className="h-4 w-4" />Edit</button>}
                {axCan(me, 'delete') && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={remove}><Trash2 className="h-4 w-4" />Delete</button>}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Invested" value={<Money v={inv.amount} />} />
              <Kpi label="Current value" value={<Money v={inv.performance.current_value} />} hint="unrealised" />
              <Kpi label="Realised gain" value={<Money v={inv.performance.realised_gain} signed />} hint="in revenue" />
              <Kpi label="Gain / loss" value={<Money v={inv.performance.gain_loss} signed />} hint={pctLabel(inv.performance.gain_loss_pct)} tone="ax-gold" />
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Investment date">{dateLabel(inv.investment_date)}</Detail>
              <Detail label="Linked deal">{inv.deal ? `${inv.deal.code} ${inv.deal.name}` : null}</Detail>
              <Detail label="Quantity">{inv.quantity !== null ? qtyLabel(inv.quantity, inv.unit) : null}</Detail>
              <Detail label="Purchase / current price">{inv.purchase_price !== null || inv.current_price !== null ? `${inv.purchase_price ?? '-'} / ${inv.current_price ?? '-'}` : null}</Detail>
              <Detail label="Gold / silver profit">{inv.performance.metal_profit !== null ? <Money v={inv.performance.metal_profit} signed /> : null}</Detail>
              <Detail label="Purity">{inv.purity}</Detail>
              <Detail label="Storage">{inv.storage_location}</Detail>
              <Detail label="Company / startup">{inv.startup_name}</Detail>
              <Detail label="Ownership">{inv.equity_pct !== null ? `${inv.equity_pct}%` : null}</Detail>
              <div className="sm:col-span-2"><Detail label="Description"><span className="whitespace-pre-wrap">{inv.description}</span></Detail></div>
              <div className="sm:col-span-2"><Detail label="Notes"><span className="whitespace-pre-wrap">{inv.notes}</span></Detail></div>
            </dl>
            <section className="space-y-2">
              <h3 className="font-heading text-sm font-semibold text-tertiary-900">Realisations</h3>
              {inv.realisations.length === 0 ? <Empty>Nothing sold or redeemed yet.</Empty> : (
                <ul className="divide-y rounded-xl border bg-white text-sm">
                  {inv.realisations.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>{dateLabel(r.realised_date)} · received <Money v={r.amount_received} /> for cost <Money v={r.cost_released} />{r.notes && <span className="text-tertiary-400"> · {r.notes}</span>}</span>
                      <span className="flex items-center gap-2"><Money v={r.amount_received - r.cost_released} signed className="font-medium" />{axCan(me, 'override') && <button type="button" title="Undo" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => undo(r)}><Undo2 className="h-4 w-4" /></button>}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <AcconcyDocuments ownerType="investment" ownerId={inv.id} />
          </div>
        )}
      </Drawer>
      <Modal open={Boolean(realise)} onClose={() => setRealise(null)} wide title="Record sale / redemption">
        {realise && inv && <RealiseForm inv={inv} saving={saving} onSubmit={doRealise} onCancel={() => setRealise(null)} />}
      </Modal>
    </div>
  );
}

export default function AcconcyInvestmentsPage() {
  const { me, loading } = useAcconcy();
  const [tab, setTab] = useState('investments');
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!axCan(me, 'investments')) return <Navigate to="/acconcy" replace />;
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={[{ key: 'investments', label: 'Investments' }, { key: 'assets', label: 'Assets' }]} value={tab} onChange={setTab} />
      {tab === 'investments' ? <InvestmentsTab me={me} /> : <AssetsTab me={me} />}
    </div>
  );
}
