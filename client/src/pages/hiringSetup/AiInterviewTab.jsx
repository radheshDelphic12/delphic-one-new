import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';

const DIFFICULTY_OPTIONS = [['easy', 'Easy (everyday work questions)'], ['medium', 'Medium (typical for the level)'], ['hard', 'Hard (probes edge cases and trade-offs)']];
const MARKING_OPTIONS = [['lenient', 'Lenient (average candidate about 60-70%)'], ['balanced', 'Balanced (average candidate about 50-60%)'], ['strict', 'Strict (average candidate about 40-50%)']];

const NUMBER_FIELDS = [
  { key: 'question_count', label: 'Role questions', hint: '3 to 15 (12 by default), built from the job and the candidate\'s profile', min: 3, max: 15 },
  { key: 'max_followups', label: 'Follow-ups (most per interview)', hint: 'Short follow-ups on vague answers; 0 turns them off', min: 0, max: 10 },
  { key: 'pass_percentage', label: 'Pass mark %', hint: 'At or above this the candidate passes', min: 1, max: 100 },
  { key: 'borderline_margin', label: 'Borderline range (points)', hint: 'Just under the pass mark within this many points = borderline, a person decides', min: 0, max: 50 },
  { key: 'link_valid_days', label: 'Link valid for (days)', hint: 'One attempt per link', min: 1, max: 60 },
  { key: 'answer_time_seconds', label: 'Time per question (seconds)', hint: 'A countdown on every question; when it ends the typed answer is sent. 0 = no limit', min: 0, max: 1800 },
  { key: 'max_tab_switches', label: 'Leaves before the interview ends', hint: 'Leaving the interview page (or full screen) is warned about; the interview ends on this many. 3 = two warnings, then it ends on the third. 0 = only log', min: 0, max: 20 },
];
const WEIGHTS = [
  { key: 'weight_knowledge', label: 'Role knowledge' },
  { key: 'weight_communication', label: 'Communication' },
  { key: 'weight_depth', label: 'Depth' },
  { key: 'weight_problem_solving', label: 'Problem solving' },
  { key: 'weight_experience_fit', label: 'Experience fit' },
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
function Stat({ label, value, tone = '' }) {
  return (
    <div className="rounded-xl border border-tertiary-100 bg-white px-3 py-2">
      <p className={`text-lg font-semibold ${tone || 'text-tertiary-900'}`}>{value ?? '-'}</p>
      <p className="text-xs text-tertiary-500">{label}</p>
    </div>
  );
}

/** How the AI interviews are going: sent, finished, pass / borderline / below pass, how often a person overrode the AI. */
function AiAnalytics() {
  const [stats, setStats] = useState(null);
  useEffect(() => { apiClient.get('/ai-interviews/analytics').then(({ data }) => setStats(data.data)).catch(() => setStats(null)); }, []);
  if (!stats) return null;
  return (
    <div className="rounded-2xl border border-tertiary-100 bg-tertiary-50/40 p-4">
      <h3 className="text-sm font-semibold text-tertiary-900">How it is going</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Links sent" value={stats.sent} />
        <Stat label="Finished" value={stats.completed} />
        <Stat label="Pass" value={stats.pass} tone="text-success-700" />
        <Stat label="Borderline" value={stats.borderline} tone="text-warning-700" />
        <Stat label="Below pass" value={stats.below_pass} tone="text-danger-700" />
        <Stat label="Needs review" value={stats.pending_review} />
        <Stat label="Not opened" value={stats.not_started} />
        <Stat label="In progress" value={stats.in_progress} />
        <Stat label="Decided by a person" value={stats.overridden} />
        <Stat label="Auto-rejected" value={stats.auto_rejected} />
        <Stat label="Average score" value={stats.average_score != null ? `${stats.average_score}%` : '-'} />
        <Stat label="Average minutes" value={stats.average_minutes} />
      </div>
    </div>
  );
}

export default function AiInterviewTab({ isAdmin }) {
  const { pushError, pushSuccess } = useAlerts();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState([]);

  useEffect(() => {
    apiClient.get('/users/directory', { params: { active: 'true' } }).then(({ data }) => setPeople(data.data || [])).catch(() => setPeople([]));
    apiClient.get('/ai-interviews/settings').then(({ data }) => setForm(data.data)).catch((err) => pushError(apiErrorMessage(err, 'Could not load the AI interview settings'), 'Something went wrong'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!form) return <p className="text-sm text-tertiary-500">Loading...</p>;
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const weights = WEIGHTS.filter((w) => w.key !== 'weight_aptitude' || form.aptitude_enabled);
  const total = weights.reduce((s, w) => s + (Number(form[w.key]) || 0), 0);
  // The marking scheme is out of 100, like an exam paper: each section carries a number of marks. A scheme that does not add up to 100
  // still works (the result is always worked out out of 100), but is flagged and can be scaled to 100 with one click.
  function scaleTo100() {
    if (total <= 0) return;
    const raw = weights.map((w) => ((Number(form[w.key]) || 0) / total) * 100);
    const marks = raw.map(Math.floor);
    let left = 100 - marks.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { marks[i] += 1; left -= 1; } });
    setForm((f) => ({ ...f, ...Object.fromEntries(weights.map((w, i) => [w.key, marks[i]])) }));
  }

  async function save() {
    setBusy(true);
    try {
      const body = {
        ...Object.fromEntries([...NUMBER_FIELDS, ...WEIGHTS, { key: 'aptitude_question_count' }, { key: 'recording_retention_days' }].map((f) => [f.key, Number(form[f.key])])),
        is_enabled: form.is_enabled, aptitude_enabled: form.aptitude_enabled, recording_enabled: form.recording_enabled, auto_reject: form.auto_reject, use_reference_sites: form.use_reference_sites, reference_sites: (form.reference_sites || '').trim(), recording_viewer_ids: form.recording_viewer_ids || [],
        extra_instructions: (form.extra_instructions || '').trim() || null,
        difficulty: form.difficulty || 'easy', marking: form.marking || 'lenient', require_fullscreen: form.require_fullscreen !== false,
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
      <AiAnalytics />
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <Switch checked={form.is_enabled} onChange={set('is_enabled')} disabled={off} label="Offer the AI interview" hint="Off by default. When on, recruiters see a separate 'AI interview' card on a candidate's page where they can send the candidate a link. The existing screening test and interview rounds are not changed and never wait for it." />
      </div>

      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-tertiary-900">Interview</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-600" htmlFor="ai-difficulty">Question difficulty</label>
            <select id="ai-difficulty" className={FIELD_INPUT} disabled={off} value={form.difficulty || 'easy'} onChange={(e) => set('difficulty')(e.target.value)}>
              {DIFFICULTY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-tertiary-500">How hard the AI makes the questions for the candidate&apos;s level. Easy by default.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-600" htmlFor="ai-marking">Marking</label>
            <select id="ai-marking" className={FIELD_INPUT} disabled={off} value={form.marking || 'lenient'} onChange={(e) => set('marking')(e.target.value)}>
              {MARKING_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-tertiary-500">How strictly answers are scored. Lenient by default, so an average candidate lands at about 60-70%.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {NUMBER_FIELDS.map((f) => <NumberField key={f.key} field={f} value={form[f.key]} onChange={set(f.key)} disabled={off} />)}
        </div>
        <div className="mt-4">
          <Switch checked={form.require_fullscreen !== false} onChange={set('require_fullscreen')} disabled={off} label="Require full screen and a single display" hint="On by default. The candidate must stay in full screen (nothing else can sit next to the interview) and use one display. Leaving full screen is counted like leaving the page, again every 20 seconds until they return, and too many ends the interview for review." />
        </div>
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-tertiary-600">Extra instructions for the AI (optional)</label>
          <textarea className={FIELD_INPUT} rows={3} maxLength={1500} disabled={off} value={form.extra_instructions || ''} onChange={(e) => set('extra_instructions')(e.target.value)} placeholder="e.g. Ask about Salesforce integrations; keep a friendly tone." />
        </div>
      </div>

      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-tertiary-900">After the result</h3>
        <div className="mt-3">
          <Switch checked={form.auto_reject} onChange={set('auto_reject')} disabled={off} label="Reject automatically on a below-pass result" hint="Off by default. When on, a below-pass result moves the candidate to Rejected with the AI's reason, but only while they are still in sourcing or screening (before any client has seen them). A borderline or pass result never rejects, and an admin can reactivate a rejected candidate." />
        </div>
      </div>

      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-tertiary-900">Aptitude section</h3>
        <div className="mt-3 space-y-3">
          <Switch checked={form.aptitude_enabled} onChange={set('aptitude_enabled')} label="Add an aptitude section" hint="The AI writes a few logic, number and pattern questions with their expected answers and marks the candidate's answers against them." />
          {form.aptitude_enabled && (
            <div className="max-w-xs"><NumberField field={{ label: 'Aptitude questions', hint: '2 to 15; 12 by default', min: 2, max: 15 }} value={form.aptitude_question_count} onChange={set('aptitude_question_count')} disabled={off} /></div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-tertiary-900">Marking scheme (marks out of 100)</h3>
        <p className="text-xs text-tertiary-500">Like an exam paper, every section carries marks. Each section is scored 0 to 10 and earns that share of its marks; the total out of 100 is compared with the pass mark. {form.aptitude_enabled ? '' : 'Aptitude is switched off, so its marks are left out and the rest are scaled to 100.'}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {weights.map((w) => <NumberField key={w.key} field={{ label: `${w.label} (marks)`, min: 0, max: 100 }} value={form[w.key]} onChange={set(w.key)} disabled={off} />)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span className={`rounded-full px-2.5 py-1 font-semibold ${total === 100 ? 'bg-success-100 text-success-800' : 'bg-warning-100 text-warning-800'}`} data-testid="marks-total">Total: {total} / 100</span>
          {total > 0 && total !== 100 && <button type="button" className="text-primary-700 underline" disabled={off} onClick={scaleTo100}>Scale to 100</button>}
          {total <= 0 && <span className="text-danger-700">At least one section needs marks.</span>}
        </div>
      </div>

      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-tertiary-900">Questions at the candidate&apos;s level</h3>
        <p className="text-xs text-tertiary-500">Questions are pitched at the candidate&apos;s own experience: fresher (under 1 year), junior (1 to 3), mid-level (3 to 6), senior (6 to 10) and lead (10 or more). The same level is used when the answers are scored.</p>
        <div className="mt-3 space-y-3">
          <Switch checked={form.use_reference_sites} onChange={set('use_reference_sites')} label="Check reference sites while writing questions" hint="The interviewer reads only the sites below (through the AI web search) to get syntax and definitions right. It writes its own questions and never copies from them. If the web search is not available the interview works exactly the same without it." />
          {form.use_reference_sites && (
            <div className="max-w-xl">
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Reference sites (domain names, up to 5)</label>
              <input className={FIELD_INPUT} value={form.reference_sites || ''} disabled={off} maxLength={300} placeholder="w3schools.com, javatpoint.com" onChange={(e) => set('reference_sites')(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-tertiary-900">Recording (audio + video)</h3>
        <div className="mt-3 space-y-3">
          <Switch checked={form.recording_enabled} onChange={set('recording_enabled')} label="Record the interview (mandatory for the candidate)" hint="Off by default. When on, every candidate must allow the camera and microphone and agree to the recording before the interview starts, and the interview pauses if the camera is turned off. Recordings are deleted automatically after the days below; the transcript and scores stay." />
          {form.recording_enabled && (
            <div className="max-w-xs"><NumberField field={{ label: 'Keep recordings for (days)', hint: '1 to 7; 2 by default', min: 1, max: 7 }} value={form.recording_retention_days} onChange={set('recording_retention_days')} disabled={off} /></div>
          )}
          <div>
            <p className="text-sm font-medium text-tertiary-900">Who can watch every recording</p>
            <p className="mt-0.5 text-xs text-tertiary-500">Admins always can. Anyone you add here can also open all candidates&apos; recordings; everyone else sees only the recordings of interviews they sent themselves.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(form.recording_viewer_ids || []).map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs text-primary-700">
                  {people.find((u) => u.id === id)?.name || 'Team member'}
                  {isAdmin && <button type="button" aria-label="Remove" className="hover:text-danger-600" onClick={() => set('recording_viewer_ids')((form.recording_viewer_ids || []).filter((x) => x !== id))}>&times;</button>}
                </span>
              ))}
              {!(form.recording_viewer_ids || []).length && <span className="text-xs text-tertiary-400">Nobody added.</span>}
            </div>
            {isAdmin && (
              <select className={`${FIELD_INPUT} mt-2 max-w-xs`} value="" onChange={(e) => e.target.value && set('recording_viewer_ids')([...(form.recording_viewer_ids || []), e.target.value])}>
                <option value="">Add a person...</option>
                {people.filter((u) => !(form.recording_viewer_ids || []).includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      {isAdmin ? (
        <button type="button" className="btn-primary" disabled={busy || total <= 0} onClick={save}>{busy ? 'Saving...' : 'Save settings'}</button>
      ) : <p className="text-xs text-tertiary-500">Only an admin can change these settings.</p>}
    </div>
  );
}
