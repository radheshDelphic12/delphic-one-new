import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Plus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import { DEAL_STATUSES, DEAL_STATUS_META, SERVICE_META, SERVICE_TYPES, pctLabel } from '../../lib/acconcy/meta.js';
import { usePickers } from '../../lib/acconcy/pickers.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import DealForm from '../../components/acconcy/DealForm.jsx';
import { Kpi, Money } from '../../components/acconcy/ui.jsx';

const FLAGS = [
  { value: 'delayed', label: 'Delayed' },
  { value: 'loss_making', label: 'Loss making' },
];
const BLANK = { status: 'open', service_type: '', party_id: '', vendor_id: '', assignee_id: '', location: '', flag: '', from: '', to: '' };

export default function AcconcyDealsPage() {
  const { me, loading } = useAcconcy();
  const { pushError, pushSuccess } = useAlerts();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const pickers = usePickers();
  const [f, setF] = useState(() => ({ ...BLANK, ...Object.fromEntries(['status', 'service_type', 'party_id', 'vendor_id', 'assignee_id', 'flag'].map((k) => [k, params.get(k)]).filter(([, v]) => v)) }));
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
      const list = await acconcyApi.deals(query);
      if (id === reqId.current) setRows(list);
    } catch (e) {
      if (id === reqId.current) pushError(acconcyError(e, 'Could not load deals'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [f, dq, pushError]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!axCan(me, 'deals')) return <Navigate to="/acconcy" replace />;
  const canEdit = axCan(me, 'dealsEdit');
  const showMoney = axCan(me, 'overview');
  const sum = (key) => rows.reduce((a, d) => a + (d.summary[key] || 0), 0);

  async function create(body) {
    setSaving(true);
    try {
      const deal = await acconcyApi.createDeal(body);
      pushSuccess(`${deal.code} created`);
      navigate(`/acconcy/deals/${deal.id}`);
    } catch (e) {
      pushError(acconcyError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'name', header: 'Deal', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}</span></span> },
    { key: 'service', header: 'Service', render: (r) => <Pill tone={SERVICE_META[r.service_type]?.tone || 'gray'}>{SERVICE_META[r.service_type]?.short || r.service_type}</Pill> },
    { key: 'status', header: 'Status', render: (r) => <span className="inline-flex items-center gap-1.5"><Pill tone={DEAL_STATUS_META[r.status]?.tone}>{DEAL_STATUS_META[r.status]?.label || r.status}</Pill>{r.summary.delayed && <span title="Past its expected end" className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-xs text-red-700"><AlertTriangle className="h-3 w-3" />Delayed</span>}</span> },
    { key: 'client', header: 'Client', render: (r) => r.party?.name || '-' },
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor?.name || '-' },
    { key: 'assignee', header: 'Assigned', render: (r) => [r.assignee?.name, r.contractor?.name].filter(Boolean).join(' · ') || '-' },
    { key: 'amount', header: 'Deal amount', render: (r) => (r.deal_amount !== null ? <Money v={r.deal_amount} /> : '-') },
    ...(showMoney ? [
      { key: 'rev', header: 'Revenue', render: (r) => <Money v={r.summary.revenue} /> },
      { key: 'exp', header: 'Expenses', render: (r) => <Money v={r.summary.expense} /> },
      { key: 'profit', header: 'Profit', render: (r) => <span className="inline-flex flex-col"><Money v={r.summary.profit} signed className="font-semibold" /><span className="text-[11px] text-tertiary-400">{pctLabel(r.summary.margin_pct)}</span></span> },
    ] : []),
    { key: 'dur', header: 'Duration', render: (r) => (r.summary.duration_days !== null ? `${r.summary.duration_days} days` : '-') },
  ];
  const set = (k, v) => setF((c) => ({ ...c, [k]: v }));

  return (
    <div className="mt-4 space-y-4">
      {showMoney && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Deals" value={rows.length} hint="in this view" />
          <Kpi label="Deal amount" value={<Money v={rows.reduce((a, d) => a + (d.deal_amount || 0), 0)} />} />
          <Kpi label="Revenue" value={<Money v={sum('revenue')} />} />
          <Kpi label="Expenses" value={<Money v={sum('expense')} />} />
          <Kpi label="Profit" value={<Money v={sum('profit')} signed />} tone="ax-gold" />
        </div>
      )}
      <FilterBar
        q={q}
        onQ={setQ}
        searchPlaceholder="Search deal, code, location..."
        fields={[
          { key: 'status', label: 'Status', type: 'select', any: 'Open deals', options: [{ value: 'all', label: 'All deals' }, { value: 'done', label: 'Completed or cancelled' }, ...DEAL_STATUSES.map((s) => ({ value: s.value, label: s.label }))] },
          { key: 'service_type', label: 'Service type', type: 'select', any: 'Any service', options: SERVICE_TYPES.map((t) => ({ value: t.value, label: t.label })) },
          { key: 'party_id', label: 'Client', type: 'select', any: 'Any client', options: pickers.clients },
          { key: 'vendor_id', label: 'Vendor', type: 'select', any: 'Any vendor', options: pickers.vendors },
          { key: 'assignee_id', label: 'Employee / contractor', type: 'select', any: 'Anyone', options: [...pickers.employees, ...pickers.contractors] },
          { key: 'flag', label: 'Attention', type: 'select', any: 'Everything', options: FLAGS },
          { key: 'location', label: 'Location', type: 'text', placeholder: 'City or place' },
          { key: 'from', label: 'Started from', type: 'date' },
          { key: 'to', label: 'Started to', type: 'date' },
        ]}
        values={f}
        defaults={{ status: 'open' }}
        onChange={set}
        onReset={() => { setF(BLANK); setQ(''); }}
      >
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New deal</button>}
      </FilterBar>
      <DataTable columns={columns} rows={rows} loading={fetching && rows.length === 0} emptyLabel="No deals match. Win a lead and convert it, or create a deal directly." onRowClick={(r) => navigate(`/acconcy/deals/${r.id}`)} maxHeight="62vh" />
      <Drawer open={creating} onClose={() => setCreating(false)} size="xl" tone="create" title="New deal">
        {creating && <DealForm pickers={pickers} saving={saving} onSubmit={create} onCancel={() => setCreating(false)} />}
      </Drawer>
    </div>
  );
}
