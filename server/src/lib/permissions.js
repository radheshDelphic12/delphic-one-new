const prisma = require('../config/db');
const { fail } = require('../utils/response');

/**
 * Permissions: the catalogue and the checks that use it.
 *
 * A permission is `<module>.<action>` and a scope. Its value is `true`, or for an action that has a scope: 'own' (records the
 * person created or that are about them), 'team' (their own and their team's: direct reports and the teams they lead) or 'all'.
 *
 * Two modes, per company (`orgs.access_mode`):
 *  - 'legacy': a membership with no custom role is untouched, the plain system role (admin / sales / recruiter / bda / employee)
 *    decides, exactly as before. A membership WITH a custom role is decided by the role's permissions on every gated endpoint
 *    (the ones that call `can()` below) and keeps the role's `base_role` for everything else.
 *  - 'permissions': everyone who is not the company Admin or the Super Admin gets the default basic access plus their permission
 *    set plus their own grants (see lib/access). The effective permissions are put on `req.user.custom_permissions`, so the same
 *    `can()` checks decide, and the central route guard (lib/access/guard.js) checks every request against them.
 */
const SCOPES = ['own', 'team', 'all'];

const CATEGORIES = [
  { key: 'recruitment', label: 'Recruitment' },
  { key: 'people', label: 'People and HR' },
  { key: 'time', label: 'Time and Attendance' },
  { key: 'finance', label: 'Finance' },
  { key: 'reports', label: 'Reports' },
  { key: 'administration', label: 'Administration' },
];

const A = (module, name, label, scoped = false) => ({ key: `${module}.${name}`, label, ...(scoped ? { scoped: true } : {}) });

