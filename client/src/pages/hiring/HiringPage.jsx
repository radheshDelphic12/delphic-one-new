import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const JOB_TONE = { draft: 'gray', published: 'green', closed: 'red' };
const APP_STATUSES = [['new', 'New', 'blue'], ['shortlisted', 'Shortlisted', 'amber'], ['interview', 'Interview', 'amber'], ['offered', 'Offered', 'green'], ['hired', 'Hired', 'green'], ['rejected', 'Rejected', 'red']];
const APP_META = Object.fromEntries(APP_STATUSES.map(([v, l, t]) => [v, { label: l, tone: t }]));
const dateText = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const BLANK_JOB = { title: '', department: '', location: '', employment_type: 'Full-time', openings: '', description: '', status: 'draft' };

function JobForm({ initial, onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => (initial ? { ...BLANK_JOB, ...Object.fromEntries(Object.entries(initial).filter(([k]) => k in BLANK_JOB).map(([k, x]) => [k, x ?? ''])) } : BLANK_JOB));
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ ...v, openings: v.openings === '' ? null : Number(v.openings) }); }}>
      <label className={labelCls}>Job title<input required minLength={2} className={inputCls} value={v.title} onChange={set('title')} maxLength={200} autoFocus /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>Department<input className={inputCls} value={v.department} onChange={set('department')} maxLength={120} /></label>
        <label className={labelCls}>Location<input className={inputCls} value={v.location} onChange={set('location')} maxLength={200} placeholder="e.g. Indore" /></label>
        <label className={labelCls}>Employment type
          <select className={inputCls} value={v.employment_type} onChange={set('employment_type')}>{['Full-time', 'Part-time', 'Contract', 'Internship'].map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        <label className={labelCls}>Openings<input type="number" min="1" className={inputCls} value={v.openings} onChange={set('openings')} /></label>
      </div>
      <label className={labelCls}>Description<textarea rows={8} className={inputCls} value={v.description} onChange={set('description')} maxLength={20000} placeholder="What the role involves, what you are looking for, how to apply." /></label>
      <label className={labelCls}>Status
        <select className={inputCls} value={v.status} onChange={set('status')}><option value="draft">Draft (not public)</option><option value="published">Published (live on the career page)</option><option value="closed">Closed</option></select>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save job'}</button>
      </div>
    </form>
  );
}

