const { ALL_KEYS, ACTIONS, BASIC_KEYS, MODULE_OF, rank } = require('../permissions');

/**
 * Who someone is, and what they can do, in a company that has moved to the permission model.
 *
 *  - Super Admin: the one account flagged `is_group_superadmin`. Everything, in every company. Cannot be restricted.
 *  - Admin: the company's account flagged `is_superadmin` (with the admin role). Everything inside that company.
 *  - Employee: everyone else. Default basic access + the permission set they hold + their own grants - their own removals.
 */
function levelOf(person, role) {
  if (person?.is_group_superadmin) return 'super_admin';
  if (person?.is_superadmin && role === 'admin') return 'admin';
  return 'employee';
}

const higher = (a, b) => (rank(a) >= rank(b) ? a : b);

/** Every catalogue permission at its widest scope. */
function everything() {
  const out = {};
  for (const key of ALL_KEYS) out[key] = ACTIONS.get(key).scoped ? 'all' : true;
  return out;
}

/** A grant's stored scope ('true' | own | team | all) as a permission value for that key. */
function valueOf(key, scope) {
  if (!ACTIONS.get(key)?.scoped) return true;
  return scope === 'own' || scope === 'team' ? scope : 'all';
}

/**
 * The permissions a person ends up with.
 *
 * Args:
 *   level: 'super_admin' | 'admin' | 'employee'.
 *   setPermissions: the permission set's `permissions` object (or null).
 *   grants: PermissionGrant rows ({ key, scope, effect }) for the person.
 *   isLeaveManager: the Leave Manager flag (processes leave for the whole company).
 *
 * Returns:
 *   { permissions, basic } - `permissions` maps catalogue keys to true / own / team / all; `basic` is the list of default basic
 *   access items the person still has (a removal takes one away).
 */
function effectivePermissions({ level, setPermissions, grants = [], isLeaveManager = false }) {
  if (level !== 'employee') return { permissions: everything(), basic: [...BASIC_KEYS], denied: [] };
  const permissions = {};
  for (const [key, value] of Object.entries(setPermissions || {})) {
    if (ACTIONS.has(key) && value) permissions[key] = value;
  }
  const denied = [];
  for (const g of grants) {
    if (g.effect === 'deny') { denied.push(g.key); continue; }
    if (!ACTIONS.has(g.key)) continue;
    const v = valueOf(g.key, g.scope);
    permissions[g.key] = permissions[g.key] ? higher(permissions[g.key], v) : v;
  }
  for (const key of denied) delete permissions[key];
  if (isLeaveManager) {
    permissions['leave.view'] = 'all';
    permissions['leave.approve'] = 'all';
  }
  return { permissions, basic: BASIC_KEYS.filter((k) => !denied.includes(k)), denied };
}

// The checks written before this model (`can('financials.view')` and friends) read these keys. They are derived here and never
// shown in the permission editor, so a person given Payroll does not also look like they were given Billing in the screens.
const FINANCE_MODULES = ['finance', 'payroll', 'billing', 'analytics', 'financials'];
const VERB_OF = { view: 'view', create: 'create', update: 'update', delete: 'delete', approve: 'update', export: 'view' };

/** The permission map the older gates read: the canonical permissions plus the aliases those gates still ask for. */
function legacyPermissions(permissions) {
  const out = { ...permissions };
  for (const key of Object.keys(permissions)) {
    const [module, action] = key.split('.');
    if (FINANCE_MODULES.includes(module) && VERB_OF[action]) {
      const alias = `financials.${VERB_OF[action]}`;
      out[alias] = out[alias] || true;
    }
  }
  const has = (...keys) => keys.some((k) => permissions[k]);
  if (has('attendance.view', 'attendance.update', 'attendance.approve', 'regularization.view', 'regularization.approve')) out['attendance.approve'] = true;
  if (has('timesheets.view', 'timesheets.update', 'timesheets.approve', 'timesheets.lock')) out['timesheets.approve'] = true;
  if (has('allocations.view', 'allocations.manage')) out['allocations.manage'] = true;
  return out;
}

// The older plain role each kind of permission needs for the gates that still ask for a role (`authorize('recruiter', 'admin')`).
const RECRUITER_MODULES = new Set(['profiles', 'submissions', 'pipeline', 'rejected', 'applicants']);
const ADMIN_CATEGORIES = new Set(['people', 'time', 'finance', 'reports', 'administration']);

/**
 * The plain role for the older gates. It is derived, never chosen: the permission set's own base role (kept from the migration)
 * and whatever the person's permissions imply. A person who needs two different roles gets 'admin', the role the others allow;
 * the central route guard still limits them to the modules they were given.
 */
function deriveLegacyRole({ level, setBaseRole, permissions }) {
  if (level !== 'employee') return 'admin';
  const roles = new Set();
  if (setBaseRole && setBaseRole !== 'employee') roles.add(setBaseRole);
  for (const key of Object.keys(permissions || {})) {
    const mod = MODULE_OF.get(key);
    if (!mod) continue;
    // Being able to look at a module implies no role; doing things in it does.
    if (key.endsWith('.view') && !ADMIN_CATEGORIES.has(mod.category)) continue;
    if (ADMIN_CATEGORIES.has(mod.category) || mod.module === 'website') roles.add('admin');
    else if (mod.module === 'requirements') roles.add('sales');
    else if (RECRUITER_MODULES.has(mod.module)) roles.add('recruiter');
    else if (mod.module === 'accounts' || mod.module === 'meetings' || mod.module === 'vendors') roles.add('bda');
  }
  if (roles.has('admin') || roles.size > 1) return 'admin';
  return roles.values().next().value || 'employee';
}

module.exports = { levelOf, effectivePermissions, legacyPermissions, deriveLegacyRole, everything };
