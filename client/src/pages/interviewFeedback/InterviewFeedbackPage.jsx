import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';

const dateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not scheduled');
const RESULT_LABEL = { pending: 'Result pending', pass: 'Pass', fail: 'Fail', no_show: 'No show', skipped: 'Skipped' };

const ENDED_LABEL = { closed: 'Candidate closed', backout: 'Candidate backed out', rejected: 'Candidate rejected' };

function StatusPill({ round }) {
  const done = round.has_feedback;
  // the candidate's process has ended: nothing is waited for (the outcome is recorded on the submission)
  if (!done && round.candidate_ended) return <span className="inline-block rounded-full bg-tertiary-100 px-2 py-0.5 text-xs font-medium text-tertiary-700">{ENDED_LABEL[round.submission_stage] || 'Candidate locked'} · no feedback needed</span>;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${done ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-800'}`}>{done ? `Feedback given${round.result && round.result !== 'pending' ? ` · ${RESULT_LABEL[round.result] || round.result}` : ''}` : 'Waiting for feedback'}</span>;
}

/**
 * Interview feedback. Open to everyone (basic access, on by default): a person sees the interviews they took and writes the result, the feedback and
 * the skill ratings of each. HR and admins also see every interview. The link /submissions/<id> lands here for anyone who cannot open the full candidate page.
 */
export default function InterviewFeedbackPage() {
  const { submissionId } = useParams();
  return submissionId ? <CandidateFeedback id={submissionId} /> : <FeedbackList />;
}

function Rows({ rounds, empty }) {
  const navigate = useNavigate();
  if (!rounds) return <Skeleton className="h-40" />;
  if (!rounds.length) return <EmptyState icon={ClipboardCheck} title={empty.title} description={empty.description} />;
  return (
    <div className="space-y-2" data-testid="feedback-rounds">
      {rounds.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-3" data-testid="feedback-round">
          <div className="min-w-[14rem] flex-1">
            <p className="font-medium text-tertiary-900">{r.candidate || 'Candidate'} <span className="font-normal text-tertiary-500">· {r.round_name}</span></p>
            <p className="text-xs text-tertiary-500">{r.requirement}{r.requirement ? ' · ' : ''}{dateTime(r.scheduled_at)}{r.interviewers.length ? ` · ${r.interviewers.map((i) => i.name).join(', ')}` : ''}</p>
          </div>
          <StatusPill round={r} />
          <button type="button" className="btn-primary text-xs" onClick={() => navigate(`/interview-feedback/${r.submission_id}`)}>{r.has_feedback ? 'View / edit' : 'Give feedback'}</button>
        </div>
      ))}
    </div>
  );
}

