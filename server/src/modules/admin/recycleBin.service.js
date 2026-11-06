const { Prisma } = require('@prisma/client');
const prisma = require('../../config/db');
const logger = require('../../config/logger');

// Records a person deleted in the app (archived by config/recycleBin.js): list them and put one back.

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const MODELS = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

// "TimesheetEntry" -> "Timesheet entry"
const modelLabel = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])([a-z])/g, (_m, a, b) => ` ${a.toLowerCase()}${b}`);

async function list(orgId, { model, q, restored, limit = 200 } = {}) {
  const rows = await prisma.deletedRecord.findMany({
    where: {
      org_id: orgId,
      restored_at: restored ? { not: null } : null,
      ...(model ? { model } : {}),
      ...(q ? { OR: [{ label: { contains: q, mode: 'insensitive' } }, { model: { contains: q.replace(/\s+/g, ''), mode: 'insensitive' } }] } : {}),
    },
    orderBy: { deleted_at: 'desc' },
    take: Math.min(Number(limit) || 200, 500),
  });
  const models = await prisma.deletedRecord.groupBy({ by: ['model'], where: { org_id: orgId, restored_at: null }, _count: { _all: true } });
  return {
    rows: rows.map((r) => ({ ...r, type_label: modelLabel(r.model), summary: summarise(r.data) })),
    models: models.map((m) => ({ model: m.model, label: modelLabel(m.model), count: m._count._all })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

// A few readable facts out of the archived row (dates, hours, amounts), for the list.
function summarise(data) {
  const out = [];
  for (const key of ['date', 'period_month', 'period_year', 'hours', 'amount', 'currency', 'status']) {
    if (data?.[key] !== undefined && data[key] !== null) out.push(`${key.replace(/_/g, ' ')}: ${String(data[key]).slice(0, 10)}`);
  }
  return out.slice(0, 5).join(' · ');
}

// After the row is back, the figures built from it are rebuilt (best effort; the nightly jobs would catch up anyway).
const AFTER_RESTORE = {
  async TimesheetEntry(orgId, row) {
    const date = new Date(row.date);
    await require('../billing/billing.service').computeDayRevenue(orgId, date);
    await require('../timesheets/workHours.service').syncDayOvertime(orgId, row.org_membership_id, date);
  },
};

async function restore(orgId, user, id) {
  const record = await prisma.deletedRecord.findFirst({ where: { id, org_id: orgId } });
  if (!record) return { error: 'not_found' };
  if (record.restored_at) return { error: 'already_restored' };
  const meta = MODELS.get(record.model);
  const delegate = prisma[lowerFirst(record.model)];
  if (!meta || !delegate) return { error: 'unsupported' };

  // Json columns that were null must go back as a database NULL, not as the JSON value null.
  const data = { ...record.data };
  for (const field of meta.fields) {
    if (field.kind === 'scalar' && field.type === 'Json' && data[field.name] === null) data[field.name] = Prisma.DbNull;
    if (field.kind === 'scalar' && data[field.name] === undefined) delete data[field.name];
  }
  try {
    await delegate.create({ data });
  } catch (err) {
    if (err?.code === 'P2002') return { error: 'conflict' };
    if (err?.code === 'P2003') return { error: 'parent_missing' };
    logger.error('recycle_restore_failed', { model: record.model, err });
    return { error: 'restore_failed', message: String(err.message || '').split('\n').slice(-2).join(' ').slice(0, 200) };
  }
  await prisma.deletedRecord.update({ where: { id }, data: { restored_at: new Date(), restored_by: user.id } });
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: user.id, action: 'restore', entity_type: 'recycle_bin', entity_id: record.row_id || record.id, reason: `Restored ${modelLabel(record.model)}${record.label ? ` ${record.label}` : ''}`, snapshot: { model: record.model } },
  }).catch(() => {});
  if (AFTER_RESTORE[record.model]) await AFTER_RESTORE[record.model](orgId, record.data).catch((err) => logger.error('recycle_after_restore_failed', { model: record.model, err }));
  return { restored: true, model: record.model, label: record.label };
}

module.exports = { list, restore, modelLabel };
