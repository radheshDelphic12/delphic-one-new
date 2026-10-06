import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AlarmClock, CalendarClock, Check, HardHat, Kanban, List, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { LEAD_STAGES, STAGE_META, DONE_STAGE_KEYS, SERVICE_META, blankDetail, useServiceTypes } from '../../lib/zephyr/serviceMeta.js';
import { compact, dateLabel, money } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import ZephyrDocuments from '../../components/zephyr/ZephyrDocuments.jsx';

const KINDS = [
  { value: 'call', label: 'Call' },
  { value: 'visit', label: 'Site visit' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'note', label: 'Note' },
];
const EMPTY = {
  name: '', service_type: '', company: '', party_id: '', contact_name: '', phone: '', email: '', address: '', city: '', state: '', location: '', source: '',
  owner_id: '', assignee_id: '', contractor_id: '', estimated_value: '', expected_profit: '', expected_start: '', expected_end: '', property_ref: '',
  description: '', notes: '',
};
const FORM_KEYS = Object.keys(EMPTY);
const MONEY_KEYS = ['estimated_value', 'expected_profit'];

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const today = () => new Date().toISOString().slice(0, 10);
const dayOf = (v) => (v ? String(v).slice(0, 10) : null);

function Section({ title, hint, children }) {
  return (
    <fieldset className="space-y-3 rounded-2xl border bg-white p-4">
      <legend className="px-1 font-heading text-sm font-semibold text-tertiary-900">{title}</legend>
      {hint && <p className="-mt-1 text-xs text-tertiary-500">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function DetailsEditor({ rows, onChange }) {
  const set = (i, key) => (e) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: e.target.value } : r)));
  return (
    <div className="space-y-2 sm:col-span-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-2">
          <input className={inputCls.replace('mt-1 ', '')} placeholder="Detail (e.g. Society size)" value={r.label} onChange={set(i, 'label')} maxLength={80} aria-label="Detail name" />
          <input className={inputCls.replace('mt-1 ', '')} placeholder="Value" value={r.value} onChange={set(i, 'value')} maxLength={500} aria-label="Detail value" />
          <button type="button" className="rounded-lg p-2 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Remove detail" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}><X className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline" onClick={() => onChange([...rows, blankDetail()])}><Plus className="h-4 w-4" />Add a detail</button>
    </div>
  );
}

