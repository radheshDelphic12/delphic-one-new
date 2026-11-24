import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Briefcase, FileText, LogOut, Plus, Receipt, Users, X } from 'lucide-react';

// The vendor portal: its own page and sign-in for a vendor's people. Deliberately outside the company login and layout: it uses a bare axios
// instance and its own token (localStorage key below), so a company token and a vendor token can never be mixed up.
const TOKEN_KEY = 'vendor_portal_token';
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const saveToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* private window */ } };
const api = (token) => axios.create({ baseURL: '/api/v1/vendor-portal', headers: token ? { Authorization: `Bearer ${token}` } : {} });
const errText = (e) => e?.response?.data?.error?.message || e?.response?.data?.message || (e?.response?.status === 422 ? 'Please check the details and try again' : 'Something went wrong. Please try again.');
const money = (n, c = 'INR') => (n == null ? '-' : `${c} ${Number(n).toLocaleString('en-IN')}`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS = {
  pending_review: ['Waiting for review', 'bg-amber-50 text-amber-800 border-amber-200'],
  approved: ['Approved', 'bg-emerald-50 text-emerald-800 border-emerald-200'],
  rejected: ['Rejected', 'bg-rose-50 text-rose-800 border-rose-200'],
  withdrawn: ['Withdrawn', 'bg-slate-100 text-slate-600 border-slate-200'],
  uploaded: ['Received', 'bg-sky-50 text-sky-800 border-sky-200'],
  accepted: ['Accepted', 'bg-emerald-50 text-emerald-800 border-emerald-200'],
};
const Chip = ({ s }) => { const [label, cls] = STATUS[s] || [s, 'bg-slate-100 text-slate-600 border-slate-200']; return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>; };
const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100';
const btnCls = 'inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60';
const Field = ({ label, children, hint }) => (<label className="block text-sm font-medium text-slate-700">{label}{children}{hint && <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>}</label>);

function Login({ onDone }) {
  const resetToken = new URLSearchParams(window.location.search).get('reset') || '';
  const [mode, setMode] = useState(resetToken ? 'reset' : 'login'); // login | forgot | reset
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  async function forgot(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('').post('/forgot-password', { email }); setNotice('If that email has a vendor portal login, we have sent a link to choose a new password. It works for one hour.'); } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }
  async function reset(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('').post('/reset-password', { token: resetToken, password }); window.history.replaceState({}, '', '/vendor-portal'); setPassword(''); setMode('login'); setNotice('Your password is changed. Sign in with the new one.'); } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { const { data } = await api('').post('/login', { email, password }); saveToken(data.data.token); onDone(data.data.token); } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }
  if (mode !== 'login') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <form onSubmit={mode === 'reset' ? reset : forgot} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid={mode === 'reset' ? 'vendor-reset' : 'vendor-forgot'}>
          <h1 className="text-xl font-semibold text-slate-900">{mode === 'reset' ? 'Choose a new password' : 'Forgot your password?'}</h1>
          <p className="mt-1 text-sm text-slate-500">{mode === 'reset' ? 'Use at least 8 characters.' : 'Enter your email and we will send you a link to choose a new one.'}</p>
          <div className="mt-5 space-y-3">
            {mode === 'reset'
              ? <Field label="New password"><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></Field>
              : <Field label="Email"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></Field>}
          </div>
          {error && <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p>}
          {notice && <p className="mt-3 text-sm text-emerald-700" role="status">{notice}</p>}
          <button className={`${btnCls} mt-5 w-full justify-center`} disabled={busy} type="submit">{busy ? 'Please wait...' : mode === 'reset' ? 'Save new password' : 'Send the link'}</button>
          <button type="button" className="mt-3 w-full text-center text-sm text-slate-600 underline" onClick={() => { setMode('login'); setError(''); setNotice(''); }}>Back to sign in</button>
        </form>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="vendor-login">
        <h1 className="text-xl font-semibold text-slate-900">Vendor portal</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to see open requirements, put candidates forward and send invoices.</p>
        <div className="mt-5 space-y-3">
          <Field label="Email"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></Field>
          <Field label="Password"><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></Field>
        </div>
        {error && <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p>}
        {notice && <p className="mt-3 text-sm text-emerald-700" role="status">{notice}</p>}
        <button className={`${btnCls} mt-5 w-full justify-center`} disabled={busy} type="submit">{busy ? 'Signing in...' : 'Sign in'}</button>
        <button type="button" className="mt-3 w-full text-center text-sm text-slate-600 underline" onClick={() => { setMode('forgot'); setError(''); setNotice(''); }} data-testid="vendor-forgot-link">Forgot your password?</button>
      </form>
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-900">{title}</h2><button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

