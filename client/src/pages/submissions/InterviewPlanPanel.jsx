import { useEffect, useMemo, useState } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import MultiSelectDropdown from '../../components/ui/MultiSelectDropdown.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';
import { canManageInterviewRound } from '../../lib/submissionStages.js';
import { isAdminUser } from '../../lib/access.js';
import { SKILLS_CATALOG } from '../../lib/skillsCatalog.js';

const STATE_STYLE = {
  not_scheduled: 'border-tertiary-200 bg-white text-tertiary-700',
  scheduled: 'border-sky-200 bg-sky-50 text-sky-800',
  completed: 'border-success-200 bg-success-50 text-success-800',
};
const STATE_LABEL = { not_scheduled: 'Not scheduled', scheduled: 'Scheduled', completed: 'Completed' };
const ATTEMPT_LABEL = { not_opened: 'Not opened', in_progress: 'In progress', scored: 'Scored', expired: 'Expired', superseded: 'Replaced' };
const ATTEMPT_TONE = {
  not_opened: 'bg-tertiary-100 text-tertiary-700',
  in_progress: 'bg-sky-100 text-sky-800',
  scored: 'bg-success-100 text-success-800',
  expired: 'bg-warning-100 text-warning-800',
  superseded: 'bg-tertiary-50 text-tertiary-400 line-through',
};
const RESULT_LABEL = { correct: 'Right', partial: 'Partly right', wrong: 'Wrong', not_answered: 'Not answered' };
const RESULT_TONE = {
  correct: 'bg-success-100 text-success-800',
  partial: 'bg-warning-100 text-warning-800',
  wrong: 'bg-danger-100 text-danger-700',
  not_answered: 'bg-tertiary-100 text-tertiary-600',
};
const NO_ATTEMPTS = { items: [], live_id: null, used: 0, limit: 0, remaining: null };

// rating: null = not rated yet (every row left in the form has to be rated before saving)
const emptySkill = () => ({ skill_name: '', rating: null });
const when = (value) => (value ? new Date(value).toLocaleString() : '-');

/**
 * The candidate's interview plan from the requirement's interview template: rounds in order, each with its state.
 * A mandatory round needs feedback (and skill ratings, 0 to 10, where the template asks) before the next one can start.
 * Rounds that need skill ratings open pre-filled with the requirement JD's primary and secondary stack.
 * `plan` is null for requirements made before templates existed; the page then shows the older rounds panel instead.
 */
