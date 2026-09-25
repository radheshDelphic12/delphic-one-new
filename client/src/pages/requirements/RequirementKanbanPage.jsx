import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import Breadcrumbs from '../../components/ui/Breadcrumbs.jsx';
import CardActionsMenu from '../../components/ui/CardActionsMenu.jsx';
import OpenInNewTabButton from '../../components/OpenInNewTabButton.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import ProgressRing from '../../components/ui/ProgressRing.jsx';
import {
  SUBMISSION_PIPELINE,
  canMoveSubmissionBackward,
  canMoveSubmissionStage,
  canOverrideSubmissionStage,
  isBackwardTransition,
  nextSubmissionStages,
  requiresBackoutReason,
  requiresRejectionReason,
} from '../../lib/submissionStages.js';
import SubmissionStageOverrideDrawer from '../submissions/SubmissionStageOverrideDrawer.jsx';
import { formatStageLabel } from '../pipeline/pipelineBoardUtils.js';
import {
  DndContext,
  DragOverlay,
  DroppableColumn,
  DraggableCard,
  usePipelineSensors,
} from '../pipeline/pipelineDnd.jsx';

const BOARD_COLUMNS = [...SUBMISSION_PIPELINE, 'backout', 'rejected'];

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-tertiary-200 px-2.5 py-1.5 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100';

function needsReason(toStage, fromStage) {
  return (
    requiresBackoutReason(toStage) ||
    requiresRejectionReason(toStage) ||
    (fromStage ? isBackwardTransition(fromStage, toStage) : false)
  );
}