const CATALOG = [
  // ---- Recruitment
  { module: 'accounts', category: 'recruitment', label: 'Accounts (clients and vendors)', actions: [A('accounts', 'view', 'View'), A('accounts', 'create', 'Add'), A('accounts', 'update', 'Edit', true), A('accounts', 'delete', 'Delete', true)] },
  { module: 'meetings', category: 'recruitment', label: 'Meetings', actions: [A('meetings', 'schedule', 'Schedule meetings and interviews')] },
  { module: 'vendors', category: 'recruitment', label: 'Vendors', actions: [A('vendors', 'onboard', 'Onboard vendors')] },
  { module: 'email', category: 'recruitment', label: 'Email', actions: [A('email', 'send', 'Send emails (requirements to vendors)')] },
  { module: 'requirements', category: 'recruitment', label: 'Requirements', actions: [A('requirements', 'view', 'View'), A('requirements', 'create', 'Add'), A('requirements', 'update', 'Edit', true), A('requirements', 'delete', 'Delete', true)] },
  { module: 'pipeline', category: 'recruitment', label: 'Pipeline', actions: [A('pipeline', 'view', 'View')] },
  { module: 'profiles', category: 'recruitment', label: 'Profiles (candidates)', actions: [A('profiles', 'view', 'View'), A('profiles', 'create', 'Add'), A('profiles', 'update', 'Edit', true), A('profiles', 'delete', 'Delete', true)] },
  { module: 'submissions', category: 'recruitment', label: 'Submissions', actions: [A('submissions', 'view', 'View'), A('submissions', 'create', 'Submit a profile'), A('submissions', 'update', 'Edit and move stages', true)] },
  { module: 'rejected', category: 'recruitment', label: 'Rejected', actions: [A('rejected', 'view', 'View')] },
  { module: 'applicants', category: 'recruitment', label: 'Applicant pool', actions: [A('applicants', 'view', 'View'), A('applicants', 'update', 'Edit and assign')] },
  { module: 'website', category: 'recruitment', label: 'Website submissions and postings', actions: [A('website', 'view', 'View'), A('website', 'update', 'Edit and publish')] },

  // ---- People and HR
  { module: 'people', category: 'people', label: 'People (full details)', actions: [A('people', 'view', 'View', true), A('people', 'create', 'Add'), A('people', 'update', 'Edit', true), A('people', 'delete', 'Delete', true)] },
  { module: 'allocations', category: 'people', label: 'Capacity and allocation', actions: [A('allocations', 'view', 'View'), A('allocations', 'manage', 'Allocate people to projects')] },
  { module: 'users', category: 'people', label: 'Users', actions: [A('users', 'view', 'View'), A('users', 'create', 'Add'), A('users', 'update', 'Edit')] },
  { module: 'assets', category: 'people', label: 'Assets', actions: [A('assets', 'view', 'View'), A('assets', 'create', 'Add'), A('assets', 'update', 'Edit'), A('assets', 'delete', 'Delete')] },
  { module: 'hr_settings', category: 'people', label: 'HR settings', actions: [A('hr_settings', 'view', 'View'), A('hr_settings', 'update', 'Edit (departments, teams, designations, offices, policies, leave types, shifts)')] },

  // ---- Time and Attendance
  { module: 'attendance', category: 'time', label: 'Team attendance', actions: [A('attendance', 'view', 'View', true), A('attendance', 'update', 'Edit and import', true), A('attendance', 'approve', 'Check attendance changes (everyone)')] },
  { module: 'attendance_dashboard', category: 'time', label: 'Attendance dashboard', actions: [A('attendance_dashboard', 'view', 'View')] },
  { module: 'project_calendar', category: 'time', label: 'Project calendar', actions: [A('project_calendar', 'view', 'View'), A('project_calendar', 'update', 'Edit')] },
  { module: 'project_team', category: 'time', label: 'Project team', actions: [A('project_team', 'view', 'View')] },
  { module: 'holidays', category: 'time', label: 'Holiday calendar', actions: [A('holidays', 'view', 'View'), A('holidays', 'update', 'Edit and assign')] },
  { module: 'overtime', category: 'time', label: 'OT tickets', actions: [A('overtime', 'view', 'View', true), A('overtime', 'update', 'Add and edit for others'), A('overtime', 'approve', 'Approve')] },
  { module: 'timesheets', category: 'time', label: 'Project timesheets', actions: [A('timesheets', 'view', 'View', true), A('timesheets', 'update', 'Add and edit for others'), A('timesheets', 'approve', 'Check timesheets (everyone)'), A('timesheets', 'lock', 'Lock and reopen')] },
  { module: 'regularization', category: 'time', label: 'Regularization', actions: [A('regularization', 'view', 'View', true), A('regularization', 'approve', 'Approve')] },
  { module: 'leave', category: 'time', label: 'Leave (team)', actions: [A('leave', 'view', 'View', true), A('leave', 'approve', 'Approve', true), A('leave', 'update', 'Balances and leave types')] },

  // ---- Finance
  { module: 'finance', category: 'finance', label: 'Finance (claims, vendor payments, accounting)', actions: [A('finance', 'view', 'View'), A('finance', 'create', 'Add'), A('finance', 'update', 'Edit'), A('finance', 'delete', 'Delete'), A('finance', 'approve', 'Approve and pay')] },
  { module: 'payroll', category: 'finance', label: 'Payroll (admin tabs)', actions: [A('payroll', 'view', 'View'), A('payroll', 'create', 'Add'), A('payroll', 'update', 'Edit'), A('payroll', 'approve', 'Process and lock')] },
  { module: 'increments', category: 'finance', label: 'Increments', actions: [A('increments', 'receive', 'Receive increment reminders')] },
  { module: 'analytics', category: 'finance', label: 'Live Analytics', actions: [A('analytics', 'view', 'View'), A('analytics', 'update', 'Edit')] },
  { module: 'financials', category: 'finance', label: 'Financials', actions: [A('financials', 'view', 'View'), A('financials', 'create', 'Add records'), A('financials', 'update', 'Update records'), A('financials', 'delete', 'Delete records')] },
  { module: 'business', category: 'finance', label: 'Trading, contracts and own projects', actions: [A('business', 'view', 'View'), A('business', 'create', 'Add'), A('business', 'update', 'Edit'), A('business', 'delete', 'Delete')] },
  { module: 'billing', category: 'finance', label: 'Billing', actions: [A('billing', 'view', 'View'), A('billing', 'create', 'Add'), A('billing', 'update', 'Edit'), A('billing', 'delete', 'Delete')] },

  // ---- Reports
  { module: 'reports', category: 'reports', label: 'Reports and exports', actions: [A('reports', 'view', 'View'), A('reports', 'export', 'Export'), A('reports', 'hr', 'HR reports (sourcing, submissions, rounds, joinings by person)')] },

  // ---- Administration (Super Admin and Admin only unless someone is granted it)
  { module: 'settings', category: 'administration', label: 'Settings (company)', adminDefault: true, actions: [A('settings', 'view', 'View'), A('settings', 'update', 'Edit')] },
  { module: 'deleted_records', category: 'administration', label: 'Deleted records', adminDefault: true, actions: [A('deleted_records', 'view', 'View'), A('deleted_records', 'restore', 'Restore')] },
  { module: 'logs', category: 'administration', label: 'Logs', adminDefault: true, actions: [A('logs', 'view', 'View')] },
  // The permission editor itself is never a grantable permission: employees cannot grant, even holding every other permission.
];

