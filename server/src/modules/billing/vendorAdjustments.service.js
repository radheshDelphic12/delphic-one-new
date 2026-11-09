// Vendor line adjustments - an admin's edit of what a contractor's project line owes the vendor for a month
// (Live Analytics > Vendors). The typed amount replaces the calculated one inside the vendor engine, so it flows
// to the vendor totals, the lock snapshot, the vendor payment and the vendor invoice. Removing it goes back to the
// calculation. Every change is audited and a locked month is flagged change_detected so it is reviewed again.

const prisma = require('../../config/db');
const vendorEngine = require('../calculations/engines/vendorPayment.engine');
const { round2 } = require('../calculations/period');

// Lazy: calculations.service loads the engines.
const calculations = () => require('../calculations/calculations.service');

async function calculatedLine(orgId, key) {
  const live = await vendorEngine.computeVendorPayments(orgId, { period_month: key.period_month, period_year: key.period_year, org_membership_id: key.org_membership_id });
  return live.lines.find((l) => l.project.id === key.account_id) || null;
}

async function flag(orgId, user, key, description, oldValue, newValue) {
  await calculations().notifySourceChange(orgId, {
    source_type: 'vendor_adjustment',
    date: new Date(Date.UTC(key.period_year, key.period_month - 1, 1)),
    org_membership_id: key.org_membership_id,
    account_id: key.account_id,
    changed_by: user.id,
    description,
    old_value: oldValue,
    new_value: newValue,
  });
}

async function setLineAmount(orgId, user, key, { amount, reason }) {
  const member = await prisma.orgMembership.findFirst({ where: { id: key.org_membership_id, org_id: orgId, worker_type: 'contractor' }, select: { id: true } });
  if (!member) return { error: 'contractor_not_found' };
  const line = await calculatedLine(orgId, key);
  if (!line) return { error: 'vendor_line_not_found' };
  const where = { org_id_org_membership_id_account_id_period_year_period_month: { org_id: orgId, org_membership_id: key.org_membership_id, account_id: key.account_id, period_year: key.period_year, period_month: key.period_month } };
  const before = await prisma.vendorLineAdjustment.findUnique({ where });
  const calculated = line.calculated_amount;
  const final = round2(amount);
  let row = null;
  if (final === calculated) {
    // Typing the calculated figure back is the same as removing the edit.
    if (before) await prisma.vendorLineAdjustment.delete({ where: { id: before.id } });
  } else {
    row = await prisma.vendorLineAdjustment.upsert({
      where,
      create: { org_id: orgId, ...key, amount: final, calculated_amount: calculated, currency: line.currency, reason, created_by: user.id },
      update: { amount: final, calculated_amount: calculated, currency: line.currency, reason, created_by: user.id },
    });
  }
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: user.id, action: 'vendor_line_adjust', entity_type: 'vendor_line_adjustment', entity_id: row?.id || before?.id || key.account_id, reason, snapshot: { ...key, currency: line.currency, calculated_amount: calculated, before: before ? Number(before.amount) : line.amount, after: final } },
  });
  await flag(orgId, user, key, `Vendor amount for ${line.contractor} on ${line.project.name} set to ${final} ${line.currency} (calculated ${calculated}): ${reason}`, before ? Number(before.amount) : calculated, final);
  return { line: { ...line, amount: final, calculated_amount: calculated, adjusted: Boolean(row) } };
}

async function removeLineAmount(orgId, user, key) {
  const where = { org_id_org_membership_id_account_id_period_year_period_month: { org_id: orgId, org_membership_id: key.org_membership_id, account_id: key.account_id, period_year: key.period_year, period_month: key.period_month } };
  const before = await prisma.vendorLineAdjustment.findUnique({ where });
  if (!before) return { error: 'not_found' };
  await prisma.vendorLineAdjustment.delete({ where: { id: before.id } });
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: user.id, action: 'vendor_line_adjust_remove', entity_type: 'vendor_line_adjustment', entity_id: before.id, reason: before.reason, snapshot: { ...key, amount: Number(before.amount), calculated_amount: before.calculated_amount === null ? null : Number(before.calculated_amount) } },
  });
  await flag(orgId, user, key, `Vendor amount edit removed (back to the calculated figure)`, Number(before.amount), before.calculated_amount === null ? null : Number(before.calculated_amount));
  return { deleted: true };
}

module.exports = { setLineAmount, removeLineAmount };
