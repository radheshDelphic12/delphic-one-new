const prisma = require('../../config/db');
const admin = require('../admin/admin.service');

const day = (v, end) => (v ? new Date(`${v}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`) : undefined);

/** Orgs of the caller's holding group(s), as {id, name}. */
async function groupOrgs(groupIds) {
  return prisma.org.findMany({ where: { org_group_id: { in: groupIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

/**
 * Group Dashboard > Logs: every change across the group's companies, newest first, with filters.
 * `q`: org_id, entity_type, actor_id, action, from, to (YYYY-MM-DD, IST days), page, limit.
 */
async function listGroup(groupIds, q) {
  const orgs = await groupOrgs(groupIds);
  const orgIds = orgs.map((o) => o.id);
  const where = {
    org_id: q.org_id ? (orgIds.includes(q.org_id) ? q.org_id : '00000000-0000-0000-0000-000000000000') : { in: orgIds },
    ...(q.entity_type ? { entity_type: q.entity_type } : {}),
    ...(q.actor_id ? { actor_id: q.actor_id } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.from || q.to ? { created_at: { ...(q.from ? { gte: day(q.from, false) } : {}), ...(q.to ? { lte: day(q.to, true) } : {}) } } : {}),
  };
  const page = q.page || 1;
  const limit = q.limit || 50;
  const [total, rows, types, actors] = await Promise.all([
    prisma.changeLog.count({ where }),
    prisma.changeLog.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.changeLog.groupBy({ by: ['entity_type'], where: { org_id: { in: orgIds } }, _count: { _all: true } }),
    prisma.changeLog.groupBy({ by: ['actor_id', 'actor_name'], where: { org_id: { in: orgIds } }, _count: { _all: true } }),
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  return {
    rows: rows.map((r) => ({ ...r, company: orgName.get(r.org_id) || null })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    facets: {
      companies: orgs,
      entity_types: types.map((t) => t.entity_type).sort(),
      actors: actors.filter((a) => a.actor_id || a.actor_name).map((a) => ({ id: a.actor_id, name: a.actor_name })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    },
  };
}

/** One record's history inside a company (a project's own changes plus its allocations, finance entries, vendor invoices...). */
async function listEntity(orgId, { entity_type, entity_id, limit = 100 }) {
  const rows = await prisma.changeLog.findMany({
    where: { org_id: orgId, OR: [{ entity_type, entity_id }, { context_id: entity_id }] },
    orderBy: { created_at: 'desc' },
    take: limit,
  });
  return rows;
}

/** Soft-deleted records of the group's companies (restorable). */
async function listDeleted(groupIds) {
  const orgIds = (await groupOrgs(groupIds)).map((o) => o.id);
  const rows = await admin.listDeleted();
  const names = new Map((await groupOrgs(groupIds)).map((o) => [o.id, o.name]));
  return rows.filter((r) => !r.org_id || orgIds.includes(r.org_id)).map((r) => ({ ...r, company: names.get(r.org_id) || null }));
}

module.exports = { listGroup, listEntity, listDeleted };
