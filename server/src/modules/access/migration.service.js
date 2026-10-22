const crypto = require('crypto');
const prisma = require('../../config/db');
const { ACTIONS } = require('../../lib/permissions');
const { levelOf, everything } = require('../../lib/access/effective');
const { currentAccess, materializeSet, diffPermissions, ROLE_EQUIVALENT } = require('../../lib/access/legacyMap');
const rolesService = require('../roles/roles.service');

const WORKING = ['active', 'on_leave', 'notice_period'];
const LOCK_DAYS = 30;
const BACKUP_MAX_AGE_MS = 24 * 3600 * 1000;
const ADMIN_NAME = 'paras gulati';
const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const full = (keys) => Object.fromEntries(keys.map((k) => [k, ACTIONS.get(k)?.scoped ? 'all' : true]));

// The two sets the proposal describes for HR and Sales leads. They are suggestions in the preview: the Super Admin can swap
// either for another set (or basic access only) before approving.
const HR_LEAD = {
  name: 'HR Lead', base_role: 'admin',
  description: 'HR work: people (full), attendance and leave for the team, onboarding, applicants and the pipeline. No finance.',
  permissions: {
    ...full(['people.create', 'people.delete', 'users.view', 'hr_settings.view', 'hr_settings.update', 'holidays.view', 'holidays.update', 'attendance_dashboard.view', 'project_team.view',
      'leave.update', 'timesheets.approve', 'overtime.approve', 'regularization.approve', 'allocations.view', 'assets.view',
      'accounts.view', 'requirements.view', 'pipeline.view', 'profiles.view', 'profiles.create', 'profiles.update', 'submissions.view', 'submissions.create', 'submissions.update',
      'rejected.view', 'applicants.view', 'applicants.update', 'meetings.schedule', 'vendors.onboard', 'reports.view']),
    'people.view': 'all', 'people.update': 'all', 'attendance.view': 'team', 'attendance.update': 'team', 'attendance.approve': true,
    'regularization.view': 'team', 'leave.view': 'all', 'leave.approve': 'all', 'timesheets.view': 'team', 'overtime.view': 'team',
  },
};
const SALES_TEAM = {
  name: 'Sales Team', base_role: 'sales',
  description: 'Sales work: accounts, requirements, the pipeline and sales reports.',
  permissions: full(['accounts.view', 'accounts.create', 'accounts.update', 'accounts.delete', 'requirements.view', 'requirements.create', 'requirements.update', 'requirements.delete',
    'pipeline.view', 'profiles.view', 'submissions.view', 'rejected.view', 'applicants.view', 'meetings.schedule', 'vendors.onboard', 'reports.view', 'reports.export', 'business.view']),
};
const CURATED = { 'E0001': HR_LEAD, 'E0034': SALES_TEAM }; // Diksha Yadav, Biswajit Dey (employee codes, as the owner named them)

const LEGACY_SETS = {
  admin: { name: 'Legacy Admin', base_role: 'admin', description: 'Everything a plain Admin could do before (review and trim).' },
  sales: { name: 'Legacy Sales', base_role: 'sales', description: 'What a Sales user could do before.' },
  recruiter: { name: 'Legacy Recruiter', base_role: 'recruiter', description: 'What a Recruiter could do before.' },
  bda: { name: 'Legacy BDA', base_role: 'bda', description: 'What a BDA could do before.' },
};

const memberSelect = {
  id: true, role: true, employee_code: true, is_leave_manager: true, custom_role_id: true, legacy_locked_until: true,
  department: { select: { name: true } },
  custom_role: { select: { id: true, name: true, base_role: true, permissions: true } },
  person: { select: { id: true, name: true, email: true, role: true, is_superadmin: true, is_group_superadmin: true } },
};

const named = Object.fromEntries(rolesService.EXPECTED.map((e) => [e.code, e]));

