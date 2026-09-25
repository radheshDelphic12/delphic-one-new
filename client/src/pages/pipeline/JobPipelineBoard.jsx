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
import {
  canCreateRequirement,
  canMutateRequirement,
  canOverrideRequirementStatus,
  nextRequirementStatuses,
  requiresDropReason,
} from '../../lib/requirementStages.js';
import RequirementFormPage from '../requirements/RequirementFormPage.jsx';
import RequirementStatusOverrideDrawer from '../requirements/RequirementStatusOverrideDrawer.jsx';
import { JOB_COLUMNS, formatStageLabel, shortKey } from './pipelineBoardUtils.js';
import { DndContext, DragOverlay, DroppableColumn, DraggableCard, usePipelineSensors } from './pipelineDnd.jsx';
import { usePipelineBoard } from './usePipelineBoard.js';
import PipelineFilters from './PipelineFilters.jsx';

const JOB_FILTER_FIELDS = ['search', 'account_id', 'sales_id', 'recruiter_id', 'status', 'priority'];

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-tertiary-200 px-2.5 py-1.5 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100';

function RequirementStatusDrawer({ requirement, open, saving, preferredToStatus, onClose, onMove }) {
  const statuses = nextRequirementStatuses(requirement?.status);
  const [toStatus, setToStatus] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    const preferred =
      preferredToStatus && statuses.includes(preferredToStatus) ? preferredToStatus : statuses[0] || '';
    setToStatus(preferred);
    setReason('');
  }, [open, requirement?.id, requirement?.status, preferredToStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(event) {
    event.preventDefault();
    const body = { to_status: toStatus };
    if (requiresDropReason(toStatus)) body.reason = reason.trim();
    onMove(body);
  }

  if (!requirement) return null;

  return (
    <Drawer
      open={open}
      title="Move requirement status"
      onClose={() => !saving && onClose()}
      size="sm"
      tone="edit"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" form="job-status-form" disabled={saving || !toStatus} className="btn-primary">
            {saving ? 'Moving…' : 'Move status'}
          </button>
        </>
      }
    >
      <form id="job-status-form" onSubmit={submit} className="space-y-3">
        <p className="text-xs text-tertiary-500">Current status: {formatStageLabel(requirement.status)}</p>
        <label className="block text-xs font-medium text-tertiary-600">
          Next status
          <select
            required
            value={toStatus}
            onChange={(event) => setToStatus(event.target.value)}
            className={`${INPUT_CLASS} capitalize`}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {formatStageLabel(status)}
              </option>
            ))}
          </select>
        </label>
        {requiresDropReason(toStatus) && (
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

function JobCard({
  requirement,
  user,
  canOverride,
  isDragging,
  onRequestMove,
  onRequestOverride,
  onToggleExpand,
  expanded,
  previews,
  loadingPreviews,
}) {
  const canMove =
    canMutateRequirement(requirement, user) &&
    !requirement.is_locked &&
    nextRequirementStatuses(requirement.status).length > 0;
  const next = nextRequirementStatuses(requirement.status);

  const actions = [
    { key: 'detail', label: 'Open requirement', to: `/requirements/${requirement.id}` },
    { key: 'board', label: 'Open job board', to: `/requirements/${requirement.id}/board` },
    {
      key: 'candidates',
      label: expanded ? 'Hide candidates' : 'Show candidates',
      onClick: () => onToggleExpand(requirement),
    },
    ...(canMove
      ? next.map((status) => ({
          key: `move-${status}`,
          label: `Move to ${formatStageLabel(status)}`,
          danger: status === 'dropped',
          onClick: () => onRequestMove(requirement, status),
        }))
      : []),
    ...(canOverride
      ? [{ key: 'override', label: 'Override status…', onClick: () => onRequestOverride(requirement) }]
      : []),
  ];

  return (
    <li
      className={`list-none rounded-lg border border-tertiary-200 bg-white p-2.5 shadow-sm ${
        isDragging ? 'opacity-40 ring-2 ring-primary-300' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <Link to={`/requirements/${requirement.id}`} className="min-w-0 flex-1 text-left">
          <div className="font-mono text-[10px] text-primary-600">{shortKey('REQ', requirement.id)}</div>
          <div className="truncate text-sm font-semibold text-tertiary-900">{requirement.title}</div>
          <div className="mt-0.5 text-xs text-tertiary-500">
            {requirement.account?.name || '—'}
            {` · ${requirement.seats_closed ?? 0}/${requirement.seats_total ?? 0} seats`}
          </div>
        </Link>
        <CardActionsMenu items={actions} label={`Actions for ${requirement.title}`} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge value={requirement.status} />
        <Badge value={requirement.priority} />
      </div>
      {expanded && (
        <div className="mt-2 rounded-md border border-tertiary-100 bg-tertiary-50/60 px-2 py-1.5">
          {loadingPreviews ? (
            <p className="text-[11px] text-tertiary-400">Loading…</p>
          ) : (previews || []).length === 0 ? (
            <p className="text-[11px] text-tertiary-400">No submissions yet</p>
          ) : (
            <ul className="space-y-1">
              {(previews || []).slice(0, 8).map((sub) => (
                <li key={sub.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <Link
                    to={`/submissions/${sub.id}`}
                    className="truncate font-medium text-tertiary-800 hover:underline"
                  >
                    {sub.profile?.name || 'Candidate'}
                  </Link>
                  <div className="flex items-center gap-1.5">
                    <Badge value={sub.stage} />
                    <ProgressRing percent={sub.progress?.percent ?? null} size="sm" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Sales / admin job pipeline — requirements as cards in status columns.
 */
export default function JobPipelineBoard() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const sensors = usePipelineSensors();
  const [filterParams, setFilterParams] = useState({});
  const boardParams = useMemo(() => {
    const params = { sort_by: 'created_at', sort_order: 'desc' };
    if (filterParams.search) params.search = filterParams.search;
    if (filterParams.account_id) params.account_id = filterParams.account_id;
    if (filterParams.sales_id) params.sales_owner_id = filterParams.sales_id;
    if (filterParams.recruiter_id) params.recruiter_id = filterParams.recruiter_id;
    if (filterParams.status) {
      const statuses = String(filterParams.status).split(',').filter(Boolean);
      if (statuses.length === 1) params.status = statuses[0];
    }
    if (filterParams.priority) {
      const priorities = String(filterParams.priority).split(',').filter(Boolean);
      if (priorities.length === 1) params.priority = priorities[0];
    }
    return params;
  }, [filterParams]);
  const handleFiltersChange = useCallback((params) => setFilterParams(params), []);
  const { cells, loading, reload } = usePipelineBoard({
    path: '/requirements',
    params: boardParams,
    columns: JOB_COLUMNS,
    stageField: 'status',
  });
  const [statusTarget, setStatusTarget] = useState(null);
  const [preferredToStatus, setPreferredToStatus] = useState('');
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [preferredOverrideStatus, setPreferredOverrideStatus] = useState('');
  const [moving, setMoving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [previewsByReq, setPreviewsByReq] = useState({});
  const [loadingPreviews, setLoadingPreviews] = useState(false);
  const [activeDrag, setActiveDrag] = useState(null);
  const [overId, setOverId] = useState(null);
  const canCreate = canCreateRequirement(user);
  const canOverride = canOverrideRequirementStatus(user);

  async function toggleExpand(requirement) {
    if (expandedId === requirement.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(requirement.id);
    if (previewsByReq[requirement.id]) return;
    setLoadingPreviews(true);
    try {
      const { data } = await apiClient.get('/submissions', {
        params: { requirement_id: requirement.id, limit: 20 },
      });
      setPreviewsByReq((current) => ({ ...current, [requirement.id]: data.data || [] }));
    } catch {
      setPreviewsByReq((current) => ({ ...current, [requirement.id]: [] }));
    } finally {
      setLoadingPreviews(false);
    }
  }

  async function postDirectMove(requirement, toStatus) {
    setMoving(true);
    try {
      await apiClient.post(`/requirements/${requirement.id}/status`, { to_status: toStatus });
      reload();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to move status'), 'Something went wrong');
    } finally {
      setMoving(false);
    }
  }

  async function applyOverride(body) {
    if (!overrideTarget) return;
    setMoving(true);
    try {
      await apiClient.post(`/requirements/${overrideTarget.id}/status/override`, body);
      setOverrideTarget(null);
      setPreferredOverrideStatus('');
      reload();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Status override failed'), 'Something went wrong');
    } finally {
      setMoving(false);
    }
  }

  function requestOverride(requirement, toStatus = '') {
    setPreferredOverrideStatus(toStatus);
    setOverrideTarget(requirement);
  }

  function requestMove(requirement, toStatus) {
    const allowed = nextRequirementStatuses(requirement.status);
    if (!allowed.includes(toStatus)) {
      if (canOverride) {
        requestOverride(requirement, toStatus);
        return;
      }
      pushError(`Cannot move from ${formatStageLabel(requirement.status)} to ${formatStageLabel(toStatus)}`, 'Validation');
      return;
    }
    if (requiresDropReason(toStatus)) {
      setPreferredToStatus(toStatus);
      setStatusTarget(requirement);
      return;
    }
    postDirectMove(requirement, toStatus);
  }

  async function moveStatus(body) {
    if (!statusTarget) return;
    setMoving(true);
    try {
      await apiClient.post(`/requirements/${statusTarget.id}/status`, body);
      setStatusTarget(null);
      setPreferredToStatus('');
      reload();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to move status'), 'Something went wrong');
    } finally {
      setMoving(false);
    }
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveDrag(null);
    setOverId(null);
    if (!over || !active) return;
    const requirement = active.data.current?.requirement;
    const toStatus = String(over.id);
    if (!requirement || requirement.status === toStatus) return;
    requestMove(requirement, toStatus);
  }

  if (loading) return <div className="text-sm text-tertiary-500">Loading job pipeline…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-tertiary-900">Job pipeline</h2>
          <p className="mt-1 text-sm text-tertiary-500">
            Drag requirements between statuses, or use the ⋯ menu on a card.
          </p>
        </div>
        {canCreate && (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New requirement
          </button>
        )}
      </div>

      <PipelineFilters fields={JOB_FILTER_FIELDS} onChange={handleFiltersChange} />

      <DndContext
        sensors={sensors}
        onDragStart={(event) => setActiveDrag(event.active.data.current?.requirement || null)}
        onDragOver={(event) => setOverId(event.over?.id || null)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveDrag(null);
          setOverId(null);
        }}
      >
        <div className="flex gap-3 overflow-x-auto pb-2">
          {JOB_COLUMNS.map((status) => {
            const cards = cells[status] || [];
            return (
              <section
                key={status}
                className="flex w-72 shrink-0 flex-col rounded-xl border border-tertiary-200 bg-tertiary-50/40"
              >
                <header className="flex items-center justify-between border-b border-tertiary-100 px-3 py-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary-600">
                    {formatStageLabel(status)}
                  </h3>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-tertiary-700">
                    {cards.length}
                  </span>
                </header>
                <DroppableColumn id={status} isOver={overId === status} className="max-h-[calc(100vh-16rem)]">
                  {cards.map((requirement) => {
                    const canMove =
                      (canMutateRequirement(requirement, user) && !requirement.is_locked) || canOverride;
                    return (
                      <DraggableCard
                        key={requirement.id}
                        id={requirement.id}
                        disabled={!canMove || moving}
                        data={{ requirement, stage: requirement.status }}
                      >
                        {({ isDragging }) => (
                          <JobCard
                            requirement={requirement}
                            user={user}
                            canOverride={canOverride}
                            isDragging={isDragging}
                            onRequestMove={requestMove}
                            onRequestOverride={requestOverride}
                            onToggleExpand={toggleExpand}
                            expanded={expandedId === requirement.id}
                            previews={previewsByReq[requirement.id]}
                            loadingPreviews={loadingPreviews && expandedId === requirement.id}
                          />
                        )}
                      </DraggableCard>
                    );
                  })}
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
            <div className="w-64 rounded-lg border border-primary-200 bg-white p-2.5 shadow-lg">
              <div className="text-sm font-semibold text-tertiary-900">{activeDrag.title}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <RequirementStatusDrawer
        requirement={statusTarget}
        open={Boolean(statusTarget)}
        preferredToStatus={preferredToStatus}
        saving={moving}
        onClose={() => {
          setStatusTarget(null);
          setPreferredToStatus('');
        }}
        onMove={moveStatus}
      />

      {canOverride && (
        <RequirementStatusOverrideDrawer
          requirement={overrideTarget}
          open={Boolean(overrideTarget)}
          preferredToStatus={preferredOverrideStatus}
          saving={moving}
          onClose={() => {
            setOverrideTarget(null);
            setPreferredOverrideStatus('');
          }}
          onMove={applyOverride}
        />
      )}

      <Drawer open={createOpen} title="New requirement" onClose={() => setCreateOpen(false)} size="xl" tone="create">
        {createOpen && (
          <RequirementFormPage
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
