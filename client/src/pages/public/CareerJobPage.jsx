import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Briefcase, CheckCircle2, MapPin } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';

/** Shown on every public jobs page: a LinkedIn / WhatsApp / website link opens this without any login. */
function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#F5F6F8]">
      <header className="border-b border-tertiary-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <img src="/delphic-logo.png" alt="Delphic Global" className="h-9 w-auto" />
          <span className="text-sm font-semibold text-tertiary-700">Careers</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}

function Meta({ job }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-tertiary-600">
      {job.department && <span className="inline-flex items-center gap-1"><Briefcase className="h-4 w-4" />{job.department}</span>}
      {job.location && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{job.location}</span>}
      {job.employment_type && <span>{job.employment_type}</span>}
    </div>
  );
}

export function CareerListPage() {
  const [sp] = useSearchParams();
  const [jobs, setJobs] = useState(null);
  useEffect(() => { apiClient.get('/public/jobs').then((r) => setJobs(r.data.data)).catch(() => setJobs([])); }, []);
  const src = sp.get('src');
  return (
    <Shell>
      <h1 className="text-xl font-semibold text-tertiary-900">Open positions</h1>
      <div className="mt-4 space-y-3">
        {jobs === null && <p className="text-sm text-tertiary-500">Loading…</p>}
        {jobs?.length === 0 && <p className="rounded-xl border border-tertiary-100 bg-white p-6 text-center text-sm text-tertiary-500">There are no open positions right now. Please check back soon.</p>}
        {jobs?.map((j) => (
          <Link key={j.slug} to={`/careers/${j.slug}${src ? `?src=${encodeURIComponent(src)}` : ''}`} className="block rounded-xl border border-tertiary-100 bg-white p-4 shadow-card hover:border-primary-300">
            <p className="font-medium text-primary-700">{j.title}</p>
            <Meta job={j} />
          </Link>
        ))}
      </div>
    </Shell>
  );
}

export default function CareerJobPage() {
  const { slug } = useParams();
  const [sp] = useSearchParams();
  const channel = (sp.get('src') || '').slice(0, 40);
  const [job, setJob] = useState(undefined); // undefined = loading, null = not open
  const [form, setForm] = useState({ name: '', email: '', phone: '', experience_years: '', message: '', company_website: '' });
  const [state, setState] = useState({ busy: false, done: false, error: '' });
  useEffect(() => { apiClient.get(`/public/jobs/${slug}`).then((r) => setJob(r.data.data)).catch(() => setJob(null)); }, [slug]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, done: false, error: '' });
    try {
      await apiClient.post(`/public/jobs/${slug}/apply`, { ...form, channel: channel || undefined });
      setState({ busy: false, done: true, error: '' });
    } catch (err) {
      setState({ busy: false, done: false, error: err.response?.data?.message || 'Could not send your application. Please try again.' });
    }
  }

  if (job === undefined) return <Shell><p className="text-sm text-tertiary-500">Loading…</p></Shell>;
  if (job === null) return <Shell><div className="rounded-xl border border-tertiary-100 bg-white p-8 text-center"><p className="font-medium text-tertiary-800">This job is no longer open.</p><Link to="/careers" className="mt-2 inline-block text-sm text-primary-700 hover:underline">See other open positions</Link></div></Shell>;

  const input = 'w-full rounded-lg border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';
  return (
    <Shell>
      <article className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
        <h1 className="text-xl font-semibold text-tertiary-900">{job.title}</h1>
        <div className="mt-1"><Meta job={job} /></div>
        {job.description && <div className="mt-4 whitespace-pre-line text-sm leading-relaxed text-tertiary-700">{job.description}</div>}
      </article>
      <section className="mt-4 rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
        {state.done ? (
          <div className="py-6 text-center" data-testid="apply-done">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <p className="mt-2 font-medium text-tertiary-900">Thank you, your application has been received.</p>
            <p className="text-sm text-tertiary-500">Our recruitment team will contact you if your profile matches.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="text-base font-semibold text-tertiary-900">Apply for this job</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Full name *<input className={input} required maxLength={200} value={form.name} onChange={set('name')} /></label>
              <label className="text-sm">Email *<input className={input} type="email" required maxLength={200} value={form.email} onChange={set('email')} /></label>
              <label className="text-sm">Phone<input className={input} maxLength={40} value={form.phone} onChange={set('phone')} /></label>
              <label className="text-sm">Experience (years)<input className={input} type="number" min="0" max="70" step="0.5" value={form.experience_years} onChange={set('experience_years')} /></label>
            </div>
            <label className="block text-sm">Anything you would like to add<textarea className={input} rows={3} maxLength={2000} value={form.message} onChange={set('message')} /></label>
            {/* Honeypot: hidden from people, filled by bots. */}
            <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" name="company_website" value={form.company_website} onChange={set('company_website')} />
            {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{state.error}</p>}
            <button type="submit" className="btn-primary px-5 py-2 text-sm" disabled={state.busy}>{state.busy ? 'Sending…' : 'Submit application'}</button>
          </form>
        )}
      </section>
    </Shell>
  );
}
