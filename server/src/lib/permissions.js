const prisma = require('../config/db');
const { fail } = require('../utils/response');

/**
 * Custom roles: the permission catalogue and the checks that use it.
 *
 * A membership with no custom role is untouched: the plain system role (admin / sales / recruiter / bda / employee) decides,
 * exactly as before. A membership WITH a custom role is decided by the role's permissions on every gated endpoint (the ones
 * that call `can()` below), and keeps its role's `base_role` for everything else, so nobody loses a screen they need.
 *
 * A permission value is `true`, or for an action that has a scope: 'own' (records the person owns), 'team' (their own and their
 * team's: direct reports and the teams they lead) or 'all'.
 */
const SCOPES = ['own', 'team', 'all'];

const CATALOG = [
  { module: 'accounts', label: 'Accounts (clients and vendors)', actions: [
    { key: 'accounts.view', label: 'View' },
    { key: 'accounts.create', label: 'Add' },
    { key: 'accounts.update', label: 'Edit', scoped: true },
    { key: 'accounts.delete', label: 'Delete', scoped: true },
  ] },
  { module: 'meetings', label: 'Meetings', actions: [{ key: 'meetings.schedule', label: 'Schedule meetings and interviews' }] },
  { module: 'vendors', label: 'Vendors', actions: [{ key: 'vendors.onboard', label: 'Onboard vendors' }] },
  { module: 'requirements', label: 'Requirements', actions: [
    { key: 'requirements.view', label: 'View' },
    { key: 'requirements.create', label: 'Add' },
    { key: 'requirements.update', label: 'Edit', scoped: true },
    { key: 'requirements.delete', label: 'Delete', scoped: true },
  ] },
  { module: 'profiles', label: 'Profiles (candidates)', actions: [
    { key: 'profiles.view', label: 'View' },
    { key: 'profiles.create', label: 'Add' },
    { key: 'profiles.update', label: 'Edit', scoped: true },
    { key: 'profiles.delete', label: 'Delete', scoped: true },
  ] },
  { module: 'submissions', label: 'Submissions', actions: [
    { key: 'submissions.create', label: 'Submit a profile' },
    { key: 'submissions.update', label: 'Edit and move stages', scoped: true },
  ] },
  { module: 'timesheets', label: 'Timesheets and attendance', actions: [
    { key: 'timesheets.approve', label: 'Check timesheets (everyone)' },
    { key: 'attendance.approve', label: 'Check attendance changes (everyone)' },
  ] },
  { module: 'allocations', label: 'Resource allocation', actions: [{ key: 'allocations.manage', label: 'Allocate people to projects' }] },
  { module: 'financials', label: 'Financials', actions: [
    { key: 'financials.view', label: 'View' },
    { key: 'financials.create', label: 'Add records' },
    { key: 'financials.update', label: 'Update records' },
    { key: 'financials.delete', label: 'Delete records' },
  ] },
  { module: 'increments', label: 'Increments', actions: [{ key: 'increments.receive', label: 'Receive increment reminders' }] },
];

const ACTIONS = new Map(CATALOG.flatMap((m) => m.actions.map((a) => [a.key, a])));
const ALL_KEYS = [...ACTIONS.keys()];

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

module.exports = { SCOPES, CATALOG, ALL_KEYS, ACTIONS, normalizePermissions, hasPermission, decide, can, canAny, canMethod, canOn, teamUserIds, rank };
