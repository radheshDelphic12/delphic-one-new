// Billing adjustments - an admin's + / - tweak to a project's billed amount for
// a month. The approved timesheet hours stay the source of truth; an adjustment
// is a separate, reasoned line added to the final amount (see billing.engine:
// lockedAmount). Every change is audited, and a locked month is flagged
// change_detected so it is reviewed and locked again.

const prisma = require('../../config/db');
const billingEngine = require('../calculations/engines/billing.engine');
const { round2 } = require('../calculations/period');

// Lazy: calculations.service loads the engines, which load billing.service.
const calculations = () => require('../calculations/calculations.service');

const ADJUSTMENT_SELECT = { id: true, account_id: true, period_month: true, period_year: true, amount: true, reason: true, created_at: true, creator: { select: { id: true, name: true } } };

function serialize(row) {
  return { ...row, amount: round2(Number(row.amount)) };
}

async function projectOf(orgId, accountId) {
  return prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: 'client' }, select: { id: true, name: true, project_name: true, client_billing_currency: true } });
}

async function listAdjustments(orgId, accountId, { period_month, period_year }) {
  const rows = await prisma.billingAdjustment.findMany({ where: { org_id: orgId, account_id: accountId, period_month, period_year }, orderBy: { created_at: 'asc' }, select: ADJUSTMENT_SELECT });
  const items = rows.map(serialize);
  return { items, total: round2(items.reduce((s, a) => s + a.amount, 0)) };
}

async function flag(orgId, user, accountId, period, description, oldValue, newValue) {
  await calculations().notifySourceChange(orgId, {
    source_type: 'billing_adjustment',
    date: new Date(Date.UTC(period.period_year, period.period_month - 1, 1)),
    account_id: accountId,
    changed_by: user.id,
    description,
    old_value: oldValue,
    new_value: newValue,
  });
}

async function createAdjustment(orgId, user, accountId, { period_month, period_year, amount, reason }) {
  if (!(await projectOf(orgId, accountId))) return { error: 'account_not_found' };
  const row = await prisma.billingAdjustment.create({ data: { org_id: orgId, account_id: accountId, period_month, period_year, amount, reason, created_by: user.id }, select: ADJUSTMENT_SELECT });
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: user.id, action: 'billing_adjustment_add', entity_type: 'billing_adjustment', entity_id: row.id, reason, snapshot: { account_id: accountId, period_month, period_year, amount } },
  });
  await flag(orgId, user, accountId, { period_month, period_year }, `Billing adjustment ${amount > 0 ? '+' : ''}${amount} added: ${reason}`, null, amount);
  return { adjustment: serialize(row) };
}

async function removeAdjustment(orgId, user, adjustmentId) {
  const row = await prisma.billingAdjustment.findFirst({ where: { id: adjustmentId, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  await prisma.billingAdjustment.delete({ where: { id: row.id } });
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: user.id, action: 'billing_adjustment_remove', entity_type: 'billing_adjustment', entity_id: row.id, reason: row.reason, snapshot: { account_id: row.account_id, period_month: row.period_month, period_year: row.period_year, amount: Number(row.amount) } },
  });
  await flag(orgId, user, row.account_id, { period_month: row.period_month, period_year: row.period_year }, `Billing adjustment ${Number(row.amount)} removed`, Number(row.amount), null);
  return { deleted: true };
}

module.exports = { listAdjustments, createAdjustment, removeAdjustment, billingEngine };
