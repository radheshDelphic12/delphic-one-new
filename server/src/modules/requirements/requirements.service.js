const prisma = require('../../config/db');
const { STUCK_THRESHOLD_DAYS } = require('../../config/constants');
const { notify, requirementParticipants, admins } = require('../../lib/notifications');
const {
  REQUIREMENT_STATUS_TRANSITIONS,
  SEAT_STATUS_TRANSITIONS,
} = require('./stageMachines');

/**
 * A requirement counts as "stuck" when it is still active (open / in-progress) and has had
 * no update — no stage change or edit — for STUCK_THRESHOLD_DAYS. Mirrors the "no movement"
 * rule used for stuck leads and stuck submissions.
 */
const STUCK_STATUSES = ['open', 'in_progress'];

/**
 * "Client submissions" = candidates that have actually reached the client on this
 * requirement. Deliberately excludes sourced / internal_screening (not yet shown
 * to the client) and closed / backout / rejected (no longer in play). Range is
 * submitted_to_client → bgv inclusive.
 */
const CLIENT_SUBMISSION_STAGES = [
  'submitted_to_client',
  'interview_scheduled',
  'interview_result',
  'offer_sent',
  'bgv',
];

function stuckCutoff() {
  return new Date(Date.now() - STUCK_THRESHOLD_DAYS * 86400000);
}

function isStuck(row) {
  return (
    STUCK_STATUSES.includes(row.status)
    && row.updated_at != null
    && new Date(row.updated_at) <= stuckCutoff()
  );
}

function serialize(row) {
  if (!row) return null;
  const { account_id, account, sales_owner_id, sales_owner, assignments, seats, ...rest } = row;

  const seats_total = row.seats_total;
  const seats_closed = seats ? seats.filter((s) => s.seat_status === 'closed').length : undefined;
  // Candidates that reached the client on this requirement (submitted_to_client → bgv),
  // summed across all its seats. The seats._count.submissions is stage-filtered in
  // DECORATE_INCLUDE, so this is not a full submission count.
  const client_submissions_count = seats
    ? seats.reduce((sum, s) => sum + (s._count?.submissions || 0), 0)
    : undefined;

  return {
    ...rest,
    is_stuck: isStuck(row),
    account: account ? { id: account.id, name: account.name, type: account.type } : undefined,
    sales_owner: sales_owner ? { id: sales_owner.id, name: sales_owner.name } : undefined,
    assigned_recruiters: assignments
      ? assignments
          .filter((a) => a.role_on_req === 'recruiter')
          .map((a) => ({ id: a.user.id, name: a.user.name, assigned_at: a.assigned_at }))
      : undefined,
    assigned_vendor_team: assignments
      ? assignments
          .filter((a) => a.role_on_req === 'vendor_team')
          .map((a) => ({ id: a.user.id, name: a.user.name, assigned_at: a.assigned_at }))
      : undefined,
    seats_total,
    seats_closed,
    client_submissions_count,
  };
}

const DECORATE_INCLUDE = {
  account: { select: { id: true, name: true, type: true } },
  sales_owner: { select: { id: true, name: true } },
  assignments: {
    where: { role_on_req: { in: ['recruiter', 'vendor_team'] }, unassigned_at: null },
    include: { user: { select: { id: true, name: true } } },
  },
  seats: {
    select: {
      seat_status: true,
      _count: { select: { submissions: { where: { stage: { in: CLIENT_SUBMISSION_STAGES } } } } },
    },
  },
};

