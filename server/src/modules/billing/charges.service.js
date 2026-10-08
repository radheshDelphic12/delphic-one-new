// Contract charges - GST, TDS or any other line a contract's (project's) client
// invoices carry. Each charge belongs to one contract, is added / edited /
// deleted on its own, and is worked out on the month's FINAL approved billing
// amount (approved timesheet hours + any admin adjustment, i.e. billing.engine
// lockedAmount):
//   percent -> value % of that amount          (e.g. GST 18)
//   fixed   -> value, in the contract's billing currency (e.g. a 500 handling fee)
//   effect  add -> raises the payable total (GST, fees); deduct -> lowers it (TDS, credits)
// An invoice keeps the lines it was generated with (details.charges), so editing
// a charge later only reaches new or refreshed draft invoices.

const prisma = require('../../config/db');
const { round2 } = require('../calculations/period');

const SELECT = { id: true, account_id: true, label: true, mode: true, value: true, effect: true, created_at: true, updated_at: true };

function serialize(row) {
  return { ...row, value: Number(row.value) };
}

// Pure. `subtotal` is the final approved amount; `factor` converts fixed amounts when the
// invoice is raised in another currency than the contract's (1 = same currency).
// Returns the invoice lines (signed amounts) and the payable total.
function applyCharges(subtotal, charges, factor = 1) {
  const lines = (charges || []).map((c) => {
    const value = Number(c.value);
    const effective = c.mode === 'fixed' ? round2(value * factor) : value;
    const raw = c.mode === 'percent' ? (subtotal * value) / 100 : effective;
    const amount = round2(c.effect === 'deduct' ? -raw : raw);
    return { id: c.id || null, label: c.label, mode: c.mode, value: effective, effect: c.effect, amount };
  });
  return { lines, total: round2(subtotal + lines.reduce((s, l) => s + l.amount, 0)) };
}

// Re-works an invoice's stored lines on a new subtotal (admin amount override).
function recomputeDetails(details, subtotal) {
  const { lines, total } = applyCharges(subtotal, details.charges || [], 1);
  return { ...details, amount: subtotal, subtotal, charges: lines, total_amount: total };
}

async function projectOf(orgId, accountId) {
  return prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: 'client' }, select: { id: true, name: true, project_name: true } });
}

async function listCharges(orgId, accountId) {
  const rows = await prisma.contractCharge.findMany({ where: { org_id: orgId, account_id: accountId }, orderBy: { created_at: 'asc' }, select: SELECT });
  return rows.map(serialize);
}

function audit(orgId, user, action, row, extra = {}) {
  return prisma.auditLog.create({
    data: { org_id: orgId, actor_id: user.id, action, entity_type: 'contract_charge', entity_id: row.id, reason: `${row.label} (${row.mode} ${Number(row.value)} ${row.effect})`, snapshot: { account_id: row.account_id, label: row.label, mode: row.mode, value: Number(row.value), effect: row.effect, ...extra } },
  });
}

async function createCharge(orgId, user, accountId, body) {
  if (!(await projectOf(orgId, accountId))) return { error: 'account_not_found' };
  if (body.mode === 'percent' && body.value > 100) return { error: 'percent_too_large' };
  const row = await prisma.contractCharge.create({ data: { org_id: orgId, account_id: accountId, created_by: user.id, ...body }, select: SELECT });
  await audit(orgId, user, 'contract_charge_add', row);
  return { charge: serialize(row) };
}

async function updateCharge(orgId, user, chargeId, patch) {
  const existing = await prisma.contractCharge.findFirst({ where: { id: chargeId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  const next = { mode: patch.mode ?? existing.mode, value: patch.value ?? Number(existing.value) };
  if (next.mode === 'percent' && next.value > 100) return { error: 'percent_too_large' };
  const row = await prisma.contractCharge.update({ where: { id: chargeId }, data: patch, select: SELECT });
  await audit(orgId, user, 'contract_charge_edit', row, { before: { label: existing.label, mode: existing.mode, value: Number(existing.value), effect: existing.effect } });
  return { charge: serialize(row) };
}

async function removeCharge(orgId, user, chargeId) {
  const existing = await prisma.contractCharge.findFirst({ where: { id: chargeId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  await prisma.contractCharge.delete({ where: { id: chargeId } });
  await audit(orgId, user, 'contract_charge_remove', existing);
  return { deleted: true };
}

module.exports = { listCharges, createCharge, updateCharge, removeCharge, applyCharges, recomputeDetails };