export default function InterviewPlanPanel({ submissionId, submission, plan, rounds, user, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [schedule, setSchedule] = useState(null); // { step, form }
  const [finish, setFinish] = useState(null); // { step, round, form }
  const [users, setUsers] = useState([]);
  const [tests, setTests] = useState([]);
  const [attemptState, setAttemptState] = useState(NO_ATTEMPTS);
  const [skillOptions, setSkillOptions] = useState([]);
  const [removing, setRemoving] = useState(null); // { attempt, reason }
  const [reviewing, setReviewing] = useState(null); // the attempt's answers, marked right / wrong
  const [busy, setBusy] = useState(false);

  const locked = !!submission?.is_locked;
  const isAdmin = isAdminUser(user);
  const attempts = attemptState.items;
  const roundById = useMemo(() => new Map((rounds || []).map((r) => [r.id, r])), [rounds]);

  useEffect(() => {
    apiClient.get('/users/directory', { params: { active: 'true' } }).then(({ data }) => setUsers(data.data || [])).catch(() => setUsers([]));
    apiClient.get('/assessments/tests').then(({ data }) => setTests(data.data || [])).catch(() => setTests([]));
  }, []);
  const loadAttempts = () =>
    apiClient.get('/assessments/attempts', { params: { submission_id: submissionId } }).then(({ data }) => setAttemptState(data.data || NO_ATTEMPTS)).catch(() => setAttemptState(NO_ATTEMPTS));
  useEffect(() => { loadAttempts(); }, [submissionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const roundType = (step) => (step.conducted_by === 'client' ? 'template_client' : 'template_internal');
  const canManage = (step) => !locked && canManageInterviewRound(submission, roundType(step), user);

  async function run(fn, errorMessage) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, errorMessage), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function openSchedule(step) {
    setSchedule({ step, round: null, form: { scheduled_at: '', duration_minutes: '60', interviewer_ids: [], interviewer_name: '', meeting_link: '' } });
  }

  // Change the date / interviewers / link of a round that is already scheduled.
  function openEditSchedule(step) {
    const round = roundById.get(step.interview_round_id);
    if (!round) return;
    const d = round.scheduled_at ? new Date(round.scheduled_at) : null;
    const pad = (n) => String(n).padStart(2, '0');
    const local = d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
    setSchedule({
      step,
      round,
      form: {
        scheduled_at: local,
        duration_minutes: round.duration_minutes != null ? String(round.duration_minutes) : '',
        interviewer_ids: (round.interviewers || []).map((i) => i.id),
        interviewer_name: round.interviewer_name || '',
        meeting_link: round.meeting_link || '',
      },
    });
  }

  async function saveSchedule() {
    const { step, round, form } = schedule;
    if (!form.scheduled_at) return pushError('Choose the interview date & time.', 'Please fix the form');
    await run(async () => {
      const body = {
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : undefined,
        meeting_link: form.meeting_link.trim() || undefined,
        ...(step.conducted_by === 'client' ? { interviewer_name: form.interviewer_name.trim() || undefined } : { interviewer_ids: form.interviewer_ids }),
      };
      if (round) await apiClient.patch(`/interview-rounds/${round.id}`, body);
      else await apiClient.post(`/submissions/${submissionId}/interview-rounds`, { template_round_id: step.template_round_id, ...body });
      setSchedule(null);
    }, round ? 'Failed to update the interview' : 'Failed to schedule the round');
  }

  // Skill names the dropdown offers: the JD stacks, everything interviewers rated before, candidate skills and the catalog.
  function loadSkillOptions() {
    apiClient.get('/interview-templates/skill-options').then(({ data }) => setSkillOptions(data.data || [])).catch(() => setSkillOptions([]));
  }
  const allSkillOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    const add = (name) => {
      const clean = String(name || '').trim();
      if (clean && !seen.has(clean.toLowerCase())) { seen.add(clean.toLowerCase()); out.push(clean); }
    };
    [...(plan?.jd_skills?.primary || []), ...(plan?.jd_skills?.secondary || [])].forEach(add);
    skillOptions.forEach(add);
    SKILLS_CATALOG.forEach((s) => add(s.label));
    return out;
  }, [plan, skillOptions]);

  function openFinish(step) {
    const round = roundById.get(step.interview_round_id);
    const saved = round?.skill_ratings?.length ? round.skill_ratings.map((s) => ({ skill_name: s.skill_name, rating: s.rating })) : null;
    // Rounds that need ratings start from the JD's stacks (primary, then secondary); an empty stack leaves just "+ Add skill".
    const fromJd = step.rating_required ? [...(plan?.jd_skills?.primary || []), ...(plan?.jd_skills?.secondary || [])].map((skill_name) => ({ skill_name, rating: null })) : [];
    loadSkillOptions();
    // a screening round whose test is already scored starts from that result (an editable draft), so the form is not blank
    const scored = step.kind === 'screening_test' ? attempts.find((a) => a.is_live && a.template_round_id === step.template_round_id && a.view_status === 'scored') : null;
    const fromTest = scored ? `${scored.test_name || 'Screening test'}: scored ${scored.score_percent}% (pass mark ${scored.pass_percentage}%) - ${scored.passed ? 'passed' : 'not passed'}.` : '';
    setFinish({
      step,
      round,
      form: {
        result: round?.result && round.result !== 'pending' ? round.result : 'pass',
        feedback: round?.feedback || fromTest,
        skills: saved || (fromJd.length ? fromJd : [emptySkill()]),
      },
    });
  }

  const draftScore = useMemo(() => {
    if (!finish) return null;
    const rated = finish.form.skills.filter((s) => s.skill_name.trim() && s.rating != null);
    if (!rated.length) return null;
    return Math.round((rated.reduce((sum, s) => sum + Number(s.rating), 0) / (rated.length * 10)) * 10000) / 100;
  }, [finish]);

  async function saveFinish() {
    const { step, round, form } = finish;
    // a row nobody touched (no name, no rating) is dropped; every other row needs a name and a rating
    const rows = form.skills.filter((s) => s.skill_name.trim() || s.rating != null);
    if (!form.feedback.trim()) {
      setFinish((p) => ({ ...p, feedbackMissing: true }));
      document.getElementById('finish-feedback')?.focus();
      return pushError('Write the feedback for this round in the Feedback box, then save.', 'Feedback is required');
    }
    if (rows.some((s) => !s.skill_name.trim())) return pushError('Give every rated row a skill name, or remove the row.', 'Please fix the form');
    if (rows.some((s) => s.rating == null)) return pushError('Rate every skill (0 to 10), or remove the skills that do not apply.', 'Please fix the form');
    const skills = rows.map((s) => ({ skill_name: s.skill_name.trim(), rating: Number(s.rating) }));
    if (step.rating_required && !skills.length) return pushError('Add at least one skill and rate it out of 10.', 'Please fix the form');
    await run(async () => {
      await apiClient.patch(`/interview-rounds/${round.id}`, {
        result: form.result,
        feedback: form.feedback.trim(),
        ...(skills.length ? { skill_ratings: skills } : {}),
      });
      setFinish(null);
    }, 'Failed to save the feedback');
  }

  // ---- test links
  async function sendTest(testId, overrideLimit = false) {
    if (!testId) return;
    setBusy(true);
    try {
      const { data } = await apiClient.post('/assessments/attempts', { test_id: testId, submission_id: submissionId, ...(overrideLimit ? { override_limit: true } : {}) });
      await loadAttempts();
      const replaced = data.data.superseded ? ' The earlier unopened link was replaced.' : '';
      pushSuccess(data.data.link ? `Test link ready: ${data.data.link}.${replaced}` : `Test sent.${replaced}`, 'Test sent');
    } catch (err) {
      const message = apiErrorMessage(err, 'Failed to send the test');
      if (err.response?.status === 409 && /allowed tests/i.test(message) && isAdmin && !overrideLimit) {
        // an admin may go past the limit on purpose
        if (window.confirm(`${message}.\n\nSend one anyway?`)) { setBusy(false); return sendTest(testId, true); }
      } else {
        pushError(message, 'Something went wrong');
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeAttempt() {
    const { attempt, reason } = removing;
    await run(async () => {
      await apiClient.delete(`/assessments/attempts/${attempt.id}`, { data: { reason: reason.trim() || undefined } });
      setRemoving(null);
      await loadAttempts();
      pushSuccess(attempt.view_status === 'scored' ? 'Result deleted. The candidate can retake the test.' : 'Test link deleted.', 'Deleted');
    }, 'Failed to delete the test');
  }

  async function openReview(attempt) {
    setBusy(true);
    try {
      const { data } = await apiClient.get(`/assessments/attempts/${attempt.id}/review`);
      setReviewing(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not open the answers'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function extendAttempt(attempt) {
    await run(async () => {
      await apiClient.post(`/assessments/attempts/${attempt.id}/extend`, {});
      await loadAttempts();
      pushSuccess('The link is valid for another 7 days.', 'Link extended');
    }, 'Failed to extend the link');
  }

  async function messageCandidate() {
    await run(async () => {
      await apiClient.post(`/submissions/${submissionId}/candidate-feedback-message`, {});
      pushSuccess('The candidate has been told their feedback is on the way.', 'Message queued');
    }, 'Failed to message the candidate');
  }

  const updateSkill = (index, patch) =>
    setFinish((prev) => ({ ...prev, form: { ...prev.form, skills: prev.form.skills.map((s, i) => (i === index ? { ...s, ...patch } : s)) } }));

  if (!plan) return null;

  const userOptions = users.map((u) => ({ id: u.id, label: u.name, hint: u.role }));
  const anyBelowPass = plan.steps.some((s) => s.below_pass);
  const liveAttempt = attempts.find((a) => a.id === attemptState.live_id) || null;
  const limitText = attemptState.limit > 0 ? `${attemptState.used} of ${attemptState.limit} tests used` : `${attemptState.used} test${attemptState.used === 1 ? '' : 's'} sent (no limit)`;

  return (
    <section id="interview-plan" className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-sm font-semibold text-sky-900">Interview plan - {plan.template.name}</h2>
          <p className="mt-0.5 text-xs text-sky-700/80">
            Finish each mandatory round with feedback to open the next. Minimum pass: {plan.pass_percentage}%.
            {plan.mandatory_pending > 0 ? ` ${plan.mandatory_pending} mandatory round${plan.mandatory_pending > 1 ? 's' : ''} left.` : ' All mandatory rounds are done.'}
          </p>
        </div>
        {anyBelowPass && !locked && (
          <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={messageCandidate}>
            Tell candidate feedback is coming
          </button>
        )}
      </div>

      <ol className="mt-3 space-y-2">
        {plan.steps.map((step) => {
          const round = roundById.get(step.interview_round_id);
          const isTestStep = step.kind === 'screening_test';
          return (
            <li key={step.template_round_id} className={`rounded-xl border px-3 py-3 ${STATE_STYLE[step.state]}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-tertiary-900">
                    {step.sort_order}. {step.name}{' '}
                    <span className="ml-1 rounded-full border border-current px-2 py-0.5 text-[11px] font-normal">{STATE_LABEL[step.state]}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-tertiary-600">
                    {step.conducted_by === 'client' ? 'Client' : 'Delphic'} · {step.is_mandatory ? 'Mandatory' : 'Optional'}
                    {step.rating_required ? ' · Skill ratings required' : ''}
                    {round?.scheduled_at ? ` · ${new Date(round.scheduled_at).toLocaleString()}` : ''}
                  </p>
                  {step.state === 'completed' && (
                    <p className="mt-1 text-xs text-tertiary-700">
                      Result: <strong className="capitalize">{step.result}</strong>
                      {step.score_percent != null && (
                        <>
                          {' '}· Score <strong>{step.score_percent}%</strong>
                          {step.below_pass && <span className="ml-1 rounded bg-danger-50 px-1.5 py-0.5 font-medium text-danger-700">Below {plan.pass_percentage}% pass mark - manager decides</span>}
                        </>
                      )}
                    </p>
                  )}
                  {round?.skill_ratings?.length > 0 && (
                    <p className="mt-1 text-xs text-tertiary-600">{round.skill_ratings.map((s) => `${s.skill_name} ${s.rating}/10`).join(' · ')}</p>
                  )}
                  {round?.feedback && <p className="mt-1 text-xs text-tertiary-600">Feedback: {round.feedback}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {step.state === 'not_scheduled' && canManage(step) && (
                    <button type="button" className="btn-primary text-xs" disabled={!step.can_start || busy} onClick={() => openSchedule(step)} title={step.can_start ? '' : 'Finish the previous mandatory round first'}>
                      Schedule
                    </button>
                  )}
                  {step.state !== 'not_scheduled' && canManage(step) && (
                    <button type="button" title="Edit interview" aria-label="Edit interview" className="rounded p-1.5 text-tertiary-500 hover:bg-primary-50 disabled:opacity-50" disabled={busy} onClick={() => openEditSchedule(step)}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {step.state !== 'not_scheduled' && canManage(step) && (
                    <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => openFinish(step)}>
                      {step.state === 'completed' ? 'Edit feedback' : 'Give feedback'}
                    </button>
                  )}
                </div>
              </div>

              {isTestStep && (
                <div className="mt-2 space-y-2 border-t border-current/10 pt-2 text-xs" data-testid="test-attempts">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-tertiary-800">
                      Tests · {limitText}
                      {liveAttempt ? <span className="ml-2 rounded-full bg-success-100 px-2 py-0.5 text-[11px] font-medium text-success-800">1 live</span> : <span className="ml-2 rounded-full bg-tertiary-100 px-2 py-0.5 text-[11px] text-tertiary-600">No live link</span>}
                    </p>
                  </div>
                  {attempts.length === 0 && <p className="text-tertiary-500">No test sent yet.</p>}
                  <ul className="space-y-1">
                    {attempts.map((a) => (
                      <li key={a.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-2 py-1.5 ${a.is_live ? 'border-success-200' : 'border-tertiary-100 opacity-80'}`} data-testid="test-attempt">
                        <div className="min-w-0">
                          <p className="text-tertiary-800">
                            <strong>{a.test_name}</strong>{' '}
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ATTEMPT_TONE[a.view_status]}`}>{ATTEMPT_LABEL[a.view_status]}</span>
                            {a.is_live && <span className="ml-1 rounded-full bg-success-100 px-2 py-0.5 text-[11px] font-medium text-success-800">Live</span>}
                            {a.view_status === 'scored' && <span className="ml-2">{a.score_percent}% · <span className={a.passed ? 'text-success-700' : 'text-danger-700'}>{a.passed ? 'Passed' : 'Failed'}</span> (pass {a.pass_percentage}%)</span>}
                          </p>
                          <p className="text-[11px] text-tertiary-500">
                            Sent {when(a.invited_at)}{a.created_by_name ? ` by ${a.created_by_name}` : ''}
                            {a.view_status === 'scored' ? ` · submitted ${when(a.submitted_at)}` : a.is_live ? ` · valid until ${when(a.expires_at)}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {a.link && a.is_live && <button type="button" className="underline" onClick={() => navigator.clipboard?.writeText(a.link).then(() => pushSuccess('Link copied', 'Copied'))}>copy link</button>}
                          {a.status === 'submitted' && (
                            <button type="button" className="inline-flex items-center gap-1 underline" disabled={busy} onClick={() => openReview(a)}>
                              <Eye className="h-3.5 w-3.5" aria-hidden />view answers
                            </button>
                          )}
                          {isAdmin && !locked && a.is_live && a.view_status !== 'scored' && (
                            <button type="button" className="underline" disabled={busy} onClick={() => extendAttempt(a)}>extend 7 days</button>
                          )}
                          {isAdmin && !locked && (
                            <button type="button" title={a.view_status === 'scored' ? 'Delete result (lets the candidate retake)' : 'Delete this link'} aria-label="Delete test attempt" className="rounded p-1 text-danger-600 hover:bg-danger-50" disabled={busy} onClick={() => setRemoving({ attempt: a, reason: '' })}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {!locked && tests.length > 0 && (
                    <select className={`${FIELD_INPUT} mt-1 max-w-xs`} value="" disabled={busy} onChange={(e) => sendTest(e.target.value)}>
                      <option value="">{liveAttempt ? (liveAttempt.view_status === 'scored' ? 'Retake: delete the result first' : 'Replace the unopened link...') : 'Send a test to the candidate...'}</option>
                      {tests.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.question_count} questions, pass {t.pass_percentage}%)</option>)}
                    </select>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <Drawer open={!!schedule} onClose={() => setSchedule(null)} title={schedule ? `${schedule.round ? 'Edit interview' : 'Schedule'}: ${schedule.step.name}` : ''} tone={schedule?.round ? 'edit' : 'create'}
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setSchedule(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={saveSchedule}>{schedule?.round ? 'Save changes' : 'Schedule'}</button></div>}>
        {schedule && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Date & time *</label>
              <input type="datetime-local" className={FIELD_INPUT} value={schedule.form.scheduled_at} onChange={(e) => setSchedule((p) => ({ ...p, form: { ...p.form, scheduled_at: e.target.value } }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Duration (minutes)</label>
              <input type="number" min={5} className={FIELD_INPUT} value={schedule.form.duration_minutes} onChange={(e) => setSchedule((p) => ({ ...p, form: { ...p.form, duration_minutes: e.target.value } }))} />
            </div>
            {schedule.step.conducted_by === 'client' ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-tertiary-600">Client interviewer</label>
                <input className={FIELD_INPUT} value={schedule.form.interviewer_name} onChange={(e) => setSchedule((p) => ({ ...p, form: { ...p.form, interviewer_name: e.target.value } }))} />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium text-tertiary-600">Interviewers</label>
                <MultiSelectDropdown options={userOptions} value={schedule.form.interviewer_ids} onChange={(ids) => setSchedule((p) => ({ ...p, form: { ...p.form, interviewer_ids: ids } }))} placeholder="Select interviewers" />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Meeting link</label>
              <input className={FIELD_INPUT} value={schedule.form.meeting_link} onChange={(e) => setSchedule((p) => ({ ...p, form: { ...p.form, meeting_link: e.target.value } }))} />
            </div>
          </div>
        )}
      </Drawer>

      <Drawer open={!!finish} onClose={() => setFinish(null)} title={finish ? `Feedback: ${finish.step.name}` : ''} tone="edit" size="lg"
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setFinish(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={saveFinish}>Save feedback</button></div>}>
        {finish && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Result *</label>
              <select className={FIELD_INPUT} value={finish.form.result} onChange={(e) => setFinish((p) => ({ ...p, form: { ...p.form, result: e.target.value } }))}>
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Feedback * (required to move to the next round)</label>
              <textarea id="finish-feedback" rows={4} className={`${FIELD_INPUT} ${finish.feedbackMissing ? 'border-danger-500 ring-1 ring-danger-300' : ''}`} value={finish.form.feedback} onChange={(e) => setFinish((p) => ({ ...p, feedbackMissing: false, form: { ...p.form, feedback: e.target.value } }))} />
              {finish.feedbackMissing && <p className="mt-1 text-xs text-danger-700">Feedback is required before this round can be finished.</p>}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-tertiary-600">Skills & rating out of 10 {finish.step.rating_required ? '*' : '(optional)'}</label>
                {draftScore != null && (
                  <span className={`text-xs font-medium ${draftScore < plan.pass_percentage ? 'text-danger-700' : 'text-success-700'}`}>
                    Overall {draftScore}% (pass mark {plan.pass_percentage}%)
                  </span>
                )}
              </div>
              {finish.step.rating_required && (
                <p className="mt-1 text-xs text-tertiary-500">
                  {(plan.jd_skills?.primary?.length || plan.jd_skills?.secondary?.length)
                    ? 'Skills come from the requirement\'s JD. Rate each one, remove what does not apply, or add another skill.'
                    : 'This requirement\'s JD has no skills listed. Add the skills you assessed.'}
                </p>
              )}
              <datalist id="interview-skill-options">
                {allSkillOptions.map((name) => <option key={name} value={name} />)}
              </datalist>
              <div className="mt-2 space-y-2" data-testid="skill-rows">
                {finish.form.skills.map((s, i) => (
                  <div key={i} className="flex items-center gap-2" data-testid="skill-row">
                    <input className={FIELD_INPUT} list="interview-skill-options" placeholder="Pick or type a skill (e.g. React, Communication)" value={s.skill_name} onChange={(e) => updateSkill(i, { skill_name: e.target.value })} />
                    <input
                      type="range" min={0} max={10} value={s.rating ?? 0}
                      aria-label={`Rating for ${s.skill_name || 'skill'}`}
                      onChange={(e) => updateSkill(i, { rating: Number(e.target.value) })}
                      onClick={(e) => updateSkill(i, { rating: Number(e.target.value) })}
                      className={`w-32 ${s.rating == null ? 'opacity-50' : ''}`}
                    />
                    <span className={`w-14 text-right text-sm font-medium ${s.rating == null ? 'text-tertiary-400' : ''}`}>{s.rating == null ? 'not rated' : `${s.rating}/10`}</span>
                    <button type="button" className="text-xs text-danger-600" onClick={() => setFinish((p) => ({ ...p, form: { ...p.form, skills: p.form.skills.filter((_, idx) => idx !== i) } }))}>Remove</button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => setFinish((p) => ({ ...p, form: { ...p.form, skills: [...p.form.skills, emptySkill()] } }))}>+ Add skill</button>
            </div>
          </div>
        )}
      </Drawer>

      <Drawer open={!!reviewing} onClose={() => setReviewing(null)} size="lg" tone="edit" title={reviewing ? `Answers: ${reviewing.test_name}` : ''}
        footer={<div className="flex justify-end"><button type="button" className="btn-secondary" onClick={() => setReviewing(null)}>Close</button></div>}>
        {reviewing && (
          <div className="space-y-3" data-testid="answer-review">
            <p className="text-sm text-tertiary-700">
              {reviewing.candidate_name}: <strong>{reviewing.score_percent}%</strong> ({reviewing.passed ? 'passed' : 'failed'}, pass mark {reviewing.pass_percentage}%) · submitted {when(reviewing.submitted_at)}
            </p>
            <p className="text-xs text-tertiary-600">
              {reviewing.summary.correct} right · {reviewing.summary.partial} partly right · {reviewing.summary.wrong} wrong · {reviewing.summary.not_answered} not answered, out of {reviewing.summary.total}. The best option of each question is marked; only the team sees this page.
            </p>
            <ol className="space-y-3">
              {reviewing.questions.map((q) => (
                <li key={q.id} className="rounded-xl border border-tertiary-100 bg-white p-3" data-testid="review-question" data-result={q.result}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-medium text-tertiary-900">{q.number}. {q.text} <span className="text-xs font-normal capitalize text-tertiary-400">{q.category}</span></p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${RESULT_TONE[q.result]}`}>{RESULT_LABEL[q.result]} · {q.marks_got}/{q.marks_full}</span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {q.options.map((o, i) => (
                      <li key={i} className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-xs ${o.picked ? (q.result === 'correct' ? 'border-success-300 bg-success-50' : q.result === 'partial' ? 'border-warning-300 bg-warning-50' : 'border-danger-300 bg-danger-50') : o.best ? 'border-success-200 bg-success-50/50' : 'border-tertiary-100'}`}>
                        <span>{o.text}{o.picked ? ' (candidate answer)' : ''}{o.best ? ' (best answer)' : ''}</span>
                        <span className="text-tertiary-500">{o.marks} mark{o.marks === 1 ? '' : 's'}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Drawer>

      <Drawer open={!!removing} onClose={() => setRemoving(null)} title={removing?.attempt.view_status === 'scored' ? 'Delete test result' : 'Delete test link'} tone="edit"
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setRemoving(null)}>Cancel</button><button type="button" className="btn-danger" disabled={busy} onClick={removeAttempt}>Delete</button></div>}>
        {removing && (
          <div className="space-y-3 text-sm text-tertiary-700">
            <p>
              {removing.attempt.view_status === 'scored'
                ? `This removes ${removing.attempt.candidate_name}'s score of ${removing.attempt.score_percent}%. They can then be sent the test again, and it stops counting in the reports.`
                : 'The link stops working and no longer counts towards the limit or the reports.'}
            </p>
            <p className="text-xs text-tertiary-500">The deletion is recorded (who, when, and the reason below).</p>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Reason (optional)</label>
              <textarea rows={3} className={FIELD_INPUT} value={removing.reason} onChange={(e) => setRemoving((p) => ({ ...p, reason: e.target.value }))} />
            </div>
          </div>
        )}
      </Drawer>
    </section>
  );
}
