// Normal purchases (Finance > Vendor Invoices): a vendor bill that is not tied to a client project - office, software, equipment, services.
//
// Rules, in one place:
//  * A purchase is a company expense. The amount (before GST) is posted as ONE linked expense row (a GroupBillingCharge, vendor_purchases.charge_id)
//    dated the bill date, so Live Analytics > Expenses, the per-record lock and Financials read it like any other expense. The group charge lists
//    leave these rows out (they are managed here, not there).
//  * payable = amount + GST - TDS + adjustment (the same formula as a project vendor invoice).
//  * Paid / unpaid is recorded on the purchase itself (date, mode, reference); it does not move the expense, which is booked on the bill date.
//  * Changing, adding or cancelling a purchase in a month whose financials are locked is refused (reopen the lock first) - same rule as the
//    vendor invoices. Cancelling removes the expense row but keeps the purchase and its history; a paid purchase must be marked unpaid first.
//  * Admins only (financials). Every write is audited by the change-capture middleware (entity 'vendor_purchase').

const prisma = require('../../config/db');
const financialLock = require('../calculations/financialLock');
const { findVendorAccount } = require('../../lib/workerType');
const { round2, ymd } = require('../calculations/period');

const INCLUDE = {
  vendor_account: { select: { id: true, name: true } },
  charge: { select: { id: true } },
};

const num = (v) => Number(v || 0);
const monthOf = (d) => ({ period_month: d.getUTCMonth() + 1, period_year: d.getUTCFullYear() });
const netPayable = (p) => round2(num(p.amount) + num(p.gst_amount) - num(p.tds_amount) + num(p.adjustment_amount));

function serialize(row, fileCount = 0, categoryName = null, locationName = null) {
  return {
    id: row.id,
    kind: 'purchase',
    vendor_account: row.vendor_account ? { id: row.vendor_account.id, name: row.vendor_account.name } : null,
    vendor_account_id: row.vendor_account_id,
    bill_number: row.bill_number,
    bill_date: ymd(row.bill_date),
    due_date: row.due_date ? ymd(row.due_date) : null,
    period_month: row.period_month,
    period_year: row.period_year,
    description: row.description || null,
    category_id: row.category_id || null,
    category_name: categoryName || row.category_name || null,
    location_id: row.location_id || null,
    location_name: locationName || null,
    amount: num(row.amount),
    currency: row.currency,
    gst_amount: num(row.gst_amount),
    tds_amount: num(row.tds_amount),
    adjustment_amount: num(row.adjustment_amount),
    adjustment_note: row.adjustment_note || null,
    net_payable: netPayable(row),
    status: row.status,
    cancelled_at: row.cancelled_at || null,
    cancel_reason: row.cancel_reason || null,
    paid: Boolean(row.paid_on),
    paid_on: row.paid_on ? ymd(row.paid_on) : null,
    paid_amount: row.paid_amount === null || row.paid_amount === undefined ? null : num(row.paid_amount),
    payment_mode: row.payment_mode || null,
    payment_reference: row.payment_reference || null,
    expense_posted: Boolean(row.charge_id),
    file_count: fileCount,
    created_at: row.created_at,
  };
}

async function categoryOf(orgId, categoryId) {
  if (!categoryId) return { ok: true, id: null, name: null };
  const c = await prisma.financeCategory.findFirst({ where: { id: categoryId, org_id: orgId, kind: 'group_charge', is_active: true }, select: { id: true, name: true } });
  return c ? { ok: true, id: c.id, name: c.name } : { ok: false };
}

async function locationOk(orgId, locationId) {
  if (!locationId) return true;
  return Boolean(await prisma.location.findFirst({ where: { id: locationId, org_id: orgId }, select: { id: true } }));
}

