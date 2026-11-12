// Vendor adjustments - an admin's + / - tweak to what a vendor is owed for a month (Live Analytics > Vendors), the
// same idea as the billing adjustments on Billing & Sales. The contractors' calculated amounts stay the source of
// truth; each adjustment is a separate line with a mandatory reason, tied to one of the vendor's projects and in that
// project's vendor currency. The vendor engine adds them to the vendor's amount, so the vendor total, the lock, the
// vendor payment and the vendor invoice all follow. Every change is audited and a locked month is flagged
// change_detected so it is reviewed and locked again.

const prisma = require('../../config/db');
const vendorEngine = require('../calculations/engines/vendorPayment.engine');
const { round2 } = require('../calculations/period');

// Lazy: calculations.service loads the engines.
const calculations = () => require('../calculations/calculations.service');

const SELECT = { id: true, vendor_account_id: true, account_id: true, period_month: true, period_year: true, currency: true, amount: true, reason: true, created_at: true, creator: { select: { id: true, name: true } } };

function serialize(row) {
  return { ...row, amount: round2(Number(row.amount)) };
}

// The vendor's projects (and currency) with contractor work that month - what an adjustment can be tied to.
async function vendorProjects(orgId, vendorAccountId, period) {
  const live = await vendorEngine.computeVendorPayments(orgId, { ...period, vendor_account_id: vendorAccountId });
  const seen = new Map();
  for (const l of live.lines) if (!seen.has(`${l.project.id}|${l.currency}`)) seen.set(`${l.project.id}|${l.currency}`, { project: l.project, currency: l.currency });
  return [...seen.values()];
}

async function listAdjustments(orgId, vendorAccountId, period) {
  const rows = await prisma.vendorAdjustment.findMany({ where: { org_id: orgId, vendor_account_id: vendorAccountId, ...period }, orderBy: { created_at: 'asc' }, select: SELECT });
  const accounts = rows.length ? await prisma.account.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.account_id))] } }, select: { id: true, name: true, project_name: true, project_code: true } }) : [];
  const nameBy = new Map(accounts.map((a) => [a.id, a.project_name || a.name]));
  const items = rows.map((r) => ({ ...serialize(r), project_name: nameBy.get(r.account_id) || 'Project' }));
  const totals = {};
  for (const i of items) totals[i.currency] = round2((totals[i.currency] || 0) + i.amount);
  return { items, totals, projects: await vendorProjects(orgId, vendorAccountId, period) };
}

async function flag(orgId, user, row, description, oldValue, newValue) {
  await calculations().notifySourceChange(orgId, {
    source_type: 'vendor_adjustment',
    date: new Date(Date.UTC(row.period_year, row.period_month - 1, 1)),
    vendor_account_id: row.vendor_account_id,
    account_id: row.account_id,
    changed_by: user.id,
    description,
    old_value: oldValue,
    new_value: newValue,
  });
}

async function createAdjustment(orgId, user, { vendor_account_id, account_id, period_month, period_year, amount, reason }) {
  const period = { period_month, period_year };
  const projects = await vendorProjects(orgId, vendor_account_id, period);
  const target = projects.find((p) => p.project.id === account_id);
  if (!target) return { error: 'vendor_line_not_found' };
  const row = await prisma.vendorAdjustment.create({ data: { org_id: orgId, vendor_account_id, account_id, ...period, currency: target.currency, amount, reason, created_by: user.id }, select: SELECT });
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: user.id, action: 'vendor_adjustment_add', entity_type: 'vendor_adjustment', entity_id: row.id, reason, snapshot: { vendor_account_id, account_id, ...period, currency: target.currency, amount } },
  });
  await flag(orgId, user, row, `Vendor adjustment ${amount > 0 ? '+' : ''}${amount} ${target.currency} added: ${reason}`, null, amount);
  return { adjustment: serialize(row) };
}

async function removeAdjustment(orgId, user, adjustmentId) {
  const row = await prisma.vendorAdjustment.findFirst({ where: { id: adjustmentId, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  await prisma.vendorAdjustment.delete({ where: { id: row.id } });
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: user.id, action: 'vendor_adjustment_remove', entity_type: 'vendor_adjustment', entity_id: row.id, reason: row.reason, snapshot: { vendor_account_id: row.vendor_account_id, account_id: row.account_id, period_month: row.period_month, period_year: row.period_year, currency: row.currency, amount: Number(row.amount) } },
  });
  await flag(orgId, user, row, `Vendor adjustment ${Number(row.amount)} ${row.currency} removed`, Number(row.amount), null);
  return { deleted: true };
}

module.exports = { listAdjustments, createAdjustment, removeAdjustment };
