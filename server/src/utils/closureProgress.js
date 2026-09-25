const PRE_INTERVIEW = ['sourced', 'internal_screening', 'submitted_to_client'];
const POST_INTERVIEW = ['offer_sent', 'bgv', 'closed'];
const INTERVIEW_STAGES = ['interview_scheduled', 'interview_result'];
const MIN_INTERVIEW_STEPS = 2;

/**
 * Closure probability for a submission, as a percentage.
 * Denominator grows as interview rounds get created (dynamic), and the
 * interview-phase share of the progress fills in as rounds resolve —
 * so progress moves continuously through the interview phase instead of
 * jumping in one step from interview_scheduled to interview_result.
 */
function computeClosureProgress(stage, interviewRounds = []) {
  if (stage === 'rejected' || stage === 'backout') return null;

  const roundsTotal = Math.max(interviewRounds.length, MIN_INTERVIEW_STEPS);
  const roundsResolved = interviewRounds.filter((r) => r.result !== 'pending').length;
  const total = PRE_INTERVIEW.length + roundsTotal + POST_INTERVIEW.length;

  let completed;
  const preIndex = PRE_INTERVIEW.indexOf(stage);
  const postIndex = POST_INTERVIEW.indexOf(stage);
  if (preIndex !== -1) {
    completed = preIndex + 1;
  } else if (INTERVIEW_STAGES.includes(stage)) {
    completed = PRE_INTERVIEW.length + roundsResolved;
  } else if (postIndex !== -1) {
    completed = PRE_INTERVIEW.length + roundsTotal + postIndex + 1;
  } else {
    return null;
  }

  const percent = Math.min(100, Math.round((completed / total) * 100));
  return { percent, completed, total };
}

const PIPELINE_ORDER = [
  'sourced',
  'internal_screening',
  'submitted_to_client',
  'interview_scheduled',
  'interview_result',
  'offer_sent',
  'bgv',
  'closed',
];

const STAGE_LABELS = {
  sourced: 'Sourced',
  internal_screening: 'Internal screening',
  submitted_to_client: 'Submitted to client',
  offer_sent: 'Offer sent',
  bgv: 'BGV check',
  closed: 'Closed',
};

/**
 * Step-by-step "why this percentage" breakdown behind computeClosureProgress. Each step's
 * done/current/pending status is derived from the stage's position in the canonical pipeline
 * order (not from the percent math), so it stays easy to reason about independently.
 */
function describeClosureSteps(stage, interviewRounds = []) {
  if (stage === 'rejected' || stage === 'backout') return null;
  const currentIdx = PIPELINE_ORDER.indexOf(stage);
  if (currentIdx === -1) return null;

  const scheduledIdx = PIPELINE_ORDER.indexOf('interview_scheduled');
  const resultIdx = PIPELINE_ORDER.indexOf('interview_result');
  const resolved = interviewRounds.filter((r) => r.result !== 'pending').length;

  function statusFor(stepIdx) {
    if (stepIdx < currentIdx) return 'done';
    if (stepIdx === currentIdx) return 'current';
    return 'pending';
  }

  const interviewStatus =
    currentIdx > resultIdx ? 'done' : currentIdx === scheduledIdx || currentIdx === resultIdx ? 'current' : 'pending';

  return [
    { key: 'sourced', label: STAGE_LABELS.sourced, status: statusFor(0) },
    { key: 'internal_screening', label: STAGE_LABELS.internal_screening, status: statusFor(1) },
    { key: 'submitted_to_client', label: STAGE_LABELS.submitted_to_client, status: statusFor(2) },
    {
      key: 'interview',
      label: interviewRounds.length
        ? `Interview rounds — ${resolved} of ${interviewRounds.length} resolved`
        : 'Interview rounds — none scheduled yet',
      status: interviewStatus,
    },
    { key: 'offer_sent', label: STAGE_LABELS.offer_sent, status: statusFor(5) },
    { key: 'bgv', label: STAGE_LABELS.bgv, status: statusFor(6) },
    { key: 'closed', label: STAGE_LABELS.closed, status: statusFor(7) },
  ];
}

/** Combines the percentage and the step breakdown in one call, for serializers/UI. */
function computeClosureDetail(stage, interviewRounds = []) {
  const progress = computeClosureProgress(stage, interviewRounds);
  if (!progress) return null;
  return { ...progress, steps: describeClosureSteps(stage, interviewRounds) };
}

module.exports = { computeClosureProgress, describeClosureSteps, computeClosureDetail };
