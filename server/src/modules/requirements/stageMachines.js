const REQUIREMENT_STATUS_TRANSITIONS = {
  open: ['in_progress', 'on_hold', 'closed', 'dropped'],
  in_progress: ['on_hold', 'closed', 'dropped'],
  on_hold: ['open', 'in_progress', 'dropped'],
  closed: [],
  dropped: [],
};

const SEAT_STATUS_TRANSITIONS = {
  open: ['interviewing', 'dropped'],
  interviewing: ['offer', 'dropped'],
  offer: ['bgv', 'dropped'],
  bgv: ['closed', 'dropped'],
  closed: [],
  dropped: [],
};

function nextRequirementStatuses(status) {
  return REQUIREMENT_STATUS_TRANSITIONS[status] || [];
}

function nextSeatStatuses(status) {
  return SEAT_STATUS_TRANSITIONS[status] || [];
}

function requiresDropReason(toStatus) {
  return toStatus === 'dropped';
}

function requiresJoinedAt(toStatus) {
  return toStatus === 'closed';
}

module.exports = {
  REQUIREMENT_STATUS_TRANSITIONS,
  SEAT_STATUS_TRANSITIONS,
  nextRequirementStatuses,
  nextSeatStatuses,
  requiresDropReason,
  requiresJoinedAt,
};
