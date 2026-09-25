const {
  nextRequirementStatuses,
  nextSeatStatuses,
  requiresDropReason,
  requiresJoinedAt,
  REQUIREMENT_STATUS_TRANSITIONS,
  SEAT_STATUS_TRANSITIONS,
} = require('../src/modules/requirements/stageMachines');

describe('requirement stageMachines (UI + API shared rules)', () => {
  test('open requirement can move to in_progress, on_hold, closed, dropped', () => {
    expect(nextRequirementStatuses('open')).toEqual(['in_progress', 'on_hold', 'closed', 'dropped']);
  });

  test('terminal requirement statuses have no next steps', () => {
    expect(nextRequirementStatuses('closed')).toEqual([]);
    expect(nextRequirementStatuses('dropped')).toEqual([]);
  });

  test('seat path is open → interviewing → offer → bgv → closed', () => {
    expect(nextSeatStatuses('open')).toEqual(['interviewing', 'dropped']);
    expect(nextSeatStatuses('interviewing')).toEqual(['offer', 'dropped']);
    expect(nextSeatStatuses('offer')).toEqual(['bgv', 'dropped']);
    expect(nextSeatStatuses('bgv')).toEqual(['closed', 'dropped']);
  });

  test('drop requires reason; close seat requires joined_at', () => {
    expect(requiresDropReason('dropped')).toBe(true);
    expect(requiresDropReason('closed')).toBe(false);
    expect(requiresJoinedAt('closed')).toBe(true);
    expect(requiresJoinedAt('dropped')).toBe(false);
  });

  test('transition maps cover every known status key', () => {
    const reqStatuses = ['open', 'in_progress', 'on_hold', 'closed', 'dropped'];
    const seatStatuses = ['open', 'interviewing', 'offer', 'bgv', 'closed', 'dropped'];
    reqStatuses.forEach((s) => expect(REQUIREMENT_STATUS_TRANSITIONS[s]).toBeDefined());
    seatStatuses.forEach((s) => expect(SEAT_STATUS_TRANSITIONS[s]).toBeDefined());
  });
});