// A vendor bill number is used once per vendor (cancelled purchases do not count).
async function numberTaken(orgId, vendorId, billNumber, exceptId = null) {
  const dup = await prisma.vendorPurchase.findFirst({
    where: { org_id: orgId, vendor_account_id: vendorId, status: 'active', bill_number: { equals: billNumber, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  return Boolean(dup);
}

function chargeNotes(vendorName, p) {
  return `Purchase - ${vendorName} - bill ${p.bill_number}${p.description ? ` - ${p.description}` : ''}`.slice(0, 500);
}

async function list(orgId, { period_month, period_year, vendor_account_id } = {}) {
  const rows = await prisma.vendorPurchase.findMany({
    where: { org_id: orgId, ...(period_month ? { period_month } : {}), ...(period_year ? { period_year } : {}), ...(vendor_account_id ? { vendor_account_id } : {}) },
    orderBy: [{ bill_date: 'desc' }, { created_at: 'desc' }],
    include: INCLUDE,
  });
  if (!rows.length) return [];
  const [files, locations] = await Promise.all([
    prisma.document.groupBy({ by: ['entity_id'], where: { entity_type: 'vendor_purchase', entity_id: { in: rows.map((r) => r.id) } }, _count: { _all: true } }),
    prisma.location.findMany({ where: { org_id: orgId, id: { in: [...new Set(rows.map((r) => r.location_id).filter(Boolean))] } }, select: { id: true, name: true } }),
  ]);
  const fileBy = new Map(files.map((g) => [g.entity_id, g._count._all]));
  const locBy = new Map(locations.map((l) => [l.id, l.name]));
  return rows.map((r) => serialize(r, fileBy.get(r.id) || 0, null, locBy.get(r.location_id) || null));
}

async function get(orgId, id) {
  const row = await prisma.vendorPurchase.findFirst({ where: { id, org_id: orgId }, include: INCLUDE });
  return row ? serialize(row) : null;
}

async function create(orgId, user, body) {
  const billDate = body.bill_date;
  const period = monthOf(billDate);
  const locked = await financialLock.assertOpen(orgId, period.period_month, period.period_year);
  if (locked) return locked;
  const vendor = await findVendorAccount(orgId, body.vendor_account_id);
  if (!vendor) return { error: 'vendor_not_found' };
  const category = await categoryOf(orgId, body.category_id);
  if (!category.ok) return { error: 'category_not_found' };
  if (!(await locationOk(orgId, body.location_id))) return { error: 'location_not_found' };
  if (await numberTaken(orgId, body.vendor_account_id, body.bill_number)) return { error: 'purchase_number_taken' };
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { org_group_id: true } });
  if (!org) return { error: 'org_not_found' };
  const vendorName = vendor.name || 'Vendor';

  const row = await prisma.$transaction(async (tx) => {
    const charge = await tx.groupBillingCharge.create({
      data: {
        org_group_id: org.org_group_id,
        org_id: orgId,
        period_month: period.period_month,
        period_year: period.period_year,
        payment_date: billDate,
        kind: category.name || 'Vendor purchase',
        category_id: category.id,
        location_id: body.location_id || null,
        notes: chargeNotes(vendorName, body),
        amount: body.amount,
        currency: body.currency,
        raised_by: user.id,
      },
    });
    return tx.vendorPurchase.create({
      data: {
        org_id: orgId,
        vendor_account_id: body.vendor_account_id,
        bill_number: body.bill_number,
        bill_date: billDate,
        due_date: body.due_date || null,
        ...period,
        description: body.description || null,
        category_id: category.id,
        category_name: category.name,
        location_id: body.location_id || null,
        amount: body.amount,
        currency: body.currency,
        gst_amount: body.gst_amount || 0,
        tds_amount: body.tds_amount || 0,
        adjustment_amount: body.adjustment_amount || 0,
        adjustment_note: body.adjustment_note || null,
        charge_id: charge.id,
        created_by: user.id,
      },
      include: INCLUDE,
    });
  });
  return { purchase: serialize(row) };
}

async function update(orgId, user, id, patch) {
  const existing = await prisma.vendorPurchase.findFirst({ where: { id, org_id: orgId }, include: INCLUDE });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'active') return { error: 'purchase_cancelled' };
  const newDate = patch.bill_date || existing.bill_date;
  const newPeriod = monthOf(newDate);
  // Both the month it is in and the month it moves to must be open.
  for (const p of [{ period_month: existing.period_month, period_year: existing.period_year }, newPeriod]) {
    const locked = await financialLock.assertOpen(orgId, p.period_month, p.period_year);
    if (locked) return locked;
  }
  const vendorId = patch.vendor_account_id || existing.vendor_account_id;
  let vendorName = existing.vendor_account?.name || 'Vendor';
  if (patch.vendor_account_id && patch.vendor_account_id !== existing.vendor_account_id) {
    const vendor = await findVendorAccount(orgId, patch.vendor_account_id);
    if (!vendor) return { error: 'vendor_not_found' };
    vendorName = vendor.name || vendorName;
  }
  let category = { ok: true, id: existing.category_id, name: existing.category_name };
  if (patch.category_id !== undefined) {
    category = await categoryOf(orgId, patch.category_id);
    if (!category.ok) return { error: 'category_not_found' };
  }
  if (patch.location_id && !(await locationOk(orgId, patch.location_id))) return { error: 'location_not_found' };
  const billNumber = patch.bill_number !== undefined ? patch.bill_number : existing.bill_number;
  if ((patch.bill_number !== undefined || patch.vendor_account_id) && (await numberTaken(orgId, vendorId, billNumber, existing.id))) return { error: 'purchase_number_taken' };

  const data = {};
  for (const k of ['bill_number', 'description', 'amount', 'currency', 'gst_amount', 'tds_amount', 'adjustment_amount', 'adjustment_note', 'due_date', 'location_id', 'vendor_account_id']) {
    if (patch[k] !== undefined) data[k] = patch[k] === '' ? null : patch[k];
  }
  if (patch.bill_date) Object.assign(data, { bill_date: patch.bill_date }, newPeriod);
  if (patch.category_id !== undefined) Object.assign(data, { category_id: category.id, category_name: category.name });
  const merged = { ...existing, ...data };

  const row = await prisma.$transaction(async (tx) => {
    const chargeData = {
      period_month: newPeriod.period_month,
      period_year: newPeriod.period_year,
      payment_date: newDate,
      kind: category.name || 'Vendor purchase',
      category_id: category.id,
      location_id: merged.location_id || null,
      notes: chargeNotes(vendorName, { bill_number: billNumber, description: merged.description }),
      amount: merged.amount,
      currency: merged.currency,
    };
    if (existing.charge_id) await tx.groupBillingCharge.update({ where: { id: existing.charge_id }, data: chargeData });
    return tx.vendorPurchase.update({ where: { id: existing.id }, data, include: INCLUDE });
  });
  return { purchase: serialize(row) };
}

// Cancel: the purchase stays (with who / when / why) but its expense row is removed. A paid purchase is marked unpaid first.
async function cancel(orgId, user, id, reason) {
  const existing = await prisma.vendorPurchase.findFirst({ where: { id, org_id: orgId }, include: INCLUDE });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'active') return { error: 'purchase_cancelled' };
  if (existing.paid_on) return { error: 'purchase_paid' };
  const locked = await financialLock.assertOpen(orgId, existing.period_month, existing.period_year);
  if (locked) return locked;
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.vendorPurchase.update({
      where: { id: existing.id },
      data: { status: 'cancelled', cancelled_at: new Date(), cancelled_by: user.id, cancel_reason: reason || null, charge_id: null },
      include: INCLUDE,
    });
    if (existing.charge_id) await tx.groupBillingCharge.delete({ where: { id: existing.charge_id } });
    return updated;
  });
  return { purchase: serialize(row) };
}

async function markPaid(orgId, id, { paid_on, paid_amount, payment_mode, payment_reference }) {
  const existing = await prisma.vendorPurchase.findFirst({ where: { id, org_id: orgId }, include: INCLUDE });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'active') return { error: 'purchase_cancelled' };
  const row = await prisma.vendorPurchase.update({
    where: { id: existing.id },
    data: { paid_on: paid_on || new Date(), paid_amount: paid_amount !== undefined ? paid_amount : netPayable(existing), payment_mode: payment_mode || null, payment_reference: payment_reference || null },
    include: INCLUDE,
  });
  return { purchase: serialize(row) };
}

async function markUnpaid(orgId, id) {
  const existing = await prisma.vendorPurchase.findFirst({ where: { id, org_id: orgId }, include: INCLUDE });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'active') return { error: 'purchase_cancelled' };
  const row = await prisma.vendorPurchase.update({ where: { id: existing.id }, data: { paid_on: null, paid_amount: null, payment_mode: null, payment_reference: null }, include: INCLUDE });
  return { purchase: serialize(row) };
}

module.exports = { list, get, create, update, cancel, markPaid, markUnpaid, netPayable };