function FeedbackList() {
  const { pushError } = useAlerts();
  const [tab, setTab] = useState('mine');
  const [mine, setMine] = useState(null);
  const [all, setAll] = useState(undefined); // undefined = not loaded, null = not allowed
  const [pendingOnly, setPendingOnly] = useState(true);

  useEffect(() => {
    apiClient.get('/interview-feedback/mine').then(({ data }) => setMine(data.data || [])).catch((err) => { setMine([]); pushError(apiErrorMessage(err, 'Could not load your interviews'), 'Something went wrong'); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    apiClient.get('/interview-feedback/all', { params: pendingOnly ? { pending: 1 } : {} }).then(({ data }) => setAll(data.data.rounds || [])).catch(() => setAll(null));
  }, [pendingOnly]);

  const tabs = [{ key: 'mine', label: 'My interviews', icon: ClipboardCheck }, ...(all !== null && all !== undefined ? [{ key: 'all', label: 'All interviews', icon: ClipboardCheck }] : [])];
  const waiting = (mine || []).filter((r) => !r.has_feedback && !r.candidate_ended).length;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-semibold text-tertiary-900">Interview feedback</h1>
        <p className="mt-1 text-sm text-tertiary-500">The interviews you took: open one to give your result, feedback and skill ratings.{waiting > 0 ? ` ${waiting} waiting for your feedback.` : ''}</p>
      </div>
      {tabs.length > 1 && <SectionTabs tabs={tabs} value={tab} onChange={setTab} />}
      {tab === 'mine' && <Rows rounds={mine} empty={{ title: 'No interview is assigned to you', description: 'When someone assigns you an interview round, it appears here.' }} />}
      {tab === 'all' && (
        <>
          <label className="flex items-center gap-2 text-sm text-tertiary-700"><input type="checkbox" checked={pendingOnly} onChange={(e) => { setAll(undefined); setPendingOnly(e.target.checked); }} /> Only interviews waiting for feedback</label>
          <Rows rounds={all || undefined} empty={{ title: 'Nothing here', description: 'No interview matches.' }} />
        </>
      )}
    </div>
  );
}

const emptySkill = (name = '') => ({ skill_name: name, rating: '' });

function RoundForm({ round, suggested, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [open, setOpen] = useState(!round.has_feedback);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(() => ({
    result: ['pass', 'fail'].includes(round.result) ? round.result : 'pass',
    feedback: round.feedback || '',
    skills: round.skill_ratings.length ? round.skill_ratings.map((s) => ({ skill_name: s.skill_name, rating: String(s.rating) })) : (round.rating_required ? suggested.map((s) => emptySkill(s)) : []),
  }));
  const setSkill = (i, patch) => setForm((p) => ({ ...p, skills: p.skills.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));

  async function save() {
    const rows = form.skills.filter((s) => s.skill_name.trim() || s.rating !== '');
    if (!form.feedback.trim()) return pushError('Write your feedback for this round, then save.', 'Feedback is required');
    if (rows.some((s) => !s.skill_name.trim() || s.rating === '' || Number(s.rating) < 0 || Number(s.rating) > 10)) return pushError('Give every skill a name and a rating from 0 to 10, or remove the row.', 'Please fix the form');
    if (round.rating_required && !rows.length) return pushError('Add at least one skill and rate it out of 10.', 'Ratings are required');
    setBusy(true);
    try {
      await apiClient.patch(`/interview-rounds/${round.id}`, {
        result: form.result,
        feedback: form.feedback.trim(),
        ...(rows.length ? { skill_ratings: rows.map((s) => ({ skill_name: s.skill_name.trim(), rating: Number(s.rating) })) } : {}),
      });
      pushSuccess('Feedback saved.', 'Saved');
      setOpen(false);
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the feedback'), 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3 space-y-2">
        <p className="whitespace-pre-wrap text-sm text-tertiary-800">{round.feedback}</p>
        {round.skill_ratings.length > 0 && <p className="text-xs text-tertiary-600">{round.skill_ratings.map((s) => `${s.skill_name}: ${s.rating}/10`).join(' · ')}{round.score_percent != null ? ` · Overall ${round.score_percent}%` : ''}</p>}
        <button type="button" className="btn-secondary text-xs" onClick={() => setOpen(true)}>Edit feedback</button>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-3" data-testid="round-form">
      <div>
        <label className="mb-1 block text-xs font-medium text-tertiary-600">Result *</label>
        <select className={FIELD_INPUT} aria-label="Result" value={form.result} onChange={(e) => setForm((p) => ({ ...p, result: e.target.value }))}>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-tertiary-600">Feedback *</label>
        <textarea rows={5} className={FIELD_INPUT} aria-label="Feedback" value={form.feedback} onChange={(e) => setForm((p) => ({ ...p, feedback: e.target.value }))} placeholder="How did the candidate do? Strengths, concerns and your recommendation." />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-tertiary-600">Skills and rating out of 10 {round.rating_required ? '*' : '(optional)'}</label>
        <div className="space-y-2">
          {form.skills.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_auto] gap-2">
              <input className={FIELD_INPUT} aria-label={`Skill ${i + 1}`} placeholder="Skill" value={s.skill_name} onChange={(e) => setSkill(i, { skill_name: e.target.value })} list="feedback-skill-suggestions" />
              <input type="number" min="0" max="10" step="1" className={FIELD_INPUT} aria-label={`Rating ${i + 1}`} placeholder="0-10" value={s.rating} onChange={(e) => setSkill(i, { rating: e.target.value })} />
              <button type="button" aria-label={`Remove skill ${i + 1}`} className="rounded p-2 text-danger-600 hover:bg-danger-50" onClick={() => setForm((p) => ({ ...p, skills: p.skills.filter((_, idx) => idx !== i) }))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs" onClick={() => setForm((p) => ({ ...p, skills: [...p.skills, emptySkill()] }))}><Plus className="h-3.5 w-3.5" /> Add skill</button>
        </div>
        <datalist id="feedback-skill-suggestions">{suggested.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
      <div className="flex justify-end gap-2">
        {round.has_feedback && <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>}
        <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save feedback'}</button>
      </div>
    </div>
  );
}

function CandidateFeedback({ id }) {
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  const [denied, setDenied] = useState(false);
  const load = useCallback(() => {
    apiClient.get(`/interview-feedback/submission/${id}`).then(({ data: res }) => setData(res.data)).catch((err) => {
      if (err?.response?.status === 403 || err?.response?.status === 404) setDenied(true);
      else pushError(apiErrorMessage(err, 'Could not open this interview'), 'Something went wrong');
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  if (denied) return <EmptyState icon={ClipboardCheck} title="You are not assigned to this interview" description="Only the interviewer of a round, HR and admins can give its feedback. If this looks wrong, ask the person who sent you the link to assign you the round." action={<Link className="btn-primary" to="/interview-feedback">My interviews</Link>} />;
  if (!data) return <Skeleton className="h-64" />;
  const c = data.candidate;
  return (
    <div className="space-y-4">
      <Link to="/interview-feedback" className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline"><ArrowLeft className="h-4 w-4" /> Interview feedback</Link>
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="candidate-card">
        <h1 className="font-heading text-xl font-semibold text-tertiary-900">{c.name}</h1>
        <p className="text-sm text-tertiary-600">{[c.designation, c.company].filter(Boolean).join(' at ')}{c.experience_years != null ? ` · ${c.experience_years} years` : ''}{c.location ? ` · ${c.location}` : ''}</p>
        {data.requirement && <p className="mt-1 text-xs text-tertiary-500">Interviewing for: {data.requirement}</p>}
      </div>
      {data.rounds.length === 0 ? <EmptyState icon={ClipboardCheck} title="No interview round yet" description="The rounds of this candidate appear here once they are scheduled." /> : data.rounds.map((r) => (
        <div key={r.id} className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="candidate-round">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-heading text-base font-semibold text-tertiary-900">Round {r.round_number}: {r.round_name}</h2>
              <p className="text-xs text-tertiary-500">{dateTime(r.scheduled_at)}{r.interviewers.length ? ` · Interviewer: ${r.interviewers.map((i) => i.name).join(', ')}` : ''}</p>
            </div>
            <StatusPill round={r} />
          </div>
          <RoundForm round={r} suggested={data.suggested_skills} onSaved={load} />
        </div>
      ))}
    </div>
  );
}
