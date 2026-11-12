// Vendor charges - GST, TDS or any other line a vendor's invoices carry. Set up exactly like a contract's
// charges (charges.service.js): percent of, or a fixed amount on, the project row's amount; "add" raises the
// payable (GST), "deduct" lowers it (TDS). Worked out when the vendor invoice is generated; the invoice keeps
// the lines it was generated with (details.charges), so a later change only reaches refreshed invoices.

const prisma = require('../../config/db');
const { round2 } = require('../calculations/period');
const { findVendorAccount } = require('../../lib/workerType');
const { applyCharges } = require('./charges.service');

const SELECT = { id: true, vendor_account_id: true, label: true, mode: true, value: true, effect: true, created_at: true, updated_at: true };
const serialize = (row) => ({ ...row, value: Number(row.value) });

/** GST when the label says so (IGST / CGST / SGST included), TDS when it says TDS, anything else is "other". */
function kindOf(line) {
  const label = String(line.label || '');
  if (/gst/i.test(label)) return 'gst';
  if (/tds/i.test(label)) return 'tds';
  return 'other';
}

/**
 * Works the charges out on one project row. Returns the stored lines and the three invoice figures:
 * gst (added), tds (withheld, positive) and other (signed, everything that is neither GST nor TDS).
 */
function chargeAmounts(amount, charges, factor = 1) {
  const { lines } = applyCharges(amount, charges, factor);
  let gst = 0; let tds = 0; let other = 0;
  const tagged = lines.map((l) => {
    const kind = kindOf(l);
    if (kind === 'gst') gst += l.amount;
    else if (kind === 'tds') tds += Math.abs(l.amount);
    else other += l.amount;
    return { ...l, tax_kind: kind };
  });
  return { lines: tagged, gst_amount: round2(gst), tds_amount: round2(tds), other_amount: round2(other) };
}

async function listCharges(orgId, vendorAccountId) {
  const rows = await prisma.vendorCharge.findMany({ where: { org_id: orgId, vendor_account_id: vendorAccountId }, orderBy: { created_at: 'asc' }, select: SELECT });
  return rows.map(serialize);
}

function audit(orgId, user, action, row, extra = {}) {
  return prisma.auditLog.create({
    data: { org_id: orgId, actor_id: user.id, action, entity_type: 'vendor_charge', entity_id: row.id, reason: `${row.label} (${row.mode} ${Number(row.value)} ${row.effect})`, snapshot: { vendor_account_id: row.vendor_account_id, label: row.label, mode: row.mode, value: Number(row.value), effect: row.effect, ...extra } },
  });
}

async function createCharge(orgId, user, vendorAccountId, body) {
  if (!(await findVendorAccount(orgId, vendorAccountId))) return { error: 'vendor_not_found' };
  if (body.mode === 'percent' && body.value > 100) return { error: 'percent_too_large' };
  const row = await prisma.vendorCharge.create({ data: { org_id: orgId, vendor_account_id: vendorAccountId, created_by: user.id, ...body }, select: SELECT });
  await audit(orgId, user, 'vendor_charge_add', row);
  return { charge: serialize(row) };
}

async function updateCharge(orgId, user, chargeId, patch) {
  const existing = await prisma.vendorCharge.findFirst({ where: { id: chargeId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  const next = { mode: patch.mode ?? existing.mode, value: patch.value ?? Number(existing.value) };
  if (next.mode === 'percent' && next.value > 100) return { error: 'percent_too_large' };
  const row = await prisma.vendorCharge.update({ where: { id: chargeId }, data: patch, select: SELECT });
  await audit(orgId, user, 'vendor_charge_edit', row, { before: { label: existing.label, mode: existing.mode, value: Number(existing.value), effect: existing.effect } });
  return { charge: serialize(row) };
}

async function removeCharge(orgId, user, chargeId) {
  const existing = await prisma.vendorCharge.findFirst({ where: { id: chargeId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  await prisma.vendorCharge.delete({ where: { id: chargeId } });
  await audit(orgId, user, 'vendor_charge_remove', existing);
  return { deleted: true };
}

module.exports = { listCharges, createCharge, updateCharge, removeCharge, chargeAmounts, kindOf };
