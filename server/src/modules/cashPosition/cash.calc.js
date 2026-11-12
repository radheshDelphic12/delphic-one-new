const { Prisma } = require('@prisma/client');

// Pure rules of group cash. Money is always a Prisma.Decimal here (never a float), and nothing is stored as a balance:
// a wallet's balance is its opening balance plus its transactions, an account's balance is the sum of its wallets.

const D = (v) => new Prisma.Decimal(v === null || v === undefined || v === '' ? 0 : v);
const ZERO = D(0);
const money = (d) => D(d).toFixed(2);

const CURRENCIES = ['INR', 'USD'];
const ACCOUNT_TYPES = ['current', 'savings', 'cash'];
const PURPOSES = ['general', 'salary', 'travel', 'unallocated'];
const MODES = ['cash', 'upi', 'cheque', 'neft', 'rtgs', 'imps', 'swift', 'other'];

/** The amount a transaction adds to (in) or takes from (out) its wallet. */
const signed = (tx) => (tx.direction === 'in' ? D(tx.amount) : D(tx.amount).neg());

const sum = (values) => values.reduce((acc, v) => acc.plus(D(v)), ZERO);

/** Opening balance + every transaction (the caller passes only live, non-deleted ones). */
function walletBalance(opening, transactions) {
  return transactions.reduce((acc, tx) => acc.plus(signed(tx)), D(opening));
}

/** Who owns a wallet, as a company: its workspace, or the workspace its legal entity is (Unallocated money of Delphic Global is still Delphic Global's). */
function ownerKey(wallet) {
  if (wallet.owner_org_id) return `org:${wallet.owner_org_id}`;
  const entity = wallet.owner_legal_entity;
  if (entity?.workspace_id) return `org:${entity.workspace_id}`;
  return wallet.owner_legal_entity_id ? `entity:${wallet.owner_legal_entity_id}` : 'none';
}

/** Same bank account: only ownership moves (reallocation). Different accounts: real money moves (bank transfer). */
const transferKind = (from, to) => (from.bank_account_id && from.bank_account_id === to.bank_account_id ? 'reallocation' : 'bank_transfer');

const isIntercompany = (from, to) => ownerKey(from) !== ownerKey(to);

/** Declared opening balance of an account minus what its wallets add up to; non-zero means setup is not finished. */
function openingGap(declared, wallets) {
  return D(declared).minus(sum(wallets.map((w) => w.opening_balance)));
}

/** Rows (oldest first) with the balance after each one, starting from `opening`. */
function withRunningBalance(opening, rows) {
  let running = D(opening);
  return rows.map((row) => {
    running = running.plus(signed(row));
    return { ...row, balance_after: money(running) };
  });
}

/** Money in / out / count per payment mode. */
function modeBreakdown(rows) {
  const out = {};
  for (const row of rows) {
    const m = (out[row.mode] ||= { in: ZERO, out: ZERO, count: 0 });
    m[row.direction] = m[row.direction].plus(D(row.amount));
    m.count += 1;
  }
  return Object.fromEntries(Object.entries(out).map(([mode, v]) => [mode, { in: money(v.in), out: money(v.out), count: v.count }]));
}

/** Totals per currency, never mixed: { INR: '0.00', USD: '0.00' }. */
function totalsByCurrency(items, amountOf) {
  const totals = { INR: ZERO, USD: ZERO };
  for (const item of items) totals[item.currency] = totals[item.currency].plus(D(amountOf(item)));
  return { INR: money(totals.INR), USD: money(totals.USD) };
}

module.exports = { D, ZERO, money, sum, CURRENCIES, ACCOUNT_TYPES, PURPOSES, MODES, signed, walletBalance, ownerKey, transferKind, isIntercompany, openingGap, withRunningBalance, modeBreakdown, totalsByCurrency };
