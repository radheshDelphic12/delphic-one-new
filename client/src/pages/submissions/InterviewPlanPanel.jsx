import { useEffect, useMemo, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import MultiSelectDropdown from '../../components/ui/MultiSelectDropdown.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';
import { canManageInterviewRound } from '../../lib/submissionStages.js';

const STATE_STYLE = {
  not_scheduled: 'border-tertiary-200 bg-white text-tertiary-700',
  scheduled: 'border-sky-200 bg-sky-50 text-sky-800',
  completed: 'border-success-200 bg-success-50 text-success-800',
};
const STATE_LABEL = { not_scheduled: 'Not scheduled', scheduled: 'Scheduled', completed: 'Completed' };

const emptySkill = () => ({ skill_name: '', rating: 5 });

/**
 * The candidate's interview plan from the requirement's interview template: rounds in order, each with its state.
 * A mandatory round needs feedback (and skill ratings out of 10 where the template asks) before the next one can start.
 * `plan` is null for requirements made before templates existed; the page then shows the older rounds panel instead.
 */
export default function InterviewPlanPanel({ submissionId, submission, plan, rounds, user, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [schedule, setSchedule] = useState(null); // { step, form }
  const [finish, setFinish] = useState(null); // { step, round, form }
  const [users, setUsers] = useState([]);
  const [tests, setTests] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [busy, setBusy] = useState(false);

  const locked = !!submission?.is_locked;
  const roundById = useMemo(() => new Map((rounds || []).map((r) => [r.id, r])), [rounds]);

  useEffect(() => {
    apiClient.get('/users/directory', { params: { active: 'true' } }).then(({ data }) => setUsers(data.data || [])).catch(() => setUsers([]));
    apiClient.get('/assessments/tests').then(({ data }) => setTests(data.data || [])).catch(() => setTests([]));
  }, []);
  const loadAttempts = () =>
    apiClient.get('/assessments/attempts', { params: { submission_id: submissionId } }).then(({ data }) => setAttempts(data.data || [])).catch(() => setAttempts([]));
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
    setSchedule({ step, form: { scheduled_at: '', duration_minutes: '60', interviewer_ids: [], interviewer_name: '', meeting_link: '' } });
  }

  async function saveSchedule() {
    const { step, form } = schedule;
    if (!form.scheduled_at) return pushError('Choose the interview date & time.', 'Please fix the form');
    await run(async () => {
      await apiClient.post(`/submissions/${submissionId}/interview-rounds`, {
        template_round_id: step.template_round_id,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : undefined,
        meeting_link: form.meeting_link.trim() || undefined,
        ...(step.conducted_by === 'client' ? { interviewer_name: form.interviewer_name.trim() || undefined } : { interviewer_ids: form.interviewer_ids }),
      });
      setSchedule(null);
    }, 'Failed to schedule the round');
  }

  function openFinish(step) {
    const round = roundById.get(step.interview_round_id);
    setFinish({
      step,
      round,
      form: {
        result: round?.result && round.result !== 'pending' ? round.result : 'pass',
        feedback: round?.feedback || '',
        skills: round?.skill_ratings?.length ? round.skill_ratings.map((s) => ({ skill_name: s.skill_name, rating: s.rating })) : [emptySkill()],
      },
    });
  }

  const draftScore = useMemo(() => {
    if (!finish) return null;
    const rated = finish.form.skills.filter((s) => s.skill_name.trim());
    if (!rated.length) return null;
    return Math.round((rated.reduce((sum, s) => sum + Number(s.rating), 0) / (rated.length * 10)) * 10000) / 100;
  }, [finish]);

  async function saveFinish() {
    const { step, round, form } = finish;
    const skills = form.skills.filter((s) => s.skill_name.trim()).map((s) => ({ skill_name: s.skill_name.trim(), rating: Number(s.rating) }));
    if (!form.feedback.trim()) return pushError('Feedback is required to finish a round.', 'Please fix the form');
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

  async function sendTest(step, testId) {
    if (!testId) return;
    await run(async () => {
      const { data } = await apiClient.post('/assessments/attempts', { test_id: testId, submission_id: submissionId });
      await loadAttempts();
      pushSuccess(data.data.link ? `Test link ready: ${data.data.link}` : 'Test sent', 'Test sent');
    }, 'Failed to send the test');
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
          const stepAttempts = step.kind === 'screening_test' ? attempts : [];
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
                    <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => openFinish(step)}>
                      {step.state === 'completed' ? 'Edit feedback' : 'Give feedback'}
                    </button>
                  )}
                </div>
              </div>

              {step.kind === 'screening_test' && (
                <div className="mt-2 border-t border-current/10 pt-2 text-xs">
                  {stepAttempts.map((a) => (
                    <p key={a.id} className="text-tertiary-700">
                      Test: <strong>{a.test_name}</strong> -{' '}
                      {a.status === 'submitted'
                        ? <>score <strong>{a.score_percent}%</strong> ({a.passed ? 'passed' : 'below'} {a.pass_percentage}%)</>
                        : <>sent, {a.status === 'started' ? 'in progress' : 'not opened yet'}{a.link ? <> · <button type="button" className="underline" onClick={() => navigator.clipboard?.writeText(a.link)}>copy link</button></> : null}</>}
                    </p>
                  ))}
                  {!locked && tests.length > 0 && (
                    <select className={`${FIELD_INPUT} mt-1 max-w-xs`} value="" disabled={busy} onChange={(e) => sendTest(step, e.target.value)}>
                      <option value="">{stepAttempts.length ? 'Send another test...' : 'Send a test to the candidate...'}</option>
                      {tests.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.question_count} questions, pass {t.pass_percentage}%)</option>)}
                    </select>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <Drawer open={!!schedule} onClose={() => setSchedule(null)} title={schedule ? `Schedule: ${schedule.step.name}` : ''} tone="create"
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setSchedule(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={saveSchedule}>Schedule</button></div>}>
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
              <textarea rows={4} className={FIELD_INPUT} value={finish.form.feedback} onChange={(e) => setFinish((p) => ({ ...p, form: { ...p.form, feedback: e.target.value } }))} />
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
              <div className="mt-2 space-y-2">
                {finish.form.skills.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input className={FIELD_INPUT} placeholder="Skill (e.g. React, Communication)" value={s.skill_name} onChange={(e) => updateSkill(i, { skill_name: e.target.value })} />
                    <input type="range" min={1} max={10} value={s.rating} onChange={(e) => updateSkill(i, { rating: Number(e.target.value) })} className="w-32" />
                    <span className="w-10 text-right text-sm font-medium">{s.rating}/10</span>
                    <button type="button" className="text-xs text-danger-600" onClick={() => setFinish((p) => ({ ...p, form: { ...p.form, skills: p.form.skills.filter((_, idx) => idx !== i) } }))}>Remove</button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => setFinish((p) => ({ ...p, form: { ...p.form, skills: [...p.form.skills, emptySkill()] } }))}>+ Add skill</button>
            </div>
          </div>
        )}
      </Drawer>
    </section>
  );
}