function RequirementsTab({ client, onSubmitted }) {
  const [rows, setRows] = useState(null); const [pick, setPick] = useState(null);
  const load = useCallback(() => client.get('/requirements').then((r) => setRows(r.data.data)).catch(() => setRows([])), [client]);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <p className="text-sm text-slate-500">Loading...</p>;
  return (
    <div data-testid="vp-requirements">
      {rows.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No open requirements have been shared with you right now.</p> : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4" data-testid="vp-requirement">
              <div className="flex items-start justify-between gap-2"><h3 className="font-semibold text-slate-900">{r.title}</h3><span className="text-xs text-slate-500">{r.seats_total} seat{r.seats_total === 1 ? '' : 's'}</span></div>
              <p className="mt-1 text-xs text-slate-500">{[r.designation, r.work_mode && r.work_mode.replace('_', ' '), r.work_location, r.engagement_type && r.engagement_type.replace('_', ' ')].filter(Boolean).join(' · ')}</p>
              {(r.experience_min != null || r.experience_max != null) && <p className="mt-1 text-xs text-slate-600">Experience: {r.experience_min ?? 0}{r.experience_max != null ? ` to ${r.experience_max}` : '+'} years</p>}
              {r.skills.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{r.skills.map((s) => <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{s}</span>)}</div>}
              {r.description && <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-slate-600">{r.description}</p>}
              <div className="mt-3 flex items-center justify-between"><span className="text-xs text-slate-500">{r.submitted ? `${r.submitted} put forward` : 'Nobody put forward yet'}</span><button type="button" className={btnCls} onClick={() => setPick(r)} data-testid="vp-put-forward"><Plus size={14} /> Put a candidate forward</button></div>
            </div>
          ))}
        </div>
      )}
      {pick && <CandidateForm client={client} requirement={pick} onClose={() => setPick(null)} onDone={() => { setPick(null); load(); onSubmitted(); }} />}
    </div>
  );
}

