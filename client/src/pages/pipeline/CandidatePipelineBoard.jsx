import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import CardActionsMenu from '../../components/ui/CardActionsMenu.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import ProgressRing from '../../components/ui/ProgressRing.jsx';
import ScreeningRoundChips from './ScreeningRoundChips.jsx';
import {
  SUBMISSION_PIPELINE,
  canCreateSubmission,
  canMoveSubmissionBackward,
  canMoveSubmissionStage,
  canOverrideSubmissionStage,
  isBackwardTransition,
  nextSubmissionStages,
  requiresBackoutReason,
  requiresRejectionReason,
} from '../../lib/submissionStages.js';
import SubmissionCreatePage from '../submissions/SubmissionCreatePage.jsx';
import SubmissionStageOverrideDrawer from '../submissions/SubmissionStageOverrideDrawer.jsx';
import { formatStageLabel, shortKey } from './pipelineBoardUtils.js';
import { DndContext, DragOverlay, DroppableColumn, DraggableCard, usePipelineSensors } from './pipelineDnd.jsx';
import { usePipelineBoard } from './usePipelineBoard.js';
import PipelineFilters from './PipelineFilters.jsx';

const CANDIDATE_COLUMNS = [...SUBMISSION_PIPELINE, 'backout', 'rejected'];
const CANDIDATE_FILTER_FIELDS = ['search', 'account_id', 'recruiter_id', 'submission_stage'];

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-tertiary-200 px-2.5 py-1.5 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100';

function needsSubmissionReason(toStage) {
  return requiresBackoutReason(toStage) || requiresRejectionReason(toStage);
}

function SubmissionStageDrawer({ submission, open, saving, preferredToStage, canMoveBackward, onClose, onMove }) {
  const stages = nextSubmissionStages(submission?.stage).filter(
    (s) => canMoveBackward || !isBackwardTransition(submission?.stage, s)
  );
  const [toStage, setToStage] = useState('');
  const [reason, setReason] = useState('');
  const backward = submission ? isBackwardTransition(submission.stage, toStage) : false;
  const showReason = needsSubmissionReason(toStage) || backward;

  useEffect(() => {
    if (!open) return;
    const preferred = preferredToStage && stages.includes(preferredToStage) ? preferredToStage : stages[0] || '';
    setToStage(preferred);
    setReason('');
  }, [open, submission?.id, submission?.stage, preferredToStage]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(event) {
    event.preventDefault();
    const body = { to_stage: toStage };
    if (requiresBackoutReason(toStage)) body.backout_reason = reason.trim();
    if (requiresRejectionReason(toStage)) body.rejection_reason = reason.trim();
    if (backward) body.reason = reason.trim();
    onMove(body);
  }

  if (!submission) return null;

  return (
    <Drawer
      open={open}
      title="Move submission stage"
      onClose={() => !saving && onClose()}
      size="sm"
      tone="edit"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" form="candidate-stage-form" disabled={saving || !toStage} className="btn-primary">
            {saving ? 'Moving…' : 'Move stage'}
          </button>
        </>
      }
    >
      <form id="candidate-stage-form" onSubmit={submit} className="space-y-3">
        <p className="text-xs text-tertiary-500">Current stage: {formatStageLabel(submission.stage)}</p>
        <label className="block text-xs font-medium text-tertiary-600">
          Next stage
          <select
            required
            value={toStage}
            onChange={(event) => setToStage(event.target.value)}
            className={`${INPUT_CLASS} capitalize`}
          >
            {stages.map((stage) => (
              <option key={stage} value={stage}>
                {formatStageLabel(stage)}
              </option>
            ))}
          </select>
        </label>
        {showReason && (
          <label className="block text-xs font-medium text-tertiary-600">
            Reason
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        )}
      </form>
    </Drawer>
  );
}

