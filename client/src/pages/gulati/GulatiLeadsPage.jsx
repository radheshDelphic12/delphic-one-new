import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, LayoutGrid, List, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { gulatiApi, gulatiError } from '../../lib/gulati/api.js';
import { useGulati, gxCan } from '../../lib/gulati/useGulati.js';
import { DONE_STAGES, LEAD_STAGES, OPEN_STAGES, STAGE_META, qtyLabel, useMasters } from '../../lib/gulati/meta.js';
import { usePickers } from '../../lib/gulati/pickers.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import GulatiDocuments from '../../components/gulati/GulatiDocuments.jsx';
import { Area, DateInput, Detail, Money, Num, Section, Select, Text, card, dayOf, today, toBody } from '../../components/gulati/ui.jsx';
import { dateLabel } from '../../lib/format.js';

const KINDS = [{ value: 'call', label: 'Call' }, { value: 'visit', label: 'Visit' }, { value: 'meeting', label: 'Meeting' }, { value: 'note', label: 'Note' }];
const NUMS = ['quantity', 'expected_purchase_amount', 'expected_sale_amount', 'expected_margin'];
const FIELDS = ['name', 'trading_type', 'party_id', 'vendor_id', 'contact_name', 'phone', 'email', 'location', 'source', 'owner_id', 'assignee_id', 'contractor_id', 'product', 'material_type', 'quantity', 'unit', 'expected_purchase_amount', 'expected_sale_amount', 'expected_margin', 'expected_start', 'expected_end', 'description', 'notes'];
const stageTone = (s) => STAGE_META[s]?.tone || 'gray';

