import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Plus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { gulatiApi, gulatiError } from '../../lib/gulati/api.js';
import { useGulati, gxCan } from '../../lib/gulati/useGulati.js';
import { DEAL_STATUSES, DEAL_STATUS_META, pctLabel, qtyLabel, useMasters } from '../../lib/gulati/meta.js';
import { usePickers } from '../../lib/gulati/pickers.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import DealForm from '../../components/gulati/DealForm.jsx';
import { Kpi, Money } from '../../components/gulati/ui.jsx';

const FLAGS = [
  { value: 'delayed', label: 'Delayed' },
  { value: 'pending_sourcing', label: 'Pending sourcing' },
  { value: 'pending_supply', label: 'Pending supply' },
  { value: 'vendor_due', label: 'Vendor payment due' },
  { value: 'client_due', label: 'Client payment due' },
];
const BLANK = { status: 'active', trading_type: '', party_id: '', vendor_id: '', assignee_id: '', location: '', flag: '', from: '', to: '' };

export default function GulatiDealsPage() {
  const { me, loading } = useGulati();
  const { pushError, pushSuccess } = useAlerts();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const masters = useMasters();
  const pickers = usePickers();
  const [f, setF] = useState(() => ({ ...BLANK, ...Object.fromEntries(['status', 'trading_type', 'party_id', 'vendor_id', 'flag'].map((k) => [k, params.get(k)]).filter(([, v]) => v)) }));
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [rows, setRows] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setFetching(true);
    try {
      const query = Object.fromEntries(Object.entries({ ...f, q: dq }).filter(([k, v]) => v && !(k === 'status' && v === 'all')));
      const list = await gulatiApi.deals(query);
      if (id === reqId.current) setRows(list);
    } catch (e) {
      if (id === reqId.current) pushError(gulatiError(e, 'Could not load deals'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [f, dq, pushError]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!gxCan(me, 'deals')) return <Navigate to="/gulati" replace />;
  const canEdit = gxCan(me, 'dealsEdit');
  const showMoney = gxCan(me, 'overview') || me.role === 'admin' || me.role === 'manager';
  const sum = (key) => rows.reduce((a, d) => a + (d.summary[key] || 0), 0);

  async function create(body) {
    setSaving(true);
    try {
      const deal = await gulatiApi.createDeal(body);
      pushSuccess(`${deal.code} created`);
      navigate(`/gulati/deals/${deal.id}`);
    } catch (e) {
      pushError(gulatiError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'name', header: 'Deal', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code} · {r.trading_type_label}</span></span> },
    { key: 'status', header: 'Status', render: (r) => <span className="inline-flex items-center gap-1.5"><Pill tone={DEAL_STATUS_META[r.status]?.tone}>{DEAL_STATUS_META[r.status]?.label || r.status}</Pill>{r.summary.delayed && <span title="Past its expected completion" className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-xs text-red-700"><AlertTriangle className="h-3 w-3" />Delayed</span>}</span> },
    { key: 'client', header: 'Client', render: (r) => r.party?.name || '-' },
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor?.name || '-' },
    { key: 'qty', header: 'Ordered / supplied', render: (r) => <span className="text-xs">{qtyLabel(r.summary.quantities.ordered, r.unit)} / {qtyLabel(r.summary.quantities.supplied)}</span> },
    ...(showMoney ? [
      { key: 'sales', header: 'Sales', render: (r) => <Money v={r.summary.sales_revenue} /> },
      { key: 'gross', header: 'Gross profit', render: (r) => <Money v={r.summary.gross_profit} signed /> },
      { key: 'net', header: 'Net profit', render: (r) => <span className="inline-flex flex-col"><Money v={r.summary.net_profit} signed className="font-semibold" /><span className="text-[11px] text-tertiary-400">{pctLabel(r.summary.net_margin_pct)}</span></span> },
    ] : []),
    { key: 'dur', header: 'Duration', render: (r) => (r.summary.duration_days !== null ? `${r.summary.duration_days} days` : '-') },
  ];
  const set = (k, v) => setF((c) => ({ ...c, [k]: v }));

  return (
    <div className="mt-4 space-y-4">
      {showMoney && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Deals" value={rows.length} hint="in this view" />
          <Kpi label="Sales" value={<Money v={sum('sales_revenue')} />} />
          <Kpi label="Purchases" value={<Money v={sum('purchase_cost')} />} />
          <Kpi label="Net profit" value={<Money v={sum('net_profit')} signed />} tone="gx-copper" />
          <Kpi label="Receivable / payable" value={<><Money v={sum('client_outstanding')} /> / <Money v={sum('vendor_outstanding')} /></>} />
        </div>
      )}
      <FilterBar
        q={q}
        onQ={setQ}
        searchPlaceholder="Search deal, code, product, location..."
        fields={[
          { key: 'status', label: 'Status', type: 'select', any: 'Active deals', options: [{ value: 'all', label: 'All deals' }, { value: 'done', label: 'Completed or cancelled' }, ...DEAL_STATUSES.map((s) => ({ value: s.value, label: s.label }))] },
          { key: 'trading_type', label: 'Trading type', type: 'select', any: 'Any type', options: masters.types.map((t) => ({ value: t.key, label: t.label })) },
          { key: 'party_id', label: 'Client', type: 'select', any: 'Any client', options: pickers.clients },
          { key: 'vendor_id', label: 'Vendor', type: 'select', any: 'Any vendor', options: pickers.vendors },
          { key: 'assignee_id', label: 'Employee', type: 'select', any: 'Any employee', options: pickers.employees },
          { key: 'flag', label: 'Attention', type: 'select', any: 'Everything', options: FLAGS },
          { key: 'location', label: 'Location', type: 'text', placeholder: 'City or place' },
          { key: 'from', label: 'Started from', type: 'date' },
          { key: 'to', label: 'Started to', type: 'date' },
        ]}
        values={f}
        defaults={{ status: 'active' }}
        onChange={set}
        onReset={() => { setF(BLANK); setQ(''); }}
      >
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New deal</button>}
      </FilterBar>
      <DataTable columns={columns} rows={rows} loading={fetching && rows.length === 0} emptyLabel="No deals match. Win a lead and convert it, or create a deal directly." onRowClick={(r) => navigate(`/gulati/deals/${r.id}`)} maxHeight="62vh" />
      <Drawer open={creating} onClose={() => setCreating(false)} size="xl" tone="create" title="New trading deal">
        {creating && <DealForm pickers={pickers} masters={masters} saving={saving} onSubmit={create} onCancel={() => setCreating(false)} />}
      </Drawer>
    </div>
  );
}