function LeadForm({ initial, owners, parties, employees, contractors, services, saving, onSubmit, onCancel }) {
  const [v, setV] = useState(() => ({
    ...EMPTY,
    ...Object.fromEntries(FORM_KEYS.map((k) => [k, initial?.[k] ?? EMPTY[k]])),
    expected_start: dayOf(initial?.expected_start) || '',
    expected_end: dayOf(initial?.expected_end) || '',
  }));
  const [details, setDetails] = useState(() => (Array.isArray(initial?.details) ? initial.details.map((d) => ({ label: d.label, value: d.value })) : []));
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = Object.fromEntries(FORM_KEYS.map((k) => [k, typeof v[k] === 'string' ? v[k].trim() : v[k]]));
        body.details = details.filter((d) => d.label.trim()).map((d) => ({ label: d.label.trim(), value: d.value.trim() }));
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <Section title="Basic information">
        <label className={`${labelCls} sm:col-span-2`}>Lead name<input className={inputCls} value={v.name} onChange={set('name')} required maxLength={200} autoFocus placeholder="e.g. 10 villas in M3M" /></label>
        <label className={labelCls}>Contact person<input className={inputCls} value={v.contact_name} onChange={set('contact_name')} maxLength={200} /></label>
        <label className={labelCls}>Company<input className={inputCls} value={v.company} onChange={set('company')} maxLength={200} /></label>
        <label className={labelCls}>Phone<input className={inputCls} value={v.phone} onChange={set('phone')} maxLength={40} /></label>
        <label className={labelCls}>Email<input type="email" className={inputCls} value={v.email} onChange={set('email')} maxLength={200} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Address<input className={inputCls} value={v.address} onChange={set('address')} maxLength={500} /></label>
        <label className={labelCls}>City<input className={inputCls} value={v.city} onChange={set('city')} maxLength={120} /></label>
        <label className={labelCls}>State<input className={inputCls} value={v.state} onChange={set('state')} maxLength={120} /></label>
        <label className={labelCls}>Location / site<input className={inputCls} value={v.location} onChange={set('location')} maxLength={200} placeholder="Area, project or landmark" /></label>
        <label className={labelCls}>Source<input className={inputCls} value={v.source} onChange={set('source')} placeholder="Referral, website, site board…" maxLength={120} /></label>
      </Section>

      <Section title="Service and assignment">
        <label className={labelCls}>Service<select className={inputCls} value={v.service_type} onChange={set('service_type')} required><option value="">Select a service…</option>{services.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
        <label className={labelCls}>Existing client (optional)<select className={inputCls} value={v.party_id} onChange={set('party_id')}><option value="">Not a client yet</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className={labelCls}>Lead owner<select className={inputCls} value={v.owner_id} onChange={set('owner_id')}><option value="">Me</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className={labelCls}>Assigned employee<select className={inputCls} value={v.assignee_id} onChange={set('assignee_id')}><option value="">Unassigned</option>{employees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className={labelCls}>Assigned contractor<select className={inputCls} value={v.contractor_id} onChange={set('contractor_id')}><option value="">None</option>{contractors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </Section>

      <Section title="Opportunity">
        <label className={labelCls}>Estimated value (₹)<input type="number" min="0" className={inputCls} value={v.estimated_value} onChange={set('estimated_value')} /></label>
        <label className={labelCls}>Expected profit (₹)<input type="number" min="0" className={inputCls} value={v.expected_profit} onChange={set('expected_profit')} /></label>
        <label className={labelCls}>Expected start<input type="date" className={inputCls} value={v.expected_start} onChange={set('expected_start')} /></label>
        <label className={labelCls}>Expected end<input type="date" className={inputCls} min={v.expected_start || undefined} value={v.expected_end} onChange={set('expected_end')} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Property / project reference<input className={inputCls} value={v.property_ref} onChange={set('property_ref')} maxLength={200} /></label>
      </Section>

      <Section title="Description and deal details" hint="Every deal is different. Use these freely; nothing here is mandatory.">
        <label className={`${labelCls} sm:col-span-2`}>Description<textarea className={inputCls} rows={3} value={v.description} onChange={set('description')} maxLength={4000} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={2} value={v.notes} onChange={set('notes')} maxLength={2000} /></label>
        <div className="sm:col-span-2"><div className={labelCls}>Additional details</div></div>
        <DetailsEditor rows={details} onChange={setDetails} />
      </Section>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save lead'}</button>
      </div>
    </form>
  );
}

function ServiceBadge({ service, label }) {
  const meta = SERVICE_META[service];
  if (!meta) return null;
  const Icon = meta.icon;
  return <Pill tone={meta.tone}><span className="inline-flex items-center gap-1"><Icon className="h-3 w-3" />{label}</span></Pill>;
}

function LeadCard({ lead, label, onOpen }) {
  const overdue = lead.next_follow_up && dayOf(lead.next_follow_up) < today();
  return (
    <button type="button" onClick={() => onOpen(lead)} className="block w-full rounded-xl border bg-white p-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-tertiary-900">{lead.name}</div>
        <span className="shrink-0 text-[10px] font-medium text-tertiary-400">{lead.code}</span>
      </div>
      {(lead.company || lead.party) && <div className="mt-0.5 text-xs text-tertiary-500">{lead.party?.name || lead.company}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ServiceBadge service={lead.service_type} label={label(lead.service_type)} />
        {lead.estimated_value ? <span className="text-xs font-medium text-primary-700">₹{compact(lead.estimated_value)}</span> : null}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-tertiary-400">
        <span className="truncate">{lead.assignee?.name || lead.owner?.name || 'Unassigned'}</span>
        {lead.next_follow_up && (
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 ${overdue ? 'bg-red-50 text-red-700' : 'bg-primary-50 text-primary-700'}`}>
            <CalendarClock className="h-3 w-3" />{dateLabel(lead.next_follow_up)}
          </span>
        )}
      </div>
    </button>
  );
}

function ActivityPanel({ lead, canEdit, onChanged }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ kind: 'call', summary: '', follow_up_date: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => zephyrApi.leadActivities(lead.id).then(setRows, (e) => pushError(zephyrError(e), 'Could not load activity')), [lead.id, pushError]);
  useEffect(() => {
    setRows(null);
    load();
  }, [load, lead.stage]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await zephyrApi.addLeadActivity(lead.id, { kind: form.kind, summary: form.summary.trim(), follow_up_date: form.follow_up_date || null });
      setForm({ kind: 'call', summary: '', follow_up_date: '' });
      await load();
      onChanged();
    } catch (err) {
      pushError(zephyrError(err, 'Could not add activity'), 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(a) {
    try {
      await zephyrApi.setFollowUpDone(lead.id, a.id, !a.follow_up_done);
      await load();
      onChanged();
    } catch (err) {
      pushError(zephyrError(err), 'Could not update');
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Activity and follow-ups</h3>
      {canEdit && (
        <form onSubmit={add} className="grid gap-2 rounded-xl border bg-primary-50/40 p-3 sm:grid-cols-[8rem_1fr_9rem_auto] sm:items-end">
          <label className={labelCls}>Type<select className={inputCls} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
          <label className={labelCls}>What happened<input className={inputCls} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} required maxLength={1000} /></label>
          <label className={labelCls}>Follow up on<input type="date" className={inputCls} min={today()} value={form.follow_up_date} onChange={(e) => setForm({ ...form, follow_up_date: e.target.value })} /></label>
          <button type="submit" className="btn-primary" disabled={busy || !form.summary.trim()}>Add</button>
        </form>
      )}
      {rows === null && <div className="text-sm text-tertiary-500">Loading…</div>}
      {rows?.length === 0 && <div className="rounded-xl border border-dashed p-4 text-center text-sm text-tertiary-400">Nothing logged yet.</div>}
      <ul className="space-y-2">
        {rows?.map((a) => (
          <li key={a.id} className="flex items-start gap-3 rounded-xl border bg-white p-3">
            <span className="mt-0.5 rounded-lg bg-primary-50 px-2 py-0.5 text-[11px] font-medium capitalize text-primary-700">{a.kind}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-tertiary-900">{a.summary}</div>
              <div className="mt-0.5 text-xs text-tertiary-400">{a.author || 'System'} · {new Date(a.created_at).toLocaleString()}</div>
              {a.follow_up_date && (
                <div className={`mt-1 inline-flex items-center gap-1 text-xs ${a.follow_up_done ? 'text-tertiary-400 line-through' : dayOf(a.follow_up_date) < today() ? 'text-red-600' : 'text-primary-700'}`}>
                  <AlarmClock className="h-3 w-3" />Follow up {dateLabel(a.follow_up_date)}
                </div>
              )}
            </div>
            {a.follow_up_date && canEdit && (
              <button type="button" onClick={() => toggle(a)} className={`rounded-lg p-1.5 ${a.follow_up_done ? 'text-primary-600' : 'text-tertiary-400 hover:bg-primary-50 hover:text-primary-700'}`} aria-label={a.follow_up_done ? 'Mark follow-up open' : 'Mark follow-up done'}>
                <Check className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Detail({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div>
      <dt className="text-xs text-tertiary-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-tertiary-900">{children}</dd>
    </div>
  );
}

export default function ZephyrLeadsPage() {
  const { me, loading } = useZephyr();
  const { pushError, pushSuccess } = useAlerts();
  const { services, label: serviceLabel, active: activeServices } = useServiceTypes();
  const [view, setView] = useState('board');
  const [filters, setFilters] = useState({ service_type: '', stage: '', assignee_id: '', location: '', from: '', to: '' });
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [dLocation, setDLocation] = useState('');
  const [leads, setLeads] = useState([]);
  const [summary, setSummary] = useState(null);
  const [followUps, setFollowUps] = useState([]);
  const [owners, setOwners] = useState([]);
  const [parties, setParties] = useState([]);
  const [people, setPeople] = useState([]);
  const [drawer, setDrawer] = useState(null); // { mode: view | edit | create, lead? }
  const [saving, setSaving] = useState(false);
  const [lostFor, setLostFor] = useState(null);
  const [lostReason, setLostReason] = useState('');
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
    const params = {
      ...(filters.service_type ? { service_type: filters.service_type } : {}),
      ...(filters.stage ? { stage: filters.stage } : {}),
      ...(filters.assignee_id ? { assignee_id: filters.assignee_id } : {}),
      ...(dLocation ? { location: dLocation } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      ...(dq ? { q: dq } : {}),
    };
    try {
      const [rows, sum, fu] = await Promise.all([zephyrApi.leads(params), zephyrApi.leadSummary(), zephyrApi.leadFollowUps()]);
      if (id !== reqId.current) return;
      setLeads(rows);
      setSummary(sum);
      setFollowUps(fu);
    } catch (e) {
      if (id === reqId.current) pushError(zephyrError(e, 'Could not load leads'), 'Load failed');
    }
  }, [filters.service_type, filters.stage, filters.assignee_id, filters.from, filters.to, dLocation, dq, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    zephyrApi.leadOwners().then(setOwners, () => setOwners([]));
    zephyrApi.parties({ status: 'active', limit: 200 }).then((r) => setParties(r.data.filter((p) => p.kind !== 'vendor')), () => setParties([]));
    zephyrApi.people({ status: 'active' }).then(setPeople, () => setPeople([]));
  }, []);

  const employees = useMemo(() => people.filter((p) => p.kind === 'employee'), [people]);
  const contractors = useMemo(() => people.filter((p) => p.kind === 'contractor'), [people]);
  const boardStages = filters.stage ? LEAD_STAGES.filter((s) => s.key === filters.stage) : LEAD_STAGES;
  const byStage = useMemo(() => Object.fromEntries(LEAD_STAGES.map((s) => [s.key, leads.filter((l) => l.stage === s.key)])), [leads]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'leads')) return <Navigate to="/zephyr" replace />;
  const isAdmin = zxCan(me, 'settings');
  const canDelete = zxCan(me, 'delete');
  const lead = drawer?.lead;
  const closed = lead && DONE_STAGE_KEYS.includes(lead.stage);

  function openLead(l) {
    setLostFor(null);
    setLostReason('');
    setDrawer({ mode: 'view', lead: l });
  }

  async function run(action, success, fail = 'Could not save') {
    setSaving(true);
    try {
      const result = await action();
      if (success) pushSuccess(success);
      await load();
      return result;
    } catch (e) {
      pushError(zephyrError(e, fail), fail);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function save(values) {
    const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]));
    body.name = values.name;
    body.details = values.details;
    for (const key of MONEY_KEYS) if (body[key] !== null) body[key] = Number(body[key]);
    if (drawer.mode === 'create') {
      for (const key of ['owner_id', 'assignee_id', 'contractor_id']) if (!body[key]) delete body[key];
    }
    const saved = await run(() => (drawer.mode === 'create' ? zephyrApi.createLead(body) : zephyrApi.updateLead(lead.id, body)), drawer.mode === 'create' ? 'Lead added' : 'Saved');
    if (saved) setDrawer({ mode: 'view', lead: saved });
  }

  async function move(stage, reason) {
    const saved = await run(() => zephyrApi.moveLead(lead.id, { stage, ...(reason ? { lost_reason: reason } : {}) }), `Moved to ${STAGE_META[stage].label}`, 'Could not move lead');
    if (saved) {
      setLostFor(null);
      setLostReason('');
      setDrawer({ mode: 'view', lead: saved });
    }
  }

  async function reopen() {
    const reason = window.prompt('Why is this lead being reopened?');
    if (!reason?.trim()) return;
    const saved = await run(() => zephyrApi.reopenLead(lead.id, { stage: 'negotiation', reason: reason.trim() }), 'Lead reopened', 'Could not reopen');
    if (saved) setDrawer({ mode: 'view', lead: saved });
  }

  async function convert() {
    if (!window.confirm('Create a project from this won lead? The lead stays on record.')) return;
    const project = await run(() => zephyrApi.projectFromLead(lead.id), 'Project created', 'Could not create the project');
    if (project) {
      const fresh = await zephyrApi.lead(lead.id).catch(() => null);
      setDrawer({ mode: 'view', lead: fresh || { ...lead, project_id: project.id }, projectId: project.id });
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${lead.name}?`)) return;
    const done = await run(() => zephyrApi.deleteLead(lead.id), 'Deleted', 'Could not delete');
    if (done) setDrawer(null);
  }

  async function refreshLead() {
    await load();
    try {
      const fresh = await zephyrApi.lead(lead.id);
      setDrawer({ mode: 'view', lead: fresh });
    } catch {
      /* the lead may have been removed */
    }
  }

  const columns = [
    { key: 'code', header: 'ID', render: (r) => <span className="text-xs font-medium text-tertiary-500">{r.code}</span> },
    { key: 'name', header: 'Lead', render: (r) => <span className="font-medium text-tertiary-900">{r.name}</span> },
    { key: 'service', header: 'Service', render: (r) => <ServiceBadge service={r.service_type} label={serviceLabel(r.service_type)} /> },
    { key: 'stage', header: 'Stage', render: (r) => <Pill tone={STAGE_META[r.stage]?.tone}>{STAGE_META[r.stage]?.label}</Pill> },
    { key: 'party', header: 'Client', render: (r) => r.party?.name || r.company || '—' },
    { key: 'value', header: 'Value', render: (r) => (r.estimated_value ? `₹${money(r.estimated_value)}` : '—') },
    { key: 'location', header: 'Location', render: (r) => r.location || r.city || '—' },
    { key: 'assignee', header: 'Assigned to', render: (r) => r.assignee?.name || r.owner?.name || '—' },
    { key: 'fu', header: 'Next follow-up', render: (r) => (r.next_follow_up ? dateLabel(r.next_follow_up) : '—') },
  ];

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open pipeline" value={`₹${compact(summary?.open_value)}`} hint={`${summary?.open_count ?? 0} open leads`} />
        <StatCard label="Won value" value={`₹${compact(summary?.won_value)}`} />
        <StatCard label="Win rate" value={summary?.win_rate == null ? '—' : `${summary.win_rate}%`} hint="won / (won + dropped)" />
        <StatCard label="Follow-ups due" value={summary?.follow_ups_due ?? 0} hint="today and overdue" tone={summary?.follow_ups_due ? 'warning' : undefined} />
      </div>

      {followUps.length > 0 && (
        <section className="rounded-2xl border bg-white p-3 shadow-soft">
          <h3 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><AlarmClock className="h-4 w-4 text-primary-600" />Follow-ups due in the next 7 days</h3>
          <ul className="grid gap-2 md:grid-cols-2">
            {followUps.slice(0, 6).map((f) => (
              <li key={f.id} className="flex items-center gap-3 rounded-xl border px-3 py-2">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openLead(leads.find((l) => l.id === f.lead.id) || { ...f.lead, id: f.lead.id })}>
                  <div className="truncate text-sm font-medium text-tertiary-900">{f.lead.name}</div>
                  <div className="truncate text-xs text-tertiary-500">{f.summary}</div>
                </button>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${f.overdue ? 'bg-red-50 text-red-700' : 'bg-primary-50 text-primary-700'}`}>{f.overdue ? 'Overdue · ' : ''}{dateLabel(f.follow_up_date)}</span>
                <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-primary-50 hover:text-primary-700" aria-label="Mark done" onClick={() => run(() => zephyrApi.setFollowUpDone(f.lead.id, f.id, true), null)}><Check className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-start gap-3">
        <div className="inline-flex overflow-hidden rounded-xl border bg-white text-sm">
          {[['board', 'Board', Kanban], ['list', 'List', List]].map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setView(key)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 ${view === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-primary-50'}`}><Icon className="h-4 w-4" />{label}</button>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <FilterBar
            q={q}
            onQ={setQ}
            searchPlaceholder="Search leads…"
            searchLabel="Search leads"
            fields={[
              { key: 'service_type', label: 'Service', type: 'select', any: `All services (${summary?.total ?? 0})`, options: services.map((x) => ({ value: x.key, label: `${x.label} (${summary?.by_service?.[x.key]?.count ?? 0})` })) },
              { key: 'stage', label: 'Stage', type: 'select', any: 'All stages', options: LEAD_STAGES.map((x) => ({ value: x.key, label: `${x.label} (${summary?.by_stage?.[x.key]?.count ?? 0})` })) },
              { key: 'assignee_id', label: 'Assigned employee', type: 'select', any: 'All employees', options: employees.map((x) => ({ value: x.id, label: x.name })) },
              { key: 'location', label: 'Location', placeholder: 'City or area' },
              { key: 'from', label: 'Created from', type: 'date' },
              { key: 'to', label: 'Created to', type: 'date', min: filters.from || undefined },
            ]}
            values={filters}
            defaults={{}}
            onChange={(key, value) => setFilters((f) => ({ ...f, [key]: value }))}
            onReset={() => { setFilters({ service_type: '', stage: '', assignee_id: '', location: '', from: '', to: '' }); setQ(''); }}
          >
            <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'create' })}><Plus className="h-4 w-4" />New lead</button>
          </FilterBar>
        </div>
      </div>

      {view === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {boardStages.map((s) => (
            <section key={s.key} className="w-64 shrink-0 rounded-2xl border bg-primary-50/40 p-2.5">
              <header className="mb-2 flex items-center justify-between px-1">
                <Pill tone={s.tone}>{s.short || s.label}</Pill>
                <span className="text-xs text-tertiary-500">{byStage[s.key].length}{summary?.by_stage?.[s.key]?.value ? ` · ₹${compact(summary.by_stage[s.key].value)}` : ''}</span>
              </header>
              <div className="space-y-2">
                {byStage[s.key].map((l) => <LeadCard key={l.id} lead={l} label={serviceLabel} onOpen={openLead} />)}
                {byStage[s.key].length === 0 && <div className="rounded-xl border border-dashed p-3 text-center text-xs text-tertiary-400">Empty</div>}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <DataTable columns={columns} rows={leads} emptyLabel="No leads match" onRowClick={openLead} maxHeight="60vh" />
      )}

      <Drawer
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        size="xl"
        tone={drawer?.mode === 'create' ? 'create' : drawer?.mode === 'edit' ? 'edit' : 'default'}
        title={drawer?.mode === 'create' ? 'New lead' : drawer?.mode === 'edit' ? `Edit ${lead?.name}` : lead?.name || ''}
      >
        {drawer && drawer.mode !== 'view' && (
          <LeadForm
            key={lead?.id || 'new'}
            initial={drawer.mode === 'edit' ? lead : null}
            owners={owners}
            parties={parties}
            employees={employees}
            contractors={contractors}
            services={activeServices}
            saving={saving}
            onSubmit={save}
            onCancel={() => setDrawer(drawer.mode === 'edit' ? { mode: 'view', lead } : null)}
          />
        )}
        {drawer?.mode === 'view' && lead && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex flex-wrap items-center gap-2">
                <Pill tone={STAGE_META[lead.stage]?.tone}>{STAGE_META[lead.stage]?.label}</Pill>
                <ServiceBadge service={lead.service_type} label={serviceLabel(lead.service_type)} />
                <span className="text-xs font-medium text-tertiary-400">{lead.code}</span>
              </span>
              <span className="inline-flex flex-wrap gap-2">
                {!closed && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'edit', lead })}><Pencil className="h-4 w-4" />Edit</button>}
                {lead.stage === 'won' && lead.project_id && <Link to={`/zephyr/projects/${lead.project_id}`} className="btn-secondary inline-flex items-center gap-1.5"><HardHat className="h-4 w-4" />Open project</Link>}
                {lead.stage === 'won' && !lead.project_id && zxCan(me, 'projectsEdit') && <button type="button" className="btn-primary inline-flex items-center gap-1.5" disabled={saving} onClick={convert}><HardHat className="h-4 w-4" />Convert to project</button>}
                {closed && isAdmin && !lead.project_id && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={reopen}><RotateCcw className="h-4 w-4" />Reopen</button>}
                {canDelete && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={remove}><Trash2 className="h-4 w-4" />Delete</button>}
              </span>
            </div>

            {!closed && (
              <div className="rounded-xl border bg-primary-50/40 p-3">
                <div className="mb-2 text-xs font-medium text-tertiary-600">Move to stage</div>
                <div className="flex flex-wrap gap-2">
                  {LEAD_STAGES.filter((s) => s.key !== lead.stage).map((s) => (
                    <button key={s.key} type="button" disabled={saving} className={`rounded-full border px-3 py-1 text-xs font-medium hover:border-primary-400 ${s.key === 'won' ? 'text-green-700' : s.key === 'dropped' ? 'text-red-700' : 'text-tertiary-700'}`} onClick={() => (s.key === 'dropped' ? setLostFor(lead.id) : move(s.key))}>{s.short || s.label}</button>
                  ))}
                </div>
                {lostFor === lead.id && (
                  <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); move('dropped', lostReason.trim()); }}>
                    <input className={inputCls} placeholder="Why is it being dropped?" value={lostReason} onChange={(e) => setLostReason(e.target.value)} required maxLength={500} autoFocus />
                    <button type="submit" className="btn-primary mt-1" disabled={!lostReason.trim() || saving}>Drop lead</button>
                  </form>
                )}
              </div>
            )}
            {lead.stage === 'dropped' && lead.lost_reason && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">Dropped: {lead.lost_reason}</div>}

            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Client">{lead.party?.name}</Detail>
              <Detail label="Company">{lead.company}</Detail>
              <Detail label="Contact">{[lead.contact_name, lead.phone, lead.email].filter(Boolean).join(' · ')}</Detail>
              <Detail label="Source">{lead.source}</Detail>
              <Detail label="Lead owner">{lead.owner?.name}</Detail>
              <Detail label="Assigned employee">{lead.assignee?.name}</Detail>
              <Detail label="Assigned contractor">{lead.contractor?.name}</Detail>
              <Detail label="Address">{[lead.address, lead.city, lead.state].filter(Boolean).join(', ')}</Detail>
              <Detail label="Location / site">{lead.location}</Detail>
              <Detail label="Property / project reference">{lead.property_ref}</Detail>
              <Detail label="Estimated value">{lead.estimated_value ? `₹${money(lead.estimated_value)}` : null}</Detail>
              <Detail label="Expected profit">{lead.expected_profit !== null && lead.expected_profit !== undefined ? `₹${money(lead.expected_profit)}${lead.expected_margin_pct !== null ? ` (${lead.expected_margin_pct}% margin)` : ''}` : null}</Detail>
              <Detail label="Expected start">{lead.expected_start ? dateLabel(lead.expected_start) : null}</Detail>
              <Detail label="Expected end">{lead.expected_end ? dateLabel(lead.expected_end) : null}</Detail>
              <div className="sm:col-span-2"><Detail label="Description"><span className="whitespace-pre-wrap">{lead.description}</span></Detail></div>
              <div className="sm:col-span-2"><Detail label="Notes"><span className="whitespace-pre-wrap">{lead.notes}</span></Detail></div>
            </dl>
            {Array.isArray(lead.details) && lead.details.length > 0 && (
              <section>
                <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Deal details</h3>
                <dl className="grid gap-3 rounded-xl border bg-white p-3 sm:grid-cols-2">
                  {lead.details.map((d, i) => <Detail key={i} label={d.label}>{d.value}</Detail>)}
                </dl>
              </section>
            )}

            <ActivityPanel lead={lead} canEdit={!closed} onChanged={refreshLead} />
            <ZephyrDocuments ownerType="lead" ownerId={lead.id} canEdit />
          </div>
        )}
      </Drawer>
    </div>
  );
}
