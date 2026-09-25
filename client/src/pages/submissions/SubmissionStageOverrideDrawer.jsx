import { useEffect, useState } from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
import { SUBMISSION_ALL_STAGES } from '../../lib/submissionStages.js';
import { formatStageLabel } from '../pipeline/pipelineBoardUtils.js';

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-tertiary-200 px-2.5 py-1.5 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100';

/**
 * Superadmin-only RHS drawer to force a submission to any stage — backward moves,
 * out of a terminal state, straight to sourced — bypassing the transition map, the
 * lock, and every gate (rounds resolved / BGV cleared). Reason required; audited.
 *
 * Args:
 *   submission: { id, stage } (at least).
 *   preferredToStage: stage to preselect (e.g. the drop target from a board drag).
 *   open, saving, onClose: standard drawer controls.
 *   onMove: called with { to_stage, reason } — POST /submissions/:id/stage/override.
 */
export default function SubmissionStageOverrideDrawer({
  submission,
  preferredToStage = '',
  open,
  saving,
  onClose,
  onMove,
}) {
  const [toStage, setToStage] = useState(preferredToStage || submission?.stage || 'sourced');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setToStage(preferredToStage || submission?.stage || 'sourced');
    setReason('');
  }, [open, submission?.id, preferredToStage, submission?.stage]);

  if (!submission) return null;

  function submit(event) {
    event.preventDefault();
    if (!toStage || !reason.trim()) return;
    onMove({ to_stage: toStage, reason: reason.trim() });
  }

  return (
    <Drawer
      open={open}
      title="Override candidate stage"
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
            form="submission-stage-override-form"
            disabled={saving || !toStage || !reason.trim()}
            className="btn-primary"
          >
            {saving ? 'Applying…' : 'Apply override'}
          </button>
        </>
      }
    >
      <form id="submission-stage-override-form" onSubmit={submit} className="space-y-3">
        <p className="text-xs text-tertiary-500">
          Current stage: <span className="font-medium text-tertiary-800">{formatStageLabel(submission.stage)}</span>.
          This bypasses the normal transition rules and gates - use only to correct a mistake.
        </p>
        <label className="block text-xs font-medium text-tertiary-600">
          Move to
          <select value={toStage} onChange={(event) => setToStage(event.target.value)} className={INPUT_CLASS}>
            {SUBMISSION_ALL_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {formatStageLabel(stage)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Reason *
          <textarea
            required
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      </form>
    </Drawer>
  );
}