function JobsTab({ onOpenApplications }) {
  const { pushError, pushSuccess } = useAlerts();
  const [data, setData] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try { const r = await apiClient.get('/hiring/jobs'); setData({ jobs: r.data.data, path: r.data.career_path, org: r.data.org }); } catch (err) { setData({ jobs: [], error: apiErrorMessage(err, 'Could not load the jobs') }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const url = data?.path ? `${window.location.origin}${data.path}` : '';

  async function save(body) {
    setSaving(true);
    try {
      if (drawer.job) await apiClient.patch(`/hiring/jobs/${drawer.job.id}`, body); else await apiClient.post('/hiring/jobs', body);
      pushSuccess('Job saved');
      setDrawer(null);
      load();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not save the job'), 'Could not save'); } finally { setSaving(false); }
  }
  async function setStatus(job, status) {
    try { await apiClient.patch(`/hiring/jobs/${job.id}`, { status }); load(); } catch (err) { pushError(apiErrorMessage(err, 'Could not update the job'), 'Something went wrong'); }
  }
  async function remove(job) {
    if (!window.confirm(`Delete ${job.title}? Its applications are kept but the job leaves the career page.`)) return;
    try { await apiClient.delete(`/hiring/jobs/${job.id}`); load(); } catch (err) { pushError(apiErrorMessage(err, 'Could not delete'), 'Something went wrong'); }
  }

  if (!data) return <p className="py-8 text-center text-sm text-tertiary-500">Loading…</p>;
  if (data.error) return <EmptyState title="Hiring is not available here" description={data.error} />;
  return (
    <div className="space-y-4" data-testid="hiring-jobs">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Your career page</p>
          <a className="break-all text-sm font-medium text-primary-700 hover:underline" href={url} target="_blank" rel="noreferrer" data-testid="career-url">{url}</a>
          <p className="text-xs text-tertiary-500">Published jobs appear here for everyone, no login needed. Share the link or put it on your website.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={() => { navigator.clipboard?.writeText(url); pushSuccess('Link copied'); }}><Copy className="h-4 w-4" />Copy link</button>
          <a className="btn-secondary inline-flex items-center gap-1.5 text-sm" href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Open</a>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5 text-sm" onClick={() => setDrawer({})}><Plus className="h-4 w-4" />New job</button>
        </div>
      </div>
      {data.jobs.length === 0 ? <EmptyState title="No jobs yet" description="Create a job and publish it to put it on your career page." /> : (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-tertiary-50 text-left text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-3 py-2 font-medium">Job</th><th className="px-3 font-medium">Department</th><th className="px-3 font-medium">Location</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Applications</th><th className="px-3 text-right font-medium">Actions</th></tr></thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.id} className="border-t border-tertiary-100" data-testid="job-row">
                  <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{j.title}</span><span className="block text-xs text-tertiary-500">{j.job_code} · {j.employment_type || '-'}{j.openings ? ` · ${j.openings} opening${j.openings === 1 ? '' : 's'}` : ''}</span></td>
                  <td className="px-3">{j.department || '-'}</td>
                  <td className="px-3">{j.location || '-'}</td>
                  <td className="px-3"><Pill tone={JOB_TONE[j.status]}>{j.status}</Pill></td>
                  <td className="px-3"><button type="button" className="font-medium text-primary-700 hover:underline" onClick={() => onOpenApplications(j.id)}>{j.applications}</button>{j.new_applications > 0 && <span className="ml-1 text-xs text-tertiary-500">({j.new_applications} new)</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {j.status !== 'published' && <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={() => setStatus(j, 'published')}>Publish</button>}
                      {j.status === 'published' && <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setStatus(j, 'closed')}>Close</button>}
                      {j.status === 'published' && <a className="btn-secondary px-2.5 py-1 text-xs" href={`${data.path}${j.slug}`} target="_blank" rel="noreferrer">View</a>}
                      <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setDrawer({ job: j })}>Edit</button>
                      <button type="button" className="btn-secondary px-2.5 py-1 text-xs text-danger-700" onClick={() => remove(j)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Drawer open={Boolean(drawer)} onClose={() => !saving && setDrawer(null)} size="lg" tone={drawer?.job ? 'edit' : 'create'} title={drawer?.job ? `Edit ${drawer.job.title}` : 'New job'}>
        {drawer && <JobForm initial={drawer.job} onSubmit={save} onCancel={() => setDrawer(null)} saving={saving} />}
      </Drawer>
    </div>
  );
}

function ApplicationsTab({ initialJob }) {
  const { pushError, pushSuccess } = useAlerts();
  const [jobs, setJobs] = useState([]);
  const [f, setF] = useState({ job_id: initialJob || '', status: '', q: '', from: '', to: '' });
  const [qText, setQText] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const set = (k) => (e) => { setPage(1); setF((c) => ({ ...c, [k]: e.target.value })); };
  useEffect(() => { apiClient.get('/hiring/jobs').then((r) => setJobs(r.data.data)).catch(() => {}); }, []);
  const params = useCallback(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v)), [f]);
  const load = useCallback(async () => {
    try { const r = await apiClient.get('/hiring/applications', { params: { ...params(), page, limit: 15 } }); setRes({ rows: r.data.data, pagination: r.data.pagination, by_status: r.data.by_status }); } catch (err) { pushError(apiErrorMessage(err, 'Could not load the applications'), 'Something went wrong'); }
  }, [params, page, pushError]);
  useEffect(() => { load(); }, [load]);

  async function save(patch) {
    setBusy(true);
    try { const r = await apiClient.patch(`/hiring/applications/${open.id}`, patch); setOpen(r.data.data); setNotes(r.data.data.notes || ''); pushSuccess('Saved'); load(); } catch (err) { pushError(apiErrorMessage(err, 'Could not save'), 'Could not save'); } finally { setBusy(false); }
  }
  async function exportXlsx() {
    setExporting(true);
    try {
      const r = await apiClient.get('/hiring/applications/export', { params: params(), responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'job-applications.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { pushError(apiErrorMessage(err, 'Could not export'), 'Export failed'); } finally { setExporting(false); }
  }
  const total = res ? Object.values(res.by_status).reduce((a, b) => a + b, 0) : 0;
  const a = open;
  return (
    <div className="space-y-4" data-testid="hiring-applications">
      <section className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-5">
        <label className={labelCls}>Job<select className={inputCls} value={f.job_id} onChange={set('job_id')}><option value="">All jobs</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.job_code} · {j.title}</option>)}</select></label>
        <label className={labelCls}>Status<select className={inputCls} value={f.status} onChange={set('status')}><option value="">All ({total})</option>{APP_STATUSES.map(([v, l]) => <option key={v} value={v}>{l} ({res?.by_status[v] || 0})</option>)}</select></label>
        <label className={labelCls}>Applied from<input type="date" className={inputCls} value={f.from} onChange={set('from')} /></label>
        <label className={labelCls}>Applied to<input type="date" className={inputCls} value={f.to} onChange={set('to')} /></label>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setF((c) => ({ ...c, q: qText.trim() })); }}>
          <label className={`${labelCls} flex-1`}>Search<input className={inputCls} value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Name, email, phone" /></label>
          <button type="submit" className="btn-secondary px-3 py-2 text-sm">Search</button>
        </form>
      </section>
      <div className="flex justify-end"><button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={exportXlsx} disabled={exporting}><Download className="h-4 w-4" />Excel</button></div>
      {!res ? <p className="py-8 text-center text-sm text-tertiary-500">Loading…</p> : res.rows.length === 0 ? <EmptyState title="No applications" description="Applications from your career page appear here." /> : (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-tertiary-50 text-left text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-3 py-2 font-medium">Candidate</th><th className="px-3 font-medium">Job</th><th className="px-3 font-medium">Experience</th><th className="px-3 font-medium">Applied</th><th className="px-3 font-medium">Status</th></tr></thead>
            <tbody>
              {res.rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-tertiary-100 hover:bg-primary-50/40" data-testid="application-row" onClick={() => { setOpen(r); setNotes(r.notes || ''); }}>
                  <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.email} · {r.phone || '-'}</span></td>
                  <td className="px-3">{r.job?.title}<span className="block text-xs text-tertiary-500">{r.job?.job_code}</span></td>
                  <td className="px-3">{r.experience_years != null ? `${r.experience_years} yrs` : '-'}</td>
                  <td className="px-3 text-xs text-tertiary-600">{dateText(r.created_at)}</td>
                  <td className="px-3"><Pill tone={APP_META[r.status]?.tone}>{APP_META[r.status]?.label}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res && res.pagination.totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm text-tertiary-600" aria-label="Pages">
          <span>{res.pagination.total} applications · page {res.pagination.page} of {res.pagination.totalPages}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" />Previous</button>
            <button type="button" className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-sm" disabled={page >= res.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next<ChevronRight className="h-4 w-4" /></button>
          </div>
        </nav>
      )}
      <Drawer open={Boolean(a)} onClose={() => setOpen(null)} size="lg" tone="info" title={a ? a.name : 'Application'}>
        {a && (
          <div className="space-y-4" data-testid="application-detail">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[['Job', `${a.job?.job_code} · ${a.job?.title}`], ['Applied', dateText(a.created_at)], ['Email', a.email], ['Phone', a.phone || '-'], ['Experience', a.experience_years != null ? `${a.experience_years} yrs` : '-'], ['Source', a.channel || '-'],
                ['Joiner status', a.answers.joiner_status || '-'], ['Notice (days)', a.answers.notice_period_days ?? '-'], ['Current CTC (LPA)', a.answers.current_ctc_lpa ?? '-'], ['Expected CTC (LPA)', a.answers.expected_ctc_lpa ?? '-'], ['Work mode', a.answers.work_mode || '-'], ['Referred by', a.referred_by || '-']].map(([k, x]) => (
                <div key={k}><dt className="text-xs text-tertiary-500">{k}</dt><dd className="break-words font-medium text-tertiary-900">{x}</dd></div>
              ))}
            </dl>
            <p className="flex flex-wrap gap-3 text-sm">
              {a.cv_url && <a className="text-primary-700 hover:underline" href={a.cv_url} target="_blank" rel="noreferrer">Open CV</a>}
              {a.linkedin_url && <a className="text-primary-700 hover:underline" href={a.linkedin_url} target="_blank" rel="noreferrer">Open LinkedIn</a>}
            </p>
            {a.message && <p className="whitespace-pre-wrap rounded-xl bg-tertiary-50 px-3 py-2 text-sm text-tertiary-700">{a.message}</p>}
            <label className={labelCls}>Status
              <select className={inputCls} value={a.status} disabled={busy} onChange={(e) => save({ status: e.target.value })}>{APP_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className={labelCls}>Notes<textarea rows={4} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} /></label>
            <div className="flex justify-end"><button type="button" className="btn-primary" disabled={busy || notes === (a.notes || '')} onClick={() => save({ notes })}>Save notes</button></div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

/** Hiring for the companies other than Delphic Global: jobs on the company's own career page and the applications that come in. */
export default function HiringPage() {
  const [tab, setTab] = useState('jobs');
  const [jobId, setJobId] = useState('');
  return (
    <div className="space-y-4">
      <div><h1 className="font-heading text-xl font-semibold text-tertiary-900">Hiring</h1><p className="text-sm text-tertiary-500">Post jobs on your company&apos;s career page and manage the applications.</p></div>
      <div className="flex gap-1 border-b border-tertiary-200" role="tablist">
        {[['jobs', 'Jobs'], ['applications', 'Applications']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500 hover:text-tertiary-800'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'jobs' ? <JobsTab onOpenApplications={(id) => { setJobId(id); setTab('applications'); }} /> : <ApplicationsTab key={jobId} initialJob={jobId} />}
    </div>
  );
}
