/** Keep in sync with server/src/modules/submissions/stageMachines.js */

export const SUBMISSION_STAGE_TRANSITIONS = {
  sourced: ['internal_screening', 'rejected', 'backout'],
  internal_screening: ['submitted_to_client', 'sourced', 'rejected', 'backout'],
  submitted_to_client: ['interview_scheduled', 'internal_screening', 'rejected', 'backout'],
  interview_scheduled: ['interview_result', 'submitted_to_client', 'rejected', 'backout'],
  interview_result: ['offer_sent', 'interview_scheduled', 'rejected', 'backout'],
  offer_sent: ['bgv', 'interview_result', 'backout', 'rejected'],
  bgv: ['closed', 'offer_sent', 'backout', 'rejected'],
  closed: [],
  backout: ['sourced'],
  rejected: ['sourced'],
};

export const SUBMISSION_PIPELINE = [
  'sourced',
  'internal_screening',
  'submitted_to_client',
  'interview_scheduled',
  'interview_result',
  'offer_sent',
  'bgv',
  'closed',
];

// Every stage, for the superadmin override drawer (backward moves, out of a
// terminal state, straight to sourced) — bypasses SUBMISSION_STAGE_TRANSITIONS.
export const SUBMISSION_ALL_STAGES = [...SUBMISSION_PIPELINE, 'backout', 'rejected'];

export function canOverrideSubmissionStage(user) {
  return Boolean(user?.is_superadmin);
}

// Admins (and superadmins) may step a submission back one stage or reactivate a
// rejected / backed-out candidate on the same ticket. Everyone else is forward-only.
export function canMoveSubmissionBackward(user) {
  return user?.role === 'admin' || Boolean(user?.is_superadmin);
}

// Mirror of server isBackwardTransition() in stageMachines.js.
export function isBackwardTransition(fromStage, toStage) {
  if (fromStage === 'rejected' || fromStage === 'backout') return toStage === 'sourced';
  const fromIdx = SUBMISSION_PIPELINE.indexOf(fromStage);
  const toIdx = SUBMISSION_PIPELINE.indexOf(toStage);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx < fromIdx;
}

// Named candidate interview rounds. Composition is intentionally flexible (rounds can be
// added/shortened) without touching SUBMISSION_STAGE_TRANSITIONS - only these lists change.
export const ROUND_TYPES = ['internal_r1', 'internal_r2', 'client_r1', 'client_r2', 'client_r3', 'hr_cto_ceo'];

export const ROUND_TYPE_LABELS = {
  internal_r1: 'Internal Round 1',
  internal_r2: 'Internal Round 2',
  client_r1: 'Client Round 1',
  client_r2: 'Client Round 2',
  client_r3: 'Client Round 3',
  hr_cto_ceo: 'HR, CTO & CEO Round',
};

export const CLIENT_ROUND_TYPES = ['client_r1', 'client_r2', 'client_r3', 'hr_cto_ceo'];
export const INTERNAL_ROUND_TYPES = ['internal_r1', 'internal_r2'];

// Soft rule only - UI warns when a mandatory round/stage is missing, never blocks.
export const MANDATORY_ROUND_TYPES = ['internal_r1', 'hr_cto_ceo'];
export const MANDATORY_SUBMISSION_STAGES = ['sourced', 'internal_screening', 'offer_sent'];

export function roundTypeLabel(type) {
  return ROUND_TYPE_LABELS[type] || type;
}

export function isInternalRoundType(roundType) {
  return INTERNAL_ROUND_TYPES.includes(roundType);
}

export function canManageInterviewRound(submission, roundType, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'recruiter') return submission?.submitted_by?.id === user.id;
  if (user.role === 'sales') {
    return CLIENT_ROUND_TYPES.includes(roundType) && submission?.requirement?.sales_owner_id === user.id;
  }
  return false;
}

export function nextSubmissionStages(stage) {
  return SUBMISSION_STAGE_TRANSITIONS[stage] || [];
}

export function requiresBackoutReason(toStage) {
  return toStage === 'backout';
}

export function requiresRejectionReason(toStage) {
  return toStage === 'rejected';
}

export function computeMarginPreview(proposed_rate, proposed_rate_currency, vendor_rate, vendor_rate_currency) {
  if (proposed_rate == null || proposed_rate === '' || vendor_rate == null || vendor_rate === '') {
    return { margin: null, margin_percentage: null };
  }
  if (proposed_rate_currency && vendor_rate_currency && proposed_rate_currency !== vendor_rate_currency) {
    return { margin: null, margin_percentage: null };
  }
  const proposed = Number(proposed_rate);
  const vendor = Number(vendor_rate);
  if (!Number.isFinite(proposed) || !Number.isFinite(vendor)) {
    return { margin: null, margin_percentage: null };
  }
  const margin = proposed - vendor;
  const margin_percentage = proposed ? Number(((margin / proposed) * 100).toFixed(2)) : null;
  return { margin, margin_percentage };
}

// Recruiter/admin can put forward any candidate; sales may also put candidates
// forward, but only ones on the bench (see canOnlyPutForwardBench) — enforced
// again server-side in submissions.service.create.
export function canCreateSubmission(user) {
  return user && ['recruiter', 'sales', 'admin'].includes(user.role);
}

// Sales is restricted to bench candidates (source = direct/"Bench" AND on_bench).
export function canOnlyPutForwardBench(user) {
  return user?.role === 'sales';
}

// Who can edit submission fields (rates, notes, files) — PATCH /submissions/:id.
export function canMutateSubmission(user) {
  return user && ['recruiter', 'admin'].includes(user.role);
}

// Who can move a submission through the pipeline (POST /submissions/:id/stage).
// Sales, recruiter and admin all do forward transitions on any submission;
// backward moves / reactivations are gated separately by canMoveSubmissionBackward
// (admin / superadmin only).
export function canMoveSubmissionStage(user) {
  return user && ['recruiter', 'sales', 'admin'].includes(user.role);
}

export function pipelineIndex(stage) {
  if (stage === 'backout' || stage === 'rejected') return -1;
  return SUBMISSION_PIPELINE.indexOf(stage);
}
