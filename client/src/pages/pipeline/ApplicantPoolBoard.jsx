import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Undo2, UserCheck, UserPlus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';

const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const ago = (iso) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

/** Adds one applicant to an in-progress requirement by hand (the website will feed the pool later). */
export function AddApplicantDrawer({ open, requirements, requirementId, onClose, onSaved }) {
  const { pushSuccess } = useAlerts();
  const [v, setV] = useState({ requirement_id: requirementId || '', name: '', email: '', phone: '', experience_years: '', notes: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setV((c) => ({ ...c, requirement_id: requirementId || c.requirement_id })); setError(''); } }, [open, requirementId]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiClient.post('/applicants', { ...v, experience_years: v.experience_years === '' ? undefined : Number(v.experience_years) });
      pushSuccess('Applicant added to the pool');
      setV((c) => ({ ...c, name: '', email: '', phone: '', experience_years: '', notes: '' }));
      onSaved();
      onClose();
    } catch (err) { setError(apiErrorMessage(err, 'Could not add the applicant')); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="md" tone="create" title="Add applicant">
      <form className="space-y-3" onSubmit={submit}>
        <label className={labelCls}>Requirement
          <select required className={inputCls} value={v.requirement_id} onChange={set('requirement_id')}>
            <option value="">Choose an in-progress requirement…</option>
            {(requirements || []).map((r) => <option key={r.id} value={r.id}>{r.title}{r.client ? ` · ${r.client}` : ''}</option>)}
          </select>
        </label>
        <label className={labelCls}>Name<input required className={inputCls} value={v.name} onChange={set('name')} maxLength={200} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>Email<input type="email" className={inputCls} value={v.email} onChange={set('email')} /></label>
          <label className={labelCls}>Phone<input className={inputCls} value={v.phone} onChange={set('phone')} /></label>
        </div>
        <label className={labelCls}>Experience (years)<input type="number" min="0" max="70" step="0.5" className={inputCls} value={v.experience_years} onChange={set('experience_years')} /></label>
        <label className={labelCls}>Notes<textarea rows={2} className={inputCls} value={v.notes} onChange={set('notes')} /></label>
        {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
        <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={saving || !v.requirement_id || !v.name.trim()}>{saving ? 'Adding…' : 'Add to pool'}</button></div>
      </form>
    </Drawer>
  );
}

/** Pipeline > Applicants: everyone who applied to an in-progress requirement; the first recruiter to claim a person owns them. */
export default function ApplicantPoolBoard() {
  const { user } = useAuth();
  const { pushError, pushSuccess } = useAlerts();
  const [view, setView] = useState('pool');
  const [requirementId, setRequirementId] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const canClaim = ['recruiter', 'admin'].includes(user?.role);

  const reqs = useLiveData(() => apiClient.get('/applicants/requirements').then((r) => r.data.data), { deps: [] });
  const list = useLiveData(
    () => apiClient.get('/applicants', { params: { view, ...(requirementId ? { requirement_id: requirementId } : {}), ...(applied ? { search: applied } : {}), limit: 50 } }).then((r) => ({ rows: r.data.data, counts: r.data.counts, pagination: r.data.pagination })),
    { intervalMs: 20000, deps: [view, requirementId, applied] }
  );
  const refresh = useCallback(() => { list.refresh(); reqs.refresh(); }, [list, reqs]);
  useEffect(() => { if (list.error) pushError(apiErrorMessage(list.error, 'Could not load the applicants'), 'Load failed'); }, [list.error]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(id, action, okText) {
    setBusy(id);
    try { await apiClient.post(`/applicants/${id}/${action}`, {}); pushSuccess(okText); } catch (e) { pushError(apiErrorMessage(e, 'Could not do that'), 'Not saved'); } finally { setBusy(''); refresh(); }
  }

  const rows = list.data?.rows || [];
  const counts = list.data?.counts || { pool: 0, mine: 0 };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5" role="tablist" aria-label="Applicant view">
          {[['pool', `Pool (${counts.pool})`], ['mine', `My candidates (${counts.mine})`]].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === k ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{label}</button>
          ))}
        </div>
        <select className="rounded-xl border border-tertiary-200 bg-white px-3 py-1.5 text-sm" value={requirementId} onChange={(e) => setRequirementId(e.target.value)} aria-label="Requirement">
          <option value="">All in-progress requirements</option>
          {(reqs.data || []).map((r) => <option key={r.id} value={r.id}>{r.title} ({r.applicants.new} waiting)</option>)}
        </select>
        <form className="flex" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); }}>
          <input className="w-56 rounded-l-xl border border-tertiary-200 bg-white px-3 py-1.5 text-sm" placeholder="Search name, email, phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className="rounded-r-xl border border-l-0 border-tertiary-200 bg-[#EEF5FC] px-3 py-1.5 text-xs font-semibold text-[#105AA9]">Search</button>
        </form>
        <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" />Add applicant</button>
      </div>

      <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-[#F9FAFB] text-left text-xs uppercase tracking-wide text-tertiary-500">
              <tr><th className="px-4 py-2 font-medium">Applicant</th><th className="px-3 font-medium">Requirement</th><th className="px-3 font-medium">Experience</th><th className="px-3 font-medium">Applied</th><th className="px-3 font-medium">{view === 'mine' ? 'Profile' : 'Status'}</th><th className="px-3 text-right font-medium">Action</th></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-tertiary-100" data-testid="applicant-row">
                  <td className="px-4 py-2"><p className="font-medium text-tertiary-900">{a.name}</p><p className="text-xs text-tertiary-500">{[a.email, a.phone].filter(Boolean).join(' · ') || 'No contact details'}</p></td>
                  <td className="px-3"><p className="text-tertiary-800">{a.requirement_title}</p><p className="text-xs text-tertiary-500">{a.client}</p></td>
                  <td className="px-3 tabular-nums">{a.experience_years != null ? `${a.experience_years} yrs` : '—'}</td>
                  <td className="px-3 text-xs text-tertiary-500">{ago(a.applied_at)} · <span className="capitalize">{a.source}</span></td>
                  <td className="px-3">
                    {view === 'mine' && a.profile_id ? <Link className="text-primary-700 hover:underline" to={`/profiles/${a.profile_id}`}>Open profile</Link>
                      : a.status === 'new' ? <Pill tone="blue">In pool</Pill> : <Pill tone="green">With {a.assigned_to?.name || 'a recruiter'}</Pill>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {a.status === 'new' && canClaim && (
                      <button type="button" className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" disabled={busy === a.id} onClick={() => act(a.id, 'assign', `${a.name} is now yours`)}><UserCheck className="h-3.5 w-3.5" />Assign to me</button>
                    )}
                    {a.status === 'assigned' && (a.assigned_to?.id === user?.id || user?.role === 'admin') && (
                      <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" disabled={busy === a.id} onClick={() => act(a.id, 'release', `${a.name} is back in the pool`)}><Undo2 className="h-3.5 w-3.5" />Release</button>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-tertiary-500">
                  <UserPlus className="mx-auto mb-2 h-6 w-6 text-tertiary-300" />
                  {view === 'mine' ? 'You have not claimed anyone yet. Open the Pool and press "Assign to me".' : 'Nobody is waiting in the pool. Applicants appear here as they apply (or add one by hand).'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {list.data?.pagination && <p className="px-1 text-xs text-tertiary-500">{rows.length} of {list.data.pagination.total}</p>}
      <AddApplicantDrawer open={addOpen} requirements={reqs.data} requirementId={requirementId} onClose={() => setAddOpen(false)} onSaved={refresh} />
    </div>
  );
}
