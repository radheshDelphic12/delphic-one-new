// Forward edges drive the normal pipeline. The single "step back one stage" edge on each
// in-pipeline stage, and the `sourced` edge out of `backout` / `rejected` (reactivate a
// candidate on the same ticket), are BACKWARD moves — the service restricts those to
// admin / superadmin and requires a reason. See isBackwardTransition().
const SUBMISSION_STAGE_TRANSITIONS = {
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

const SUBMISSION_PIPELINE = [
  'sourced',
  'internal_screening',
  'submitted_to_client',
  'interview_scheduled',
  'interview_result',
  'offer_sent',
  'bgv',
  'closed',
];

// Named candidate interview rounds (round_type). Kept intentionally flexible: composition
// can change (rounds added/shortened) without touching SubmissionStage - only these lists
// and their labels need updating.
const ROUND_TYPES = ['internal_r1', 'internal_r2', 'client_r1', 'client_r2', 'client_r3', 'hr_cto_ceo'];

const ROUND_TYPE_LABELS = {
  internal_r1: 'Internal Round 1',
  internal_r2: 'Internal Round 2',
  client_r1: 'Client Round 1',
  client_r2: 'Client Round 2',
  client_r3: 'Client Round 3',
  hr_cto_ceo: 'HR, CTO & CEO Round',
};

const CLIENT_ROUND_TYPES = ['client_r1', 'client_r2', 'client_r3', 'hr_cto_ceo'];
const INTERNAL_ROUND_TYPES = ['internal_r1', 'internal_r2'];

// Mandatory milestones per the recruiting process - enforced as a SOFT rule only (UI warns,
// never blocks). The existing hard gates below (unresolved rounds before offer_sent, BGV
// cleared before closed) are a different, unrelated concern and are unaffected.
const MANDATORY_ROUND_TYPES = ['internal_r1', 'hr_cto_ceo'];
const MANDATORY_SUBMISSION_STAGES = ['sourced', 'internal_screening', 'offer_sent'];

function roundTypeLabel(type) {
  return ROUND_TYPE_LABELS[type] || type;
}

function computeMissingMandatoryRounds(rounds) {
  const present = new Set((rounds || []).map((r) => r.round_type));
  return MANDATORY_ROUND_TYPES.filter((type) => !present.has(type));
}

function nextSubmissionStages(stage) {
  return SUBMISSION_STAGE_TRANSITIONS[stage] || [];
}

// A move is "backward" when it re-enters the pipeline from a terminal state
// (rejected / backout → sourced) or steps to an earlier pipeline stage.
// rejected / backout themselves are never "backward" (they are exits, reason-gated already).
function isBackwardTransition(fromStage, toStage) {
  if (fromStage === 'rejected' || fromStage === 'backout') return toStage === 'sourced';
  const fromIdx = SUBMISSION_PIPELINE.indexOf(fromStage);
  const toIdx = SUBMISSION_PIPELINE.indexOf(toStage);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx < fromIdx;
}

function requiresBackoutReason(toStage) {
  return toStage === 'backout';
}

function requiresRejectionReason(toStage) {
  return toStage === 'rejected';
}

function computeMargin(proposed_rate, proposed_rate_currency, vendor_rate, vendor_rate_currency) {
  if (proposed_rate == null || vendor_rate == null) return { margin: null, margin_percentage: null };
  if (proposed_rate_currency && vendor_rate_currency && proposed_rate_currency !== vendor_rate_currency) {
    return { margin: null, margin_percentage: null };
  }
  const margin = Number(proposed_rate) - Number(vendor_rate);
  const margin_percentage = proposed_rate ? Number(((margin / proposed_rate) * 100).toFixed(2)) : null;
  return { margin, margin_percentage };
}

module.exports = {
  SUBMISSION_STAGE_TRANSITIONS,
  SUBMISSION_PIPELINE,
  ROUND_TYPES,
  ROUND_TYPE_LABELS,
  CLIENT_ROUND_TYPES,
  INTERNAL_ROUND_TYPES,
  MANDATORY_ROUND_TYPES,
  MANDATORY_SUBMISSION_STAGES,
  roundTypeLabel,
  computeMissingMandatoryRounds,
  nextSubmissionStages,
  isBackwardTransition,
  requiresBackoutReason,
  requiresRejectionReason,
  computeMargin,
};
