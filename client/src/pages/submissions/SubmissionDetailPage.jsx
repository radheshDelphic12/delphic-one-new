import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Breadcrumbs from '../../components/ui/Breadcrumbs.jsx';
import DetailSkeleton from '../../components/ui/DetailSkeleton.jsx';
import Tooltip from '../../components/ui/Tooltip.jsx';
import ProgressRing from '../../components/ui/ProgressRing.jsx';
import ClosureStepsBreakdown from '../../components/ui/ClosureStepsBreakdown.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';
import FilesPanel from '../../components/FilesPanel.jsx';
import UnlockButton from '../../components/UnlockButton.jsx';
import DeleteRecordButton from '../../components/DeleteRecordButton.jsx';
import { userCan } from '../../lib/permissions.js';
import InterviewRoundsPanel from './InterviewRoundsPanel.jsx';
import SubmissionStageOverrideDrawer from './SubmissionStageOverrideDrawer.jsx';
import {
  SUBMISSION_PIPELINE,
  canMoveSubmissionBackward,
  canMoveSubmissionStage,
  canMutateSubmission,
  canOverrideSubmissionStage,
  computeMarginPreview,
  isBackwardTransition,
  nextSubmissionStages,
  pipelineIndex,
  requiresBackoutReason,
  requiresRejectionReason,
} from '../../lib/submissionStages.js';

const RATE_TYPES = ['monthly', 'hourly', 'annual'];
const CURRENCIES = ['INR', 'USD', 'AED', 'SAR'];
const BGV_STATUSES = ['pending', 'in_progress', 'cleared', 'failed'];

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

