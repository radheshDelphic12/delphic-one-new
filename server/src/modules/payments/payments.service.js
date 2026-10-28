const { z } = require('zod');
const prisma = require('../../config/db');
const calc = require('../cashPosition/cash.calc');
const cashHooks = require('../cashPosition/cash.hooks');
const exchangeRates = require('../billing/exchangeRates.service');

const { D, money } = calc;

// One payment against a record (client invoice, expense claim, vendor payment ...). A record can take many payments (part payments);
// what is left is pending. The wallet side is optional: "track in a wallet? yes / no", default no. Money is only ever a Decimal.
//
//   amount          what the payment settles on the record, in the record's currency (gross)
//   exchange_rate   INR per 1 unit of that currency, typed at payment time (needed unless the currency is INR)
//   bank_charges    taken by the bank, in the same currency; with other_deductions (+ a note) they say why less arrived
//   wallet_payment  { wallet_id, mode, date? } only when the money is tracked in a wallet: net amount in / out of that wallet

// kinds with their own record and status (client invoice, expense, vendor payment) + kinds linked after the fact from other modules (TRACK_KINDS)
const TRACK_KINDS = {
  rent_payment: 'in', ledger_income: 'in', ledger_expense: 'out', group_expense: 'out', salary: 'out',
  deal_client_payment: 'in', deal_vendor_payment: 'out', investee_funding: 'out', investment: 'out', invoice_payment: 'in',
  franchise_settlement: 'in', debt_emi: 'out', debt_repayment: 'out', debt_received: 'in', other_in: 'in', other_out: 'out',
};
const KIND_DIRECTION = { client_invoice: 'in', expense: 'out', vendor_payment: 'out', ...TRACK_KINDS };
const KIND_LABEL = {
  client_invoice: 'Client invoice', expense: 'Expense reimbursement', vendor_payment: 'Vendor payment', rent_payment: 'Rent received', ledger_income: 'Income', ledger_expense: 'Expense',
  group_expense: 'Group expense', salary: 'Salary', deal_client_payment: 'Deal payment received', deal_vendor_payment: 'Deal vendor payment', investee_funding: 'Investee funding',
  investment: 'Investment', invoice_payment: 'Invoice payment received', franchise_settlement: 'Franchise settlement', debt_emi: 'Debt EMI', debt_repayment: 'Debt repayment',
  debt_received: 'Debt received', other_in: 'Money in', other_out: 'Money out',
};

const asString = (v) => (typeof v === 'number' ? String(v) : v);
const blank = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const dec = (re, msg) => z.preprocess(asString, z.string().trim().regex(re, msg));
const positive = dec(/^\d{1,14}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals').refine((v) => D(v).gt(0), 'The amount must be more than zero');
const nonNegative = dec(/^\d{1,14}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals');
const rate = dec(/^\d{1,8}(\.\d{1,6})?$/, 'Enter a rate with at most 6 decimals').refine((v) => D(v).gt(0), 'The rate must be more than zero');
const note = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

const paymentInputSchema = z.object({
  amount: z.preprocess(blank, positive.optional()),
  date: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional()),
  exchange_rate: z.preprocess(blank, rate.optional()),
  bank_charges: z.preprocess(blank, nonNegative.default('0')),
  other_deductions: z.preprocess(blank, nonNegative.default('0')),
  deduction_notes: note(500),
  notes: note(1000),
  wallet_payment: cashHooks.walletPaymentSchema.optional(),
});

const undoSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });

/** Error codes for the routes' own tables. */
const PAYMENT_ERRORS = {
  amount_required: [422, 'Enter how much was paid'],
  overpayment: [422, 'That is more than what is still pending'],
  rate_required: [422, 'Enter the exchange rate (INR per 1 unit of this currency)'],
  deductions_too_high: [422, 'Bank charges and deductions cannot be more than the amount'],
  wallet_amount_zero: [422, 'Nothing is left to post to the wallet after the charges and deductions'],
  payment_not_found: [404, 'Payment not found'],
  already_undone: [409, 'That payment was already undone'],
  ...cashHooks.HOOK_ERRORS,
};

