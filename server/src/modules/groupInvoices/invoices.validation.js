const { z } = require('zod');
const { D, MODES } = require('../cashPosition/cash.calc');
const { GST_RATES, TYPES } = require('./invoices.calc');

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const asString = (v) => (typeof v === 'number' ? String(v) : v);
const stateCode = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().regex(/^\d{2}$/, 'Use the 2-digit GST state code').nullable().optional());
const gstin = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim().toUpperCase() : v), z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'That is not a valid GSTIN').nullable().optional());
const qty = z.preprocess(asString, z.string().trim().regex(/^\d{1,10}(\.\d{1,3})?$/, 'Quantity: up to 3 decimals').refine((v) => D(v).gt(0), 'Quantity must be more than zero'));
const rate = z.preprocess(asString, z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Rate: up to 2 decimals').refine((v) => D(v).gt(0), 'Rate must be more than zero'));
const amount = z.preprocess(asString, z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals').refine((v) => D(v).gt(0), 'The amount must be more than zero'));

const line = z.object({
  description: z.string().trim().min(1).max(500),
  hsn_sac: text(12),
  qty,
  rate,
  gst_rate: z.coerce.number().refine((v) => GST_RATES.includes(v), 'Use a GST rate of 0, 0.25, 3, 5, 12, 18 or 28').default(0),
});

const invoiceBody = z.object({
  legal_entity_id: z.string().uuid(),
  workspace_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  type: z.enum(TYPES),
  invoice_date: dateStr,
  due_date: z.preprocess((v) => (v === '' ? null : v), dateStr.nullable().optional()),
  buyer_name: z.string().trim().min(1).max(200),
  buyer_gstin: gstin,
  buyer_address: text(500),
  buyer_state_code: stateCode,
  place_of_supply: stateCode,
  lines: z.array(line).min(1).max(100),
  receiving_wallet_id: z.string().uuid(),
  notes: text(2000),
  payment_instructions: text(1000),
  lut_note: text(500),
});

const paymentBody = z.object({ date: dateStr, amount, mode: z.enum(MODES), notes: text(2000) });
const cancelBody = z.object({ reason: z.string().trim().min(3).max(500) });
const listQuery = z.object({
  legal_entity_id: z.string().uuid().optional(),
  workspace_id: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  status: z.enum(['unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled']).optional(),
  search: z.string().trim().max(100).optional(),
});

module.exports = { invoiceBody, paymentBody, cancelBody, listQuery };
