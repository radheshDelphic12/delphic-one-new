const crypto = require('crypto');
const prisma = require('../../config/db');

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Normal-balance sign per account kind — asset/expense carry a debit
// balance, liability/equity/revenue carry a credit balance. Everything
// else in this module reports balances through this one function so the
// sign convention only lives in one place.
function normalBalance(kind, debitTotal, creditTotal) {
  return kind === 'asset' || kind === 'expense' ? round2(debitTotal - creditTotal) : round2(creditTotal - debitTotal);
}

async function createLedgerAccount(orgId, { name, kind }) {
  const existing = await prisma.ledgerAccount.findFirst({ where: { org_id: orgId, name } });
  if (existing) return { error: 'account_exists' };

  const account = await prisma.ledgerAccount.create({ data: { org_id: orgId, name, kind } });
  return { account };
}

async function listLedgerAccounts(orgId, { kind, is_active }) {
  return prisma.ledgerAccount.findMany({
    where: { org_id: orgId, ...(kind ? { kind } : {}), ...(is_active === undefined ? {} : { is_active }) },
    orderBy: { name: 'asc' },
  });
}

// A journal entry is a set of >=2 LedgerEntry rows sharing one transaction_id
// whose debits and credits balance to zero. Balance is checked here, in the
// service — not the DB — same posture as PayrollRun/ClientInvoice's
// forward-only status transitions (documented gap, not an oversight).
async function postJournalEntry(orgId, userId, { date, memo, source_ref, lines }) {
  if (!Array.isArray(lines) || lines.length < 2) return { error: 'insufficient_lines' };

  for (const line of lines) {
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    if (debit > 0 && credit > 0) return { error: 'line_both_sides' };
    if (debit <= 0 && credit <= 0) return { error: 'line_empty' };
  }

  const accountIds = [...new Set(lines.map((l) => l.ledger_account_id))];
  const accounts = await prisma.ledgerAccount.findMany({ where: { id: { in: accountIds }, org_id: orgId } });
  if (accounts.length !== accountIds.length) return { error: 'account_not_found' };

  const debitTotal = round2(lines.reduce((sum, l) => sum + Number(l.debit || 0), 0));
  const creditTotal = round2(lines.reduce((sum, l) => sum + Number(l.credit || 0), 0));
  if (debitTotal !== creditTotal) return { error: 'unbalanced' };

  const transactionId = crypto.randomUUID();
  const entries = await prisma.$transaction(
    lines.map((line) =>
      prisma.ledgerEntry.create({
        data: {
          org_id: orgId,
          ledger_account_id: line.ledger_account_id,
          transaction_id: transactionId,
          date,
          debit: line.debit || 0,
          credit: line.credit || 0,
          memo,
          source_ref,
          created_by: userId,
        },
      })
    )
  );
  return { entries, transaction_id: transactionId };
}

