import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

const CATEGORY_LABEL = { behavioural: 'Behavioural', reasoning: 'Reasoning', aptitude: 'Aptitude', mind: 'Mind' };

/** The candidate's test page: opened from the emailed link, no login. Answers are scored on the server. */
export default function AssessmentTakePage() {
  const { token } = useParams();
  const [test, setTest] = useState(null);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(null);
  const submitRef = useRef(null);

  useEffect(() => {
    apiClient.get(`/public/assessments/${token}`)
      .then(({ data }) => {
        setTest(data.data);
        if (data.data.duration_minutes) setLeft(data.data.duration_minutes * 60);
      })
      .catch((err) => setError(apiErrorMessage(err, 'This link is not valid.')));
  }, [token]);

  async function submit() {
    setBusy(true);
    try {
      await apiClient.post(`/public/assessments/${token}/submit`, { answers });
      setDone(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not submit your answers.'));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { submitRef.current = submit; });

  // Count down when the test has a time limit and submit what is answered when it runs out.
  useEffect(() => {
    if (left == null || done || error) return undefined;
    if (left <= 0) { submitRef.current(); return undefined; }
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, done, error]);

  const shell = (children) => (
    <div className="min-h-screen bg-tertiary-50 px-4 py-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-tertiary-100 bg-white p-6 shadow-card">{children}</div>
    </div>
  );

  if (done) return shell(<><h1 className="font-heading text-lg font-semibold">Thank you</h1><p className="mt-2 text-sm text-tertiary-600">Your answers have been submitted. The team will get in touch with you.</p></>);
  if (error) return shell(<p className="text-sm text-danger-700">{error}</p>);
  if (!test) return shell(<p className="text-sm text-tertiary-500">Loading...</p>);

  const answered = Object.keys(answers).length;
  return shell(
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="font-heading text-lg font-semibold text-tertiary-900">{test.name}</h1>
          <p className="text-sm text-tertiary-600">Hello {test.candidate_name}. {test.description}</p>
        </div>
        {left != null && <span className="rounded-lg bg-warning-50 px-3 py-1 text-sm font-medium text-warning-800">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}
      </div>
      <ol className="mt-5 space-y-5">
        {test.questions.map((q, qi) => (
          <li key={q.id}>
            <p className="text-sm font-medium text-tertiary-900">{qi + 1}. {q.text} <span className="ml-1 text-xs font-normal text-tertiary-400">{CATEGORY_LABEL[q.category]}</span></p>
            <div className="mt-2 space-y-1.5">
              {q.options.map((opt, oi) => (
                <label key={oi} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${answers[q.id] === oi ? 'border-primary-500 bg-primary-50' : 'border-tertiary-200'}`}>
                  <input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))} />
                  {opt}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex items-center justify-between">
        <span className="text-xs text-tertiary-500">{answered} of {test.questions.length} answered</span>
        <button type="button" className="btn-primary" disabled={busy || answered === 0} onClick={submit}>Submit answers</button>
      </div>
    </>
  );
}
