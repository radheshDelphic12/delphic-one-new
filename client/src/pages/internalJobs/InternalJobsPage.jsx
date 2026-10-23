import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Briefcase, Copy, FileText, Link2, MapPin, Search, UserPlus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Pill from '../../components/ui/Pill.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import { useAuth } from '../../lib/authContext.jsx';
import ScreeningFields, { emptyScreening, screeningPayload } from '../../components/applicants/ScreeningFields.jsx';

const input = 'mt-1 w-full rounded-lg border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';
const PAGE = 20;
const SORTS = [['', 'Best match / newest'], ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['title', 'Title A-Z']];
const DRIVE_HINT = 'https://drive.google.com/…';

/** The public page of a job, and the employee's personal referral link (?ref=<employee id>) to it. */
const publicUrl = (j) => (j.public_base ? `${j.public_base}/${j.slug}` : `${window.location.origin}${j.public_path}`);
const referralUrl = (j, user) => `${publicUrl(j)}?ref=${encodeURIComponent(user?.id || '')}`;

async function copyText(text, { pushSuccess, pushError }, okText) {
  try { await navigator.clipboard.writeText(text); pushSuccess(okText); } catch { pushError(`Copy this: ${text}`, 'Copy'); }
}

/** Job ID chip with one-click copy buttons, so an employee can share it with the person they are referring. */
function JobIdBar({ job, user, alerts }) {
  const small = 'inline-flex items-center gap-1 rounded-md border border-tertiary-200 bg-white px-2 py-0.5 text-xs font-medium text-tertiary-700 hover:bg-tertiary-50';
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="job-id-bar">
      <span className="rounded-md bg-primary-50 px-2 py-0.5 text-xs font-bold tracking-wide text-primary-800" data-testid="job-code">{job.job_code}</span>
      <button type="button" className={small} onClick={() => copyText(job.job_code, alerts, `Job ID ${job.job_code} copied`)}><Copy className="h-3 w-3" />Copy Job ID</button>
      <button type="button" className={small} onClick={() => copyText(publicUrl(job), alerts, 'Job link copied')}><Link2 className="h-3 w-3" />Copy job link</button>
      <button type="button" className={small} title="Anyone who applies through this link is credited to you as the referrer" onClick={() => copyText(referralUrl(job, user), alerts, 'Your referral link copied. Applications through it are credited to you.')}><Link2 className="h-3 w-3" />Copy my referral link</button>
    </div>
  );
}

function ReferForm({ job, onDone }) {
  const { pushSuccess, pushError } = useAlerts();
  const [v, setV] = useState({ name: '', email: '', phone: '', experience_years: '', message: '' });
  const [cv, setCv] = useState('');
  const [screening, setScreening] = useState(emptyScreening);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiClient.post(`/internal-jobs/${job.slug}/refer`, { ...v, ...screeningPayload(screening), cv_url: cv.trim() });
      pushSuccess(`Thank you, your referral for ${job.job_code} has been sent to the recruitment team`);
      onDone();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not send the referral'), 'Referral'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-xl border border-tertiary-100 bg-[#F9FAFB] p-3" data-testid="refer-form">
      <p className="text-xs text-tertiary-600">Referring for <span className="font-semibold text-tertiary-900">{job.job_code}</span> · {job.title}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-tertiary-600">Name *<input className={input} required value={v.name} onChange={set('name')} /></label>
        <label className="text-xs font-medium text-tertiary-600">Email *<input className={input} type="email" required value={v.email} onChange={set('email')} /></label>
        <label className="text-xs font-medium text-tertiary-600">Phone<input className={input} value={v.phone} onChange={set('phone')} /></label>
        <label className="text-xs font-medium text-tertiary-600">Experience (years)<input className={input} type="number" min="0" step="0.5" value={v.experience_years} onChange={set('experience_years')} /></label>
      </div>
      <label className="block text-xs font-medium text-tertiary-600">Google Drive link to their CV *<input className={input} type="url" inputMode="url" required maxLength={500} placeholder={DRIVE_HINT} value={cv} onChange={(e) => setCv(e.target.value)} data-testid="refer-cv" /></label>
      <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => setMore((m) => !m)}>{more ? 'Hide details' : 'Add more details if you know them (LinkedIn, CTC, notice period ...)'}</button>
      {more && <ScreeningFields value={screening} onChange={setScreening} inputCls={input} labelCls="text-xs font-medium text-tertiary-600" />}
      <label className="block text-xs font-medium text-tertiary-600">Why are they a good fit?<textarea className={input} rows={2} value={v.message} onChange={set('message')} /></label>
      <button type="submit" className="btn-primary px-4 py-1.5 text-xs" disabled={busy}>{busy ? 'Sending…' : 'Send referral'}</button>
    </form>
  );
}

