const { z } = require('zod');
const prisma = require('../../../config/db');
const { writeAudit } = require('../audit');
const { guard, touch } = require('../lock');

// Shared helpers of the Novarex operations layer (products, stock, orders, invoices, logistics, franchise).
class OpsError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}
const fail = (code, detail) => { throw new OpsError(code, detail); };

const ERR = {
  not_found: [404, 'Record not found'],
  duplicate: [409, 'That code, number or name already exists'],
  invalid_ref: [422, 'A linked record was not found in this company'],
  inactive_ref: [422, 'A linked record is inactive or archived'],
  insufficient_stock: [422, 'Not enough eligible stock (expired, quarantined, recalled and reserved stock is not available)'],
  expired_batch: [422, 'That batch is expired or not released for sale or dispatch'],
  bad_status: [409, 'That action is not allowed in the current status'],
  already_posted: [409, 'That document is already posted. Correct it with a return, adjustment or credit note'],
  empty_lines: [422, 'Add at least one line with a quantity'],
  bad_qty: [422, 'Quantity is not valid for this line'],
  use_transfer: [422, 'This customer is a company-owned outlet: move stock with a stock transfer, not a sale'],
  use_sales_order: [422, 'The destination is a franchise or third-party outlet: it buys goods, so use a sales order'],
  same_location: [422, 'Source and destination must differ'],
  invoice_exists: [409, 'An invoice already exists for this transaction'],
  not_ready_to_invoice: [409, 'The invoicing policy does not allow an invoice at this stage yet'],
  overpayment: [422, 'The payment is more than the outstanding amount'],
  nothing_to_invoice: [422, 'Nothing is left to invoice'],
  agreement_overlap: [409, 'This outlet already has an active franchise agreement'],
  not_franchise_outlet: [422, 'Franchise agreements apply to franchise or third-party outlets only'],
  period_closed: [409, 'That month is closed. An admin must reopen it first'],
  period_reason_required: [422, 'That month is closed. Enter a reason to edit it as admin'],
  forbidden_outlet: [403, 'That record belongs to an outlet outside your access'],
  has_stock: [409, 'This location still holds stock. Move or adjust it first'],
  rate_card_missing: [422, 'No active rate card for that partner'],
  bad_range: [422, 'Choose a valid date range'],
  unknown_report: [404, 'Unknown report'],
};

const num = (v) => Number(v ?? 0);
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const round3 = (v) => Math.round((Number(v) + Number.EPSILON) * 1000) / 1000;
const today = () => new Date().toISOString().slice(0, 10);
const dayOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---- zod building blocks ----
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const blank = (v) => (v === '' ? null : v);
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optDate = z.preprocess(blank, dateStr.nullable().optional());
const uuid = z.string().uuid();
const uuidOrNull = z.preprocess(blank, uuid.nullable().optional());
const optNum = (min = 0, max = 1e12) => z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(min).max(max).optional());
const qty = z.coerce.number().positive().max(1e9);

/** Next document number, e.g. PO-0001. One counter row per org + key; safe under concurrency (atomic upsert). */
async function nextNo(tx, orgId, key, prefix, width = 4) {
  const row = await tx.nxCounter.upsert({
    where: { org_id_key: { org_id: orgId, key } },
    create: { org_id: orgId, key, seq: 1 },
    update: { seq: { increment: 1 } },
  });
  return `${prefix}-${String(row.seq).padStart(width, '0')}`;
}

/** One writer per company at a time for stock / invoice postings: no double posting, no negative balances under concurrency. */
const lockOrg = (tx, orgId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`;

/** Outlet scope of the caller: null = whole company, otherwise the outlet ids they may see. */
const scopeOf = (req) => (req.nx.outlet_ids ? req.nx.outlet_ids : null);
const outletAllowed = (scope, outletId) => !scope || (outletId && scope.includes(outletId));

/** Month lock for money dated `dates`: the same rule as every other Novarex money record. */
async function lockGuard(orgId, dates, ctx) {
  const err = await guard(orgId, dates.filter(Boolean), ctx);
  if (err) fail(err.error);
}
const lockTouch = (orgId, dates) => touch(orgId, dates.filter(Boolean));

const audit = (db, orgId, actorId, entity, entityId, action, before, after, reason) =>
  writeAudit(db, { orgId, actorId, entity, entityId, action, before, after, reason });

/** Find or create a finance category by scope + name (the finance books group by category; the admin can rename / switch off later). */
async function categoryId(tx, orgId, scope, name) {
  const found = await tx.nxCategory.findFirst({ where: { org_id: orgId, scope, name, deleted_at: null }, select: { id: true } });
  if (found) return found.id;
  const row = await tx.nxCategory.create({ data: { org_id: orgId, scope, name } }).catch(async (e) => {
    if (e.code === 'P2002') return tx.nxCategory.findFirst({ where: { org_id: orgId, scope, name }, select: { id: true } });
    throw e;
  });
  return row.id;
}

/** Unit state-aware GST split. Same state (or unknown) = CGST + SGST, different state = IGST. */
function gstSplit(taxTotal, fromState, toState) {
  const inter = Boolean(fromState && toState && fromState.trim().toLowerCase() !== toState.trim().toLowerCase());
  return inter
    ? { type: 'IGST', igst: round2(taxTotal), cgst: 0, sgst: 0 }
    : { type: 'CGST+SGST', igst: 0, cgst: round2(taxTotal / 2), sgst: round2(taxTotal - round2(taxTotal / 2)) };
}

/** Totals of document lines: [{ qty, unit_price, discount_pct, gst_rate }] -> amounts per line and overall. */
function priceLines(lines) {
  let subtotal = 0;
  let tax = 0;
  const out = lines.map((l) => {
    const gross = num(l.qty) * num(l.unit_price);
    const net = round2(gross * (1 - num(l.discount_pct) / 100));
    const t = round2(net * (num(l.gst_rate) / 100));
    subtotal += net;
    tax += t;
    return { ...l, net_amount: net, tax_amount: t, line_total: round2(net + t) };
  });
  return { lines: out, subtotal: round2(subtotal), tax_total: round2(tax), total: round2(subtotal + tax) };
}

module.exports = {
  z, prisma, OpsError, fail, ERR, num, round2, round3, today, dayOf, toDate, addDays, dateStr, blank, text, optDate, uuid, uuidOrNull, optNum, qty,
  nextNo, lockOrg, scopeOf, outletAllowed, lockGuard, lockTouch, audit, categoryId, gstSplit, priceLines,
};
