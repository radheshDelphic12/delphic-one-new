const { z } = require('zod');
const { D, CURRENCIES, ACCOUNT_TYPES, MODES } = require('./cash.calc');

const blank = (v) => (v === '' || v === undefined ? null : v);
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const uuid = z.string().uuid();
const uuidOrNull = z.preprocess(blank, z.string().uuid().nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const asString = (v) => (typeof v === 'number' ? String(v) : v);

// Amounts travel as strings or numbers with at most 2 decimals and are only ever handled as Decimal.
const amount = z.preprocess(asString, z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals').refine((v) => D(v).gt(0), 'The amount must be more than zero'));
const signedAmount = z.preprocess((v) => (v === '' || v === undefined || v === null ? '0' : asString(v)), z.string().trim().regex(/^-?\d{1,14}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals'));

const entityBody = z.object({
  name: z.string().trim().min(1).max(200),
  workspace_id: uuidOrNull,
  gstin: text(20),
  pan: text(20),
  address: text(500),
  invoice_prefix: z.preprocess((x) => (typeof x === 'string' && x.trim() === '' ? null : typeof x === 'string' ? x.trim().toUpperCase() : x), z.string().regex(/^[A-Z0-9]{1,10}$/, 'Prefix: letters and digits only, up to 10').nullable().optional()),
  state_code: z.preprocess((x) => (typeof x === 'string' && x.trim() === '' ? null : x), z.string().trim().regex(/^\d{2}$/, 'Use the 2-digit GST state code').nullable().optional()),
  lut_note: text(500),
  logo_url: text(500),
  active: z.boolean().optional(),
});

// An optional alert level: empty / null = none, otherwise a non-negative amount.
const minimumBalance = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.union([z.null(), z.preprocess((x) => (typeof x === 'number' ? String(x) : x), z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/, 'Enter a minimum balance of 0 or more, with at most 2 decimals'))])).optional();

const accountBody = z.object({
  legal_entity_id: uuidOrNull,
  name: z.string().trim().min(1).max(200),
  type: z.enum(ACCOUNT_TYPES),
  bank_name: text(120),
  account_last4: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().regex(/^\d{4}$/, 'Last 4 digits only').nullable().optional()),
  currency: z.enum(CURRENCIES),
  declared_opening_balance: signedAmount.default('0'),
  minimum_balance: minimumBalance,
  opening_date: dateStr,
  payment_instructions: text(1000),
});
const accountUpdate = z.object({
  legal_entity_id: uuidOrNull,
  name: z.string().trim().min(1).max(200),
  bank_name: text(120),
  account_last4: accountBody.shape.account_last4,
  declared_opening_balance: signedAmount,
  minimum_balance: minimumBalance,
  opening_date: dateStr,
  payment_instructions: text(1000),
  active: z.boolean(),
}).partial();

const WALLET_PURPOSES = ['general', 'salary', 'travel'];
const walletBody = z.object({
  bank_account_id: uuidOrNull,
  currency: z.enum(CURRENCIES).optional(),
  owner_org_id: uuidOrNull,
  owner_legal_entity_id: uuidOrNull,
  purpose: z.enum(WALLET_PURPOSES).default('general'),
  name: z.string().trim().min(1).max(200),
  opening_balance: signedAmount.default('0'),
});
const walletUpdate = z.object({
  bank_account_id: uuidOrNull,
  currency: z.enum(CURRENCIES),
  owner_org_id: uuidOrNull,
  owner_legal_entity_id: uuidOrNull,
  name: z.string().trim().min(1).max(200),
  purpose: z.enum(WALLET_PURPOSES),
  opening_balance: signedAmount,
  active: z.boolean(),
}).partial();

const txBody = z.object({
  date: dateStr,
  direction: z.enum(['in', 'out']),
  amount,
  mode: z.enum(MODES),
  category: text(120),
  party: text(200),
  notes: text(2000),
});
const txUpdate = txBody.partial();

const transferBody = z.object({
  from_wallet_id: uuid,
  to_wallet_id: uuid,
  date: dateStr,
  amount,
  notes: text(2000),
});
const transferUpdate = z.object({ date: dateStr, amount, notes: text(2000) }).partial();

const reconciliationBody = z.object({
  bank_account_id: uuid,
  statement_date: dateStr,
  statement_balance: signedAmount,
  notes: text(2000),
});

const reconciliationUpdate = z.object({ statement_date: dateStr, statement_balance: signedAmount, notes: text(2000) }).partial();

const settingsBody = z.object({ go_live_date: z.preprocess((x) => (x === '' ? null : x), dateStr.nullable()) });

const range = { from: dateStr.optional(), to: dateStr.optional() };
const positionQuery = z.object({
  legal_entity_id: uuid.optional(),
  workspace_id: uuid.optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  currency: z.enum(CURRENCIES).optional(),
});
const entriesQuery = z.object({ ...range, format: z.enum(['json', 'csv', 'pdf']).default('json') });
// A statement of one bank account, wallet, company or legal entity; company / entity need a currency when they hold both.
const statementQuery = z.object({ ...range, scope: z.enum(['account', 'wallet', 'company', 'entity']), id: uuid, currency: z.enum(CURRENCIES).optional(), format: z.enum(['json', 'csv', 'pdf']).default('json') });
const paymentsReportQuery = z.object({ ...range, kind: z.string().max(40).optional(), direction: z.enum(['in', 'out']).optional(), org_id: uuid.optional(), format: z.enum(['json', 'csv']).default('json') });
const receiptsQuery = z.object({ ...range, workspace_id: uuid.optional(), wallet_id: uuid.optional(), format: z.enum(['json', 'csv']).default('json') });
const auditQuery = z.object({ entity_type: z.string().max(40).optional(), entity_id: uuid.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

module.exports = { reconciliationUpdate, settingsBody, entityBody, accountBody, accountUpdate, walletBody, walletUpdate, txBody, txUpdate, transferBody, transferUpdate, reconciliationBody, positionQuery, entriesQuery, statementQuery, paymentsReportQuery, receiptsQuery, auditQuery };
