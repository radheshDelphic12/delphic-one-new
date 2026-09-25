const prisma = require('../../config/db');
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_LABELS,
  ROLE_EVENT_MATRIX,
  eventsForRole,
} = require('../../lib/notifications/eventCatalog');

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    actor_id: row.actor_id,
    metadata: row.metadata || {},
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

async function list(userId, { unread, limit = 20, cursor }) {
  const where = {
    user_id: userId,
    ...(unread === '1' ? { read_at: null } : {}),
    ...(cursor ? { created_at: { lt: new Date(cursor) } } : {}),
  };
  const rows = await prisma.notification.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(serialize),
    has_more: hasMore,
    next_cursor: hasMore ? page[page.length - 1].created_at.toISOString() : null,
  };
}

async function unreadCount(userId) {
  const count = await prisma.notification.count({ where: { user_id: userId, read_at: null } });
  return { count };
}

async function markRead(userId, ids) {
  const res = await prisma.notification.updateMany({
    where: { id: { in: ids }, user_id: userId, read_at: null },
    data: { read_at: new Date() },
  });
  return { updated: res.count };
}

async function markAllRead(userId) {
  const res = await prisma.notification.updateMany({
    where: { user_id: userId, read_at: null },
    data: { read_at: new Date() },
  });
  return { updated: res.count };
}

/**
 * Effective preferences for the user: one entry per NotificationType relevant to
 * their role, matrix defaults merged with any stored NotificationPreference rows.
 */
async function getPreferences(user) {
  const relevant = eventsForRole(user.role);
  const rows = await prisma.notificationPreference.findMany({
    where: { user_id: user.id, type: { in: relevant } },
  });
  const rowMap = new Map(rows.map((r) => [r.type, r]));
  return relevant.map((type) => {
    const [label, description] = NOTIFICATION_LABELS[type] || [type, ''];
    const stored = rowMap.get(type);
    return {
      type,
      label,
      description,
      in_app: stored ? stored.in_app : ROLE_EVENT_MATRIX[type].defaultInApp !== false,
      email: stored ? stored.email : false,
      is_overridden: Boolean(stored),
    };
  });
}

async function setPreferences(user, items) {
  const relevant = new Set(eventsForRole(user.role));
  const valid = items.filter((i) => relevant.has(i.type));
  await prisma.$transaction(
    valid.map((i) =>
      prisma.notificationPreference.upsert({
        where: { user_id_type: { user_id: user.id, type: i.type } },
        create: { user_id: user.id, type: i.type, in_app: i.in_app, email: Boolean(i.email) },
        update: { in_app: i.in_app, email: Boolean(i.email) },
      })
    )
  );
  return getPreferences(user);
}

async function resetPreferences(user) {
  await prisma.notificationPreference.deleteMany({ where: { user_id: user.id } });
  return getPreferences(user);
}

module.exports = {
  serialize,
  list,
  unreadCount,
  markRead,
  markAllRead,
  getPreferences,
  setPreferences,
  resetPreferences,
  NOTIFICATION_TYPES,
};