/** "Apply myself" asks for the Drive link to the employee's own CV. */
function ApplyForm({ job, onDone }) {
  const { pushSuccess, pushError } = useAlerts();
  const [cv, setCv] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiClient.post(`/internal-jobs/${job.slug}/apply`, { cv_url: cv.trim() });
      pushSuccess(`Your application for ${job.job_code} has been sent to the recruitment team`);
      onDone();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not apply'), 'Internal jobs'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-tertiary-100 bg-[#F9FAFB] p-3" data-testid="apply-form">
      <label className="min-w-[16rem] flex-1 text-xs font-medium text-tertiary-600">Google Drive link to your CV *<input className={input} type="url" inputMode="url" required maxLength={500} placeholder={DRIVE_HINT} value={cv} onChange={(e) => setCv(e.target.value)} /></label>
      <button type="submit" className="btn-primary px-4 py-1.5 text-xs" disabled={busy}>{busy ? 'Sending…' : `Apply for ${job.job_code}`}</button>
    </form>
  );
}

const chip = 'rounded-full border border-primary-100 bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-800';

/** Everything known about one job, so nobody has to ask the recruiter for the JD. */
function JobDetails({ job }) {
  const facts = [
    ['Job ID', job.job_code],
    ['Experience', job.experience],
    ['Department', job.department],
    ['Location', job.location],
    ['Work mode', job.work_mode],
    ['Employment type', job.employment_type],
    ['Openings', job.openings],
    ['Contract length', job.contract_months ? `${job.contract_months} months` : null],
    ['Max notice period', job.notice_days != null ? `${job.notice_days} days` : null],
    ['Time zone', job.time_zone],
    ['Target start', job.start_date],
    ['Domain', job.domain],
    ['Posted', job.posted_at ? String(job.posted_at).slice(0, 10) : null],
  ].filter(([, v]) => v);
  const skillBlock = (label, list) => list?.length > 0 && (
    <div><h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">{label}</h3><div className="mt-1.5 flex flex-wrap gap-1.5">{list.map((x) => <span key={x} className={chip}>{x}</span>)}</div></div>
  );
  return (
    <div className="space-y-4" data-testid="job-details">
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {facts.map(([k, v]) => <div key={k}><dt className="text-xs text-tertiary-500">{k}</dt><dd className="text-sm font-medium text-tertiary-900">{v}</dd></div>)}
      </dl>
      {skillBlock('Primary skills', job.primary_skills)}
      {skillBlock('Good to have', job.secondary_skills)}
      {skillBlock('Certifications', job.certifications)}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Job description</h3>
        <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-tertiary-800">{job.full_description || job.description || 'No description has been added for this job yet.'}</p>
      </div>
      {job.jd_url && <a href={job.jd_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline"><FileText className="h-4 w-4" />Open the JD document</a>}
    </div>
  );
}

/** The people this employee referred, with the job and how far each one got. */
function MyReferrals() {
  const mine = useLiveData(() => apiClient.get('/internal-jobs/my-referrals').then((r) => r.data.data), { intervalMs: 60000, deps: [] });
  const rows = mine.data || [];
  const tone = { Received: 'blue', 'With a recruiter': 'amber', 'In process': 'green', 'Not shortlisted': 'gray', Closed: 'gray' };
  return (
    <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card" data-testid="my-referrals">
      <table className="w-full text-sm">
        <thead className="bg-[#F9FAFB] text-left text-xs uppercase tracking-wide text-tertiary-500">
          <tr><th className="px-4 py-2 font-medium">Candidate</th><th className="px-3 font-medium">Job</th><th className="px-3 font-medium">Referred on</th><th className="px-3 font-medium">Status</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-tertiary-100">
              <td className="px-4 py-2 font-medium text-tertiary-900">{r.candidate}</td>
              <td className="px-3"><span className="mr-1.5 rounded bg-primary-50 px-1.5 py-0.5 text-xs font-bold text-primary-800">{r.job_code}</span>{r.job_title}</td>
              <td className="px-3 text-tertiary-600">{String(r.referred_at).slice(0, 10)}</td>
              <td className="px-3"><Pill tone={tone[r.status] || 'gray'}>{r.status}</Pill></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-tertiary-500">{mine.loading ? 'Loading…' : 'You have not referred anyone yet. Use "Refer someone" on a job.'}</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Internal jobs: the jobs that are open on the website, shown to every employee. Anyone can refer a person, and an employee
 * whose project is ending (on the bench) can apply for a job themselves. Both go to the recruiters' applicant pool, with the
 * Google Drive link to the CV. Search (Job ID, title, skills, department, location) runs on the server.
 */
export default function InternalJobsPage() {
  const alerts = useAlerts();
  const { pushError } = alerts;
  const { user, isGroupSuperadmin } = useAuth();
  // everyone except the group superadmin gets the refreshed look; the superadmin keeps the original one
  const modern = !isGroupSuperadmin;
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('jobs');
  const [text, setText] = useState(params.get('q') || ''); // what is typed
  const [q, setQ] = useState(params.get('q') || ''); // what is searched (debounced)
  const [dept, setDept] = useState(params.get('dept') || '');
  const [loc, setLoc] = useState(params.get('loc') || '');
  const [sort, setSort] = useState(params.get('sort') || '');
  const [pages, setPages] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.replace(/\s+/g, ' ').trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  // the search lives in the address (?q=), so a result can be shared
  useEffect(() => {
    const next = {};
    if (q) next.q = q;
    if (dept) next.dept = dept;
    if (loc) next.loc = loc;
    if (sort) next.sort = sort;
    setParams(next, { replace: true });
    setPages(1);
  }, [q, dept, loc, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const jobs = useLiveData(
    () => apiClient.get('/internal-jobs', { params: { q: q || undefined, dept: dept || undefined, loc: loc || undefined, sort: sort || undefined, page: 1, limit: PAGE * pages } }).then((r) => ({ rows: r.data.data, pagination: r.data.pagination, facets: r.data.facets })),
    { intervalMs: 60000, deps: [q, dept, loc, sort, pages] }
  );
  const rows = jobs.data?.rows || [];
  const pagination = jobs.data?.pagination;
  const facets = jobs.data?.facets || { departments: [], locations: [] };
  const filtered = Boolean(q || dept || loc);
  const [referring, setReferring] = useState(null);
  const [applying, setApplying] = useState(null);
  const [viewing, setViewing] = useState(null); // slug of the job whose details are open
  const viewed = rows.find((j) => j.slug === viewing) || null;
  const lastError = useRef(null);
  useEffect(() => {
    if (jobs.error && lastError.current !== jobs.error) pushError(apiErrorMessage(jobs.error, 'Could not load the jobs'), 'Internal jobs');
    lastError.current = jobs.error;
  }, [jobs.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearAll = () => { setText(''); setQ(''); setDept(''); setLoc(''); setSort(''); };
  const noApply = () => alerts.pushInfo('Applying for a job yourself is only for employees on the bench or serving notice. You can still refer someone.', 'Apply myself');
  const countText = pagination
    ? (filtered ? `${pagination.total} of ${pagination.open_total} open positions` : `${pagination.total} open position${pagination.total === 1 ? '' : 's'}`)
    : '';
  const selectCls = 'rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm';

  return (
    <div className={`space-y-4 ${modern ? 'ta-modern' : ''}`}>
      {modern ? (
        <div className="ta-head flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Careers</p>
            <h1 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Internal jobs</h1>
            <p className="mt-1 text-sm text-tertiary-500">Open positions at Delphic. Refer someone you know, or apply yourself if your project is ending.</p>
          </div>
          <span className="rounded-full border border-primary-100 bg-white px-3 py-1 text-xs font-semibold text-primary-700 shadow-sm" data-testid="open-count">{countText}</span>
        </div>
      ) : (
        <div>
          <h1 className="text-xl font-semibold text-tertiary-900">Internal jobs</h1>
          <p className="text-sm text-tertiary-500">Open positions at Delphic. Refer someone you know, or apply yourself if your project is ending.</p>
          <p className="mt-1 text-xs text-tertiary-500" data-testid="open-count">{countText}</p>
        </div>
      )}

      <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5" role="tablist" aria-label="Internal jobs view">
        {[['jobs', 'Open positions'], ['referrals', 'My referrals']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{label}</button>
        ))}
      </div>

      {tab === 'referrals' ? <MyReferrals /> : (
        <>
          <div className="flex flex-wrap items-center gap-2" data-testid="job-filters">
            <label className="relative min-w-[16rem] flex-1">
              <span className="sr-only">Search jobs</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" />
              <input type="search" className="w-full rounded-xl border border-tertiary-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" placeholder="Search by Job ID, title, skill, department or location" value={text} onChange={(e) => setText(e.target.value)} maxLength={100} data-testid="job-search" />
            </label>
            <select className={selectCls} aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {facets.departments.map((d) => <option key={d.value} value={d.value.toLowerCase()}>{d.value} ({d.count})</option>)}
            </select>
            <select className={selectCls} aria-label="Location" value={loc} onChange={(e) => setLoc(e.target.value)}>
              <option value="">All locations</option>
              {facets.locations.map((d) => <option key={d.value} value={d.value.toLowerCase()}>{d.value} ({d.count})</option>)}
            </select>
            <select className={selectCls} aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {filtered && <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={clearAll}>Clear</button>}
          </div>

          <div className="space-y-3">
            {rows.map((j) => (
              <article key={j.slug} className={`rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card ${modern ? 'transition-shadow hover:shadow-cardHover' : ''}`} data-testid="internal-job">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    {modern && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Briefcase className="h-5 w-5" /></span>}
                    <div>
                      <h2 className="text-base font-semibold text-tertiary-900"><button type="button" className="text-left hover:text-primary-700 hover:underline" onClick={() => setViewing(j.slug)}>{j.title}</button></h2>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-tertiary-500">
                        {j.department && <span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{j.department}</span>}
                        {j.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{j.location}</span>}
                        {j.employment_type && <span>{j.employment_type}</span>}
                      </p>
                      <JobIdBar job={j} user={user} alerts={alerts} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {j.referrals > 0 && <Pill tone="blue">{j.referrals} referred by you</Pill>}
                    {j.applied && <Pill tone="green">You applied</Pill>}
                    <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setViewing(j.slug)}>View details</button>
                    <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={() => { setApplying(null); setReferring(referring === j.slug ? null : j.slug); }}><UserPlus className="h-3.5 w-3.5" />Refer someone</button>
                    {!j.applied && (j.can_apply
                      ? <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => { setReferring(null); setApplying(applying === j.slug ? null : j.slug); }}>Apply myself</button>
                      : <button type="button" aria-disabled="true" title="Only for employees on the bench or serving notice. You can still refer someone." className="btn-primary cursor-not-allowed px-3 py-1.5 text-xs opacity-50" onClick={noApply} data-testid="apply-myself-locked">Apply myself</button>)}
                  </div>
                </div>
                {j.description && <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-tertiary-700">{j.description}</p>}
                <button type="button" className="mt-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => setViewing(j.slug)}>Read the full job details</button>
                {referring === j.slug && <ReferForm job={j} onDone={() => { setReferring(null); jobs.refresh(); }} />}
                {applying === j.slug && <ApplyForm job={j} onDone={() => { setApplying(null); jobs.refresh(); }} />}
              </article>
            ))}
            {!rows.length && (
              <p className="rounded-xl border border-tertiary-100 bg-white p-8 text-center text-sm text-tertiary-500" data-testid="no-roles">
                {jobs.loading ? 'Loading…' : filtered ? 'No roles match your search.' : 'There are no open positions right now.'}
                {!jobs.loading && filtered && <button type="button" className="ml-2 font-medium text-primary-700 hover:underline" onClick={clearAll}>Clear search and filters</button>}
              </p>
            )}
            {pagination && rows.length < pagination.total && (
              <div className="text-center"><button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={() => setPages((n) => n + 1)} data-testid="load-more">Load more ({pagination.total - rows.length} more)</button></div>
            )}
          </div>
        </>
      )}

      <Drawer
        open={Boolean(viewed)}
        title={viewed ? `${viewed.job_code} · ${viewed.title}` : 'Job details'}
        onClose={() => setViewing(null)}
        size="xl"
        tone="info"
        footer={viewed && (
          <>
            <button type="button" className="btn-secondary" onClick={() => setViewing(null)}>Close</button>
            <button type="button" className="btn-secondary" onClick={() => copyText(viewed.job_code, alerts, `Job ID ${viewed.job_code} copied`)}>Copy Job ID</button>
            <button type="button" className="btn-secondary" onClick={() => { setReferring(viewed.slug); setApplying(null); setViewing(null); }}>Refer someone</button>
            {!viewed.applied && viewed.can_apply && <button type="button" className="btn-primary" onClick={() => { setApplying(viewed.slug); setReferring(null); setViewing(null); }}>Apply myself</button>}
          </>
        )}
      >
        {viewed && <JobDetails job={viewed} />}
      </Drawer>
    </div>
  );
}
