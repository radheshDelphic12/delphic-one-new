import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Mountain, Plus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { vtApi, valterraError } from '../../lib/valterra/api.js';
import { useValterra, vtCan } from '../../lib/valterra/useValterra.js';
import { useVtPickers } from '../../lib/valterra/pickers.js';
import { SITE_STATUSES, SITE_STATUS_META } from '../../lib/valterra/meta.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { Area, DateInput, Num, Select, Text, dayOf, toBody } from '../../components/valterra/ui.jsx';

/** The site form: create and edit use the same fields. Closing a site (status Closed) keeps all its history. */
export function SiteForm({ initial, pickers, onSaved, onCancel, canEdit }) {
  const editing = Boolean(initial);
  const { pushSuccess } = useAlerts();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [v, setV] = useState(() => ({
    name: initial?.name || '', code: initial?.code || '', location: initial?.location || '', state: initial?.state || '', district: initial?.district || '', country: initial?.country || 'India',
    latitude: initial?.latitude ?? '', longitude: initial?.longitude ?? '', mining_type_id: initial?.mining_type_id || '', material_id: initial?.material_id || '',
    additional: (initial?.additional_materials || []).join(', '), description: initial?.description || '', status: initial?.status || 'active',
    start_date: dayOf(initial?.start_date), expected_closure_date: dayOf(initial?.expected_closure_date), manager_name: initial?.manager_name || '', notes: initial?.notes || '',
  }));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const { additional, ...rest } = v;
    const body = toBody(rest, { numbers: ['latitude', 'longitude'] });
    body.additional_materials = additional.split(',').map((x) => x.trim()).filter(Boolean);
    if (!body.code) delete body.code;
    try {
      const saved = editing ? await vtApi.updateSite(initial.id, body) : await vtApi.createSite(body);
      pushSuccess(editing ? 'Site updated' : 'Mining site created');
      onSaved(saved);
    } catch (err) { setError(valterraError(err, 'Could not save the site')); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Text label="Site name" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} placeholder="e.g. Kalyanpur Granite Quarry" />
        <Text label="Site code" value={v.code} onChange={set('code')} maxLength={30} placeholder={editing ? '' : 'Leave blank to generate'} />
        <Select label="Status" value={v.status} onChange={set('status')} options={SITE_STATUSES.map((s) => ({ value: s.value, label: s.value === 'closed' ? 'Closed - keeps history, takes no new records' : s.label }))} />
        <Select label="Mining type" value={v.mining_type_id} onChange={set('mining_type_id')} options={pickers.miningTypes} blank="Not set" />
        <Select label="Primary material (metal / mineral / stone)" value={v.material_id} onChange={set('material_id')} options={pickers.materials} blank="Not set" />
        <Text label="Additional materials" className="sm:col-span-2" value={v.additional} onChange={set('additional')} placeholder="Comma separated, e.g. Aggregate, Dust" />
        <Text label="Location" className="sm:col-span-2" value={v.location} onChange={set('location')} maxLength={300} placeholder="Village / area" />
        <Text label="District" value={v.district} onChange={set('district')} maxLength={120} />
        <Text label="State" value={v.state} onChange={set('state')} maxLength={120} />
        <Text label="Country" value={v.country} onChange={set('country')} maxLength={120} />
        <Text label="Site manager / responsible person" value={v.manager_name} onChange={set('manager_name')} maxLength={200} />
        <Num label="Latitude" value={v.latitude} onChange={set('latitude')} min="-90" max="90" />
        <Num label="Longitude" value={v.longitude} onChange={set('longitude')} min="-180" max="180" />
        <DateInput label="Site start date" value={v.start_date} onChange={set('start_date')} />
        <DateInput label="Expected closure date" value={v.expected_closure_date} onChange={set('expected_closure_date')} min={v.start_date} />
        <Area label="What is mined / description" className="sm:col-span-2" rows={3} value={v.description} onChange={set('description')} maxLength={4000} />
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={set('notes')} maxLength={4000} />
      </div>
      {v.status === 'closed' && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">A closed site is archived: every past investment, transaction, projection and report stays readable, but no new record can be added to it. Reopen it by changing the status.</p>}
      {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        {canEdit && <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Create site'}</button>}
      </div>
    </form>
  );
}

export default function ValterraSitesPage() {
  const { me, loading } = useValterra();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const pickers = useVtPickers({ people: false });
  const [f, setF] = useState({ q: '', status: '', mining_type_id: '', material_id: '', state: '', include_closed: 'false' });
  const [rows, setRows] = useState(null);
  const [drawer, setDrawer] = useState({ open: params.get('new') === '1', site: null });
  const query = useMemo(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), [f]);
  const load = useCallback(() => vtApi.sites(query).then(setRows, (e) => pushError(valterraError(e, 'Could not load the sites'), 'Load failed')), [query, pushError]);
  useEffect(() => { if (me) load(); }, [me, load]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !vtCan(me, 'sites')) return <Navigate to="/valterra" replace />;
  const canEdit = vtCan(me, 'sitesEdit');
  const close = () => { setDrawer({ open: false, site: null }); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } };
  const states = [...new Set((rows || []).map((r) => r.state).filter(Boolean))];
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const selectCls = 'rounded-xl border bg-white px-3 py-2 text-sm';
  const columns = [
    { key: 'name', header: 'Site', render: (r) => <span><Link to={`/valterra/sites/${r.id}`} className="font-medium text-primary-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.name}</Link><span className="block text-xs text-tertiary-500">{r.code}</span></span> },
    { key: 'loc', header: 'Location', render: (r) => <span>{r.location || '-'}<span className="block text-xs text-tertiary-500">{[r.district, r.state].filter(Boolean).join(', ')}</span></span> },
    { key: 'type', header: 'Mining type', render: (r) => r.mining_type?.name || '-' },
    { key: 'mat', header: 'Material', render: (r) => <span>{r.material?.name || '-'}{r.additional_materials.length > 0 && <span className="block text-xs text-tertiary-500">+ {r.additional_materials.join(', ')}</span>}</span> },
    { key: 'start', header: 'Started', render: (r) => (r.start_date ? dateLabel(r.start_date) : '-') },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={SITE_STATUS_META[r.status]?.tone}>{SITE_STATUS_META[r.status]?.label || r.status}</Pill> },
    { key: 'a', header: '', render: (r) => canEdit && <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={(e) => { e.stopPropagation(); setDrawer({ open: true, site: r }); }}>Edit</button> },
  ];
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <input className={`${selectCls} w-64`} placeholder="Search name, code, location..." value={f.q} onChange={set('q')} aria-label="Search sites" />
        <select className={selectCls} value={f.status} onChange={set('status')} aria-label="Status"><option value="">All open statuses</option>{SITE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        <select className={selectCls} value={f.mining_type_id} onChange={set('mining_type_id')} aria-label="Mining type"><option value="">All mining types</option>{pickers.miningTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className={selectCls} value={f.material_id} onChange={set('material_id')} aria-label="Material"><option value="">All materials</option>{pickers.materials.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className={selectCls} value={f.state} onChange={set('state')} aria-label="State"><option value="">All states</option>{states.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <label className="flex items-center gap-1.5 text-xs text-tertiary-600"><input type="checkbox" checked={f.include_closed === 'true'} onChange={(e) => setF((c) => ({ ...c, include_closed: e.target.checked ? 'true' : 'false' }))} />Show closed sites</label>
        {canEdit && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => setDrawer({ open: true, site: null })}><Plus className="h-4 w-4" />New mining site</button>}
      </div>
      <DataTable columns={columns} rows={rows || []} loading={!rows} emptyLabel="No mining sites yet. Create the first site to start tracking investments and returns site by site." onRowClick={(r) => navigate(`/valterra/sites/${r.id}`)} maxHeight="65vh" />
      {rows && <p className="flex items-center gap-1.5 text-xs text-tertiary-500"><Mountain className="h-3.5 w-3.5" />{rows.length} site{rows.length === 1 ? '' : 's'} · open a site for its own dashboard, investments and transactions. Closed sites keep their full history.</p>}
      <Drawer open={drawer.open} onClose={close} size="lg" tone={drawer.site ? 'edit' : 'create'} title={drawer.site ? `Edit ${drawer.site.name}` : 'New mining site'}>
        {drawer.open && <SiteForm key={drawer.site?.id || 'new'} initial={drawer.site} pickers={pickers} canEdit={canEdit} onCancel={close} onSaved={() => { close(); load(); pickers.refresh(); }} />}
      </Drawer>
    </div>
  );
}