/** Items every employee has with no setup. Super Admin / Admin can add to them per person, or remove one from a person. */
const BASIC_ITEMS = [
  { key: 'basic.home', label: 'Home dashboard (announcements, birthdays and anniversaries, own tasks)' },
  { key: 'basic.offices', label: 'Offices' },
  { key: 'basic.policies', label: 'Published policies' },
  { key: 'basic.internal_jobs', label: 'Internal jobs (refer someone, apply myself when eligible)' },
  { key: 'basic.people_directory', label: 'People directory (name, designation, department, office, work email, manager)' },
  { key: 'basic.org_chart', label: 'Org chart' },
  { key: 'basic.calendar', label: 'Calendar (own meetings; schedule meetings they organise)' },
  { key: 'basic.attendance', label: 'Own attendance and regularization requests' },
  { key: 'basic.leave', label: 'Apply for and view own leave' },
  { key: 'basic.timesheet', label: 'Log and view own timesheet' },
  { key: 'basic.payslips', label: 'View own payslips' },
  { key: 'basic.expenses', label: 'File and track own expense claims' },
  { key: 'basic.settings', label: 'Own account (my details, security, notifications)' },
];
const BASIC_KEYS = BASIC_ITEMS.map((b) => b.key);

const ACTIONS = new Map(CATALOG.flatMap((m) => m.actions.map((a) => [a.key, a])));
const ALL_KEYS = [...ACTIONS.keys()];
const BASIC_SET = new Set(BASIC_KEYS);
const MODULE_OF = new Map(CATALOG.flatMap((m) => m.actions.map((a) => [a.key, m])));

/** Cleans a permissions object from the UI: only known keys, `true` or a valid scope; anything off is dropped. */
function normalizePermissions(input) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    const action = ACTIONS.get(key);
    if (!action || !value) continue;
    if (action.scoped) out[key] = SCOPES.includes(value) ? value : value === true ? 'all' : null;
    else out[key] = true;
    if (!out[key]) delete out[key];
  }
  return out;
}

const rank = (v) => (v === 'all' || v === true ? 3 : v === 'team' ? 2 : v === 'own' ? 1 : 0);

/**
 * Does the person's custom role allow `key`? Returns `null` when they have no custom role (the plain role decides), otherwise a boolean.
 * `ownerUserId` is who owns the record being touched (for scoped actions); leave it out when there is no record (creating).
 */
function hasPermission(user, key, ownerUserId) {
  if (!user || !user.custom_permissions) return null;
  const value = user.custom_permissions[key];
  if (!value) return false;
  const action = ACTIONS.get(key);
  if (!action?.scoped || ownerUserId === undefined) return true;
  if (value === 'all' || value === true) return true;
  if (ownerUserId && ownerUserId === user.id) return true;
  return value === 'team' && Boolean(ownerUserId) && (user.team_user_ids || new Set()).has(ownerUserId);
}

