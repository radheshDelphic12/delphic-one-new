const {
  nextSubmissionStages,
  requiresBackoutReason,
  requiresRejectionReason,
  computeMargin,
  SUBMISSION_PIPELINE,
} = require('../src/modules/submissions/stageMachines');

describe('submission stageMachines (RD-107 / RD-108 helpers)', () => {
  test('sourced can move to internal_screening, rejected, or backout', () => {
    expect(nextSubmissionStages('sourced')).toEqual(['internal_screening', 'rejected', 'backout']);
  });

  test('closed is terminal; rejected and backout can reactivate to sourced', () => {
    expect(nextSubmissionStages('closed')).toEqual([]);
    expect(nextSubmissionStages('rejected')).toEqual(['sourced']);
    expect(nextSubmissionStages('backout')).toEqual(['sourced']);
  });

  test('isBackwardTransition detects step-backs and reactivate', () => {
    const { isBackwardTransition } = require('../src/modules/submissions/stageMachines');
    expect(isBackwardTransition('interview_scheduled', 'submitted_to_client')).toBe(true);
    expect(isBackwardTransition('interview_scheduled', 'interview_result')).toBe(false);
    expect(isBackwardTransition('rejected', 'sourced')).toBe(true);
    expect(isBackwardTransition('sourced', 'internal_screening')).toBe(false);
  });

  test('backout and rejected require dedicated reasons', () => {
    expect(requiresBackoutReason('backout')).toBe(true);
    expect(requiresRejectionReason('rejected')).toBe(true);
    expect(requiresBackoutReason('closed')).toBe(false);
  });

  test('computeMargin matches create-form live preview rules', () => {
    expect(computeMargin(100, 'INR', 70, 'INR')).toEqual({ margin: 30, margin_percentage: 30 });
    expect(computeMargin(100, 'INR', 70, 'USD')).toEqual({ margin: null, margin_percentage: null });
    expect(computeMargin(null, 'INR', 70, 'INR')).toEqual({ margin: null, margin_percentage: null });
  });

  test('pipeline lists happy-path stages in order', () => {
    expect(SUBMISSION_PIPELINE[0]).toBe('sourced');
    expect(SUBMISSION_PIPELINE[SUBMISSION_PIPELINE.length - 1]).toBe('closed');
  });
});
