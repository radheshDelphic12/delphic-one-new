const prisma = require('../../config/db');
const { notify, accountParticipants, admins } = require('../../lib/notifications');
const { STUCK_THRESHOLD_DAYS } = require('../../config/constants');

const STUCK_LEAD_STAGES = ['lead', 'meeting_scheduled', 'rescheduled'];
const stuckLeadCutoff = () => new Date(Date.now() - STUCK_THRESHOLD_DAYS * 86400000);

const TRANSITIONS = {
  lead: ['meeting_scheduled'],
  meeting_scheduled: ['active', 'rescheduled', 'dropped'],
  rescheduled: ['meeting_scheduled', 'dropped'],
  active: ['dropped'],
  dropped: [],
};

function serialize(row) {
  if (!row) return null;
  const { owner_id, owner, origin_owner_id, origin_owner, classified_by, classified_by_user, meeting_attendees, ...rest } = row;
  return {
    ...rest,
    owner: owner ? { id: owner.id, name: owner.name } : null,
    origin_owner: origin_owner ? { id: origin_owner.id, name: origin_owner.name } : null,
    classified_by: classified_by_user ? { id: classified_by_user.id, name: classified_by_user.name } : null,
    meeting_attendees: meeting_attendees ? meeting_attendees.map((a) => ({ id: a.user.id, name: a.user.name })) : undefined,
  };
}

const ACCOUNT_INCLUDE = {
  owner: { select: { id: true, name: true } },
  origin_owner: { select: { id: true, name: true } },
  classified_by_user: { select: { id: true, name: true } },
  meeting_attendees: { include: { user: { select: { id: true, name: true } } } },
};

