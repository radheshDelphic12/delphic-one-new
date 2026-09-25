import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { accountAccent } from '../../lib/accountAccent.js';
import { BOARD_COLUMNS, groupBoard, stageColumnStats } from '../../lib/accountBoard.js';
import {
  canCreateSubmission,
  canMoveSubmissionBackward,
  canMoveSubmissionStage,
  canOverrideSubmissionStage,
  isBackwardTransition,
  nextSubmissionStages,
  requiresBackoutReason,
  requiresRejectionReason,
  SUBMISSION_STAGE_TRANSITIONS,
} from '../../lib/submissionStages.js';
import SubmissionStageOverrideDrawer from '../submissions/SubmissionStageOverrideDrawer.jsx';
import { canCreateRequirement } from '../../lib/requirementStages.js';
import Badge from '../../components/ui/Badge.jsx';
import Breadcrumbs from '../../components/ui/Breadcrumbs.jsx';
import OpenInNewTabButton from '../../components/OpenInNewTabButton.jsx';
import CardActionsMenu from '../../components/ui/CardActionsMenu.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import ProgressRing from '../../components/ui/ProgressRing.jsx';
import Modal from '../../components/ui/Modal.jsx';
import UnlockButton from '../../components/UnlockButton.jsx';
import AccountFormPage from './AccountFormPage.jsx';
import AccountStageMoveDrawer from './AccountStageMoveDrawer.jsx';
import RequirementFormPage from '../requirements/RequirementFormPage.jsx';
import ProfileFormPage from '../profiles/ProfileFormPage.jsx';
import SubmissionCreatePage from '../submissions/SubmissionCreatePage.jsx';
import { canCreateProfile } from '../profiles/profileUtils.js';
import {
  ACCOUNT_TRANSITIONS,
  accountKey,
  apiErrorMessage,
  canMutateAccount,
} from './accountUtils.js';
import { userCan } from '../../lib/permissions.js';

const STAGE_HEADER_COLORS = {
  sourced: 'bg-slate-100 text-slate-700',
  internal_screening: 'bg-indigo-50 text-indigo-700',
  submitted_to_client: 'bg-blue-50 text-blue-700',
  interview_scheduled: 'bg-violet-50 text-violet-700',
  interview_result: 'bg-fuchsia-50 text-fuchsia-700',
  offer: 'bg-purple-50 text-purple-700',
  bgv: 'bg-cyan-50 text-cyan-700',
  closed: 'bg-green-50 text-green-700',
  backout: 'bg-orange-50 text-orange-700',
  rejected: 'bg-red-50 text-red-700',
};

function SubmissionCard({ submission, canMove, canMoveBackward, busy, onMoveStage, isDragging }) {
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
              : `Move back to ${to.replace(/_/g, ' ')}`)
            : `Move to ${to.replace(/_/g, ' ')}`,
          danger: to === 'backout' || to === 'rejected',
          disabled: busy,
          onClick: () => onMoveStage(submission, to),
        }))
      : []),
  ];

  return (
    <div
      className={`rounded-md border bg-white p-2 shadow-sm ${isDragging ? 'opacity-40 ring-2 ring-primary-300' : ''} ${
        canMove && !submission.is_locked ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
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

function DraggableCard({ submission, canMove, canMoveBackward, busy, onMoveStage }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: submission.id,
    disabled: !canMove || submission.is_locked,
    data: {
      submission,
      requirementId: submission.requirement?.id || submission.seat?.requirement_id,
      stage: submission.stage,
    },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}>
      <SubmissionCard
        submission={submission}
        canMove={canMove}
        canMoveBackward={canMoveBackward}
        busy={busy}
        onMoveStage={onMoveStage}
        isDragging={isDragging}
      />
    </div>
  );
}

function DroppableCell({ requirementId, stage, children, isOver }) {
  const { setNodeRef } = useDroppable({
    id: `${requirementId}::${stage}`,
    data: { requirementId, stage },
  });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[88px] space-y-2 border-b border-r border-tertiary-100 p-2 ${
        isOver ? 'bg-primary-50/70 ring-1 ring-inset ring-primary-200' : 'bg-white'
      }`}
    >
      {children}
    </div>
  );
}

