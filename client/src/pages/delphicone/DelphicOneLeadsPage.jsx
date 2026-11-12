import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { doxApi } from '../../lib/delphicone/api.js';
import { useDelphicOne, doxCan } from '../../lib/delphicone/useDelphicOne.js';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pill from '../../components/ui/Pill.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { inputCls, labelCls, th, thr, td, tdr, rupees, useLoad, useSave } from './ui.jsx';

const STAGE = { new: ['gray', 'New'], contacted: ['blue', 'Contacted'], demo: ['purple', 'Demo'], trial: ['amber', 'Trial'], won: ['green', 'Won'], lost: ['red', 'Lost'] };
const SOURCES = { website: 'Website', referral: 'Referral', outbound: 'Outbound', event: 'Event', partner: 'Partner', other: 'Other' };
const EMPTY = { company_name: '', contact_name: '', contact_email: '', contact_phone: '', source: 'website', stage: 'new', expected_value: 0, users_expected: '', next_followup_date: '', notes: '', lost_reason: '' };

function LeadDrawer({ lead, onClose, onSaved }) {
  const save = useSave();
  const [v, setV] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (lead) setV(lead.id ? { ...EMPTY, ...Object.fromEntries(Object.entries(lead).filter(([k]) => k in EMPTY).map(([k, x]) => [k, x ?? ''])) } : { ...EMPTY }); }, [lead]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const body = { ...v, expected_value: Number(v.expected_value) || 0, users_expected: v.users_expected === '' ? null : Number(v.users_expected), next_followup_date: v.next_followup_date || null };
    if (lead.id) delete body.stage; // the stage changes from the notes, so every move is written down
    const r = await save(() => (lead.id ? doxApi.updateLead(lead.id, body) : doxApi.createLead(body)), 'Lead saved', 'Could not save the lead');
    setBusy(false);
    if (r) { onSaved(); onClose(); }
  }
  return (
    <Drawer open={Boolean(lead)} onClose={onClose} size="lg" tone={lead?.id ? 'edit' : 'create'} title={lead?.id ? 'Edit lead' : 'New lead'} footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="dox-lead-form" className="btn-primary" disabled={busy || !v.company_name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
      </>
    }>
      <form id="dox-lead-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2" data-testid="lead-form">
        <label className={`${labelCls} sm:col-span-2`}>Company<input required className={inputCls} aria-label="Company" value={v.company_name} onChange={set('company_name')} /></label>
        <label className={labelCls}>Contact person<input className={inputCls} value={v.contact_name} onChange={set('contact_name')} /></label>
        <label className={labelCls}>Email<input type="email" className={inputCls} value={v.contact_email} onChange={set('contact_email')} /></label>
        <label className={labelCls}>Phone<input className={inputCls} value={v.contact_phone} onChange={set('contact_phone')} /></label>
        <label className={labelCls}>Where from<select className={inputCls} value={v.source} onChange={set('source')}>{Object.entries(SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={labelCls}>Expected per 30 days (₹)<input type="number" min="0" className={inputCls} value={v.expected_value} onChange={set('expected_value')} /></label>
        <label className={labelCls}>Users expected<input type="number" min="0" className={inputCls} value={v.users_expected} onChange={set('users_expected')} /></label>
        <label className={labelCls}>Follow up on<input type="date" className={inputCls} value={v.next_followup_date} onChange={set('next_followup_date')} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea rows={3} className={inputCls} value={v.notes} onChange={set('notes')} /></label>
      </form>
    </Drawer>
  );
}

function NotesDrawer({ lead, canEdit, onClose, onChanged }) {
  const save = useSave();
  const [notes, reload] = useLoad(() => (lead ? doxApi.leadNotes(lead.id) : Promise.resolve([])), [lead?.id], []);
  const [form, setForm] = useState({ note: '', stage: '', next_followup_date: '' });
  const [convert, setConvert] = useState({ trial_days: 15, plan_name: '' });
  useEffect(() => setForm({ note: '', stage: '', next_followup_date: '' }), [lead?.id]);
  async function add(e) {
    e.preventDefault();
    const r = await save(() => doxApi.addLeadNote(lead.id, { note: form.note, ...(form.stage ? { stage: form.stage } : {}), ...(form.next_followup_date ? { next_followup_date: form.next_followup_date } : {}) }), 'Note saved', 'Could not save the note');
    if (r) { setForm({ note: '', stage: '', next_followup_date: '' }); reload(); onChanged(); }
  }
  async function win() {
    const r = await save(() => doxApi.convertLead(lead.id, { trial_days: Number(convert.trial_days) || 0, plan_name: convert.plan_name || null }), 'Customer created from this lead', 'Could not convert the lead');
    if (r) { reload(); onChanged(); onClose(); }
  }
  const open = lead && !['won', 'lost'].includes(lead.stage);
  return (
    <Drawer open={Boolean(lead)} onClose={onClose} size="lg" tone="info" title={lead ? `${lead.company_name}` : ''}>
      {lead && (
        <div className="space-y-4 text-sm" data-testid="lead-drawer">
          <p className="text-xs text-tertiary-500">{[lead.contact_name, lead.contact_email, lead.contact_phone].filter(Boolean).join(' · ') || 'No contact details'} · {SOURCES[lead.source]} · <Pill tone={STAGE[lead.stage][0]}>{STAGE[lead.stage][1]}</Pill></p>
          {canEdit && open && (
            <form onSubmit={add} className="space-y-2 rounded-xl border border-tertiary-100 bg-canvas-muted p-3">
              <label className={labelCls}>What happened<textarea required rows={3} aria-label="Lead note" className={inputCls} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Called; wants a demo on Friday" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>Move to<select className={inputCls} aria-label="Move to stage" value={form.stage} onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}><option value="">Stay at {STAGE[lead.stage][1]}</option>{['new', 'contacted', 'demo', 'trial', 'lost'].filter((k) => k !== lead.stage).map((k) => <option key={k} value={k}>{STAGE[k][1]}</option>)}</select></label>
                <label className={labelCls}>Follow up on<input type="date" className={inputCls} aria-label="Follow up on" value={form.next_followup_date} onChange={(e) => setForm((f) => ({ ...f, next_followup_date: e.target.value }))} /></label>
              </div>
              <button type="submit" className="btn-primary text-xs" disabled={!form.note.trim()}>Save note</button>
            </form>
          )}
          {canEdit && open && (
            <div className="space-y-2 rounded-xl border border-success-200 bg-success-50/40 p-3">
              <p className="text-xs font-semibold text-tertiary-700">Won? Turn this lead into a customer</p>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>Trial days<input type="number" min="0" max="90" className={inputCls} value={convert.trial_days} onChange={(e) => setConvert((c) => ({ ...c, trial_days: e.target.value }))} /></label>
                <label className={labelCls}>Plan<input className={inputCls} value={convert.plan_name} onChange={(e) => setConvert((c) => ({ ...c, plan_name: e.target.value }))} placeholder="IT Services" /></label>
              </div>
              <button type="button" className="btn-primary text-xs" data-testid="convert-lead" onClick={win}>Convert to customer</button>
            </div>
          )}
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500">History ({(notes || []).length})</h4>
            <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
              {(notes || []).length === 0 && <li className="px-3 py-3 text-xs text-tertiary-500">Nothing written yet.</li>}
              {(notes || []).map((n) => (
                <li key={n.id} className="px-3 py-2" data-testid="lead-note">
                  <p className="text-xs text-tertiary-500">{new Date(n.created_at).toLocaleDateString()}{n.by ? ` · ${n.by}` : ''}{n.stage_to ? ` · → ${STAGE[n.stage_to]?.[1] || n.stage_to}` : ''}</p>
                  <p className="whitespace-pre-wrap">{n.note}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Drawer>
  );
}

export default function DelphicOneLeadsPage() {
  const { me } = useDelphicOne();
  const canEdit = doxCan(me, 'leadsEdit');
  const [filters, setFilters] = useState({ stage: '', q: '', followup: '' });
  const [rows, reload] = useLoad(() => doxApi.leads(filters), [filters.stage, filters.q, filters.followup], []);
  const [editing, setEditing] = useState(null);
  const [notesFor, setNotesFor] = useState(null);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-3" data-testid="dox-leads">
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelCls}>Search<input className={inputCls} placeholder="Company or person" value={filters.q} onChange={set('q')} /></label>
        <label className={labelCls}>Stage<select className={inputCls} aria-label="Stage" value={filters.stage} onChange={set('stage')}><option value="">All</option>{Object.entries(STAGE).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="flex items-center gap-2 pb-2 text-sm text-tertiary-700"><input type="checkbox" checked={filters.followup === 'due'} onChange={(e) => setFilters((f) => ({ ...f, followup: e.target.checked ? 'due' : '' }))} /> Follow-up due</label>
        {canEdit && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-2" data-testid="new-lead" onClick={() => setEditing({})}><Plus className="h-4 w-4" />New lead</button>}
      </div>
      {!rows ? <Skeleton className="h-40" /> : rows.length === 0 ? <EmptyState title="No leads" description="Early-access requests and prospects show here." /> : (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted"><tr><th className={th}>Lead</th><th className={th}>Stage</th><th className={th}>From</th><th className={thr}>Expected / 30 days</th><th className={th}>Follow up</th><th className={th}>Last note</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="cursor-pointer border-t border-tertiary-100 hover:bg-primary-50/40" data-testid="lead-row" onClick={() => setNotesFor(l)}>
                  <td className={`${td} font-medium`}>{l.company_name}<span className="block text-[11px] font-normal text-tertiary-500">{[l.contact_name, l.contact_email].filter(Boolean).join(' · ')}</span></td>
                  <td className={td}><Pill tone={STAGE[l.stage][0]}>{STAGE[l.stage][1]}</Pill></td>
                  <td className={td}>{SOURCES[l.source]}</td>
                  <td className={tdr}>{rupees(l.expected_value)}</td>
                  <td className={`${td} whitespace-nowrap text-xs`}>{l.next_followup_date ? <span className={l.followup_due ? 'font-semibold text-warning-700' : ''}>{l.next_followup_date}</span> : '—'}</td>
                  <td className={`${td} max-w-[16rem] truncate text-xs text-tertiary-600`}>{l.last_note || '—'}</td>
                  <td className={`${td} text-right`} onClick={(e) => e.stopPropagation()}>{canEdit && <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setEditing(l)}><Pencil className="h-3.5 w-3.5" />Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeadDrawer lead={editing} onClose={() => setEditing(null)} onSaved={reload} />
      <NotesDrawer lead={notesFor} canEdit={canEdit} onClose={() => setNotesFor(null)} onChanged={reload} />
    </div>
  );
}
