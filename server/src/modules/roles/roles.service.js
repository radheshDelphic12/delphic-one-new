const prisma = require('../../config/db');
const { CATALOG, normalizePermissions } = require('../../lib/permissions');

// Custom roles (Settings > Roles & permissions). Per company; the permission catalogue is the same for every company.

const BASE_ROLES = ['admin', 'sales', 'recruiter', 'bda', 'employee'];

const BDE = { 'accounts.view': true, 'accounts.create': true, 'meetings.schedule': true };
const SALES = { 'accounts.view': true, 'requirements.view': true, 'requirements.create': true, 'requirements.update': 'own' };
const HR = { 'profiles.view': true, 'profiles.create': true, 'profiles.update': 'own', 'submissions.create': true, 'submissions.update': 'own', 'vendors.onboard': true, 'meetings.schedule': true };
const ADMIN = { 'timesheets.approve': true, 'attendance.approve': true };

/** The starting roles the owner asked for. Created only when missing; later edits to them are never overwritten. */
const STARTER_ROLES = [
  { name: 'BDE', base_role: 'bda', description: 'Adds accounts (clients and vendors) and schedules meetings.', permissions: BDE },
  { name: 'Sales', base_role: 'sales', description: 'Adds requirements for their assigned clients.', permissions: SALES },
  { name: 'Sales Admin', base_role: 'sales', description: 'BDE and Sales permissions, plus create and update for their team members.', permissions: { ...BDE, ...SALES, 'accounts.update': 'team', 'requirements.update': 'team' } },
  { name: 'Sales Super Admin', base_role: 'sales', description: 'BDE and Sales permissions, plus create, update and delete for everyone.', permissions: { ...BDE, ...SALES, 'accounts.update': 'all', 'accounts.delete': 'all', 'requirements.update': 'all', 'requirements.delete': 'all' } },
  { name: 'HR', base_role: 'recruiter', description: 'Adds profiles, does submissions, onboards vendors and schedules meetings.', permissions: HR },
  { name: 'HR Admin', base_role: 'recruiter', description: 'HR permissions, plus create and update for their team members.', permissions: { ...HR, 'profiles.update': 'team', 'submissions.update': 'team' } },
  { name: 'HR Super Admin', base_role: 'recruiter', description: 'HR permissions, plus create, update and delete for everyone.', permissions: { ...HR, 'profiles.update': 'all', 'profiles.delete': 'all', 'submissions.update': 'all' } },
  { name: 'IT Employee', base_role: 'employee', description: 'The current employee permissions (self-service).', permissions: {} },
  { name: 'Admin', base_role: 'admin', description: 'Checks timesheets and attendance changes for everyone.', permissions: ADMIN },
  { name: 'Super Admin', base_role: 'admin', description: 'Everything Admin does, plus resource allocation, viewing financials and adding, updating and deleting financial records.', permissions: { ...ADMIN, 'allocations.manage': true, 'financials.view': true, 'financials.create': true, 'financials.update': true, 'financials.delete': true, 'increments.receive': true } },
];

/**
 * Who the owner named for each starter role, matched by EMPLOYEE CODE (never by first name). The name is only a cross-check:
 * the preview shows the code, the email and whether the name on file agrees.
 */
const EXPECTED = [
  { code: 'E0036', name: 'Dheeraj Kumar', role: 'BDE' },
  { code: 'E0035', name: 'Chahak Pandya', role: 'Sales' },
  { code: 'E0037', name: 'Tanvi Saxena', role: 'Sales Admin' },
  { code: 'E0034', name: 'Biswajit Dey', role: 'Sales Super Admin' },
  { code: 'E0003', name: 'Krupali Vala', role: 'HR' },
  { code: 'E0005', name: 'Prashant Singh Hada', role: 'HR Admin' },
  { code: 'E0001', name: 'Diksha Yadav', role: 'HR Super Admin' },
  { code: 'E0008', name: 'Abhishek Jain', role: 'IT Employee' },
];
const SUPER_ADMIN_NAME = 'paras gulati';
const IT_DEPARTMENT = /\b(it|information technology|software|engineering|tech(nology)?)\b/i;

const serialize = (r, count) => ({ id: r.id, name: r.name, description: r.description, base_role: r.base_role, permissions: r.permissions || {}, is_starter: r.is_starter, members: count ?? r._count?.members ?? 0, updated_at: r.updated_at });

function catalog() {
  return CATALOG;
}

async function list(orgId) {
  const rows = await prisma.customRole.findMany({ where: { org_id: orgId }, orderBy: { name: 'asc' }, include: { _count: { select: { members: true } } } });
  return rows.map((r) => serialize(r));
}