function setFor(m) {
  const code = m.employee_code;
  if (code && CURATED[code]) return { ...CURATED[code], source: 'named' };
  if (code && named[code]) {
    const starter = rolesService.STARTER_ROLES.find((s) => s.name === named[code].role);
    if (starter) return { name: starter.name, base_role: starter.base_role, description: starter.description, permissions: materializeSet({ baseRole: starter.base_role, ticks: starter.permissions }), source: 'named' };
  }
  if (m.custom_role) return { name: m.custom_role.name, base_role: m.custom_role.base_role, permissions: materializeSet({ baseRole: m.custom_role.base_role, ticks: m.custom_role.permissions }), source: 'custom_role' };
  const legacy = LEGACY_SETS[m.role];
  if (legacy) return { ...legacy, permissions: { ...ROLE_EQUIVALENT[m.role] }, source: 'plain_role' };
  return null; // employee: default basic access only
}

/** The company Admin: exactly one account. Proposed when exactly one Paras Gulati company account exists; otherwise the owner chooses. */
function adminCandidates(people) {
  const company = people.filter((m) => !m.person.is_group_superadmin);
  const byName = company.filter((m) => norm(m.person.name) === ADMIN_NAME && (m.person.is_superadmin || m.role === 'admin'));
  const flagged = company.filter((m) => m.person.is_superadmin && m.role === 'admin');
  const pool = [...new Map([...byName, ...flagged].map((m) => [m.id, m])).values()];
  const proposed = byName.length === 1 ? byName[0] : null;
  return { proposed, pool, status: proposed ? 'match' : pool.length ? 'choose' : 'none' };
}

const brief = (m) => ({ org_membership_id: m.id, name: m.person.name, email: m.person.email, employee_code: m.employee_code });

/**
 * The proposed move to the permission model for one company, written nowhere. Every working, non-contractor person appears once,
 * with what they have today, what they would have, and a flag if it goes down. Nothing is applied from here.
 */
async function preview(orgId) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { id: true, name: true, access_mode: true, org_group_id: true } });
  const people = await prisma.orgMembership.findMany({ where: { org_id: orgId, employment_status: { in: WORKING }, worker_type: { not: 'contractor' } }, select: memberSelect, orderBy: { employee_code: 'asc' } });
  const admin = adminCandidates(people);
  const groupAccounts = await prisma.user.count({ where: { is_group_superadmin: true, active: true } });

  const rows = people.map((m) => {
    const isGroup = m.person.is_group_superadmin;
    const isAdmin = admin.proposed?.id === m.id;
    const before = isGroup || m.person.is_superadmin ? everything() : currentAccess({ role: m.role, customRole: m.custom_role });
    const base = { ...brief(m), department: m.department?.name || null, current: { role: m.role, custom_role: m.custom_role?.name || null, is_superadmin: m.person.is_superadmin, is_group_superadmin: isGroup } };
    if (isGroup) return { ...base, proposed: { level: 'super_admin', set: null }, flags: [], diff: { lost: [], narrowed: [], gained: [] }, note: 'The one Super Admin' };
    if (isAdmin) return { ...base, proposed: { level: 'admin', set: null }, flags: [], diff: { lost: [], narrowed: [], gained: [] }, note: 'Admin of this company' };
    const set = setFor(m);
    const after = set ? set.permissions : {};
    const diff = diffPermissions(before, after);
    const flags = [];
    if (diff.lost.length || diff.narrowed.length) flags.push('access_down');
    if (diff.gained.length) flags.push('access_up');
    if (m.person.is_superadmin) flags.push('was_admin');
    return { ...base, proposed: { level: 'employee', set: set ? { name: set.name, source: set.source } : null }, flags, diff };
  });

  const sets = new Map();
  for (const m of people) {
    const s = !m.person.is_group_superadmin && admin.proposed?.id !== m.id ? setFor(m) : null;
    if (s && !sets.has(s.name)) sets.set(s.name, { name: s.name, base_role: s.base_role, description: s.description || null, permissions: s.permissions, source: s.source });
  }
  const existing = new Set((await prisma.customRole.findMany({ where: { org_id: orgId }, select: { name: true } })).map((r) => r.name.toLowerCase()));

  const fingerprint = JSON.stringify({ a: admin.proposed?.id || null, p: rows.map((r) => [r.org_membership_id, r.proposed.level, r.proposed.set?.name || null]) });
  return {
    org: { id: org.id, name: org.name, access_mode: org.access_mode },
    admin: { status: admin.status, proposed: admin.proposed ? brief(admin.proposed) : null, candidates: admin.pool.map(brief) },
    super_admin_accounts: groupAccounts,
    people: rows,
    sets: [...sets.values()].map((s) => ({ ...s, exists: existing.has(s.name.toLowerCase()) })),
    summary: { total: rows.length, access_down: rows.filter((r) => r.flags.includes('access_down')).length, access_up: rows.filter((r) => r.flags.includes('access_up')).length, was_admin: rows.filter((r) => r.flags.includes('was_admin')).length },
    plan_hash: crypto.createHash('sha256').update(fingerprint).digest('hex'),
  };
}