async function list(filters) {
  const { status, req_type, account_id, sales_owner_id, recruiter_id, priority, work_mode, stuck, closed_from, closed_to, tech_stack, search, sort_by, sort_order, page, limit } = filters;

  const stuckClause = { status: { in: STUCK_STATUSES }, updated_at: { lte: stuckCutoff() } };

  const closedRange = {};
  if (closed_from) closedRange.gte = new Date(closed_from);
  if (closed_to) closedRange.lte = new Date(closed_to);

  const where = {
    ...(status ? { status } : {}),
    ...(stuck === 'stuck' ? { AND: [stuckClause] } : {}),
    ...(stuck === 'not_stuck' ? { NOT: [stuckClause] } : {}),
    ...(Object.keys(closedRange).length ? { closed_at: closedRange } : {}),
    ...(req_type ? { req_type } : {}),
    ...(account_id ? { account_id } : {}),
    ...(sales_owner_id ? { sales_owner_id } : {}),
    ...(priority ? { priority } : {}),
    ...(work_mode ? { work_mode } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { designation: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(tech_stack
      ? {
          OR: [
            { primary_tech_stack: { hasSome: tech_stack.split(',').map((s) => s.trim()) } },
            { secondary_tech_stack: { hasSome: tech_stack.split(',').map((s) => s.trim()) } },
          ],
        }
      : {}),
    ...(recruiter_id
      ? { assignments: { some: { user_id: recruiter_id, role_on_req: 'recruiter', unassigned_at: null } } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.requirement.count({ where }),
    prisma.requirement.findMany({
      where,
      include: DECORATE_INCLUDE,
      orderBy: { [sort_by]: sort_order },
      take: limit,
      skip: (page - 1) * limit,
    }),
  ]);

  return { rows: rows.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function getById(id) {
  const row = await prisma.requirement.findUnique({ where: { id }, include: DECORATE_INCLUDE });
  return serialize(row);
}

function canMutateRequirement(requirement, user) {
  if (!requirement) return false;
  if (user.role === 'admin') return true;
  // The whole Sales team manages every requirement (edit, status, assign, seats, delete); each action is tagged with who did it.
  return user.role === 'sales';
}

async function create(data, salesOwnerId, actor = null) {
  const account = await prisma.account.findUnique({ where: { id: data.account_id } });
  if (!account || account.type !== 'client' || account.stage !== 'active') {
    return { error: 'invalid_account' };
  }

  const { seats_total = 1, ...rest } = data;

  const row = await prisma.requirement.create({
    data: {
      ...rest,
      seats_total,
      sales_owner_id: salesOwnerId,
      seats: {
        create: Array.from({ length: seats_total }, (_, i) => ({ seat_label: `Seat ${i + 1}` })),
      },
    },
    include: DECORATE_INCLUDE,
  });

  const recipientIds = [
    ...(await requirementParticipants(prisma, row.id)),
    ...(await admins(prisma)),
  ];
  await notify(prisma, {
    type: 'requirement_created',
    actorId: actor?.id || salesOwnerId,
    recipientIds,
    context: {
      actorName: actor?.name,
      requirementTitle: row.title,
      requirementId: row.id,
      accountName: account.name,
    },
  });

  return { requirement: serialize(row) };
}

const OWNER_ROLES = ['sales', 'bda', 'admin'];

// ---- who did what ----
// Every change to a requirement by a person writes one audit_logs row (entity_type 'requirement'), so the detail page can
// say "edited by Tanvi, 3 Oct". Status moves are already in stage_history; both are merged by getActivity().
const FIELD_LABEL = { title: 'title', description: 'description', req_type: 'type', priority: 'priority', work_mode: 'work mode', location: 'location', tech_stack: 'tech stack', sales_owner_id: 'sales owner' };
async function logActivity(user, requirementId, action, reason, snapshot = {}) {
  await prisma.auditLog.create({ data: { actor_id: user.id, action, entity_type: 'requirement', entity_id: requirementId, reason, snapshot } });
}
const plain = (v) => (v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(', ') : v);
function changedFields(before, after, patch) {
  const out = {};
  for (const key of Object.keys(patch)) {
    const a = JSON.stringify(plain(before[key]) ?? null);
    const b = JSON.stringify(plain(after[key]) ?? null);
    if (a !== b) out[FIELD_LABEL[key] || key] = { from: plain(before[key]) ?? null, to: plain(after[key]) ?? null };
  }
  return out;
}

async function update(id, patch, user) {
  const existing = await prisma.requirement.findUnique({ where: { id } });
  if (!existing) return { error: 'not_found' };
  if (!canMutateRequirement(existing, user)) return { error: 'forbidden' };

  if (patch.sales_owner_id && patch.sales_owner_id !== existing.sales_owner_id) {
    if (user.role !== 'admin') return { error: 'forbidden_owner_change' };
    const target = await prisma.user.findUnique({ where: { id: patch.sales_owner_id } });
    if (!target || !target.active) return { error: 'user_not_found' };
    if (!OWNER_ROLES.includes(target.role)) return { error: 'invalid_owner_role' };
  }

  const row = await prisma.requirement.update({ where: { id }, data: patch, include: DECORATE_INCLUDE });
  const changes = changedFields(existing, row, patch);
  if (Object.keys(changes).length) await logActivity(user, id, 'update', `Edited ${Object.keys(changes).join(', ')}`, { changes });
  return { requirement: serialize(row) };
}

async function changeStatus(id, { to_status, reason }, user) {
  return prisma.$transaction(async (tx) => {
    const requirement = await tx.requirement.findUnique({ where: { id } });
    if (!requirement) return { error: 'not_found' };
    if (!canMutateRequirement(requirement, user)) return { error: 'forbidden' };
    if (requirement.is_locked) return { error: 'locked' };
    if (!(REQUIREMENT_STATUS_TRANSITIONS[requirement.status] || []).includes(to_status)) return { error: 'invalid_transition' };
    if (to_status === 'dropped' && !reason) return { error: 'reason_required' };

    if (to_status === 'closed') {
      const openSeats = await tx.requirementSeat.count({
        where: { requirement_id: id, seat_status: { notIn: ['closed', 'dropped'] } },
      });
      if (openSeats > 0) return { error: 'seats_not_closed' };
    }

    const patch = { status: to_status };
    if (to_status === 'dropped') patch.is_locked = true;
    if (to_status === 'closed') {
      patch.is_locked = true;
      patch.closed_at = new Date();
    }

    const updated = await tx.requirement.update({ where: { id }, data: patch, include: DECORATE_INCLUDE });

    await tx.stageHistory.create({
      data: {
        entity_type: 'requirement',
        entity_id: id,
        from_stage: requirement.status,
        to_stage: to_status,
        changed_by: user.id,
        reason: reason || null,
      },
    });

    await notify(tx, {
      type: 'requirement_status_changed',
      actorId: user.id,
      recipientIds: await requirementParticipants(tx, id),
      context: {
        actorName: user.name,
        requirementTitle: updated.title,
        requirementId: id,
        accountName: updated.account?.name,
        toStatus: to_status,
      },
    });

    return { requirement: serialize(updated) };
  });
}

// Superadmin-only: move a requirement to any status — backward, or out of the
// terminal `closed` / `dropped` states — ignoring ownership, the lock, the
// transition map, and the seats-closed gate. Still audited in stage_history.
async function changeStatusOverride(id, { to_status, reason, is_locked }, user) {
  return prisma.$transaction(async (tx) => {
    const requirement = await tx.requirement.findUnique({ where: { id } });
    if (!requirement) return { error: 'not_found' };

    const patch = { status: to_status };
    if (is_locked !== undefined) patch.is_locked = is_locked;
    if (to_status === 'closed') {
      patch.closed_at = new Date();
    } else {
      patch.closed_at = null;
    }

    const updated = await tx.requirement.update({
      where: { id },
      data: patch,
      include: DECORATE_INCLUDE,
    });

    await tx.stageHistory.create({
      data: {
        entity_type: 'requirement',
        entity_id: id,
        from_stage: requirement.status,
        to_stage: to_status,
        changed_by: user.id,
        reason: `[override] ${reason}`,
      },
    });

    return { requirement: serialize(updated) };
  });
}

async function assign(requirementId, { user_id, role_on_req }, assignedByUser) {
  const requirement = await prisma.requirement.findUnique({ where: { id: requirementId } });
  if (!requirement) return { error: 'not_found' };
  if (!canMutateRequirement(requirement, assignedByUser)) return { error: 'forbidden' };

  const target = await prisma.user.findUnique({ where: { id: user_id } });
  if (!target) return { error: 'user_not_found' };
  // sales/recruiter assignments must match the user's actual account role; vendor_team
  // is a cross-functional tag (anyone sourcing from vendors) so any user qualifies.
  if (role_on_req !== 'vendor_team' && target.role !== role_on_req) return { error: 'role_mismatch' };

  const existing = await prisma.requirementAssignment.findFirst({
    where: { requirement_id: requirementId, user_id, role_on_req, unassigned_at: null },
  });
  if (existing) return { error: 'already_assigned' };

  const row = await prisma.requirementAssignment.create({
    data: { requirement_id: requirementId, user_id, role_on_req, assigned_by: assignedByUser.id },
  });

  await notify(prisma, {
    type: 'requirement_assigned',
    actorId: assignedByUser.id,
    recipientIds: [user_id],
    context: {
      actorName: assignedByUser.name,
      requirementTitle: requirement.title,
      requirementId,
    },
  });

  return {
    assignment: {
      id: row.id,
      user: { id: target.id, name: target.name, role: target.role },
      role_on_req: row.role_on_req,
      assigned_at: row.assigned_at,
      assigned_by: { id: assignedByUser.id },
    },
  };
}

async function unassign(requirementId, assignmentId, user) {
  const requirement = await prisma.requirement.findUnique({ where: { id: requirementId } });
  if (!requirement) return { error: 'not_found' };
  if (!canMutateRequirement(requirement, user)) return { error: 'forbidden' };

  const assignment = await prisma.requirementAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.requirement_id !== requirementId) return { error: 'not_found' };

  await prisma.requirementAssignment.update({ where: { id: assignmentId }, data: { unassigned_at: new Date() } });

  await notify(prisma, {
    type: 'requirement_unassigned',
    actorId: user.id,
    recipientIds: [assignment.user_id],
    context: {
      actorName: user.name,
      requirementTitle: requirement.title,
      requirementId,
    },
  });

  return { ok: true };
}

async function getAssignments(requirementId) {
  const rows = await prisma.requirementAssignment.findMany({
    where: { requirement_id: requirementId },
    include: {
      user: { select: { id: true, name: true, role: true } },
      assigned_by_user: { select: { id: true, name: true } },
    },
    orderBy: { assigned_at: 'desc' },
  });

  return rows.map((r) => ({
    id: r.id,
    user: r.user,
    role_on_req: r.role_on_req,
    assigned_at: r.assigned_at,
    unassigned_at: r.unassigned_at,
    assigned_by: r.assigned_by_user,
  }));
}

async function getHistory(id) {
  const rows = await prisma.stageHistory.findMany({
    where: { entity_type: 'requirement', entity_id: id },
    orderBy: { changed_at: 'asc' },
    include: { changed_by_user: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    from_stage: r.from_stage,
    to_stage: r.to_stage,
    changed_by: r.changed_by_user,
    reason: r.reason,
    changed_at: r.changed_at,
  }));
}

async function getSeats(requirementId) {
  const seats = await prisma.requirementSeat.findMany({ where: { requirement_id: requirementId } });
  const seatIds = seats.map((s) => s.id);

  const [counts, activeCounts] = await Promise.all([
    seatIds.length
      ? prisma.submission.groupBy({ by: ['requirement_seat_id'], where: { requirement_seat_id: { in: seatIds } }, _count: { id: true } })
      : [],
    seatIds.length
      ? prisma.submission.groupBy({
          by: ['requirement_seat_id'],
          where: { requirement_seat_id: { in: seatIds }, stage: { notIn: ['rejected', 'backout'] } },
          _count: { id: true },
        })
      : [],
  ]);

  const countMap = new Map(counts.map((c) => [c.requirement_seat_id, c._count.id]));
  const activeMap = new Map(activeCounts.map((c) => [c.requirement_seat_id, c._count.id]));

  return seats.map((s) => ({
    ...s,
    submissions_count: countMap.get(s.id) || 0,
    active_submissions_count: activeMap.get(s.id) || 0,
  }));
}

async function addSeat(requirementId, { seat_label }, user) {
  const requirement = await prisma.requirement.findUnique({ where: { id: requirementId } });
  if (!requirement) return { error: 'not_found' };
  if (!canMutateRequirement(requirement, user)) return { error: 'forbidden' };

  return prisma.$transaction(async (tx) => {
    const seat = await tx.requirementSeat.create({ data: { requirement_id: requirementId, seat_label: seat_label || null } });
    await tx.requirement.update({ where: { id: requirementId }, data: { seats_total: { increment: 1 } } });
    return { seat };
  });
}

async function changeSeatStatus(seatId, { to_status, reason, joined_at }, userId) {
  return prisma.$transaction(async (tx) => {
    const seat = await tx.requirementSeat.findUnique({ where: { id: seatId } });
    if (!seat) return { error: 'not_found' };
    if (seat.is_locked) return { error: 'locked' };
    if (!(SEAT_STATUS_TRANSITIONS[seat.seat_status] || []).includes(to_status)) return { error: 'invalid_transition' };
    if (to_status === 'dropped' && !reason) return { error: 'reason_required' };
    if (to_status === 'closed' && !joined_at) return { error: 'joined_at_required' };

    const patch = { seat_status: to_status };
    if (to_status === 'closed') {
      patch.is_locked = true;
      patch.closed_at = new Date();
      patch.joined_at = new Date(joined_at);
    }
    if (to_status === 'dropped') {
      patch.is_locked = true;
      patch.closed_at = new Date();
    }

    const updated = await tx.requirementSeat.update({ where: { id: seatId }, data: patch });

    await tx.stageHistory.create({
      data: {
        entity_type: 'seat',
        entity_id: seatId,
        from_stage: seat.seat_status,
        to_stage: to_status,
        changed_by: userId,
        reason: reason || null,
      },
    });

    const remainingOpen = await tx.requirementSeat.count({
      where: { requirement_id: seat.requirement_id, seat_status: { notIn: ['closed', 'dropped'] } },
    });
    if (remainingOpen === 0) {
      const req = await tx.requirement.findUnique({ where: { id: seat.requirement_id } });
      if (req && !['closed', 'dropped'].includes(req.status)) {
        await tx.requirement.update({
          where: { id: seat.requirement_id },
          data: { status: 'closed', is_locked: true, closed_at: new Date() },
        });
      }
    }

    return { seat: updated };
  });
}

/** Soft delete by the Sales team / admin: hidden from every list, kept in the database with who deleted it and why. */
async function remove(id, reason, user) {
  const existing = await prisma.requirement.findUnique({ where: { id } });
  if (!existing) return { error: 'not_found' };
  if (!canMutateRequirement(existing, user)) return { error: 'forbidden' };
  await prisma.$transaction(async (tx) => {
    await tx.requirement.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: user.id, delete_reason: reason } });
    await tx.auditLog.create({ data: { actor_id: user.id, action: 'soft_delete', entity_type: 'requirement', entity_id: id, reason, snapshot: JSON.parse(JSON.stringify(existing)) } });
  });
  return { ok: true };
}

/** Everything that happened to a requirement, newest first, each tagged with the person who did it. */
async function getActivity(id) {
  const [logs, stages] = await Promise.all([
    prisma.auditLog.findMany({ where: { entity_type: 'requirement', entity_id: id, action: { not: 'soft_delete' } }, orderBy: { created_at: 'desc' }, take: 200 }),
    prisma.stageHistory.findMany({ where: { entity_type: 'requirement', entity_id: id }, orderBy: { changed_at: 'desc' }, take: 200 }),
  ]);
  const ids = [...new Set([...logs.map((l) => l.actor_id), ...stages.map((s) => s.changed_by)].filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true } }) : [];
  const by = new Map(users.map((u) => [u.id, u]));
  const who = (uid) => (by.get(uid) ? { id: uid, name: by.get(uid).name, role: by.get(uid).role } : null);
  const rows = [
    ...logs.map((l) => ({ id: l.id, kind: l.action, summary: l.reason, details: l.snapshot, by: who(l.actor_id), at: l.created_at })),
    ...stages.map((s) => ({ id: s.id, kind: 'status', summary: `Status ${s.from_stage || '-'} → ${s.to_stage}`, details: { reason: s.reason }, by: who(s.changed_by), at: s.changed_at })),
  ];
  return rows.sort((a, b) => new Date(b.at) - new Date(a.at));
}

