// Fixed-bid (fixed-price) projects: the project's billing rate is the TOTAL
// contract value (rate_type one_time), billed through several invoices.
//
//   total              the contract value (current billing rate)
//   invoiced           every invoice raised so far, any status - the cap: a new
//                      invoice may never push this past `total`
//   billed             what the project's LOCKED Billing & Sales months hold
//                      (the lock is the existing financial-effect switch)
//   balance            total - billed         (the Finance -> Projects column)
//   remaining_to_invoice  total - invoiced    (what a new invoice may still use)
//
// Monthly / hourly projects never come through here.

const prisma = require('../../config/db');
const { round2 } = require('../calculations/period');

const FROZEN = ['locked', 'change_detected'];
const FIXED_CATEGORY = 'project';

const isFixedBid = (account) => account?.service_category === FIXED_CATEGORY;

// The rate in force today, else the soonest upcoming one (same rule as the project profile).
function currentRate(rates, asOf = new Date()) {
  const sorted = [...rates].sort((a, b) => b.effective_from - a.effective_from || b.created_at - a.created_at);
  return sorted.find((r) => r.effective_from <= asOf) || sorted[sorted.length - 1] || null;
}

// accountId -> { total, currency, invoiced, billed, balance, remaining_to_invoice, invoice_count }
async function summaries(orgId, accountIds) {
  const out = new Map();
  if (!accountIds.length) return out;
  const [rates, invoices, calcs] = await Promise.all([
    prisma.billingRate.findMany({ where: { org_id: orgId, account_id: { in: accountIds }, requirement_id: null }, select: { account_id: true, rate: true, currency: true, effective_from: true, created_at: true } }),
    prisma.clientInvoice.findMany({ where: { org_id: orgId, client_account_id: { in: accountIds } }, select: { client_account_id: true, amount: true } }),
    prisma.financialCalculation.findMany({ where: { org_id: orgId, kind: 'billing', scope_key: { in: accountIds }, status: { in: FROZEN } }, select: { id: true, scope_key: true, current_version: true } }),
  ]);
  const versions = calcs.length
    ? await prisma.financialCalculationVersion.findMany({ where: { OR: calcs.map((c) => ({ calculation_id: c.id, version: c.current_version })) }, select: { calculation_id: true, amount: true } })
    : [];
  const versionAmount = new Map(versions.map((v) => [v.calculation_id, Number(v.amount)]));
  for (const id of accountIds) {
    const rate = currentRate(rates.filter((r) => r.account_id === id));
    const mine = invoices.filter((i) => i.client_account_id === id);
    const total = rate ? Number(rate.rate) : 0;
    const invoiced = round2(mine.reduce((s, i) => s + Number(i.amount), 0));
    const billed = round2(calcs.filter((c) => c.scope_key === id).reduce((s, c) => s + (versionAmount.get(c.id) || 0), 0));
    out.set(id, {
      total,
      currency: rate?.currency || 'INR',
      invoiced,
      billed,
      balance: round2(total - billed),
      remaining_to_invoice: round2(total - invoiced),
      invoice_count: mine.length,
    });
  }
  return out;
}

async function summaryFor(orgId, accountId) {
  return (await summaries(orgId, [accountId])).get(accountId);
}

// Is the project's Billing & Sales month already locked (so its invoices are final)?
async function monthLocked(orgId, accountId, { period_month, period_year }) {
  const calc = await prisma.financialCalculation.findFirst({
    where: { org_id: orgId, kind: 'billing', scope_key: accountId, period_month, period_year, status: { in: FROZEN } },
    select: { id: true },
  });
  return Boolean(calc);
}

// null when `amount` fits; else the error. `replacing` is the amount of an invoice being edited.
async function checkWithinBalance(orgId, accountId, amount, replacing = 0) {
  const s = await summaryFor(orgId, accountId);
  if (!s || !(s.total > 0)) return { error: 'no_billing_rate' };
  const remaining = round2(s.remaining_to_invoice + replacing);
  if (round2(amount) > remaining) return { error: 'fixed_bid_exceeds_balance', remaining, total: s.total, currency: s.currency };
  return null;
}

module.exports = { FIXED_CATEGORY, isFixedBid, currentRate, summaries, summaryFor, monthLocked, checkWithinBalance };