const toDate = (s) => new Date(`${s}T00:00:00.000Z`);
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const plain = (o) => JSON.parse(JSON.stringify(o));

/** The wallet a payment is tracked in, and the amount that goes in / out of it (INR wallets take a foreign payment at its rate). */
async function resolveWallet({ orgId, user, walletPayment, currency, net, rate }) {
  const org = await cashHooks.groupOf(prisma, orgId);
  if (!org) return { error: 'wallet_not_allowed' };
  const wallet = await prisma.wallet.findUnique({ where: { id: walletPayment.wallet_id }, include: { owner_legal_entity: true } });
  if (!wallet || !(await cashHooks.walletAllowed(prisma, user, orgId, org.org_group_id, wallet))) return { error: 'wallet_not_allowed' };
  if (!wallet.active) return { error: 'wallet_inactive' };
  let amount;
  if (wallet.currency === currency) amount = net;
  else if (wallet.currency === 'INR' && rate) amount = D(net).mul(rate).toDecimalPlaces(2);
  else return { error: 'wallet_currency' };
  if (!D(amount).gt(0)) return { error: 'wallet_amount_zero' };
  return { wallet, amount: D(amount), groupId: org.org_group_id };
}

/**
 * Checks a payment and returns { error } or { payment, commit(tx) } - commit creates the payment record (and the wallet entry when it is
 * tracked) inside the caller's transaction, next to the update of the record itself.
 *   record = { kind, id, currency, pending (Decimal), party, category }   fixedAmount = pay exactly this (expense, vendor payment)
 */
async function prepare({ orgId, user, record, input, fixedAmount }) {
  const direction = KIND_DIRECTION[record.kind];
  const amountText = fixedAmount !== undefined ? String(fixedAmount) : input.amount;
  if (!amountText) return { error: 'amount_required' };
  const amount = D(amountText);
  if (amount.gt(record.pending)) return { error: 'overpayment' };
  const currency = record.currency;
  if (currency !== 'INR' && !input.exchange_rate) return { error: 'rate_required' };
  const rateValue = currency === 'INR' ? null : D(input.exchange_rate);
  const charges = D(input.bank_charges);
  const deductions = D(input.other_deductions);
  if (charges.plus(deductions).gt(amount)) return { error: 'deductions_too_high' };
  const net = amount.minus(charges).minus(deductions);
  const inr = rateValue ? amount.mul(rateValue).toDecimalPlaces(2) : amount;
  const date = input.date || today();

  let wallet = null;
  if (input.wallet_payment) {
    wallet = await resolveWallet({ orgId, user, walletPayment: input.wallet_payment, currency, net, rate: rateValue });
    if (wallet.error) return { error: wallet.error };
  }
  const data = {
    org_id: orgId, kind: record.kind, reference_id: record.id, direction, paid_on: toDate(date), amount, currency,
    exchange_rate: rateValue, inr_amount: inr, bank_charges: charges, other_deductions: deductions,
    deduction_notes: input.deduction_notes || null, notes: input.notes || null, created_by: user?.id || null,
  };
  return {
    commit: async (tx) => {
      const payment = await tx.paymentRecord.create({ data });
      if (!wallet) return payment;
      const parts = [];
      if (charges.gt(0)) parts.push(`bank charges ${money(charges)}`);
      if (deductions.gt(0)) parts.push(`deductions ${money(deductions)}${input.deduction_notes ? ` (${input.deduction_notes})` : ''}`);
      const entry = await tx.walletTransaction.create({
        data: {
          wallet_id: wallet.wallet.id, date: toDate(input.wallet_payment.date || date), direction, amount: wallet.amount, mode: input.wallet_payment.mode,
          category: record.category || KIND_LABEL[record.kind], party: record.party || null, reference_type: 'payment', reference_id: payment.id,
          notes: [input.notes, parts.join('; ')].filter(Boolean).join(' - ') || null, created_by: user?.id || null,
        },
      });
      await tx.walletAudit.create({ data: { org_group_id: wallet.groupId, entity_type: 'transaction', entity_id: entry.id, action: 'create', after: plain(entry), actor_id: user?.id || null } });
      return tx.paymentRecord.update({ where: { id: payment.id }, data: { wallet_transaction_id: entry.id } });
    },
  };
}

