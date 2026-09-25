const { computeClosureProgress, describeClosureSteps, computeClosureDetail } = require('../src/utils/closureProgress');

describe('computeClosureProgress', () => {
  test('sourced is the first of 3 pre-interview + 2 default interview + 3 post-interview steps', () => {
    expect(computeClosureProgress('sourced', [])).toEqual({ percent: 13, completed: 1, total: 8 });
  });

  test('closed is always exactly 100%, regardless of round count', () => {
    expect(computeClosureProgress('closed', [])).toEqual({ percent: 100, completed: 8, total: 8 });
    expect(computeClosureProgress('closed', [{ result: 'pass' }, { result: 'pass' }, { result: 'fail' }])).toEqual({
      percent: 100,
      completed: 9,
      total: 9,
    });
  });

  test('interview_scheduled fills in as rounds resolve, with denominator growing as rounds are added', () => {
    expect(computeClosureProgress('interview_scheduled', [])).toEqual({ percent: 38, completed: 3, total: 8 });
    expect(
      computeClosureProgress('interview_scheduled', [{ result: 'pass' }, { result: 'pending' }])
    ).toEqual({ percent: 50, completed: 4, total: 8 });
    expect(
      computeClosureProgress('interview_scheduled', [
        { result: 'pass' },
        { result: 'pass' },
        { result: 'pending' },
        { result: 'pending' },
      ])
    ).toEqual({ percent: 50, completed: 5, total: 10 });
  });

  test('rejected and backout have no closure probability', () => {
    expect(computeClosureProgress('rejected', [])).toBeNull();
    expect(computeClosureProgress('backout', [])).toBeNull();
  });
});

describe('describeClosureSteps', () => {
  test('sourced: only the first step is current, everything else pending', () => {
    const steps = describeClosureSteps('sourced', []);
    expect(steps.map((s) => [s.key, s.status])).toEqual([
      ['sourced', 'current'],
      ['internal_screening', 'pending'],
      ['submitted_to_client', 'pending'],
      ['interview', 'pending'],
      ['offer_sent', 'pending'],
      ['bgv', 'pending'],
      ['closed', 'pending'],
    ]);
  });

  test('interview_scheduled: pre-interview steps done, interview step current with round tally', () => {
    const steps = describeClosureSteps('interview_scheduled', [{ result: 'pass' }, { result: 'pending' }]);
    expect(steps.map((s) => [s.key, s.status])).toEqual([
      ['sourced', 'done'],
      ['internal_screening', 'done'],
      ['submitted_to_client', 'done'],
      ['interview', 'current'],
      ['offer_sent', 'pending'],
      ['bgv', 'pending'],
      ['closed', 'pending'],
    ]);
    expect(steps.find((s) => s.key === 'interview').label).toBe('Interview rounds — 1 of 2 resolved');
  });

  test('closed: every earlier step done, closed itself is the current (final) step', () => {
    const steps = describeClosureSteps('closed', []);
    expect(steps.filter((s) => s.key !== 'closed').every((s) => s.status === 'done')).toBe(true);
    expect(steps.find((s) => s.key === 'closed').status).toBe('current');
  });

  test('rejected/backout have no step breakdown', () => {
    expect(describeClosureSteps('rejected', [])).toBeNull();
    expect(describeClosureSteps('backout', [])).toBeNull();
  });
});

describe('computeClosureDetail', () => {
  test('combines percent and steps', () => {
    const detail = computeClosureDetail('sourced', []);
    expect(detail.percent).toBe(13);
    expect(detail.steps).toHaveLength(7);
    expect(detail.steps[0]).toEqual({ key: 'sourced', label: 'Sourced', status: 'current' });
  });

  test('returns null for terminal-fail stages', () => {
    expect(computeClosureDetail('rejected', [])).toBeNull();
  });
});