/** Step 1: the export of everyone's access, stored so it can be restored. */
async function backup(orgId, actorId, note) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { id: true, name: true, access_mode: true } });
  const memberships = await prisma.orgMembership.findMany({
    where: { org_id: orgId },
    select: { id: true, role: true, employee_code: true, custom_role_id: true, is_leave_manager: true, employment_status: true, person: { select: { id: true, name: true, email: true, role: true, is_superadmin: true, is_group_superadmin: true } } },
  });
  const roles = await prisma.customRole.findMany({ where: { org_id: orgId }, select: { id: true, name: true, base_role: true, permissions: true, is_starter: true } });
  const grants = await prisma.permissionGrant.findMany({ where: { org_id: orgId }, select: { org_membership_id: true, key: true, scope: true, effect: true } });
  const snapshot = {
    taken_at: new Date().toISOString(), org,
    memberships: memberships.map((m) => ({ id: m.id, name: m.person.name, email: m.person.email, employee_code: m.employee_code, status: m.employment_status, membership_role: m.role, user_role: m.person.role, user_id: m.person.id, custom_role_id: m.custom_role_id, is_superadmin: m.person.is_superadmin, is_group_superadmin: m.person.is_group_superadmin, is_leave_manager: m.is_leave_manager })),
    custom_roles: roles, grants,
  };
  const row = await prisma.accessBackup.create({ data: { org_id: orgId, taken_by: actorId, note: note || null, snapshot } });
  return { id: row.id, created_at: row.created_at, people: snapshot.memberships.length, roles: roles.length };
}

async function latestBackup(orgId) {
  return prisma.accessBackup.findFirst({ where: { org_id: orgId }, orderBy: { created_at: 'desc' } });
}

/**
 * Applies a previewed move for one company, after the owner approved (and maybe edited) it.
 *
 * Args:
 *   body.plan_hash: the hash from the preview the owner looked at (the proposal must not have changed since).
 *   body.admin_membership_id: the company's one Admin account.
 *   body.assignments: [{ org_membership_id, set_name | null }] - the set each employee ends up with (null = basic access only).
 */