function StageReasonDrawer({ submission, toStage, open, saving, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const backward = submission && toStage ? isBackwardTransition(submission.stage, toStage) : false;
  const reactivate =
    backward && submission && (submission.stage === 'rejected' || submission.stage === 'backout');

  useEffect(() => {
    if (open) setReason('');
  }, [open, submission?.id, toStage]);

  if (!submission || !toStage) return null;

  return (
    <Drawer
      open={open}
      title={
        reactivate
          ? 'Reactivate candidate'
          : backward
            ? `Move back to ${formatStageLabel(toStage)}`
            : `Move to ${formatStageLabel(toStage)}`
      }
      onClose={() => !saving && onClose()}
      size="sm"
      tone="edit"
      footer={
        <>
          <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={saving || !reason.trim()}
            onClick={() => onConfirm(reason.trim())}
          >
            {saving ? 'Moving…' : 'Confirm'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
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
      </div>
    </Drawer>
  );
}

function KanbanCard({ submission, canMove, canMoveBackward, busy, isDragging, onMoveStage }) {
  const next = nextSubmissionStages(submission.stage).filter(
    (to) => canMoveBackward || !isBackwardTransition(submission.stage, to)
  );
  const actions = [
    { key: 'open', label: 'Open submission', to: `/submissions/${submission.id}` },
    ...(canMove && !submission.is_locked
      ? next.map((to) => ({
          key: `move-${to}`,
          label: isBackwardTransition(submission.stage, to)
            ? (submission.stage === 'rejected' || submission.stage === 'backout'
              ? 'Reactivate candidate'
              : `Move back to ${formatStageLabel(to)}`)
            : `Move to ${formatStageLabel(to)}`,
          danger: to === 'backout' || to === 'rejected',
          disabled: busy,
          onClick: () => onMoveStage(submission, to),
        }))
      : []),
  ];

  return (
    <div
      className={`rounded-md border bg-white p-2 shadow-sm ${isDragging ? 'opacity-40 ring-2 ring-primary-300' : ''}`}
    >
      <div className="flex items-start justify-between gap-1">
        <Link
          to={`/submissions/${submission.id}`}
          className="min-w-0 flex-1 text-left text-sm font-medium text-primary-700 hover:underline"
        >
          {submission.profile?.name || 'Candidate'}
        </Link>
        <CardActionsMenu items={actions} label={`Actions for ${submission.profile?.name || 'candidate'}`} />
      </div>
      <p className="mt-0.5 text-[11px] text-tertiary-500">
        {submission.seat?.seat_label || 'Seat'}
        {submission.margin != null ? ` · margin ${submission.margin}` : ''}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Badge value={submission.stage} />
        <ProgressRing percent={submission.progress?.percent ?? null} size="sm" />
      </div>
    </div>
  );
}

export default function RequirementKanbanPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const sensors = usePipelineSensors();
  const [requirement, setRequirement] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [reasonModal, setReasonModal] = useState(null);
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [activeDrag, setActiveDrag] = useState(null);
  const [overId, setOverId] = useState(null);

  const canMove = canMoveSubmissionStage(user);
  const canMoveBackward = canMoveSubmissionBackward(user);
  const canOverride = canOverrideSubmissionStage(user);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, subsRes] = await Promise.all([
        apiClient.get(`/requirements/${id}`),
        apiClient.get('/submissions', { params: { requirement_id: id, limit: 100 } }),
      ]);
      setRequirement(reqRes.data.data);
      setSubmissions(subsRes.data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load board'), 'Something went wrong');
      setRequirement(null);
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, [id, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  const byStage = useMemo(() => {
    const map = Object.fromEntries(BOARD_COLUMNS.map((s) => [s, []]));
    for (const sub of submissions) {
      const key = map[sub.stage] ? sub.stage : 'sourced';
      map[key].push(sub);
    }
    return map;
  }, [submissions]);

  async function postMove(submission, to_stage, reasonText) {
    setBusyId(submission.id);
    try {
      const body = { to_stage };
      if (requiresBackoutReason(to_stage)) body.backout_reason = reasonText?.trim();
      if (requiresRejectionReason(to_stage)) body.rejection_reason = reasonText?.trim();
      if (isBackwardTransition(submission.stage, to_stage)) body.reason = reasonText?.trim();
      await apiClient.post(`/submissions/${submission.id}/stage`, body);
      setReasonModal(null);
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Stage move failed'), 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  }

  async function applyOverride(body) {
    if (!overrideTarget) return;
    setBusyId(overrideTarget.submission.id);
    try {
      await apiClient.post(`/submissions/${overrideTarget.submission.id}/stage/override`, body);
      setOverrideTarget(null);
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Stage override failed'), 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  }

  function requestMove(submission, to_stage) {
    if ((!canMove || submission.is_locked) && !canOverride) return;
    const allowed = nextSubmissionStages(submission.stage);
    if (!allowed.includes(to_stage)) {
      if (canOverride) {
        setOverrideTarget({ submission, to_stage });
        return;
      }
      pushError(`Cannot move from ${formatStageLabel(submission.stage)} to ${formatStageLabel(to_stage)}`, 'Validation');
      return;
    }
    if (submission.is_locked) return;
    const backward = isBackwardTransition(submission.stage, to_stage);
    if (backward && !canMoveBackward) {
      pushError(`Cannot move from ${formatStageLabel(submission.stage)} to ${formatStageLabel(to_stage)}`, 'Validation');
      return;
    }
    if (needsReason(to_stage, submission.stage)) {
      setReasonModal({ submission, to_stage });
      return;
    }
    postMove(submission, to_stage);
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

  if (loading) return <div className="text-sm text-tertiary-500">Loading board…</div>;
  if (!requirement) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-tertiary-600">Board could not be loaded.</p>
        <Link to="/requirements" className="text-sm text-primary-600 hover:underline">
          ← Requirements
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Breadcrumbs
            items={[
              { label: 'Requirements', to: '/requirements' },
              { label: requirement.title, to: `/requirements/${id}` },
              { label: 'Pipeline board' },
            ]}
          />
          <h1 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Pipeline board</h1>
          <p className="mt-1 text-sm text-tertiary-500">
            {requirement.account?.name || '—'} · {submissions.length} candidate(s)
            {canMove ? ' · Drag cards or use the ⋯ menu' : ' · View only'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/requirements/${id}`} className="btn-secondary">
            Job detail
          </Link>
          <OpenInNewTabButton />
          <button type="button" className="btn-secondary" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

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
        <div className="flex gap-3 overflow-x-auto pb-4">
          {BOARD_COLUMNS.map((stage) => (
            <div key={stage} className="flex w-64 shrink-0 flex-col rounded-lg border bg-tertiary-50/80">
              <div className="flex items-center justify-between border-b bg-white px-3 py-2">
                <span className="text-xs font-semibold capitalize text-tertiary-800">
                  {formatStageLabel(stage)}
                </span>
                <span className="rounded-full bg-tertiary-100 px-2 py-0.5 text-[10px] text-tertiary-600">
                  {byStage[stage].length}
                </span>
              </div>
              <DroppableColumn id={stage} isOver={overId === stage}>
                {byStage[stage].map((sub) => (
                  <DraggableCard
                    key={sub.id}
                    id={sub.id}
                    disabled={!canMove || sub.is_locked || busyId === sub.id}
                    data={{ submission: sub, stage: sub.stage }}
                  >
                    {({ isDragging }) => (
                      <KanbanCard
                        submission={sub}
                        canMove={canMove}
                        canMoveBackward={canMoveBackward}
                        busy={busyId === sub.id}
                        isDragging={isDragging}
                        onMoveStage={requestMove}
                      />
                    )}
                  </DraggableCard>
                ))}
                {byStage[stage].length === 0 && (
                  <p className="px-1 py-4 text-center text-[11px] text-tertiary-400">Drop here</p>
                )}
              </DroppableColumn>
            </div>
          ))}
        </div>
        <DragOverlay>
          {activeDrag ? (
            <div className="w-60 rounded-md border border-primary-200 bg-white p-2 shadow-lg">
              <div className="text-sm font-medium text-tertiary-900">
                {activeDrag.profile?.name || 'Candidate'}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <StageReasonDrawer
        submission={reasonModal?.submission}
        toStage={reasonModal?.to_stage}
        open={Boolean(reasonModal)}
        saving={busyId === reasonModal?.submission?.id}
        onClose={() => setReasonModal(null)}
        onConfirm={(reason) => postMove(reasonModal.submission, reasonModal.to_stage, reason)}
      />

      {canOverride && (
        <SubmissionStageOverrideDrawer
          submission={overrideTarget?.submission}
          preferredToStage={overrideTarget?.to_stage || ''}
          open={Boolean(overrideTarget)}
          saving={busyId === overrideTarget?.submission?.id}
          onClose={() => setOverrideTarget(null)}
          onMove={applyOverride}
        />
      )}
    </div>
  );
}
