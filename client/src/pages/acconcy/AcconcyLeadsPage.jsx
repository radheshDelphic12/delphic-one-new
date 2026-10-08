import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, LayoutGrid, List, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import { DONE_STAGES, LEAD_STAGES, OPEN_STAGES, SERVICE_META, SERVICE_TYPES, STAGE_META, serviceLabel } from '../../lib/acconcy/meta.js';
import { usePickers } from '../../lib/acconcy/pickers.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import AcconcyDocuments from '../../components/acconcy/AcconcyDocuments.jsx';
import { Area, DateInput, Detail, Money, Num, Section, Select, Text, card, dayOf, today, toBody } from '../../components/acconcy/ui.jsx';
import { dateLabel } from '../../lib/format.js';

const KINDS = [{ value: 'call', label: 'Call' }, { value: 'meeting', label: 'Meeting' }, { value: 'visit', label: 'Visit' }, { value: 'note', label: 'Note' }];
const NUMS = ['expected_amount', 'expected_revenue', 'expected_profit'];
const FIELDS = ['name', 'service_type', 'party_id', 'contact_name', 'company_name', 'phone', 'email', 'location', 'source', 'owner_id', 'assignee_id', 'contractor_id', 'expected_amount', 'expected_revenue', 'expected_profit', 'expected_start', 'expected_end', 'description', 'notes'];
const EMPTY_FILTERS = { stage: 'open', service_type: '', party_id: '', assignee_id: '', contractor_id: '', source: '', location: '', from: '', to: '' };
const stageTone = (s) => STAGE_META[s]?.tone || 'gray';

function LeadForm({ initial, pickers, canOwner, onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, initial?.[k] ?? (k === 'service_type' ? SERVICE_TYPES[0].value : '')])));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = toBody(v, { numbers: NUMS });
        body.name = v.name.trim();
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <Section title="Basic information">
        <Text label="Lead name" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} autoFocus />
        <Select label="Service type" value={v.service_type} onChange={set('service_type')} options={SERVICE_TYPES.map((t) => ({ value: t.value, label: t.label }))} required />
        <Text label="Lead source" value={v.source} onChange={set('source')} maxLength={120} placeholder="Referral, website, event..." />
        <Select label="Client" value={v.party_id} onChange={set('party_id')} options={pickers.clients} blank="No client yet" />
        <Text label="Company" value={v.company_name} onChange={set('company_name')} maxLength={200} />
        <Text label="Contact person" value={v.contact_name} onChange={set('contact_name')} maxLength={200} />
        <Text label="Phone" value={v.phone} onChange={set('phone')} maxLength={40} />
        <Text label="Email" type="email" value={v.email} onChange={set('email')} maxLength={200} />
        <Text label="Location" value={v.location} onChange={set('location')} maxLength={200} />
        <Select label="Assigned employee" value={v.assignee_id} onChange={set('assignee_id')} options={pickers.employees} blank="Unassigned" />
        <Select label="Assigned contractor" value={v.contractor_id} onChange={set('contractor_id')} options={pickers.contractors} blank="None" />
        {canOwner && <Select label="Lead owner" value={v.owner_id} onChange={set('owner_id')} options={pickers.owners} blank="Me" />}
      </Section>
      <Section title="Commercial information" hint="All optional: fill what is known now, add the rest as the lead firms up.">
        <Num label="Expected amount" value={v.expected_amount} onChange={set('expected_amount')} />
        <Num label="Expected revenue" value={v.expected_revenue} onChange={set('expected_revenue')} />
        <Num label="Expected profit" value={v.expected_profit} onChange={set('expected_profit')} />
        <div />
        <DateInput label="Expected start" value={v.expected_start} onChange={set('expected_start')} />
        <DateInput label="Expected end" value={v.expected_end} onChange={set('expected_end')} />
      </Section>
      <Section title="Description / deal details" hint="Client requirement, investment opportunity, consulting requirement, transaction details, financial or valuation requirement, commercial terms, special conditions.">
        <Area label="Description / deal details" className="sm:col-span-2" rows={10} value={v.description} onChange={set('description')} maxLength={20000} />
        <Area label="Notes" className="sm:col-span-2" rows={3} value={v.notes} onChange={set('notes')} maxLength={4000} />
      </Section>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save lead'}</button>
      </div>
    </form>
  );
}