async function listLedgerEntries(orgId, { ledger_account_id, transaction_id, from, to, page, limit }) {
  const where = {
    org_id: orgId,
    ...(ledger_account_id ? { ledger_account_id } : {}),
    ...(transaction_id ? { transaction_id } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: { ledger_account: { select: { id: true, name: true, kind: true } } },
    }),
    prisma.ledgerEntry.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

async function getTrialBalance(orgId, { as_of } = {}) {
  const [accounts, grouped] = await Promise.all([
    prisma.ledgerAccount.findMany({ where: { org_id: orgId }, orderBy: { name: 'asc' } }),
    prisma.ledgerEntry.groupBy({
      by: ['ledger_account_id'],
      where: { org_id: orgId, ...(as_of ? { date: { lte: as_of } } : {}) },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const sumsByAccount = new Map(grouped.map((g) => [g.ledger_account_id, g._sum]));

  const rows = accounts.map((account) => {
    const sums = sumsByAccount.get(account.id);
    const debit_total = round2(Number(sums?.debit || 0));
    const credit_total = round2(Number(sums?.credit || 0));
    return {
      ledger_account_id: account.id,
      name: account.name,
      kind: account.kind,
      debit_total,
      credit_total,
      balance: normalBalance(account.kind, debit_total, credit_total),
    };
  });
  const totals = {
    debit_total: round2(rows.reduce((sum, r) => sum + r.debit_total, 0)),
    credit_total: round2(rows.reduce((sum, r) => sum + r.credit_total, 0)),
  };
  return { accounts: rows, totals, is_balanced: totals.debit_total === totals.credit_total };
}

async function getProfitAndLoss(orgId, { from, to }) {
  const [accounts, grouped] = await Promise.all([
    prisma.ledgerAccount.findMany({
      where: { org_id: orgId, kind: { in: ['revenue', 'expense'] } },
      orderBy: { name: 'asc' },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['ledger_account_id'],
      where: { org_id: orgId, date: { gte: from, lte: to } },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const sumsByAccount = new Map(grouped.map((g) => [g.ledger_account_id, g._sum]));

  const rows = accounts.map((account) => {
    const sums = sumsByAccount.get(account.id);
    const debit_total = round2(Number(sums?.debit || 0));
    const credit_total = round2(Number(sums?.credit || 0));
    return { ledger_account_id: account.id, name: account.name, kind: account.kind, amount: normalBalance(account.kind, debit_total, credit_total) };
  });
  const total_revenue = round2(rows.filter((r) => r.kind === 'revenue').reduce((sum, r) => sum + r.amount, 0));
  const total_expense = round2(rows.filter((r) => r.kind === 'expense').reduce((sum, r) => sum + r.amount, 0));
  return { period: { from, to }, lines: rows, total_revenue, total_expense, net_profit: round2(total_revenue - total_expense) };
}

async function getBalanceSheet(orgId, { as_of } = {}) {
  const trial = await getTrialBalance(orgId, { as_of });
  const byKind = (kind) => trial.accounts.filter((r) => r.kind === kind);
  const sumOf = (rows) => round2(rows.reduce((sum, r) => sum + r.balance, 0));

  const assets = byKind('asset');
  const liabilities = byKind('liability');
  const equity = byKind('equity');
  const total_assets = sumOf(assets);
  const total_liabilities = sumOf(liabilities);
  const total_equity = sumOf(equity);
  return {
    as_of: as_of || null,
    assets,
    liabilities,
    equity,
    total_assets,
    total_liabilities,
    total_equity,
    // A non-zero gap here means P&L hasn't been closed into equity yet — this
    // module doesn't do period-close/retained-earnings postings, so it's
    // reported, not auto-corrected (see Implementation Plan's Phase 8 note).
    balances: round2(total_assets - (total_liabilities + total_equity)),
  };
}

async function createTaxRecord(orgId, userId, { period_month, period_year, jurisdiction, kind, amount, currency }) {
  const record = await prisma.taxRecord.create({
    data: { org_id: orgId, period_month, period_year, jurisdiction, kind, amount, currency, created_by: userId },
  });
  return { record };
}

async function listTaxRecords(orgId, { period_month, period_year, jurisdiction, kind, status, page, limit }) {
  const where = {
    org_id: orgId,
    ...(period_month ? { period_month } : {}),
    ...(period_year ? { period_year } : {}),
    ...(jurisdiction ? { jurisdiction } : {}),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.taxRecord.findMany({
      where,
      orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.taxRecord.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

async function markTaxRecordFiled(orgId, taxRecordId) {
  const record = await prisma.taxRecord.findFirst({ where: { id: taxRecordId, org_id: orgId } });
  if (!record) return { error: 'not_found' };
  if (record.status !== 'pending') return { error: 'not_pending' };

  const updated = await prisma.taxRecord.update({ where: { id: taxRecordId }, data: { status: 'filed', filed_at: new Date() } });
  return { record: updated };
}

async function markTaxRecordPaid(orgId, taxRecordId) {
  const record = await prisma.taxRecord.findFirst({ where: { id: taxRecordId, org_id: orgId } });
  if (!record) return { error: 'not_found' };
  if (record.status !== 'filed') return { error: 'not_filed' };

  const updated = await prisma.taxRecord.update({ where: { id: taxRecordId }, data: { status: 'paid', paid_at: new Date() } });
  return { record: updated };
}

module.exports = {
  createLedgerAccount,
  listLedgerAccounts,
  postJournalEntry,
  listLedgerEntries,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  createTaxRecord,
  listTaxRecords,
  markTaxRecordFiled,
  markTaxRecordPaid,
};
