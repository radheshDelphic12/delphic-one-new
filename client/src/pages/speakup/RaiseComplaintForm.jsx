import { useState } from 'react';
import { Check, Copy, ShieldCheck, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useOrgMembershipOptions } from '../../lib/lookups.js';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import EvidencePicker from './EvidencePicker.jsx';

const FIELD = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const LABEL = 'block text-xs font-medium text-tertiary-600';
const todayIso = () => new Date().toLocaleDateString('en-CA');
const EMPTY = { category_id: '', subject: '', description: '', incident_date: '', location_id: '', department_id: '', people_involved: '', mode: 'confidential' };

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }).catch(() => {}); }}>
      {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {done ? 'Copied' : label}
    </button>
  );
}

/** The shown-once result: the complaint reference number, and for an anonymous complaint the tracking code. */
function Submitted({ result, onAnother, onMine }) {
  return (
    <div className="space-y-4 rounded-2xl border border-green-200 bg-green-50/50 p-5" data-testid="speakup-submitted">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-6 w-6 text-green-700" aria-hidden="true" />
        <div>
          <h3 className="font-heading text-base font-semibold text-tertiary-900">Your complaint has been received</h3>
          <p className="mt-1 text-sm text-tertiary-600">It has gone to the people who handle this category. Use the reference number below to follow it.</p>
        </div>
      </div>
      <div className="rounded-xl border border-tertiary-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-tertiary-500">Complaint reference number</p>
        <p className="mt-1 font-mono text-2xl font-semibold text-tertiary-900" data-testid="speakup-reference">{result.case.case_no}</p>
        <div className="mt-2"><CopyButton text={result.case.case_no} label="Copy reference number" /></div>
      </div>
      {result.access_code && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4" data-testid="speakup-code">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Your tracking code (shown only once)</p>
          <p className="mt-1 font-mono text-xl font-semibold text-tertiary-900">{result.access_code}</p>
          <p className="mt-2 text-sm text-amber-900">Your name is not saved with this complaint. To check its status or add more information, you need the reference number <strong>and</strong> this code. We cannot recover it for you, so keep it safe.</p>
          <div className="mt-2"><CopyButton text={result.access_code} label="Copy tracking code" /></div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!result.access_code && <button type="button" className="btn-primary" onClick={onMine}>View my complaints</button>}
        <button type="button" className="btn-secondary" onClick={onAnother}>Raise another complaint</button>
      </div>
    </div>
  );
}

/**
 * Raise a complaint: pick the category, describe what happened (when, where, which department, who), attach evidence, and
 * choose to be confidential (the handlers see your name) or anonymous (no name is saved at all).
 */
export default function RaiseComplaintForm({ meta, onMine }) {
  const { pushError } = useAlerts();
  const [values, setValues] = useState(EMPTY);
  const [involved, setInvolved] = useState([]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const members = useOrgMembershipOptions(true);
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const category = meta.categories.find((c) => c.id === values.category_id);

  async function submit(event) {
    event.preventDefault();
    if (!values.category_id) return pushError('Choose the category that fits best.', 'Please fix the form');
    setBusy(true);
    try {
      const body = new FormData();
      Object.entries(values).forEach(([k, v]) => { if (v !== '') body.append(k, v); });
      if (involved.length) body.append('involved_membership_ids', JSON.stringify(involved.map((p) => p.value)));
      files.forEach((f) => body.append('files', f));
      const { data } = await apiClient.post('/whistleblower/cases', body);
      setResult(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not send the complaint'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (result) return <Submitted result={result} onMine={onMine} onAnother={() => { setResult(null); setValues(EMPTY); setInvolved([]); setFiles([]); }} />;

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card" data-testid="speakup-form">
      <div className="rounded-xl bg-primary-50 px-4 py-3 text-sm text-tertiary-700">
        <p className="font-medium text-tertiary-900">Speak up in confidence.</p>
        <p className="mt-0.5">Your complaint reaches only the people set to handle its category. Retaliation against anyone who reports in good faith is itself something you can report here.</p>
      </div>

      <label className={LABEL}>Category *
        <select required className={FIELD} value={values.category_id} onChange={set('category_id')}>
          <option value="">Select the category that fits best…</option>
          {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.number}. {c.name}</option>)}
        </select>
        {category && <span className="mt-1 block text-xs font-normal text-tertiary-500">Examples: {category.examples}</span>}
      </label>

      <label className={LABEL}>Title *
        <input required minLength={3} maxLength={200} className={FIELD} value={values.subject} onChange={set('subject')} placeholder="A short title for what happened" />
      </label>
      <label className={LABEL}>Description of the incident *
        <textarea required minLength={10} maxLength={6000} rows={6} className={FIELD} value={values.description} onChange={set('description')} placeholder="What happened, in your own words. Include as much detail as you can." />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={LABEL}>Date of the incident
          <input type="date" max={todayIso()} className={FIELD} value={values.incident_date} onChange={set('incident_date')} />
        </label>
        <label className={LABEL}>Location (office)
          <select className={FIELD} value={values.location_id} onChange={set('location_id')}>
            <option value="">Not sure / not applicable</option>
            {meta.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className={LABEL}>Department
          <select className={FIELD} value={values.department_id} onChange={set('department_id')}>
            <option value="">Not sure / not applicable</option>
            {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>

      <div>
        <p className={LABEL}>Individuals involved, if known</p>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          <SearchableSelect value="" onChange={(id) => { const person = members.find((m) => m.value === id); if (person && !involved.some((p) => p.value === id)) setInvolved((list) => [...list, person]); }} options={members} placeholder="Pick a colleague…" />
          <input maxLength={500} className="w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm" value={values.people_involved} onChange={set('people_involved')} placeholder="Or write names / roles (also people outside the company)" />
        </div>
        {involved.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {involved.map((p) => (
              <li key={p.value} className="inline-flex items-center gap-1 rounded-full bg-tertiary-100 px-3 py-1 text-xs">
                {p.label}
                <button type="button" aria-label={`Remove ${p.label}`} onClick={() => setInvolved((list) => list.filter((x) => x.value !== p.value))}><X className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-tertiary-500">People you pick here never see or receive this complaint.</p>
      </div>

      <EvidencePicker files={files} onChange={setFiles} />

      <fieldset className="space-y-2 rounded-xl border border-tertiary-200 p-3">
        <legend className="px-1 text-xs font-medium text-tertiary-600">How do you want to report?</legend>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="radio" name="mode" className="mt-1" checked={values.mode === 'confidential'} onChange={() => setValues((v) => ({ ...v, mode: 'confidential' }))} />
          <span><strong>Confidential</strong>: the people handling it can see your name. Nobody else can. You follow it under My complaints.</span>
        </label>
        {meta.allow_anonymous && (
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="mode" className="mt-1" checked={values.mode === 'anonymous'} onChange={() => setValues((v) => ({ ...v, mode: 'anonymous' }))} />
            <span><strong>Anonymous</strong>: your name is not saved at all. You get a tracking code to follow it; without the code it cannot be recovered, and the team can only ask you questions through it.</span>
          </label>
        )}
      </fieldset>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Submit complaint'}</button>
      </div>
    </form>
  );
}