/** The rate typed at payment time wins; with none, the company's saved rate for a foreign currency (the screens always send the typed one). */
async function withSavedRate(orgId, currency, input) {
  if (currency === 'INR' || input.exchange_rate) return input;
  const saved = (await exchangeRates.inrRates(orgId)).get(currency);
  return saved ? { ...input, exchange_rate: String(saved) } : input;
}

/** Sum of the live payments (gross, in the record's currency) and how many, for one record or many. */
async function totals(client, orgId, kind, ids) {
  const out = new Map(ids.map((id) => [id, { paid: calc.ZERO, count: 0 }]));
  if (!ids.length) return out;
  const rows = await client.paymentRecord.groupBy({ by: ['reference_id'], where: { org_id: orgId, kind, reference_id: { in: ids }, deleted_at: null }, _sum: { amount: true }, _count: { _all: true } });
  for (const r of rows) out.set(r.reference_id, { paid: D(r._sum.amount), count: r._count._all });
  return out;
}

/** paid / pending / status of a record of `amount`. */
function summarize(amount, paid) {
  const pending = D(amount).minus(paid);
  const status = D(paid).lte(0) ? 'unpaid' : pending.gt(0) ? 'partly_paid' : 'paid';
  return { paid_amount: money(paid), pending_amount: money(pending.lt(0) ? calc.ZERO : pending), payment_status: status };
}

function serialize(row, wallet) {
  const net = D(row.amount).minus(row.bank_charges).minus(row.other_deductions);
  return {
    id: row.id, kind: row.kind, reference_id: row.reference_id, direction: row.direction, paid_on: ymd(row.paid_on),
    amount: money(row.amount), currency: row.currency, exchange_rate: row.exchange_rate === null ? null : D(row.exchange_rate).toString(), inr_amount: money(row.inr_amount),
    bank_charges: money(row.bank_charges), other_deductions: money(row.other_deductions), deduction_notes: row.deduction_notes, net_amount: money(net), notes: row.notes,
    wallet: wallet ? { id: wallet.id, name: wallet.name } : null, created_by: row.created_by, created_at: row.created_at,
    undone: Boolean(row.deleted_at), undone_reason: row.delete_reason || null,
  };
}

async function list(orgId, kind, referenceId, { includeUndone = false } = {}) {
  const rows = await prisma.paymentRecord.findMany({ where: { org_id: orgId, kind, reference_id: referenceId, ...(includeUndone ? {} : { deleted_at: null }) }, orderBy: [{ paid_on: 'asc' }, { created_at: 'asc' }] });
  const txIds = rows.map((r) => r.wallet_transaction_id).filter(Boolean);
  const txs = txIds.length ? await prisma.walletTransaction.findMany({ where: { id: { in: txIds } }, include: { wallet: { select: { id: true, name: true } } } }) : [];
  const walletOf = new Map(txs.map((t) => [t.id, t.wallet]));
  return rows.map((r) => serialize(r, r.wallet_transaction_id ? walletOf.get(r.wallet_transaction_id) : null));
}

/** Undoes a payment (the caller has already checked who may): the record stays marked undone, its wallet entry is removed. */
async function undoWithin(tx, { orgId, user, kind, referenceId, paymentId, reason }) {
  const where = { org_id: orgId, kind, reference_id: referenceId, ...(paymentId ? { id: paymentId } : {}) };
  const rows = await tx.paymentRecord.findMany({ where: { ...where, deleted_at: null } });
  if (paymentId && !rows.length) {
    const any = await tx.paymentRecord.findFirst({ where });
    return { error: any ? 'already_undone' : 'payment_not_found' };
  }
  for (const row of rows) {
    await tx.paymentRecord.update({ where: { id: row.id }, data: { deleted_at: new Date(), deleted_by: user?.id || null, delete_reason: reason } });
    await cashHooks.unlink(tx, user?.id || null, 'payment', row.id);
  }
  return { undone: rows.length };
}