function toOptionalNumber(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function dateInputValue(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function StageStepper({ stage }) {
  const currentIdx = pipelineIndex(stage);
  const isTerminalFail = stage === 'backout' || stage === 'rejected';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {SUBMISSION_PIPELINE.map((s, idx) => {
          const isPast = currentIdx >= 0 && idx < currentIdx;
          const isCurrent = s === stage || (currentIdx >= 0 && idx === currentIdx && !isTerminalFail);
          const isDone = isPast || isCurrent;

          return (
            <div key={s} className="flex items-center gap-1.5">
              {idx > 0 && (
                <ChevronRight
                  className={`h-3.5 w-3.5 shrink-0 ${
                    currentIdx >= 0 && idx <= currentIdx ? 'text-green-500' : 'text-tertiary-300'
                  }`}
                  aria-hidden="true"
                />
              )}
              <div
                className={`rounded-md px-2 py-1 text-[11px] font-medium capitalize ${
                  isCurrent
                    ? 'bg-green-600 text-white ring-2 ring-green-200'
                    : isDone
                      ? 'bg-green-100 text-green-800'
                      : 'bg-tertiary-100 text-tertiary-500'
                }`}
              >
                {s.replace(/_/g, ' ')}
              </div>
            </div>
          );
        })}
      </div>
      {isTerminalFail && (
        <p className="text-sm font-medium capitalize text-red-700">Ended: {stage.replace(/_/g, ' ')}</p>
      )}
    </div>
  );
}

export default function SubmissionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const [submission, setSubmission] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [stageModal, setStageModal] = useState(null);
  const [stageReason, setStageReason] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const canOverrideStage = canOverrideSubmissionStage(user);

  const canEdit = canMutateSubmission(user) && submission && !submission.is_locked;

  // Stage moves: sales, recruiter and admin do forward transitions on any
  // submission (backward moves stay admin-only via canMoveSubmissionBackward).
  // Independent of canEdit, which gates the field fieldsets (recruiter/admin only).
  const canMoveStage = canMoveSubmissionStage(user) && submission && !submission.is_locked;

  const liveMargin = useMemo(() => {
    if (!form) return { margin: null, margin_percentage: null };
    return computeMarginPreview(
      toOptionalNumber(form.proposed_rate),
      form.proposed_rate_currency,
      toOptionalNumber(form.vendor_rate),
      form.vendor_rate_currency
    );
  }, [form]);

  const load = useCallback(async () => {
    setLoading(true);
    // The stage-history request is secondary — a failure there must never blank the
    // whole ticket (candidate, commercials, rounds). Fetch it separately.
    apiClient
      .get(`/submissions/${id}/history`)
      .then((histRes) => {
        setHistory(histRes.data.data || []);
        setHistoryError('');
      })
      .catch((err) => {
        setHistory([]);
        setHistoryError(apiErrorMessage(err, 'Could not load stage history'));
      });
    try {
      const subRes = await apiClient.get(`/submissions/${id}`);
      const sub = subRes.data.data;
      setSubmission(sub);
      setForm({
        proposed_rate: sub.proposed_rate ?? '',
        proposed_rate_type: sub.proposed_rate_type || 'monthly',
        proposed_rate_currency: sub.proposed_rate_currency || 'INR',
        vendor_rate: sub.vendor_rate ?? '',
        vendor_rate_type: sub.vendor_rate_type || 'monthly',
        vendor_rate_currency: sub.vendor_rate_currency || 'INR',
        final_agreed_rate: sub.final_agreed_rate ?? '',
        final_agreed_rate_type: sub.final_agreed_rate_type || 'monthly',
        relevancy_score: sub.relevancy_score ?? '',
        submission_notes: sub.submission_notes || '',
        client_feedback: sub.client_feedback || '',
        offer_date: dateInputValue(sub.offer_date),
        offer_ctc: sub.offer_ctc ?? '',
        offer_ctc_currency: sub.offer_ctc_currency || 'INR',
        expected_joining_date: dateInputValue(sub.expected_joining_date),
        actual_joining_date: dateInputValue(sub.actual_joining_date),
        bgv_initiated_date: dateInputValue(sub.bgv_initiated_date),
        bgv_status: sub.bgv_status || 'pending',
        bgv_completed_date: dateInputValue(sub.bgv_completed_date),
        bgv_notes: sub.bgv_notes || '',
      });
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load submission'), 'Something went wrong');
      setSubmission(null);
    } finally {
      setLoading(false);
    }
  }, [id, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    try {
      const payload = {
        proposed_rate: toOptionalNumber(form.proposed_rate),
        proposed_rate_type: form.proposed_rate_type || undefined,
        proposed_rate_currency: form.proposed_rate_currency || undefined,
        vendor_rate: toOptionalNumber(form.vendor_rate),
        vendor_rate_type: form.vendor_rate_type || undefined,
        vendor_rate_currency: form.vendor_rate_currency || undefined,
        final_agreed_rate: toOptionalNumber(form.final_agreed_rate),
        final_agreed_rate_type: form.final_agreed_rate_type || undefined,
        relevancy_score: toOptionalNumber(form.relevancy_score),
        submission_notes: form.submission_notes.trim() || undefined,
        client_feedback: form.client_feedback.trim() || undefined,
        offer_date: form.offer_date || undefined,
        offer_ctc: toOptionalNumber(form.offer_ctc),
        offer_ctc_currency: form.offer_ctc_currency || undefined,
        expected_joining_date: form.expected_joining_date || undefined,
        actual_joining_date: form.actual_joining_date || undefined,
        bgv_initiated_date: form.bgv_initiated_date || undefined,
        bgv_status: form.bgv_status || undefined,
        bgv_completed_date: form.bgv_completed_date || undefined,
        bgv_notes: form.bgv_notes.trim() || undefined,
      };
      await apiClient.patch(`/submissions/${id}`, payload);
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save changes'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  function openStage(to_stage) {
    setStageReason('');
    setStageModal(to_stage);
  }

  async function confirmStage() {
    if (!stageModal) return;
    setBusy(true);
    try {
      const body = { to_stage: stageModal };
      if (requiresBackoutReason(stageModal)) body.backout_reason = stageReason.trim();
      if (requiresRejectionReason(stageModal)) body.rejection_reason = stageReason.trim();
      if (isBackwardTransition(submission.stage, stageModal)) body.reason = stageReason.trim();
      await apiClient.post(`/submissions/${id}/stage`, body);
      setStageModal(null);
      setStageReason('');
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Stage change failed'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function applyStageOverride(body) {
    setBusy(true);
    try {
      await apiClient.post(`/submissions/${id}/stage/override`, body);
      setOverrideOpen(false);
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Stage override failed'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <DetailSkeleton />;
  if (!submission || !form) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-tertiary-600">Submission not found or could not be loaded.</p>
        <Link to="/submissions" className="text-sm text-primary-600 hover:underline">
          ← Back to submissions
        </Link>
      </div>
    );
  }

  const canMoveBackward = canMoveSubmissionBackward(user);
  const isBackwardTarget = (to) => isBackwardTransition(submission.stage, to);
  const isReactivateTarget = (to) =>
    isBackwardTarget(to) && (submission.stage === 'rejected' || submission.stage === 'backout');
  const stageTargets = nextSubmissionStages(submission.stage).filter(
    (to) => canMoveBackward || !isBackwardTarget(to)
  );
  const stageNeedsReason = (to) =>
    requiresBackoutReason(to) || requiresRejectionReason(to) || isBackwardTarget(to);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Breadcrumbs
            items={[
              { label: 'Submissions', to: '/submissions' },
              { label: submission.profile?.name || 'Submission' },
            ]}
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-xl font-semibold text-tertiary-900">
              {submission.profile?.name || 'Submission'}
            </h1>
            <Badge value={submission.stage} />
            {submission.is_locked && (
              <span className="rounded bg-tertiary-100 px-2 py-0.5 text-xs text-tertiary-600">Locked</span>
            )}
          </div>
          <p className="mt-1 text-sm text-tertiary-500">
            {submission.requirement?.title || '—'}
            {submission.requirement?.account_name ? ` · ${submission.requirement.account_name}` : ''}
            {submission.seat?.seat_label ? ` · ${submission.seat.seat_label}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center">
            <ProgressRing percent={submission.progress?.percent ?? null} size="md" />
            <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-tertiary-400">Closure %</span>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
          {submission.requirement?.id && (
            <>
              <Link to={`/requirements/${submission.requirement.id}`} className="btn-secondary">
                Open job
              </Link>
              <Link to={`/requirements/${submission.requirement.id}/board`} className="btn-secondary">
                Pipeline board
              </Link>
            </>
          )}
          {user?.role === 'admin' && submission.is_locked && (
            <UnlockButton entityType="submission" entityId={submission.id} onUnlocked={load} />
          )}
          {userCan(user, 'deleteRecords') && (
            <DeleteRecordButton
              entityType="submission"
              entityId={submission.id}
              entityLabel={`Submission - ${submission.profile?.name || submission.id}`}
              onDeleted={() => navigate('/submissions')}
            />
          )}
          </div>
        </div>
      </div>

      {submission.is_locked && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          This submission is locked. It remains available for viewing.
          {user?.role === 'admin' ? ' Use Unlock to allow edits again.' : ''}
        </div>
      )}

      <section className="rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold text-tertiary-800">Stage</h2>
        <div className="mt-3">
          <StageStepper stage={submission.stage} />
        </div>
        {!canMoveStage ? (
          <p className="mt-3 text-sm text-tertiary-500">
            {submission.is_locked
              ? 'Submission is locked.'
              : 'You do not have permission to move stages.'}
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {stageTargets.map((to) => {
              const exit = to === 'backout' || to === 'rejected';
              const backward = isBackwardTarget(to);
              const reactivate = isReactivateTarget(to);
              const label = reactivate
                ? 'Reactivate candidate'
                : backward
                  ? `Move back to ${to.replace(/_/g, ' ')}`
                  : `Move to ${to.replace(/_/g, ' ')}`;
              return (
                <Tooltip
                  key={to}
                  label={
                    requiresBackoutReason(to)
                      ? 'Requires a backout reason'
                      : requiresRejectionReason(to)
                        ? 'Requires a rejection reason'
                        : backward
                          ? 'Admin only · requires a reason'
                          : `Move this submission to ${to.replace(/_/g, ' ')}`
                  }
                >
                  <button
                    type="button"
                    className={exit ? 'btn-danger' : backward ? 'btn-ghost border border-tertiary-300' : 'btn-secondary'}
                    onClick={() => openStage(to)}
                  >
                    {label}
                  </button>
                </Tooltip>
              );
            })}
            {stageTargets.length === 0 && (
              <p className="text-sm text-tertiary-500">No further transitions.</p>
            )}
          </div>
        )}
        {(submission.stage === 'interview_result' || nextSubmissionStages(submission.stage).includes('offer_sent')) && (
          <p className="mt-2 text-xs text-tertiary-400">
            Moving to offer sent requires every interview round to have a non-pending result.
          </p>
        )}
        {submission.stage === 'bgv' && (
          <p className="mt-2 text-xs text-tertiary-400">Closing requires BGV status cleared.</p>
        )}
        {canOverrideStage && (
          <div className="mt-3 border-t border-tertiary-100 pt-3">
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOverrideOpen(true)}>
              Override stage…
            </button>
            <span className="ml-2 text-xs text-tertiary-400">Superadmin - bypasses the transition rules.</span>
          </div>
        )}
      </section>

      {submission.progress && (
        <section className="rounded-lg border bg-white p-4">
          <div className="flex items-center gap-3">
            <ProgressRing percent={submission.progress.percent} size="md" />
            <div>
              <h2 className="text-sm font-semibold text-tertiary-800">Closure probability - {submission.progress.percent}%</h2>
              <p className="text-xs text-tertiary-500">
                {submission.progress.completed} of {submission.progress.total} pipeline steps complete.
              </p>
            </div>
          </div>
          <div className="mt-3">
            <ClosureStepsBreakdown steps={submission.progress.steps} />
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold text-tertiary-800">Candidate</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-tertiary-500">Name</dt>
            <dd>{submission.profile?.name || '—'}</dd>
            <dt className="text-tertiary-500">Company</dt>
            <dd>{submission.profile?.current_company || '—'}</dd>
            <dt className="text-tertiary-500">Experience</dt>
            <dd>{submission.profile?.total_experience_years ?? '—'} yrs</dd>
            <dt className="text-tertiary-500">Source</dt>
            <dd className="capitalize">{submission.profile?.source || '—'}</dd>
            <dt className="text-tertiary-500">Expected CTC</dt>
            <dd>{submission.profile?.expected_ctc ?? '—'}</dd>
            <dt className="text-tertiary-500">Notice</dt>
            <dd>
              {submission.profile?.notice_period_days != null
                ? `${submission.profile.notice_period_days} days`
                : '—'}
            </dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-1">
            {(submission.profile?.primary_skills || []).map((s) => (
              <span key={s} className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                {s}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold text-tertiary-800">Job / seat</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-tertiary-500">Requirement</dt>
            <dd>{submission.requirement?.title || '—'}</dd>
            <dt className="text-tertiary-500">Client</dt>
            <dd>{submission.requirement?.account_name || '—'}</dd>
            <dt className="text-tertiary-500">Seat</dt>
            <dd>{submission.seat?.seat_label || submission.seat?.id?.slice(0, 8) || '—'}</dd>
            <dt className="text-tertiary-500">Submitted by</dt>
            <dd>{submission.submitted_by?.name || '—'}</dd>
            {(submission.backout_reason || submission.rejection_reason) && (
              <>
                <dt className="text-tertiary-500">Exit reason</dt>
                <dd>{submission.backout_reason || submission.rejection_reason}</dd>
              </>
            )}
          </dl>
        </section>
      </div>

      <InterviewRoundsPanel
        submissionId={id}
        submission={submission}
        rounds={submission.interview_rounds || []}
        user={user}
        missingMandatoryRounds={submission.missing_mandatory_rounds}
        onChanged={load}
      />

      <form onSubmit={handleSave} className="space-y-4">
        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold text-tertiary-800">Commercials & margin</h2>
          <fieldset disabled={!canEdit || saving} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Proposed rate</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.proposed_rate}
                onChange={(e) => updateField('proposed_rate', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-tertiary-500">Type</label>
                <select
                  value={form.proposed_rate_type}
                  onChange={(e) => updateField('proposed_rate_type', e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  {RATE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-tertiary-500">Currency</label>
                <select
                  value={form.proposed_rate_currency}
                  onChange={(e) => updateField('proposed_rate_currency', e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Vendor rate</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.vendor_rate}
                onChange={(e) => updateField('vendor_rate', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-tertiary-500">Type</label>
                <select
                  value={form.vendor_rate_type}
                  onChange={(e) => updateField('vendor_rate_type', e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  {RATE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-tertiary-500">Currency</label>
                <select
                  value={form.vendor_rate_currency}
                  onChange={(e) => updateField('vendor_rate_currency', e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sm:col-span-2 rounded-md bg-tertiary-50 px-3 py-2 text-sm text-tertiary-800">
              Saved margin: {submission.margin != null ? `${submission.margin} (${submission.margin_percentage}%)` : '—'}
              {liveMargin.margin != null && (
                <span className="ml-2 text-primary-700">
                  · Preview: {liveMargin.margin} ({liveMargin.margin_percentage}%)
                </span>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Final agreed rate</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.final_agreed_rate}
                onChange={(e) => updateField('final_agreed_rate', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Final rate type</label>
              <select
                value={form.final_agreed_rate_type}
                onChange={(e) => updateField('final_agreed_rate_type', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                {RATE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Relevancy (1–10)</label>
              <input
                type="number"
                min={1}
                max={10}
                value={form.relevancy_score}
                onChange={(e) => updateField('relevancy_score', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Submission notes</label>
              <textarea
                rows={2}
                value={form.submission_notes}
                onChange={(e) => updateField('submission_notes', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Client feedback</label>
              <textarea
                rows={2}
                value={form.client_feedback}
                onChange={(e) => updateField('client_feedback', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </fieldset>
        </section>

        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold text-tertiary-800">Offer & BGV</h2>
          <fieldset disabled={!canEdit || saving} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Offer date</label>
              <input
                type="date"
                value={form.offer_date}
                onChange={(e) => updateField('offer_date', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-tertiary-500">Offer CTC</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.offer_ctc}
                  onChange={(e) => updateField('offer_ctc', e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div className="w-24">
                <label className="mb-1 block text-xs font-medium text-tertiary-500">Cur</label>
                <select
                  value={form.offer_ctc_currency}
                  onChange={(e) => updateField('offer_ctc_currency', e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Expected joining</label>
              <input
                type="date"
                value={form.expected_joining_date}
                onChange={(e) => updateField('expected_joining_date', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">Actual joining</label>
              <input
                type="date"
                value={form.actual_joining_date}
                onChange={(e) => updateField('actual_joining_date', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">BGV status</label>
              <select
                value={form.bgv_status}
                onChange={(e) => updateField('bgv_status', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                {BGV_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">BGV initiated</label>
              <input
                type="date"
                value={form.bgv_initiated_date}
                onChange={(e) => updateField('bgv_initiated_date', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-500">BGV completed</label>
              <input
                type="date"
                value={form.bgv_completed_date}
                onChange={(e) => updateField('bgv_completed_date', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-tertiary-500">BGV notes</label>
              <textarea
                rows={2}
                value={form.bgv_notes}
                onChange={(e) => updateField('bgv_notes', e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </fieldset>
        </section>

        {canEdit && (
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save commercials & BGV'}
          </button>
        )}
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <NotesPanel entityType="submission" entityId={submission.id} />
        <FilesPanel
          entityType="submission"
          entityId={submission.id}
          canUpload={canEdit}
          defaultLabel="Submission file"
        />
      </div>

      <section className="rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold text-tertiary-800">Stage history</h2>
        {historyError && <p className="mt-2 text-xs text-amber-700">{historyError}</p>}
        <ul className="mt-2 space-y-1 text-sm text-tertiary-700">
          {history.length === 0 && !historyError && (
            <li className="text-tertiary-400">No stage changes yet</li>
          )}
          {history.map((h) => (
            <li key={h.id}>
              <span className="capitalize">{h.from_stage?.replace(/_/g, ' ') || '—'}</span>
              {' → '}
              <span className="font-medium capitalize">{h.to_stage?.replace(/_/g, ' ')}</span>
              <span className="text-tertiary-400"> · {formatDate(h.changed_at)}</span>
              <span className="text-tertiary-500"> · {h.changed_by?.name || 'Unknown'}</span>
              {h.reason && <span className="text-tertiary-500"> - {h.reason}</span>}
            </li>
          ))}
        </ul>
      </section>

      <Modal
        open={Boolean(stageModal)}
        title={
          stageModal && isReactivateTarget(stageModal)
            ? 'Reactivate candidate'
            : stageModal && isBackwardTarget(stageModal)
              ? `Move back to ${stageModal.replace(/_/g, ' ')}`
              : `Move to ${stageModal?.replace(/_/g, ' ') || ''}`
        }
        onClose={() => !busy && setStageModal(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStageModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={
                requiresBackoutReason(stageModal) || requiresRejectionReason(stageModal) ? 'btn-danger' : 'btn-primary'
              }
              disabled={busy || (stageModal && stageNeedsReason(stageModal) && !stageReason.trim())}
              onClick={confirmStage}
            >
              Confirm
            </button>
          </>
        }
      >
        {stageModal && stageNeedsReason(stageModal) ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-500">
              {requiresBackoutReason(stageModal)
                ? 'Backout reason *'
                : requiresRejectionReason(stageModal)
                  ? 'Rejection reason *'
                  : 'Reason *'}
            </label>
            <textarea
              rows={3}
              value={stageReason}
              onChange={(e) => setStageReason(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
            />
          </div>
        ) : (
          <p className="text-tertiary-600">
            Confirm moving this submission to {stageModal?.replace(/_/g, ' ')}.
          </p>
        )}
      </Modal>

      {canOverrideStage && (
        <SubmissionStageOverrideDrawer
          submission={submission}
          open={overrideOpen}
          saving={busy}
          onClose={() => !busy && setOverrideOpen(false)}
          onMove={applyStageOverride}
        />
      )}
    </div>
  );
}
