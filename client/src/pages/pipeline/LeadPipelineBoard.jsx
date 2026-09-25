import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import Badge from '../../components/ui/Badge.jsx';
import CardActionsMenu from '../../components/ui/CardActionsMenu.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import AccountFormPage from '../accounts/AccountFormPage.jsx';
import AccountStageMoveDrawer from '../accounts/AccountStageMoveDrawer.jsx';
import AccountStageOverrideDrawer from '../accounts/AccountStageOverrideDrawer.jsx';
import { accountAccent } from '../../lib/accountAccent.js';
import { apiErrorMessage, canCreateAccount, canMutateAccount, canOverrideStage, ACCOUNT_TRANSITIONS } from '../accounts/accountUtils.js';
import { LEAD_COLUMNS, formatStageLabel, shortKey } from './pipelineBoardUtils.js';
import { DndContext, DragOverlay, DroppableColumn, DraggableCard, usePipelineSensors } from './pipelineDnd.jsx';
import { usePipelineBoard } from './usePipelineBoard.js';
import PipelineFilters from './PipelineFilters.jsx';

const LEAD_FILTER_FIELDS = ['search', 'bda_id'];

function needsAccountStageForm(toStage) {
  return toStage === 'meeting_scheduled' || toStage === 'dropped';
}

function LeadCard({ account, user, isDragging, onRequestMove }) {
  const canMove =
    canMutateAccount(account, user) &&
    !account.is_locked &&
    (ACCOUNT_TRANSITIONS[account.stage] || []).length > 0;
  const accent = accountAccent(account.id);
  const next = ACCOUNT_TRANSITIONS[account.stage] || [];

  const actions = [
    { key: 'board', label: 'Open hiring board', to: `/pipeline/${account.id}` },
    { key: 'details', label: 'Account details', to: `/accounts/${account.id}` },
    ...(canMove
      ? next.map((stage) => ({
          key: `move-${stage}`,
          label: `Move to ${formatStageLabel(stage)}`,
          danger: stage === 'dropped',
          onClick: () => onRequestMove(account, stage),
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
        <Link to={`/pipeline/${account.id}`} className="min-w-0 flex-1 text-left">
          <div className="flex items-start gap-2">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${accent.dot}`} aria-hidden="true" />
            <div className="min-w-0">
              <div className="font-mono text-[10px] text-primary-600">{shortKey('ACC', account.id)}</div>
              <div className="truncate text-sm font-semibold text-tertiary-900">{account.name}</div>
              <div className="mt-0.5 text-xs text-tertiary-500">
                {account.owner?.name || '—'}
                {account.industry ? ` · ${account.industry}` : ''}
              </div>
            </div>
          </div>
        </Link>
        <CardActionsMenu items={actions} label={`Actions for ${account.name}`} />
      </div>
      <div className="mt-2">
        <Badge value={account.stage} />
      </div>
    </div>
  );
}

/**
 * BDA / admin lead pipeline — accounts as cards in account-stage columns.
 */
export default function LeadPipelineBoard() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const sensors = usePipelineSensors();
  const [filterParams, setFilterParams] = useState({});
  const boardParams = useMemo(
    () => ({
      type: 'client',
      // Leads that haven't been classified client/vendor yet live at type IS NULL —
      // that's every account still in the `lead` stage, so the lead board needs them.
      include_unclassified: 'true',
      sort_by: 'name',
      sort_order: 'asc',
      ...(filterParams.search ? { search: filterParams.search } : {}),
      ...(filterParams.bda_id ? { owner_id: filterParams.bda_id } : {}),
    }),
    [filterParams]
  );
  const handleFiltersChange = useCallback((params) => setFilterParams(params), []);
  const { cells, loading, reload } = usePipelineBoard({
    path: '/accounts',
    params: boardParams,
    columns: LEAD_COLUMNS,
    stageField: 'stage',
  });
  const [stageTarget, setStageTarget] = useState(null);
  const [preferredToStage, setPreferredToStage] = useState('');
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [moving, setMoving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState(null);
  const [overId, setOverId] = useState(null);
  const canCreate = canCreateAccount(user);
  const canOverride = canOverrideStage(user);

  async function postDirectMove(account, toStage) {
    setMoving(true);
    try {
      await apiClient.post(`/accounts/${account.id}/stage`, { to_stage: toStage });
      reload();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to move account stage'), 'Something went wrong');
    } finally {
      setMoving(false);
    }
  }

  async function applyOverride(body) {
    if (!overrideTarget) return;
    setMoving(true);
    try {
      await apiClient.post(`/accounts/${overrideTarget.id}/stage/override`, body);
      setOverrideTarget(null);
      reload();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Stage override failed'), 'Something went wrong');
    } finally {
      setMoving(false);
    }
  }

  function requestMove(account, toStage) {
    const allowed = ACCOUNT_TRANSITIONS[account.stage] || [];
    if (!allowed.includes(toStage)) {
      if (canOverride) {
        setPreferredToStage(toStage);
        setOverrideTarget(account);
        return;
      }
      pushError(`Cannot move from ${formatStageLabel(account.stage)} to ${formatStageLabel(toStage)}`, 'Validation');
      return;
    }
    if (needsAccountStageForm(toStage)) {
      setPreferredToStage(toStage);
      setStageTarget(account);
      return;
    }
    postDirectMove(account, toStage);
  }

  async function moveStage(body) {
    if (!stageTarget) return;
    setMoving(true);
    try {
      await apiClient.post(`/accounts/${stageTarget.id}/stage`, body);
      setStageTarget(null);
      setPreferredToStage('');
      reload();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to move account stage'), 'Something went wrong');
    } finally {
      setMoving(false);
    }
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveDrag(null);
    setOverId(null);
    if (!over || !active) return;
    const account = active.data.current?.account;
    const toStage = String(over.id);
    if (!account || account.stage === toStage) return;
    requestMove(account, toStage);
  }

  if (loading) return <div className="text-sm text-tertiary-500">Loading lead pipeline…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-tertiary-900">Lead pipeline</h2>
          <p className="mt-1 text-sm text-tertiary-500">
            Drag accounts between stages, or use the ⋯ menu on a card.
          </p>
        </div>
        {canCreate && (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New account
          </button>
        )}
      </div>

      <PipelineFilters fields={LEAD_FILTER_FIELDS} onChange={handleFiltersChange} />

      <DndContext
        sensors={sensors}
        onDragStart={(event) => setActiveDrag(event.active.data.current?.account || null)}
        onDragOver={(event) => setOverId(event.over?.id || null)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveDrag(null);
          setOverId(null);
        }}
      >
        <div className="flex gap-3 overflow-x-auto pb-2">
          {LEAD_COLUMNS.map((stage) => {
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
                  {cards.map((account) => {
                    const canMove = canMutateAccount(account, user) && !account.is_locked;
                    return (
                      <DraggableCard
                        key={account.id}
                        id={account.id}
                        disabled={!canMove || moving}
                        data={{ account, stage: account.stage }}
                      >
                        {({ isDragging }) => (
                          <LeadCard
                            account={account}
                            user={user}
                            isDragging={isDragging}
                            onRequestMove={requestMove}
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
            <div className="w-60 rounded-lg border border-primary-200 bg-white p-2.5 shadow-lg">
              <div className="text-sm font-semibold text-tertiary-900">{activeDrag.name}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <AccountStageMoveDrawer
        account={stageTarget}
        open={Boolean(stageTarget)}
        preferredToStage={preferredToStage}
        saving={moving}
        onClose={() => {
          setStageTarget(null);
          setPreferredToStage('');
        }}
        onMove={moveStage}
      />

      {canOverride && (
        <AccountStageOverrideDrawer
          account={overrideTarget}
          preferredToStage={preferredToStage}
          open={Boolean(overrideTarget)}
          saving={moving}
          onClose={() => {
            setOverrideTarget(null);
            setPreferredToStage('');
          }}
          onMove={applyOverride}
        />
      )}

      <Drawer open={createOpen} title="New account" onClose={() => setCreateOpen(false)} size="xl" tone="create">
        {createOpen && (
          <AccountFormPage
            asPanel
            onCancel={() => setCreateOpen(false)}
            onDone={(newId) => {
              setCreateOpen(false);
              reload();
              if (newId) navigate(`/pipeline/${newId}`);
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
