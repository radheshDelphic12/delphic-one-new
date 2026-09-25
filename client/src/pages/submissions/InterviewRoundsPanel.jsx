import { useEffect, useMemo, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { required, runValidations, fieldErrorClass } from '../../lib/alerts/formValidation.js';
import Drawer from '../../components/ui/Drawer.jsx';
import MultiSelectDropdown from '../../components/ui/MultiSelectDropdown.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import DeleteRecordButton from '../../components/DeleteRecordButton.jsx';
import { userCan } from '../../lib/permissions.js';
import { canManageInterviewRound, isInternalRoundType, roundTypeLabel } from '../../lib/submissionStages.js';
import { ROUND_TYPES, RESULT_COLORS, ROUND_RESULTS as RESULTS, roundTypeMeta } from '../../lib/interviewRounds.js';

const emptyForm = {
  round_type: 'internal_r1',
  round_name: '',
  scheduled_at: '',
  duration_minutes: '60',
  interviewer_ids: [],
  interviewer_name: '',
  interviewer_email: '',
  meeting_link: '',
  result: 'pending',
  feedback: '',
  rating: '',
};

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return undefined;
  return new Date(value).toISOString();
}

function hydrate(round) {
  return {
    round_type: round.round_type || 'internal_r1',
    round_name: round.round_name || '',
    scheduled_at: toLocalInput(round.scheduled_at),
    duration_minutes: round.duration_minutes != null ? String(round.duration_minutes) : '',
    interviewer_ids: (round.interviewers || []).map((interviewer) => interviewer.id),
    interviewer_name: round.interviewer_name || '',
    interviewer_email: round.interviewer_email || '',
    meeting_link: round.meeting_link || '',
    result: round.result || 'pending',
    feedback: round.feedback || '',
    rating: round.rating != null ? String(round.rating) : '',
  };
}

function buildPayload(form) {
  const payload = {
    round_type: form.round_type,
    round_name: form.round_name.trim() || undefined,
    scheduled_at: fromLocalInput(form.scheduled_at),
    duration_minutes: form.duration_minutes === '' ? undefined : Number(form.duration_minutes),
    meeting_link: form.meeting_link.trim() || undefined,
    result: form.result || 'pending',
    feedback: form.feedback.trim() || undefined,
    rating: form.rating === '' ? undefined : Number(form.rating),
  };

  if (isInternalRoundType(form.round_type)) {
    payload.interviewer_ids = form.interviewer_ids;
  } else {
    payload.interviewer_name = form.interviewer_name.trim() || undefined;
    payload.interviewer_email = form.interviewer_email.trim() || '';
  }

  return payload;
}

function formatInterviewerLine(round) {
  if (isInternalRoundType(round.round_type) && round.interviewers?.length) {
    return round.interviewers.map((interviewer) => interviewer.name).join(', ');
  }
  return round.interviewer_name || 'No interviewer';
}