function CandidateCard({ submission, canMove, canMoveBackward, isDragging, onRequestMove }) {
  const next = nextSubmissionStages(submission.stage).filter(
    (stage) => canMoveBackward || !isBackwardTransition(submission.stage, stage)
  );
  const actions = [
    { key: 'detail', label: 'Open submission', to: `/submissions/${submission.id}` },
    submission.requirement?.id
      ? { key: 'board', label: 'Open job board', to: `/requirements/${submission.requirement.id}/board` }
      : null,
    ...(canMove && !submission.is_locked
      ? next.map((stage) => ({
          key: `move-${stage}`,
          label: isBackwardTransition(submission.stage, stage)
            ? (submission.stage === 'rejected' || submission.stage === 'backout'
              ? 'Reactivate candidate'
              : `Move back to ${formatStageLabel(stage)}`)
            : `Move to ${formatStageLabel(stage)}`,
          danger: stage === 'backout' || stage === 'rejected',
          onClick: () => onRequestMove(submission, stage),
        }))
      : []),
  ];

  return (
    <div
      className={`rounded-lg border border-tertiary-200 bg-white p-2.5 shadow-sm ${
        isDragging ? 'opacity-40 ring-2 ring-primary-300' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <Link to={`/submissions/${submission.id}`} className="min-w-0 flex-1 text-left">
          <div className="font-mono text-[10px] text-primary-600">{shortKey('SUB', submission.id)}</div>
          <div className="truncate text-sm font-semibold text-tertiary-900">
            {submission.profile?.name || 'Candidate'}
          </div>
          <div className="mt-0.5 truncate text-xs text-tertiary-500">
            {submission.requirement?.title || '—'}
            {submission.requirement?.account_name ? ` · ${submission.requirement.account_name}` : ''}
          </div>
          {submission.profile?.source === 'vendor' && submission.profile?.vendor_account?.name && (
            <div className="mt-0.5 truncate text-[11px] text-tertiary-500">
              via {submission.profile.vendor_account.name}
            </div>
          )}
        </Link>
        <CardActionsMenu items={actions} label={`Actions for ${submission.profile?.name || 'submission'}`} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Badge value={submission.stage} />
        <ProgressRing percent={submission.progress?.percent ?? null} size="sm" />
      </div>
      <ScreeningRoundChips rounds={submission.interview_rounds} className="mt-2" />
    </div>
  );
}

/**
 * Recruiter / admin candidate pipeline — submissions as cards in stage columns.
 */
export default function CandidatePipelineBoard() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const sensors = usePipelineSensors();
  const [filterParams, setFilterParams] = useState({});
  const boardParams = useMemo(() => {
    const params = { sort_by: 'created_at', sort_order: 'desc' };
    if (filterParams.search) params.search = filterParams.search;
    if (filterParams.account_id) params.account_id = filterParams.account_id;
    if (filterParams.recruiter_id) params.submitted_by = filterParams.recruiter_id;
    if (filterParams.submission_stage) {
      const stages = String(filterParams.submission_stage).split(',').filter(Boolean);
      if (stages.length) params.stage = stages.join(',');
    }
    return params;
  }, [filterParams]);
  const handleFiltersChange = useCallback((params) => setFilterParams(params), []);
  const { cells, loading, reload } = usePipelineBoard({
    path: '/submissions',
    params: boardParams,
    columns: CANDIDATE_COLUMNS,
    stageField: 'stage',
  });
  const [stageTarget, setStageTarget] = useState(null);
  const [preferredToStage, setPreferredToStage] = useState('');
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [moving, setMoving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState(null);
  const [overId, setOverId] = useState(null);
  const canCreate = canCreateSubmission(user);
  const canMove = canMoveSubmissionStage(user);
  const canMoveBackward = canMoveSubmissionBackward(user);
  const canOverride = canOverrideSubmissionStage(user);

  async function postDirectMove(submission, toStage) {
    setMoving(true);
    try {
      await apiClient.post(`/submissions/${submission.id}/stage`, { to_stage: toStage });
      reload();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to move stage'), 'Something went wrong');
    } finally {
      setMoving(false);
    }
  }

  async function applyOverride(body) {
    if (!overrideTarget) return;
    setMoving(true);
    try {
      await apiClient.post(`/submissions/${overrideTarget.submission.id}/stage/override`, body);
      setOverrideTarget(null);
      reload();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Stage override failed'), 'Something went wrong');
    } finally {
      setMoving(false);
    }
  }

  function requestMove(submission, toStage) {
    const allowed = nextSubmissionStages(submission.stage);
    if (!allowed.includes(toStage)) {
      if (canOverride) {
        setOverrideTarget({ submission, toStage });
        return;
      }
      pushError(`Cannot move from ${formatStageLabel(submission.stage)} to ${formatStageLabel(toStage)}`, 'Validation');
      return;
    }
    const backward = isBackwardTransition(submission.stage, toStage);
    if (backward && !canMoveBackward) {
      pushError(`Cannot move from ${formatStageLabel(submission.stage)} to ${formatStageLabel(toStage)}`, 'Validation');
      return;
    }
    if (needsSubmissionReason(toStage) || backward) {
      setPreferredToStage(toStage);
      setStageTarget(submission);
      return;
    }
    postDirectMove(submission, toStage);
  }

  async function moveStage(body) {
    if (!stageTarget) return;
    setMoving(true);
    try {
      await apiClient.post(`/submissions/${stageTarget.id}/stage`, body);
      setStageTarget(null);
      setPreferredToStage('');
      reload();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to move stage'), 'Something went wrong');
    } finally {
      setMoving(false);
    }
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveDrag(null);
    setOverId(null);
    if (!over || !active) return;
    const submission = active.data.current?.submission;
    const toStage = String(over.id);
    if (!submission || submission.stage === toStage) return;
    requestMove(submission, toStage);
  }

  if (loading) return <div className="text-sm text-tertiary-500">Loading candidate pipeline…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-tertiary-900">Candidate pipeline</h2>
          <p className="mt-1 text-sm text-tertiary-500">
            Drag candidates between stages, or use the ⋯ menu on a card.
          </p>
        </div>
        {canCreate && (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Put forward
          </button>
        )}
      </div>

      <PipelineFilters fields={CANDIDATE_FILTER_FIELDS} onChange={handleFiltersChange} />

      <DndContext
        sensors={sensors}
        onDragStart={(event) => setActiveDrag(event.active.data.current?.submission || null)}
        onDragOver={(event) => setOverId(event.over?.id || null)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveDrag(null);
          setOverId(null);
        }}
      >
        <div className="flex gap-3 overflow-x-auto pb-2">
          {CANDIDATE_COLUMNS.map((stage) => {
            const cards = cells[stage] || [];
            return (
              <section
                key={stage}
                className="flex w-64 shrink-0 flex-col rounded-xl border border-tertiary-200 bg-tertiary-50/40"
              >
                <header className="flex items-center justify-between border-b border-tertiary-100 px-3 py-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary-600">
                    {formatStageLabel(stage)}
                  </h3>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-tertiary-700">
                    {cards.length}
                  </span>
                </header>
                <DroppableColumn id={stage} isOver={overId === stage} className="max-h-[calc(100vh-16rem)]">
                  {cards.map((submission) => (
                    <DraggableCard
                      key={submission.id}
                      id={submission.id}
                      disabled={!canMove || submission.is_locked || moving}
                      data={{ submission, stage: submission.stage }}
                    >
                      {({ isDragging }) => (
                        <CandidateCard
                          submission={submission}
                          canMove={canMove}
                          canMoveBackward={canMoveBackward}
                          isDragging={isDragging}
                          onRequestMove={requestMove}
                        />
                      )}
                    </DraggableCard>
                  ))}
                  {cards.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-tertiary-400">Drop here</p>
                  )}
                </DroppableColumn>
              </section>
            );
          })}
        </div>
        <DragOverlay>
          {activeDrag ? (
            <div className="w-60 rounded-lg border border-primary-200 bg-white p-2.5 shadow-lg">
              <div className="text-sm font-semibold text-tertiary-900">
                {activeDrag.profile?.name || 'Candidate'}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <SubmissionStageDrawer
        submission={stageTarget}
        open={Boolean(stageTarget)}
        preferredToStage={preferredToStage}
        canMoveBackward={canMoveBackward}
        saving={moving}
        onClose={() => {
          setStageTarget(null);
          setPreferredToStage('');
        }}
        onMove={moveStage}
      />

      {canOverride && (
        <SubmissionStageOverrideDrawer
          submission={overrideTarget?.submission}
          preferredToStage={overrideTarget?.toStage || ''}
          open={Boolean(overrideTarget)}
          saving={moving}
          onClose={() => setOverrideTarget(null)}
          onMove={applyOverride}
        />
      )}

      <Drawer open={createOpen} title="Put a candidate forward" onClose={() => setCreateOpen(false)} size="xl" tone="create">
        {createOpen && (
          <SubmissionCreatePage
            asPanel
            onCancel={() => setCreateOpen(false)}
            onDone={() => {
              setCreateOpen(false);
              reload();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