// Assign / unassign / add seat: same behaviour as before, plus the activity tag.
const wrap = (fn, describe) => async (...args) => {
  const result = await fn(...args);
  if (!result.error) {
    const [requirementId, , user] = describe.pick(args);
    await logActivity(user, requirementId, describe.action, describe.text(args, result), describe.snapshot ? describe.snapshot(args, result) : {});
  }
  return result;
};
const assignLogged = wrap(assign, { action: 'assign', pick: (a) => [a[0], null, a[2]], text: (a) => `Assigned a ${a[1].role_on_req.replace('_', ' ')}`, snapshot: (a) => ({ user_id: a[1].user_id, role_on_req: a[1].role_on_req }) });
const unassignLogged = wrap(unassign, { action: 'unassign', pick: (a) => [a[0], null, a[2]], text: () => 'Removed an assignment', snapshot: (a) => ({ assignment_id: a[1] }) });
const addSeatLogged = wrap(addSeat, { action: 'add_seat', pick: (a) => [a[0], null, a[2]], text: (a) => `Added a seat${a[1].seat_label ? ` (${a[1].seat_label})` : ''}`, snapshot: (a) => ({ seat_label: a[1].seat_label || null }) });

module.exports = {
  remove,
  getActivity,
  list,
  getById,
  create,
  update,
  changeStatus,
  changeStatusOverride,
  assign: assignLogged,
  unassign: unassignLogged,
  getAssignments,
  getHistory,
  getSeats,
  addSeat: addSeatLogged,
  changeSeatStatus,
  canMutateRequirement,
};
