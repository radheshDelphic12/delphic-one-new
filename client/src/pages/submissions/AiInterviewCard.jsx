import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, Eye, RotateCcw, Send, Trash2 } from 'lucide-react';
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
// The marks sheet of a result: per section the score out of 10, the share of the paper, the marks obtained and the maximum marks.
function marksSheet(parameters = []) {
  const weightSum = parameters.reduce((sum, p) => sum + (Number(p.weight) || 0), 0) || 1;
  const rows = parameters.map((p) => {
    const max = p.max_points != null ? p.max_points : Math.round(((Number(p.weight) || 0) / weightSum) * 10000) / 100;
    const got = p.points != null ? p.points : Math.round(((p.score / 10) * max) * 100) / 100;
    return { key: p.key, label: p.label, score: p.score, max, got, scored: p.scored !== false };
  });
  const round = (n) => Math.round(n * 100) / 100;
  return { rows, got: round(rows.reduce((a, r) => a + r.got, 0)), max: round(rows.reduce((a, r) => a + r.max, 0)) };
}
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
  const [notes, setNotes] = useState([]); // team feedback on the opened result
  const [myNote, setMyNote] = useState('');
  const [video, setVideo] = useState({ url: null, error: '' });
  const retried = useRef(false); // the player may ask for a fresh link once when an old one has run out
  const locked = !!submission?.is_locked;
  const isAdmin = isAdminUser(user);

  const load = useCallback(() =>
    apiClient.get('/ai-interviews', { params: { submission_id: submissionId } }).then(({ data }) => setState(data.data)).catch(() => setState({ items: [], live_id: null })), [submissionId]);

  useEffect(() => {
    apiClient.get('/ai-interviews/settings').then(({ data }) => setEnabled(!!data.data.is_enabled)).catch(() => setEnabled(false));
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return null;
  const live = state.items.find((i) => i.id === state.live_id) || null;

  async function run(fn, errorMessage) {
    setBusy(true);
    try { await fn(); } catch (err) { pushError(apiErrorMessage(err, errorMessage), 'Something went wrong'); } finally { setBusy(false); }
  }
  // The clipboard is not always available (an insecure page, a blocked permission): then the link is shown instead of failing, because it exists either way.
  const writeClipboard = async (link) => { try { await navigator.clipboard.writeText(link); return true; } catch { return false; } };
  const copy = async (link) => {
    if (await writeClipboard(link)) pushSuccess('Link copied. Send it to the candidate.', 'Copied');
    else pushSuccess(`Link ready (copy it from here or use Copy link): ${link}`, 'Link created');
  };

  const send = () => run(async () => {
    const { data } = await apiClient.post('/ai-interviews', { submission_id: submissionId });
    await load();
    copy(data.data.link);
  }, 'Could not create the AI interview link');

  // The same link again (email + copy); an expired link gets a new validity period. The candidate carries on where they stopped.
  const resend = () => run(async () => {
    const { data } = await apiClient.post(`/ai-interviews/${live.id}/resend`);
    await load();
    pushSuccess(data.data.emailed ? 'The link was sent to the candidate again and copied for you.' : 'This candidate has no email on file. The link was copied: send it yourself.', 'Link sent again');
    writeClipboard(data.data.link);
  }, 'Could not send the link again');

  // A candidate in the middle of the interview keeps it; a new link starts it again from the first question.
  const restart = () => {
    if (!window.confirm('The candidate has already started. A new link starts the interview again from the first question and the current link stops working. Continue?')) return;
    run(async () => {
      const { data } = await apiClient.post('/ai-interviews', { submission_id: submissionId, restart: true });
      await load();
      copy(data.data.link);
    }, 'Could not create the new AI interview link');
  };

  // A finished interview can be sent again (a re-take). The first result stays in the list as "Replaced"; nothing is deleted.
  const retake = () => {
    if (!window.confirm('This candidate has already finished the AI interview. A new link lets them take it again. The first result stays in the history as "Replaced". Send a new link?')) return;
    run(async () => {
      const { data } = await apiClient.post('/ai-interviews', { submission_id: submissionId, retake: true });
      await load();
      copy(data.data.link);
    }, 'Could not create the new AI interview link');
  };

  async function openReview(item) {
    setVideo({ url: null, error: '' });
    await run(async () => {
      const { data } = await apiClient.get(`/ai-interviews/${item.id}/review`);
      setReview(data.data);
      setOverride({ outcome: data.data.effective_outcome === 'pending_review' ? 'pass' : data.data.effective_outcome || 'pass', reason: '' });
      await loadNotes(item.id);
    }, 'Could not open the result');
  }

  async function loadNotes(id) {
    try {
      const { data } = await apiClient.get(`/ai-interviews/${id}/feedback`);
      setNotes(data.data || []);
      setMyNote((data.data || []).find((n) => n.mine)?.feedback || '');
    } catch { setNotes([]); setMyNote(''); }
  }
  const saveNote = () => run(async () => {
    await apiClient.put(`/ai-interviews/${review.id}/feedback`, { feedback: myNote.trim() });
    await loadNotes(review.id);
  }, 'Could not save the feedback');
  const removeNote = () => run(async () => {
    await apiClient.delete(`/ai-interviews/${review.id}/feedback`);
    await loadNotes(review.id);
  }, 'Could not remove the feedback');

  // A candidate who closed the tab and came back has more than one part; each is its own file.
  // A blob request returns its error body as a Blob too, so read the server's message out of it.
  async function recordingError(err, fallback) {
    const body = err?.response?.data;
    // when the server gave no message (a proxy error page, a dropped connection) say which: it is the clue to what failed
    const why = err?.response?.status ? `HTTP ${err.response.status}` : (err?.code || 'no response from the server');
    if (body instanceof Blob) {
      try { return JSON.parse(await body.text())?.message || `${fallback} (${why})`; } catch { return `${fallback} (${why})`; }
    }
    return apiErrorMessage(err, `${fallback} (${why})`);
  }

  async function loadVideo(part = 0) {
    try {
      // a link the <video> streams itself: playback starts at once, the file is not downloaded whole first
      const { url } = (await apiClient.get(`/ai-interviews/${review.id}/recording-link`, { params: { part } })).data.data;
      setVideo({ url, part, error: '' });
    } catch (err) {
      setVideo({ url: null, part, error: await recordingError(err, 'The recording is not available') });
    }
  }

  // A link runs out after 20 minutes: when the player fails on an old one, ask for a fresh link once.
  async function loadVideoAgain(part) {
    if (retried.current) { setVideo((v) => ({ ...v, url: null, error: 'The recording could not be played. Try again, or use the download button' })); return; }
    retried.current = true;
    await loadVideo(part);
  }

  async function downloadVideo(part = 0) {
    try {
      const { url } = (await apiClient.get(`/ai-interviews/${review.id}/recording-link`, { params: { part, download: 'true' } })).data.data;
      const a = document.createElement('a');
      a.href = url; // the browser downloads it directly (the link carries a Content-Disposition, or Microsoft's own download link)
      a.download = `ai-interview-${review.candidate_name.replace(/[^a-z0-9]+/gi, '-')}${review.recording_parts.length > 1 ? `-part${part + 1}` : ''}.webm`;
      a.click();
    } catch (err) {
      pushError(await recordingError(err, 'Could not download the recording'), 'Something went wrong');
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

  // false = this requirement has the AI interview turned off (the company setting is on, but this role opted out)
  const switchedOff = state.requirement_switch === false;
  const setSwitch = (enabled) => run(async () => {
    await apiClient.put(`/ai-interviews/requirements/${state.requirement_id}/switch`, { enabled });
    pushSuccess(enabled ? 'The AI interview follows the company setting again for this requirement.' : 'The AI interview is turned off for this requirement.', 'Saved');
    await load();
  }, 'Could not change the setting for this requirement');

  const canSend = !locked && !switchedOff && (!live || ['not_opened', 'expired'].includes(live.view_status));
  const canRetake = !locked && !switchedOff && live && ['scored', 'pending_review'].includes(live.view_status);
  const canResend = !locked && !switchedOff && live && ['not_opened', 'in_progress', 'expired'].includes(live.view_status);
  return (
    <section className="rounded-2xl border border-violet-100 bg-violet-50/30 p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-heading text-sm font-semibold text-violet-900">AI interview (optional, first round)</h2>
          <p className="mt-0.5 text-xs text-violet-700/80">A separate link the candidate can take before any human round. It does not change the interview plan; you decide what to do with the result.</p>
        </div>
        <div className="flex items-center gap-2">
          {state.requirement_id && !locked && (
            <button type="button" className="text-xs text-violet-700 hover:underline" disabled={busy} onClick={() => setSwitch(switchedOff ? true : false)}>
              {switchedOff ? 'Turn on for this requirement' : 'Turn off for this requirement'}
            </button>
          )}
          {canResend && <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs" disabled={busy} onClick={resend}><Send className="h-3.5 w-3.5" />Resend link</button>}
          {canResend && live.view_status === 'in_progress' && <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs" disabled={busy} onClick={restart}><RotateCcw className="h-3.5 w-3.5" />Restart with a new link</button>}
          {canRetake && <button type="button" className="btn-primary inline-flex items-center gap-1 text-xs" data-testid="ai-retake" disabled={busy} onClick={retake}><RotateCcw className="h-3.5 w-3.5" />Send again (re-take)</button>}
          {canSend && <button type="button" className="btn-primary text-xs" disabled={busy} onClick={send}>{live ? 'Send a new link' : 'Send AI interview link'}</button>}
        </div>
      </div>
      {switchedOff && <p className="mt-2 rounded-lg bg-tertiary-50 px-3 py-2 text-xs text-tertiary-600">The AI interview is turned off for this requirement, so no new link can be sent. Existing results stay visible.</p>}

      {state.items.length === 0 && <p className="mt-3 text-sm text-tertiary-500">No AI interview sent yet.</p>}
      <ul className="mt-3 space-y-2">
        {state.items.map((i) => (
          <li key={i.id} className="rounded-xl border border-tertiary-100 bg-white px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[i.view_status] || STATUS_TONE.not_opened}`}>{STATUS_LABEL[i.view_status] || i.view_status}</span>
                {i.effective_outcome && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${OUTCOME_TONE[i.effective_outcome]}`}>{OUTCOME_LABEL[i.effective_outcome]}{i.override_outcome ? ' (decided by a person)' : ''}</span>}
                {i.integrity?.total > 0 && <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-800" title="Logged by the interview page">{[i.integrity.tab_switches ? `left the page ${i.integrity.tab_switches}x` : '', i.integrity.copy_paste ? `copy/paste blocked ${i.integrity.copy_paste}x` : '', i.integrity.camera_off ? `camera off ${i.integrity.camera_off}x` : ''].filter(Boolean).join(' · ')}</span>}
                {i.score_percent != null && <span className="text-xs text-tertiary-700">AI score <strong>{i.score_percent}%</strong> (pass mark {i.pass_percentage}%)</span>}
                <span className="text-xs text-tertiary-400">Sent {when(i.invited_at)}{i.created_by_name ? ` by ${i.created_by_name}` : ''}</span>
              </div>
              {i.auto_reject_note && <p className={`basis-full text-xs ${i.auto_rejected_at ? 'font-medium text-danger-700' : 'text-tertiary-500'}`}>{i.auto_reject_note}</p>}
              <div className="flex items-center gap-1">
                {i.link && i.is_live && <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-tertiary-200 px-2 py-1 text-xs text-tertiary-700 hover:bg-tertiary-50" onClick={() => copy(i.link)}><Copy className="h-3.5 w-3.5" /> Copy link</button>}
                {(['scored', 'pending_review'].includes(i.view_status) || (i.view_status === 'superseded' && ['completed', 'pending_review'].includes(i.status))) && <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-tertiary-200 px-2 py-1 text-xs text-tertiary-700 hover:bg-tertiary-50" onClick={() => openReview(i)}><Eye className="h-3.5 w-3.5" /> View result</button>}
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
                {review.scores?.level && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800" title="The questions and the scoring were pitched at this level">Level: {review.scores.level.label}{review.scores.level.years != null ? ` (${review.scores.level.years} yrs)` : ''}</span>}
                {review.override_outcome && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${OUTCOME_TONE[review.override_outcome]}`}>Decided: {OUTCOME_LABEL[review.override_outcome]}</span>}
              </div>
              {review.scores?.decision_reason && <p className="mt-2 rounded-lg bg-tertiary-50 px-3 py-2 text-tertiary-800"><strong>Why:</strong> {review.scores.decision_reason}</p>}
              {!review.scores && <p className="mt-2 text-warning-800">The AI could not score this interview. Every answer is saved below; please read it and record your decision.</p>}
              {review.scores?.summary && <p className="mt-2 text-tertiary-700">{review.scores.summary}</p>}
            </div>

            {review.scores?.parameters?.length > 0 && (() => {
              const sheet = marksSheet(review.scores.parameters);
              return (
                <div data-testid="marks-sheet">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Marks sheet</h3>
                  <div className="overflow-x-auto rounded-xl border border-tertiary-100">
                    <table className="min-w-full text-sm">
                      <thead className="bg-tertiary-50 text-left text-xs uppercase tracking-wide text-tertiary-500">
                        <tr><th className="px-3 py-2">Section</th><th className="px-3 py-2 text-right">Score</th><th className="px-3 py-2 text-right">Maximum marks</th><th className="px-3 py-2 text-right">Marks obtained</th></tr>
                      </thead>
                      <tbody>
                        {sheet.rows.map((r) => (
                          <tr key={r.key} className="border-t border-tertiary-100">
                            <td className="px-3 py-2 font-medium text-tertiary-900">{r.label}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.scored ? `${r.score} / 10` : 'Not scored'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.scored ? r.max : '-'}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.scored ? r.got : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-tertiary-200 bg-tertiary-50 font-semibold">
                          <td className="px-3 py-2" colSpan={2}>Total</td>
                          <td className="px-3 py-2 text-right tabular-nums">{sheet.max}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{sheet.got}</td>
                        </tr>
                        <tr className="bg-tertiary-50/60 text-xs text-tertiary-600">
                          <td className="px-3 py-2" colSpan={4}>Pass mark {review.pass_percentage} out of 100 &middot; {review.outcome ? OUTCOME_LABEL[review.outcome] : 'Not scored'}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })()}

            {review.scores?.parameters?.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Section-wise remarks</h3>
                <div className="space-y-2">
                  {review.scores.parameters.map((p) => (
                    <div key={p.key} className="rounded-lg border border-tertiary-100 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-tertiary-900">{p.label} <span className="text-xs font-normal text-tertiary-400">weight {p.weight}</span></span>
                        <span className="font-semibold">{p.score}/10{p.points != null && <span className="ml-2 text-xs font-normal text-tertiary-500">{p.points} of {p.max_points} points</span>}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-tertiary-100"><div className={`h-full ${p.score >= 6 ? 'bg-success-500' : p.score >= 4 ? 'bg-warning-500' : 'bg-danger-500'}`} style={{ width: `${p.score * 10}%` }} /></div>
                      {p.summary && <p className="mt-1 text-xs text-tertiary-700">{p.summary}</p>}
                      {p.evidence && <p className="text-xs italic text-tertiary-500">&ldquo;{p.evidence}&rdquo;</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {review.scores?.communication_detail?.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">How communication was judged</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {review.scores.communication_detail.map((d) => (
                    <div key={d.key} className="rounded-lg border border-tertiary-100 px-3 py-2">
                      <div className="flex items-center justify-between"><span className="font-medium capitalize text-tertiary-900">{d.key}</span><span className="font-semibold">{d.score}/10</span></div>
                      {d.note && <p className="mt-0.5 text-xs text-tertiary-600">{d.note}</p>}
                    </div>
                  ))}
                </div>
                {review.scores.answer_facts && <p className="mt-2 text-xs text-tertiary-500">Counted from the answers: {review.scores.answer_facts.answers} answers, {review.scores.answer_facts.average_words} words on average, {review.scores.answer_facts.very_short} very short, {review.scores.answer_facts.skipped} not answered in time.</p>}
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
                    {review.recording_parts.length > 1 && <p className="mb-2 text-xs text-tertiary-600">The candidate closed the page and came back, so this interview has {review.recording_parts.length} recording parts.</p>}
                    {video.url && <video key={video.url} src={video.url} controls preload="metadata" autoPlay className="mb-2 w-full rounded-lg bg-black" onError={() => loadVideoAgain(video.part)} />}
                    {video.error && <p className="mb-2 text-xs text-danger-700">{video.error}</p>}
                    <div className="flex flex-wrap gap-2">
                      {review.recording_parts.map((p, idx) => (
                        <span key={idx} className="inline-flex items-center gap-2 rounded-lg border border-tertiary-200 px-2 py-1 text-xs">
                          <button type="button" className={video.url && video.part === idx ? 'font-semibold text-primary-700' : 'text-tertiary-800 hover:underline'} onClick={() => loadVideo(idx)}>
                            {review.recording_parts.length > 1 ? `Play part ${idx + 1}` : 'Play recording'} ({Math.max(1, Math.round(p.bytes / 1048576))} MB)
                          </button>
                          <button type="button" aria-label={`Download part ${idx + 1}`} className="text-primary-700 hover:underline" onClick={() => downloadVideo(idx)}><Download className="h-3.5 w-3.5" /></button>
                        </span>
                      ))}
                    </div>
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

            <div data-testid="ai-feedback">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Feedback on this interview</h3>
              {notes.length === 0 && <p className="mb-2 text-xs text-tertiary-500">No feedback yet.</p>}
              <ul className="mb-2 space-y-1.5">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg bg-tertiary-50 px-3 py-2 text-tertiary-800" data-testid="ai-feedback-note">
                    <p className="whitespace-pre-wrap">{n.feedback}</p>
                    <p className="mt-1 text-[11px] text-tertiary-500">{n.by.name} · {when(n.updated_at)}{n.mine ? ' · yours' : ''}</p>
                  </li>
                ))}
              </ul>
              {!locked && (
                <div className="space-y-2">
                  <textarea className="w-full rounded-lg border border-tertiary-200 px-3 py-2" rows={3} maxLength={3000} placeholder="Your feedback on this AI interview (what you saw in the answers, your view of the candidate)" value={myNote} onChange={(e) => setMyNote(e.target.value)} />
                  <div className="flex gap-2">
                    <button type="button" className="btn-primary text-xs" data-testid="ai-feedback-save" disabled={busy || myNote.trim().length < 3} onClick={saveNote}>{notes.some((n) => n.mine) ? 'Update my feedback' : 'Save feedback'}</button>
                    {notes.some((n) => n.mine) && <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={removeNote}>Remove mine</button>}
                  </div>
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
