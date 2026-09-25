const bcrypt = require('bcryptjs');
const prisma = require('../../config/db');

const PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  active: true,
  is_superadmin: true,
  is_group_superadmin: true,
  department_id: true,
  created_at: true,
  department: { select: { id: true, name: true } },
};

async function countActiveSuperadmins() {
  return prisma.user.count({ where: { is_superadmin: true, active: true } });
}

// A missing orgId (no resolved OrgMembership — the legacy, pre-Phase-1
// global-role caller resolveOrgContext deliberately never blocks, see
// middleware/auth.js) falls back to unscoped: every user, same as before
// multi-tenancy existed. Never becomes 403/empty — that's the documented,
// user-confirmed "fail open" convention this whole module follows.
function activeOrgMembership(orgId) {
  return orgId ? { org_memberships: { some: { org_id: orgId, employment_status: 'active' } } } : {};
}

async function getById(orgId, id) {
  return prisma.user.findFirst({ where: { id, ...activeOrgMembership(orgId) }, select: PUBLIC_SELECT });
}

async function list(orgId, { role, active, search, department_id, page = 1, limit = 20 }) {
  const where = {
    ...activeOrgMembership(orgId),
    ...(role ? { role } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(department_id ? { department_id } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: PUBLIC_SELECT,
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    }),
  ]);

  return { rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// Full lightweight roster for pickers/filters — no secrets, no pagination.
async function listDirectory(orgId, { role, active } = {}) {
  return prisma.user.findMany({
    where: {
      ...activeOrgMembership(orgId),
      ...(role ? { role } : {}),
      ...(active !== undefined ? { active } : {}),
    },
    select: { id: true, name: true, role: true, active: true },
    orderBy: { name: 'asc' },
  });
}

async function create(orgId, { name, email, password, role, phone, department_id }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: 'email_taken' };
  if (department_id) {
    const department = await prisma.department.findFirst({ where: { id: department_id, org_id: orgId } });
    if (!department) return { error: 'department_not_found' };
  }

  const password_hash = await bcrypt.hash(password, 10);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name,
        email,
        password_hash,
        role,
        phone: phone || null,
        department_id: department_id || null,
      },
      select: { id: true },
    });
    await tx.orgMembership.create({
      data: { person_id: created.id, org_id: orgId, role, department_id: department_id || null },
    });
    return tx.user.findUnique({ where: { id: created.id }, select: PUBLIC_SELECT });
  });
  return { user };
}

async function update(orgId, id, patch, actor = {}) {
  const target = await prisma.user.findFirst({ where: { id, ...activeOrgMembership(orgId) } });
  if (!target) return { error: 'not_found' };
  if (Object.prototype.hasOwnProperty.call(patch, 'department_id') && patch.department_id) {
    const department = await prisma.department.findFirst({ where: { id: patch.department_id, org_id: orgId } });
    if (!department) return { error: 'department_not_found' };
  }

  if ('is_superadmin' in patch && !actor.is_superadmin) return { error: 'forbidden_superadmin_field' };
  if (patch.password !== undefined && !actor.is_superadmin) return { error: 'forbidden_password' };
  if (target.is_superadmin && !actor.is_superadmin) return { error: 'forbidden_edit_superadmin' };

  const stripsPowers =
    patch.is_superadmin === false || patch.active === false || (patch.role && patch.role !== 'admin');
  if (target.is_superadmin && stripsPowers && (await countActiveSuperadmins()) <= 1) {
    return { error: 'last_superadmin' };
  }

  if (patch.email) {
    const clash = await prisma.user.findFirst({ where: { email: patch.email, NOT: { id } } });
    if (clash) return { error: 'email_taken' };
  }

  const data = { ...patch };
  if (data.password) {
    data.password_hash = await bcrypt.hash(data.password, 10);
    delete data.password;
  }

  const user = await prisma.user.update({ where: { id }, data, select: PUBLIC_SELECT });
  if (patch.role || Object.prototype.hasOwnProperty.call(patch, 'department_id')) {
    await prisma.orgMembership.updateMany({
      where: { person_id: id, org_id: orgId },
      data: {
        ...(patch.role ? { role: patch.role } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'department_id')
          ? { department_id: patch.department_id }
          : {}),
      },
    });
  }
  return { user };
}

/**
 * Reverse-chronological list of stage/status changes the given user has made,
 * across accounts, requirements, seats, and submissions. Read-only; powers the
 * "Activity" tab on the Settings page.
 */
async function listActivity(userId, orgId, { limit = 50 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await prisma.stageHistory.findMany({
    where: { changed_by: userId, org_id: orgId },
    orderBy: { changed_at: 'desc' },
    take,
  });

  const ids = { account: new Set(), requirement: new Set(), seat: new Set(), submission: new Set() };
  rows.forEach((r) => ids[r.entity_type]?.add(r.entity_id));

  const [accounts, requirements, seats, submissions] = await Promise.all([
    ids.account.size
      ? prisma.account.findMany({ where: { id: { in: [...ids.account] }, org_id: orgId }, select: { id: true, name: true } })
      : [],
    ids.requirement.size
      ? prisma.requirement.findMany({ where: { id: { in: [...ids.requirement] }, org_id: orgId }, select: { id: true, title: true } })
      : [],
    ids.seat.size
      ? prisma.requirementSeat.findMany({
          where: { id: { in: [...ids.seat] }, requirement: { org_id: orgId } },
          select: { id: true, requirement: { select: { title: true } } },
        })
      : [],
    ids.submission.size
      ? prisma.submission.findMany({
          where: { id: { in: [...ids.submission] }, org_id: orgId },
          select: {
            id: true,
            profile: { select: { name: true } },
            seat: { select: { requirement: { select: { title: true } } } },
          },
        })
      : [],
  ]);

  const label = {
    account: Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    requirement: Object.fromEntries(requirements.map((r) => [r.id, r.title])),
    seat: Object.fromEntries(seats.map((s) => [s.id, s.requirement?.title || 'Seat'])),
    submission: Object.fromEntries(
      submissions.map((s) => [
        s.id,
        `${s.profile?.name || 'Candidate'} → ${s.seat?.requirement?.title || 'Requirement'}`,
      ])
    ),
  };

  return rows.map((r) => ({
    id: r.id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    entity_label: label[r.entity_type]?.[r.entity_id] || null,
    from_stage: r.from_stage,
    to_stage: r.to_stage,
    reason: r.reason,
    changed_at: r.changed_at,
  }));
}

module.exports = { getById, list, listDirectory, create, update, countActiveSuperadmins, listActivity };
