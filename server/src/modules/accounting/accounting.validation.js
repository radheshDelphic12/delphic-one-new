const { z } = require('zod');

const CURRENCY = z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']);
const LEDGER_KIND = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);
const DATE = z.coerce.date();

const createLedgerAccountSchema = z.object({
  name: z.string().min(1).max(200),
  kind: LEDGER_KIND,
});

const listLedgerAccountsQuerySchema = z.object({
  kind: LEDGER_KIND.optional(),
  is_active: z.coerce.boolean().optional(),
});

const journalLineSchema = z
  .object({
    ledger_account_id: z.string().uuid(),
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
  })
  .refine((l) => !(l.debit > 0 && l.credit > 0), { message: 'A line cannot have both debit and credit' })
  .refine((l) => l.debit > 0 || l.credit > 0, { message: 'A line must have a debit or a credit' });

const postJournalEntrySchema = z.object({
  date: DATE,
  memo: z.string().max(500).optional(),
  source_ref: z.record(z.any()).optional(),
  lines: z.array(journalLineSchema).min(2),
});

const listLedgerEntriesQuerySchema = z.object({
  ledger_account_id: z.string().uuid().optional(),
  transaction_id: z.string().uuid().optional(),
  from: DATE.optional(),
  to: DATE.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const trialBalanceQuerySchema = z.object({
  as_of: DATE.optional(),
});

const profitAndLossQuerySchema = z.object({
  from: DATE,
  to: DATE,
});

const balanceSheetQuerySchema = z.object({
  as_of: DATE.optional(),
});

const createTaxRecordSchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
  jurisdiction: z.string().min(1).max(100),
  kind: z.string().min(1).max(100),
  amount: z.coerce.number().positive(),
  currency: CURRENCY.default('INR'),
});

const listTaxRecordsQuerySchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12).optional(),
  period_year: z.coerce.number().int().min(2000).max(2100).optional(),
  jurisdiction: z.string().optional(),
  kind: z.string().optional(),
  status: z.enum(['pending', 'filed', 'paid']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

module.exports = {
  createLedgerAccountSchema,
  listLedgerAccountsQuerySchema,
  postJournalEntrySchema,
  listLedgerEntriesQuerySchema,
  trialBalanceQuerySchema,
  profitAndLossQuerySchema,
  balanceSheetQuerySchema,
  createTaxRecordSchema,
  listTaxRecordsQuerySchema,
};
