const { needFor } = require('./routeRules');
const { rank, MODULE_OF } = require('../permissions');
const { deriveLegacyRole } = require('./effective');

/**
 * The one central access check. `authenticate` calls it for every request of a person whose company is on the permission model;
 * nothing else decides whether a route is open to them. The Super Admin and the company Admin pass everything here (their own
 * route gates still apply). Everyone else needs the permission the route table (routeRules.js) names for that method + path.
 */
const API_PREFIX = '/api/v1';

function pathOf(originalUrl) {
  const raw = String(originalUrl || '').split('?')[0];
  if (!raw.startsWith(API_PREFIX)) return null;
  return raw.slice(API_PREFIX.length).replace(/\/+$/, '') || '/';
}

/** Does the access object hold one of the needs? `access` is `req.user.access`. */
function satisfies(access, need) {
  if (need === 'open') return true;
  if (access.level !== 'employee') return true;
  if (need === 'admin') return false;
  const keys = Array.isArray(need) ? need : [need];
  return keys.some((k) => (k.startsWith('basic.') ? access.basic.includes(k) : Boolean(access.permissions[k])));
}

// For an open route (the person's own records, shared lookups) the service still decides "everyone's, or only mine" by the
// caller's role. These are the modules that decide it, so a person is treated as an admin there only if they hold that module.
const OPEN_MODULES = [
  [/^\/payroll/, ['payroll', 'increments']],
  [/^\/expenses/, ['finance']],
  [/^\/orgs/, ['people']],
  [/^\/users/, ['users']],
  [/^\/timesheets/, ['timesheets', 'overtime', 'regularization', 'project_team']],
  [/^\/leave/, ['leave']],
  [/^\/attendance/, ['attendance', 'attendance_dashboard', 'regularization']],
  [/^\/calendars/, ['holidays', 'project_calendar']],
  [/^\/(documents|comments|interviews|seats|interview-rounds)/, ['accounts', 'requirements', 'profiles', 'submissions', 'applicants', 'pipeline', 'meetings']],
  [/^\/(policies|departments|designations|teams)/, ['hr_settings']],
  [/^\/profitability/, ['analytics']],
];

function modulesOf(need, path) {
  const keys = (Array.isArray(need) ? need : [need]).filter((k) => k !== 'open' && k !== 'admin' && !k.startsWith('basic.'));
  if (keys.length) return keys.map((k) => k.split('.')[0]);
  const hit = OPEN_MODULES.find(([re]) => re.test(path));
  return hit ? hit[1] : [];
}

const holdsAll = (permissions, modules) => Object.entries(permissions).some(([k, v]) => modules.includes(k.split('.')[0]) && rank(v) === 3);

/**
 * The plain role the older services should see for THIS request. A person on the permission model may carry the admin role for
 * the routes that still ask for it, but a service that shows everyone's records to an admin (and only your own to anyone else)
 * must treat them as an admin only in the module they were given at full scope. Holding People does not open Payroll.
 */
function roleForRequest(user, modules) {
  const access = user.access;
  if (!access || access.mode !== 'permissions' || access.level !== 'employee') return user.role;
  if (user.role !== 'admin') return user.role;
  if (modules.length && holdsAll(access.permissions, modules)) return 'admin';
  // not an admin here: whatever recruitment role their other permissions imply (sales / recruiter / bda), else a plain employee
  const own = {};
  for (const [k, v] of Object.entries(access.permissions)) if (MODULE_OF.get(k)?.category === 'recruitment' && MODULE_OF.get(k).module !== 'website') own[k] = v;
  return deriveLegacyRole({ level: 'employee', setBaseRole: null, permissions: own });
}

/**
 * Args:
 *   user: the resolved request user (`access` is set when the company is on the permission model).
 *   method, originalUrl: the request.
 *
 * Returns:
 *   { ok: true, role } or { ok: false, need } when the person lacks the permission. `role` is the plain role for this request.
 */
function check(user, method, originalUrl) {
  const access = user?.access;
  if (!access || access.mode !== 'permissions') return { ok: true, role: user?.role };
  const path = pathOf(originalUrl);
  if (path === null) return { ok: true, role: user.role };
  // Their own details and reporting line are theirs, whatever else they hold.
  const own = user.org_membership_id;
  const selfPath = own && (path === `/orgs/memberships/${own}` || path.startsWith(`/orgs/memberships/${own}/`));
  const need = selfPath ? 'open' : needFor(String(method || 'GET').toUpperCase(), path);
  if (!satisfies(access, need)) return { ok: false, need };
  return { ok: true, role: roleForRequest(user, modulesOf(need, path)) };
}

/** Is this person the Admin / Super Admin, or (for a person on the permission model) holding any of these permissions? */
function adminPower(user, ...keys) {
  if (!user) return false;
  const access = user.access;
  if (!access || access.mode !== 'permissions') return user.role === 'admin';
  if (access.level !== 'employee') return true;
  return keys.some((k) => Boolean(access.permissions[k]));
}

module.exports = { check, satisfies, adminPower, pathOf, modulesOf, roleForRequest };
