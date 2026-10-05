import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AlarmClock, CalendarClock, Check, HardHat, Kanban, List, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { compact, dateLabel, money } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import ZephyrDocuments from '../../components/zephyr/ZephyrDocuments.jsx';

const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'site_visit', label: 'Site visit' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
const STAGE_TONE = { new: 'blue', contacted: 'cyan', site_visit: 'purple', proposal: 'amber', negotiation: 'amber', won: 'green', lost: 'red' };
const CATEGORIES = [
  { value: 'client_project', label: 'Client project' },
  { value: 'self_project', label: 'Self project' },
  { value: 'other', label: 'Other' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const BASES = [
  { value: 'investor', label: 'Investor', field: 'Investor name' },
  { value: 'customer_deal', label: 'Customer deal', field: 'Deal name / reference' },
  { value: 'project_type', label: 'Project type', field: 'Project type' },
];
const KINDS = [
  { value: 'call', label: 'Call' },
  { value: 'visit', label: 'Site visit' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'note', label: 'Note' },
];
const EMPTY = {
  name: '', category: 'client_project', self_project_basis: '', basis_value: '', party_id: '', contact_name: '', phone: '', email: '',
  source: '', location: '', estimated_value: '', expected_close: '', owner_id: '', notes: '',
};
const FORM_KEYS = Object.keys(EMPTY);

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const today = () => new Date().toISOString().slice(0, 10);
const dayOf = (v) => (v ? String(v).slice(0, 10) : null);

function LeadForm({ initial, owners, parties, saving, onSubmit, onCancel }) {
  const [v, setV] = useState(() => ({ ...EMPTY, ...Object.fromEntries(FORM_KEYS.map((k) => [k, initial?.[k] ?? EMPTY[k]])), expected_close: dayOf(initial?.expected_close) || '' }));
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  const basis = BASES.find((b) => b.value === v.self_project_basis);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = Object.fromEntries(FORM_KEYS.map((k) => [k, typeof v[k] === 'string' ? v[k].trim() : v[k]]));
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${labelCls} sm:col-span-2`}>Lead / project name<input className={inputCls} value={v.name} onChange={set('name')} required maxLength={200} autoFocus /></label>
        <label className={labelCls}>Category<select className={inputCls} value={v.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
        <label className={labelCls}>Client<select className={inputCls} value={v.party_id} onChange={set('party_id')}><option value="">None yet</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {v.category === 'self_project' && (
          <>
            <label className={labelCls}>Self project is based on<select className={inputCls} value={v.self_project_basis} onChange={set('self_project_basis')} required><option value="">Select…</option>{BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</select></label>
            <label className={labelCls}>{basis?.field || 'Details'}<input className={inputCls} value={v.basis_value} onChange={set('basis_value')} required maxLength={200} disabled={!basis} /></label>
          </>
        )}
        <label className={labelCls}>Estimated value (INR)<input type="number" min="0" className={inputCls} value={v.estimated_value} onChange={set('estimated_value')} /></label>
        <label className={labelCls}>Expected close<input type="date" className={inputCls} value={v.expected_close} onChange={set('expected_close')} /></label>
        <label className={labelCls}>Owner<select className={inputCls} value={v.owner_id} onChange={set('owner_id')}><option value="">Me</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className={labelCls}>Source<input className={inputCls} value={v.source} onChange={set('source')} placeholder="Referral, website, site board…" maxLength={120} /></label>
        <label className={labelCls}>Contact person<input className={inputCls} value={v.contact_name} onChange={set('contact_name')} maxLength={200} /></label>
        <label className={labelCls}>Phone<input className={inputCls} value={v.phone} onChange={set('phone')} maxLength={40} /></label>
        <label className={labelCls}>Email<input type="email" className={inputCls} value={v.email} onChange={set('email')} maxLength={200} /></label>
        <label className={labelCls}>Location<input className={inputCls} value={v.location} onChange={set('location')} maxLength={200} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={3} value={v.notes} onChange={set('notes')} maxLength={2000} /></label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function LeadCard({ lead, onOpen }) {
  const overdue = lead.next_follow_up && dayOf(lead.next_follow_up) < today();
  return (
    <button type="button" onClick={() => onOpen(lead)} className="block w-full rounded-xl border bg-white p-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card">
      <div className="text-sm font-semibold text-tertiary-900">{lead.name}</div>
      {lead.party && <div className="mt-0.5 text-xs text-tertiary-500">{lead.party.name}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Pill tone={lead.category === 'self_project' ? 'purple' : 'gray'}>{CATEGORY_LABEL[lead.category]}</Pill>
        {lead.estimated_value ? <span className="text-xs font-medium text-primary-700">₹{compact(lead.estimated_value)}</span> : null}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-tertiary-400">
        <span>{lead.owner?.name || 'Unassigned'}</span>
        {lead.next_follow_up && (
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${overdue ? 'bg-red-50 text-red-700' : 'bg-primary-50 text-primary-700'}`}>
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
  const [view, setView] = useState('board');
  const [category, setCategory] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [leads, setLeads] = useState([]);
  const [summary, setSummary] = useState(null);
  const [followUps, setFollowUps] = useState([]);
  const [owners, setOwners] = useState([]);
  const [parties, setParties] = useState([]);
  const [drawer, setDrawer] = useState(null); // { mode: view | edit | create, lead? }
  const [saving, setSaving] = useState(false);
  const [lostFor, setLostFor] = useState(null);
  const [lostReason, setLostReason] = useState('');
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const [rows, sum, fu] = await Promise.all([
        zephyrApi.leads({ ...(category ? { category } : {}), ...(ownerId ? { owner_id: ownerId } : {}), ...(dq ? { q: dq } : {}) }),
        zephyrApi.leadSummary(),
        zephyrApi.leadFollowUps(),
      ]);
      if (id !== reqId.current) return;
      setLeads(rows);
      setSummary(sum);
      setFollowUps(fu);
    } catch (e) {
      if (id === reqId.current) pushError(zephyrError(e, 'Could not load leads'), 'Load failed');
    }
  }, [category, ownerId, dq, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    zephyrApi.leadOwners().then(setOwners, () => setOwners([]));
    zephyrApi.parties({ status: 'active', limit: 200 }).then((r) => setParties(r.data.filter((p) => p.kind !== 'vendor')), () => setParties([]));
  }, []);

  const byStage = useMemo(() => Object.fromEntries(STAGES.map((s) => [s.key, leads.filter((l) => l.stage === s.key)])), [leads]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'leads')) return <Navigate to="/zephyr" replace />;
  const isAdmin = zxCan(me, 'settings');
  const canDelete = zxCan(me, 'delete');
  const lead = drawer?.lead;
  const closed = lead && (lead.stage === 'won' || lead.stage === 'lost');

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
    if (body.estimated_value !== null) body.estimated_value = Number(body.estimated_value);
    if (drawer.mode === 'create' && !body.owner_id) delete body.owner_id;
    const saved = await run(() => (drawer.mode === 'create' ? zephyrApi.createLead(body) : zephyrApi.updateLead(lead.id, body)), drawer.mode === 'create' ? 'Lead added' : 'Saved');
    if (saved) setDrawer({ mode: 'view', lead: saved });
  }

  async function move(stage, reason) {
    const saved = await run(() => zephyrApi.moveLead(lead.id, { stage, ...(reason ? { lost_reason: reason } : {}) }), `Moved to ${STAGE_LABEL[stage]}`, 'Could not move lead');
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
    if (!window.confirm('Create a project from this won lead?')) return;
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
    { key: 'name', header: 'Lead', render: (r) => <span className="font-medium text-tertiary-900">{r.name}</span> },
    { key: 'stage', header: 'Stage', render: (r) => <Pill tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Pill> },
    { key: 'category', header: 'Category', render: (r) => CATEGORY_LABEL[r.category] },
    { key: 'party', header: 'Client', render: (r) => r.party?.name || '—' },
    { key: 'value', header: 'Value', render: (r) => (r.estimated_value ? `₹${money(r.estimated_value)}` : '—') },
    { key: 'close', header: 'Expected close', render: (r) => (r.expected_close ? dateLabel(r.expected_close) : '—') },
    { key: 'owner', header: 'Owner', render: (r) => r.owner?.name || '—' },
    { key: 'fu', header: 'Next follow-up', render: (r) => (r.next_follow_up ? dateLabel(r.next_follow_up) : '—') },
  ];

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open pipeline" value={`₹${compact(summary?.open_value)}`} hint={`${summary?.open_count ?? 0} open leads`} />
        <StatCard label="Won value" value={`₹${compact(summary?.won_value)}`} />
        <StatCard label="Win rate" value={summary?.win_rate == null ? '—' : `${summary.win_rate}%`} hint="won / (won + lost)" />
        <StatCard label="Follow-ups due" value={summary?.follow_ups_due ?? 0} hint="today and overdue" accent={Boolean(summary?.follow_ups_due)} />
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-xl border bg-white text-sm">
          {[['board', 'Board', Kanban], ['list', 'List', List]].map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setView(key)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 ${view === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-primary-50'}`}><Icon className="h-4 w-4" />{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads…" aria-label="Search leads" className="w-48 rounded-xl border py-1.5 pl-9 pr-3 text-sm" />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Category"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Owner"><option value="">All owners</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'create' })}><Plus className="h-4 w-4" />New lead</button>
        </div>
      </div>

      {view === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGES.map((s) => (
            <section key={s.key} className="w-64 shrink-0 rounded-2xl border bg-primary-50/40 p-2.5">
              <header className="mb-2 flex items-center justify-between px-1">
                <Pill tone={STAGE_TONE[s.key]}>{s.label}</Pill>
                <span className="text-xs text-tertiary-500">{byStage[s.key].length}{summary?.by_stage?.[s.key]?.value ? ` · ₹${compact(summary.by_stage[s.key].value)}` : ''}</span>
              </header>
              <div className="space-y-2">
                {byStage[s.key].map((l) => <LeadCard key={l.id} lead={l} onOpen={openLead} />)}
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
          <LeadForm key={lead?.id || 'new'} initial={drawer.mode === 'edit' ? lead : null} owners={owners} parties={parties} saving={saving} onSubmit={save} onCancel={() => setDrawer(drawer.mode === 'edit' ? { mode: 'view', lead } : null)} />
        )}
        {drawer?.mode === 'view' && lead && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex gap-2"><Pill tone={STAGE_TONE[lead.stage]}>{STAGE_LABEL[lead.stage]}</Pill><Pill tone={lead.category === 'self_project' ? 'purple' : 'gray'}>{CATEGORY_LABEL[lead.category]}</Pill></span>
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
                  {STAGES.filter((s) => s.key !== lead.stage).map((s) => (
                    <button key={s.key} type="button" disabled={saving} className={`rounded-full border px-3 py-1 text-xs font-medium hover:border-primary-400 ${s.key === 'won' ? 'text-green-700' : s.key === 'lost' ? 'text-red-700' : 'text-tertiary-700'}`} onClick={() => (s.key === 'lost' ? setLostFor(lead.id) : move(s.key))}>{s.label}</button>
                  ))}
                </div>
                {lostFor === lead.id && (
                  <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); move('lost', lostReason.trim()); }}>
                    <input className={inputCls} placeholder="Why was it lost?" value={lostReason} onChange={(e) => setLostReason(e.target.value)} required maxLength={500} autoFocus />
                    <button type="submit" className="btn-primary mt-1" disabled={!lostReason.trim() || saving}>Mark lost</button>
                  </form>
                )}
              </div>
            )}
            {lead.stage === 'lost' && lead.lost_reason && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">Lost: {lead.lost_reason}</div>}

            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Client">{lead.party?.name}</Detail>
              <Detail label="Owner">{lead.owner?.name}</Detail>
              <Detail label="Estimated value">{lead.estimated_value ? `₹${money(lead.estimated_value)}` : null}</Detail>
              <Detail label="Expected close">{lead.expected_close ? dateLabel(lead.expected_close) : null}</Detail>
              {lead.category === 'self_project' && <Detail label={BASES.find((b) => b.value === lead.self_project_basis)?.label || 'Basis'}>{lead.basis_value}</Detail>}
              <Detail label="Contact">{[lead.contact_name, lead.phone, lead.email].filter(Boolean).join(' · ')}</Detail>
              <Detail label="Source">{lead.source}</Detail>
              <Detail label="Location">{lead.location}</Detail>
              <div className="sm:col-span-2"><Detail label="Notes"><span className="whitespace-pre-wrap">{lead.notes}</span></Detail></div>
            </dl>

            <ActivityPanel lead={lead} canEdit={!closed} onChanged={refreshLead} />
            <ZephyrDocuments ownerType="lead" ownerId={lead.id} canEdit />
          </div>
        )}
      </Drawer>
    </div>
  );
}
