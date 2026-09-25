/** Keep in sync with server/src/modules/requirements/stageMachines.js */

export const REQUIREMENT_STATUS_TRANSITIONS = {
  open: ['in_progress', 'on_hold', 'closed', 'dropped'],
  in_progress: ['on_hold', 'closed', 'dropped'],
  on_hold: ['open', 'in_progress', 'dropped'],
  closed: [],
  dropped: [],
};

export const SEAT_STATUS_TRANSITIONS = {
  open: ['interviewing', 'dropped'],
  interviewing: ['offer', 'dropped'],
  offer: ['bgv', 'dropped'],
  bgv: ['closed', 'dropped'],
  closed: [],
  dropped: [],
};

export function nextRequirementStatuses(status) {
  return REQUIREMENT_STATUS_TRANSITIONS[status] || [];
}

// Every status, for the superadmin override drawer (backward moves, out of the
// terminal `closed` / `dropped` states). Keep in sync with statusOverrideSchema.
export const REQUIREMENT_ALL_STATUSES = ['open', 'in_progress', 'on_hold', 'closed', 'dropped'];

export function canOverrideRequirementStatus(user) {
  return Boolean(user?.is_superadmin);
}

export function nextSeatStatuses(status) {
  return SEAT_STATUS_TRANSITIONS[status] || [];
}

export function requiresDropReason(toStatus) {
  return toStatus === 'dropped';
}

export function requiresJoinedAt(toStatus) {
  return toStatus === 'closed';
}

export function canMutateRequirement(requirement, user) {
  if (!requirement || !user) return false;
  if (user.role === 'admin') return true;
  return user.role === 'sales' && requirement.sales_owner?.id === user.id;
}

export function canChangeSeatStage(user) {
  return user && ['recruiter', 'sales', 'admin'].includes(user.role);
}

export function canCreateRequirement(user) {
  return user && ['sales', 'admin'].includes(user.role);
}