/** Express middleware: custom-role holders need the permission; everyone else needs one of the plain roles (as before). */
function can(key, ...legacyRoles) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 401, 'Not authenticated');
    const decided = hasPermission(req.user, key);
    if (decided === null) return legacyRoles.includes(req.user.role) ? next() : fail(res, 403, 'Insufficient role');
    return decided ? next() : fail(res, 403, 'Your role does not allow this');
  };
}

/** Like can(), but any one of several permissions is enough (for an endpoint that serves two jobs). */
function canAny(keys, ...legacyRoles) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 401, 'Not authenticated');
    if (req.user.custom_permissions === undefined || req.user.custom_permissions === null) return legacyRoles.includes(req.user.role) ? next() : fail(res, 403, 'Insufficient role');
    return keys.some((k) => hasPermission(req.user, k)) ? next() : fail(res, 403, 'Your role does not allow this');
  };
}

/** Reads map to `<module>.view`, POST to `.create`, PUT to create-or-update, PATCH to `.update`, DELETE to `.delete`. For a whole router. */
function canMethod(module, ...legacyRoles) {
  const verbs = { GET: ['view'], HEAD: ['view'], POST: ['create'], PUT: ['update', 'create'], PATCH: ['update'], DELETE: ['delete'] };
  return (req, res, next) => {
    if (!req.user) return fail(res, 401, 'Not authenticated');
    if (hasPermission(req.user, `${module}.view`) === null) return legacyRoles.includes(req.user.role) ? next() : fail(res, 403, 'Insufficient role');
    const wanted = verbs[req.method] || ['update'];
    return wanted.some((v) => hasPermission(req.user, `${module}.${v}`)) ? next() : fail(res, 403, 'Your role does not allow this');
  };
}

/** Like can(), for a scoped action on one record: `ownerOf(req)` resolves the record's owner (a user id). */
function canOn(key, ownerOf, ...legacyRoles) {
  return async (req, res, next) => {
    try {
      if (!req.user) return fail(res, 401, 'Not authenticated');
      if (hasPermission(req.user, key) === null) return legacyRoles.includes(req.user.role) ? next() : fail(res, 403, 'Insufficient role');
      const owner = await ownerOf(req);
      return hasPermission(req.user, key, owner === undefined ? null : owner) ? next() : fail(res, 403, 'Your role does not allow this on this record');
    } catch (err) {
      return next(err);
    }
  };
}

/** The same decision for services: `null` means "no custom role, use the plain role". */
function decide(user, key, ownerUserId) {
  return hasPermission(user, key, ownerUserId);
}

/** User ids of the people on someone's team: their direct reports (and theirs) plus the members of teams they lead. */
async function teamUserIds(orgId, membershipId) {
  const ids = new Set();
  if (!membershipId) return ids;
  let frontier = [membershipId];
  for (let depth = 0; depth < 6 && frontier.length; depth += 1) {
    const rows = await prisma.orgMembership.findMany({ where: { org_id: orgId, manager_id: { in: frontier } }, select: { id: true, person_id: true } });
    frontier = [];
    for (const r of rows) {
      if (!ids.has(r.person_id)) { ids.add(r.person_id); frontier.push(r.id); }
    }
  }
  const led = await prisma.team.findMany({ where: { org_id: orgId, lead_membership_id: membershipId }, select: { members: { select: { person_id: true } } } });
  for (const t of led) for (const m of t.members) ids.add(m.person_id);
  return ids;
}

module.exports = {
  SCOPES, CATEGORIES, CATALOG, ALL_KEYS, ACTIONS, MODULE_OF, BASIC_ITEMS, BASIC_KEYS, BASIC_SET,
  normalizePermissions, hasPermission, decide, can, canAny, canMethod, canOn, teamUserIds, rank,
};
