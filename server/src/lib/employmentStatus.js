// Employment statuses that still work at the company and so keep portal
// access: active, serving notice (until the last working day), and on leave.
// Only pending_onboarding (not started yet) and terminated (left) are out.
const WORKING_STATUSES = ['active', 'notice_period', 'on_leave'];

const isWorking = (status) => WORKING_STATUSES.includes(status);

module.exports = { WORKING_STATUSES, isWorking };
