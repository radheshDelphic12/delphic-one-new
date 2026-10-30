import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';

const NUMBER_FIELDS = [
  { key: 'question_count', label: 'Role questions', hint: '3 to 15 questions built from the job and the candidate\'s profile', min: 3, max: 15 },
  { key: 'max_followups', label: 'Follow-ups (most per interview)', hint: 'Short follow-ups on vague answers; 0 turns them off', min: 0, max: 10 },
  { key: 'pass_percentage', label: 'Pass mark %', hint: 'At or above this the candidate passes', min: 1, max: 100 },
  { key: 'borderline_margin', label: 'Borderline range (points)', hint: 'Just under the pass mark within this many points = borderline, a person decides', min: 0, max: 50 },
  { key: 'link_valid_days', label: 'Link valid for (days)', hint: 'One attempt per link', min: 1, max: 60 },
];
const WEIGHTS = [
  { key: 'weight_knowledge', label: 'Role knowledge' },
  { key: 'weight_communication', label: 'Communication' },
  { key: 'weight_depth', label: 'Depth' },
  { key: 'weight_aptitude', label: 'Aptitude' },
];

function Switch({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-tertiary-800">
      <input type="checkbox" className="mt-1" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-tertiary-500">{hint}</span>}
      </span>
    </label>
  );
}

function NumberField({ field, value, onChange, disabled }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-tertiary-600">{field.label}</label>
      <input type="number" className={FIELD_INPUT} min={field.min} max={field.max} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
      {field.hint && <p className="mt-1 text-xs text-tertiary-500">{field.hint}</p>}
    </div>
  );
}

/**
 * Admin settings of the AI interview. The whole feature is off until switched on here: it is an optional, separate link
 * on a candidate's page and nothing in the existing interview flow depends on it.
 */
export default function AiInterviewTab({ isAdmin }) {
  const { pushError, pushSuccess } = useAlerts();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient.get('/ai-interviews/settings').then(({ data }) => setForm(data.data)).catch((err) => pushError(apiErrorMessage(err, 'Could not load the AI interview settings'), 'Something went wrong'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!form) return <p className="text-sm text-tertiary-500">Loading...</p>;
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const weights = WEIGHTS.filter((w) => w.key !== 'weight_aptitude' || form.aptitude_enabled);
  const total = weights.reduce((s, w) => s + (Number(form[w.key]) || 0), 0);

  async function save() {
    setBusy(true);
    try {
      const body = {
        ...Object.fromEntries([...NUMBER_FIELDS, ...WEIGHTS, { key: 'aptitude_question_count' }, { key: 'recording_retention_days' }].map((f) => [f.key, Number(form[f.key])])),
        is_enabled: form.is_enabled, aptitude_enabled: form.aptitude_enabled, recording_enabled: form.recording_enabled,
        extra_instructions: (form.extra_instructions || '').trim() || null,
      };
      const { data } = await apiClient.put('/ai-interviews/settings', body);
      setForm(data.data);
      pushSuccess('AI interview settings saved.', 'Saved');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the settings'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const off = !isAdmin;
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <Switch checked={form.is_enabled} onChange={set('is_enabled')} disabled={off} label="Offer the AI interview" hint="Off by default. When on, recruiters see a separate 'AI interview' card on a candidate's page where they can send the candidate a link. The existing screening test and interview rounds are not changed and never wait for it." />
      </div>

      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-tertiary-900">Interview</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {NUMBER_FIELDS.map((f) => <NumberField key={f.key} field={f} value={form[f.key]} onChange={set(f.key)} disabled={off} />)}
        </div>
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-tertiary-600">Extra instructions for the AI (optional)</label>
          <textarea className={FIELD_INPUT} rows={3} maxLength={1500} disabled={off} value={form.extra_instructions || ''} onChange={(e) => set('extra_instructions')(e.target.value)} placeholder="e.g. Ask about Salesforce integrations; keep a friendly tone." />
        </div>
      </div>

      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-tertiary-900">Aptitude section</h3>
        <div className="mt-3 space-y-3">
          <Switch checked={form.aptitude_enabled} onChange={set('aptitude_enabled')} label="Add an aptitude section" hint="The AI writes a few logic, number and pattern questions with their expected answers and marks the candidate's answers against them." />
          {form.aptitude_enabled && (
            <div className="max-w-xs"><NumberField field={{ label: 'Aptitude questions', hint: '2 to 10', min: 2, max: 10 }} value={form.aptitude_question_count} onChange={set('aptitude_question_count')} disabled={off} /></div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-tertiary-900">Score weights</h3>
        <p className="text-xs text-tertiary-500">Each part is scored 0 to 10. The total is the weighted average, so the weights are shares: they need not add to 100.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {weights.map((w) => <NumberField key={w.key} field={{ label: `${w.label} weight`, min: 0, max: 100 }} value={form[w.key]} onChange={set(w.key)} disabled={off} />)}
        </div>
        <p className="mt-2 text-xs text-tertiary-500">{total > 0 ? weights.map((w) => `${w.label} ${Math.round(((Number(form[w.key]) || 0) / total) * 100)}%`).join(' · ') : 'At least one weight must be above 0.'}</p>
      </div>

      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-tertiary-900">Recording (audio + video)</h3>
        <div className="mt-3 space-y-3">
          <Switch checked={form.recording_enabled} onChange={set('recording_enabled')} label="Offer to record the interview" hint="Off by default. When on, the candidate is asked for permission first and can still take the interview without being recorded. Recordings are deleted automatically after the days below; the transcript and scores stay." />
          {form.recording_enabled && (
            <div className="max-w-xs"><NumberField field={{ label: 'Keep recordings for (days)', hint: '1 to 30; 2 by default', min: 1, max: 30 }} value={form.recording_retention_days} onChange={set('recording_retention_days')} disabled={off} /></div>
          )}
        </div>
      </div>

      {isAdmin ? (
        <button type="button" className="btn-primary" disabled={busy || total <= 0} onClick={save}>{busy ? 'Saving...' : 'Save settings'}</button>
      ) : <p className="text-xs text-tertiary-500">Only an admin can change these settings.</p>}
    </div>
  );
}
