// Contractors get a simplified portal: their assigned projects, the holiday
// calendar(s) that apply to them, and their monthly timesheet — nothing else.
// Checked inside authenticate() (every protected router goes through it), so
// a new router is closed to contractors by default rather than by opt-in.
// Role-level gates still apply on top: a contractor is always role 'employee',
// so admin-only timesheet routes (approvals, overview, locks) stay 403.

const CONTRACTOR_ALLOWED = [
  ['GET', /^\/api\/v1\/users\/me$/],
  ['GET', /^\/api\/v1\/orgs\/me\/memberships$/],
  ['POST', /^\/api\/v1\/auth\/(change-password|switch-org)$/],
  ['*', /^\/api\/v1\/notifications(\/|$)/],
  ['GET', /^\/api\/v1\/calendars\/me$/],
  ['*', /^\/api\/v1\/timesheets(\/|$)/],
  // The timesheet grid checks whether the day is a leave day.
  ['GET', /^\/api\/v1\/leave\/day-status$/],
  ['GET', /^\/api\/v1\/tasks\/mine$/],
  ['PATCH', /^\/api\/v1\/tasks\/[^/]+$/],
];

function contractorMayAccess(method, originalUrl) {
  const path = originalUrl.split('?')[0].replace(/\/+$/, '');
  return CONTRACTOR_ALLOWED.some(([m, pattern]) => (m === '*' || m === method) && pattern.test(path));
}

module.exports = { contractorMayAccess, CONTRACTOR_ALLOWED };
