const { ALL_KEYS, ACTIONS, MODULE_OF, rank } = require('../permissions');

/**
 * What each plain role could do before the permission model, written as permissions. Used by the migration to propose, for every
 * person, a permission set that gives back what they use today (so nobody loses a screen by accident), and to flag anyone whose
 * proposed access is smaller.
 *
 * Source of truth: the capability map the screens used (client/src/lib/permissions.js ROLE_CAPS) and the route gates in the
 * server modules (authorize / can / canMethod).
 */
const full = (keys) => Object.fromEntries(keys.map((k) => [k, ACTIONS.get(k)?.scoped ? 'all' : true]));

const ROLE_EQUIVALENT = {
  // The plain admin: every module except the superadmin-only deleted-records tools.
  admin: full(ALL_KEYS.filter((k) => !k.startsWith('deleted_records.'))),
  sales: full([
    'accounts.view', 'requirements.view', 'requirements.create', 'requirements.update', 'requirements.delete', 'pipeline.view',
    'profiles.view', 'submissions.view', 'submissions.create', 'submissions.update', 'rejected.view', 'applicants.view',
    'applicants.update', 'reports.view', 'reports.export', 'meetings.schedule', 'business.view',
  ]),
  recruiter: full([
    'accounts.view', 'requirements.view', 'pipeline.view', 'profiles.view', 'profiles.create', 'profiles.update', 'submissions.view',
    'submissions.create', 'submissions.update', 'rejected.view', 'applicants.view', 'applicants.update', 'reports.view', 'meetings.schedule',
  ]),
  bda: full([
    'accounts.view', 'accounts.create', 'accounts.update', 'meetings.schedule', 'vendors.onboard', 'pipeline.view', 'profiles.view',
    'requirements.view', 'submissions.view', 'rejected.view', 'reports.view', 'business.view',
  ]),
  employee: {},
};

// Keys a custom role decided ENTIRELY by its own ticks (the gates call can() / canOn() / canMethod()): the plain base role did not
// add to them. Everything else came from the base role.
const GATED_MODULES = new Set(['meetings', 'vendors', 'finance', 'payroll', 'billing', 'analytics', 'financials', 'business', 'increments', 'allocations']);
const GATED_KEYS = new Set([
  'accounts.create', 'accounts.update', 'accounts.delete', 'requirements.create', 'requirements.update', 'requirements.delete',
  'profiles.create', 'profiles.update', 'profiles.delete', 'submissions.create', 'submissions.update', 'timesheets.approve', 'attendance.approve',
]);
const isGated = (key) => GATED_KEYS.has(key) || GATED_MODULES.has(MODULE_OF.get(key)?.module);

const FINANCE_FAMILY = ['finance', 'payroll', 'billing', 'analytics', 'financials', 'business'];

/** A custom role's old ticks written as the permissions they stood for (the old `financials.view` tick opened every finance screen). */
function expandLegacyTicks(ticks) {
  const out = { ...(ticks || {}) };
  const set = (key, value = true) => { if (ACTIONS.has(key) && !out[key]) out[key] = value; };
  for (const verb of ['view', 'create', 'update', 'delete']) {
    if (!ticks?.[`financials.${verb}`]) continue;
    for (const m of FINANCE_FAMILY) set(`${m}.${verb}`);
    if (verb === 'update') { set('finance.approve'); set('payroll.approve'); }
  }
  if (ticks?.['attendance.approve']) {
    set('attendance.view', 'all'); set('attendance.update', 'all'); set('regularization.view', 'all'); set('regularization.approve');
  }
  if (ticks?.['timesheets.approve']) set('timesheets.view', 'all');
  if (ticks?.['allocations.manage']) set('allocations.view');
  return out;
}

/**
 * A custom role as a permission set under the new model: its ticks decide the gated actions, its base role supplies the rest,
 * exactly as the two worked together before.
 */
function materializeSet({ baseRole, ticks }) {
  const merged = {};
  for (const [key, value] of Object.entries(ROLE_EQUIVALENT[baseRole] || {})) if (!isGated(key)) merged[key] = value;
  return { ...merged, ...expandLegacyTicks(ticks) };
}

/** What a person has today, as permissions: the plain role, or the custom role's base + ticks. */
function currentAccess({ role, customRole }) {
  if (customRole) return materializeSet({ baseRole: customRole.base_role, ticks: customRole.permissions });
  return { ...(ROLE_EQUIVALENT[role] || {}) };
}

/** Which permissions go away, narrow or are gained between two permission maps. */
function diffPermissions(before, after) {
  const lost = [];
  const narrowed = [];
  const gained = [];
  for (const [key, v] of Object.entries(before)) {
    if (!after[key]) lost.push(key);
    else if (rank(after[key]) < rank(v)) narrowed.push(key);
  }
  for (const key of Object.keys(after)) if (!before[key]) gained.push(key);
  return { lost, narrowed, gained };
}

module.exports = { ROLE_EQUIVALENT, expandLegacyTicks, materializeSet, currentAccess, diffPermissions, isGated };