export default function AccountPipelineBoardPage() {
  const { id, accountId: accountIdParam } = useParams();
  const accountId = accountIdParam || id;
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [account, setAccount] = useState(null);
  const [requirements, setRequirements] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [stageModal, setStageModal] = useState(null);
  const [stageReason, setStageReason] = useState('');
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [activeDrag, setActiveDrag] = useState(null);
  const [overId, setOverId] = useState(null);
  const [isAccountStageOpen, setIsAccountStageOpen] = useState(false);
  const [movingAccountStage, setMovingAccountStage] = useState(false);
  const [editOpen, setEditOpen] = useState(searchParams.get('edit') === '1');
  const [createReqOpen, setCreateReqOpen] = useState(false);
  const [createProfileOpen, setCreateProfileOpen] = useState(false);
  const [submitForReqId, setSubmitForReqId] = useState(null);

  const canMoveSubs = canMoveSubmissionStage(user);
  const canMoveSubsBackward = canMoveSubmissionBackward(user);
  const canOverrideSubs = canOverrideSubmissionStage(user);
  const canSubmit = canCreateSubmission(user);
  const canAddRequirement = canCreateRequirement(user);
  const canAddProfile = canCreateProfile(user);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountRes, reqRes, subRes] = await Promise.all([
        apiClient.get(`/accounts/${accountId}`),
        apiClient.get('/requirements', { params: { account_id: accountId, limit: 100 } }),
        apiClient.get('/submissions', { params: { account_id: accountId, limit: 100 } }),
      ]);
      setAccount(accountRes.data.data);
      setRequirements(reqRes.data.data || []);
      setSubmissions(subRes.data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load pipeline board'), 'Something went wrong');
      setAccount(null);
      setRequirements([]);
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get('edit') === '1') setEditOpen(true);
  }, [searchParams]);

  function closeEdit() {
    setEditOpen(false);
    if (searchParams.get('edit')) {
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
  }

  const { rows } = useMemo(() => groupBoard(requirements, submissions), [requirements, submissions]);
  const columnStats = useMemo(() => stageColumnStats(rows), [rows]);

  async function postStageMove(submission, to_stage, reasonText) {
    setBusyId(submission.id);
    try {
      const body = { to_stage };
      if (requiresBackoutReason(to_stage)) body.backout_reason = reasonText?.trim();
      if (requiresRejectionReason(to_stage)) body.rejection_reason = reasonText?.trim();
      if (isBackwardTransition(submission.stage, to_stage)) body.reason = reasonText?.trim();
      await apiClient.post(`/submissions/${submission.id}/stage`, body);
      setStageModal(null);
      setStageReason('');
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Stage move failed'), 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  }

  async function applyStageOverride(body) {
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

  function requestStageMove(submission, to_stage) {
    if ((!canMoveSubs || submission.is_locked) && !canOverrideSubs) return;
    const allowed = SUBMISSION_STAGE_TRANSITIONS[submission.stage] || [];
    if (!allowed.includes(to_stage)) {
      if (canOverrideSubs) {
        setOverrideTarget({ submission, to_stage });
        return;
      }
      pushError(`Cannot move from ${submission.stage.replace(/_/g, ' ')} to ${to_stage.replace(/_/g, ' ')}`, 'Validation');
      return;
    }
    if (submission.is_locked) return;
    const backward = isBackwardTransition(submission.stage, to_stage);
    if (backward && !canMoveSubsBackward) {
      pushError(`Cannot move from ${submission.stage.replace(/_/g, ' ')} to ${to_stage.replace(/_/g, ' ')}`, 'Validation');
      return;
    }
    if (requiresBackoutReason(to_stage) || requiresRejectionReason(to_stage) || backward) {
      setStageReason('');
      setStageModal({ submission, to_stage });
      return;
    }
    postStageMove(submission, to_stage);
  }

  async function confirmStageModal() {
    if (!stageModal) return;
    const { submission, to_stage } = stageModal;
    const needsReason =
      requiresBackoutReason(to_stage) ||
      requiresRejectionReason(to_stage) ||
      isBackwardTransition(submission.stage, to_stage);
    if (needsReason && !stageReason.trim()) return;
    await postStageMove(submission, to_stage, stageReason);
  }

  async function moveAccountStage(body) {
    setMovingAccountStage(true);
    try {
      await apiClient.post(`/accounts/${accountId}/stage`, body);
      setIsAccountStageOpen(false);
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to move account stage'), 'Something went wrong');
    } finally {
      setMovingAccountStage(false);
    }
  }

  function handleDragStart(event) {
    setActiveDrag(event.active.data.current?.submission || null);
  }

  function handleDragOver(event) {
    setOverId(event.over?.id || null);
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveDrag(null);
    setOverId(null);
    if (!over || !active) return;

    const submission = active.data.current?.submission;
    const fromReqId = active.data.current?.requirementId;
    const [toReqId, toStage] = String(over.id).split('::');
    if (!submission || !toReqId || !toStage) return;
    if (fromReqId !== toReqId) {
      pushError('Candidates can only move between stages on the same requirement.', 'Validation');
      return;
    }
    if (submission.stage === toStage) return;
    requestStageMove(submission, toStage);
  }

  if (loading) return <div className="text-sm text-tertiary-500">Loading pipeline board…</div>;

  if (!account) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-tertiary-600">Pipeline board could not be loaded.</p>
        <Link to="/pipeline" className="text-sm text-primary-600 hover:underline">← Pipeline</Link>
      </div>
    );
  }

  const canMutate = canMutateAccount(account, user);
  const canUnlock = userCan(user, 'unlockAccount');
  const nextAccountStages = ACCOUNT_TRANSITIONS[account.stage] || [];
  const accent = accountAccent(account.id);
  const isVendor = account.type === 'vendor';
  const canCreateReqHere =
    canAddRequirement && !isVendor && account.stage === 'active' && !account.is_locked;

  return (
    <div className="space-y-4">
      <div className={`border-b border-tertiary-200 border-l-4 pb-3 pl-3 ${accent.border}`}>
        <Breadcrumbs
          items={[
            { label: 'Pipeline', to: '/pipeline' },
            { label: accountKey(account.id) },
          ]}
        />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium tracking-tight text-primary-700">{accountKey(account.id)}</span>
              <Badge value={account.stage} />
              {account.is_locked && (
                <span className="rounded-md bg-danger-50 px-2 py-0.5 text-xs font-medium text-danger-700">Locked</span>
              )}
            </div>
            <h1 className="mt-0.5 font-heading text-xl font-semibold tracking-tight text-tertiary-900">
              {account.name} · Pipeline board
            </h1>
            <p className="mt-0.5 text-sm text-tertiary-500">
              {requirements.length} requirement(s) · {submissions.length} candidate(s)
              {!canMoveSubs ? ' · View only for stage moves' : ' · Drag cards or use the ⋯ menu'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/pipeline" className="btn-secondary">All accounts</Link>
            <Link to={`/accounts/${accountId}`} className="btn-secondary">Account detail</Link>
            <OpenInNewTabButton />
            <button type="button" className="btn-secondary" onClick={load}>Refresh</button>
            {canCreateReqHere && (
              <button type="button" className="btn-secondary" onClick={() => setCreateReqOpen(true)}>
                <Plus className="h-4 w-4" /> New requirement
              </button>
            )}
            {canAddProfile && (
              <button type="button" className="btn-secondary" onClick={() => setCreateProfileOpen(true)}>
                <Plus className="h-4 w-4" /> New profile
              </button>
            )}
            {canSubmit && requirements.length > 0 && (
              <button type="button" className="btn-primary" onClick={() => setSubmitForReqId('')}>
                Submit candidate
              </button>
            )}
            {canMutate && !account.is_locked && (
              <button type="button" className="btn-secondary" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit account
              </button>
            )}
            {canMutate && !account.is_locked && nextAccountStages.length > 0 && (
              <button type="button" className="btn-primary" onClick={() => setIsAccountStageOpen(true)}>
                Move account stage
              </button>
            )}
            {canUnlock && account.is_locked && (
              <UnlockButton entityType="account" entityId={account.id} onUnlocked={load} />
            )}
          </div>
        </div>
      </div>

      {isVendor && requirements.length === 0 && (
        <div className="rounded-xl border border-tertiary-200 bg-white px-4 py-8 text-center">
          <p className="font-heading text-sm font-semibold text-tertiary-900">Vendors supply candidate profiles</p>
          <p className="mt-1 text-sm text-tertiary-500">
            This account has no requirements. Pipeline boards apply to client accounts with open jobs.
          </p>
          {canAddProfile && (
            <button type="button" className="btn-primary mt-4 inline-flex" onClick={() => setCreateProfileOpen(true)}>
              <Plus className="h-4 w-4" /> New profile
            </button>
          )}
        </div>
      )}

      {!isVendor && requirements.length === 0 && (
        <div className="rounded-xl border border-tertiary-200 bg-white px-4 py-8 text-center">
          <p className="font-heading text-sm font-semibold text-tertiary-900">No requirements yet</p>
          <p className="mt-1 text-sm text-tertiary-500">
            {canCreateReqHere
              ? 'Create a requirement for this client to start tracking candidates on the board.'
              : account.stage !== 'active'
                ? 'Requirements can only be created on active client accounts.'
                : canAddRequirement
                  ? 'This account is locked; unlock it before creating requirements.'
                  : 'Only sales or admin can create requirements.'}
          </p>
          {canCreateReqHere && (
            <button type="button" className="btn-primary mt-4 inline-flex" onClick={() => setCreateReqOpen(true)}>
              <Plus className="h-4 w-4" /> New requirement
            </button>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveDrag(null);
            setOverId(null);
          }}
        >
          <div className="overflow-auto rounded-xl border border-tertiary-200 bg-tertiary-50/40">
            <div
              className="inline-grid min-w-full"
              style={{
                gridTemplateColumns: `minmax(200px, 220px) repeat(${BOARD_COLUMNS.length}, minmax(200px, 1fr))`,
              }}
            >
              <div className="sticky left-0 top-0 z-30 border-b border-r border-tertiary-200 bg-white px-3 py-2 text-xs font-semibold text-tertiary-600">
                Requirement
              </div>
              {BOARD_COLUMNS.map((stage) => (
                <div
                  key={stage}
                  className={`sticky top-0 z-20 border-b border-r border-tertiary-200 px-3 py-2 ${STAGE_HEADER_COLORS[stage] || 'bg-tertiary-50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold capitalize">{stage.replace(/_/g, ' ')}</span>
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-tertiary-600">
                      {columnStats[stage] || 0}
                    </span>
                  </div>
                </div>
              ))}

              {rows.map((row) => {
                const req = row.requirement;
                return (
                  <div key={req.id} className="contents">
                    <div className="sticky left-0 z-10 border-b border-r border-tertiary-200 bg-white p-3">
                      <Link
                        to={`/requirements/${req.id}`}
                        className="text-sm font-semibold text-primary-700 hover:underline"
                      >
                        {req.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge value={req.status || 'open'} />
                        {req.seats_total != null && (
                          <span className="text-[11px] text-tertiary-500">{req.seats_total} seat(s)</span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Link to={`/requirements/${req.id}/board`} className="text-[11px] text-primary-600 hover:underline">
                          Job board
                        </Link>
                        {canSubmit && (
                          <button
                            type="button"
                            className="text-[11px] text-primary-600 hover:underline"
                            onClick={() => setSubmitForReqId(req.id)}
                          >
                            Submit candidate
                          </button>
                        )}
                      </div>
                    </div>
                    {BOARD_COLUMNS.map((stage) => {
                      const dropId = `${req.id}::${stage}`;
                      const cards = row.cells[stage] || [];
                      return (
                        <DroppableCell
                          key={dropId}
                          requirementId={req.id}
                          stage={stage}
                          isOver={overId === dropId}
                        >
                          {cards.map((sub) => (
                            <DraggableCard
                              key={sub.id}
                              submission={sub}
                              canMove={canMoveSubs}
                              canMoveBackward={canMoveSubsBackward}
                              busy={busyId === sub.id}
                              onMoveStage={requestStageMove}
                            />
                          ))}
                          {cards.length === 0 && (
                            <p className="px-1 py-3 text-center text-[11px] text-tertiary-300">—</p>
                          )}
                        </DroppableCell>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          <DragOverlay>
            {activeDrag ? (
              <div className="w-52 rotate-1 shadow-lg">
                <SubmissionCard
                  submission={activeDrag}
                  canMove={false}
                  busy={false}
                  onMoveStage={() => {}}
                  isDragging
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <Modal
        open={Boolean(stageModal)}
        title={
          stageModal && isBackwardTransition(stageModal.submission.stage, stageModal.to_stage)
            ? (stageModal.submission.stage === 'rejected' || stageModal.submission.stage === 'backout'
              ? 'Reactivate candidate'
              : `Move back to ${stageModal.to_stage.replace(/_/g, ' ')}`)
            : `Move to ${stageModal?.to_stage?.replace(/_/g, ' ') || ''}`
        }
        onClose={() => !busyId && setStageModal(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={Boolean(busyId)} onClick={() => setStageModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={
                requiresBackoutReason(stageModal?.to_stage) || requiresRejectionReason(stageModal?.to_stage)
                  ? 'btn-danger'
                  : 'btn-primary'
              }
              disabled={
                Boolean(busyId)
                || ((requiresBackoutReason(stageModal?.to_stage)
                  || requiresRejectionReason(stageModal?.to_stage)
                  || (stageModal && isBackwardTransition(stageModal.submission.stage, stageModal.to_stage)))
                  && !stageReason.trim())
              }
              onClick={confirmStageModal}
            >
              Confirm
            </button>
          </>
        }
      >
        {(requiresBackoutReason(stageModal?.to_stage)
          || requiresRejectionReason(stageModal?.to_stage)
          || (stageModal && isBackwardTransition(stageModal.submission.stage, stageModal.to_stage))) ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-500">
              {requiresBackoutReason(stageModal?.to_stage)
                ? 'Backout reason *'
                : requiresRejectionReason(stageModal?.to_stage)
                  ? 'Rejection reason *'
                  : 'Reason *'}
            </label>
            <textarea
              rows={3}
              value={stageReason}
              onChange={(event) => setStageReason(event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
            />
          </div>
        ) : (
          <p className="text-tertiary-600">
            Confirm moving this submission to {stageModal?.to_stage?.replace(/_/g, ' ')}.
          </p>
        )}
      </Modal>

      {account && (
        <AccountStageMoveDrawer
          account={account}
          open={isAccountStageOpen}
          saving={movingAccountStage}
          onClose={() => setIsAccountStageOpen(false)}
          onMove={moveAccountStage}
        />
      )}

      {canOverrideSubs && (
        <SubmissionStageOverrideDrawer
          submission={overrideTarget?.submission}
          preferredToStage={overrideTarget?.to_stage || ''}
          open={Boolean(overrideTarget)}
          saving={busyId === overrideTarget?.submission?.id}
          onClose={() => setOverrideTarget(null)}
          onMove={applyStageOverride}
        />
      )}

      <Drawer open={editOpen} title="Edit account" onClose={closeEdit} size="xl" tone="edit">
        {editOpen && (
          <AccountFormPage
            asPanel
            accountId={accountId}
            onCancel={closeEdit}
            onDone={() => {
              closeEdit();
              load();
            }}
          />
        )}
      </Drawer>

      <Drawer
        open={createReqOpen}
        title="New requirement"
        onClose={() => setCreateReqOpen(false)}
        size="xl"
        tone="create"
      >
        {createReqOpen && (
          <RequirementFormPage
            asPanel
            initialAccountId={accountId}
            onCancel={() => setCreateReqOpen(false)}
            onDone={() => {
              setCreateReqOpen(false);
              load();
            }}
          />
        )}
      </Drawer>

      <Drawer
        open={createProfileOpen}
        title="New candidate profile"
        onClose={() => setCreateProfileOpen(false)}
        size="xl"
        tone="create"
      >
        {createProfileOpen && (
          <ProfileFormPage
            asPanel
            onCancel={() => setCreateProfileOpen(false)}
            onDone={() => {
              setCreateProfileOpen(false);
              load();
            }}
          />
        )}
      </Drawer>

      <Drawer
        open={submitForReqId !== null}
        title="Submit candidate"
        onClose={() => setSubmitForReqId(null)}
        size="xl"
        tone="create"
      >
        {submitForReqId !== null && (
          <SubmissionCreatePage
            asPanel
            accountId={accountId}
            initialRequirementId={submitForReqId || undefined}
            onCancel={() => setSubmitForReqId(null)}
            onDone={() => {
              setSubmitForReqId(null);
              load();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
