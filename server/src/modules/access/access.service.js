const prisma = require('../../config/db');
const { CATEGORIES, CATALOG, BASIC_ITEMS, BASIC_SET, ACTIONS, SCOPES } = require('../../lib/permissions');
const { levelOf, effectivePermissions, deriveLegacyRole } = require('../../lib/access/effective');

const WORKING = ['active', 'on_leave', 'notice_period'];

/** The catalogue as the permission editor shows it: categories > modules > actions, plus the default basic access. */
function catalog() {
  return {
    categories: CATEGORIES.map((c) => ({ ...c, modules: CATALOG.filter((m) => m.category === c.key).map((m) => ({ module: m.module, label: m.label, admin_default: Boolean(m.adminDefault), actions: m.actions })) })),
    basic: BASIC_ITEMS,
    scopes: SCOPES,
  };
}

/** What the signed-in person sees of their own access: level, permissions, the basic items they still have. */
function me(user) {
  if (user.access) return { ...user.access, set: user.access.set || null };
  return { mode: 'legacy', level: levelOf({ is_superadmin: user.is_superadmin, is_group_superadmin: user.is_group_superadmin }, user.role), permissions: null, basic: null, set: null };
}

/** The signed-in person's level, read live from the database (the JWT never carries it). */
async function actorLevel(userId, role) {
  const person = await prisma.user.findUnique({ where: { id: userId }, select: { is_superadmin: true, is_group_superadmin: true, active: true } });
  if (!person || !person.active) return 'employee';
  return levelOf(person, role);
}

const memberSelect = {
  id: true, role: true, employee_code: true, is_leave_manager: true, worker_type: true, employment_status: true,
  legacy_role: true, legacy_locked_until: true,
  department: { select: { name: true } }, designation: { select: { name: true } },
  custom_role: { select: { id: true, name: true, permissions: true, base_role: true } },
  person: { select: { id: true, name: true, email: true, is_superadmin: true, is_group_superadmin: true } },
};

/** Everyone in the company with their level and set: the left side of Settings > Permissions. */
async function people(orgId) {
  const rows = await prisma.orgMembership.findMany({
    where: { org_id: orgId, employment_status: { in: WORKING }, worker_type: { not: 'contractor' } },
    select: { ...memberSelect, _count: { select: { permission_grants: true } } },
    orderBy: [{ employee_code: 'asc' }],
  });
  return rows.map((m) => ({
    org_membership_id: m.id, user_id: m.person.id, name: m.person.name, email: m.person.email, employee_code: m.employee_code,
    department: m.department?.name || null, job_title: m.designation?.name || null,
    level: levelOf(m.person, m.role), set: m.custom_role ? { id: m.custom_role.id, name: m.custom_role.name } : null,
    grants: m._count.permission_grants, legacy_role: m.legacy_role, is_leave_manager: m.is_leave_manager,
  }));
}

async function loadTarget(orgId, membershipId) {
  return prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId }, select: memberSelect });
}

/** One person: their set, grants, removals and what that adds up to. */
async function person(orgId, membershipId) {
  const m = await loadTarget(orgId, membershipId);
  if (!m) return { error: 'membership_not_found' };
  const level = levelOf(m.person, m.role);
  const grants = await prisma.permissionGrant.findMany({ where: { org_membership_id: m.id }, orderBy: { key: 'asc' }, select: { key: true, scope: true, effect: true } });
  const eff = effectivePermissions({ level, setPermissions: m.custom_role?.permissions, grants, isLeaveManager: m.is_leave_manager });
  return {
    person: { org_membership_id: m.id, name: m.person.name, email: m.person.email, employee_code: m.employee_code, department: m.department?.name || null, job_title: m.designation?.name || null },
    level,
    set: m.custom_role ? { id: m.custom_role.id, name: m.custom_role.name, permissions: m.custom_role.permissions } : null,
    grants: grants.filter((g) => g.effect === 'grant').map((g) => ({ key: g.key, value: g.scope === 'true' ? true : g.scope })),
    removed: grants.filter((g) => g.effect === 'deny').map((g) => g.key),
    effective: { permissions: eff.permissions, basic: eff.basic },
    legacy_role: m.legacy_role, legacy_locked_until: m.legacy_locked_until,
  };
}

/** The desired grants/removals from the request, cleaned: known keys only, a valid scope, nothing for basic keys in grants. */
function cleanDesired({ grants, removed }) {
  const wanted = new Map();
  for (const [key, raw] of Object.entries(grants || {})) {
    const action = ACTIONS.get(key);
    if (!action || !raw) continue;
    if (action.scoped) wanted.set(key, SCOPES.includes(raw) ? raw : raw === true ? 'all' : null);
    else wanted.set(key, 'true');
    if (!wanted.get(key)) wanted.delete(key);
  }
  const gone = new Set((removed || []).filter((k) => ACTIONS.has(k) || BASIC_SET.has(k)));
  for (const key of wanted.keys()) gone.delete(key); // one row per person and key: a grant wins over a removal
  return { wanted, gone };
}