function Activities({ lead, canEdit, reload }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ kind: 'note', summary: '', follow_up_date: '' });
  const load = useCallback(() => acconcyApi.leadActivities(lead.id).then(setRows, () => setRows([])), [lead.id]);
  useEffect(() => { load(); }, [load]);
  async function add(e) {
    e.preventDefault();
    try {
      await acconcyApi.addLeadActivity(lead.id, { kind: f.kind, summary: f.summary.trim(), ...(f.follow_up_date ? { follow_up_date: f.follow_up_date } : {}) });
      setF({ kind: 'note', summary: '', follow_up_date: '' });
      load();
      reload();
    } catch (err) {
      pushError(acconcyError(err, 'Could not add'), 'Could not add');
    }
  }
  async function toggle(a) {
    try {
      await acconcyApi.updateLeadActivity(lead.id, a.id, { follow_up_done: !a.follow_up_done });
      load();
      reload();
    } catch (err) {
      pushError(acconcyError(err), 'Could not update');
    }
  }
  async function del(a) {
    try {
      await acconcyApi.deleteLeadActivity(lead.id, a.id);
      load();
    } catch (err) {
      pushError(acconcyError(err), 'Could not delete');
    }
  }
  return (
    <section className="space-y-3">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Activity and follow-ups</h3>
      {canEdit && (
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[8rem_1fr_9rem_auto] sm:items-end">
          <Select label="Type" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={KINDS} />
          <Text label="What happened" value={f.summary} onChange={(v) => setF({ ...f, summary: v })} required maxLength={1000} />
          <DateInput label="Follow up on" value={f.follow_up_date} onChange={(v) => setF({ ...f, follow_up_date: v })} min={today()} />
          <button type="submit" className="btn-primary" disabled={!f.summary.trim()}>Add</button>
        </form>
      )}
      {rows === null ? <div className="text-sm text-tertiary-500">Loading...</div> : rows.length === 0 ? <div className="rounded-xl border border-dashed p-3 text-center text-xs text-tertiary-400">No activity yet.</div> : (
        <ul className="max-h-72 divide-y overflow-y-auto rounded-xl border bg-white text-sm">
          {rows.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="text-tertiary-900"><span className="mr-1 text-xs uppercase text-tertiary-400">{a.kind}</span>{a.summary}</div>
                <div className="text-xs text-tertiary-400">{a.author || 'System'} · {dateLabel(a.created_at)}{a.follow_up_date && <span className={a.follow_up_done ? 'text-green-700' : 'text-amber-700'}> · follow up {dateLabel(a.follow_up_date)}{a.follow_up_done ? ' (done)' : ''}</span>}</div>
              </div>
              {canEdit && (
                <span className="flex shrink-0 gap-1">
                  {a.follow_up_date && <button type="button" title={a.follow_up_done ? 'Mark pending' : 'Mark done'} className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => toggle(a)}><CheckCircle2 className="h-4 w-4" /></button>}
                  <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => del(a)}><Trash2 className="h-4 w-4" /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}


export default function AcconcyLeadsPage() {
  const { me, loading } = useAcconcy();
  const { pushError, pushSuccess } = useAlerts();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const pickers = usePickers();
  const [view, setView] = useState('board');
  const [f, setF] = useState({ ...EMPTY_FILTERS, stage: params.get('stage') || 'open', service_type: params.get('service_type') || '' });
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [followUps, setFollowUps] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [drawer, setDrawer] = useState(null); // { mode: 'create' | 'edit' | 'view', lead? }
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
      const query = Object.fromEntries(Object.entries({ ...f, q: dq }).filter(([k, v]) => v && !(k === 'stage' && v === 'all')));
      // The pipeline matrix uses every filter except the stage, so its cells always show the whole pipeline for the other filters.
      const { stage: ignoredStage, ...summaryQuery } = query; // eslint-disable-line no-unused-vars
      const [list, sum, fu] = await Promise.all([acconcyApi.leads(query), acconcyApi.leadSummary(summaryQuery), acconcyApi.leadFollowUps()]);
      if (id === reqId.current) { setRows(list); setSummary(sum); setFollowUps(fu); }
    } catch (e) {
      if (id === reqId.current) pushError(acconcyError(e, 'Could not load leads'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [f, dq, pushError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setParams((p) => { const n = new URLSearchParams(p); ['stage', 'service_type'].forEach((k) => (f[k] && !(k === 'stage' && f.stage === 'open') ? n.set(k, f[k]) : n.delete(k))); return n; }, { replace: true }); }, [f.stage, f.service_type]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!axCan(me, 'leads')) return <Navigate to="/acconcy" replace />;
  const isAdmin = me.role === 'admin';
  const canDeal = axCan(me, 'dealsEdit');
  const setField = (k, v) => setF((c) => ({ ...c, [k]: v }));
  const lead = drawer?.lead;

  async function refreshLead(id) {
    const fresh = await acconcyApi.lead(id);
    setDrawer((d) => (d ? { ...d, lead: fresh } : d));
    load();
  }
  async function save(body) {
    setSaving(true);
    try {
      if (drawer.mode === 'create') {
        const created = await acconcyApi.createLead(body);
        pushSuccess(`${created.code} created`);
        setDrawer({ mode: 'view', lead: created });
      } else {
        const reason = isAdmin && DONE_STAGES.includes(drawer.lead.stage) ? window.prompt('This lead is closed. Reason for the admin edit:') : undefined;
        if (isAdmin && DONE_STAGES.includes(drawer.lead.stage) && !reason) { setSaving(false); return; }
        const updated = await acconcyApi.updateLead(drawer.lead.id, { ...body, ...(reason ? { reason } : {}) });
        pushSuccess('Saved');
        setDrawer({ mode: 'view', lead: updated });
      }
      load();
    } catch (e) {
      pushError(acconcyError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function move(stage) {
    let lost_reason;
    if (stage === 'dropped') {
      lost_reason = window.prompt('Why was this lead dropped?');
      if (!lost_reason?.trim()) return;
    }
    try {
      await acconcyApi.moveLead(lead.id, { stage, ...(lost_reason ? { lost_reason: lost_reason.trim() } : {}) });
      await refreshLead(lead.id);
    } catch (e) {
      pushError(acconcyError(e, 'Could not move'), 'Could not move');
    }
  }
  async function reopen() {
    const reason = window.prompt('Reason for reopening this lead:');
    if (!reason?.trim()) return;
    try {
      await acconcyApi.reopenLead(lead.id, { stage: 'negotiation', reason: reason.trim() });
      await refreshLead(lead.id);
    } catch (e) {
      pushError(acconcyError(e, 'Could not reopen'), 'Could not reopen');
    }
  }
  async function convert() {
    try {
      const deal = await acconcyApi.convertLead(lead.id, {});
      pushSuccess(`Created deal ${deal.code}`);
      navigate(`/acconcy/deals/${deal.id}`);
    } catch (e) {
      pushError(acconcyError(e, 'Could not convert'), 'Could not convert');
    }
  }
  async function remove() {
    if (!window.confirm(`Delete ${lead.name}?`)) return;
    try {
      await acconcyApi.deleteLead(lead.id);
      setDrawer(null);
      load();
    } catch (e) {
      pushError(acconcyError(e, 'Could not delete'), 'Delete failed');
    }
  }

  const columns = [
    { key: 'name', header: 'Lead', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}</span></span> },
    { key: 'service', header: 'Service', render: (r) => <Pill tone={SERVICE_META[r.service_type]?.tone || 'gray'}>{SERVICE_META[r.service_type]?.short || r.service_type}</Pill> },
    { key: 'stage', header: 'Stage', render: (r) => <Pill tone={stageTone(r.stage)}>{STAGE_META[r.stage]?.label || r.stage}</Pill> },
    { key: 'client', header: 'Client', render: (r) => r.party?.name || '-' },
    { key: 'amount', header: 'Expected amount', render: (r) => (r.expected_amount ? <Money v={r.expected_amount} /> : '-') },
    { key: 'revenue', header: 'Expected revenue', render: (r) => (r.expected_revenue ? <Money v={r.expected_revenue} /> : '-') },
    { key: 'assignee', header: 'Assigned', render: (r) => r.assignee?.name || r.contractor?.name || r.owner?.name || '-' },
    { key: 'location', header: 'Location', render: (r) => r.location || '-' },
    { key: 'follow', header: 'Next follow-up', render: (r) => (r.next_follow_up ? dateLabel(r.next_follow_up) : '-') },
  ];

  const matrix = summary?.by_service_type ? Object.entries(summary.by_service_type) : [];
  const stageCounts = summary?.by_stage;
  const boardStages = ['new', 'in_discussion', 'qualification', 'proposal', 'negotiation', 'won'];
  const tiles = [['Total', summary?.total, 'all'], ...['new', 'in_discussion', 'qualification', 'proposal', 'negotiation', 'won', 'dropped', 'on_hold'].map((s) => [STAGE_META[s].label, stageCounts?.[s].count, s])];

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        {tiles.map(([label, n, stage]) => (
          <button key={label} type="button" onClick={() => setField('stage', stage)} className={`rounded-2xl border bg-white p-3 text-left shadow-soft transition hover:border-primary-300 ${stage === f.stage ? 'border-primary-500' : ''}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-tertiary-500">{label}</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-tertiary-900">{n ?? '-'}</div>
          </button>
        ))}
      </div>

      {matrix.length > 0 && (
        <div className={`${card} overflow-x-auto`}>
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Pipeline by service</h3>
          <table className="w-full min-w-[40rem] text-sm">
            <thead><tr className="text-left text-xs text-tertiary-500"><th className="py-1 pr-3 font-medium">Service</th>{LEAD_STAGES.map((s) => <th key={s.value} className="px-2 py-1 text-right font-medium">{s.label}</th>)}<th className="px-2 py-1 text-right font-medium">Total</th></tr></thead>
            <tbody>
              {matrix.map(([key, m]) => (
                <tr key={key} className="border-t">
                  <td className="py-1.5 pr-3 font-medium text-tertiary-900">{m.label}</td>
                  {LEAD_STAGES.map((s) => (
                    <td key={s.value} className="px-2 py-1.5 text-right tabular-nums">
                      {m.by_stage[s.value] ? <button type="button" className="font-medium text-primary-700 hover:underline" onClick={() => setF((c) => ({ ...c, service_type: key, stage: s.value }))}>{m.by_stage[s.value]}</button> : <span className="text-tertiary-300">0</span>}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{m.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {followUps.length > 0 && (
        <div className={card}>
          <h3 className="mb-2 flex items-center gap-1.5 font-heading text-sm font-semibold text-tertiary-900"><CalendarClock className="h-4 w-4" />Follow-ups due ({followUps.length})</h3>
          <ul className="grid gap-1 sm:grid-cols-2">
            {followUps.slice(0, 6).map((a) => (
              <li key={a.id}><button type="button" className="w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-primary-50" onClick={async () => setDrawer({ mode: 'view', lead: await acconcyApi.lead(a.lead.id) })}>
                <span className={a.overdue ? 'text-red-600' : 'text-tertiary-500'}>{dateLabel(a.follow_up_date)}</span> · {a.lead.name} <span className="text-tertiary-400">{a.summary}</span>
              </button></li>
            ))}
          </ul>
        </div>
      )}

      <FilterBar
        q={q}
        onQ={setQ}
        searchPlaceholder="Search lead, code, company, contact..."
        fields={[
          { key: 'stage', label: 'Stage', type: 'select', any: 'Open leads', options: [{ value: 'all', label: 'All stages' }, ...LEAD_STAGES.filter((s) => s.value !== 'closed').map((s) => ({ value: s.value, label: s.label })), { value: 'closed', label: 'Won, dropped or closed' }] },
          { key: 'service_type', label: 'Service type', type: 'select', any: 'Any service', options: SERVICE_TYPES.map((t) => ({ value: t.value, label: t.label })) },
          { key: 'party_id', label: 'Client', type: 'select', any: 'Any client', options: pickers.clients },
          { key: 'assignee_id', label: 'Employee', type: 'select', any: 'Any employee', options: pickers.employees },
          { key: 'contractor_id', label: 'Contractor', type: 'select', any: 'Any contractor', options: pickers.contractors },
          { key: 'source', label: 'Lead source', type: 'text', placeholder: 'e.g. Referral' },
          { key: 'location', label: 'Location', type: 'text', placeholder: 'City or place' },
          { key: 'from', label: 'Created from', type: 'date' },
          { key: 'to', label: 'Created to', type: 'date' },
        ]}
        values={f}
        defaults={{ stage: 'open' }}
        onChange={setField}
        onReset={() => { setF({ ...EMPTY_FILTERS }); setQ(''); }}
      >
        <div className="inline-flex overflow-hidden rounded-xl border bg-white">
          <button type="button" aria-label="Board view" className={`px-2.5 py-2 ${view === 'board' ? 'bg-primary-50 text-primary-700' : 'text-tertiary-500'}`} onClick={() => setView('board')}><LayoutGrid className="h-4 w-4" /></button>
          <button type="button" aria-label="List view" className={`px-2.5 py-2 ${view === 'list' ? 'bg-primary-50 text-primary-700' : 'text-tertiary-500'}`} onClick={() => setView('list')}><List className="h-4 w-4" /></button>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'create' })}><Plus className="h-4 w-4" />New lead</button>
      </FilterBar>

      {view === 'list' ? (
        <DataTable columns={columns} rows={rows} loading={fetching && rows.length === 0} emptyLabel="No leads match. Create one to start the pipeline." onRowClick={(r) => setDrawer({ mode: 'view', lead: r })} maxHeight="60vh" />
      ) : (
        <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-3 xl:grid-cols-6">
          {boardStages.map((stage) => {
            const col = rows.filter((r) => r.stage === stage);
            return (
              <div key={stage} className="min-w-[13rem] rounded-2xl bg-primary-50/50 p-2">
                <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-tertiary-600">{STAGE_META[stage].label}<span className="rounded-full bg-white px-1.5 text-tertiary-500">{col.length}</span></div>
                <div className="space-y-2">
                  {col.map((r) => (
                    <button key={r.id} type="button" onClick={() => setDrawer({ mode: 'view', lead: r })} className="block w-full rounded-xl border bg-white p-2.5 text-left shadow-soft transition hover:border-primary-300">
                      <div className="text-sm font-medium text-tertiary-900">{r.name}</div>
                      <div className="mt-0.5 text-xs text-tertiary-500">{SERVICE_META[r.service_type]?.short}{r.party ? ` · ${r.party.name}` : ''}</div>
                      <div className="mt-1 flex items-center justify-end text-xs">{r.expected_amount ? <Money v={r.expected_amount} className="ax-gold font-semibold" /> : null}</div>
                    </button>
                  ))}
                  {col.length === 0 && <div className="px-1 py-3 text-center text-xs text-tertiary-300">Empty</div>}
                </div>
              </div>
            );
          })}
          {rows.some((r) => !boardStages.includes(r.stage)) && <div className="min-w-[13rem] self-start rounded-2xl border border-dashed p-3 text-xs text-tertiary-500">{rows.filter((r) => !boardStages.includes(r.stage)).length} more lead(s) are on hold, dropped or closed. Switch to the list view to see them.</div>}
        </div>
      )}

      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="xl" tone={drawer?.mode === 'create' ? 'create' : drawer?.mode === 'edit' ? 'edit' : 'default'} title={drawer?.mode === 'create' ? 'New lead' : drawer?.mode === 'edit' ? `Edit ${lead?.name}` : lead ? `${lead.code} · ${lead.name}` : ''}>
        {drawer && drawer.mode !== 'view' && (
          <LeadForm key={lead?.id || 'new'} initial={drawer.mode === 'edit' ? lead : null} pickers={pickers} canOwner={isAdmin || axCan(me, 'dealsEdit')} saving={saving} onSubmit={save} onCancel={() => setDrawer(drawer.mode === 'edit' ? { mode: 'view', lead } : null)} />
        )}
        {drawer?.mode === 'view' && lead && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex flex-wrap items-center gap-2"><Pill tone={stageTone(lead.stage)}>{STAGE_META[lead.stage]?.label}</Pill><Pill tone={SERVICE_META[lead.service_type]?.tone || 'gray'}>{serviceLabel(lead.service_type)}</Pill>{lead.deal && <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => navigate(`/acconcy/deals/${lead.deal.id}`)}>Deal {lead.deal.code}</button>}</span>
              <span className="inline-flex flex-wrap gap-2">
                {(!DONE_STAGES.includes(lead.stage) || isAdmin) && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'edit', lead })}><Pencil className="h-4 w-4" />Edit</button>}
                {isAdmin && DONE_STAGES.includes(lead.stage) && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={reopen}><RotateCcw className="h-4 w-4" />Reopen</button>}
                {axCan(me, 'delete') && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={remove}><Trash2 className="h-4 w-4" />Delete</button>}
              </span>
            </div>

            {OPEN_STAGES.includes(lead.stage) && (
              <div className="flex flex-wrap gap-2">
                {LEAD_STAGES.filter((s) => s.value !== lead.stage).map((s) => (
                  <button key={s.value} type="button" onClick={() => move(s.value)} className={`rounded-full border px-3 py-1 text-xs font-medium transition hover:border-primary-400 ${s.value === 'won' ? 'border-green-300 text-green-700' : s.value === 'dropped' ? 'border-red-200 text-red-600' : 'text-tertiary-600'}`}>Move to {s.label}</button>
                ))}
              </div>
            )}
            {lead.stage === 'won' && !lead.deal && canDeal && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary-200 bg-primary-50 p-3">
                <div className="text-sm text-primary-900">This lead is won. Convert it to a deal: client, service type, description, expected amount, assignee, contractor, dates and notes carry forward, and the lead stays for history.</div>
                <button type="button" className="btn-primary shrink-0" onClick={convert}>Convert to deal</button>
              </div>
            )}
            {lead.lost_reason && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Dropped: {lead.lost_reason}</div>}

            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Client">{lead.party?.name}</Detail>
              <Detail label="Company">{lead.company_name}</Detail>
              <Detail label="Contact">{[lead.contact_name, lead.phone, lead.email].filter(Boolean).join(' · ')}</Detail>
              <Detail label="Location">{lead.location}</Detail>
              <Detail label="Source">{lead.source}</Detail>
              <Detail label="Owner">{lead.owner?.name}</Detail>
              <Detail label="Assigned employee">{lead.assignee?.name}</Detail>
              <Detail label="Assigned contractor">{lead.contractor?.name}</Detail>
              <Detail label="Expected amount">{lead.expected_amount !== null ? <Money v={lead.expected_amount} /> : null}</Detail>
              <Detail label="Expected revenue">{lead.expected_revenue !== null ? <Money v={lead.expected_revenue} /> : null}</Detail>
              <Detail label="Expected profit">{lead.expected_profit !== null ? <Money v={lead.expected_profit} signed /> : null}</Detail>
              <Detail label="Expected dates">{[lead.expected_start && dateLabel(lead.expected_start), lead.expected_end && dateLabel(lead.expected_end)].filter(Boolean).join(' to ')}</Detail>
              <Detail label="Created">{dayOf(lead.created_at)}</Detail>
              <div className="sm:col-span-2"><Detail label="Description / deal details"><span className="whitespace-pre-wrap">{lead.description}</span></Detail></div>
              <div className="sm:col-span-2"><Detail label="Notes"><span className="whitespace-pre-wrap">{lead.notes}</span></Detail></div>
            </dl>
            <Activities lead={lead} canEdit={!DONE_STAGES.includes(lead.stage) || isAdmin} reload={load} />
            <AcconcyDocuments ownerType="lead" ownerId={lead.id} onChanged={load} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
