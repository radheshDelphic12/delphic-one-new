import { useCallback, useEffect, useState } from 'react';
import { Copy, Download, Eye, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import { isAdminUser } from '../../lib/access.js';

const STATUS_LABEL = { not_opened: 'Not opened', in_progress: 'In progress', scored: 'Scored', pending_review: 'Needs a person to review', expired: 'Expired', superseded: 'Replaced' };
const STATUS_TONE = {
  not_opened: 'bg-tertiary-100 text-tertiary-700',
  in_progress: 'bg-sky-100 text-sky-800',
  scored: 'bg-success-100 text-success-800',
  pending_review: 'bg-warning-100 text-warning-800',
  expired: 'bg-warning-100 text-warning-800',
  superseded: 'bg-tertiary-50 text-tertiary-400 line-through',
};
const OUTCOME_LABEL = { pass: 'Pass', borderline: 'Borderline', below_pass: 'Below pass', pending_review: 'Needs review' };
const OUTCOME_TONE = {
  pass: 'bg-success-100 text-success-800',
  borderline: 'bg-warning-100 text-warning-800',
  below_pass: 'bg-danger-100 text-danger-700',
  pending_review: 'bg-warning-100 text-warning-800',
};
const SECTION_LABEL = { role: 'Role', aptitude: 'Aptitude' };
const when = (value) => (value ? new Date(value).toLocaleString() : '-');

/**
 * Optional AI interview for the candidate's first round: a separate link next to the interview plan. It renders nothing until
 * an admin switches the feature on (Hiring setup > AI interview), and it never blocks or changes any interview round.
 */
export default function AiInterviewCard({ submissionId, submission, user }) {
  const { pushError, pushSuccess } = useAlerts();
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState({ items: [], live_id: null });
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [override, setOverride] = useState({ outcome: 'pass', reason: '' });
  const [video, setVideo] = useState({ url: null, error: '' });
  const locked = !!submission?.is_locked;
  const isAdmin = isAdminUser(user);

  const load = useCallback(() =>
    apiClient.get('/ai-interviews', { params: { submission_id: submissionId } }).then(({ data }) => setState(data.data)).catch(() => setState({ items: [], live_id: null })), [submissionId]);

  useEffect(() => {
    apiClient.get('/ai-interviews/settings').then(({ data }) => setEnabled(!!data.data.is_enabled)).catch(() => setEnabled(false));
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  useEffect(() => () => { if (video.url) URL.revokeObjectURL(video.url); }, [video.url]);

  if (!enabled) return null;
  const live = state.items.find((i) => i.id === state.live_id) || null;

  async function run(fn, errorMessage) {
    setBusy(true);
    try { await fn(); } catch (err) { pushError(apiErrorMessage(err, errorMessage), 'Something went wrong'); } finally { setBusy(false); }
  }
  const copy = (link) => navigator.clipboard?.writeText(link).then(() => pushSuccess('Link copied. Send it to the candidate.', 'Copied')).catch(() => pushError('Could not copy the link', 'Something went wrong'));

  const send = () => run(async () => {
    const { data } = await apiClient.post('/ai-interviews', { submission_id: submissionId });
    await load();
    copy(data.data.link);
  }, 'Could not create the AI interview link');

  async function openReview(item) {
    setVideo({ url: null, error: '' });
    await run(async () => {
      const { data } = await apiClient.get(`/ai-interviews/${item.id}/review`);
      setReview(data.data);
      setOverride({ outcome: data.data.effective_outcome === 'pending_review' ? 'pass' : data.data.effective_outcome || 'pass', reason: '' });
    }, 'Could not open the result');
  }

  async function loadVideo() {
    try {
      const res = await apiClient.get(`/ai-interviews/${review.id}/recording`, { responseType: 'blob' });
      setVideo({ url: URL.createObjectURL(res.data), error: '' });
    } catch (err) {
      setVideo({ url: null, error: apiErrorMessage(err, 'The recording is not available') });
    }
  }

  async function downloadVideo() {
    try {
      const res = await apiClient.get(`/ai-interviews/${review.id}/recording`, { params: { download: 'true' }, responseType: 'blob' });
      const href = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = href;
      a.download = `ai-interview-${review.candidate_name.replace(/[^a-z0-9]+/gi, '-')}.webm`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not download the recording'), 'Something went wrong');
    }
  }

  const saveOverride = () => run(async () => {
    await apiClient.post(`/ai-interviews/${review.id}/override`, override);
    pushSuccess('Your decision was saved. The AI result is kept for the record.', 'Saved');
    await load();
    await openReview(review);
  }, 'Could not save your decision');

  const remove = (item) => {
    const reason = window.prompt('Why delete this AI interview? (the candidate can then be sent a new one)');
    if (reason === null) return;
    run(async () => { await apiClient.delete(`/ai-interviews/${item.id}`, { data: { reason: reason.trim() || undefined } }); await load(); }, 'Could not delete the AI interview');
  };

  const canSend = !locked && (!live || ['not_opened', 'expired'].includes(live.view_status));
  return (
    <section className="rounded-2xl border border-violet-100 bg-violet-50/30 p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-heading text-sm font-semibold text-violet-900">AI interview (optional, first round)</h2>
          <p className="mt-0.5 text-xs text-violet-700/80">A separate link the candidate can take before any human round. It does not change the interview plan; you decide what to do with the result.</p>
        </div>
        {canSend && <button type="button" className="btn-primary text-xs" disabled={busy} onClick={send}>{live ? 'Send a new link' : 'Send AI interview link'}</button>}
      </div>

      {state.items.length === 0 && <p className="mt-3 text-sm text-tertiary-500">No AI interview sent yet.</p>}
      <ul className="mt-3 space-y-2">
        {state.items.map((i) => (
          <li key={i.id} className="rounded-xl border border-tertiary-100 bg-white px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[i.view_status] || STATUS_TONE.not_opened}`}>{STATUS_LABEL[i.view_status] || i.view_status}</span>
                {i.effective_outcome && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${OUTCOME_TONE[i.effective_outcome]}`}>{OUTCOME_LABEL[i.effective_outcome]}{i.override_outcome ? ' (decided by a person)' : ''}</span>}
                {i.score_percent != null && <span className="text-xs text-tertiary-700">AI score <strong>{i.score_percent}%</strong> (pass mark {i.pass_percentage}%)</span>}
                <span className="text-xs text-tertiary-400">Sent {when(i.invited_at)}{i.created_by_name ? ` by ${i.created_by_name}` : ''}</span>
              </div>
              <div className="flex items-center gap-1">
                {i.link && i.is_live && <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-tertiary-200 px-2 py-1 text-xs text-tertiary-700 hover:bg-tertiary-50" onClick={() => copy(i.link)}><Copy className="h-3.5 w-3.5" /> Copy link</button>}
                {['scored', 'pending_review'].includes(i.view_status) && <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-tertiary-200 px-2 py-1 text-xs text-tertiary-700 hover:bg-tertiary-50" onClick={() => openReview(i)}><Eye className="h-3.5 w-3.5" /> View result</button>}
                {isAdmin && <button type="button" aria-label="Delete AI interview" className="rounded p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></button>}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Drawer open={!!review} onClose={() => setReview(null)} size="xl" tone="info" title={review ? `AI interview: ${review.candidate_name}` : ''}
        footer={<div className="flex justify-end"><button type="button" className="btn-secondary" onClick={() => setReview(null)}>Close</button></div>}>
        {review && (
          <div className="space-y-5 text-sm">
            <div className="rounded-xl border border-tertiary-100 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {review.score_percent != null ? <span className="text-2xl font-semibold text-tertiary-900">{review.score_percent}%</span> : <span className="text-tertiary-600">No AI score</span>}
                <span className="text-xs text-tertiary-500">pass mark {review.pass_percentage}%</span>
                {review.outcome && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${OUTCOME_TONE[review.outcome]}`}>AI: {OUTCOME_LABEL[review.outcome]}</span>}
                {review.override_outcome && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${OUTCOME_TONE[review.override_outcome]}`}>Decided: {OUTCOME_LABEL[review.override_outcome]}</span>}
              </div>
              {review.scores?.decision_reason && <p className="mt-2 rounded-lg bg-tertiary-50 px-3 py-2 text-tertiary-800"><strong>Why:</strong> {review.scores.decision_reason}</p>}
              {!review.scores && <p className="mt-2 text-warning-800">The AI could not score this interview. Every answer is saved below; please read it and record your decision.</p>}
              {review.scores?.summary && <p className="mt-2 text-tertiary-700">{review.scores.summary}</p>}
            </div>

            {review.scores?.parameters?.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Score breakdown</h3>
                <div className="space-y-2">
                  {review.scores.parameters.map((p) => (
                    <div key={p.key} className="rounded-lg border border-tertiary-100 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-tertiary-900">{p.label} <span className="text-xs font-normal text-tertiary-400">weight {p.weight}</span></span>
                        <span className="font-semibold">{p.score}/10</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-tertiary-100"><div className={`h-full ${p.score >= 6 ? 'bg-success-500' : p.score >= 4 ? 'bg-warning-500' : 'bg-danger-500'}`} style={{ width: `${p.score * 10}%` }} /></div>
                      {p.summary && <p className="mt-1 text-xs text-tertiary-700">{p.summary}</p>}
                      {p.evidence && <p className="text-xs italic text-tertiary-500">&ldquo;{p.evidence}&rdquo;</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(review.scores?.strengths?.length > 0 || review.scores?.red_flags?.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {review.scores.strengths?.length > 0 && <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-success-700">Strengths</h3><ul className="list-disc pl-5 text-tertiary-700">{review.scores.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
                {review.scores.red_flags?.length > 0 && <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-danger-700">Red flags</h3><ul className="list-disc pl-5 text-tertiary-700">{review.scores.red_flags.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
              </div>
            )}

            {(review.has_recording || review.recording_deleted) && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Recording</h3>
                {review.recording_deleted && <p className="text-xs text-tertiary-500">The recording was deleted automatically after its retention period. The transcript and scores are kept.</p>}
                {review.has_recording && (
                  <>
                    <p className="mb-2 text-xs text-tertiary-500">Available until {when(review.recording_expires_at)}, then deleted automatically.</p>
                    {video.url ? <video src={video.url} controls className="w-full rounded-lg bg-black" /> : <button type="button" className="btn-secondary text-xs" onClick={loadVideo}>Load recording</button>}
                    {video.error && <p className="mt-1 text-xs text-danger-700">{video.error}</p>}
                    <button type="button" className="ml-2 inline-flex items-center gap-1 text-xs text-primary-700 hover:underline" onClick={downloadVideo}><Download className="h-3.5 w-3.5" /> Download</button>
                  </>
                )}
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Your decision</h3>
              {review.override_outcome && <p className="mb-2 text-xs text-tertiary-600">Decided as <strong>{OUTCOME_LABEL[review.override_outcome]}</strong> by {review.override_by_name || 'a team member'} on {when(review.override_at)}: {review.override_reason}</p>}
              {!locked && (
                <div className="space-y-2">
                  <select className="w-full rounded-lg border border-tertiary-200 px-3 py-2" value={override.outcome} onChange={(e) => setOverride((o) => ({ ...o, outcome: e.target.value }))}>
                    <option value="pass">Pass</option><option value="borderline">Borderline</option><option value="below_pass">Below pass</option>
                  </select>
                  <textarea className="w-full rounded-lg border border-tertiary-200 px-3 py-2" rows={2} placeholder="Reason (required, recorded in the audit log)" value={override.reason} onChange={(e) => setOverride((o) => ({ ...o, reason: e.target.value }))} />
                  <button type="button" className="btn-primary text-xs" disabled={busy || override.reason.trim().length < 3} onClick={saveOverride}>Save decision</button>
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Transcript</h3>
              <div className="space-y-2">
                {(review.transcript || []).map((t, i) => (
                  <div key={i} className={t.role === 'ai' ? 'text-tertiary-700' : 'ml-6 rounded-lg bg-primary-50 px-3 py-2 text-tertiary-900'}>
                    {t.role === 'ai'
                      ? <span><span className="font-medium">{t.kind === 'follow_up' ? 'Follow-up' : `Q${t.question_index}`}{t.section ? ` (${SECTION_LABEL[t.section] || t.section})` : ''}:</span> {t.text}</span>
                      : t.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </section>
  );
}