const labelFor = (key) => {
  const a = ACTIONS.get(key);
  if (a) return `${key} (${a.label})`;
  return BASIC_ITEMS.find((b) => b.key === key)?.label || key;
};

/**
 * Change one person's set, grants and removals. `dryRun` returns the same diff without saving (the preview before saving).
 * Super Admin: anyone, in any company (the company they have open). Admin: employees of their own company. Employees: never.
 */
async function savePerson(orgId, actor, membershipId, body, { dryRun = false } = {}) {
  const level = await actorLevel(actor.id, actor.role);
  if (level === 'employee') return { error: 'forbidden' };
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { access_mode: true } });
  if (org?.access_mode !== 'permissions') return { error: 'not_migrated' };
  const target = await loadTarget(orgId, membershipId);
  if (!target) return { error: 'membership_not_found' };
  if (target.worker_type === 'contractor') return { error: 'contractor' };
  const targetLevel = levelOf(target.person, target.role);
  if (targetLevel !== 'employee') return { error: 'target_is_admin' };

  let setRow = target.custom_role;
  if (body.set_id !== undefined) {
    setRow = body.set_id ? await prisma.customRole.findFirst({ where: { id: body.set_id, org_id: orgId }, select: { id: true, name: true, permissions: true, base_role: true } }) : null;
    if (body.set_id && !setRow) return { error: 'set_not_found' };
  }

  const current = await prisma.permissionGrant.findMany({ where: { org_membership_id: target.id } });
  const currentGrant = new Map(current.filter((g) => g.effect === 'grant').map((g) => [g.key, g.scope]));
  const currentGone = new Set(current.filter((g) => g.effect === 'deny').map((g) => g.key));
  const { wanted, gone } = cleanDesired({ grants: body.grants ?? Object.fromEntries([...currentGrant].map(([k, s]) => [k, s === 'true' ? true : s])), removed: body.removed ?? [...currentGone] });

  const diff = { set: { from: target.custom_role?.name || null, to: setRow?.name || null }, granted: [], revoked: [], changed: [], removed: [], restored: [] };
  for (const [key, scope] of wanted) {
    if (!currentGrant.has(key)) diff.granted.push({ key, scope });
    else if (currentGrant.get(key) !== scope) diff.changed.push({ key, from: currentGrant.get(key), to: scope });
  }
  for (const key of currentGrant.keys()) if (!wanted.has(key)) diff.revoked.push({ key });
  for (const key of gone) if (!currentGone.has(key)) diff.removed.push({ key });
  for (const key of currentGone) if (!gone.has(key)) diff.restored.push({ key });

  const grantsAfter = [...wanted].map(([key, scope]) => ({ key, scope, effect: 'grant' })).concat([...gone].map((key) => ({ key, scope: 'true', effect: 'deny' })));
  const after = effectivePermissions({ level: 'employee', setPermissions: setRow?.permissions, grants: grantsAfter, isLeaveManager: target.is_leave_manager });
  const result = { diff, effective: { permissions: after.permissions, basic: after.basic }, legacy_role: deriveLegacyRole({ level: 'employee', setBaseRole: setRow?.base_role, permissions: after.permissions }) };
  const nothing = !diff.granted.length && !diff.revoked.length && !diff.changed.length && !diff.removed.length && !diff.restored.length && diff.set.from === diff.set.to;
  if (dryRun || nothing) return { ...result, saved: false };

  // One write per grant, so the change log shows who gave what to whom and when. Rows are found by id (one row per person and key).
  const forLog = target.person.name;
  const rowOf = new Map(current.map((g) => [g.key, g]));
  const write = async (key, scope, effect, label) => {
    const row = rowOf.get(key);
    if (row) await prisma.permissionGrant.update({ where: { id: row.id }, data: { scope, effect, label, granted_by: actor.id } });
    else await prisma.permissionGrant.create({ data: { org_id: orgId, org_membership_id: target.id, key, scope, effect, label, granted_by: actor.id } });
  };
  if (diff.set.from !== diff.set.to) await prisma.orgMembership.update({ where: { id: target.id }, data: { custom_role_id: setRow?.id || null } });
  for (const g of diff.granted) await write(g.key, g.scope, 'grant', `${forLog}: ${labelFor(g.key)}`);
  for (const c of diff.changed) await write(c.key, c.to, 'grant', `${forLog}: ${labelFor(c.key)}`);
  for (const k of diff.removed) await write(k.key, 'true', 'deny', `${forLog}: removed ${labelFor(k.key)}`);
  const rewritten = new Set([...diff.granted, ...diff.changed, ...diff.removed].map((k) => k.key));
  for (const k of [...diff.revoked, ...diff.restored]) {
    if (rewritten.has(k.key)) continue; // its row was just rewritten as the other kind
    await prisma.permissionGrant.delete({ where: { id: rowOf.get(k.key).id } });
  }
  return { ...result, saved: true };
}

module.exports = { WORKING, catalog, me, actorLevel, people, person, savePerson };