async function apply(orgId, actorId, body) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { id: true, access_mode: true } });
  if (org.access_mode === 'permissions') return { error: 'already_applied' };
  const bk = await latestBackup(orgId);
  if (!bk || Date.now() - bk.created_at.getTime() > BACKUP_MAX_AGE_MS) return { error: 'backup_required' };

  const plan = await preview(orgId);
  if (plan.plan_hash !== body.plan_hash) return { error: 'plan_changed' };
  const adminM = plan.people.find((p) => p.org_membership_id === body.admin_membership_id);
  if (!adminM || plan.people.find((p) => p.current.is_group_superadmin && p.org_membership_id === body.admin_membership_id)) return { error: 'admin_required' };

  await rolesService.installStarterRoles(orgId, actorId);
  const people = await prisma.orgMembership.findMany({ where: { org_id: orgId, employment_status: { in: WORKING }, worker_type: { not: 'contractor' } }, select: memberSelect });
  const wanted = new Map(body.assignments.map((a) => [a.org_membership_id, a.set_name || null]));
  const lockUntil = new Date(Date.now() + LOCK_DAYS * 24 * 3600 * 1000);

  // Every set to be given: created when missing, rewritten (ticks + what the base role gave) when it is a converted custom role.
  const wantedSets = new Map();
  for (const m of people) {
    if (m.person.is_group_superadmin || m.id === body.admin_membership_id) continue;
    const name = wanted.has(m.id) ? wanted.get(m.id) : (setFor(m)?.name || null);
    if (!name) continue;
    const def = [HR_LEAD, SALES_TEAM].find((s) => s.name === name) || null;
    const proposed = people.map(setFor).find((s) => s && s.name === name) || (def ? { ...def } : null);
    const starter = rolesService.STARTER_ROLES.find((s) => s.name === name);
    const held = !proposed && !starter ? await prisma.customRole.findFirst({ where: { org_id: orgId, name: { equals: name, mode: 'insensitive' } } }) : null;
    const fallback = proposed
      || (starter ? { name, base_role: starter.base_role, description: starter.description, permissions: materializeSet({ baseRole: starter.base_role, ticks: starter.permissions }) } : null)
      || (held ? { name: held.name, base_role: held.base_role, permissions: materializeSet({ baseRole: held.base_role, ticks: held.permissions }) } : null);
    if (!fallback) return { error: 'unknown_set', set_name: name };
    wantedSets.set(name, fallback);
  }

  await prisma.$transaction(async (tx) => {
    const ids = new Map();
    for (const [name, def] of wantedSets) {
      const found = await tx.customRole.findFirst({ where: { org_id: orgId, name: { equals: name, mode: 'insensitive' } } });
      if (found) {
        await tx.customRole.update({ where: { id: found.id }, data: { permissions: def.permissions, base_role: def.base_role, ...(def.description ? { description: def.description } : {}) } });
        ids.set(name, found.id);
      } else {
        const made = await tx.customRole.create({ data: { org_id: orgId, name, description: def.description || null, base_role: def.base_role, permissions: def.permissions, created_by: actorId } });
        ids.set(name, made.id);
      }
    }
    for (const m of people) {
      const isGroup = m.person.is_group_superadmin;
      const isAdmin = m.id === body.admin_membership_id;
      const setName = isGroup || isAdmin ? null : (wanted.has(m.id) ? wanted.get(m.id) : (setFor(m)?.name || null));
      await tx.orgMembership.update({
        where: { id: m.id },
        data: { legacy_role: m.role, legacy_custom_role_id: m.custom_role_id, legacy_was_superadmin: m.person.is_superadmin, legacy_locked_until: lockUntil, custom_role_id: setName ? ids.get(setName) : null },
      });
      if (isAdmin) {
        await tx.orgMembership.update({ where: { id: m.id }, data: { role: 'admin' } });
        await tx.user.update({ where: { id: m.person.id }, data: { is_superadmin: true, role: 'admin' } });
      } else if (!isGroup && m.person.is_superadmin) {
        await tx.user.update({ where: { id: m.person.id }, data: { is_superadmin: false } });
      }
    }
    // The starter sets that stood for the account levels are gone: nobody holds Admin or Super Admin as a set any more.
    for (const name of ['Admin', 'Super Admin']) {
      const r = await tx.customRole.findFirst({ where: { org_id: orgId, name, is_starter: true }, include: { _count: { select: { members: true } } } });
      if (r && !r._count.members) await tx.customRole.delete({ where: { id: r.id } });
    }
    await tx.org.update({ where: { id: orgId }, data: { access_mode: 'permissions', access_applied_at: new Date(), access_applied_by: actorId } });
  });
  return { ok: true, people: people.length, sets: [...wantedSets.keys()], locked_until: lockUntil };
}

/** Puts a company back exactly as its latest backup recorded it (roles, custom roles, flags). Only while the read-only window is open. */
async function restore(orgId) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { access_mode: true } });
  if (org.access_mode !== 'permissions') return { error: 'not_applied' };
  const bk = await prisma.accessBackup.findFirst({ where: { org_id: orgId, snapshot: { path: ['org', 'access_mode'], equals: 'legacy' } }, orderBy: { created_at: 'desc' } });
  if (!bk) return { error: 'no_backup' };
  const still = await prisma.orgMembership.count({ where: { org_id: orgId, legacy_locked_until: { gt: new Date() } } });
  if (!still) return { error: 'window_closed' };
  const snap = bk.snapshot;
  await prisma.$transaction(async (tx) => {
    const snapIds = new Set(snap.custom_roles.map((r) => r.id));
    for (const r of snap.custom_roles) {
      await tx.customRole.upsert({ where: { id: r.id }, create: { id: r.id, org_id: orgId, name: r.name, base_role: r.base_role, permissions: r.permissions, is_starter: r.is_starter }, update: { name: r.name, base_role: r.base_role, permissions: r.permissions } });
    }
    for (const m of snap.memberships) {
      await tx.orgMembership.update({ where: { id: m.id }, data: { role: m.membership_role, custom_role_id: m.custom_role_id, legacy_role: null, legacy_custom_role_id: null, legacy_was_superadmin: null, legacy_locked_until: null } });
      await tx.user.update({ where: { id: m.user_id }, data: { role: m.user_role, is_superadmin: m.is_superadmin } });
    }
    await tx.permissionGrant.deleteMany({ where: { org_id: orgId } });
    await tx.customRole.deleteMany({ where: { org_id: orgId, id: { notIn: [...snapIds] }, members: { none: {} } } });
    await tx.org.update({ where: { id: orgId }, data: { access_mode: 'legacy', access_applied_at: null, access_applied_by: null } });
  });
  return { ok: true, restored_from: bk.created_at };
}