export default function InterviewRoundsPanel({ submissionId, submission, rounds, user, missingMandatoryRounds, onChanged }) {
  const { pushError } = useAlerts();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [activeUsers, setActiveUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const locked = !!submission?.is_locked;
  const allowedRoundTypes = locked
    ? []
    : ROUND_TYPES.filter((t) => canManageInterviewRound(submission, t.value, user)).map((t) => t.value);
  const canAddAnyRound = allowedRoundTypes.length > 0;
  const showInternalInterviewers = isInternalRoundType(form.round_type);
  const interviewerOptions = useMemo(
    () => activeUsers.map((user) => ({ id: user.id, label: user.name, hint: user.role })),
    [activeUsers]
  );

  useEffect(() => {
    if (!open || !showInternalInterviewers) return;
    apiClient
      .get('/users/directory', { params: { active: 'true' } })
      .then(({ data }) => setActiveUsers(data.data || []))
      .catch(() => setActiveUsers([]));
  }, [open, showInternalInterviewers]);

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, round_type: allowedRoundTypes[0] || emptyForm.round_type });
    setFieldErrors({});
    setOpen(true);
  }

  function openEdit(round) {
    setEditingId(round.id);
    setForm(hydrate(round));
    setFieldErrors({});
    setOpen(true);
  }

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    const validation = runValidations([['scheduled_at', required(form.scheduled_at, 'Interview date & time')]]);
    if (!validation.valid) {
      setFieldErrors(validation.fieldErrors);
      pushError(validation.messages.join(' '), 'Please fix the form');
      return;
    }
    setBusy(true);
    setFieldErrors({});
    try {
      const payload = buildPayload(form);
      if (editingId) {
        const { round_type, ...patch } = payload;
        await apiClient.patch(`/interview-rounds/${editingId}`, patch);
      } else {
        await apiClient.post(`/submissions/${submissionId}/interview-rounds`, payload);
      }
      setOpen(false);
      await onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save interview round'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="interview-rounds" className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-sm font-semibold text-sky-900">Interview rounds</h2>
          <p className="mt-0.5 text-xs text-sky-700/80">Each round needs an interview date when opened.</p>
        </div>
        {canAddAnyRound && (
          <button type="button" className="btn-primary text-xs" onClick={openCreate}>
            + Add round
          </button>
        )}
      </div>

      {(missingMandatoryRounds || []).length > 0 && (
        <div className="mt-3 rounded-xl border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-800">
          Missing mandatory round{missingMandatoryRounds.length > 1 ? 's' : ''}:{' '}
          {missingMandatoryRounds.map(roundTypeLabel).join(', ')}
        </div>
      )}

      {(rounds || []).length === 0 ? (
        <p className="mt-3 text-sm text-tertiary-500">No rounds yet. Add an internal screen or client round with a date.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rounds.map((r) => {
            const meta = roundTypeMeta(r.round_type);
            return (
              <li
                key={r.id}
                className={`rounded-xl border bg-white px-3 py-3 shadow-soft ${meta.color.split(' ').find((c) => c.startsWith('border-')) || 'border-tertiary-100'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-tertiary-900">
                      #{r.round_number}{' '}
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${meta.color}`}>
                        {meta.label}
                      </span>
                      {r.round_name ? ` - ${r.round_name}` : ''}
                    </p>
                    <p className="mt-1.5 text-xs text-tertiary-600">
                      <span className="font-medium text-sky-800">Interview:</span>{' '}
                      {r.scheduled_at ? new Date(r.scheduled_at).toLocaleString() : 'Date not set'}
                      {r.duration_minutes ? ` · ${r.duration_minutes} min` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-tertiary-500">
                      {formatInterviewerLine(r)}
                      {r.meeting_link ? (
                        <>
                          {' · '}
                          <a href={r.meeting_link} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">
                            Meeting link
                          </a>
                        </>
                      ) : null}
                    </p>
                    {r.feedback && <p className="mt-1 text-sm text-tertiary-600">{r.feedback}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_COLORS[r.result] || RESULT_COLORS.pending}`}>
                      {(r.result || 'pending').replace(/_/g, ' ')}
                    </span>
                    {r.rating != null && <span className="text-xs text-amber-700">★ {r.rating}</span>}
                    {!locked && canManageInterviewRound(submission, r.round_type, user) && (
                      <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => openEdit(r)}>
                        Edit
                      </button>
                    )}
                    {userCan(user, 'deleteRecords') && (
                      <DeleteRecordButton
                        entityType="interview_round"
                        entityId={r.id}
                        entityLabel={`Interview round #${r.round_number}`}
                        label="Delete"
                        onDeleted={onChanged}
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Drawer
        open={open}
        size="md"
        tone={editingId ? 'edit' : 'create'}
        title={editingId ? 'Edit interview round' : 'Add interview round'}
        onClose={() => !busy && setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save round'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {!editingId && (
            <label className="block text-xs font-medium text-tertiary-600">
              Round type *
              <SearchableSelect
                className="mt-1"
                value={form.round_type}
                onChange={(v) => updateField('round_type', v)}
                searchPlaceholder="Search round types…"
                options={ROUND_TYPES.filter((t) => allowedRoundTypes.includes(t.value)).map((t) => ({
                  value: t.value,
                  label: t.label,
                }))}
              />
            </label>
          )}

          <label className="block text-xs font-medium text-tertiary-600">
            Round name
            <input
              value={form.round_name}
              onChange={(e) => updateField('round_name', e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="e.g. Tech screen"
            />
          </label>

          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
            <label className="block text-xs font-semibold text-sky-900">
              Interview date & time *
              <input
                required
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) => updateField('scheduled_at', e.target.value)}
                className={fieldErrorClass(fieldErrors, 'scheduled_at', 'mt-1 w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm')}
              />
            </label>
            {fieldErrors.scheduled_at && (
              <p className="text-xs text-danger-600 mt-1">{fieldErrors.scheduled_at}</p>
            )}
            <p className="mt-1.5 text-[11px] text-sky-700">When this round is open for the candidate.</p>
          </div>

          <label className="block text-xs font-medium text-tertiary-600">
            Duration (minutes)
            <input
              type="number"
              min={1}
              value={form.duration_minutes}
              onChange={(e) => updateField('duration_minutes', e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </label>

          {showInternalInterviewers ? (
            <div className="block text-xs font-medium text-tertiary-600">
              Interviewers
              <MultiSelectDropdown
                value={form.interviewer_ids}
                onChange={(interviewer_ids) => updateField('interviewer_ids', interviewer_ids)}
                options={interviewerOptions}
                placeholder="Select interviewers…"
                searchPlaceholder="Search by name or role…"
                emptyMessage="No active users found."
                noResultsMessage="No users match your search."
              />
              <p className="mt-1 text-[11px] text-tertiary-500">Choose one or more active team members.</p>
            </div>
          ) : (
            <>
              <label className="block text-xs font-medium text-tertiary-600">
                Interviewer
                <input
                  value={form.interviewer_name}
                  onChange={(e) => updateField('interviewer_name', e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-xs font-medium text-tertiary-600">
                Interviewer email
                <input
                  type="email"
                  value={form.interviewer_email}
                  onChange={(e) => updateField('interviewer_email', e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </label>
            </>
          )}

          <label className="block text-xs font-medium text-tertiary-600">
            Meeting link
            <input
              value={form.meeting_link}
              onChange={(e) => updateField('meeting_link', e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs font-medium text-tertiary-600">
            Result
            <select
              value={form.result}
              onChange={(e) => updateField('result', e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            >
              {RESULTS.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium text-tertiary-600">
            Rating (1–10)
            <input
              type="number"
              min={1}
              max={10}
              value={form.rating}
              onChange={(e) => updateField('rating', e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs font-medium text-tertiary-600">
            Feedback
            <textarea
              rows={3}
              value={form.feedback}
              onChange={(e) => updateField('feedback', e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </label>
        </div>
      </Drawer>
    </section>
  );
}