async function members(orgId, roleId) {
  const rows = await prisma.orgMembership.findMany({ where: { org_id: orgId, custom_role_id: roleId }, select: { id: true, person_id: true, person: { select: { name: true, email: true } } } });
  return rows.map((m) => ({ user_id: m.person_id, org_membership_id: m.id, name: m.person?.name, email: m.person?.email }));
}

async function create(orgId, actorId, { name, description, base_role, permissions }) {
  if (!BASE_ROLES.includes(base_role || 'employee')) return { error: 'bad_base_role' };
  const clash = await prisma.customRole.findFirst({ where: { org_id: orgId, name: { equals: name, mode: 'insensitive' } } });
  if (clash) return { error: 'name_taken' };
  const row = await prisma.customRole.create({ data: { org_id: orgId, name, description: description || null, base_role: base_role || 'employee', permissions: normalizePermissions(permissions), created_by: actorId } });
  return { role: serialize(row, 0) };
}

/** Pushes a role's base role onto its holders so every plain-role check (and the screens) follow it. */
async function syncHolders(orgId, role) {
  const holders = await prisma.orgMembership.findMany({ where: { org_id: orgId, custom_role_id: role.id }, select: { id: true, person_id: true } });
  if (!holders.length) return;
  await prisma.orgMembership.updateMany({ where: { id: { in: holders.map((h) => h.id) } }, data: { role: role.base_role } });
  await prisma.user.updateMany({ where: { id: { in: holders.map((h) => h.person_id) } }, data: { role: role.base_role } });
}

async function update(orgId, roleId, { name, description, base_role, permissions }) {
  const existing = await prisma.customRole.findFirst({ where: { id: roleId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (base_role !== undefined && !BASE_ROLES.includes(base_role)) return { error: 'bad_base_role' };
  if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await prisma.customRole.findFirst({ where: { org_id: orgId, name: { equals: name, mode: 'insensitive' }, NOT: { id: roleId } } });
    if (clash) return { error: 'name_taken' };
  }
  const row = await prisma.customRole.update({
    where: { id: roleId },
    data: { ...(name ? { name } : {}), ...(description !== undefined ? { description: description || null } : {}), ...(base_role ? { base_role } : {}), ...(permissions ? { permissions: normalizePermissions(permissions) } : {}) },
    include: { _count: { select: { members: true } } },
  });
  if (base_role && base_role !== existing.base_role) await syncHolders(orgId, row);
  return { role: serialize(row) };
}

async function remove(orgId, roleId) {
  const existing = await prisma.customRole.findFirst({ where: { id: roleId, org_id: orgId }, include: { _count: { select: { members: true } } } });
  if (!existing) return { error: 'not_found' };
  if (existing._count.members) return { error: 'in_use', members: existing._count.members };
  await prisma.customRole.delete({ where: { id: roleId } });
  return { id: roleId };
}

/** Gives a person a custom role (or takes it away with null). Their plain role becomes the role's base role, so existing screens keep working. */
async function assign(orgId, membershipId, roleId) {
  const membership = await prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId }, select: { id: true, person_id: true, worker_type: true } });
  if (!membership) return { error: 'membership_not_found' };
  if (membership.worker_type === 'contractor') return { error: 'contractor' };
  if (!roleId) {
    await prisma.orgMembership.update({ where: { id: membershipId }, data: { custom_role_id: null } });
    return { ok: true };
  }
  const role = await prisma.customRole.findFirst({ where: { id: roleId, org_id: orgId } });
  if (!role) return { error: 'not_found' };
  await prisma.$transaction([
    prisma.orgMembership.update({ where: { id: membershipId }, data: { custom_role_id: role.id, role: role.base_role } }),
    prisma.user.update({ where: { id: membership.person_id }, data: { role: role.base_role } }),
  ]);
  return { ok: true };
}

async function installStarterRoles(orgId, actorId) {
  const existing = new Set((await prisma.customRole.findMany({ where: { org_id: orgId }, select: { name: true } })).map((r) => r.name.toLowerCase()));
  const created = [];
  for (const r of STARTER_ROLES) {
    if (existing.has(r.name.toLowerCase())) continue;
    await prisma.customRole.create({ data: { org_id: orgId, name: r.name, description: r.description, base_role: r.base_role, permissions: normalizePermissions(r.permissions), is_starter: true, created_by: actorId } });
    created.push(r.name);
  }
  return { created };
}

const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const sameName = (a, b) => norm(a) === norm(b);

/**
 * The proposed mapping, written nowhere. Every working, non-contractor person of the company appears exactly once:
 *  - `named`: the people the owner named, found by employee code, with code + email + whether the name agrees;
 *  - `super_admin`: Paras Gulati's accounts and which one gets Super Admin (the company account, never the group account);
 *  - `suggested`: everyone else by department and current role (IT employees -> IT Employee, recruiters -> HR, ...);
 *  - `unmapped`: anyone who does not map cleanly. They keep their current access until the owner decides.
 * Group Super Admin accounts keep Group Super Admin and are never given a company role.
 */