async function list({ type, include_unclassified, stage, stuck, owner_id, origin_owner_id, industry, specialization, search, created_from, created_to, sort_by, sort_order, page, limit }) {
  // Accumulate into an AND array so multiple OR-bearing clauses (type scope +
  // search) can coexist without one clobbering the other in the object literal.
  const and = [];
  if (type === 'client' && include_unclassified) and.push({ OR: [{ type: 'client' }, { type: null }] });
  else if (type === 'unclassified') and.push({ type: null });
  else if (type) and.push({ type });
  const stages = stage ? String(stage).split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (stages.length === 1) and.push({ stage: stages[0] });
  else if (stages.length > 1) and.push({ stage: { in: stages } });
  if (stuck === 'stuck') and.push({ stage: { in: STUCK_LEAD_STAGES }, updated_at: { lte: stuckLeadCutoff() } });
  if (stuck === 'not_stuck') {
    and.push({ NOT: { stage: { in: STUCK_LEAD_STAGES }, updated_at: { lte: stuckLeadCutoff() } } });
  }
  if (owner_id) and.push({ owner_id });
  if (origin_owner_id) and.push({ origin_owner_id });
  if (industry) and.push({ industry: { contains: industry, mode: 'insensitive' } });
  if (specialization) and.push({ vendor_specializations: { has: specialization } });
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { poc_name: { contains: search, mode: 'insensitive' } },
        { poc_email: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  if (created_from || created_to) {
    and.push({
      created_at: {
        ...(created_from ? { gte: new Date(created_from) } : {}),
        ...(created_to ? { lte: new Date(created_to) } : {}),
      },
    });
  }
  const where = and.length ? { AND: and } : {};

  const [total, rows] = await Promise.all([
    prisma.account.count({ where }),
    prisma.account.findMany({
      where,
      include: ACCOUNT_INCLUDE,
      orderBy: { [sort_by]: sort_order },
      take: limit,
      skip: (page - 1) * limit,
    }),
  ]);

  return { rows: rows.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/** Distinct vendor specialization tags for list filters (any authenticated role). */
async function listSpecializations() {
  const rows = await prisma.account.findMany({
    where: { vendor_specializations: { isEmpty: false } },
    select: { vendor_specializations: true },
  });
  const tags = new Set();
  for (const row of rows) {
    for (const tag of row.vendor_specializations || []) {
      const trimmed = String(tag || '').trim();
      if (trimmed) tags.add(trimmed);
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

async function getById(id) {
  const row = await prisma.account.findUnique({ where: { id }, include: ACCOUNT_INCLUDE });
  return serialize(row);
}

function canMutateAccount(account, user) {
  if (!account) return false;
  // Admin and BDA may edit any account (clients, vendors, unclassified) and move stages / schedule meetings.
  return user.role === 'admin' || user.role === 'bda';
}

async function create(data, ownerId) {
  const row = await prisma.account.create({
    // origin_owner_id is the immutable "brought by" — same as the first owner, never updated after.
    data: { ...data, owner_id: ownerId, origin_owner_id: ownerId },
    include: ACCOUNT_INCLUDE,
  });
  return serialize(row);
}

async function update(id, patch, user) {
  const existing = await prisma.account.findUnique({ where: { id } });
  if (!existing) return { error: 'not_found' };
  if (!canMutateAccount(existing, user)) return { error: 'forbidden' };

  if (patch.owner_id && patch.owner_id !== existing.owner_id) {
    // Anyone who can edit the account may reassign the owner. The owner is just the
    // current POC from our end — any active user of any role is a valid target.
    const target = await prisma.user.findUnique({ where: { id: patch.owner_id } });
    if (!target || !target.active) return { error: 'user_not_found' };
  }

  if ('origin_owner_id' in patch) {
    // "Brought by" is normally set once at creation; admin or BDA may correct it (not a superadmin-only power).
    if (user.role !== 'admin' && user.role !== 'bda' && !user.is_superadmin) {
      return { error: 'forbidden_brought_by' };
    }
    if (patch.origin_owner_id !== existing.origin_owner_id) {
      const t = await prisma.user.findUnique({ where: { id: patch.origin_owner_id } });
      if (!t || !t.active) return { error: 'user_not_found' };
    }
  }

  const data = { ...patch };
  if (patch.type && patch.type !== existing.type) {
    // Re-classifying an already-typed account is an admin/BDA correction (account flow owners).
    if (user.role !== 'admin' && user.role !== 'bda') return { error: 'forbidden_type_change' };
    data.classified_at = new Date();
    data.classified_by = user.id;
  } else {
    delete data.type;
  }

  const row = await prisma.account.update({
    where: { id },
    data,
    include: ACCOUNT_INCLUDE,
  });
  return { account: serialize(row) };
}

function canClassifyAccount(account, user) {
  return canMutateAccount(account, user) && account?.type == null;
}

async function classifyLead(id, { type }, user) {
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) return { error: 'not_found' };
  if (!canMutateAccount(account, user)) return { error: 'forbidden' };
  if (account.type != null) return { error: 'already_classified' };

  const [row] = await prisma.$transaction([
    prisma.account.update({
      where: { id },
      data: { type, classified_at: new Date(), classified_by: user.id },
      include: ACCOUNT_INCLUDE,
    }),
    prisma.stageHistory.create({
      data: {
        entity_type: 'account',
        entity_id: id,
        from_stage: null,
        to_stage: type,
        changed_by: user.id,
        reason: 'Lead classified',
      },
    }),
  ]);

  return { account: serialize(row) };
}

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

async function changeStage(id, { to_stage, reason, meeting_mode, meeting_date, meeting_location, meeting_notes, meeting_attendee_ids }, user) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({ where: { id } });
    if (!account) return { error: 'not_found' };
    if (!canMutateAccount(account, user)) return { error: 'forbidden' };
    if (account.is_locked) return { error: 'locked' };
    if (!canTransition(account.stage, to_stage)) return { error: 'invalid_transition' };
    if (to_stage === 'dropped' && !reason) return { error: 'reason_required' };
    if (to_stage === 'meeting_scheduled' && (!meeting_mode || !meeting_date)) {
      return { error: 'meeting_fields_required' };
    }
    if (to_stage === 'meeting_scheduled' && meeting_mode === 'offline' && !meeting_location) {
      return { error: 'meeting_location_required' };
    }

    const patch = { stage: to_stage };
    if (to_stage === 'meeting_scheduled') {
      patch.meeting_mode = meeting_mode;
      patch.meeting_date = new Date(meeting_date);
      patch.meeting_location = meeting_mode === 'offline' ? meeting_location : null;
      if (meeting_notes !== undefined) patch.meeting_notes = meeting_notes || null;
    }
    if (to_stage === 'dropped') patch.is_locked = true;

    const updated = await tx.account.update({
      where: { id },
      data: patch,
      include: ACCOUNT_INCLUDE,
    });

    if (to_stage === 'meeting_scheduled' && meeting_attendee_ids) {
      await tx.accountMeetingAttendee.deleteMany({ where: { account_id: id } });
      if (meeting_attendee_ids.length > 0) {
        await tx.accountMeetingAttendee.createMany({
          data: meeting_attendee_ids.map((user_id) => ({ account_id: id, user_id })),
          skipDuplicates: true,
        });
      }
    }

    const withAttendees = meeting_attendee_ids
      ? await tx.account.findUnique({ where: { id }, include: ACCOUNT_INCLUDE })
      : updated;

    const historyRow = await tx.stageHistory.create({
      data: {
        entity_type: 'account',
        entity_id: id,
        from_stage: account.stage,
        to_stage,
        changed_by: user.id,
        reason: reason || null,
      },
    });

    if (to_stage === 'active') {
      await notify(tx, {
        type: 'account_activated',
        actorId: user.id,
        recipientIds: [
          ...(await accountParticipants(tx, id)),
          ...(await admins(tx)),
        ],
        context: { actorName: user.name, accountName: updated.name, accountId: id },
      });
    }

    return { account: serialize(withAttendees), history: historyRow };
  });
}

// Edit an account's meeting details in place — no stage change, so it works
// whether the meeting is upcoming (`meeting_scheduled`) or already happened
// (the account has since moved to `active`/`rescheduled`). Lets BDA/admin fix a
// wrong attendee list or correct the date/location after the fact.
async function updateMeeting(id, { meeting_mode, meeting_date, meeting_location, meeting_notes, meeting_attendee_ids }, user) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({ where: { id } });
    if (!account) return { error: 'not_found' };
    if (!canMutateAccount(account, user)) return { error: 'forbidden' };
    if (account.is_locked) return { error: 'locked' };
    if (meeting_mode === 'offline' && !meeting_location) return { error: 'meeting_location_required' };

    const patch = {
      meeting_mode,
      meeting_date: new Date(meeting_date),
      meeting_location: meeting_mode === 'offline' ? meeting_location : null,
    };
    if (meeting_notes !== undefined) patch.meeting_notes = meeting_notes || null;

    await tx.account.update({ where: { id }, data: patch });

    if (meeting_attendee_ids) {
      await tx.accountMeetingAttendee.deleteMany({ where: { account_id: id } });
      if (meeting_attendee_ids.length > 0) {
        await tx.accountMeetingAttendee.createMany({
          data: meeting_attendee_ids.map((user_id) => ({ account_id: id, user_id })),
          skipDuplicates: true,
        });
      }
    }

    const updated = await tx.account.findUnique({ where: { id }, include: ACCOUNT_INCLUDE });

    const historyRow = await tx.stageHistory.create({
      data: {
        entity_type: 'account',
        entity_id: id,
        from_stage: account.stage,
        to_stage: account.stage,
        changed_by: user.id,
        reason: 'Meeting details updated',
      },
    });

    return { account: serialize(updated), history: historyRow };
  });
}

