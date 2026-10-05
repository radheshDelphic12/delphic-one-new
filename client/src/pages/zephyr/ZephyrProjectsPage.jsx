import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { KIND_LABEL, PROJECT_KINDS, PROJECT_STATUSES, STATUS_META, rupees } from '../../lib/zephyr/projectMeta.js';
import { compact, dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import StatCard from '../../components/ui/StatCard.jsx';

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const EMPTY = { name: '', kind: 'client', party_id: '', location: '', status: 'planning', start_date: '', end_date: '', contract_value: '', budget: '', progress_pct: 0, manager_id: '', notes: '' };
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

/** Create / edit form shared by the list page and the project detail page. */
export function ProjectForm({ initial, parties, managers, saving, onSubmit, onCancel, hasMilestones = false }) {
  const [v, setV] = useState(() => ({ ...EMPTY, ...Object.fromEntries(KEYS.map((k) => [k, initial?.[k] ?? EMPTY[k]])), start_date: dayOf(initial?.start_date), end_date: dayOf(initial?.end_date) }));
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  const partyOptions = parties.filter((p) => (v.kind === 'client' ? p.kind !== 'vendor' : true));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Object.fromEntries(KEYS.map((k) => [k, typeof v[k] === 'string' ? v[k].trim() : v[k]])));
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${labelCls} sm:col-span-2`}>Project name<input className={inputCls} value={v.name} onChange={set('name')} required maxLength={200} autoFocus /></label>
        <label className={labelCls}>Type<select className={inputCls} value={v.kind} onChange={set('kind')}>{PROJECT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
        <label className={labelCls}>Status<select className={inputCls} value={v.status} onChange={set('status')}>{PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label className={labelCls}>{v.kind === 'client' ? 'Client' : 'Linked party (optional)'}<select className={inputCls} value={v.party_id} onChange={set('party_id')}><option value="">None</option>{partyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className={labelCls}>Project manager<select className={inputCls} value={v.manager_id} onChange={set('manager_id')}><option value="">Unassigned</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className={labelCls}>Contract value (INR)<input type="number" min="0" className={inputCls} value={v.contract_value ?? ''} onChange={set('contract_value')} /></label>
        <label className={labelCls}>Budget / planned cost (INR)<input type="number" min="0" className={inputCls} value={v.budget ?? ''} onChange={set('budget')} /></label>
        <label className={labelCls}>Start date<input type="date" className={inputCls} value={v.start_date} onChange={set('start_date')} /></label>
        <label className={labelCls}>End date<input type="date" className={inputCls} min={v.start_date || undefined} value={v.end_date} onChange={set('end_date')} /></label>
        <label className={labelCls}>Location<input className={inputCls} value={v.location} onChange={set('location')} maxLength={200} /></label>
        <label className={labelCls}>Progress % {hasMilestones && <span className="font-normal text-tertiary-400">(set by milestones)</span>}<input type="number" min="0" max="100" className={inputCls} value={v.progress_pct} onChange={set('progress_pct')} disabled={hasMilestones} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={3} value={v.notes ?? ''} onChange={set('notes')} maxLength={2000} /></label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

export function cleanProjectBody(values) {
  const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]));
  body.name = values.name;
  body.progress_pct = Number(values.progress_pct || 0);
  for (const k of ['contract_value', 'budget']) if (body[k] !== null) body[k] = Number(body[k]);
  return body;
}

export default function ZephyrProjectsPage() {
  const { me, loading } = useZephyr();
  const { pushError, pushSuccess } = useAlerts();
  const navigate = useNavigate();
  const [status, setStatus] = useState('open');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [rows, setRows] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [summary, setSummary] = useState(null);
  const [parties, setParties] = useState([]);
  const [managers, setManagers] = useState([]);
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
      const [list, sum] = await Promise.all([
        zephyrApi.projects({ ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...(dq ? { q: dq } : {}) }),
        zephyrApi.projectSummary(),
      ]);
      if (id === reqId.current) {
        setRows(list);
        setSummary(sum);
      }
    } catch (e) {
      if (id === reqId.current) pushError(zephyrError(e, 'Could not load projects'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [status, kind, dq, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    zephyrApi.parties({ status: 'active', limit: 200 }).then((r) => setParties(r.data), () => setParties([]));
    zephyrApi.leadOwners().then(setManagers, () => setManagers([]));
  }, []);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'projects')) return <Navigate to="/zephyr" replace />;
  const canEdit = zxCan(me, 'projectsEdit');

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
    { key: 'kind', header: 'Type', render: (r) => <Pill tone={r.kind === 'self' ? 'purple' : 'blue'}>{KIND_LABEL[r.kind]}</Pill> },
    { key: 'party', header: 'Client', render: (r) => r.party?.name || '—' },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={STATUS_META[r.status]?.tone}>{STATUS_META[r.status]?.label}</Pill> },
    { key: 'progress', header: 'Progress', render: (r) => <ProgressBar value={r.progress} /> },
    { key: 'value', header: 'Value', render: (r) => rupees(r.kind === 'client' ? r.contract_value : r.budget) },
    { key: 'manager', header: 'Manager', render: (r) => r.manager?.name || '—' },
    { key: 'end', header: 'Due', render: (r) => (r.end_date ? <span className={r.milestones_overdue ? 'text-red-600' : ''}>{dateLabel(r.end_date)}</span> : '—') },
  ];

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Live projects" value={summary?.live_count ?? '—'} hint="planning, active, on hold" />
        <StatCard label="Contract value (live)" value={`₹${compact(summary?.live_contract_value)}`} hint={summary?.live_budget ? `+ ₹${compact(summary.live_budget)} own budgets` : 'client projects'} />
        <StatCard label="Committed to vendors" value={`₹${compact(summary?.committed_cost)}`} hint="work orders, live projects" />
        <StatCard label="Overdue milestones" value={summary?.milestones_overdue ?? 0} accent={Boolean(summary?.milestones_overdue)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Status">
            <option value="open">Open projects</option>
            <option value="">All statuses</option>
            {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Type">
            <option value="">All types</option>
            {PROJECT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, name, location…" aria-label="Search projects" className="w-60 rounded-xl border py-1.5 pl-9 pr-3 text-sm" />
          </div>
          {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New project</button>}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={fetching && rows.length === 0}
        emptyLabel="No projects here. Win a lead and convert it, or add one directly."
        onRowClick={(r) => navigate(`/zephyr/projects/${r.id}`)}
        maxHeight="62vh"
      />

      <Drawer open={creating} onClose={() => setCreating(false)} size="xl" tone="create" title="New project">
        {creating && <ProjectForm parties={parties} managers={managers} saving={saving} onSubmit={create} onCancel={() => setCreating(false)} />}
      </Drawer>
    </div>
  );
}
