const prisma = require('../../config/db');
const { adminPower } = require('../../lib/access/guard');
const { WORKING_STATUSES } = require('../../lib/employmentStatus');

// Employee Feedback (Delphic Global): any employee gives feedback - a suggestion, appreciation, a concern - by name or anonymously, and ONLY the
// board reads it. The board is a list of people an admin names. Nobody else (not even the other admins) sees the feedback; the person who gave it
// sees their own feedback and its status, never the board's notes. Anonymous feedback stores no person at all.

const CATEGORIES = [
  { id: 'suggestion', label: 'Suggestion' },
  { id: 'appreciation', label: 'Appreciation' },
  { id: 'concern', label: 'Concern' },
  { id: 'workplace', label: 'Workplace & culture' },
  { id: 'management', label: 'Management & leadership' },
  { id: 'other', label: 'Other' },
];
const STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'read', label: 'Read' },
  { id: 'actioned', label: 'Action taken' },
  { id: 'closed', label: 'Closed' },
];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const STATUS_IDS = STATUSES.map((s) => s.id);

async function viewer(user) {
  const person = await prisma.user.findUnique({ where: { id: user.id }, select: { is_group_superadmin: true } });
  const groupAdmin = Boolean(person?.is_group_superadmin);
  const board = await prisma.employeeFeedbackBoardMember.findFirst({ where: { org_id: user.org_id, org_membership_id: user.org_membership_id }, select: { id: true } });
  return { isBoard: Boolean(board), canManage: groupAdmin || adminPower(user, 'employee_feedback.manage') };
}

async function memberNames(orgId, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await prisma.orgMembership.findMany({ where: { org_id: orgId, id: { in: list } }, select: { id: true, person: { select: { name: true } } } });
  return new Map(rows.map((m) => [m.id, m.person?.name || '']));
}

async function meta(user) {
  const v = await viewer(user);
  return { categories: CATEGORIES, statuses: STATUSES, is_board: v.isBoard, can_manage: v.canManage };
}

/** Give feedback. Anonymous feedback keeps no person. */
async function submit(user, body) {
  const row = await prisma.employeeFeedback.create({
    data: {
      org_id: user.org_id,
      submitter_membership_id: body.anonymous ? null : user.org_membership_id,
      category: body.category,
      subject: body.subject,
      message: body.message,
    },
  });
  return { id: row.id, anonymous: !row.submitter_membership_id };
}

/** The feedback this person gave by name (never the board's note). Anonymous feedback cannot be listed: nothing ties it to a person. */
async function mine(user) {
  const rows = await prisma.employeeFeedback.findMany({ where: { org_id: user.org_id, submitter_membership_id: user.org_membership_id }, orderBy: { created_at: 'desc' } });
  return rows.map((r) => ({ id: r.id, category: r.category, subject: r.subject, message: r.message, status: r.status, created_at: r.created_at }));
}

/** Board only: all the feedback, with who gave it (or "Anonymous"), filters by status and category, and the count per status. */
async function list(user, q = {}) {
  const v = await viewer(user);
  if (!v.isBoard) return { error: 'forbidden' };
  const where = { org_id: user.org_id, ...(q.status ? { status: q.status } : {}), ...(q.category ? { category: q.category } : {}) };
  const [rows, grouped] = await Promise.all([
    prisma.employeeFeedback.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 }),
    prisma.employeeFeedback.groupBy({ by: ['status'], where: { org_id: user.org_id }, _count: { _all: true } }),
  ]);
  const names = await memberNames(user.org_id, rows.flatMap((r) => [r.submitter_membership_id, r.handled_by_membership_id]));
  const counts = Object.fromEntries(STATUS_IDS.map((s) => [s, 0]));
  for (const g of grouped) counts[g.status] = g._count._all;
  return {
    counts,
    items: rows.map((r) => ({
      id: r.id, category: r.category, subject: r.subject, message: r.message, status: r.status,
      anonymous: !r.submitter_membership_id,
      from: r.submitter_membership_id ? names.get(r.submitter_membership_id) || 'Former employee' : 'Anonymous',
      board_note: r.board_note,
      handled_by: r.handled_by_membership_id ? names.get(r.handled_by_membership_id) || '' : null,
      handled_at: r.handled_at,
      created_at: r.created_at,
    })),
  };
}

/** Board only: set the status and / or write the board's note. */
async function update(user, id, body) {
  const v = await viewer(user);
  if (!v.isBoard) return { error: 'forbidden' };
  const row = await prisma.employeeFeedback.findFirst({ where: { id, org_id: user.org_id } });
  if (!row) return { error: 'not_found' };
  const data = { handled_by_membership_id: user.org_membership_id, handled_at: new Date() };
  if (body.status) data.status = body.status;
  if (body.board_note !== undefined) data.board_note = body.board_note || null;
  await prisma.employeeFeedback.update({ where: { id }, data });
  return { id, status: data.status || row.status };
}

// ---------- the board (admin-editable) ----------

/** The people on the board, and the people who could be added. Needs Employee Feedback > manage (or the group admin). */
async function getBoard(user) {
  const v = await viewer(user);
  if (!v.canManage) return { error: 'forbidden' };
  const members = await prisma.employeeFeedbackBoardMember.findMany({ where: { org_id: user.org_id }, orderBy: { created_at: 'asc' } });
  const names = await memberNames(user.org_id, members.map((m) => m.org_membership_id));
  const people = await prisma.orgMembership.findMany({
    where: { org_id: user.org_id, employment_status: { in: WORKING_STATUSES } },
    select: { id: true, person: { select: { name: true } } },
  });
  return {
    members: members.map((m) => ({ org_membership_id: m.org_membership_id, name: names.get(m.org_membership_id) || '' })),
    people: people.map((p) => ({ id: p.id, name: p.person?.name || '' })).filter((p) => p.name).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Replaces the board with exactly these people. */
async function setBoard(user, membershipIds) {
  const v = await viewer(user);
  if (!v.canManage) return { error: 'forbidden' };
  const ids = [...new Set(membershipIds)];
  if (ids.length && (await prisma.orgMembership.count({ where: { org_id: user.org_id, id: { in: ids } } })) !== ids.length) return { error: 'bad_people' };
  await prisma.$transaction(async (tx) => {
    await tx.employeeFeedbackBoardMember.deleteMany({ where: { org_id: user.org_id } });
    if (ids.length) await tx.employeeFeedbackBoardMember.createMany({ data: ids.map((id) => ({ org_id: user.org_id, org_membership_id: id, added_by: user.id })) });
  });
  return { count: ids.length };
}

module.exports = { CATEGORY_IDS, STATUS_IDS, meta, submit, mine, list, update, getBoard, setBoard };