/**
 * Every live payment of the given companies in a date range (Group Dashboard > Book Keeping > Payments): what was paid, its rate and INR
 * value, bank charges and deductions with their notes, the net, and the wallet it was tracked in (if any). Totals per currency + in INR.
 */
async function report(orgIds, { from, to, kind, direction, org_id } = {}) {
  const date = {};
  if (from) date.gte = toDate(from);
  if (to) date.lte = toDate(to);
  const rows = await prisma.paymentRecord.findMany({
    where: { org_id: org_id ? { in: orgIds.filter((id) => id === org_id) } : { in: orgIds }, deleted_at: null, ...(kind ? { kind } : {}), ...(direction ? { direction } : {}), ...(from || to ? { paid_on: date } : {}) },
    include: { org: { select: { id: true, name: true } } },
    orderBy: [{ paid_on: 'desc' }, { created_at: 'desc' }],
  });
  const txIds = rows.map((r) => r.wallet_transaction_id).filter(Boolean);
  const txs = txIds.length ? await prisma.walletTransaction.findMany({ where: { id: { in: txIds } }, include: { wallet: { select: { name: true } } } }) : [];
  const walletOf = new Map(txs.map((t) => [t.id, t.wallet.name]));
  const byCurrency = {};
  let inrIn = calc.ZERO;
  let inrOut = calc.ZERO;
  const out = rows.map((r) => {
    const net = D(r.amount).minus(r.bank_charges).minus(r.other_deductions);
    const t = byCurrency[r.currency] || (byCurrency[r.currency] = { in: calc.ZERO, out: calc.ZERO, bank_charges: calc.ZERO, deductions: calc.ZERO });
    t[r.direction] = t[r.direction].plus(r.amount);
    t.bank_charges = t.bank_charges.plus(r.bank_charges);
    t.deductions = t.deductions.plus(r.other_deductions);
    if (r.direction === 'in') inrIn = inrIn.plus(r.inr_amount); else inrOut = inrOut.plus(r.inr_amount);
    return {
      id: r.id, company: r.org.name, company_id: r.org.id, kind: r.kind, label: KIND_LABEL[r.kind] || r.kind, direction: r.direction, paid_on: ymd(r.paid_on),
      amount: money(r.amount), currency: r.currency, exchange_rate: r.exchange_rate === null ? null : D(r.exchange_rate).toString(), inr_amount: money(r.inr_amount),
      bank_charges: money(r.bank_charges), other_deductions: money(r.other_deductions), deduction_notes: r.deduction_notes, net_amount: money(net), notes: r.notes,
      wallet: r.wallet_transaction_id ? walletOf.get(r.wallet_transaction_id) || null : null,
    };
  });
  const totals = Object.fromEntries(Object.entries(byCurrency).map(([c, t]) => [c, { in: money(t.in), out: money(t.out), bank_charges: money(t.bank_charges), deductions: money(t.deductions) }]));
  return { rows: out, totals, inr: { in: money(inrIn), out: money(inrOut) }, kinds: Object.entries(KIND_LABEL).map(([key, label]) => ({ key, label })) };
}

/**
 * Edits a payment: the old one stays in the history as undone ("Edited") and the corrected one is recorded in the same transaction
 * (so the wallet entry is replaced, never doubled). `record.pending` must already leave out the payment being replaced.
 */
async function replace({ orgId, user, kind, referenceId, paymentId, record, input, fixedAmount, reason }) {
  const old = await prisma.paymentRecord.findFirst({ where: { id: paymentId, org_id: orgId, kind, reference_id: referenceId } });
  if (!old) return { error: 'payment_not_found' };
  if (old.deleted_at) return { error: 'already_undone' };
  const prepared = await prepare({ orgId, user, record, input, fixedAmount });
  if (prepared.error) return { error: prepared.error };
  const payment = await prisma.$transaction(async (tx) => {
    await undoWithin(tx, { orgId, user, kind, referenceId, paymentId, reason: reason || 'Edited' });
    return prepared.commit(tx);
  });
  return { payment, old };
}

module.exports = { replace, report, TRACK_KINDS, KIND_DIRECTION, PAYMENT_ERRORS, paymentInputSchema, undoSchema, prepare, withSavedRate, totals, summarize, serialize, list, undoWithin };
