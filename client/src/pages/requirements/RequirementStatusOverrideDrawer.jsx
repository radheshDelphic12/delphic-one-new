import { useEffect, useState } from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
import { REQUIREMENT_ALL_STATUSES } from '../../lib/requirementStages.js';
import { formatStageLabel } from '../pipeline/pipelineBoardUtils.js';

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-tertiary-200 px-2.5 py-1.5 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100';

/**
 * Superadmin-only RHS drawer to force a requirement to any status — backward moves,
 * or out of the terminal `closed` / `dropped` states — bypassing the transition map,
 * the lock, and the seats-closed gate. Reason required; audited in stage history.
 *
 * Args:
 *   requirement: { id, status, is_locked } (at least).
 *   preferredToStatus: status to preselect (e.g. the drop target from a board drag).
 *   open, saving, onClose: standard drawer controls.
 *   onMove: called with { to_status, reason, is_locked } — POST /requirements/:id/status/override.
 */
export default function RequirementStatusOverrideDrawer({
  requirement,
  preferredToStatus = '',
  open,
  saving,
  onClose,
  onMove,
}) {
  const [toStatus, setToStatus] = useState(preferredToStatus || requirement?.status || 'open');
  const [reason, setReason] = useState('');
  const [isLocked, setIsLocked] = useState(Boolean(requirement?.is_locked));

  useEffect(() => {
    if (!open) return;
    setToStatus(preferredToStatus || requirement?.status || 'open');
    setReason('');
    setIsLocked(Boolean(requirement?.is_locked));
  }, [open, requirement?.id, preferredToStatus, requirement?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!requirement) return null;

  function submit(event) {
    event.preventDefault();
    if (!toStatus || !reason.trim()) return;
    onMove({ to_status: toStatus, reason: reason.trim(), is_locked: isLocked });
  }

  return (
    <Drawer
      open={open}
      title="Override requirement status"
      onClose={() => !saving && onClose()}
      size="sm"
      tone="edit"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            Cancel
          </button>
          <button
            type="submit"
            form="requirement-status-override-form"
            disabled={saving || !toStatus || !reason.trim()}
            className="btn-primary"
          >
            {saving ? 'Applying…' : 'Apply override'}
          </button>
        </>
      }
    >
      <form id="requirement-status-override-form" onSubmit={submit} className="space-y-3">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          Superadmin override - skips the normal transition rules, the lock, and the seats-closed
          gate. The move is recorded in stage history.
        </div>
        <p className="text-xs text-tertiary-500">
          Current status:{' '}
          <span className="font-medium text-tertiary-800">{formatStageLabel(requirement.status)}</span>
        </p>
        <label className="block text-xs font-medium text-tertiary-600">
          Target status
          <select
            required
            value={toStatus}
            onChange={(event) => setToStatus(event.target.value)}
            className={`${INPUT_CLASS} capitalize`}
          >
            {REQUIREMENT_ALL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatStageLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Reason
          <textarea
            required
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={INPUT_CLASS}
            placeholder="Why this manual correction is needed"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-tertiary-600">
          <input type="checkbox" checked={isLocked} onChange={(event) => setIsLocked(event.target.checked)} />
          Keep record locked
        </label>
      </form>
    </Drawer>
  );
}
