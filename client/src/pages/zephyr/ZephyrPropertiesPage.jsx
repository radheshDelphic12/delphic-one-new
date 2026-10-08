import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { PROPERTY_STATUSES, PROPERTY_STATUS_META, PROPERTY_TYPES, PROPERTY_TYPE_LABEL } from '../../lib/zephyr/propertyMeta.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { compact } from '../../lib/format.js';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { Section, inputCls, labelCls, toBody, useDebounced, dayOf, Empty } from '../../components/zephyr/formKit.jsx';

const EMPTY = {
  name: '', property_type: 'other', address: '', city: '', state: '', location: '', area_value: '', area_unit: 'sqft', current_use: '', status: 'active', notes: '',
  purchase_date: '', purchase_cost: '', brokerage: '', documentation_cost: '', registration_cost: '', construction_cost: '', renovation_cost: '', other_cost: '',
};
const COST_KEYS = ['purchase_cost', 'brokerage', 'documentation_cost', 'registration_cost', 'construction_cost', 'renovation_cost', 'other_cost'];

/** Create / edit form for a property. The acquisition costs are only shown (and sent) for admin and finance. */
export function PropertyForm({ initial, canFinance, saving, onSubmit, onCancel }) {
  const [v, setV] = useState(() => ({
    ...EMPTY,
    ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, initial?.[k] ?? EMPTY[k]])),
    purchase_date: dayOf(initial?.purchase_date),
  }));
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  const invested = COST_KEYS.reduce((a, k) => a + (Number(v[k]) || 0), 0);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = toBody(v, { numbers: ['area_value', ...COST_KEYS] });
        if (!canFinance) for (const k of [...COST_KEYS, 'purchase_date']) delete body[k];
        else for (const k of COST_KEYS) body[k] = body[k] ?? 0;
        body.area_unit = v.area_unit || 'sqft';
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <Section title="Identification">
        <label className={`${labelCls} sm:col-span-2`}>Property name<input className={inputCls} value={v.name} onChange={set('name')} required maxLength={200} autoFocus placeholder="e.g. XYZ Complex" /></label>
        <label className={labelCls}>Property type<select className={inputCls} value={v.property_type} onChange={set('property_type')}>{PROPERTY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        <label className={labelCls}>Status<select className={inputCls} value={v.status} onChange={set('status')}>{PROPERTY_STATUSES.filter((s) => s.value !== 'sold').map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label className={`${labelCls} sm:col-span-2`}>Address<input className={inputCls} value={v.address ?? ''} onChange={set('address')} maxLength={500} /></label>
        <label className={labelCls}>City<input className={inputCls} value={v.city ?? ''} onChange={set('city')} maxLength={120} /></label>
        <label className={labelCls}>State<input className={inputCls} value={v.state ?? ''} onChange={set('state')} maxLength={120} /></label>
        <label className={labelCls}>Location / landmark<input className={inputCls} value={v.location ?? ''} onChange={set('location')} maxLength={200} /></label>
        <label className={labelCls}>Current use<input className={inputCls} value={v.current_use ?? ''} onChange={set('current_use')} maxLength={120} placeholder="Rental, self use, under development…" /></label>
        <label className={labelCls}>Size / area<input type="number" min="0" className={inputCls} value={v.area_value ?? ''} onChange={set('area_value')} /></label>
        <label className={labelCls}>Area unit<select className={inputCls} value={v.area_unit} onChange={set('area_unit')}>{['sqft', 'sqm', 'acre', 'bigha', 'gaj'].map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
      </Section>

      {canFinance && (
        <Section title="Acquisition and investment" hint="Total invested is the sum of every cost below. Costs can be updated as the property is developed.">
          <label className={labelCls}>Purchase / investment date<input type="date" className={inputCls} value={v.purchase_date} onChange={set('purchase_date')} /></label>
          <label className={labelCls}>Purchase cost (₹)<input type="number" min="0" className={inputCls} value={v.purchase_cost ?? ''} onChange={set('purchase_cost')} /></label>
          <label className={labelCls}>Brokerage (₹)<input type="number" min="0" className={inputCls} value={v.brokerage ?? ''} onChange={set('brokerage')} /></label>
          <label className={labelCls}>Documentation cost (₹)<input type="number" min="0" className={inputCls} value={v.documentation_cost ?? ''} onChange={set('documentation_cost')} /></label>
          <label className={labelCls}>Registration cost (₹)<input type="number" min="0" className={inputCls} value={v.registration_cost ?? ''} onChange={set('registration_cost')} /></label>
          <label className={labelCls}>Construction cost (₹)<input type="number" min="0" className={inputCls} value={v.construction_cost ?? ''} onChange={set('construction_cost')} /></label>
          <label className={labelCls}>Renovation cost (₹)<input type="number" min="0" className={inputCls} value={v.renovation_cost ?? ''} onChange={set('renovation_cost')} /></label>
          <label className={labelCls}>Other acquisition costs (₹)<input type="number" min="0" className={inputCls} value={v.other_cost ?? ''} onChange={set('other_cost')} /></label>
          <div className="rounded-xl bg-primary-50 px-3 py-2 text-sm text-primary-900 sm:col-span-2">Total invested: <strong className="tabular-nums">{rupees(invested)}</strong></div>
        </Section>
      )}

      <Section title="Notes">
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={3} value={v.notes ?? ''} onChange={set('notes')} maxLength={4000} /></label>
      </Section>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save property'}</button>
      </div>
    </form>
  );
}

const UnitsPill = ({ units }) => {
  const total = units?.total || 0;
  if (total === 0) return <span className="text-tertiary-400">No units</span>;
  return <span className="text-sm text-tertiary-700">{total} units · {units.rented || 0} rented{units.sold ? ` · ${units.sold} sold` : ''}</span>;
};

export default function ZephyrPropertiesPage() {
  const { me, loading } = useZephyr();
  const { pushError, pushSuccess } = useAlerts();
  const navigate = useNavigate();
  const [tab, setTab] = useState('portfolio');
  const [filters, setFilters] = useState({ property_type: '', status: '', city: '', current_use: '', tenant: '', min_valuation: '', max_valuation: '' });
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const dFilters = useDebounced(JSON.stringify(filters), 300);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [sales, setSales] = useState(null);
  const [fetching, setFetching] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setFetching(true);
    const f = JSON.parse(dFilters);
    const params = { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), ...(dq ? { q: dq } : {}) };
    try {
      const [list, sum] = await Promise.all([zephyrApi.properties(params), zephyrApi.propertySummary()]);
      if (id === reqId.current) {
        setRows(list);
        setSummary(sum);
      }
    } catch (e) {
      if (id === reqId.current) pushError(zephyrError(e, 'Could not load properties'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [dFilters, dq, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  const canTrade = zxCan(me, 'trading');
  useEffect(() => {
    if (tab === 'sales' && canTrade) zephyrApi.sales().then(setSales, (e) => pushError(zephyrError(e), 'Could not load sales'));
  }, [tab, canTrade, pushError]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'properties')) return <Navigate to="/zephyr" replace />;
  const canEdit = zxCan(me, 'propertiesEdit');
  const canFinance = zxCan(me, 'propertyFinance');

  async function create(values) {
    setSaving(true);
    try {
      const saved = await zephyrApi.createProperty(values);
      pushSuccess(`${saved.code} added`);
      setCreating(false);
      navigate(`/zephyr/properties/${saved.id}`);
    } catch (e) {
      pushError(zephyrError(e, 'Could not add the property'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'code', header: 'ID', render: (r) => <span className="font-mono text-xs text-tertiary-500">{r.code}</span> },
    { key: 'name', header: 'Property', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{[r.city, r.state].filter(Boolean).join(', ')}</span></span> },
    { key: 'type', header: 'Type', render: (r) => PROPERTY_TYPE_LABEL[r.property_type] },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={PROPERTY_STATUS_META[r.status]?.tone}>{PROPERTY_STATUS_META[r.status]?.label}</Pill> },
    { key: 'use', header: 'Current use', render: (r) => r.current_use || '—' },
    { key: 'units', header: 'Units', render: (r) => <UnitsPill units={r.units} /> },
    ...(canFinance
      ? [
          { key: 'invested', header: 'Invested', render: (r) => <span className="tabular-nums">{rupees(r.total_invested)}</span> },
          { key: 'valuation', header: 'Valuation', render: (r) => (r.valuation == null ? '—' : <span className="tabular-nums">{rupees(r.valuation)}</span>) },
          { key: 'app', header: 'Appreciation', render: (r) => (r.appreciation == null ? '—' : <span className={`tabular-nums ${r.appreciation < 0 ? 'text-red-600' : 'text-green-700'}`}>{rupees(r.appreciation)} ({r.appreciation_pct ?? '—'}%)</span>) },
        ]
      : []),
  ];
  const filtered = Object.values(filters).some(Boolean) || Boolean(dq);
  const tabs = [{ key: 'portfolio', label: 'Portfolio' }, ...(canTrade ? [{ key: 'sales', label: 'Sales (property trading)' }] : [])];

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Properties" value={summary?.properties ?? '—'} />
        <StatCard label="Units" value={summary?.units ?? '—'} hint={`${summary?.occupied ?? 0} rented · ${summary?.vacant ?? 0} vacant`} />
        <StatCard label="Sold units" value={summary?.units_by_status?.sold ?? 0} hint={`${(summary?.units_by_status?.under_construction ?? 0) + (summary?.units_by_status?.under_renovation ?? 0)} under works`} />
        {canFinance && <StatCard label="Total invested" value={`₹${compact(summary?.total_invested)}`} hint="properties not yet sold" />}
        {canFinance && <StatCard label="Valuation (manual)" value={summary?.valued_properties ? `₹${compact(summary.valuation)}` : '—'} hint={summary?.appreciation == null ? 'no valuation entered' : `${summary.appreciation >= 0 ? '+' : '−'}₹${compact(Math.abs(summary.appreciation))} unrealized`} />}
        {canFinance && <StatCard label="Loans / monthly EMI" value={`₹${compact(summary?.outstanding_loans)}`} hint={`EMI ₹${compact(summary?.monthly_emi)} per month`} />}
      </div>

      {tabs.length > 1 && <SectionTabs tabs={tabs} value={tab} onChange={setTab} />}

      {tab === 'portfolio' && (
        <>
          <FilterBar
            q={q}
            onQ={setQ}
            searchPlaceholder="Search name, ID, address…"
            searchLabel="Search properties"
            fields={[
              { key: 'property_type', label: 'Property type', type: 'select', any: 'All types', options: PROPERTY_TYPES.map((t) => ({ value: t.value, label: t.label })) },
              { key: 'status', label: 'Status', type: 'select', any: 'All statuses', options: PROPERTY_STATUSES.map((x) => ({ value: x.value, label: x.label })) },
              { key: 'city', label: 'City', placeholder: 'Any city' },
              { key: 'current_use', label: 'Current use', placeholder: 'e.g. Shop, Godown' },
              { key: 'tenant', label: 'Tenant', placeholder: 'Tenant name' },
              { key: 'min_valuation', label: 'Min valuation ₹', type: 'number', min: 0, hidden: !canFinance },
              { key: 'max_valuation', label: 'Max valuation ₹', type: 'number', min: 0, hidden: !canFinance },
            ]}
            values={filters}
            defaults={{}}
            onChange={(key, value) => setFilters((f) => ({ ...f, [key]: value }))}
            onReset={() => { setFilters({ property_type: '', status: '', city: '', current_use: '', tenant: '', min_valuation: '', max_valuation: '' }); setQ(''); }}
          >
            {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Add property</button>}
          </FilterBar>
          <DataTable columns={columns} rows={rows} loading={fetching && rows.length === 0} emptyLabel={filtered ? 'No properties match these filters' : 'No properties yet. Add the first one.'} onRowClick={(r) => navigate(`/zephyr/properties/${r.id}`)} maxHeight="62vh" />
        </>
      )}

      {tab === 'sales' && canTrade && (
        <div className="space-y-3">
          {sales && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Sold value" value={`₹${compact(sales.totals.sale_value)}`} hint={`${sales.count} sale${sales.count === 1 ? '' : 's'}`} />
              <StatCard label="Cost of properties sold" value={`₹${compact(sales.totals.cost_basis)}`} />
              <StatCard label="Selling costs" value={`₹${compact(sales.totals.selling_costs)}`} />
              <StatCard label="Realized profit" value={`₹${compact(sales.totals.realized_profit)}`} accent={sales.totals.realized_profit > 0} hint="booked in the P&L" />
            </div>
          )}
          {!sales ? <Empty>Loading…</Empty> : sales.data.length === 0 ? <Empty>No property has been sold yet. Sell a property or a unit from its detail page.</Empty> : (
            <DataTable
              columns={[
                { key: 'date', header: 'Date', render: (r) => r.sale_date },
                { key: 'p', header: 'Property / unit', render: (r) => <span className="font-medium text-tertiary-900">{r.property?.name}{r.unit ? ` · ${r.unit.name}` : ''}</span> },
                { key: 'buyer', header: 'Buyer', render: (r) => r.buyer?.name || '—' },
                { key: 'cost', header: 'Cost basis', render: (r) => rupees(r.cost_basis) },
                { key: 'sale', header: 'Sale value', render: (r) => rupees(r.sale_value) },
                { key: 'sc', header: 'Selling costs', render: (r) => rupees(r.selling_costs) },
                { key: 'profit', header: 'Realized profit', render: (r) => <span className={r.realized_profit < 0 ? 'text-red-600' : 'font-medium text-green-700'}>{rupees(r.realized_profit)}</span> },
                { key: 'hold', header: 'Held', render: (r) => (r.holding_days == null ? '—' : `${r.holding_days} days`) },
              ]}
              rows={sales.data}
              onRowClick={(r) => navigate(`/zephyr/properties/${r.property_id}`)}
              maxHeight="60vh"
            />
          )}
        </div>
      )}

      <Drawer open={creating} onClose={() => setCreating(false)} size="xl" tone="create" title="Add property">
        {creating && <PropertyForm canFinance={canFinance} saving={saving} onSubmit={create} onCancel={() => setCreating(false)} />}
      </Drawer>
    </div>
  );
}
