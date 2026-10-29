import { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useAuth } from '../../lib/authContext.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';

const TABS = [
  { key: 'templates', label: 'Interview templates' },
  { key: 'questions', label: 'Question bank' },
  { key: 'tests', label: 'Tests' },
  { key: 'analytics', label: 'Tests & interviews' },
];
const CATEGORIES = [
  { value: 'behavioural', label: 'Behavioural' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'aptitude', label: 'Aptitude' },
  { value: 'mind', label: 'Mind' },
];
const SERVICE_LABEL = { managed_services: 'Managed Services', recruitment: 'Recruitment', project: 'Project', internal_hiring: 'Internal Hiring' };
const TRACK_LABEL = { technical: 'Technical', non_technical: 'Non-Technical' };

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-tertiary-600">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-tertiary-500">{hint}</p>}
    </div>
  );
}

function useSave() {
  const { pushError, pushSuccess } = useAlerts();
  const [busy, setBusy] = useState(false);
  const run = async (fn, okMessage) => {
    setBusy(true);
    try {
      await fn();
      if (okMessage) pushSuccess(okMessage);
      return true;
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// ---------------------------------------------------------------- templates
function TemplatesTab({ isAdmin, tests }) {
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const { busy, run } = useSave();
  const load = useCallback(() => apiClient.get('/interview-templates', { params: { include_inactive: 'true' } }).then(({ data }) => setRows(data.data || [])), []);
  useEffect(() => { load(); }, [load]);

  const open = (t) => setEdit({
    id: t.id, name: t.name, pass_percentage: t.pass_percentage, is_active: t.is_active,
    service_types: t.service_types, hiring_track: t.hiring_track, description: t.description,
    rounds: t.rounds.map((r) => ({ ...r })),
  });
  const patchRound = (i, p) => setEdit((e) => ({ ...e, rounds: e.rounds.map((r, idx) => (idx === i ? { ...r, ...p } : r)) }));
  const moveRound = (i, d) => setEdit((e) => {
    const rounds = [...e.rounds];
    const j = i + d;
    if (j < 0 || j >= rounds.length) return e;
    [rounds[i], rounds[j]] = [rounds[j], rounds[i]];
    return { ...e, rounds };
  });

  async function save() {
    const ok = await run(() => apiClient.patch(`/interview-templates/${edit.id}`, {
      name: edit.name,
      pass_percentage: Number(edit.pass_percentage),
      is_active: edit.is_active,
      rounds: edit.rounds.map((r) => ({
        id: r.id, name: r.name, conducted_by: r.conducted_by, kind: r.kind, is_mandatory: r.is_mandatory,
        rating_required: r.rating_required, assessment_test_id: r.kind === 'screening_test' ? r.assessment_test_id || null : null,
      })),
    }), 'Template saved');
    if (ok) { setEdit(null); load(); }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-tertiary-600">The service type of a requirement picks its template. Rounds run in this order; a mandatory round needs feedback before the next one opens.</p>
      {rows.map((t) => (
        <div key={t.id} className="rounded-xl border border-tertiary-100 bg-white p-4 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium text-tertiary-900">{t.name} {!t.is_active && <span className="ml-1 text-xs text-tertiary-400">(inactive)</span>}</p>
              <p className="text-xs text-tertiary-500">
                {t.service_types.map((s) => SERVICE_LABEL[s]).join(', ')}{t.hiring_track ? ` - ${TRACK_LABEL[t.hiring_track]}` : ''} · Pass mark {t.pass_percentage}%
              </p>
            </div>
            {isAdmin && <button type="button" className="btn-secondary text-xs" onClick={() => open(t)}>Edit</button>}
          </div>
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-tertiary-700">
            {t.rounds.map((r) => (
              <li key={r.id}>{r.name} <span className="text-xs text-tertiary-500">({r.conducted_by === 'client' ? 'Client' : 'Delphic'}, {r.is_mandatory ? 'mandatory' : 'optional'}{r.rating_required ? ', rating required' : ''})</span></li>
            ))}
          </ol>
        </div>
      ))}

      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit ? `Edit: ${edit.name}` : ''} tone="edit" size="xl"
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={save}>Save template</button></div>}>
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><input className={FIELD_INPUT} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Minimum pass %" hint="Default for this template; a requirement can override it."><input type="number" min={1} max={100} className={FIELD_INPUT} value={edit.pass_percentage} onChange={(e) => setEdit({ ...edit, pass_percentage: e.target.value })} /></Field>
              <Field label="Active"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Use for new requirements</label></Field>
            </div>
            <div className="space-y-2">
              {edit.rounds.map((r, i) => (
                <div key={r.id || i} className="rounded-lg border border-tertiary-100 p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-sm text-tertiary-500">{i + 1}.</span>
                    <input className={FIELD_INPUT} value={r.name} onChange={(e) => patchRound(i, { name: e.target.value })} />
                    <button type="button" className="btn-ghost text-xs" onClick={() => moveRound(i, -1)}>Up</button>
                    <button type="button" className="btn-ghost text-xs" onClick={() => moveRound(i, 1)}>Down</button>
                    <button type="button" className="text-xs text-danger-600" onClick={() => setEdit({ ...edit, rounds: edit.rounds.filter((_, idx) => idx !== i) })}>Remove</button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-tertiary-700">
                    <select className={`${FIELD_INPUT} !w-auto`} value={r.conducted_by} onChange={(e) => patchRound(i, { conducted_by: e.target.value })}><option value="delphic">Delphic</option><option value="client">Client</option></select>
                    <select className={`${FIELD_INPUT} !w-auto`} value={r.kind} onChange={(e) => patchRound(i, { kind: e.target.value })}><option value="interview">Interview</option><option value="screening_test">Screening + test</option></select>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={r.is_mandatory} onChange={(e) => patchRound(i, { is_mandatory: e.target.checked })} /> Mandatory</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={r.rating_required} onChange={(e) => patchRound(i, { rating_required: e.target.checked })} /> Skill rating required</label>
                    {r.kind === 'screening_test' && (
                      <select className={`${FIELD_INPUT} !w-auto`} value={r.assessment_test_id || ''} onChange={(e) => patchRound(i, { assessment_test_id: e.target.value || null })}>
                        <option value="">No default test</option>
                        {tests.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" className="btn-ghost text-xs" onClick={() => setEdit({ ...edit, rounds: [...edit.rounds, { name: '', conducted_by: 'delphic', kind: 'interview', is_mandatory: true, rating_required: false }] })}>+ Add round</button>
              <p className="text-xs text-tertiary-500">A round that candidates already have interviews for cannot be removed.</p>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------- question bank
const blankQuestion = () => ({ category: 'behavioural', text: '', options: [{ text: '', marks: 0 }, { text: '', marks: 1 }] });

function QuestionsTab() {
  const [rows, setRows] = useState([]);
  const [category, setCategory] = useState('');
  const [edit, setEdit] = useState(null);
  const { busy, run } = useSave();
  const load = useCallback(() => apiClient.get('/assessments/questions', { params: category ? { category } : {} }).then(({ data }) => setRows(data.data || [])), [category]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    const body = { category: edit.category, text: edit.text, options: edit.options.filter((o) => o.text.trim()).map((o) => ({ text: o.text.trim(), marks: Number(o.marks) })) };
    const ok = await run(() => (edit.id ? apiClient.patch(`/assessments/questions/${edit.id}`, body) : apiClient.post('/assessments/questions', body)), 'Question saved');
    if (ok) { setEdit(null); load(); }
  }
  const patchOption = (i, p) => setEdit((e) => ({ ...e, options: e.options.map((o, idx) => (idx === i ? { ...o, ...p } : o)) }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select className={`${FIELD_INPUT} !w-auto`} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button type="button" className="btn-primary text-xs" onClick={() => setEdit(blankQuestion())}>+ Add question</button>
      </div>
      {rows.length === 0 && <p className="text-sm text-tertiary-500">No questions yet.</p>}
      {rows.map((q) => (
        <div key={q.id} className="rounded-xl border border-tertiary-100 bg-white p-3 shadow-soft">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-tertiary-900">{q.text}</p>
              <p className="text-xs text-tertiary-500">{CATEGORIES.find((c) => c.value === q.category)?.label} · {q.options.map((o) => `${o.text} (${o.marks})`).join(' | ')}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-xs" onClick={() => setEdit({ ...q })}>Edit</button>
              <button type="button" className="text-xs text-danger-600" onClick={() => run(() => apiClient.patch(`/assessments/questions/${q.id}`, { is_active: false }), 'Question removed').then(load)}>Remove</button>
            </div>
          </div>
        </div>
      ))}
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit question' : 'New question'} tone={edit?.id ? 'edit' : 'create'} size="lg"
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={save}>Save</button></div>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Category"><select className={FIELD_INPUT} value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
            <Field label="Question *"><textarea rows={3} className={FIELD_INPUT} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /></Field>
            <Field label="Options and marks *" hint="Marks per option. The best option is the question's full marks (right/wrong: 1 and 0; behavioural: graded, e.g. 0 / 2 / 4).">
              <div className="space-y-2">
                {edit.options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input className={FIELD_INPUT} placeholder={`Option ${i + 1}`} value={o.text} onChange={(e) => patchOption(i, { text: e.target.value })} />
                    <input type="number" min={0} className={`${FIELD_INPUT} !w-20`} value={o.marks} onChange={(e) => patchOption(i, { marks: e.target.value })} />
                    {edit.options.length > 2 && <button type="button" className="text-xs text-danger-600" onClick={() => setEdit({ ...edit, options: edit.options.filter((_, idx) => idx !== i) })}>x</button>}
                  </div>
                ))}
                {edit.options.length < 8 && <button type="button" className="btn-ghost text-xs" onClick={() => setEdit({ ...edit, options: [...edit.options, { text: '', marks: 0 }] })}>+ Add option</button>}
              </div>
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------- tests
function TestsTab({ onChanged, isAdmin }) {
  const [rows, setRows] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [edit, setEdit] = useState(null);
  const { busy, run } = useSave();
  const load = useCallback(() => apiClient.get('/assessments/tests', { params: { include_inactive: 'true' } }).then(({ data }) => setRows(data.data || [])), []);
  useEffect(() => { load(); apiClient.get('/assessments/questions').then(({ data }) => setQuestions(data.data || [])); }, [load]);

  async function open(t) {
    if (!t) return setEdit({ name: '', description: '', pass_percentage: 60, duration_minutes: '', questions_per_candidate: '', question_ids: [] });
    const { data } = await apiClient.get(`/assessments/tests/${t.id}`);
    setEdit({ id: t.id, name: t.name, description: t.description || '', pass_percentage: t.pass_percentage, duration_minutes: t.duration_minutes || '', questions_per_candidate: t.questions_per_candidate || '', question_ids: data.data.questions.map((q) => q.id) });
  }
  async function save() {
    const body = {
      name: edit.name, description: edit.description || null, pass_percentage: Number(edit.pass_percentage),
      duration_minutes: edit.duration_minutes === '' ? null : Number(edit.duration_minutes),
      questions_per_candidate: edit.questions_per_candidate === '' ? null : Number(edit.questions_per_candidate), question_ids: edit.question_ids,
    };
    const ok = await run(() => (edit.id ? apiClient.patch(`/assessments/tests/${edit.id}`, body) : apiClient.post('/assessments/tests', body)), 'Test saved');
    if (ok) { setEdit(null); load(); onChanged(); }
  }
  const toggle = (id) => setEdit((e) => ({ ...e, question_ids: e.question_ids.includes(id) ? e.question_ids.filter((x) => x !== id) : [...e.question_ids, id] }));

  return (
    <div className="space-y-3">
      <AttemptLimitSetting isAdmin={isAdmin} />
      <div className="flex items-center justify-between">
        <p className="text-sm text-tertiary-600">A test is a set of questions with a minimum pass %. The candidate takes it from a link; it is scored automatically.</p>
        <button type="button" className="btn-primary text-xs" onClick={() => open(null)}>+ New test</button>
      </div>
      {rows.map((t) => (
        <div key={t.id} className="flex items-center justify-between rounded-xl border border-tertiary-100 bg-white p-3 shadow-soft">
          <div>
            <p className="text-sm font-medium text-tertiary-900">{t.name} {!t.is_active && <span className="text-xs text-tertiary-400">(inactive)</span>}</p>
            <p className="text-xs text-tertiary-500">{t.questions_per_candidate ? `${t.questions_per_candidate} random of ${t.question_count} questions` : `${t.question_count} questions`} · pass {t.pass_percentage}%{t.duration_minutes ? ` · ${t.duration_minutes} min` : ''}</p>
          </div>
          <button type="button" className="btn-secondary text-xs" onClick={() => open(t)}>Edit</button>
        </div>
      ))}
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit test' : 'New test'} tone={edit?.id ? 'edit' : 'create'} size="lg"
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={save}>Save</button></div>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Name *"><input className={FIELD_INPUT} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Instructions"><textarea rows={2} className={FIELD_INPUT} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Minimum pass %"><input type="number" min={1} max={100} className={FIELD_INPUT} value={edit.pass_percentage} onChange={(e) => setEdit({ ...edit, pass_percentage: e.target.value })} /></Field>
              <Field label="Time limit (minutes)" hint="Empty = no limit"><input type="number" min={1} className={FIELD_INPUT} value={edit.duration_minutes} onChange={(e) => setEdit({ ...edit, duration_minutes: e.target.value })} /></Field>
            </div>
            <Field label="Questions per candidate" hint={`Empty = every selected question, in order. Set a number to give each candidate that many questions, picked at random from the ${edit.question_ids.length} selected and shuffled.`}>
              <input type="number" min={1} max={Math.max(1, edit.question_ids.length)} className={FIELD_INPUT} value={edit.questions_per_candidate} onChange={(e) => setEdit({ ...edit, questions_per_candidate: e.target.value })} />
            </Field>
            <Field label={`Question pool (${edit.question_ids.length} selected)`}>
              <div className="max-h-72 space-y-1 overflow-auto rounded-lg border border-tertiary-100 p-2">
                {questions.map((q) => (
                  <label key={q.id} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={edit.question_ids.includes(q.id)} onChange={() => toggle(q.id)} />
                    <span>{q.text} <span className="text-xs text-tertiary-400">{CATEGORIES.find((c) => c.value === q.category)?.label}</span></span>
                  </label>
                ))}
                {questions.length === 0 && <p className="text-xs text-tertiary-500">Add questions in the Question bank first.</p>}
              </div>
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------- tests & interviews analytics
// Counting rule: only live test attempts count (not deleted, not replaced by a newer link), so a retake replaces the deleted
// result instead of adding to it. Tests are dated by the day they were sent, interviews by their interview time.
const TEST_STATUS_LABEL = { not_opened: 'Not opened', in_progress: 'In progress', scored: 'Scored' };
const INTERVIEW_STATUS_LABEL = { scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' };
const PAGE_SIZE = 25;
const shortDate = (v) => (v ? new Date(v).toLocaleDateString() : '-');

function Tile({ label, value, hint, tone = '' }) {
  return (
    <div className="rounded-xl border border-tertiary-100 bg-white p-3 shadow-soft">
      <p className="text-xs text-tertiary-500">{label}</p>
      <p className={`mt-0.5 font-heading text-2xl font-semibold ${tone || 'text-tertiary-900'}`}>{value ?? '-'}</p>
      {hint && <p className="text-[11px] text-tertiary-400">{hint}</p>}
    </div>
  );
}

function AnalyticsTab() {
  const [filters, setFilters] = useState({ from: '', to: '', requirement_id: '', recruiter_id: '', account_id: '' });
  const [options, setOptions] = useState({ requirements: [], recruiters: [], clients: [] });
  const [summary, setSummary] = useState(null);
  const [kind, setKind] = useState('tests');
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState({ total: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const { pushError } = useAlerts();

  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), [filters]);
  useEffect(() => { apiClient.get('/assessments/analytics/filters').then(({ data }) => setOptions(data.data)).catch(() => {}); }, []);
  useEffect(() => {
    apiClient.get('/assessments/analytics/summary', { params }).then(({ data }) => setSummary(data.data)).catch((err) => pushError(apiErrorMessage(err, 'Could not load the numbers'), 'Something went wrong'));
    setPage(1);
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLoading(true);
    apiClient.get('/assessments/analytics/records', { params: { ...params, kind, page, limit: PAGE_SIZE } })
      .then(({ data }) => setRecords(data.data))
      .catch(() => setRecords({ total: 0, items: [] }))
      .finally(() => setLoading(false));
  }, [params, kind, page]);

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const pages = Math.max(1, Math.ceil(records.total / PAGE_SIZE));
  const t = summary?.tests;
  const iv = summary?.interviews;
  const select = (value, onChange, label, list) => (
    <select className={`${FIELD_INPUT} !w-auto`} value={value} onChange={onChange} aria-label={label}>
      <option value="">{label}</option>
      {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );

  return (
    <div className="space-y-4" data-testid="hiring-analytics">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><input type="date" className={`${FIELD_INPUT} !w-auto`} value={filters.from} onChange={set('from')} /></Field>
        <Field label="To"><input type="date" className={`${FIELD_INPUT} !w-auto`} value={filters.to} onChange={set('to')} /></Field>
        {select(filters.requirement_id, set('requirement_id'), 'All requirements', options.requirements)}
        {select(filters.recruiter_id, set('recruiter_id'), 'All recruiters', options.recruiters)}
        {select(filters.account_id, set('account_id'), 'All clients', options.clients)}
        <button type="button" className="btn-ghost text-xs" onClick={() => setFilters({ from: '', to: '', requirement_id: '', recruiter_id: '', account_id: '' })}>Clear</button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-tertiary-800">Tests</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Tile label="Sent" value={t?.sent} />
          <Tile label="Started" value={t?.started} hint={t ? `${t.not_opened} not opened` : ''} />
          <Tile label="Completed" value={t?.completed} hint={t ? `${t.in_progress} in progress` : ''} />
          <Tile label="Passed" value={t?.passed} tone="text-success-700" />
          <Tile label="Failed" value={t?.failed} tone="text-danger-700" />
          <Tile label="Pass rate" value={t?.pass_rate != null ? `${t.pass_rate}%` : '-'} />
        </div>
        <h3 className="mb-2 mt-4 text-sm font-semibold text-tertiary-800">Interviews</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Scheduled" value={iv?.scheduled} />
          <Tile label="Completed" value={iv?.completed} tone="text-success-700" />
          <Tile label="Still to do" value={iv?.pending} />
          <Tile label="Cancelled" value={iv?.cancelled} hint="not in Scheduled" />
        </div>
        <p className="mt-2 text-xs text-tertiary-500">Deleted and replaced test links are not counted, and a retake counts once. Tests are dated by the day they were sent, interviews by their interview time.</p>
      </div>

      <div className="rounded-xl border border-tertiary-100 bg-white shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary-100 px-3 py-2">
          <div className="flex gap-1">
            {[['tests', 'Test records'], ['interviews', 'Interview records']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => { setKind(k); setPage(1); }} className={`rounded-lg px-3 py-1 text-xs ${kind === k ? 'bg-primary-50 font-medium text-primary-700' : 'text-tertiary-500'}`}>{label}</button>
            ))}
          </div>
          <span className="text-xs text-tertiary-500">{records.total} record{records.total === 1 ? '' : 's'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="analytics-records">
            <thead className="bg-tertiary-50 text-tertiary-500">
              <tr>
                <th className="px-3 py-2">Candidate</th><th className="px-3 py-2">Requirement</th><th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Round</th>{kind === 'tests' && <th className="px-3 py-2">Test</th>}
                <th className="px-3 py-2">Status</th><th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">{kind === 'tests' ? 'Sent' : 'Interview'}</th><th className="px-3 py-2">{kind === 'tests' ? 'Submitted' : 'Completed'}</th>
                <th className="px-3 py-2">Recruiter</th>
              </tr>
            </thead>
            <tbody>
              {records.items.map((r) => (
                <tr key={r.id} className="border-t border-tertiary-100">
                  <td className="px-3 py-2">
                    {r.submission_id ? <a className="text-primary-700 hover:underline" href={`/submissions/${r.submission_id}`}>{r.candidate || 'Candidate'}</a> : (r.candidate || '-')}
                  </td>
                  <td className="px-3 py-2">{r.requirement || '-'}</td>
                  <td className="px-3 py-2">{r.client || '-'}</td>
                  <td className="px-3 py-2">{r.round}</td>
                  {kind === 'tests' && <td className="px-3 py-2">{r.test}</td>}
                  <td className="px-3 py-2">{(kind === 'tests' ? TEST_STATUS_LABEL : INTERVIEW_STATUS_LABEL)[r.status] || r.status}{kind === 'tests' && r.status === 'scored' ? (r.passed ? ' - passed' : ' - failed') : ''}{kind === 'interviews' && r.status === 'completed' ? ` - ${r.result}` : ''}</td>
                  <td className="px-3 py-2">{r.score_percent != null ? `${r.score_percent}%` : '-'}</td>
                  <td className="px-3 py-2">{shortDate(kind === 'tests' ? r.sent_at : r.scheduled_at)}</td>
                  <td className="px-3 py-2">{shortDate(kind === 'tests' ? r.submitted_at : r.completed_at)}</td>
                  <td className="px-3 py-2">{r.recruiter || '-'}</td>
                </tr>
              ))}
              {!loading && records.items.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-tertiary-500">Nothing matches these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-tertiary-100 px-3 py-2 text-xs">
            <button type="button" className="btn-secondary text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button type="button" className="btn-secondary text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Attempt limit: how many tests can be sent for one submission (admin editable; 0 = no limit).
function AttemptLimitSetting({ isAdmin }) {
  const [value, setValue] = useState('');
  const [emailOn, setEmailOn] = useState(false);
  const { busy, run } = useSave();
  useEffect(() => {
    apiClient.get('/assessments/settings').then(({ data }) => { setValue(String(data.data.assessment_max_attempts)); setEmailOn(Boolean(data.data.assessment_email_candidate)); }).catch(() => {});
  }, []);
  if (value === '') return null;
  return (
    <div className="space-y-2">
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-tertiary-100 bg-white p-3 shadow-soft" data-testid="attempt-limit">
      <Field label="Tests allowed per candidate submission" hint="Counted per submission (not per email), including replaced links; deleting an attempt frees a slot. 0 = no limit. An admin can still send past the limit.">
        <input type="number" min={0} max={50} className={`${FIELD_INPUT} !w-28`} value={value} disabled={!isAdmin} onChange={(e) => setValue(e.target.value)} />
      </Field>
      {isAdmin && <button type="button" className="btn-primary text-xs" disabled={busy} onClick={() => run(() => apiClient.put('/assessments/settings', { assessment_max_attempts: Number(value) }), 'Limit saved')}>Save limit</button>}
    </div>
    <div className="rounded-xl border border-tertiary-100 bg-white p-3 shadow-soft" data-testid="email-setting">
      <label className="flex items-start gap-2 text-sm text-tertiary-800">
        <input type="checkbox" className="mt-1" checked={emailOn} disabled={!isAdmin || busy}
          onChange={async (e) => {
            const next = e.target.checked;
            const ok = await run(() => apiClient.put('/assessments/settings', { assessment_email_candidate: next }), next ? 'Test links will be e-mailed' : 'Test links will not be e-mailed');
            if (ok) setEmailOn(next);
          }} />
        <span>E-mail the test link to the candidate
          <span className="block text-xs text-tertiary-500">Off by default: the recruiter copies the link from the candidate&apos;s interview plan and sends it themselves. Turn on to also e-mail it to the candidate&apos;s address when a test is sent.</span>
        </span>
      </label>
    </div>
    </div>
  );
}

export default function HiringSetupPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || Boolean(user?.is_superadmin);
  const [tab, setTab] = useState('templates');
  const [tests, setTests] = useState([]);
  const loadTests = useCallback(() => apiClient.get('/assessments/tests').then(({ data }) => setTests(data.data || [])).catch(() => setTests([])), []);
  useEffect(() => { loadTests(); }, [loadTests]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-lg font-semibold text-tertiary-900">Hiring setup</h1>
        <p className="text-sm text-tertiary-500">Interview templates per service type, the tests candidates take, and how they are going.</p>
      </div>
      <div className="flex gap-1 border-b border-tertiary-100">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? 'border-primary-600 font-medium text-primary-700' : 'border-transparent text-tertiary-500'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'templates' && <TemplatesTab isAdmin={isAdmin} tests={tests} />}
      {tab === 'questions' && <QuestionsTab />}
      {tab === 'tests' && <TestsTab onChanged={loadTests} isAdmin={isAdmin} />}
      {tab === 'analytics' && <AnalyticsTab />}
    </div>
  );
}
