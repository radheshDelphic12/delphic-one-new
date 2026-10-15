import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Store, Plus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { useNovarex, nxCan } from '../../lib/novarex/useNovarex.js';
import { useNxPickers } from '../../lib/novarex/pickers.js';
import { SITE_STATUSES, SITE_STATUS_META } from '../../lib/novarex/meta.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { Area, DateInput, Num, Select, Text, dayOf, toBody } from '../../components/novarex/ui.jsx';

/** The outlet form: create and edit use the same fields. Closing an outlet (status Closed) keeps all its history. */
export function OutletForm({ initial, pickers, onSaved, onCancel, canEdit }) {
  const editing = Boolean(initial);
  const { pushSuccess } = useAlerts();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [v, setV] = useState(() => ({
    name: initial?.name || '', code: initial?.code || '', location: initial?.location || '', state: initial?.state || '', district: initial?.district || '', country: initial?.country || 'India',
    latitude: initial?.latitude ?? '', longitude: initial?.longitude ?? '', ownership_type_id: initial?.ownership_type_id || '', format_id: initial?.format_id || '',
    additional: (initial?.tags || []).join(', '), description: initial?.description || '', status: initial?.status || 'active',
    start_date: dayOf(initial?.start_date), expected_closure_date: dayOf(initial?.expected_closure_date), manager_name: initial?.manager_name || '', gstin: initial?.gstin || '', drug_licence_no: initial?.drug_licence_no || '', drug_licence_expiry: dayOf(initial?.drug_licence_expiry), legal_entity: initial?.legal_entity || '', agreement_ref: initial?.agreement_ref || '', notes: initial?.notes || '',
  }));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const { additional, ...rest } = v;
    const body = toBody(rest, { numbers: ['latitude', 'longitude'] });
    body.tags = additional.split(',').map((x) => x.trim()).filter(Boolean);
    if (!body.code) delete body.code;
    try {
      const saved = editing ? await nxApi.updateOutlet(initial.id, body) : await nxApi.createOutlet(body);
      pushSuccess(editing ? 'Outlet updated' : 'Outlet created');
      onSaved(saved);
    } catch (err) { setError(novarexError(err, 'Could not save the outlet')); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Text label="Outlet name" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} placeholder="e.g. Novarex Pharmacy - Connaught Place" />
        <Text label="Outlet code" value={v.code} onChange={set('code')} maxLength={30} placeholder={editing ? '' : 'Leave blank to generate'} />
        <Select label="Status" value={v.status} onChange={set('status')} options={SITE_STATUSES.map((s) => ({ value: s.value, label: s.value === 'closed' ? 'Closed - keeps history, takes no new records' : s.label }))} />
        <Select label="Ownership type" value={v.ownership_type_id} onChange={set('ownership_type_id')} options={pickers.ownershipTypes} blank="Not set" />
        <Select label="Outlet format" value={v.format_id} onChange={set('format_id')} options={pickers.formats} blank="Not set" />
        <Text label="Tags" className="sm:col-span-2" value={v.additional} onChange={set('additional')} placeholder="Comma separated, e.g. Cold chain, 24x7" />
        <Text label="City / area" className="sm:col-span-2" value={v.location} onChange={set('location')} maxLength={300} placeholder="City and locality" />
        <Text label="District" value={v.district} onChange={set('district')} maxLength={120} />
        <Text label="State" value={v.state} onChange={set('state')} maxLength={120} />
        <Text label="Country" value={v.country} onChange={set('country')} maxLength={120} />
        <Text label="Outlet manager / responsible person" value={v.manager_name} onChange={set('manager_name')} maxLength={200} />
        <Num label="Latitude" value={v.latitude} onChange={set('latitude')} min="-90" max="90" />
        <Num label="Longitude" value={v.longitude} onChange={set('longitude')} min="-180" max="180" />
        <DateInput label="Outlet start date" value={v.start_date} onChange={set('start_date')} />
        <DateInput label="Expected closure date" value={v.expected_closure_date} onChange={set('expected_closure_date')} min={v.start_date} />
        <Text label="Operating / legal entity" value={v.legal_entity} onChange={set('legal_entity')} maxLength={200} />
        <Text label="GSTIN" value={v.gstin} onChange={set('gstin')} maxLength={20} />
        <Text label="Drug licence no." value={v.drug_licence_no} onChange={set('drug_licence_no')} maxLength={80} />
        <DateInput label="Drug licence expiry" value={v.drug_licence_expiry} onChange={set('drug_licence_expiry')} />
        <Text label="Franchise / contract agreement ref." className="sm:col-span-2" value={v.agreement_ref} onChange={set('agreement_ref')} maxLength={120} />
        <Area label="Description" className="sm:col-span-2" rows={3} value={v.description} onChange={set('description')} maxLength={4000} />
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={set('notes')} maxLength={4000} />
      </div>
      {v.status === 'closed' && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">A closed outlet is archived: every past investment, transaction, projection and report stays readable, but no new record can be added to it. Reopen it by changing the status.</p>}
      {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        {canEdit && <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Create outlet'}</button>}
      </div>
    </form>
  );
}

export default function NovarexOutletsPage() {
  const { me, loading } = useNovarex();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const pickers = useNxPickers({ people: false });
  const [f, setF] = useState({ q: '', status: '', ownership_type_id: '', format_id: '', state: '', include_closed: 'false' });
  const [rows, setRows] = useState(null);
  const [drawer, setDrawer] = useState({ open: params.get('new') === '1', outlet: null });
  const query = useMemo(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), [f]);
  const load = useCallback(() => nxApi.outlets(query).then(setRows, (e) => pushError(novarexError(e, 'Could not load the outlets'), 'Load failed')), [query, pushError]);
  useEffect(() => { if (me) load(); }, [me, load]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'outlets')) return <Navigate to="/novarex" replace />;
  const canEdit = nxCan(me, 'outletsEdit');
  const close = () => { setDrawer({ open: false, outlet: null }); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } };
  const states = [...new Set((rows || []).map((r) => r.state).filter(Boolean))];
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const selectCls = 'rounded-xl border bg-white px-3 py-2 text-sm';
  const columns = [
    { key: 'name', header: 'Outlet', render: (r) => <span><Link to={`/novarex/outlets/${r.id}`} className="font-medium text-primary-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.name}</Link><span className="block text-xs text-tertiary-500">{r.code}</span></span> },
    { key: 'loc', header: 'Location', render: (r) => <span>{r.location || '-'}<span className="block text-xs text-tertiary-500">{[r.district, r.state].filter(Boolean).join(', ')}</span></span> },
    { key: 'type', header: 'Ownership type', render: (r) => r.ownership_type?.name || '-' },
    { key: 'mat', header: 'Format', render: (r) => <span>{r.format?.name || '-'}{r.tags.length > 0 && <span className="block text-xs text-tertiary-500">+ {r.tags.join(', ')}</span>}</span> },
    { key: 'start', header: 'Started', render: (r) => (r.start_date ? dateLabel(r.start_date) : '-') },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={SITE_STATUS_META[r.status]?.tone}>{SITE_STATUS_META[r.status]?.label || r.status}</Pill> },
    { key: 'a', header: '', render: (r) => canEdit && <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={(e) => { e.stopPropagation(); setDrawer({ open: true, outlet: r }); }}>Edit</button> },
  ];
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <input className={`${selectCls} w-64`} placeholder="Search name, code, location..." value={f.q} onChange={set('q')} aria-label="Search outlets" />
        <select className={selectCls} value={f.status} onChange={set('status')} aria-label="Status"><option value="">All open statuses</option>{SITE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        <select className={selectCls} value={f.ownership_type_id} onChange={set('ownership_type_id')} aria-label="Ownership type"><option value="">All ownership types</option>{pickers.ownershipTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className={selectCls} value={f.format_id} onChange={set('format_id')} aria-label="Format"><option value="">All formats</option>{pickers.formats.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className={selectCls} value={f.state} onChange={set('state')} aria-label="State"><option value="">All states</option>{states.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <label className="flex items-center gap-1.5 text-xs text-tertiary-600"><input type="checkbox" checked={f.include_closed === 'true'} onChange={(e) => setF((c) => ({ ...c, include_closed: e.target.checked ? 'true' : 'false' }))} />Show closed outlets</label>
        {canEdit && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => setDrawer({ open: true, outlet: null })}><Plus className="h-4 w-4" />New outlet</button>}
      </div>
      <DataTable columns={columns} rows={rows || []} loading={!rows} emptyLabel="No outlets yet. Create the first outlet to start tracking investments and returns outlet by outlet." onRowClick={(r) => navigate(`/novarex/outlets/${r.id}`)} maxHeight="65vh" />
      {rows && <p className="flex items-center gap-1.5 text-xs text-tertiary-500"><Store className="h-3.5 w-3.5" />{rows.length} outlet{rows.length === 1 ? '' : 's'} · open an outlet for its own dashboard, investments and transactions. Closed outlets keep their full history.</p>}
      <Drawer open={drawer.open} onClose={close} size="lg" tone={drawer.outlet ? 'edit' : 'create'} title={drawer.outlet ? `Edit ${drawer.outlet.name}` : 'New outlet'}>
        {drawer.open && <OutletForm key={drawer.outlet?.id || 'new'} initial={drawer.outlet} pickers={pickers} canEdit={canEdit} onCancel={close} onSaved={() => { close(); load(); pickers.refresh(); }} />}
      </Drawer>
    </div>
  );
}
