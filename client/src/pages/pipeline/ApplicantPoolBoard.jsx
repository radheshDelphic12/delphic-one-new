import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus, Pencil, Plus, SlidersHorizontal, Trash2, Undo2, Unlink, UserCheck, UserPlus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useUserOptions } from '../../lib/lookups.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import ScreeningFields, { emptyScreening, screeningPayload, NOTICE_CHOICES, JOINER_LABEL, WORK_MODE_LABEL } from '../../components/applicants/ScreeningFields.jsx';

const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const ago = (iso) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const NOTICE_VALUES = NOTICE_CHOICES.map(([v]) => v).filter((v) => v !== 'other');

/** The form values of an applicant row, for the edit drawer. */
function screeningOf(a) {
  const notice = a.notice_period_days;
  const known = notice != null && NOTICE_VALUES.includes(String(notice));
  return {
    linkedin_url: a.linkedin_url || '', cv_url: a.cv_url || '', currently_working: a.currently_working == null ? '' : a.currently_working ? 'yes' : 'no',
    joiner_status: a.joiner_status || '', notice_choice: notice == null ? '' : known ? String(notice) : 'other', notice_other: notice != null && !known ? String(notice) : '',
    last_working_day: a.last_working_day ? String(a.last_working_day).slice(0, 10) : '', current_ctc_lpa: a.current_ctc_lpa ?? '', expected_ctc_lpa: a.expected_ctc_lpa ?? '',
    work_mode: a.work_mode || '', extra_skills: (a.extra_skills || []).join(', '),
  };
}

/** Adds one applicant to an in-progress requirement by hand, or (with `applicant`) corrects one that is already in the pool. */
export function AddApplicantDrawer({ open, requirements, requirementId, applicant, onClose, onSaved }) {
  const { pushSuccess } = useAlerts();
  const [v, setV] = useState({ requirement_id: requirementId || '', name: '', email: '', phone: '', experience_years: '', notes: '' });
  const [screening, setScreening] = useState(emptyScreening);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError('');
    if (applicant) {
      setV({ requirement_id: applicant.requirement_id, name: applicant.name || '', email: applicant.email || '', phone: applicant.phone || '', experience_years: applicant.experience_years ?? '', notes: applicant.notes || '' });
      setScreening(screeningOf(applicant));
    } else setV((c) => ({ ...c, requirement_id: requirementId || c.requirement_id }));
  }, [open, requirementId, applicant]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (applicant) {
        // an edit sends every answer, so a field the admin empties is cleared
        const notice = screening.notice_choice === 'other' ? screening.notice_other : screening.notice_choice;
        await apiClient.patch(`/applicants/${applicant.id}`, {
          name: v.name, email: v.email, phone: v.phone, notes: v.notes, experience_years: v.experience_years === '' ? '' : Number(v.experience_years),
          linkedin_url: screening.linkedin_url, cv_url: screening.cv_url, currently_working: screening.currently_working, joiner_status: screening.joiner_status,
          notice_period_days: notice, last_working_day: screening.joiner_status === 'serving_notice' ? screening.last_working_day : '',
          current_ctc_lpa: screening.current_ctc_lpa, expected_ctc_lpa: screening.expected_ctc_lpa, work_mode: screening.work_mode, extra_skills: screening.extra_skills,
        });
        pushSuccess('Applicant updated');
        onSaved();
        onClose();
        return;
      }
      await apiClient.post('/applicants', { ...v, ...screeningPayload(screening), experience_years: v.experience_years === '' ? undefined : Number(v.experience_years) });
      pushSuccess('Applicant added to the pool');
      setV((c) => ({ ...c, name: '', email: '', phone: '', experience_years: '', notes: '' }));
      setScreening(emptyScreening);
      onSaved();
      onClose();
    } catch (err) { setError(apiErrorMessage(err, 'Could not add the applicant')); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="md" tone={applicant ? 'edit' : 'create'} title={applicant ? 'Edit applicant' : 'Add applicant'}>
      <form className="space-y-3" onSubmit={submit}>
        {!applicant && <label className={labelCls}>Requirement
          <select required className={inputCls} value={v.requirement_id} onChange={set('requirement_id')}>
            <option value="">Choose an in-progress requirement…</option>
            {(requirements || []).map((r) => <option key={r.id} value={r.id}>{r.title}{r.client ? ` · ${r.client}` : ''}</option>)}
          </select>
        </label>}
        <label className={labelCls}>Name<input required className={inputCls} value={v.name} onChange={set('name')} maxLength={200} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>Email<input type="email" className={inputCls} value={v.email} onChange={set('email')} /></label>
          <label className={labelCls}>Phone<input className={inputCls} value={v.phone} onChange={set('phone')} /></label>
        </div>
        <label className={labelCls}>Experience (years)<input type="number" min="0" max="70" step="0.5" className={inputCls} value={v.experience_years} onChange={set('experience_years')} /></label>
        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Screening answers (optional here)</p>
        <ScreeningFields value={screening} onChange={setScreening} inputCls={inputCls} labelCls={labelCls} />
        <label className={labelCls}>Notes<textarea rows={2} className={inputCls} value={v.notes} onChange={set('notes')} /></label>
        {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
        <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={saving || !v.requirement_id || !v.name.trim()}>{saving ? 'Saving…' : applicant ? 'Save changes' : 'Add to pool'}</button></div>
      </form>
    </Drawer>
  );
}