/** After the 30 days: end the restore window and drop the Admin value from the role of everyone who is not the Admin or Super Admin. */
async function cleanupStatus(orgId) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { access_mode: true, access_applied_at: true } });
  const open = await prisma.orgMembership.count({ where: { org_id: orgId, legacy_locked_until: { gt: new Date() } } });
  const pending = await prisma.orgMembership.count({ where: { org_id: orgId, legacy_locked_until: { not: null } } });
  return { applied: org.access_mode === 'permissions', applied_at: org.access_applied_at, window_open: open > 0, pending, ready: org.access_mode === 'permissions' && pending > 0 && open === 0 };
}

async function cleanup(orgId) {
  const st = await cleanupStatus(orgId);
  if (!st.applied) return { error: 'not_applied' };
  if (st.window_open) return { error: 'window_open' };
  const { deriveLegacyRole } = require('../../lib/access/effective');
  const people = await prisma.orgMembership.findMany({ where: { org_id: orgId, legacy_locked_until: { not: null } }, select: { id: true, role: true, person: { select: { id: true, is_superadmin: true, is_group_superadmin: true } }, custom_role: { select: { base_role: true, permissions: true } } } });
  let changed = 0;
  await prisma.$transaction(async (tx) => {
    for (const m of people) {
      if (levelOf(m.person, m.role) === 'employee' && m.role === 'admin') {
        const role = deriveLegacyRole({ level: 'employee', setBaseRole: m.custom_role?.base_role, permissions: m.custom_role?.permissions || {} });
        await tx.orgMembership.update({ where: { id: m.id }, data: { role } });
        await tx.user.update({ where: { id: m.person.id }, data: { role } });
        changed += 1;
      }
      await tx.orgMembership.update({ where: { id: m.id }, data: { legacy_role: null, legacy_custom_role_id: null, legacy_was_superadmin: null, legacy_locked_until: null } });
    }
  });
  return { ok: true, people: people.length, role_changed: changed };
}

/** Group view for the Super Admin: every company, its mode and its Admin account. */
async function status(groupIds) {
  const orgs = await prisma.org.findMany({ where: { org_group_id: { in: groupIds } }, select: { id: true, name: true, slug: true, access_mode: true, access_applied_at: true }, orderBy: { name: 'asc' } });
  const out = [];
  for (const o of orgs) {
    const admins = await prisma.orgMembership.findMany({
      where: { org_id: o.id, employment_status: { in: WORKING }, role: 'admin', person: { is_superadmin: true, is_group_superadmin: false, active: true } },
      select: { id: true, person: { select: { name: true, email: true } } },
    });
    const bk = await latestBackup(o.id);
    out.push({
      org_id: o.id, name: o.name, slug: o.slug, access_mode: o.access_mode, applied_at: o.access_applied_at,
      admin_accounts: admins.map((a) => ({ org_membership_id: a.id, name: a.person.name, email: a.person.email })),
      admin_status: admins.length === 1 ? 'one' : admins.length ? 'many' : 'none',
      last_backup: bk ? bk.created_at : null,
    });
  }
  return out;
}

module.exports = { preview, backup, apply, restore, cleanupStatus, cleanup, status, HR_LEAD, SALES_TEAM, LOCK_DAYS };
