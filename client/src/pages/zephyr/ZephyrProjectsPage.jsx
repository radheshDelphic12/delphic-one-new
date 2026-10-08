import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { PROJECT_KINDS, PROJECT_STATUSES, STATUS_META, rupees } from '../../lib/zephyr/projectMeta.js';
import { SERVICE_META, useServiceTypes } from '../../lib/zephyr/serviceMeta.js';
import { compact, dateLabel } from '../../lib/format.js';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { SECTION_TITLES, ServiceSectionForm, cleanSection } from '../../components/zephyr/ZephyrServiceSection.jsx';

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const EMPTY = {
  name: '', service_type: '', kind: 'client', party_id: '', property_id: '', location: '', status: 'planned', start_date: '', end_date: '', actual_end: '', agreement_ref: '',
  contract_value: '', budget: '', expected_profit: '', progress_pct: 0, manager_id: '', assignee_id: '', contractor_id: '', description: '', notes: '',
};
const KEYS = Object.keys(EMPTY);
const dayOf = (v) => (v ? String(v).slice(0, 10) : '');

export function ProgressBar({ value }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded-full bg-primary-100"><span className="block h-full rounded-full bg-primary-500" style={{ width: `${Math.min(100, Math.max(0, value || 0))}%` }} /></span>
      <span className="text-xs tabular-nums text-tertiary-600">{value || 0}%</span>
    </span>
  );
}

export function ServiceBadge({ service, label }) {
  const meta = SERVICE_META[service];
  if (!meta) return <span className="text-tertiary-400">—</span>;
  const Icon = meta.icon;
  return <Pill tone={meta.tone}><span className="inline-flex items-center gap-1"><Icon className="h-3 w-3" />{label || meta.label}</span></Pill>;
}

