const prisma = require('../../config/db');

const ACCOUNT_SELECT = { id: true, name: true };
const CREATOR_SELECT = { id: true, name: true };
const ASSIGNEE_SELECT = { id: true, person: { select: { id: true, name: true } } };

async function createTask(orgId, createdByUserId, { account_id, assignee_membership_id, title, description, due_date }) {
  const account = await prisma.account.findFirst({ where: { id: account_id, org_id: orgId } });
  if (!account) return { error: 'account_not_found' };
  const assignee = await prisma.orgMembership.findFirst({ where: { id: assignee_membership_id, org_id: orgId } });
  if (!assignee) return { error: 'assignee_not_found' };

  const task = await prisma.assignedTask.create({
    data: { org_id: orgId, account_id, assignee_membership_id, created_by: createdByUserId, title, description, due_date },
    include: { account: { select: ACCOUNT_SELECT }, creator: { select: CREATOR_SELECT }, assignee: { select: ASSIGNEE_SELECT } },
  });
  return { task };
}

async function listTasks(orgId, { status, assignee_membership_id, account_id, page, limit }) {
  const where = {
    org_id: orgId,
    ...(status ? { status } : {}),
    ...(assignee_membership_id ? { assignee_membership_id } : {}),
    ...(account_id ? { account_id } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.assignedTask.findMany({
      where,
      orderBy: [{ status: 'asc' }, { due_date: 'asc' }, { created_at: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: { account: { select: ACCOUNT_SELECT }, creator: { select: CREATOR_SELECT }, assignee: { select: ASSIGNEE_SELECT } },
    }),
    prisma.assignedTask.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

async function listMyTasks(orgMembershipId, { status } = {}) {
  return prisma.assignedTask.findMany({
    where: { assignee_membership_id: orgMembershipId, ...(status ? { status } : {}) },
    orderBy: [{ status: 'asc' }, { due_date: 'asc' }, { created_at: 'desc' }],
    include: { account: { select: ACCOUNT_SELECT }, creator: { select: CREATOR_SELECT } },
  });
}

// Admin may patch any field; a plain assignee may only move their own task's
// status (route layer picks the schema — this just enforces who owns it).
async function updateTask(orgId, taskId, actor, patch) {
  const task = await prisma.assignedTask.findFirst({ where: { id: taskId, org_id: orgId } });
  if (!task) return { error: 'not_found' };

  const isAdmin = actor.role === 'admin';
  const isAssignee = task.assignee_membership_id === actor.org_membership_id;
  if (!isAdmin && !isAssignee) return { error: 'forbidden' };

  const updated = await prisma.assignedTask.update({
    where: { id: taskId },
    data: patch,
    include: { account: { select: ACCOUNT_SELECT }, creator: { select: CREATOR_SELECT }, assignee: { select: ASSIGNEE_SELECT } },
  });
  return { task: updated };
}

module.exports = { createTask, listTasks, listMyTasks, updateTask };
