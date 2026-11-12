import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { fxApi, foundationError } from '../../lib/foundation/api.js';
import { fxCan, useFoundation } from '../../lib/foundation/useFoundation.js';
import { useFxPickers } from '../../lib/foundation/pickers.js';
import { CAMPAIGN_STATUSES, FLAG_META, STATUS_META, pctLabel } from '../../lib/foundation/meta.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import CampaignForm from '../../components/foundation/CampaignForm.jsx';
import { Money } from '../../components/foundation/ui.jsx';

const BLANK = { q: '', category_id: '', status: '', state: '', city: '', manager_id: '', budget_min: '', budget_max: '', attention: '', sort: 'created', dir: 'desc' };
const SORTS = [['created', 'Newest'], ['name', 'Name'], ['status', 'Status'], ['budget', 'Budget'], ['spent', 'Spent'], ['remaining', 'Remaining'], ['end', 'End date']].map(([value, label]) => ({ value, label }));

export default function FoundationCampaignsPage() {
  const { me, loading } = useFoundation();
  const { pushError, pushSuccess } = useAlerts();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const pickers = useFxPickers();
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [drawer, setDrawer] = useState(params.get('new') === '1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => { setF((c) => ({ ...c, [k]: v })); setPage(1); };

  const load = useCallback(() => fxApi.campaigns({ ...f, page, limit: 15 }).then((r) => { setRows(r.data); setPagination(r.pagination); }, (e) => pushError(foundationError(e, 'Could not load campaigns'), 'Load failed')), [f, page, pushError]);
  useEffect(() => { if (me) load(); }, [me, load]);
  useEffect(() => { if (params.get('new') === '1') setDrawer(true); }, [params]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !fxCan(me, 'campaigns')) return <Navigate to="/foundation" replace />;
  const canEdit = fxCan(me, 'campaignsEdit');
  const closeDrawer = () => { setDrawer(false); setError(''); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } };

  async function create(body) {
    setSaving(true);
    setError('');
    try {
      const c = await fxApi.createCampaign(body);
      pushSuccess(`${c.code} created`);
      closeDrawer();
      navigate(`/foundation/campaigns/${c.id}`);
    } catch (e) {
      setError(foundationError(e, 'Could not create the campaign'));
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'name', header: 'Campaign', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}{r.category ? ` · ${r.category.name}` : ''}</span></span> },
    { key: 'location', header: 'Location', render: (r) => <span>{[r.city, r.state].filter(Boolean).join(', ') || '-'}{r.area && <span className="block text-xs text-tertiary-500">{r.area}</span>}</span> },
    { key: 'status', header: 'Status', render: (r) => (
      <span className="flex flex-wrap items-center gap-1">
        <Pill tone={STATUS_META[r.status]?.tone}>{STATUS_META[r.status]?.label}</Pill>
        {r.flags.filter((x) => x.severity !== 'info').slice(0, 1).map((x) => <Pill key={x.type} tone={FLAG_META[x.type]?.tone}>{FLAG_META[x.type]?.label}</Pill>)}
      </span>
    ) },
    { key: 'budget', header: 'Allocated', render: (r) => <Money v={r.metrics.allocated_budget} /> },
    { key: 'spent', header: 'Actual spend', render: (r) => <span><Money v={r.metrics.actual_expenditure} /><span className="block text-xs text-tertiary-400">{pctLabel(r.metrics.utilization_pct)} used</span></span> },
    { key: 'remaining', header: 'Remaining', render: (r) => (r.metrics.overspend > 0 ? <span className="text-red-600">Over by <Money v={r.metrics.overspend} /></span> : <Money v={r.metrics.remaining_allocated} />) },
    { key: 'end', header: 'Planned end', render: (r) => r.planned_end || '-' },
  ];

  return (
    <div className="mt-4 space-y-4">
      <FilterBar
        q={f.q}
        onQ={(v) => set('q', v)}
        searchPlaceholder="Search name, code, city, area..."
        fields={[
          { key: 'category_id', label: 'Initiative / category', type: 'select', any: 'All', options: pickers.initiatives },
          { key: 'status', label: 'Status', type: 'select', any: 'All', options: CAMPAIGN_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
          { key: 'state', label: 'State', type: 'text' },
          { key: 'city', label: 'City', type: 'text' },
          { key: 'manager_id', label: 'Campaign manager', type: 'select', any: 'Anyone', options: pickers.managers },
          { key: 'budget_min', label: 'Budget from (₹)', type: 'number', min: 0 },
          { key: 'budget_max', label: 'Budget up to (₹)', type: 'number', min: 0 },
          { key: 'attention', label: 'Needs attention', type: 'select', any: 'All', options: [{ value: 'true', label: 'Only those' }] },
          { key: 'sort', label: 'Sort by', type: 'select', any: 'Newest', options: SORTS.filter((s) => s.value !== 'created') },
          { key: 'dir', label: 'Order', type: 'select', any: 'Descending', options: [{ value: 'asc', label: 'Ascending' }] },
        ]}
        values={f}
        defaults={BLANK}
        onChange={set}
        onReset={() => { setF(BLANK); setPage(1); }}
      >
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer(true)}><Plus className="h-4 w-4" />New campaign</button>}
      </FilterBar>

      <DataTable columns={columns} rows={rows || []} loading={!rows} emptyLabel="No campaigns yet. Create the first one to start planning budgets and tracking spending." onRowClick={(r) => navigate(`/foundation/campaigns/${r.id}`)} maxHeight="64vh" />
      <div className="flex items-center justify-between text-xs text-tertiary-500">
        <span>{pagination.total} campaign{pagination.total === 1 ? '' : 's'}</span>
        <span className="flex items-center gap-2">
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {pagination.page} of {pagination.pages}</span>
          <button type="button" className="btn-secondary" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </span>
      </div>
      <p className="text-[11px] text-tertiary-500">Need a new initiative such as Disaster Relief? Add it under <Link to="/foundation/initiatives" className="font-medium text-primary-700 hover:underline">Initiatives &amp; Categories</Link>.</p>

      <Drawer open={drawer} onClose={closeDrawer} size="xl" tone="create" title="New campaign">
        {drawer && <CampaignForm initiatives={pickers.initiatives} managers={pickers.managers} saving={saving} error={error} onSubmit={create} onCancel={closeDrawer} />}
      </Drawer>
    </div>
  );
}
