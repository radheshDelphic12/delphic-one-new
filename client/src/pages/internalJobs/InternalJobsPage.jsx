import { useState } from 'react';
import { Briefcase, MapPin, UserPlus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Pill from '../../components/ui/Pill.jsx';
import { useAuth } from '../../lib/authContext.jsx';
import ScreeningFields, { emptyScreening, screeningPayload } from '../../components/applicants/ScreeningFields.jsx';

const input = 'mt-1 w-full rounded-lg border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';

function ReferForm({ job, onDone }) {
  const { pushSuccess, pushError } = useAlerts();
  const [v, setV] = useState({ name: '', email: '', phone: '', experience_years: '', message: '' });
  const [screening, setScreening] = useState(emptyScreening);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiClient.post(`/internal-jobs/${job.slug}/refer`, { ...v, ...screeningPayload(screening) });
      pushSuccess('Thank you, your referral has been sent to the recruitment team');
      onDone();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not send the referral'), 'Referral'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-xl border border-tertiary-100 bg-[#F9FAFB] p-3" data-testid="refer-form">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-tertiary-600">Name *<input className={input} required value={v.name} onChange={set('name')} /></label>
        <label className="text-xs font-medium text-tertiary-600">Email *<input className={input} type="email" required value={v.email} onChange={set('email')} /></label>
        <label className="text-xs font-medium text-tertiary-600">Phone<input className={input} value={v.phone} onChange={set('phone')} /></label>
        <label className="text-xs font-medium text-tertiary-600">Experience (years)<input className={input} type="number" min="0" step="0.5" value={v.experience_years} onChange={set('experience_years')} /></label>
      </div>
      <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => setMore((m) => !m)}>{more ? 'Hide details' : 'Add more details if you know them (LinkedIn, CTC, notice period ...)'}</button>
      {more && <ScreeningFields value={screening} onChange={setScreening} inputCls={input} labelCls="text-xs font-medium text-tertiary-600" />}
      <label className="block text-xs font-medium text-tertiary-600">Why are they a good fit?<textarea className={input} rows={2} value={v.message} onChange={set('message')} /></label>
      <button type="submit" className="btn-primary px-4 py-1.5 text-xs" disabled={busy}>{busy ? 'Sending…' : 'Send referral'}</button>
    </form>
  );
}

/**
 * Internal jobs: the jobs that are open on the website, shown to every employee. Anyone can refer a person, and an employee
 * whose project is ending (on the bench) can apply for a job themselves. Both go to the recruiters' applicant pool.
 */
export default function InternalJobsPage() {
  const { pushSuccess, pushError } = useAlerts();
  const { isGroupSuperadmin } = useAuth();
  // everyone except the group superadmin gets the refreshed look; the superadmin keeps the original one
  const modern = !isGroupSuperadmin;
  const jobs = useLiveData(() => apiClient.get('/internal-jobs').then((r) => r.data.data), { intervalMs: 60000, deps: [] });
  const rows = jobs.data || [];
  const [referring, setReferring] = useState(null);
  async function applyMyself(job) {
    try {
      await apiClient.post(`/internal-jobs/${job.slug}/apply`, {});
      pushSuccess('Your application has been sent to the recruitment team');
      jobs.refresh();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not apply'), 'Internal jobs'); }
  }
  return (
    <div className={`space-y-4 ${modern ? 'ta-modern' : ''}`}>
      {modern ? (
        <div className="ta-head flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Careers</p>
            <h1 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Internal jobs</h1>
            <p className="mt-1 text-sm text-tertiary-500">Open positions at Delphic. Refer someone you know, or apply yourself if your project is ending.</p>
          </div>
          <span className="rounded-full border border-primary-100 bg-white px-3 py-1 text-xs font-semibold text-primary-700 shadow-sm">{rows.length} open position{rows.length === 1 ? '' : 's'}</span>
        </div>
      ) : (
        <div>
          <h1 className="text-xl font-semibold text-tertiary-900">Internal jobs</h1>
          <p className="text-sm text-tertiary-500">Open positions at Delphic. Refer someone you know, or apply yourself if your project is ending.</p>
        </div>
      )}
      <div className="space-y-3">
        {rows.map((j) => (
          <article key={j.slug} className={`rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card ${modern ? 'transition-shadow hover:shadow-cardHover' : ''}`} data-testid="internal-job">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-start gap-3">
                {modern && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Briefcase className="h-5 w-5" /></span>}
                <div>
                <h2 className="text-base font-semibold text-tertiary-900">{j.title}</h2>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-tertiary-500">
                  {j.department && <span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{j.department}</span>}
                  {j.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{j.location}</span>}
                  {j.employment_type && <span>{j.employment_type}</span>}
                </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {j.referrals > 0 && <Pill tone="blue">{j.referrals} referred by you</Pill>}
                {j.applied && <Pill tone="green">You applied</Pill>}
                <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={() => setReferring(referring === j.slug ? null : j.slug)}><UserPlus className="h-3.5 w-3.5" />Refer someone</button>
                {!j.applied && (j.can_apply
                  ? <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => applyMyself(j)}>Apply myself</button>
                  : <button type="button" disabled title="Only for employees on the bench or serving notice" className="btn-primary cursor-not-allowed px-3 py-1.5 text-xs opacity-50">Apply myself</button>)}
              </div>
            </div>
            {j.description && <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-tertiary-700">{j.description}</p>}
            {referring === j.slug && <ReferForm job={j} onDone={() => { setReferring(null); jobs.refresh(); }} />}
          </article>
        ))}
        {!rows.length && <p className="rounded-xl border border-tertiary-100 bg-white p-8 text-center text-sm text-tertiary-500">{jobs.loading ? 'Loading…' : 'There are no open positions right now.'}</p>}
      </div>
    </div>
  );
}
