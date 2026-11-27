import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

// The public lead form (no login): someone interested leaves their details; it becomes a lead in the Delphic One workspace.
const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100';

export default function LeadFormPage() {
  const { token } = useParams();
  const [form, setForm] = useState(undefined);
  const [v, setV] = useState({ company_name: '', contact_name: '', contact_email: '', contact_phone: '', users_expected: '', message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => { axios.get(`/api/v1/public/lead-forms/${encodeURIComponent(token)}`).then(({ data }) => setForm(data.data)).catch(() => setForm(null)); }, [token]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await axios.post(`/api/v1/public/lead-forms/${encodeURIComponent(token)}`, v); setSent(true); } catch (err) { setError(err?.response?.status === 422 ? 'Please check your name, company and email.' : 'Something went wrong. Please try again.'); } finally { setBusy(false); }
  }
  if (form === undefined) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading...</div>;
  if (!form) return <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-sm text-slate-600">This form is not available.</div>;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="public-lead-form">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{form.company}</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{form.title}</h1>
        {form.intro && <p className="mt-1 text-sm text-slate-600">{form.intro}</p>}
        {sent ? <p className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="lead-form-thanks">Thank you. We have your details and will be in touch soon.</p> : (
          <form onSubmit={submit} className="mt-5 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">Your name *<input className={inputCls} value={v.contact_name} onChange={set('contact_name')} required /></label>
              <label className="block text-sm font-medium text-slate-700">Company *<input className={inputCls} value={v.company_name} onChange={set('company_name')} required /></label>
              <label className="block text-sm font-medium text-slate-700">Work email *<input type="email" className={inputCls} value={v.contact_email} onChange={set('contact_email')} required /></label>
              <label className="block text-sm font-medium text-slate-700">Phone<input className={inputCls} value={v.contact_phone} onChange={set('contact_phone')} /></label>
              <label className="block text-sm font-medium text-slate-700">How many users?<input type="number" min="0" className={inputCls} value={v.users_expected} onChange={set('users_expected')} /></label>
            </div>
            <label className="block text-sm font-medium text-slate-700">What do you need?<textarea rows={3} className={inputCls} value={v.message} onChange={set('message')} /></label>
            {/* left empty by people; bots fill it */}
            <input type="text" name="website" value={v.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60" data-testid="lead-form-send">{busy ? 'Sending...' : 'Send'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