async function mappingPreview(orgId) {
  const people = await prisma.orgMembership.findMany({
    where: { org_id: orgId, employment_status: { in: ['active', 'on_leave', 'notice_period'] }, worker_type: { not: 'contractor' } },
    select: { id: true, role: true, employee_code: true, custom_role: { select: { name: true } }, department: { select: { name: true } }, person: { select: { name: true, email: true, is_group_superadmin: true } } },
    orderBy: { employee_code: 'asc' },
  });
  const baseOf = Object.fromEntries(STARTER_ROLES.map((r) => [r.name, r.base_role]));
  const row = (m, extra = {}) => ({
    org_membership_id: m.id, name: m.person?.name || null, email: m.person?.email || null, employee_code: m.employee_code || null,
    department: m.department?.name || null, current_role: m.role, current_custom_role: m.custom_role?.name || null,
    is_group_superadmin: m.person?.is_group_superadmin || false, ...extra,
  });
  const taken = new Set();

  const named = EXPECTED.map((e) => {
    const m = people.find((x) => norm(x.employee_code) === norm(e.code));
    const base = { expected_code: e.code, expected_name: e.name, role: e.role, new_base_role: baseOf[e.role] };
    if (!m) return { ...base, status: 'not_found', person: null };
    taken.add(m.id);
    return { ...base, status: sameName(m.person?.name, e.name) ? 'match' : 'name_differs', person: row(m, { base_role_changes: m.role !== baseOf[e.role] }) };
  });

  const paras = people.filter((m) => norm(m.person?.name) === SUPER_ADMIN_NAME);
  const company = paras.filter((m) => !m.person?.is_group_superadmin);
  const superAdmin = {
    role: 'Super Admin', new_base_role: baseOf['Super Admin'],
    accounts: paras.map((m) => row(m)),
    // the company account gets it; the group account keeps Group Super Admin. Only proposed when exactly one company account exists.
    proposed: company.length === 1 ? row(company[0], { base_role_changes: company[0].role !== baseOf['Super Admin'] }) : null,
    status: company.length === 1 ? 'match' : company.length === 0 ? 'not_found' : 'ambiguous',
  };
  paras.forEach((m) => taken.add(m.id));

  const suggested = [];
  const unmapped = [];
  for (const m of people) {
    if (taken.has(m.id)) continue;
    if (m.person?.is_group_superadmin) { unmapped.push(row(m, { reason: 'Group Super Admin account: keeps Group Super Admin, no company role' })); continue; }
    const dept = m.department?.name || '';
    let role = null;
    let reason = '';
    if (m.role === 'employee' && IT_DEPARTMENT.test(dept)) { role = 'IT Employee'; reason = `IT department (${dept}), plain employee`; }
    else if (m.role === 'recruiter') { role = 'HR'; reason = 'Recruiter'; }
    else if (m.role === 'bda') { role = 'BDE'; reason = 'BDA'; }
    else if (m.role === 'sales') { role = 'Sales'; reason = 'Sales'; }
    if (role) suggested.push(row(m, { proposed_role: role, new_base_role: baseOf[role], reason, base_role_changes: m.role !== baseOf[role] }));
    else unmapped.push(row(m, { reason: m.role === 'admin' ? 'Admin with no named role: keeps current admin access' : `${m.role === 'employee' ? 'Employee outside IT' : m.role}${dept ? ` (${dept})` : ''}: keeps current access` }));
  }
  return { named, super_admin: superAdmin, suggested, unmapped, summary: { named_found: named.filter((n) => n.person).length, named_total: named.length, suggested: suggested.length, unmapped: unmapped.length } };
}

/** Applies a confirmed mapping: [{ org_membership_id, role_name }]. Installs the starter roles first if they are missing. Group Super Admin accounts are refused. */
async function applyMapping(orgId, actorId, assignments) {
  await installStarterRoles(orgId, actorId);
  const results = [];
  for (const a of assignments) {
    const holder = await prisma.orgMembership.findFirst({ where: { id: a.org_membership_id, org_id: orgId }, select: { person: { select: { is_group_superadmin: true } } } });
    if (holder?.person?.is_group_superadmin) { results.push({ ...a, error: 'group_super_admin' }); continue; }
    const role = await prisma.customRole.findFirst({ where: { org_id: orgId, name: { equals: a.role_name, mode: 'insensitive' } } });
    if (!role) { results.push({ ...a, error: 'role_not_found' }); continue; }
    const r = await assign(orgId, a.org_membership_id, role.id);
    results.push({ ...a, ...(r.error ? { error: r.error } : { ok: true }) });
  }
  return results;
}

module.exports = { BASE_ROLES, STARTER_ROLES, catalog, list, members, create, update, remove, assign, installStarterRoles, mappingPreview, applyMapping };