function LeadForm({ initial, pickers, masters, canOwner, onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, initial?.[k] ?? (k === 'trading_type' ? masters.activeTypes[0]?.key || '' : '')])));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const autoMargin = v.expected_sale_amount !== '' && v.expected_purchase_amount !== '' ? Number(v.expected_sale_amount) - Number(v.expected_purchase_amount) : null;
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
        <Text label="Lead / deal name" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} autoFocus />
        <Select label="Trading type" value={v.trading_type} onChange={set('trading_type')} options={masters.activeTypes.map((t) => ({ value: t.key, label: t.label }))} required />
        <Text label="Lead source" value={v.source} onChange={set('source')} maxLength={120} placeholder="Referral, call, exhibition..." />
        <Select label="Client" value={v.party_id} onChange={set('party_id')} options={pickers.clients} blank="No client yet" />
        <Select label="Vendor (if known)" value={v.vendor_id} onChange={set('vendor_id')} options={pickers.vendors} blank="No vendor yet" />
        <Text label="Contact person" value={v.contact_name} onChange={set('contact_name')} maxLength={200} />
        <Text label="Phone" value={v.phone} onChange={set('phone')} maxLength={40} />
        <Text label="Email" type="email" value={v.email} onChange={set('email')} maxLength={200} />
        <Text label="Location" value={v.location} onChange={set('location')} maxLength={200} />
        <Select label="Assigned employee" value={v.assignee_id} onChange={set('assignee_id')} options={pickers.employees} blank="Unassigned" />
        <Select label="Assigned contractor" value={v.contractor_id} onChange={set('contractor_id')} options={pickers.contractors} blank="None" />
        {canOwner && <Select label="Lead owner" value={v.owner_id} onChange={set('owner_id')} options={pickers.owners} blank="Me" />}
      </Section>
      <Section title="Trading information" hint="All optional: fill what is known now, add the rest as the deal firms up.">
        <Text label="Product / material" value={v.product} onChange={set('product')} maxLength={200} placeholder="Copper Cathode" />
        <Text label="Material type / grade" value={v.material_type} onChange={set('material_type')} maxLength={200} />
        <Num label="Quantity" value={v.quantity} onChange={set('quantity')} />
        <Select label="Unit" value={v.unit} onChange={set('unit')} options={masters.activeUnits.map((u) => ({ value: u.name, label: u.name }))} blank="Select unit" />
        <Num label="Expected purchase amount" value={v.expected_purchase_amount} onChange={set('expected_purchase_amount')} />
        <Num label="Expected sale amount" value={v.expected_sale_amount} onChange={set('expected_sale_amount')} />
        <Num label="Expected margin" value={v.expected_margin} onChange={set('expected_margin')} hint={autoMargin !== null ? `Left blank = sale - purchase = ${autoMargin.toLocaleString('en-IN')}` : 'Left blank = sale - purchase'} />
        <div />
        <DateInput label="Expected start" value={v.expected_start} onChange={set('expected_start')} />
        <DateInput label="Expected completion" value={v.expected_end} onChange={set('expected_end')} />
      </Section>
      <Section title="Deal description" hint="What the client wants, material, quantity, source and delivery requirements, location, commercial and payment terms, special conditions.">
        <Area label="Deal description / details" className="sm:col-span-2" rows={10} value={v.description} onChange={set('description')} maxLength={20000} />
        <Area label="Internal notes" className="sm:col-span-2" rows={3} value={v.notes} onChange={set('notes')} maxLength={4000} />
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
  const load = useCallback(() => gulatiApi.leadActivities(lead.id).then(setRows, () => setRows([])), [lead.id]);
  useEffect(() => { load(); }, [load]);
  async function add(e) {
    e.preventDefault();
    try {
      await gulatiApi.addLeadActivity(lead.id, { kind: f.kind, summary: f.summary.trim(), ...(f.follow_up_date ? { follow_up_date: f.follow_up_date } : {}) });
      setF({ kind: 'note', summary: '', follow_up_date: '' });
      load();
      reload();
    } catch (err) {
      pushError(gulatiError(err, 'Could not add'), 'Could not add');
    }
  }
  async function toggle(a) {
    try {
      await gulatiApi.updateLeadActivity(lead.id, a.id, { follow_up_done: !a.follow_up_done });
      load();
      reload();
    } catch (err) {
      pushError(gulatiError(err), 'Could not update');
    }
  }
  async function del(a) {
    try {
      await gulatiApi.deleteLeadActivity(lead.id, a.id);
      load();
    } catch (err) {
      pushError(gulatiError(err), 'Could not delete');
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

export default function GulatiLeadsPage() {
  const { me, loading } = useGulati();
  const { pushError, pushSuccess } = useAlerts();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const masters = useMasters();
  const pickers = usePickers();
  const [view, setView] = useState('board');
  const [f, setF] = useState({ stage: params.get('stage') || 'open', trading_type: params.get('trading_type') || '', party_id: '', vendor_id: '', assignee_id: '', location: '', from: '', to: '' });
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
      const [list, sum, fu] = await Promise.all([gulatiApi.leads(query), gulatiApi.leadSummary(), gulatiApi.leadFollowUps()]);
      if (id === reqId.current) { setRows(list); setSummary(sum); setFollowUps(fu); }
    } catch (e) {
      if (id === reqId.current) pushError(gulatiError(e, 'Could not load leads'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [f, dq, pushError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setParams((p) => { const n = new URLSearchParams(p); ['stage', 'trading_type'].forEach((k) => (f[k] && !(k === 'stage' && f.stage === 'open') ? n.set(k, f[k]) : n.delete(k))); return n; }, { replace: true }); }, [f.stage, f.trading_type]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!gxCan(me, 'leads')) return <Navigate to="/gulati" replace />;
  const isAdmin = me.role === 'admin';
  const canDeal = gxCan(me, 'dealsEdit');
  const setField = (k, v) => setF((c) => ({ ...c, [k]: v }));
  const lead = drawer?.lead;

  async function refreshLead(id) {
    const fresh = await gulatiApi.lead(id);
    setDrawer((d) => (d ? { ...d, lead: fresh } : d));
    load();
  }
  async function save(body) {
    setSaving(true);
    try {
      if (drawer.mode === 'create') {
        const created = await gulatiApi.createLead(body);
        pushSuccess(`${created.code} created`);
        setDrawer({ mode: 'view', lead: created });
      } else {
        const reason = isAdmin && DONE_STAGES.includes(drawer.lead.stage) ? window.prompt('This lead is closed. Reason for the admin edit:') : undefined;
        if (isAdmin && DONE_STAGES.includes(drawer.lead.stage) && !reason) { setSaving(false); return; }
        const updated = await gulatiApi.updateLead(drawer.lead.id, { ...body, ...(reason ? { reason } : {}) });
        pushSuccess('Saved');
        setDrawer({ mode: 'view', lead: updated });
      }
      load();
    } catch (e) {
      pushError(gulatiError(e, 'Could not save'), 'Could not save');
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
      await gulatiApi.moveLead(lead.id, { stage, ...(lost_reason ? { lost_reason: lost_reason.trim() } : {}) });
      await refreshLead(lead.id);
    } catch (e) {
      pushError(gulatiError(e, 'Could not move'), 'Could not move');
    }
  }
  async function reopen() {
    const reason = window.prompt('Reason for reopening this lead:');
    if (!reason?.trim()) return;
    try {
      await gulatiApi.reopenLead(lead.id, { stage: 'negotiation', reason: reason.trim() });
      await refreshLead(lead.id);
    } catch (e) {
      pushError(gulatiError(e, 'Could not reopen'), 'Could not reopen');
    }
  }
  async function convert() {
    try {
      const deal = await gulatiApi.convertLead(lead.id, {});
      pushSuccess(`Created trading deal ${deal.code}`);
      navigate(`/gulati/deals/${deal.id}`);
    } catch (e) {
      pushError(gulatiError(e, 'Could not convert'), 'Could not convert');
    }
  }
  async function remove() {
    if (!window.confirm(`Delete ${lead.name}?`)) return;
    try {
      await gulatiApi.deleteLead(lead.id);
      setDrawer(null);
      load();
    } catch (e) {
      pushError(gulatiError(e, 'Could not delete'), 'Delete failed');
    }
  }

  const columns = [
    { key: 'name', header: 'Lead', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code} · {masters.typeLabel(r.trading_type)}</span></span> },
    { key: 'stage', header: 'Stage', render: (r) => <Pill tone={stageTone(r.stage)}>{STAGE_META[r.stage]?.label || r.stage}</Pill> },
    { key: 'client', header: 'Client', render: (r) => r.party?.name || '-' },
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor?.name || '-' },
    { key: 'qty', header: 'Quantity', render: (r) => qtyLabel(r.quantity, r.unit) },
    { key: 'sale', header: 'Expected sale', render: (r) => (r.expected_sale_amount ? <Money v={r.expected_sale_amount} /> : '-') },
    { key: 'margin', header: 'Margin', render: (r) => (r.expected_margin !== null ? <Money v={r.expected_margin} signed /> : '-') },
    { key: 'assignee', header: 'Assigned', render: (r) => r.assignee?.name || r.contractor?.name || r.owner?.name || '-' },
    { key: 'follow', header: 'Next follow-up', render: (r) => (r.next_follow_up ? dateLabel(r.next_follow_up) : '-') },
  ];

  const matrix = summary?.by_trading_type ? Object.entries(summary.by_trading_type) : [];
  const stageCounts = summary?.by_stage;
  const boardStages = ['new', 'in_discussion', 'negotiation', 'sourcing', 'proposal_order', 'won'];

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {[['Total', summary?.total, ''], ['New', stageCounts?.new.count, 'new'], ['In discussion', stageCounts?.in_discussion.count, 'in_discussion'], ['Negotiation', stageCounts?.negotiation.count, 'negotiation'], ['Sourcing', stageCounts?.sourcing.count, 'sourcing'], ['Won', stageCounts?.won.count, 'won'], ['Dropped', stageCounts?.dropped.count, 'dropped'], ['On hold', stageCounts?.on_hold.count, 'on_hold']].map(([label, n, stage]) => (
          <button key={label} type="button" onClick={() => setField('stage', stage || 'all')} className={`rounded-2xl border bg-white p-3 text-left shadow-soft transition hover:border-primary-300 ${(stage || 'all') === f.stage ? 'border-primary-500' : ''}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-tertiary-500">{label}</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-tertiary-900">{n ?? '-'}</div>
          </button>
        ))}
      </div>

      {matrix.length > 0 && (
        <div className={`${card} overflow-x-auto`}>
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Pipeline by trading type</h3>
          <table className="w-full min-w-[34rem] text-sm">
            <thead><tr className="text-left text-xs text-tertiary-500"><th className="py-1 pr-3 font-medium">Trading type</th>{LEAD_STAGES.map((s) => <th key={s.value} className="px-2 py-1 text-right font-medium">{s.label}</th>)}<th className="px-2 py-1 text-right font-medium">Total</th></tr></thead>
            <tbody>
              {matrix.map(([key, m]) => (
                <tr key={key} className="border-t">
                  <td className="py-1.5 pr-3 font-medium text-tertiary-900">{m.label}</td>
                  {LEAD_STAGES.map((s) => (
                    <td key={s.value} className="px-2 py-1.5 text-right tabular-nums">
                      {m.by_stage[s.value] ? <button type="button" className="font-medium text-primary-700 hover:underline" onClick={() => setF((c) => ({ ...c, trading_type: key, stage: s.value }))}>{m.by_stage[s.value]}</button> : <span className="text-tertiary-300">0</span>}
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
              <li key={a.id}><button type="button" className="w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-primary-50" onClick={async () => setDrawer({ mode: 'view', lead: await gulatiApi.lead(a.lead.id) })}>
                <span className={a.overdue ? 'text-red-600' : 'text-tertiary-500'}>{dateLabel(a.follow_up_date)}</span> · {a.lead.name} <span className="text-tertiary-400">{a.summary}</span>
              </button></li>
            ))}
          </ul>
        </div>
      )}

      <FilterBar
        q={q}
        onQ={setQ}
        searchPlaceholder="Search lead, code, product, contact..."
        fields={[
          { key: 'stage', label: 'Stage', type: 'select', any: 'Open leads', options: [{ value: 'all', label: 'All stages' }, ...LEAD_STAGES.filter((s) => s.value !== 'closed').map((s) => ({ value: s.value, label: s.label })), { value: 'closed', label: 'Won, dropped or closed' }] },
          { key: 'trading_type', label: 'Trading type', type: 'select', any: 'Any type', options: masters.types.map((t) => ({ value: t.key, label: t.label })) },
          { key: 'party_id', label: 'Client', type: 'select', any: 'Any client', options: pickers.clients },
          { key: 'vendor_id', label: 'Vendor', type: 'select', any: 'Any vendor', options: pickers.vendors },
          { key: 'assignee_id', label: 'Employee', type: 'select', any: 'Any employee', options: pickers.employees },
          { key: 'location', label: 'Location', type: 'text', placeholder: 'City or place' },
          { key: 'from', label: 'Created from', type: 'date' },
          { key: 'to', label: 'Created to', type: 'date' },
        ]}
        values={f}
        defaults={{ stage: 'open' }}
        onChange={setField}
        onReset={() => { setF({ stage: 'open', trading_type: '', party_id: '', vendor_id: '', assignee_id: '', location: '', from: '', to: '' }); setQ(''); }}
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
                      <div className="mt-0.5 text-xs text-tertiary-500">{masters.typeLabel(r.trading_type)}{r.party ? ` · ${r.party.name}` : ''}</div>
                      <div className="mt-1 flex items-center justify-between text-xs"><span>{qtyLabel(r.quantity, r.unit)}</span>{r.expected_sale_amount ? <Money v={r.expected_sale_amount} className="gx-copper font-semibold" /> : null}</div>
                    </button>
                  ))}
                  {col.length === 0 && <div className="px-1 py-3 text-center text-xs text-tertiary-300">Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="xl" tone={drawer?.mode === 'create' ? 'create' : drawer?.mode === 'edit' ? 'edit' : 'default'} title={drawer?.mode === 'create' ? 'New lead' : drawer?.mode === 'edit' ? `Edit ${lead?.name}` : lead ? `${lead.code} · ${lead.name}` : ''}>
        {drawer && drawer.mode !== 'view' && (
          <LeadForm key={lead?.id || 'new'} initial={drawer.mode === 'edit' ? lead : null} pickers={pickers} masters={masters} canOwner={isAdmin || gxCan(me, 'dealsEdit')} saving={saving} onSubmit={save} onCancel={() => setDrawer(drawer.mode === 'edit' ? { mode: 'view', lead } : null)} />
        )}
        {drawer?.mode === 'view' && lead && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex flex-wrap items-center gap-2"><Pill tone={stageTone(lead.stage)}>{STAGE_META[lead.stage]?.label}</Pill><Pill tone="blue">{masters.typeLabel(lead.trading_type)}</Pill>{lead.deal && <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => navigate(`/gulati/deals/${lead.deal.id}`)}>Deal {lead.deal.code}</button>}</span>
              <span className="inline-flex flex-wrap gap-2">
                {(!DONE_STAGES.includes(lead.stage) || isAdmin) && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'edit', lead })}><Pencil className="h-4 w-4" />Edit</button>}
                {isAdmin && DONE_STAGES.includes(lead.stage) && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={reopen}><RotateCcw className="h-4 w-4" />Reopen</button>}
                {gxCan(me, 'delete') && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={remove}><Trash2 className="h-4 w-4" />Delete</button>}
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
                <div className="text-sm text-primary-900">This lead is won. Convert it to a trading deal: client, vendor, product, quantity, amounts, dates and description carry forward, and the lead stays for history.</div>
                <button type="button" className="btn-primary shrink-0" onClick={convert}>Convert to deal</button>
              </div>
            )}
            {lead.lost_reason && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Dropped: {lead.lost_reason}</div>}

            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Client">{lead.party?.name}</Detail>
              <Detail label="Vendor">{lead.vendor?.name}</Detail>
              <Detail label="Contact">{[lead.contact_name, lead.phone, lead.email].filter(Boolean).join(' · ')}</Detail>
              <Detail label="Location">{lead.location}</Detail>
              <Detail label="Source">{lead.source}</Detail>
              <Detail label="Owner">{lead.owner?.name}</Detail>
              <Detail label="Assigned employee">{lead.assignee?.name}</Detail>
              <Detail label="Assigned contractor">{lead.contractor?.name}</Detail>
              <Detail label="Product">{[lead.product, lead.material_type].filter(Boolean).join(' · ')}</Detail>
              <Detail label="Quantity">{lead.quantity !== null ? qtyLabel(lead.quantity, lead.unit) : null}</Detail>
              <Detail label="Expected purchase">{lead.expected_purchase_amount !== null ? <Money v={lead.expected_purchase_amount} /> : null}</Detail>
              <Detail label="Expected sale">{lead.expected_sale_amount !== null ? <Money v={lead.expected_sale_amount} /> : null}</Detail>
              <Detail label="Expected margin">{lead.expected_margin !== null ? <Money v={lead.expected_margin} signed /> : null}</Detail>
              <Detail label="Expected dates">{[lead.expected_start && dateLabel(lead.expected_start), lead.expected_end && dateLabel(lead.expected_end)].filter(Boolean).join(' to ')}</Detail>
              <Detail label="Created">{dayOf(lead.created_at)}</Detail>
              <div className="sm:col-span-2"><Detail label="Deal description"><span className="whitespace-pre-wrap">{lead.description}</span></Detail></div>
              <div className="sm:col-span-2"><Detail label="Notes"><span className="whitespace-pre-wrap">{lead.notes}</span></Detail></div>
            </dl>
            <Activities lead={lead} canEdit={!DONE_STAGES.includes(lead.stage) || isAdmin} reload={load} />
            <GulatiDocuments ownerType="lead" ownerId={lead.id} onChanged={load} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
