import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { confirmAction } from '../../lib/confirmAction.js';
import useSavedState from '../../lib/useSavedState.js';
import Drawer from '../../components/ui/Drawer.jsx';

const STATUS = { in_connect: ['In connect', 'bg-success-50 text-success-800'], fresh: ['Fresh', 'bg-sky-50 text-sky-800'], left: ['Left', 'bg-tertiary-100 text-tertiary-600'] };
const SOURCES = [['linkedin', 'LinkedIn'], ['event', 'Event'], ['reference', 'Reference'], ['other', 'Other']];
const KINDS = [['client', 'Client'], ['vendor', 'Vendor'], ['customer', 'Customer'], ['employee', 'Employee'], ['contractor', 'Contractor'], ['other', 'Other']];
const label = 'block text-xs font-medium text-tertiary-600';
const input = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm';
const today = () => new Date().toISOString().slice(0, 10);
const Status = ({ s }) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[s]?.[1] || ''}`}>{STATUS[s]?.[0] || s}</span>;

/**
 * Group Dashboard > Directory: the people the group knows across all companies (one person can be linked to several of our companies),
 * with status (in connect / fresh / left), source, follow-ups and when they were last contacted. The Pipeline lists the people found in
 * any company that are not in the directory yet: add them or skip them.
 */
export default function GroupDirectoryTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [view, setView] = useSavedState('groupDirectory.view', 'directory');
  const [filters, setFilters] = useSavedState('groupDirectory.filters', { q: '', status: '', kind: '', company_id: '', source: '', followup: '' });
  const [data, setData] = useState(null);
  const [pipe, setPipe] = useState(null);
  const [editing, setEditing] = useState(null);
  const [follow, setFollow] = useState(null);
  const loadDir = useCallback(() => apiClient.get('/group-directory', { params: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }).then(({ data: res }) => setData(res.data)).catch((err) => { setData({ contacts: [], counts: {}, companies: [] }); pushError(apiErrorMessage(err, 'Could not load the directory'), 'Something went wrong'); }), [filters, pushError]);
  const loadPipe = useCallback(() => apiClient.get('/group-directory/pipeline').then(({ data: res }) => setPipe(res.data)).catch(() => setPipe({ candidates: [], count: 0 })), []);
  useEffect(() => { loadDir(); }, [loadDir]);
  useEffect(() => { loadPipe(); }, [loadPipe]);
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  async function remove(c) {
    if (!await confirmAction(`Remove ${c.name} from the directory?`)) return;
    try { await apiClient.delete(`/group-directory/${c.id}`); pushSuccess('Removed'); loadDir(); } catch (err) { pushError(apiErrorMessage(err, 'Could not remove'), 'Not removed'); }
  }
  async function pipeAction(cand, action, source) {
    try {
      await apiClient.post(`/group-directory/pipeline/${action}`, { keys: action === 'skip' ? cand.keys : [cand.key], ...(source ? { source } : {}) });
      pushSuccess(action === 'add' ? `${cand.name} added to the directory` : `${cand.name} skipped`);
      loadPipe(); if (action === 'add') loadDir();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not do that'), 'Not done'); }
  }
  return (
    <div className="space-y-3" data-testid="group-directory">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-tertiary-100 bg-white p-0.5 text-sm">
          {[['directory', `Directory (${(data?.counts?.in_connect || 0) + (data?.counts?.fresh || 0) + (data?.counts?.left || 0)})`], ['pipeline', `Pipeline (${pipe?.count ?? '…'})`]].map(([k, l]) => <button key={k} type="button" onClick={() => setView(k)} data-testid={`dir-view-${k}`} className={`rounded-[10px] px-3 py-1.5 font-medium ${view === k ? 'bg-primary-600 text-white' : 'text-tertiary-600'}`}>{l}</button>)}
        </div>
        {view === 'directory' && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setEditing({})} data-testid="dir-new"><Plus className="h-4 w-4" />Add contact</button>}
      </div>

      {view === 'directory' ? (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <input value={filters.q} onChange={setF('q')} placeholder="Name, email, phone, organisation" className="w-60 rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" />
            <select value={filters.status} onChange={setF('status')} className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" aria-label="Status"><option value="">Any status</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l} ({data?.counts?.[k] ?? 0})</option>)}</select>
            <select value={filters.company_id} onChange={setF('company_id')} className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" aria-label="Company"><option value="">All companies</option>{(data?.companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select value={filters.kind} onChange={setF('kind')} className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" aria-label="Kind"><option value="">Any kind</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select value={filters.source} onChange={setF('source')} className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" aria-label="Source"><option value="">Any source</option>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <label className="flex items-center gap-1.5 text-xs text-tertiary-700"><input type="checkbox" checked={filters.followup === 'due'} onChange={(e) => setFilters((f) => ({ ...f, followup: e.target.checked ? 'due' : '' }))} /> Follow-up due</label>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
            {!data ? <p className="p-4 text-sm text-tertiary-500">Loading...</p> : data.contacts.length === 0 ? <p className="p-6 text-center text-sm text-tertiary-500">No contacts match.</p> : (
              <table className="min-w-full text-sm">
                <thead className="bg-canvas-muted text-left text-xs uppercase text-tertiary-500"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Companies</th><th className="px-3 py-2">Status / source</th><th className="px-3 py-2">Last connected</th><th className="px-3 py-2">Next follow-up</th><th /></tr></thead>
                <tbody>{data.contacts.map((c) => (
                  <tr key={c.id} className="border-t border-tertiary-100 align-top" data-testid="dir-row">
                    <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{c.name}</span><span className="block text-xs text-tertiary-500">{[c.designation, c.organisation, KINDS.find(([k]) => k === c.kind)?.[1]].filter(Boolean).join(' · ')}</span></td>
                    <td className="px-3 py-2 text-xs">{c.email || <span className="text-tertiary-400">no email</span>}<span className="block">{c.phone || <span className="text-tertiary-400">no phone</span>}</span></td>
                    <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{c.companies.map((x) => <span key={x.id} className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] text-primary-800">{x.name}</span>)}</div></td>
                    <td className="px-3 py-2"><Status s={c.status} />{c.source && <span className="ml-1 text-xs text-tertiary-500">{SOURCES.find(([k]) => k === c.source)?.[1]}</span>}</td>
                    <td className="px-3 py-2 text-xs">{c.last_connected_on || <span className="text-tertiary-400">never</span>}</td>
                    <td className={`px-3 py-2 text-xs ${c.followup_due ? 'font-semibold text-danger-600' : ''}`}>{c.next_followup_date || '-'}</td>
                    <td className="px-3 py-2"><span className="flex justify-end gap-1">
                      <button type="button" className="btn-ghost text-xs" onClick={() => setFollow(c)} data-testid="dir-followup">Follow-up</button>
                      <button type="button" aria-label="Edit" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-primary-50 hover:text-primary-700" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" aria-label="Remove" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></button>
                    </span></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-tertiary-600">New people found in the companies (client and vendor contacts, customers, employees, contractors). Add them to the directory, or skip them; a skipped person does not come back.</p>
          <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
            {!pipe ? <p className="p-4 text-sm text-tertiary-500">Loading...</p> : pipe.candidates.length === 0 ? <p className="p-6 text-center text-sm text-tertiary-500">Nobody new.</p> : (
              <table className="min-w-full text-sm">
                <thead className="bg-canvas-muted text-left text-xs uppercase text-tertiary-500"><tr><th className="px-3 py-2">Person</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Found in</th><th className="px-3 py-2">Add with source</th><th /></tr></thead>
                <tbody>{pipe.candidates.slice(0, 300).map((c) => <PipeRow key={c.key} c={c} onAct={pipeAction} />)}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
      <ContactDrawer contact={editing} companies={data?.companies || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); loadDir(); }} />
      <FollowupDrawer contact={follow} onClose={() => setFollow(null)} onSaved={() => { setFollow(null); loadDir(); }} />
    </div>
  );
}

function PipeRow({ c, onAct }) {
  const [source, setSource] = useState('');
  return (
    <tr className="border-t border-tertiary-100" data-testid="pipe-row">
      <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{c.name}</span><span className="block text-xs text-tertiary-500">{[c.designation, c.organisation].filter(Boolean).join(' · ')}</span></td>
      <td className="px-3 py-2 text-xs">{c.email || '-'}<span className="block">{c.phone || ''}</span></td>
      <td className="px-3 py-2 text-xs">{c.found_in}<div className="mt-0.5 flex flex-wrap gap-1">{c.companies.map((x) => <span key={x.id} className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] text-primary-800">{x.name}</span>)}</div></td>
      <td className="px-3 py-2"><select value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-tertiary-200 px-2 py-1 text-xs" aria-label="Source"><option value="">No source</option>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
      <td className="px-3 py-2"><span className="flex justify-end gap-1"><button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => onAct(c, 'add', source)} data-testid="pipe-add">Add</button><button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => onAct(c, 'skip')} data-testid="pipe-skip">Skip</button></span></td>
    </tr>
  );
}

function ContactDrawer({ contact, companies, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const open = contact !== null;
  const blank = { name: '', email: '', phone: '', designation: '', organisation: '', kind: 'other', company_ids: [], status: 'fresh', source: '', linkedin_url: '', last_connected_on: '', next_followup_date: '', notes: '' };
  const [v, setV] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setV(contact.id ? { ...blank, ...Object.fromEntries(Object.entries(contact).filter(([k]) => k in blank).map(([k, x]) => [k, x ?? ''])), company_ids: contact.companies.map((c) => c.id) } : blank); }, [open, contact]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault(); setSaving(true);
    const body = { ...v, source: v.source || null };
    try { if (contact.id) await apiClient.patch(`/group-directory/${contact.id}`, body); else await apiClient.post('/group-directory', body); pushSuccess('Saved'); onSaved(); } catch (err) { pushError(apiErrorMessage(err, 'Could not save'), 'Not saved'); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} title={contact?.id ? `Edit ${contact.name}` : 'Add a contact'} onClose={onClose} size="lg" tone={contact?.id ? 'edit' : 'create'} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="dir-form" className="btn-primary" disabled={saving || !v.name.trim()} data-testid="dir-save">{saving ? 'Saving...' : 'Save'}</button></>}>
      <form id="dir-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Name<input className={input} value={v.name} onChange={set('name')} required data-testid="dir-name" /></label>
        <label className={label}>Their organisation<input className={input} value={v.organisation} onChange={set('organisation')} /></label>
        <label className={label}>Email<input type="email" className={input} value={v.email} onChange={set('email')} /></label>
        <label className={label}>Phone<input className={input} value={v.phone} onChange={set('phone')} /></label>
        <label className={label}>Designation<input className={input} value={v.designation} onChange={set('designation')} /></label>
        <label className={label}>LinkedIn<input className={input} value={v.linkedin_url} onChange={set('linkedin_url')} /></label>
        <label className={label}>Kind<select className={input} value={v.kind} onChange={set('kind')}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={label}>Status<select className={input} value={v.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={label}>Source<select className={input} value={v.source} onChange={set('source')}><option value="">Not set</option>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={label}>Last connected<input type="date" className={input} value={v.last_connected_on} onChange={set('last_connected_on')} /></label>
        <label className={label}>Next follow-up<input type="date" className={input} value={v.next_followup_date} onChange={set('next_followup_date')} /></label>
        <div className="sm:col-span-2">
          <p className={label}>Our companies (several if they are a network across them)</p>
          <div className="mt-1 flex flex-wrap gap-1.5">{companies.map((c) => <label key={c.id} className={`inline-flex cursor-pointer items-center rounded-full border px-2.5 py-1 text-xs ${v.company_ids.includes(c.id) ? 'border-primary-300 bg-primary-50 text-primary-800' : 'border-tertiary-200 text-tertiary-700'}`}><input type="checkbox" className="hidden" checked={v.company_ids.includes(c.id)} onChange={() => setV((x) => ({ ...x, company_ids: x.company_ids.includes(c.id) ? x.company_ids.filter((i) => i !== c.id) : [...x.company_ids, c.id] }))} />{c.name}</label>)}</div>
        </div>
        <label className={`${label} sm:col-span-2`}>Notes<textarea rows={3} className={input} value={v.notes} onChange={set('notes')} /></label>
      </form>
    </Drawer>
  );
}

function FollowupDrawer({ contact, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [v, setV] = useState({ note: '', contacted_on: today(), next_followup_date: '', status: '' });
  useEffect(() => { if (contact) setV({ note: '', contacted_on: today(), next_followup_date: '', status: '' }); }, [contact]);
  async function save(e) {
    e.preventDefault();
    try { await apiClient.post(`/group-directory/${contact.id}/followups`, { note: v.note, contacted_on: v.contacted_on, next_followup_date: v.next_followup_date || null, ...(v.status ? { status: v.status } : {}) }); pushSuccess('Follow-up saved'); onSaved(); } catch (err) { pushError(apiErrorMessage(err, 'Could not save'), 'Not saved'); }
  }
  return (
    <Drawer open={Boolean(contact)} title={contact ? `Follow-up with ${contact.name}` : ''} onClose={onClose} size="md" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="dir-follow-form" className="btn-primary" disabled={!v.note.trim()} data-testid="dir-followup-save">Save</button></>}>
      <form id="dir-follow-form" onSubmit={save} className="space-y-3">
        <label className={label}>What happened<textarea rows={3} className={input} value={v.note} onChange={(e) => setV((x) => ({ ...x, note: e.target.value }))} required /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>Contacted on<input type="date" className={input} value={v.contacted_on} onChange={(e) => setV((x) => ({ ...x, contacted_on: e.target.value }))} /></label>
          <label className={label}>Next follow-up<input type="date" className={input} value={v.next_followup_date} onChange={(e) => setV((x) => ({ ...x, next_followup_date: e.target.value }))} /></label>
        </div>
        <label className={label}>Status after this<select className={input} value={v.status} onChange={(e) => setV((x) => ({ ...x, status: e.target.value }))}><option value="">Keep (fresh becomes in connect)</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {contact?.followups?.length > 0 && (
          <div>
            <p className={label}>Earlier</p>
            <ul className="mt-1 space-y-1 text-xs">{contact.followups.map((f) => <li key={f.id} className="rounded-lg bg-canvas-muted px-2 py-1"><span className="font-medium">{f.contacted_on}</span> {f.note}</li>)}</ul>
          </div>
        )}
      </form>
    </Drawer>
  );
}