// Superadmin-only: move an account to any stage (backward, or straight to `lead`),
// ignoring ownership, the lock, and the transition map. Still audited in stage_history.
async function changeStageOverride(id, body, user) {
  const { to_stage, reason, is_locked, meeting_mode, meeting_date, meeting_location, meeting_notes, meeting_attendee_ids } =
    body;
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({ where: { id } });
    if (!account) return { error: 'not_found' };

    const patch = { stage: to_stage };
    if (is_locked !== undefined) patch.is_locked = is_locked;
    if (to_stage === 'meeting_scheduled') {
      if (meeting_mode) patch.meeting_mode = meeting_mode;
      if (meeting_date) patch.meeting_date = new Date(meeting_date);
      if (meeting_mode === 'offline' && meeting_location) patch.meeting_location = meeting_location;
      if (meeting_notes !== undefined) patch.meeting_notes = meeting_notes || null;
    }

    const updated = await tx.account.update({ where: { id }, data: patch, include: ACCOUNT_INCLUDE });

    if (meeting_attendee_ids) {
      await tx.accountMeetingAttendee.deleteMany({ where: { account_id: id } });
      if (meeting_attendee_ids.length > 0) {
        await tx.accountMeetingAttendee.createMany({
          data: meeting_attendee_ids.map((user_id) => ({ account_id: id, user_id })),
          skipDuplicates: true,
        });
      }
    }

    const withAttendees = meeting_attendee_ids
      ? await tx.account.findUnique({ where: { id }, include: ACCOUNT_INCLUDE })
      : updated;

    const historyRow = await tx.stageHistory.create({
      data: {
        entity_type: 'account',
        entity_id: id,
        from_stage: account.stage,
        to_stage,
        changed_by: user.id,
        reason: `[override] ${reason}`,
      },
    });

    return { account: serialize(withAttendees), history: historyRow };
  });
}

async function getHistory(id) {
  const rows = await prisma.stageHistory.findMany({
    where: { entity_type: 'account', entity_id: id },
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

module.exports = {
  list,
  listSpecializations,
  getById,
  create,
  update,
  changeStage,
  changeStageOverride,
  updateMeeting,
  classifyLead,
  getHistory,
  canTransition,
  canMutateAccount,
  canClassifyAccount,
};
