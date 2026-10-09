const prisma = require('../../config/db');

/**
 * Extra meetings with an ACTIVE client / vendor, tracked after onboarding. They never touch the
 * account stage (the onboarding meeting stays on accounts.meeting_*) and show on the calendar.
 */

const INCLUDE = {
  attendees: { include: { user: { select: { id: true, name: true, email: true } } } },
  creator: { select: { id: true, name: true } },
};

function serialize(row) {
  const { attendees, creator, ...rest } = row;
  return {
    ...rest,
    attendees: (attendees || []).map((a) => ({ id: a.user.id, name: a.user.name, email: a.user.email })),
    created_by_user: creator ? { id: creator.id, name: creator.name } : null,
  };
}

function canManage(user) {
  return user.role === 'admin' || user.role === 'bda';
}

// Only active, non-project accounts (clients or vendors) can have tracked meetings.
async function loadActiveAccount(accountId) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account || account.deleted_at) return { error: 'not_found' };
  if (account.is_project || account.stage !== 'active') return { error: 'not_active' };
  return { account };
}

async function list(accountId) {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { id: true, deleted_at: true } });
  if (!account || account.deleted_at) return { error: 'not_found' };
  const rows = await prisma.clientMeeting.findMany({
    where: { account_id: accountId },
    include: INCLUDE,
    orderBy: { scheduled_at: 'desc' },
  });
  return { meetings: rows.map(serialize) };
}

function validateLocation(mode, location) {
  return mode === 'offline' && !location ? 'location_required' : null;
}

async function create(accountId, body, user) {
  if (!canManage(user)) return { error: 'forbidden' };
  const loaded = await loadActiveAccount(accountId);
  if (loaded.error) return loaded;
  const mode = body.mode || 'online';
  const bad = validateLocation(mode, body.location);
  if (bad) return { error: bad };

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.clientMeeting.create({
      data: {
        account_id: accountId,
        org_id: loaded.account.org_id,
        title: body.title,
        mode,
        scheduled_at: new Date(body.scheduled_at),
        duration_minutes: body.duration_minutes ?? 60,
        location: mode === 'offline' ? body.location : null,
        link: mode === 'online' ? body.link || null : null,
        notes: body.notes || null,
        created_by: user.id,
      },
    });
    if (body.attendee_ids?.length) {
      await tx.clientMeetingAttendee.createMany({
        data: body.attendee_ids.map((user_id) => ({ meeting_id: created.id, user_id })),
        skipDuplicates: true,
      });
    }
    return tx.clientMeeting.findUnique({ where: { id: created.id }, include: INCLUDE });
  });
  return { meeting: serialize(row) };
}

async function update(accountId, meetingId, body, user) {
  if (!canManage(user)) return { error: 'forbidden' };
  const existing = await prisma.clientMeeting.findFirst({ where: { id: meetingId, account_id: accountId } });
  if (!existing) return { error: 'not_found' };

  const mode = body.mode ?? existing.mode;
  const location = body.location !== undefined ? body.location : existing.location;
  const bad = validateLocation(mode, location);
  if (bad) return { error: bad };

  const data = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.scheduled_at !== undefined) data.scheduled_at = new Date(body.scheduled_at);
  if (body.duration_minutes !== undefined) data.duration_minutes = body.duration_minutes;
  if (body.notes !== undefined) data.notes = body.notes || null;
  if (body.status !== undefined) data.status = body.status;
  data.mode = mode;
  data.location = mode === 'offline' ? location : null;
  data.link = mode === 'online' ? (body.link !== undefined ? body.link || null : existing.link) : null;

  const row = await prisma.$transaction(async (tx) => {
    await tx.clientMeeting.update({ where: { id: meetingId }, data });
    if (body.attendee_ids) {
      await tx.clientMeetingAttendee.deleteMany({ where: { meeting_id: meetingId } });
      if (body.attendee_ids.length) {
        await tx.clientMeetingAttendee.createMany({
          data: body.attendee_ids.map((user_id) => ({ meeting_id: meetingId, user_id })),
          skipDuplicates: true,
        });
      }
    }
    return tx.clientMeeting.findUnique({ where: { id: meetingId }, include: INCLUDE });
  });
  return { meeting: serialize(row) };
}

async function remove(accountId, meetingId, user) {
  if (!canManage(user)) return { error: 'forbidden' };
  const existing = await prisma.clientMeeting.findFirst({ where: { id: meetingId, account_id: accountId } });
  if (!existing) return { error: 'not_found' };
  await prisma.clientMeeting.delete({ where: { id: meetingId } });
  return { id: meetingId };
}

module.exports = { list, create, update, remove, INCLUDE };