function Section({ title, hint, children }) {
  return (
    <fieldset className="space-y-3 rounded-2xl border bg-white p-4">
      <legend className="px-1 font-heading text-sm font-semibold text-tertiary-900">{title}</legend>
      {hint && <p className="-mt-1 text-xs text-tertiary-500">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Create / edit form shared by the list page and the project detail page: common fields + the service's own section. */
export function ProjectForm({ initial, parties, managers, employees = [], contractors = [], properties = [], services, saving, onSubmit, onCancel, hasMilestones = false }) {
  const [v, setV] = useState(() => ({
    ...EMPTY,
    ...Object.fromEntries(KEYS.map((k) => [k, initial?.[k] ?? EMPTY[k]])),
    start_date: dayOf(initial?.start_date),
    end_date: dayOf(initial?.end_date),
    actual_end: dayOf(initial?.actual_end),
  }));
  const [details, setDetails] = useState(() => initial?.details || {});
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  const partyOptions = parties.filter((p) => (v.kind === 'client' ? p.kind !== 'vendor' : true));
  const profitHint = v.expected_profit === '' && v.contract_value !== '' && v.contract_value !== null && v.budget !== '' && v.budget !== null ? Number(v.contract_value) - Number(v.budget) : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = Object.fromEntries(KEYS.map((k) => [k, typeof v[k] === 'string' ? v[k].trim() : v[k]]));
        body.details = cleanSection(v.service_type, details);
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <Section title="Project information">
        <label className={`${labelCls} sm:col-span-2`}>Project name<input className={inputCls} value={v.name} onChange={set('name')} required maxLength={200} autoFocus /></label>
        <label className={labelCls}>Service<select className={inputCls} value={v.service_type} onChange={(e) => { set('service_type')(e); setDetails({}); }} required><option value="">Select a service…</option>{services.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
        <label className={labelCls}>Status<select className={inputCls} value={v.status} onChange={set('status')}>{PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label className={labelCls}>Type<select className={inputCls} value={v.kind} onChange={set('kind')}>{PROJECT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
        <label className={labelCls}>{v.kind === 'client' ? 'Client' : 'Linked party (optional)'}<select className={inputCls} value={v.party_id} onChange={set('party_id')}><option value="">None</option>{partyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className={labelCls}>Location<input className={inputCls} value={v.location} onChange={set('location')} maxLength={200} /></label>
        {['property_management', 'property_trading', 'real_estate_consulting', 'civil_construction', 'interior_design'].includes(v.service_type) && properties.length > 0 && (
          <label className={labelCls}>Property (if the work is on one)<select className={inputCls} value={v.property_id ?? ''} onChange={set('property_id')}><option value="">None</option>{properties.map((pr) => <option key={pr.id} value={pr.id}>{pr.code} · {pr.name}</option>)}</select></label>
        )}
        <label className={labelCls}>Contract / agreement reference<input className={inputCls} value={v.agreement_ref ?? ''} onChange={set('agreement_ref')} maxLength={200} /></label>
      </Section>

      <Section title="Dates">
        <label className={labelCls}>Start date<input type="date" className={inputCls} value={v.start_date} onChange={set('start_date')} /></label>
        <label className={labelCls}>Expected end date<input type="date" className={inputCls} min={v.start_date || undefined} value={v.end_date} onChange={set('end_date')} /></label>
        <label className={labelCls}>Actual end date<input type="date" className={inputCls} value={v.actual_end} onChange={set('actual_end')} /></label>
        <label className={labelCls}>Progress % {hasMilestones && <span className="font-normal text-tertiary-400">(set by milestones)</span>}<input type="number" min="0" max="100" className={inputCls} value={v.progress_pct} onChange={set('progress_pct')} disabled={hasMilestones} /></label>
      </Section>

      <Section title="Commercials" hint="Revenue and cost are not typed here: they come from the money entries booked against the project.">
        <label className={labelCls}>Contract / estimated value (₹)<input type="number" min="0" className={inputCls} value={v.contract_value ?? ''} onChange={set('contract_value')} /></label>
        <label className={labelCls}>Investment / budget / estimated cost (₹)<input type="number" min="0" className={inputCls} value={v.budget ?? ''} onChange={set('budget')} /></label>
        <label className={labelCls}>Expected profit (₹){profitHint !== null && <span className="font-normal text-tertiary-400"> · auto {rupees(profitHint)}</span>}<input type="number" className={inputCls} value={v.expected_profit ?? ''} onChange={set('expected_profit')} placeholder="Blank = contract value − budget" /></label>
      </Section>

      <Section title="People">
        <label className={labelCls}>Project manager<select className={inputCls} value={v.manager_id ?? ''} onChange={set('manager_id')}><option value="">Unassigned</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className={labelCls}>Assigned employee<select className={inputCls} value={v.assignee_id ?? ''} onChange={set('assignee_id')}><option value="">Unassigned</option>{employees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className={labelCls}>Assigned contractor<select className={inputCls} value={v.contractor_id ?? ''} onChange={set('contractor_id')}><option value="">None</option>{contractors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </Section>

      {v.service_type && (
        <Section title={SECTION_TITLES[v.service_type]} hint="All optional. Every deal is different.">
          <ServiceSectionForm service={v.service_type} value={details} onChange={setDetails} />
        </Section>
      )}

      <Section title="Description and notes">
        <label className={`${labelCls} sm:col-span-2`}>Description<textarea className={inputCls} rows={3} value={v.description ?? ''} onChange={set('description')} maxLength={4000} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={2} value={v.notes ?? ''} onChange={set('notes')} maxLength={2000} /></label>
      </Section>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save project'}</button>
      </div>
    </form>
  );
}

export function cleanProjectBody(values) {
  const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]));
  body.name = values.name;
  body.details = values.details;
  body.progress_pct = Number(values.progress_pct || 0);
  for (const k of ['contract_value', 'budget', 'expected_profit']) if (body[k] !== null && body[k] !== undefined) body[k] = Number(body[k]);
  return body;
}

export default function ZephyrProjectsPage() {
  const { me, loading } = useZephyr();
  const { pushError, pushSuccess } = useAlerts();
  const { services, label: serviceLabel, active: activeServices } = useServiceTypes();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ status: 'open', service_type: '', party_id: '', location: '', from: '', to: '' });
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [dLocation, setDLocation] = useState('');
  const [rows, setRows] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [summary, setSummary] = useState(null);
  const [parties, setParties] = useState([]);
  const [managers, setManagers] = useState([]);
  const [people, setPeople] = useState([]);
  const [properties, setProperties] = useState([]);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDq(q.trim());
      setDLocation(filters.location.trim());
    }, 250);
    return () => clearTimeout(t);
  }, [q, filters.location]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setFetching(true);
    const params = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.service_type ? { service_type: filters.service_type } : {}),
      ...(filters.party_id ? { party_id: filters.party_id } : {}),
      ...(dLocation ? { location: dLocation } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      ...(dq ? { q: dq } : {}),
    };
    try {
      const [list, sum] = await Promise.all([zephyrApi.projects(params), zephyrApi.projectSummary()]);
      if (id === reqId.current) {
        setRows(list);
        setSummary(sum);
      }
    } catch (e) {
      if (id === reqId.current) pushError(zephyrError(e, 'Could not load projects'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [filters.status, filters.service_type, filters.party_id, filters.from, filters.to, dLocation, dq, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    zephyrApi.parties({ status: 'active', limit: 200 }).then((r) => setParties(r.data), () => setParties([]));
    zephyrApi.leadOwners().then(setManagers, () => setManagers([]));
    zephyrApi.people({ status: 'active' }).then(setPeople, () => setPeople([]));
    zephyrApi.properties({}).then(setProperties, () => setProperties([]));
  }, []);

  const employees = useMemo(() => people.filter((p) => p.kind === 'employee'), [people]);
  const contractors = useMemo(() => people.filter((p) => p.kind === 'contractor'), [people]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'projects')) return <Navigate to="/zephyr" replace />;
  const canEdit = zxCan(me, 'projectsEdit');
  const clients = parties.filter((p) => p.kind !== 'vendor');

  async function create(values) {
    setSaving(true);
    try {
      const saved = await zephyrApi.createProject(cleanProjectBody(values));
      pushSuccess(`Project ${saved.code} created`);
      setCreating(false);
      navigate(`/zephyr/projects/${saved.id}`);
    } catch (e) {
      pushError(zephyrError(e, 'Could not create the project'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'code', header: 'Code', render: (r) => <span className="font-mono text-xs text-tertiary-500">{r.code}</span> },
    { key: 'name', header: 'Project', render: (r) => <span className="font-medium text-tertiary-900">{r.name}</span> },
    { key: 'service', header: 'Service', render: (r) => <ServiceBadge service={r.service_type} label={serviceLabel(r.service_type)} /> },
    { key: 'party', header: 'Client', render: (r) => r.party?.name || '—' },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={STATUS_META[r.status]?.tone}>{STATUS_META[r.status]?.label}</Pill> },
    { key: 'progress', header: 'Progress', render: (r) => <ProgressBar value={r.progress} /> },
    { key: 'value', header: 'Value', render: (r) => rupees(r.contract_value ?? r.budget) },
    { key: 'profit', header: 'Actual profit', render: (r) => <span className={r.actual_profit < 0 ? 'text-red-600' : 'text-tertiary-700'}>{rupees(r.actual_profit)}</span> },
    { key: 'manager', header: 'Assigned', render: (r) => r.assignee?.name || r.manager?.name || '—' },
    { key: 'end', header: 'Due', render: (r) => (r.end_date ? <span className={r.milestones_overdue ? 'text-red-600' : ''}>{dateLabel(r.end_date)}</span> : '—') },
  ];

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Live projects" value={summary?.live_count ?? '—'} hint="planned, active, on hold" />
        <StatCard label="Contract value (live)" value={`₹${compact(summary?.live_contract_value)}`} hint={summary?.live_budget ? `+ ₹${compact(summary.live_budget)} own budgets` : 'client projects'} />
        <StatCard label="Committed to vendors" value={`₹${compact(summary?.committed_cost)}`} hint="work orders, live projects" />
        <StatCard label="Overdue milestones" value={summary?.milestones_overdue ?? 0} tone={summary?.milestones_overdue ? 'danger' : undefined} />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {services.map((s) => {
          const Icon = s.icon;
          const row = summary?.by_service?.[s.key];
          const on = filters.service_type === s.key;
          return (
            <button key={s.key} type="button" onClick={() => setFilters((f) => ({ ...f, service_type: on ? '' : s.key }))} className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-card ${on ? 'border-primary-600 bg-primary-50' : 'bg-white'} ${s.active ? '' : 'opacity-60'}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${on ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-600'}`}><Icon className="h-4 w-4" /></span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-tertiary-900">{s.label}</span>
                <span className="block text-xs text-tertiary-500">{row?.total ?? 0} projects · {row?.live ?? 0} live · ₹{compact(row?.contract_value)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <FilterBar
        q={q}
        onQ={setQ}
        searchPlaceholder="Search code, name, location…"
        searchLabel="Search projects"
        fields={[
          { key: 'status', label: 'Status', type: 'select', any: 'Open projects', options: [{ value: '', label: 'All statuses' }, ...PROJECT_STATUSES.map((x) => ({ value: x.value, label: x.label }))] },
          { key: 'party_id', label: 'Client', type: 'select', any: 'All clients', options: clients.map((x) => ({ value: x.id, label: x.name })) },
          { key: 'location', label: 'Location', placeholder: 'City or area' },
          { key: 'from', label: 'Starts from', type: 'date' },
          { key: 'to', label: 'Starts to', type: 'date', min: filters.from || undefined },
        ]}
        values={filters}
        defaults={{ status: 'open' }}
        onChange={(key, value) => setFilters((f) => ({ ...f, [key]: value }))}
        onReset={() => { setFilters({ status: 'open', service_type: '', party_id: '', location: '', from: '', to: '' }); setQ(''); }}
      >
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New project</button>}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={rows}
        loading={fetching && rows.length === 0}
        emptyLabel="No projects here. Win a lead and convert it, or add one directly."
        onRowClick={(r) => navigate(`/zephyr/projects/${r.id}`)}
        maxHeight="62vh"
      />

      <Drawer open={creating} onClose={() => setCreating(false)} size="xl" tone="create" title="New project">
        {creating && <ProjectForm parties={parties} managers={managers} employees={employees} contractors={contractors} properties={properties} services={activeServices} saving={saving} onSubmit={create} onCancel={() => setCreating(false)} />}
      </Drawer>
    </div>
  );
}