function CandidateForm({ client, requirement, onClose, onDone }) {
  const [f, setF] = useState({ candidate_name: '', email: '', phone: '', current_company: '', current_location: '', total_experience_years: '', relevant_experience_years: '', skills: '', current_ctc: '', expected_ctc: '', notice_period_days: '', vendor_rate: '', vendor_rate_currency: 'INR', linkedin_url: '', cv_url: '', notes: '' });
  const [cv, setCv] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    const fd = new FormData(); fd.append('requirement_id', requirement.id);
    Object.entries(f).forEach(([k, v]) => { if (v !== '') fd.append(k, v); });
    if (cv) fd.append('cv', cv);
    try { await client.post('/submissions', fd); onDone(); } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }
  return (
    <Sheet title={`Put a candidate forward: ${requirement.title}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" data-testid="vp-candidate-form">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Candidate name *"><input className={inputCls} value={f.candidate_name} onChange={set('candidate_name')} required /></Field>
          <Field label="Email"><input className={inputCls} type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Current company"><input className={inputCls} value={f.current_company} onChange={set('current_company')} /></Field>
          <Field label="Current location"><input className={inputCls} value={f.current_location} onChange={set('current_location')} /></Field>
          <Field label="Total experience (years) *"><input className={inputCls} type="number" step="0.1" min="0" value={f.total_experience_years} onChange={set('total_experience_years')} required /></Field>
          <Field label="Relevant experience (years)"><input className={inputCls} type="number" step="0.1" min="0" value={f.relevant_experience_years} onChange={set('relevant_experience_years')} /></Field>
          <Field label="Notice period (days)"><input className={inputCls} type="number" min="0" value={f.notice_period_days} onChange={set('notice_period_days')} /></Field>
          <Field label="Current CTC (per year)"><input className={inputCls} type="number" min="0" value={f.current_ctc} onChange={set('current_ctc')} /></Field>
          <Field label="Expected CTC (per year)"><input className={inputCls} type="number" min="0" value={f.expected_ctc} onChange={set('expected_ctc')} /></Field>
          <Field label="Your rate for this person (per month)" hint="What you want for this resource"><input className={inputCls} type="number" min="0" value={f.vendor_rate} onChange={set('vendor_rate')} /></Field>
          <Field label="Currency"><select className={inputCls} value={f.vendor_rate_currency} onChange={set('vendor_rate_currency')}>{['INR', 'USD', 'AED', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        </div>
        <Field label="Skills" hint="Separate with commas"><input className={inputCls} value={f.skills} onChange={set('skills')} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="CV file (PDF or Word)"><input className={inputCls} type="file" accept=".pdf,.doc,.docx" onChange={(e) => setCv(e.target.files?.[0] || null)} data-testid="vp-cv" /></Field>
          <Field label="or a link to the CV"><input className={inputCls} value={f.cv_url} onChange={set('cv_url')} placeholder="https://" /></Field>
        </div>
        <Field label="LinkedIn"><input className={inputCls} value={f.linkedin_url} onChange={set('linkedin_url')} /></Field>
        <Field label="Notes"><textarea className={inputCls} rows={2} value={f.notes} onChange={set('notes')} /></Field>
        {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm">Cancel</button><button className={btnCls} disabled={busy} type="submit" data-testid="vp-send-candidate">{busy ? 'Sending...' : 'Send for review'}</button></div>
      </form>
    </Sheet>
  );
}

function SubmissionsTab({ client, refreshKey }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => client.get('/submissions').then((r) => setRows(r.data.data)).catch(() => setRows([])), [client]);
  useEffect(() => { load(); }, [load, refreshKey]);
  async function withdraw(id) { try { await client.post(`/submissions/${id}/withdraw`); load(); } catch (e) { window.alert(errText(e)); } }
  if (!rows) return <p className="text-sm text-slate-500">Loading...</p>;
  if (!rows.length) return <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">You have not put anyone forward yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" data-testid="vp-submissions">
      <table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Candidate</th><th className="px-3 py-2">Requirement</th><th className="px-3 py-2">Experience</th><th className="px-3 py-2">Your rate</th><th className="px-3 py-2">Status</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="border-t border-slate-100" data-testid="vp-submission-row">
            <td className="px-3 py-2 font-medium text-slate-900">{r.candidate_name}</td><td className="px-3 py-2">{r.requirement_title}</td><td className="px-3 py-2">{r.total_experience_years} yrs</td><td className="px-3 py-2">{money(r.vendor_rate, r.vendor_rate_currency)}</td>
            <td className="px-3 py-2"><Chip s={r.status} />{r.status === 'rejected' && r.decision_note && <div className="mt-1 text-xs text-rose-700">{r.decision_note}</div>}</td>
            <td className="px-3 py-2 text-right">{r.status === 'pending_review' && <button type="button" className="text-xs text-slate-600 underline" onClick={() => withdraw(r.id)}>Withdraw</button>}</td>
          </tr>))}</tbody></table>
    </div>
  );
}

function ResourcesTab({ client }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { client.get('/resources').then((r) => setRows(r.data.data)).catch(() => setRows([])); }, [client]);
  if (!rows) return <p className="text-sm text-slate-500">Loading...</p>;
  if (!rows.length) return <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No resources of yours are placed with us right now.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" data-testid="vp-resources">
      <table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Resource</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Your rate (per month)</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-900">{r.name}</td><td className="px-3 py-2">{r.designation || '-'}</td><td className="px-3 py-2 capitalize">{String(r.status || '').replace('_', ' ')}</td><td className="px-3 py-2">{money(r.vendor_rate, r.currency)}</td></tr>)}</tbody></table>
    </div>
  );
}

function InvoicesTab({ client, token }) {
  const now = new Date();
  const [rows, setRows] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ period_month: String(now.getMonth() + 1), period_year: String(now.getFullYear()), invoice_number: '', amount: '', currency: 'INR', notes: '' });
  const [file, setFile] = useState(null); const [key, setKey] = useState(0);
  const load = () => client.get('/invoices').then((r) => setRows(r.data.data)).catch(() => setRows([]));
  useEffect(() => { client.get('/invoices').then((r) => setRows(r.data.data)).catch(() => setRows([])); }, [client]);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); if (!file) { setError('Choose the invoice file'); return; }
    setBusy(true); setError('');
    const fd = new FormData(); Object.entries(f).forEach(([k, v]) => { if (v !== '') fd.append(k, v); }); fd.append('file', file);
    try { await client.post('/invoices', fd); setFile(null); setKey((k) => k + 1); setF((p) => ({ ...p, invoice_number: '', amount: '', notes: '' })); load(); } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }
  async function open(id, name) {
    try { const res = await axios.get(`/api/v1/vendor-portal/invoices/${id}/file`, { headers: { Authorization: `Bearer ${token}` }, responseType: 'blob' }); const url = URL.createObjectURL(res.data); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); } catch (e) { window.alert(errText(e)); }
  }
  return (
    <div className="space-y-4" data-testid="vp-invoices">
      <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-slate-900">Send an invoice</h3>
        <p className="text-xs text-slate-500">The file reaches our finance team. It is checked there; sending it here does not raise an invoice by itself.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Month"><select className={inputCls} value={f.period_month} onChange={set('period_month')}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
          <Field label="Year"><input className={inputCls} type="number" value={f.period_year} onChange={set('period_year')} /></Field>
          <Field label="Invoice number"><input className={inputCls} value={f.invoice_number} onChange={set('invoice_number')} /></Field>
          <Field label="Amount"><input className={inputCls} type="number" min="0" value={f.amount} onChange={set('amount')} /></Field>
          <Field label="Currency"><select className={inputCls} value={f.currency} onChange={set('currency')}>{['INR', 'USD', 'AED', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Invoice file *"><input key={key} className={inputCls} type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="vp-invoice-file" /></Field>
        </div>
        <Field label="Notes"><input className={inputCls} value={f.notes} onChange={set('notes')} /></Field>
        {error && <p className="mt-2 text-sm text-rose-700" role="alert">{error}</p>}
        <div className="mt-3 flex justify-end"><button className={btnCls} disabled={busy} type="submit" data-testid="vp-send-invoice">{busy ? 'Sending...' : 'Send invoice'}</button></div>
      </form>
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Period</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-slate-100" data-testid="vp-invoice-row"><td className="px-3 py-2">{MONTHS[r.period_month - 1]} {r.period_year}</td><td className="px-3 py-2">{r.invoice_number || r.file_name}</td><td className="px-3 py-2">{money(r.amount, r.currency)}</td><td className="px-3 py-2"><Chip s={r.status} />{r.status === 'rejected' && r.review_note && <div className="mt-1 text-xs text-rose-700">{r.review_note}</div>}</td><td className="px-3 py-2 text-right"><button type="button" className="text-xs text-blue-700 underline" onClick={() => open(r.id, r.file_name)}>Download</button></td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function VendorPortalPage() {
  const [token, setToken] = useState(readToken());
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('requirements');
  const [bump, setBump] = useState(0);
  const client = useMemo(() => api(token), [token]);
  useEffect(() => {
    if (!token) return;
    client.get('/me').then((r) => setMe(r.data.data)).catch(() => { saveToken(''); setToken(''); setMe(null); });
  }, [token, client]);
  if (!token) return <Login onDone={setToken} />;
  if (!me) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading...</div>;
  const tabs = [['requirements', 'Open requirements', Briefcase], ['submissions', 'My candidates', Users], ['resources', 'My resources', FileText], ['invoices', 'Invoices', Receipt]];
  return (
    <div className="min-h-screen bg-slate-50" data-testid="vendor-portal">
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3"><div><div className="text-sm text-slate-500">Vendor portal</div><div className="font-semibold text-slate-900">{me.vendor.name}</div></div>
        <div className="flex items-center gap-3 text-sm text-slate-600"><span className="hidden sm:inline">{me.name}</span><button type="button" onClick={() => { saveToken(''); setToken(''); setMe(null); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 hover:bg-slate-50"><LogOut size={14} /> Sign out</button></div></div></header>
      <main className="mx-auto max-w-5xl px-4 py-5">
        <nav className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">{tabs.map(([k, label, Icon]) => <button key={k} type="button" onClick={() => setTab(k)} data-testid={`vp-tab-${k}`} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${tab === k ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon size={15} />{label}</button>)}</nav>
        {tab === 'requirements' && <RequirementsTab client={client} onSubmitted={() => { setBump((b) => b + 1); setTab('submissions'); }} />}
        {tab === 'submissions' && <SubmissionsTab client={client} refreshKey={bump} />}
        {tab === 'resources' && <ResourcesTab client={client} />}
        {tab === 'invoices' && <InvoicesTab client={client} token={token} />}
      </main>
    </div>
  );
}