const lpa = (n) => (n == null ? '—' : `${n} L`);

/** The CV a candidate attached: fetched with the login (the file is never public) and saved from a blob. */
async function downloadCv(a) {
  const res = await apiClient.get(`/applicants/${a.id}/cv`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = a.cv_file_name || `${a.name} CV`;
  link.click();
  URL.revokeObjectURL(url);
}

/** What the candidate said when applying: joiner status, notice, CTC, work mode, links. Older applicants have none of it. */
function ScreeningSummary({ a }) {
  if (!a.joiner_status && a.current_ctc_lpa == null && a.expected_ctc_lpa == null && !a.work_mode && !a.linkedin_url && !a.cv_url && !a.has_cv_file) return <span className="text-tertiary-400">Not answered</span>;
  return (
    <div className="space-y-0.5">
      <p>
        {a.joiner_status && <Pill tone={a.joiner_status === 'yes' ? 'green' : a.joiner_status === 'serving_notice' ? 'amber' : 'gray'}>{JOINER_LABEL[a.joiner_status]}</Pill>}
        {a.notice_period_days != null && <span className="ml-1">{a.notice_period_days === 0 ? 'no notice' : `${a.notice_period_days}d notice`}</span>}
        {a.last_working_day && <span className="ml-1">· LWD {String(a.last_working_day).slice(0, 10)}</span>}
      </p>
      <p>CTC {lpa(a.current_ctc_lpa)} → {lpa(a.expected_ctc_lpa)}{a.currently_working === false ? ' · not working' : ''}{a.work_mode ? ` · ${WORK_MODE_LABEL[a.work_mode]}` : ''}</p>
      {a.extra_skills?.length > 0 && <p className="text-tertiary-500">{a.extra_skills.slice(0, 5).join(', ')}</p>}
      <p>
        {a.linkedin_url && <a className="text-primary-700 hover:underline" href={a.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
        {a.linkedin_url && (a.cv_url || a.has_cv_file) && ' · '}
        {a.has_cv_file && <button type="button" className="text-primary-700 hover:underline" onClick={() => downloadCv(a)}>CV (file)</button>}
        {a.has_cv_file && a.cv_url && ' · '}
        {a.cv_url && <a className="text-primary-700 hover:underline" href={a.cv_url} target="_blank" rel="noreferrer">CV</a>}
      </p>
    </div>
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
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const canClaim = ['recruiter', 'admin'].includes(user?.role);
  const recruiterOptions = useUserOptions('recruiter');
  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined));
  const filterKey = JSON.stringify(activeFilters);
  const setFilter = (k) => (e) => setFilters((c) => ({ ...c, [k]: e.target.value }));

  const reqs = useLiveData(() => apiClient.get('/applicants/requirements').then((r) => r.data.data), { deps: [] });
  const list = useLiveData(
    () => apiClient.get('/applicants', { params: { view, ...(requirementId ? { requirement_id: requirementId } : {}), ...(applied ? { search: applied } : {}), ...activeFilters, limit: 50 } }).then((r) => ({ rows: r.data.data, counts: r.data.counts, pagination: r.data.pagination })),
    { intervalMs: 20000, deps: [view, requirementId, applied, filterKey] }
  );
  const refresh = useCallback(() => { list.refresh(); reqs.refresh(); }, [list, reqs]);
  useEffect(() => { if (list.error) pushError(apiErrorMessage(list.error, 'Could not load the applicants'), 'Load failed'); }, [list.error]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(id, action, okText) {
    setBusy(id);
    try { await apiClient.post(`/applicants/${id}/${action}`, {}); pushSuccess(okText); } catch (e) { pushError(apiErrorMessage(e, 'Could not do that'), 'Not saved'); } finally { setBusy(''); refresh(); }
  }

  // "Unlink from job" keeps the Profile; Delete is a soft delete (a group super admin can restore it from Logs).
  function unlinkFromJob(a) {
    if (!window.confirm(`Unlink ${a.name} from "${a.requirement_title}"? They leave your candidates for this job; their Profile is kept.`)) return;
    act(a.id, 'unlink', `${a.name} is unlinked from the job`);
  }
  async function deleteApplicant(a) {
    if (!window.confirm(`Delete ${a.name} from "${a.requirement_title}"? They disappear from the lists. A group super admin can restore them from Group Dashboard > Logs.`)) return;
    setBusy(a.id);
    try { await apiClient.delete(`/applicants/${a.id}`); pushSuccess(`${a.name} was deleted`); } catch (e) { pushError(apiErrorMessage(e, 'Could not delete'), 'Not deleted'); } finally { setBusy(''); refresh(); }
  }

  const rows = list.data?.rows || [];
  const counts = list.data?.counts || { pool: 0, mine: 0, all: 0 };
  // before the first answer arrives (and while a new view loads) show a loading row, not "nobody is waiting"
  const loadingRows = list.loading && !rows.length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5" role="tablist" aria-label="Applicant view">
          {[['pool', `Pool (${counts.pool})`], ['mine', `My candidates (${counts.mine})`], ['all', `All (${counts.all})`]].map(([k, label]) => (
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
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
          <SlidersHorizontal className="h-4 w-4" />Filters{Object.keys(activeFilters).length ? ` (${Object.keys(activeFilters).length})` : ''}
        </button>
        <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" />Add applicant</button>
      </div>

      {showFilters && (
        <section className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4" data-testid="applicant-filters">
          <label className={labelCls}>Assignment
            <select className={inputCls} value={filters.assignment || ''} onChange={setFilter('assignment')}>
              <option value="">Any</option><option value="unassigned">Unassigned (in the pool)</option><option value="assigned">Assigned to a recruiter</option>
            </select>
          </label>
          <label className={labelCls}>Profile
            <select className={inputCls} value={filters.profile || ''} onChange={setFilter('profile')}>
              <option value="">Any</option><option value="created">Profile created</option><option value="not_created">Profile not created</option>
            </select>
          </label>
          <label className={labelCls}>Recruiter
            <select className={inputCls} value={filters.recruiter_id || ''} onChange={setFilter('recruiter_id')}>
              <option value="">Any</option>{recruiterOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className={labelCls}>Immediate joiner
            <select className={inputCls} value={filters.joiner || ''} onChange={setFilter('joiner')}>
              <option value="">Any</option>{Object.entries(JOINER_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className={labelCls}>Working now
            <select className={inputCls} value={filters.working || ''} onChange={setFilter('working')}>
              <option value="">Any</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </label>
          <label className={labelCls}>Notice period up to
            <select className={inputCls} value={filters.notice_max || ''} onChange={setFilter('notice_max')}>
              <option value="">Any</option><option value="0">Immediate</option><option value="15">15 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option>
            </select>
          </label>
          <label className={labelCls}>Last working day on or before<input type="date" className={inputCls} value={filters.lwd_before || ''} onChange={setFilter('lwd_before')} /></label>
          <label className={labelCls}>Work mode
            <select className={inputCls} value={filters.work_mode || ''} onChange={setFilter('work_mode')}>
              <option value="">Any</option>{Object.entries(WORK_MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>Expected CTC from (LPA)<input type="number" min="0" step="0.5" className={inputCls} value={filters.expected_ctc_min || ''} onChange={setFilter('expected_ctc_min')} /></label>
            <label className={labelCls}>to (LPA)<input type="number" min="0" step="0.5" className={inputCls} value={filters.expected_ctc_max || ''} onChange={setFilter('expected_ctc_max')} /></label>
          </div>
          <label className={labelCls}>Current CTC up to (LPA)<input type="number" min="0" step="0.5" className={inputCls} value={filters.current_ctc_max || ''} onChange={setFilter('current_ctc_max')} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>Experience from (yrs)<input type="number" min="0" step="0.5" className={inputCls} value={filters.exp_min || ''} onChange={setFilter('exp_min')} /></label>
            <label className={labelCls}>to (yrs)<input type="number" min="0" step="0.5" className={inputCls} value={filters.exp_max || ''} onChange={setFilter('exp_max')} /></label>
          </div>
          <label className={labelCls}>Skill<input className={inputCls} placeholder="e.g. react" value={filters.skill || ''} onChange={setFilter('skill')} /></label>
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={!Object.keys(activeFilters).length} onClick={() => setFilters({})}>Clear filters</button>
            <p className="ml-3 text-xs text-tertiary-500">People who did not answer a question never match a filter on it.</p>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[58rem] text-sm">
            <thead className="bg-[#F9FAFB] text-left text-xs uppercase tracking-wide text-tertiary-500">
              <tr><th className="px-4 py-2 font-medium">Applicant</th><th className="px-3 font-medium">Requirement</th><th className="px-3 font-medium">Experience</th><th className="px-3 font-medium">Screening</th><th className="px-3 font-medium">Applied</th><th className="px-3 font-medium">{view === 'mine' ? 'Profile' : 'Status'}</th><th className="px-3 text-right font-medium">Action</th></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-tertiary-100" data-testid="applicant-row">
                  <td className="px-4 py-2"><p className="font-medium text-tertiary-900">{a.name}</p><p className="text-xs text-tertiary-500">{[a.email, a.phone].filter(Boolean).join(' · ') || 'No contact details'}</p></td>
                  <td className="px-3"><p className="text-tertiary-800">{a.requirement_title}</p><p className="text-xs text-tertiary-500">{a.client}</p></td>
                  <td className="px-3 tabular-nums">{a.experience_years != null ? `${a.experience_years} yrs` : '—'}</td>
                  <td className="px-3 text-xs text-tertiary-700" data-testid="screening-cell"><ScreeningSummary a={a} /></td>
                  <td className="px-3 text-xs text-tertiary-500">{ago(a.applied_at)} · <span className="capitalize">{a.channel || a.source}</span></td>
                  <td className="px-3">
                    {a.status === 'new' ? <Pill tone="blue">In pool</Pill>
                      : a.status === 'unlinked' ? <Pill tone="gray">Unlinked</Pill>
                        : <Pill tone="green">With {a.assigned_to?.name || 'a recruiter'}</Pill>}
                    {a.status === 'assigned' && (a.profile_id
                      ? <p className="mt-1 text-xs"><Link className="text-primary-700 hover:underline" to={`/profiles/${a.profile_id}`}>Open profile</Link></p>
                      : <p className="mt-1 text-xs text-tertiary-500">Profile not created</p>)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {(user?.role === 'admin' || user?.role === 'sales' || a.assigned_to?.id === user?.id) && (
                      <button type="button" title="Edit applicant" className="mr-1 rounded p-1.5 text-tertiary-400 hover:bg-tertiary-100 hover:text-primary-700" onClick={() => setEditing(a)}><Pencil className="h-4 w-4" /></button>
                    )}
                    {a.status === 'new' && canClaim && (
                      <button type="button" className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" disabled={busy === a.id} onClick={() => act(a.id, 'assign', `${a.name} is now yours`)}><UserCheck className="h-3.5 w-3.5" />Assign to me</button>
                    )}
                    {a.status === 'assigned' && !a.profile_id && (a.assigned_to?.id === user?.id || user?.role === 'admin') && (
                      <button type="button" className="btn-primary mr-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" disabled={busy === a.id} onClick={() => act(a.id, 'create-profile', `Profile created for ${a.name}`)}><FilePlus className="h-3.5 w-3.5" />Create profile</button>
                    )}
                    {a.status === 'assigned' && (a.assigned_to?.id === user?.id || user?.role === 'admin') && (
                      <button type="button" title="Unlink from this job (the Profile is kept)" className="btn-secondary mr-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" disabled={busy === a.id} onClick={() => unlinkFromJob(a)}><Unlink className="h-3.5 w-3.5" />Unlink from job</button>
                    )}
                    {a.status === 'assigned' && (a.assigned_to?.id === user?.id || user?.role === 'admin') && (
                      <button type="button" className="btn-secondary mr-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" disabled={busy === a.id} onClick={() => act(a.id, 'release', `${a.name} is back in the pool`)}><Undo2 className="h-3.5 w-3.5" />Release</button>
                    )}
                    {(a.status === 'new' ? ['admin', 'sales', 'recruiter'].includes(user?.role) : (user?.role === 'admin' || a.assigned_to?.id === user?.id)) && (
                      <button type="button" title="Delete applicant" className="ml-1 rounded p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" disabled={busy === a.id} onClick={() => deleteApplicant(a)}><Trash2 className="h-4 w-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
              {loadingRows && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-tertiary-500" data-testid="applicants-loading">Loading applicants…</td></tr>
              )}
              {!rows.length && !loadingRows && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-tertiary-500">
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
      <AddApplicantDrawer open={Boolean(editing)} applicant={editing} requirements={reqs.data} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  );
}
